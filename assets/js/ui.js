/* ==========================================================================
   GuardX UI helpers — formatting, escaping, small DOM builders
   ========================================================================== */

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

/* --- time ---------------------------------------------------------------- */

export function relTime(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function clock(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function stamp(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* --- numbers ------------------------------------------------------------- */

export const n = (v) => Number(v).toLocaleString('en-US');

export function compact(v) {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 10_000) return Math.round(v / 1000) + 'K';
  if (v >= 1_000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(v);
}

export const ms = (v) => (v >= 1000 ? (v / 1000).toFixed(2) + 's' : v + 'ms');

/* --- signal renderers ---------------------------------------------------- */
/* Colour is never the only channel: each of these emits its own text. */

export const sevBadge = (s) =>
  `<span class="sev sev-${esc(s)}">${esc(s)}</span>`;

export const decisionBadge = (d) =>
  `<span class="decision decision-${esc(d)}">${d === 'block' ? 'BLOCKED' : d === 'flag' ? 'FLAGGED' : 'ALLOWED'}</span>`;

export const verb = (m) =>
  `<span class="verb verb-${m.toLowerCase()}">${esc(m)}</span>`;

export const statusCode = (c) =>
  `<span class="tnum status-${Math.floor(c / 100)}xx">${c}</span>`;

export const riskClass = (r) =>
  r >= 85 ? 'critical' : r >= 70 ? 'high' : r >= 45 ? 'medium' : 'low';

export const riskLabel = (r) => riskClass(r).toUpperCase();

/* --- code ---------------------------------------------------------------- */

/* Deliberately small tokeniser. Five classes, one pass.
   Single-pass matters: an escape-then-replace scheme lets a later pattern
   match inside an earlier pattern's output and shred the source. Here every
   character is consumed exactly once and escaped on the way out. */
const TOKENS = new RegExp([
  '(?<com>//[^\\n]*)',
  '(?<str>\'(?:[^\'\\\\]|\\\\.)*\'|"(?:[^"\\\\]|\\\\.)*"|`(?:[^`\\\\]|\\\\.)*`)',
  '(?<kw>\\b(?:const|let|var|function|return|await|async|export|import|from|if|else|new|throw|class|extends|try|catch|typeof|instanceof|in|of|true|false|null|undefined)\\b)',
  '(?<num>\\b\\d[\\d_]*(?:\\.\\d+)?\\b)',
  '(?<fn>\\b[A-Za-z_$][\\w$]*(?=\\())',
].join('|'), 'g');

export function highlight(line) {
  let out = '', last = 0, m;
  TOKENS.lastIndex = 0;
  while ((m = TOKENS.exec(line)) !== null) {
    out += esc(line.slice(last, m.index));
    const g = m.groups;
    const cls = g.com ? 't-com' : g.str ? 't-str' : g.kw ? 't-kw' : g.num ? 't-num' : 't-fn';
    out += `<span class="${cls}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(line.slice(last));
}

/* --- misc ---------------------------------------------------------------- */

export function emptyState(title, body, action) {
  return `<div class="empty">
    <div class="empty-rule"></div>
    <div class="empty-title">${esc(title)}</div>
    <p class="empty-body">${esc(body)}</p>
    ${action ? `<div style="margin-top:8px">${action}</div>` : ''}
  </div>`;
}

/* One-shot inline confirmation, used after a real state change. */
export function flash(node, text) {
  if (!node) return;
  const f = el(`<span class="flash">${esc(text)}</span>`);
  node.appendChild(f);
  setTimeout(() => f.classList.add('flash-out'), 1800);
  setTimeout(() => f.remove(), 2200);
}

export function copy(text, node) {
  navigator.clipboard?.writeText(text).then(
    () => flash(node, 'copied'),
    () => flash(node, 'copy blocked')
  );
}
