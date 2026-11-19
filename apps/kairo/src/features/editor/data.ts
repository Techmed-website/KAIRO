import { cbt } from '../../lib/supabase';
import type { OptionKey, PaperQuestion, SubjectCode } from '../../lib/types';

export interface EditorQuestion extends PaperQuestion {
  key_source: string; explanation_source: 'source' | 'ai_legacy' | 'ai_techmed' | 'editor'; version: number;
}

let subjectCodes: Map<number, SubjectCode> | null = null;
async function codes() {
  if (subjectCodes) return subjectCodes;
  const { data } = await cbt().from('subjects').select('id,code');
  return (subjectCodes = new Map((data ?? []).map((s: { id: number; code: SubjectCode }) => [s.id, s.code])));
}

/** Current version of each question with its key and explanation (editors can read these tables directly). */
export async function loadQuestions(ids: string[]): Promise<Map<string, EditorQuestion>> {
  const out = new Map<string, EditorQuestion>();
  if (!ids.length) return out;
  const [{ data: qs, error: e1 }, { data: keys, error: e2 }, m] = await Promise.all([
    cbt().from('questions').select('id,version,year,subject_id,media_url,topic_id').in('id', ids),
    cbt().from('question_keys').select('question_id,correct_option,key_source,explanation,explanation_html,explanation_source').in('question_id', ids),
    codes(),
  ]);
  if (e1 || e2) throw e1 ?? e2;
  const { data: vs, error: e3 } = await cbt().from('question_versions').select('question_id,version,stem_html,passage_html,options').in('question_id', ids);
  if (e3) throw e3;
  const keyBy = new Map((keys ?? []).map((k) => [k.question_id, k]));
  for (const q of qs ?? []) {
    const v = (vs ?? []).find((x) => x.question_id === q.id && x.version === q.version);
    const k = keyBy.get(q.id);
    if (!v || !k) continue;
    out.set(q.id, {
      id: q.id, version: q.version, position: 0, stem_html: v.stem_html, passage_html: v.passage_html, options: v.options,
      subject: m.get(q.subject_id) ?? 'ENG', year: q.year, media_url: q.media_url, topic_id: q.topic_id,
      correct_option: k.correct_option as OptionKey, explanation_html: k.explanation_html ?? k.explanation,
      key_source: k.key_source, explanation_source: (k.explanation_source ?? 'source') as EditorQuestion['explanation_source'],
    });
  }
  return out;
}

/** Save an editor's explanation; it reaches students at once (question_keys trigger). Editors' text is never overwritten by the pipeline. */
export async function saveExplanation(id: string, text: string) {
  const { error } = await cbt().from('question_keys')
    .update({ explanation: text, explanation_html: text, explanation_source: 'editor' }).eq('question_id', id);
  if (error) throw error;
}

/** Change the key. A key change creates a new question version (past attempts keep their marking). The old explanation
 *  explained the old key, so it is replaced by the editor's new text or cleared for the pipeline to rewrite. */
export async function changeKey(id: string, key: OptionKey, newExplanation: string | null) {
  const { error } = await cbt().from('question_keys').update(newExplanation
    ? { correct_option: key, key_source: 'editor', explanation: newExplanation, explanation_html: newExplanation, explanation_source: 'editor' }
    : { correct_option: key, key_source: 'editor', explanation: null, explanation_html: null, explanation_source: 'source' }).eq('question_id', id);
  if (error) throw error;
}

export async function closeReports(ids: number[], status: 'resolved' | 'rejected') {
  const { error } = await cbt().from('question_reports').update({ status }).in('id', ids);
  if (error) throw error;
}
