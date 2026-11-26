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
// Home dashboard (KAIRO 2.0)
export const IcBell = P('M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0');
export const IcFlame = P('M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z');
export const IcCheckCircle = P('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 12.5l2.5 2.5 4.5-5');
export const IcChart = P('M4 20h16M7 16v-4M12 16V8M17 16V5');
export const IcClipboard = P('M9 3h6v3H9zM9 4.5H6V21h12V4.5h-3M9 13l2 2 4-4');
export const IcFileText = P('M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6M9 9h2');
export const IcMap = P('M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14');
export const IcCalendar = P('M4 6h16v15H4zM4 10h16M8 3v4M16 3v4');
export const IcBolt = P('M13 2L4 14h7l-1 8 9-12h-7z');
export const IcArrowRight = P('M5 12h14M13 6l6 6-6 6');
export const IcPlay = P('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM10 8.5v7l5.5-3.5z');
// Subjects
export const IcLanguage = P('M4 5h8M8 3v2M6 5c0 4 3 7 6 8M10 5c-1 4-4 7-6 8M13 21l4-9 4 9M14.5 18h5');
export const IcSigma = P('M18 4H6l6 8-6 8h12');
export const IcAtom = P('M12 12.01h.01M2.5 12a9.5 3.8 0 1 0 19 0 9.5 3.8 0 1 0-19 0M16.75 20.23A9.5 3.8 60 1 1 7.25 3.77 9.5 3.8 60 1 1 16.75 20.23M16.75 3.77A9.5 3.8-60 1 1 7.25 20.23 9.5 3.8-60 1 1 16.75 3.77');
export const IcFlask = P('M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7.5 15h9');
export const IcDna = P('M7 2c0 5 10 5 10 10S7 17 7 22M17 2c0 5-10 5-10 10s10 5 10 10M9 5h6M9 19h6M10.5 9h3M10.5 15h3');
