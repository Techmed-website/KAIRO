import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Sheet({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={ref}>
        <div className="sheet-grab" />
        {children}
      </div>
    </>, document.body);
}

let toastFn: ((m: string) => void) | null = null;
export const toast = (m: string) => toastFn?.(m);
export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    toastFn = (m) => { setMsg(m); clearTimeout(t); t = setTimeout(() => setMsg(null), 3200); };
    return () => { toastFn = null; };
  }, []);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

export function ProgressRing({ value, size = 96, stroke = 9, children, color = 'var(--accent)' }:
  { value: number; size?: number; stroke?: number; children?: ReactNode; color?: string }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, value));
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sunken)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v)} />
      </svg>
      <div className="ring-label">{children}</div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items, label }:
  { value: T; onChange: (v: T) => void; items: { value: T; label: string }[]; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((i) => (
        <button key={i.value} role="tab" aria-selected={value === i.value} onClick={() => onChange(i.value)}>{i.label}</button>
      ))}
    </div>
  );
}

export const Spinner = ({ label = 'Loading' }: { label?: string }) => (
  <div className="center"><div className="stack-sm" style={{ alignItems: 'center' }}><div className="spinner" /><span className="muted small">{label}</span></div></div>
);

/** KAIRO logo drawn with a CSS mask, so it takes the text colour and suits light, dark and navy backgrounds. */
export function Logo({ kind = 'wordmark', height = 28, label = 'KAIRO' }: { kind?: 'wordmark' | 'k'; height?: number; label?: string }) {
  const src = kind === 'k' ? '/brand/kairo-k-white.webp' : '/brand/kairo-wordmark-white.webp';
  const ratio = kind === 'k' ? 194 / 192 : 311 / 96;
  return (
    <span role="img" aria-label={label} className="logo"
      style={{ width: Math.round(height * ratio), height, WebkitMaskImage: `url(${src})`, maskImage: `url(${src})` }} />
  );
}
