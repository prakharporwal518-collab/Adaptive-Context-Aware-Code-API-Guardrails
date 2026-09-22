/* ==========================================================================
   GuardX charts — hand-built inline SVG, no library
   --------------------------------------------------------------------------
   Shared rules applied to every chart here:
     · thin marks, hairline solid grid one step off the surface
     · 2px surface gap between touching fills; 2px surface ring on end dots
     · text wears ink tokens, never the series colour
     · a legend whenever there is more than one series, plus a table view
     · hover tooltips enhance — every value is also reachable as text
   ========================================================================== */

import { esc, n, compact } from './ui.js';

const SURFACE = '#12161d';
const GRID = '#1f2531';
const INK_FAINT = '#4a5262';
const INK_MUTED = '#6d7788';

const SERIES = {
  allowed: { color: '#3f86b8', label: 'Allowed' },
  flagged: { color: '#b0862a', label: 'Flagged' },
  blocked: { color: '#c8413c', label: 'Blocked' },
};

const SEV_COLOR = {
  critical: '#c8413c', high: '#c96f32', medium: '#b0862a', low: '#3f9e73',
};

/* --- tooltip ------------------------------------------------------------- */

let tip;
function tooltip() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'charttip';
    tip.setAttribute('role', 'status');
    document.body.appendChild(tip);
  }
  return tip;
}
function showTip(html, x, y) {
  const t = tooltip();
  t.innerHTML = html;
  t.classList.add('on');
  const r = t.getBoundingClientRect();
  let left = x - r.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - r.width - 8));
  let top = y - r.height - 10;
  if (top < 8) top = y + 16;
  t.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}
function hideTip() { tip?.classList.remove('on'); }
export { hideTip };

/* --- geometry helpers ---------------------------------------------------- */

/* Square at the baseline, 4px rounded at the data end. */
function topRoundedPath(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h);
  return `M${x} ${y + h} L${x} ${y + rr} Q${x} ${y} ${x + rr} ${y} L${x + w - rr} ${y} Q${x + w} ${y} ${x + w} ${y + rr} L${x + w} ${y + h} Z`;
}
function rightRoundedPath(x, y, w, h, r) {
  const rr = Math.min(r, h / 2, w);
  return `M${x} ${y} L${x + w - rr} ${y} Q${x + w} ${y} ${x + w} ${y + rr} L${x + w} ${y + h - rr} Q${x + w} ${y + h} ${x + w - rr} ${y + h} L${x} ${y + h} Z`;
}

function niceTicks(max, count = 4) {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

/* ==========================================================================
   1. Decision volume — stacked columns over the selected window
   ========================================================================== */

export function decisionColumns(host, buckets) {
  const W = Math.max(360, host.clientWidth || 720);
  const PAD = { t: 12, r: 8, b: 26, l: 34 };
  const H = 190;
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  const max = Math.max(1, ...buckets.map((b) => b.total));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const y = (v) => PAD.t + plotH - (v / top) * plotH;

  const band = plotW / buckets.length;
  const bw = Math.min(18, Math.max(4, band - 9));
  const GAP = 2; // surface gap between stacked segments

  let grid = '';
  for (const t of ticks) {
    grid += `<line x1="${PAD.l}" y1="${y(t).toFixed(1)}" x2="${W - PAD.r}" y2="${y(t).toFixed(1)}" stroke="${GRID}" stroke-width="1" shape-rendering="crispEdges"/>`;
    grid += `<text x="${PAD.l - 7}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end" class="ax">${compact(t)}</text>`;
  }

  let bars = '';
  buckets.forEach((b, i) => {
    const cx = PAD.l + band * i + band / 2;
    const x = cx - bw / 2;
    let cursor = PAD.t + plotH;
    const order = ['allowed', 'flagged', 'blocked'];
    const segs = order.filter((k) => b[k] > 0);

    segs.forEach((k, si) => {
      const raw = (b[k] / top) * plotH;
      const isTop = si === segs.length - 1;
      const h = Math.max(1.5, raw - (si > 0 ? GAP : 0));
      const yy = cursor - h;
      const d = isTop ? topRoundedPath(x, yy, bw, h, 4) : `M${x} ${yy} h${bw} v${h} h-${bw} Z`;
      bars += `<path d="${d}" fill="${SERIES[k].color}"/>`;
      cursor = yy - (si < segs.length - 1 ? GAP : 0);
    });

    const hh = new Date(Date.now() - b.hoursAgo * 3600_000).getHours();
    const label = `<div class="tt-h">${String(hh).padStart(2, '0')}:00 &ndash; ${String((hh + 1) % 24).padStart(2, '0')}:00</div>` +
      order.map((k) => `<div class="tt-r"><i style="background:${SERIES[k].color}"></i><span>${SERIES[k].label}</span><b>${n(b[k])}</b></div>`).join('') +
      `<div class="tt-r tt-tot"><span>Inspected</span><b>${n(b.total)}</b></div>`;

    /* Hit target spans the whole band, not just the bar. */
    bars += `<rect class="hit" x="${(PAD.l + band * i).toFixed(1)}" y="${PAD.t}" width="${band.toFixed(1)}" height="${plotH}" fill="transparent" data-tip="${esc(label)}"/>`;

    if (b.hoursAgo % 6 === 0) {
      bars += `<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" class="ax">${String(hh).padStart(2, '0')}:00</text>`;
    }
  });

  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Requests inspected per hour, split by guardrail decision">
    ${grid}
    <line x1="${PAD.l}" y1="${PAD.t + plotH}" x2="${W - PAD.r}" y2="${PAD.t + plotH}" stroke="#2a3240" stroke-width="1" shape-rendering="crispEdges"/>
    ${bars}
  </svg>`;
  wireTips(host);
}

/* ==========================================================================
   2. Risk meter — linear, with the decision thresholds marked
   A dial would be decoration; the thresholds are the information.
   ========================================================================== */

export function riskMeter(host, score, opts = {}) {
  const W = Math.max(220, host.clientWidth || 320);
  const H = 44;
  const barY = 14, barH = 7;
  const x = (v) => (v / 100) * W;
  const color = score >= 85 ? SEV_COLOR.critical : score >= 70 ? SEV_COLOR.high
    : score >= 45 ? SEV_COLOR.medium : SEV_COLOR.low;

  const thresholds = opts.thresholds ?? [
    { v: 45, label: 'review' },
    { v: 70, label: 'block' },
  ];

  const marks = thresholds.map((t) =>
    `<line x1="${x(t.v).toFixed(1)}" y1="${barY - 4}" x2="${x(t.v).toFixed(1)}" y2="${barY + barH + 4}" stroke="${INK_FAINT}" stroke-width="1" shape-rendering="crispEdges"/>
     <text x="${x(t.v).toFixed(1)}" y="${H - 2}" text-anchor="middle" class="ax">${esc(t.label)} ${t.v}</text>`
  ).join('');

  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Risk score ${score} of 100">
    <rect x="0" y="${barY}" width="${W}" height="${barH}" rx="2" fill="#1b212b"/>
    <rect x="0" y="${barY}" width="${Math.max(3, x(score)).toFixed(1)}" height="${barH}" rx="2" fill="${color}">
      <animate attributeName="width" from="0" to="${Math.max(3, x(score)).toFixed(1)}" dur="0.5s" fill="freeze" calcMode="spline" keySplines="0.2 0 0.13 1" keyTimes="0;1"/>
    </rect>
    ${marks}
  </svg>`;
}

/* ==========================================================================
   3. Severity distribution — one labelled row per severity
   Ordered categories, every bar directly labelled, so the warm ramp is
   never the only thing telling them apart.
   ========================================================================== */

export function severityBars(host, rows, opts = {}) {
  const W = Math.max(240, host.clientWidth || 320);
  const rowH = 26, labelW = 66, valueW = 30;
  const H = rows.length * rowH;
  const plotW = W - labelW - valueW;
  const max = Math.max(1, ...rows.map((r) => r.count));

  const body = rows.map((r, i) => {
    const y = i * rowH;
    const w = (r.count / max) * plotW;
    const track = `<rect x="${labelW}" y="${y + 8}" width="${plotW}" height="8" rx="2" fill="${SEV_COLOR[r.severity]}" opacity="0.13"/>`;
    const bar = r.count
      ? `<path d="${rightRoundedPath(labelW, y + 8, Math.max(3, w), 8, 4)}" fill="${SEV_COLOR[r.severity]}"/>`
      : '';
    return `${track}${bar}
      <text x="0" y="${y + 16}" class="ax ax-strong">${esc(r.severity)}</text>
      <text x="${W}" y="${y + 16}" text-anchor="end" class="ax ax-num">${r.count}</text>`;
  }).join('');

  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(opts.aria || 'Open findings by severity')}">${body}</svg>`;
}

/* ==========================================================================
   4. Sparkline — 2px line, end dot with a surface ring
   ========================================================================== */

export function sparkline(host, values, opts = {}) {
  const W = opts.width || Math.max(80, host.clientWidth || 120);
  const H = opts.height || 26;
  const pad = 3;
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const span = max - min || 1;
  const px = (i) => pad + (i / (values.length - 1 || 1)) * (W - pad * 2);
  const py = (v) => pad + (1 - (v - min) / span) * (H - pad * 2);

  const d = values.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(' ');
  const lx = px(values.length - 1), ly = py(values[values.length - 1]);
  const color = opts.color || '#3f86b8';

  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(opts.aria || 'trend')}">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4" fill="${color}" stroke="${SURFACE}" stroke-width="2"/>
  </svg>`;
}

/* ==========================================================================
   5. Latency distribution — histogram with a p95 rule
   ========================================================================== */

export function latencyHistogram(host, samples, p95) {
  const W = Math.max(280, host.clientWidth || 420);
  const H = 112;
  const PAD = { t: 10, r: 8, b: 22, l: 30 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;

  const edges = [0, 25, 50, 100, 200, 400, 800, 1600, 3200, 6400];
  const bins = edges.slice(0, -1).map((lo, i) => ({
    lo, hi: edges[i + 1],
    count: samples.filter((v) => v >= lo && v < edges[i + 1]).length,
  }));
  const max = Math.max(1, ...bins.map((b) => b.count));
  const band = plotW / bins.length;
  const bw = Math.min(22, band - 4);

  const ticks = niceTicks(max, 2);
  const topv = ticks[ticks.length - 1];
  const y = (v) => PAD.t + plotH - (v / topv) * plotH;

  let grid = ticks.map((t) =>
    `<line x1="${PAD.l}" y1="${y(t).toFixed(1)}" x2="${W - PAD.r}" y2="${y(t).toFixed(1)}" stroke="${GRID}" stroke-width="1" shape-rendering="crispEdges"/>
     <text x="${PAD.l - 6}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end" class="ax">${compact(t)}</text>`).join('');

  const bars = bins.map((b, i) => {
    const x = PAD.l + band * i + (band - bw) / 2;
    const h = b.count ? Math.max(2, (b.count / topv) * plotH) : 0;
    const tipHtml = `<div class="tt-h">${b.lo}&ndash;${b.hi} ms</div><div class="tt-r"><span>Requests</span><b>${n(b.count)}</b></div>`;
    return (h ? `<path d="${topRoundedPath(x, PAD.t + plotH - h, bw, h, 4)}" fill="#3f86b8" opacity="0.9"/>` : '') +
      `<rect class="hit" x="${(PAD.l + band * i).toFixed(1)}" y="${PAD.t}" width="${band.toFixed(1)}" height="${plotH}" fill="transparent" data-tip="${esc(tipHtml)}"/>` +
      (i % 2 === 0 ? `<text x="${(PAD.l + band * i + band / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle" class="ax">${b.lo}</text>` : '');
  }).join('');

  /* p95 marked directly — the one value worth labelling on the plot. */
  const bi = bins.findIndex((b) => p95 >= b.lo && p95 < b.hi);
  const px = bi >= 0 ? PAD.l + band * bi + band / 2 : PAD.l + plotW;
  const rule = `<line x1="${px.toFixed(1)}" y1="${PAD.t - 2}" x2="${px.toFixed(1)}" y2="${PAD.t + plotH}" stroke="${INK_MUTED}" stroke-width="1" shape-rendering="crispEdges"/>`;

  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Response time distribution, p95 ${p95} milliseconds">
    ${grid}${bars}${rule}
  </svg>
  <p class="chart-note"><span class="rule-key"></span>p95 &middot; ${n(p95)}ms &nbsp;&middot;&nbsp; bins in ms</p>`;
  wireTips(host);
}

/* --- hover wiring -------------------------------------------------------- */

function wireTips(host) {
  host.querySelectorAll('.hit').forEach((h) => {
    h.addEventListener('mouseenter', (e) => {
      host.querySelectorAll('.hit').forEach((o) => o.classList.remove('hit-on'));
      h.classList.add('hit-on');
      const r = h.getBoundingClientRect();
      showTip(h.dataset.tip, r.left + r.width / 2, r.top);
    });
    h.addEventListener('mouseleave', () => { h.classList.remove('hit-on'); hideTip(); });
  });
  host.addEventListener('mouseleave', hideTip);
}

export function legend(items) {
  return `<ul class="legend">${items.map((k) =>
    `<li><i style="background:${SERIES[k].color}"></i>${SERIES[k].label}</li>`).join('')}</ul>`;
}

export { SERIES, SEV_COLOR };
