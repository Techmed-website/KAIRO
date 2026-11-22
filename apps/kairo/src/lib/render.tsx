import { memo, useLayoutEffect, useRef } from 'react';
import { chemSubscripts, dollarMathToLatex } from './notation';
import { sanitize, textToHtml } from './sanitize';

let katexLoad: Promise<(el: HTMLElement) => void> | null = null;
const hasMath = (s: string) => s.includes('\\(') || s.includes('\\[') || s.includes('$$');

/** KaTeX auto-render, loaded only the first time some text contains maths. */
function loadKatex() {
  katexLoad ??= Promise.all([
    import('katex/contrib/auto-render'),
    import('katex/dist/katex.min.css'),
  ]).then(([m]) => (el: HTMLElement) =>
    m.default(el, {
      delimiters: [
        { left: '\\(', right: '\\)', display: false },
        { left: '\\[', right: '\\]', display: true },
        { left: '$$', right: '$$', display: true },
      ],
      throwOnError: false,
    }));
  return katexLoad;
}

interface Props { html?: string | null; text?: string | null; className?: string; as?: 'div' | 'span'; chem?: boolean }

/** Renders question HTML (sanitized) or explanation text, with maths when present. */
export const Rich = memo(function Rich({ html, text, className, as = 'div', chem = false }: Props) {
  const ref = useRef<HTMLElement>(null);
  let clean = dollarMathToLatex(html != null ? sanitize(html) : textToHtml(text ?? ''));
  if (chem) clean = chemSubscripts(clean);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = clean;
    if (hasMath(clean)) {
      let live = true;
      loadKatex().then((render) => live && render(el)).catch(() => {});
      return () => { live = false; };
    }
  }, [clean]);
  const Tag = as;
  return <Tag ref={ref as never} className={className} />;
});

/** Load KaTeX and its fonts now (e.g. before going offline), by rendering a little maths off-screen. */
export async function warmMath(): Promise<void> {
  const render = await loadKatex();
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;left:-9999px;top:0';
  el.textContent = '\\(\\frac{a^2}{\\sqrt{b}} + \\mathrm{H_2O} \\times \\pi\\)';
  document.body.appendChild(el);
  render(el);
  await (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
  el.remove();
}
