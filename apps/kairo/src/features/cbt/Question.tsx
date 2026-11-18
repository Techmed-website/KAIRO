import { useState } from 'react';
import { parseExplanation } from '../../lib/explain';
import { Rich } from '../../lib/render';
import type { OptionKey, PaperQuestion } from '../../lib/types';
import { Sheet } from '../../ui/components';
import { IcCheck, IcChevronDown, IcFlag, IcX, IcZoom } from '../../ui/icons';
import { ReportButton } from '../review/Report';

type Q = Pick<PaperQuestion, 'id' | 'stem_html' | 'passage_html' | 'options' | 'media_url'> & {
  correct_option?: OptionKey | null; explanation_html?: string | null; subject?: string;
};
const isChem = (q: Q) => q.subject === 'CHM';

export function Passage({ html, open, onToggle }: { html: string; open: boolean; onToggle: () => void }) {
  return (
    <section className={`passage ${open ? 'open' : ''}`}>
      <button className="passage-h" onClick={onToggle} aria-expanded={open}>
        <span>Read the passage</span><IcChevronDown style={{ transform: open ? 'rotate(180deg)' : undefined }} />
      </button>
      {open && <Rich html={html} className="rich passage-b" />}
    </section>
  );
}

export function Diagram({ src }: { src: string }) {
  const [zoom, setZoom] = useState(false);
  if (!/^\/qimg\/[\w.\-]+$/.test(src)) return null;
  return (
    <>
      <button className="diagram" onClick={() => setZoom(true)} aria-label="Zoom diagram">
        <img src={src} alt="Diagram for this question" loading="lazy" decoding="async" />
        <span className="diagram-zoom"><IcZoom />Tap to zoom</span>
      </button>
      <Sheet open={zoom} onClose={() => setZoom(false)} label="Diagram">
        <div className="sheet-body zoom-body"><img src={src} alt="Diagram, enlarged" /></div>
        <button className="btn btn-block" onClick={() => setZoom(false)} style={{ marginTop: 12 }}>Close</button>
      </Sheet>
    </>
  );
}

export function Stem({ q }: { q: Q }) {
  return (
    <>
      {q.media_url && <Diagram src={q.media_url} />}
      <Rich html={q.stem_html} className="rich stem" chem={isChem(q)} />
    </>
  );
}

interface OptionsProps {
  q: Q; selected: OptionKey | null; reveal: boolean; onSelect?: (k: OptionKey) => void;
  whyNot?: Partial<Record<OptionKey, string>>;
}
export function Options({ q, selected, reveal, onSelect, whyNot = {} }: OptionsProps) {
  return (
    <ul className={`opts ${reveal ? 'locked' : ''}`} role="radiogroup" aria-label="Options">
      {q.options.map((o) => {
        const isKey = reveal && q.correct_option === o.key;
        const isWrongPick = reveal && selected === o.key && q.correct_option !== o.key;
        const cls = isKey ? 'is-correct' : isWrongPick ? 'is-wrong' : '';
        const why = reveal && !isKey ? whyNot[o.key] : undefined;
        return (
          <li key={o.key}>
            <button className={`opt ${cls}`} role="radio" aria-checked={selected === o.key}
              disabled={reveal && !onSelect} onClick={() => !reveal && onSelect?.(o.key)}>
              <span className="opt-k">{o.key}</span>
              <Rich html={o.html} className="rich opt-t" as="span" chem={isChem(q)} />
              {isKey && <span className="opt-st"><IcCheck />{selected === o.key ? 'Your answer' : 'Correct'}</span>}
              {isWrongPick && <span className="opt-st"><IcX />Your pick</span>}
              {!reveal && selected === o.key && <span className="sr-only">selected</span>}
            </button>
            {why && <p className="why"><b>Why not {o.key}:</b> <Rich text={why} as="span" chem={isChem(q)} /></p>}
          </li>
        );
      })}
    </ul>
  );
}

/** The TECHMED tutor card: verdict, correct answer, explanation; or a kind fallback when none exists yet. */
export function Tutor({ q, selected }: { q: Q; selected: OptionKey | null }) {
  const parsed = parseExplanation(q.explanation_html);
  const ok = !!selected && selected === q.correct_option;
  const keyOpt = q.options.find((o) => o.key === q.correct_option);
  return (
    <section className="tutor" aria-live="polite">
      <div className="tutor-h">
        <span className={`verdict ${!selected ? '' : ok ? 'ok' : 'no'}`}>
          {!selected ? 'Not answered' : ok ? <><IcCheck />Correct. Well done.</> : <><IcX />Not quite. You picked {selected}.</>}
        </span>
      </div>
      <div className="tutor-b">
        {keyOpt && (
          <div><h4>Correct answer</h4><p className="row" style={{ alignItems: 'baseline' }}><b>{keyOpt.key}.</b> <Rich html={keyOpt.html} as="span" className="rich" chem={isChem(q)} /></p></div>
        )}
        {parsed?.concept && <div><h4>Understand the concept</h4><Rich text={parsed.concept} className="rich" chem={isChem(q)} /></div>}
        {parsed?.main && <div><h4>{parsed.concept || parsed.steps ? 'Note' : 'Why'}</h4><Rich text={parsed.main} className="rich" chem={isChem(q)} /></div>}
        {parsed?.steps && (
          <div><h4>Step by step</h4><ol className="steps">{parsed.steps.map((st, i) => <li key={i}><Rich text={st} as="span" chem={isChem(q)} /></li>)}</ol></div>
        )}
        {!parsed && <p className="muted">Explanation coming soon. Report this question if you think the answer is wrong.</p>}
        {parsed?.tip && <div className="tip"><b>TECHMED TIP:</b> <Rich text={parsed.tip} as="span" chem={isChem(q)} /></div>}
        <ReportButton questionId={q.id} />
      </div>
    </section>
  );
}

export const whyNotFor = (q: Q) => parseExplanation(q.explanation_html)?.whyNot ?? {};
export { IcFlag };
