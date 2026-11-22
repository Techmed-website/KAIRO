// Small inline icon set (stroke icons, 24px grid). Kept here so no icon library ships.
import type { SVGProps } from 'react';
const P = (d: string) => (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d={d} /></svg>
);
export const IcBack = P('M15 18l-6-6 6-6');
export const IcNext = P('M9 18l6-6-6-6');
export const IcHome = P('M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z');
export const IcBook = P('M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M8 7h7');
export const IcClock = P('M12 7v5l3 2M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z');
export const IcUser = P('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0');
export const IcFlag = P('M5 21V4h11l-1.5 4L16 12H5');
export const IcGrid = P('M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z');
export const IcCalc = P('M7 2.5h10a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2zM8.5 7h7M9 12h.01M12 12h.01M15 12h.01M9 15.5h.01M12 15.5h.01M15 15.5h.01M9 19h.01M12 19h.01M15 19h.01');
export const IcMoon = P('M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z');
export const IcSun = P('M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4');
export const IcClose = P('M6 6l12 12M18 6L6 18');
export const IcCheck = P('M5 12.5l4.5 4.5L19 7.5');
export const IcX = P('M7 7l10 10M17 7L7 17');
export const IcChevronDown = P('M6 9l6 6 6-6');
export const IcZoom = P('M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5M11 8v6M8 11h6');
export const IcDownload = P('M12 3v12M7 10l5 5 5-5M5 21h14');
export const IcShare = P('M12 3v13M7 8l5-5 5 5M5 14v6h14v-6');
export const IcSpark = P('M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z');
export const IcTarget = P('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01');
export const IcTrophy = P('M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3');
