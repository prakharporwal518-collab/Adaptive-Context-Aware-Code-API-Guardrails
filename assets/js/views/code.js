/* ==========================================================================
   Code analyzer — file tree / source excerpt / findings
   Selecting either a file or a finding drives the same selection, so the
   three panes never disagree about what is on screen.
   ========================================================================== */

import * as store from '../store.js';
import { tree } from '../data.js';
import { icons } from '../icons.js';
import { esc, n, relTime, stamp, sevBadge, highlight, emptyState, flash, copy } from '../ui.js';

let selected = null; // finding id

export function render(host, ctx) {
  const all = store.get().findings;
  if (!selected || !all.some((f) => f.id === selected)) {
    selected = ctx?.finding || all.find((f) => f.state === 'open')?.id || all[0]?.id || null;
  }
  if (ctx?.finding) selected = ctx.finding;

  const current = all.find((f) => f.id === selected) || null;
  const scan = store.scans[0];

  host.innerHTML = `
  <div class="analyzer">

    <div class="pane">
      <div class="pane-hd">
        <span class="label">Repository</span>
        <div class="spacer" style="flex:1"></div>
        <span class="chip mono">${esc(scan.branch)}@${esc(scan.commit)}</span>
      </div>
      <div class="pane-bd"><div class="tree">${renderTree()}</div></div>
      <div style="flex:none;border-top:1px solid var(--line);padding:9px 12px">
        <div class="ctx-item"><span class="k">scan</span><span class="v">${esc(scan.id)}</span></div>
        <div class="ctx-item"><span class="k">files</span><span class="v">${n(scan.files)}</span></div>
        <div class="ctx-item"><span class="k">finished</span><span class="v">${relTime(scan.started)}</span></div>
      </div>
    </div>

    <div class="pane">
      <div class="pane-hd">
        ${current ? `<span class="mono" style="font-size:12.5px;color:var(--ink)">${esc(current.file)}</span>
          <span class="meta">excerpt &middot; line ${current.line}</span>` : `<span class="label">Source</span>`}
        <div class="spacer" style="flex:1"></div>
        ${current ? `<button class="btn btn-sm btn-ghost" id="copy-path" title="Copy path">${icons.copy}</button>` : ''}
      </div>
      <div class="pane-bd">${current ? renderSource(current) : emptyState('No file selected', 'Pick a file in the tree or a finding on the right to see the flagged source.')}</div>
    </div>

    <div class="pane pane-findings">
      <div class="pane-hd">
        <span class="label">Findings</span>
        <div class="spacer" style="flex:1"></div>
        <div class="segmented" id="find-filter">
          <button data-f="open" aria-pressed="true">Open</button>
          <button data-f="all" aria-pressed="false">All</button>
        </div>
      </div>
      <div class="pane-bd"><div class="find-list" id="find-list"></div></div>
    </div>

  </div>`;

  let filter = 'open';
  const list = host.querySelector('#find-list');

  const paint = () => {
    const rows = filter === 'open' ? all.filter((f) => f.state === 'open') : all;
    list.innerHTML = rows.length
      ? rows.slice().sort(bySeverity).map(findingRow).join('')
      : emptyState('No open findings',
          'Every finding from this scan is resolved or risk-accepted. Switch to All to review the closed ones.');
    list.querySelectorAll('.find-row').forEach((r) =>
      r.addEventListener('click', () => { selected = r.dataset.id; render(host); }));
  };
  paint();

  host.querySelectorAll('#find-filter button').forEach((b) =>
    b.addEventListener('click', () => {
      filter = b.dataset.f;
      host.querySelectorAll('#find-filter button').forEach((o) =>
        o.setAttribute('aria-pressed', String(o === b)));
      paint();
    }));

  host.querySelectorAll('.tree-row.file').forEach((r) =>
    r.addEventListener('click', () => {
      const f = store.fileFindings(r.dataset.path)[0];
      if (f) { selected = f.id; render(host); }
      else flash(r, 'clean');
    }));

  host.querySelector('#copy-path')?.addEventListener('click', (e) =>
    copy(current.file + ':' + current.line, e.currentTarget.parentElement));

  host.querySelector('#act-resolve')?.addEventListener('click', () => {
    store.resolveFinding(current.id);
  });
  host.querySelector('#act-reopen')?.addEventListener('click', () => {
    store.reopenFinding(current.id);
  });
  host.querySelector('#act-accept')?.addEventListener('click', () => {
    const note = prompt('Reason for accepting this risk (recorded in the audit log):');
    if (note !== null) store.acceptFinding(current.id, note.trim());
  });

  host.querySelectorAll('[data-req]').forEach((b) =>
    b.addEventListener('click', () => { location.hash = '#/api?req=' + b.dataset.req; }));
  host.querySelectorAll('[data-pol]').forEach((b) =>
    b.addEventListener('click', () => { location.hash = '#/policies?id=' + b.dataset.pol; }));

  return () => {};
}

const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const bySeverity = (a, b) =>
  (a.state === 'open' ? 0 : 1) - (b.state === 'open' ? 0 : 1) ||
  SEV_ORDER[a.severity] - SEV_ORDER[b.severity];

function renderTree() {
  return tree.map((node) => {
    const name = node.path.split('/').pop();
    const pad = 10 + node.depth * 13;
    if (node.type === 'dir') {
      return `<div class="tree-row dir" style="padding-left:${pad}px">
        ${icons.folder}<span class="nm">${esc(name)}</span></div>`;
    }
    const fs = store.fileFindings(node.path);
    const open = fs.filter((f) => f.state === 'open').sort(bySeverity);
    const worst = open[0];
    const sel = fs.some((f) => f.id === selected);
    const tone = worst
      ? { critical: 'crit', high: 'high', medium: 'med', low: 'low' }[worst.severity]
      : null;
    return `<div class="tree-row file" data-path="${esc(node.path)}" aria-selected="${sel}" style="padding-left:${pad}px;position:relative">
      ${icons.file}<span class="nm">${esc(name)}</span>
      ${worst
        ? `<span class="tree-dot" style="background:var(--sev-${tone})" title="${open.length} open finding(s), worst ${worst.severity}"></span>`
        : fs.length ? `<span class="tree-n" title="all findings closed">&check;</span>` : ''}
    </div>`;
  }).join('');
}

function findingRow(f) {
  return `<div class="find-row ${f.state !== 'open' ? 'done' : ''}" data-id="${esc(f.id)}" aria-selected="${f.id === selected}">
    <div class="find-hd">
      ${sevBadge(f.severity)}
      ${f.state !== 'open' ? `<span class="state state-${esc(f.state)}">${esc(f.state)}</span>` : ''}
      <span class="rid">${esc(f.id)}</span>
    </div>
    <div class="find-title">${esc(f.title)}</div>
    <div class="find-loc">${esc(f.file)}:${f.line}</div>
  </div>`;
}

function renderSource(f) {
  const lines = f.snippet.map(([ln, text]) => {
    const hot = ln === f.hot;
    return `<div class="src-line ${hot ? 'hot' : ''}"><div class="ln">${ln}</div><div class="cd">${highlight(text)}</div></div>` +
      (hot ? callout(f) : '');
  }).join('');
  return `<div class="src">${lines}</div>`;
}

function callout(f) {
  const links = [];
  if (f.linked?.policy) links.push(`<button class="cite" data-pol="${esc(f.linked.policy)}">${esc(f.linked.policy)}</button>`);
  (f.linked?.requests || []).forEach((r) =>
    links.push(`<button class="cite" data-req="${esc(r)}">${esc(r)}</button>`));

  const actions = f.state === 'open'
    ? `<button class="btn btn-sm btn-primary" id="act-resolve">${icons.check} Mark resolved</button>
       <button class="btn btn-sm" id="act-accept">Accept risk</button>`
    : `<button class="btn btn-sm" id="act-reopen">Reopen</button>`;

  const closed = f.state === 'resolved'
    ? `<div class="note" style="margin-top:9px">Resolved by <b>${esc(f.resolvedBy || '—')}</b> ${f.resolvedAt ? relTime(f.resolvedAt) : ''}${f.resolvedIn ? ` in <code class="inline">${esc(f.resolvedIn)}</code>` : ''}.</div>`
    : f.state === 'accepted'
    ? `<div class="note" style="margin-top:9px">Risk accepted by <b>${esc(f.acceptedBy || '—')}</b> ${f.acceptedAt ? relTime(f.acceptedAt) : ''}. ${esc(f.acceptedNote || '')}</div>`
    : '';

  return `<div class="callout sev-b-${esc(f.severity)}">
    <div class="callout-hd">
      ${sevBadge(f.severity)}
      <span class="rule-id">${esc(f.rule)}</span>
      <span class="chip">${esc(f.cwe)}</span>
      <span class="meta" style="margin-left:auto">${esc(f.id)}</span>
    </div>
    <p>${esc(f.why)}</p>
    ${links.length ? `<div style="margin-top:9px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <span class="label">Correlated</span>${links.join('')}</div>` : ''}
    <div class="diff">
      <div class="diff-hd"><span class="label">Suggested fix</span>
        <span class="meta" style="margin-left:auto">${esc(f.file)}</span></div>
      ${f.fix.map(([k, t]) => `<div class="diff-line diff-${k === '-' ? 'del' : 'add'}">${esc(t)}</div>`).join('')}
    </div>
    ${closed}
    <div style="margin-top:10px;display:flex;gap:7px;align-items:center;flex-wrap:wrap">
      ${actions}
      <span class="meta" style="margin-left:auto">introduced in ${esc(f.introduced)} &middot; owner ${esc(f.owner)}</span>
    </div>
  </div>`;
}
