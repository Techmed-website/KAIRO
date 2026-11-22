import { useState } from 'react';

export interface Point { at: string; pct: number; title: string }

/** Score trend: one series (percentage per finished attempt, oldest → newest), 0–100 axis, hover/tap tooltip. */
export function TrendChart({ points }: { points: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 320, H = 150, L = 30, R = 10, T = 12, B = 22;
  const x = (i: number) => L + (points.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (points.length - 1));
  const y = (v: number) => T + ((100 - v) * (H - T - B)) / 100;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const last = points.length - 1;
  const pick = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * W;
    let best = 0;
    points.forEach((_, i) => { if (Math.abs(x(i) - sx) < Math.abs(x(best) - sx)) best = i; });
    setHover(best);
  };
  const h = hover ?? null;
  return (
    <div className="trend">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Score trend over your last ${points.length} finished attempts`}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)} onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
        onPointerLeave={() => setHover(null)}>
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="trend-grid" />
            <text x={L - 6} y={y(v) + 3} textAnchor="end" className="trend-axis">{v}%</text>
          </g>
        ))}
        <path d={area} className="trend-area" />
        <path d={path} className="trend-line" />
        {h !== null && <line x1={x(h)} x2={x(h)} y1={T} y2={y(0)} className="trend-cross" />}
        {points.map((p, i) => (i === last || i === h) && (
          <circle key={i} cx={x(i)} cy={y(p.pct)} r={i === h ? 5 : 4} className="trend-dot" />
        ))}
      </svg>
      {h !== null && (
        <div className="trend-tip" style={{ left: `${(x(h) / W) * 100}%` }} role="status">
          <b className="num">{Math.round(points[h].pct)}%</b>
          <span>{points[h].title}</span>
          <span className="muted">{new Date(points[h].at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
        </div>
      )}
    </div>
  );
}
