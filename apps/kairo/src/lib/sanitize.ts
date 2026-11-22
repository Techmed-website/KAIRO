import DOMPurify from 'dompurify';

const ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup', 'br', 'p', 'span', 'small', 'div',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'img', 'blockquote', 'hr'];
const ALLOWED_ATTR = ['src', 'alt', 'colspan', 'rowspan'];

let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true;
  // Images: only our own diagrams under /qimg/ (served by the app, no third-party hosts).
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName === 'src') {
      const ok = node.nodeName === 'IMG' && /^\/qimg\/[\w.\-]+\.(webp|png|jpe?g|gif|svg)$/i.test(data.attrValue);
      if (!ok) data.keepAttr = false;
    }
  });
  DOMPurify.addHook('afterSanitizeElements', (node) => {
    if (node.nodeName === 'IMG' && !(node as Element).getAttribute('src')) node.parentNode?.removeChild(node);
    if (node.nodeName === 'IMG') { (node as Element).setAttribute('loading', 'lazy'); (node as Element).setAttribute('decoding', 'async'); }
  });
}

/** Allowlist-sanitize HTML from the question source. */
export function sanitize(html: string | null | undefined): string {
  if (!html) return '';
  hook();
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR: [...ALLOWED_ATTR, 'loading', 'decoding'], ALLOW_DATA_ATTR: false });
}

/** Plain text (for explanations, which are stored as text): escape, keep line breaks. */
export function textToHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}
