-- Topic labels for the question bank (tools/question-import/tag_topics.py).
-- topic_source: legacy (copied from the labelled kairo bank), rule (English question-type rules),
-- model (classifier), editor (confirmed by a person). topic_auto = trusted enough for topic practice;
-- otherwise the topic is a suggestion waiting for an editor.

alter table cbt.questions
  add column topic_source     text check (topic_source in ('legacy','rule','model','editor')),
  add column topic_confidence real,
  add column topic_auto       boolean not null default false;

-- The temporary import function now also sets topics. On published questions only the topic fields change
-- (the frozen version's topic is refreshed too, so topic stats stay right).
create or replace function public.cbt_import_questions(p_token text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = cbt, public, pg_temp as $$
declare
  r jsonb; v_passage uuid; v_q uuid; v_subject smallint; v_topic integer;
  n_q int := 0; n_k int := 0; n_skip int := 0;
begin
  if not exists (select 1 from cbt.import_secret
                 where sha256 = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'batch too large'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    select id into v_subject from cbt.subjects where code = r ->> 'subject';
    select t.id into v_topic from cbt.topics t where t.subject_id = v_subject and t.name = r ->> 'topic';
    v_passage := null;
    if r -> 'passage' is not null and jsonb_typeof(r -> 'passage') = 'object' then
      insert into cbt.passages (source_ref, html) values (r -> 'passage' ->> 'key', r -> 'passage' ->> 'html')
      on conflict (source_ref) do update set html = excluded.html
      returning id into v_passage;
    end if;

    insert into cbt.questions (source_ref, legacy_id, subject_id, topic_id, year, source, stem, stem_html, passage_id,
                               options, content_hash, import_status, import_flags, image_file,
                               topic_source, topic_confidence, topic_auto)
    values (r ->> 'source_ref', r ->> 'legacy_id', v_subject, v_topic, (r ->> 'year')::smallint, 'jamb',
            r ->> 'stem', r ->> 'stem_html', v_passage, r -> 'options', r ->> 'content_hash',
            r ->> 'import_status', array(select jsonb_array_elements_text(coalesce(r -> 'flags', '[]'))),
            r ->> 'image_file', r ->> 'topic_source', (r ->> 'topic_confidence')::real,
            coalesce((r ->> 'topic_auto')::boolean, false))
    on conflict (source_ref) do update set
      legacy_id = excluded.legacy_id, subject_id = excluded.subject_id, topic_id = excluded.topic_id,
      year = excluded.year, stem = excluded.stem, stem_html = excluded.stem_html, passage_id = excluded.passage_id,
      options = excluded.options, content_hash = excluded.content_hash,
      import_status = excluded.import_status, import_flags = excluded.import_flags,
      image_file = excluded.image_file, topic_source = excluded.topic_source,
      topic_confidence = excluded.topic_confidence, topic_auto = excluded.topic_auto
      where cbt.questions.status = 'draft' and coalesce(cbt.questions.topic_source, '') <> 'editor'
    returning id into v_q;

    if v_q is null then
      -- Published (or editor-labelled) question: only fill in a missing topic, never overwrite an editor's.
      update cbt.questions set topic_id = v_topic, topic_source = r ->> 'topic_source',
             topic_confidence = (r ->> 'topic_confidence')::real, topic_auto = coalesce((r ->> 'topic_auto')::boolean, false)
      where source_ref = r ->> 'source_ref' and topic_id is null and v_topic is not null
      returning id into v_q;
      if v_q is not null then
        update cbt.question_versions set topic_id = v_topic where question_id = v_q and topic_id is null;
      end if;
      n_skip := n_skip + 1; continue;
    end if;
    n_q := n_q + 1;

    if r ->> 'correct' is not null then
      insert into cbt.question_keys (question_id, correct_option, key_source)
      values (v_q, r ->> 'correct', r ->> 'key_source')
      on conflict (question_id) do update set correct_option = excluded.correct_option, key_source = excluded.key_source
        where cbt.question_keys.key_source <> 'editor';
      n_k := n_k + 1;
    end if;
  end loop;
  return jsonb_build_object('questions', n_q, 'keys', n_k, 'skipped_published', n_skip);
end $$;

revoke execute on function public.cbt_import_questions(text, jsonb) from public;
grant execute on function public.cbt_import_questions(text, jsonb) to anon;
