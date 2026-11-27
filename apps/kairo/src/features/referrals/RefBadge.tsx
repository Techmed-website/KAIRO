/**
 * The six PROUDLY KAIRO emblems. Each is its own drawing (shield, laurel, trophy, diamond), all on a 100×116 canvas,
 * so they stay crisp from a 16 px leaderboard marker to a 160 px celebration. Locked badges are muted with CSS.
 */
export const REF_LEVELS = [
  { code: 'ref_1', title: 'Proud KAIRO User', goal: 1, tag: 'First friend in' },
  { code: 'ref_3', title: 'KAIRO Advocate', goal: 3, tag: 'Spreading the word' },
  { code: 'ref_5', title: 'KAIRO Ambassador', goal: 5, tag: 'Officially elite' },
  { code: 'ref_10', title: 'KAIRO Champion', goal: 10, tag: 'Squad builder' },
  { code: 'ref_25', title: 'KAIRO Legend', goal: 25, tag: 'Hall of fame energy' },
  { code: 'ref_50', title: 'KAIRO Icon', goal: 50, tag: 'The blueprint' },
] as const;
export type RefCode = (typeof REF_LEVELS)[number]['code'];
export const refLevel = (code: string | null | undefined) => REF_LEVELS.find((l) => l.code === code) ?? null;

const SHIELD = 'M50 4 L90 18 V54 C90 82 72 100 50 112 C28 100 10 82 10 54 V18 Z';
const SHIELD_IN = 'M50 12 L83 24 V54 C83 77 68 92 50 102 C32 92 17 77 17 54 V24 Z';
const star = (cx: number, cy: number, r: number) => {
  const p: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2; const rr = i % 2 ? r * 0.42 : r;
    p.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return p.join(' ');
};
/** One side of a laurel branch: leaves along an arc. */
function Laurel({ side, color, cx = 50, cy = 64, r = 38, from = 200, to = 300, leaf = 7 }: { side: 1 | -1; color: string; cx?: number; cy?: number; r?: number; from?: number; to?: number; leaf?: number }) {
  const leaves = [];
  for (let d = from; d <= to; d += 16) {
    const a = (d * Math.PI) / 180;
    const x = cx + side * r * Math.cos(a) * -1, y = cy - r * Math.sin(a) * -1;
    const rot = side === 1 ? 180 - d + 40 : d - 180 - 40;
    leaves.push(<ellipse key={d} cx={x} cy={y} rx={leaf * 0.45} ry={leaf} fill={color} transform={`rotate(${rot} ${x} ${y})`} />);
  }
  return <g>{leaves}</g>;
}

function Art({ code, uid }: { code: string; uid: string }) {
  const g = (id: string) => `${id}-${uid}`;
  switch (code) {
    case 'ref_1': // navy & gold shield with a star
      return (<>
        <defs><linearGradient id={g('n')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0B3A66" /><stop offset="1" stopColor="#012748" /></linearGradient></defs>
        <path d={SHIELD} fill="#C9A227" /><path d={SHIELD_IN} fill={`url(#${g('n')})`} />
        <polygon points={star(50, 56, 22)} fill="#C9A227" /><polygon points={star(50, 56, 10)} fill="#E9D18E" />
      </>);
    case 'ref_3': // silver & blue shield with laurel details
      return (<>
        <defs><linearGradient id={g('s')} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#F2F5F8" /><stop offset=".5" stopColor="#B9C6D2" /><stop offset="1" stopColor="#8EA2B5" /></linearGradient></defs>
        <path d={SHIELD} fill={`url(#${g('s')})`} /><path d={SHIELD_IN} fill="#09476E" />
        <Laurel side={1} color="#D5DEE6" cx={50} cy={60} r={24} from={205} to={320} leaf={5.5} />
        <Laurel side={-1} color="#D5DEE6" cx={50} cy={60} r={24} from={205} to={320} leaf={5.5} />
        <polygon points={star(50, 52, 11)} fill="#F2F5F8" />
      </>);
    case 'ref_5': // gold academic ambassador shield
      return (<>
        <defs><linearGradient id={g('gd')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F3DC8C" /><stop offset=".55" stopColor="#C9A227" /><stop offset="1" stopColor="#8A6A12" /></linearGradient></defs>
        <path d={SHIELD} fill={`url(#${g('gd')})`} /><path d={SHIELD_IN} fill="none" stroke="#FFF4C7" strokeWidth="2" />
        <path d="M50 34 L76 45 L50 56 L24 45 Z" fill="#012748" /><path d="M35 50 V62 C35 66 65 66 65 62 V50 L50 57 Z" fill="#012748" />
        <path d="M74 46 V60" stroke="#012748" strokeWidth="2.5" /><circle cx="74" cy="62" r="3" fill="#012748" />
        <path d="M30 80 H70" stroke="#012748" strokeWidth="3" strokeLinecap="round" /><path d="M36 88 H64" stroke="#012748" strokeWidth="3" strokeLinecap="round" />
      </>);
    case 'ref_10': // premium blue & gold trophy-inspired shield
      return (<>
        <defs><linearGradient id={g('b')} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1D6FA3" /><stop offset="1" stopColor="#012748" /></linearGradient></defs>
        <path d={SHIELD} fill="#C9A227" /><path d={SHIELD_IN} fill={`url(#${g('b')})`} />
        <path d="M36 34 H64 V46 C64 56 58 62 50 62 C42 62 36 56 36 46 Z" fill="#C9A227" />
        <path d="M36 38 H28 C28 48 32 52 37 52 M64 38 H72 C72 48 68 52 63 52" fill="none" stroke="#C9A227" strokeWidth="3" />
        <path d="M47 62 H53 V72 H47 Z" fill="#C9A227" /><path d="M38 74 H62 V80 H38 Z" fill="#C9A227" rx="2" />
        <polygon points={star(50, 46, 6)} fill="#012748" />
        <path d="M30 90 L50 98 L70 90" fill="none" stroke="#E9D18E" strokeWidth="2.5" />
      </>);
    case 'ref_25': // platinum & gold laurel emblem
      return (<>
        <defs><radialGradient id={g('p')} cx=".4" cy=".35" r=".75"><stop offset="0" stopColor="#FFFFFF" /><stop offset=".6" stopColor="#D9DEE4" /><stop offset="1" stopColor="#A8B1BC" /></radialGradient></defs>
        <circle cx="50" cy="58" r="44" fill="#C9A227" /><circle cx="50" cy="58" r="40" fill={`url(#${g('p')})`} />
        <Laurel side={1} color="#C9A227" cx={50} cy={58} r={31} from={195} to={330} leaf={6.5} />
        <Laurel side={-1} color="#C9A227" cx={50} cy={58} r={31} from={195} to={330} leaf={6.5} />
        <polygon points={star(50, 54, 15)} fill="#C9A227" />
        <path d="M30 96 L40 112 L50 104 L60 112 L70 96" fill="#C9A227" />
      </>);
    case 'ref_50': // elite black & gold diamond shield
      return (<>
        <defs><linearGradient id={g('k')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2A2A2A" /><stop offset="1" stopColor="#050505" /></linearGradient>
          <linearGradient id={g('gg')} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#F7E39A" /><stop offset="1" stopColor="#B88A12" /></linearGradient></defs>
        <path d="M50 2 L96 50 L50 114 L4 50 Z" fill={`url(#${g('gg')})`} /><path d="M50 10 L88 50 L50 104 L12 50 Z" fill={`url(#${g('k')})`} />
        <path d="M34 42 L42 32 H58 L66 42 L50 66 Z" fill="none" stroke="#E9D18E" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M34 42 H66 M42 32 L46 42 L50 66 L54 42 L58 32" fill="none" stroke="#E9D18E" strokeWidth="1.6" strokeLinejoin="round" />
        <polygon points={star(50, 82, 6)} fill="#C9A227" />
      </>);
    default:
      return <path d={SHIELD} fill="#98B0C4" />;
  }
}

let n = 0;
/** One emblem. `locked` mutes it (grey, faint); the requirement text is shown by the caller. */
export function RefBadge({ code, size = 64, locked = false, label }: { code: string; size?: number; locked?: boolean; label?: string }) {
  const uid = `rb${(n = (n + 1) % 1e6)}`;
  const l = refLevel(code);
  return (
    <svg className={`refb ${locked ? 'refb-locked' : ''}`} width={size} height={(size * 116) / 100} viewBox="0 0 100 116"
      role="img" aria-label={label ?? `${l?.title ?? 'Referral badge'}${locked ? ' (locked)' : ''}`}>
      <Art code={code} uid={uid} />
    </svg>
  );
}
