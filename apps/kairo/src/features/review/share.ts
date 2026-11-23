/**
 * "I scored 8/10 on Day 13 — beat me": a branded square image for WhatsApp (status or chats), drawn on a canvas on the
 * phone. Shared as a file where the browser allows it (Android Chrome does), otherwise downloaded with a WhatsApp link.
 */
export interface ShareInfo { score: number; total: number; heading: string; sub: string | null; url: string }

export async function shareScore(s: ShareInfo): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = await drawCard(s);
  const text = `I scored ${s.score}/${s.total} on the ${s.heading.replace(/:.*$/, '')} TECHMED Daily Builder Quiz. Can you beat me? 💪\n${s.url}`;
  const file = new File([blob], 'techmed-score.png', { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], text }); return 'shared'; }
    catch (e) { if ((e as DOMException).name === 'AbortError') return 'cancelled'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'techmed-score.png'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  return 'downloaded';
}

async function drawCard(s: ShareInfo): Promise<Blob> {
  const W = 1080, H = 1080;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  try { await document.fonts.load('800 120px Montserrat'); } catch { /* system font is fine */ }
  const bg = g.createRadialGradient(W * 0.85, H * 0.1, 50, W * 0.5, H * 0.5, W);
  bg.addColorStop(0, '#09476E'); bg.addColorStop(0.6, '#012748'); bg.addColorStop(1, '#011a31');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = '#C9A227'; g.fillRect(0, H - 18, W, 18);

  const font = (w: number, px: number) => `${w} ${px}px Montserrat, "Source Sans 3", system-ui, sans-serif`;
  g.textAlign = 'left';
  g.fillStyle = '#C9A227'; g.font = font(800, 40); g.fillText('TECHMED · DAILY BUILDER QUIZ', 80, 130);
  g.fillStyle = '#F8F9FA'; g.font = font(800, 64); wrap(g, s.heading, 80, 230, W - 160, 76);
  if (s.sub) { g.fillStyle = '#98B0C4'; g.font = font(600, 44); wrap(g, s.sub, 80, 330, W - 160, 54); }

  g.fillStyle = '#F8F9FA'; g.font = font(900, 300); g.textAlign = 'center';
  g.fillText(`${s.score}/${s.total}`, W / 2, 700);
  g.fillStyle = '#C9A227'; g.font = font(800, 64); g.fillText('Can you beat me?', W / 2, 810);
  g.fillStyle = '#98B0C4'; g.font = font(700, 38); g.fillText(s.url.replace(/^https?:\/\//, ''), W / 2, 950, W - 120);
  g.fillStyle = '#F8F9FA'; g.font = font(700, 34); g.fillText('Think Smart. Perform Elite.', W / 2, 1010);
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number) {
  const words = text.split(/\s+/); let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > max && line) { g.fillText(line, x, y); line = w; y += lh; } else line = t;
  }
  if (line) g.fillText(line, x, y);
}
