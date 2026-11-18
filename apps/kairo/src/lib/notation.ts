// Small text repairs before rendering, so source formatting quirks don't reach students.

/** `$NH_4^+$` → `\(NH_4^+\)`. Only when the inside clearly is maths (_ ^ \ { }), so prices like "$5" stay text. */
export function dollarMathToLatex(s: string): string {
  if (!s.includes('$')) return s;
  return s.replace(/\$\$[\s\S]*?\$\$|\$([^$\n]{1,300}?)\$/g, (m, inner?: string) =>
    inner !== undefined && /[\\_^{}]/.test(inner) ? `\\(${inner}\\)` : m);
}

const ELEMENTS = new Set(('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr ' +
  'Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt ' +
  'Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu').split(' '));

/** True when the token is a run of element symbols with counts, e.g. NH4Cl, C6H12O6, Ca(OH)2. */
function isFormula(tok: string): boolean {
  const core = tok.replace(/[()]/g, '');
  const parts = core.match(/[A-Z][a-z]?\d*/g);
  if (!parts || parts.join('') !== core) return false;
  return parts.every((p) => ELEMENTS.has(p.replace(/\d+/g, '')));
}

/** Chemistry: write the counts in formulas as subscripts (NH4Cl → NH<sub>4</sub>Cl). Text outside tags and maths only. */
export function chemSubscripts(html: string): string {
  return html.split(/(<[^>]+>|\\\([\s\S]*?\\\)|<sub>[\s\S]*?<\/sub>)/).map((seg, i) => {
    if (i % 2 === 1) return seg; // a tag, maths, or an existing subscript
    return seg.replace(/\b[A-Z][A-Za-z0-9()]*\d[A-Za-z0-9()]*/g, (tok) => {
      const m = /^(.*?)(\)?)$/.exec(tok)!;
      const t = m[1] + m[2];
      if (!/\d/.test(t) || !isFormula(t) || (t.match(/\(/g)?.length ?? 0) !== (t.match(/\)/g)?.length ?? 0)) return tok;
      return t.replace(/([A-Za-z)])(\d+)/g, '$1<sub>$2</sub>');
    });
  }).join('');
}
