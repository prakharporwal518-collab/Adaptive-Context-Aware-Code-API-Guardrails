/* ==========================================================================
   API monitor — filter row, request table, detail drawer
   One filter row scopes the whole table. The drawer explains a single
   decision: which policy, which factors, and what else in the system is
   connected to it.
   ========================================================================== */

import * as store from '../store.js';
import { riskMeter } from '../charts.js';
import { icons } from '../icons.js';
import {
  esc, n, ms, stamp, clock, relTime, verb, statusCode, decisionBadge,
  sevBadge, riskClass, emptyState, copy,
} from '../ui.js';

const filters = { q: '', decision: 'all', method: 'all', service: 'all' };
let openId = null;

export function render(host, ctx) {
  if (ctx?.req) openId = ctx.req;

  const services = [...new Set(store.scopedRequests().map((r) => r.service))].sort();

  host.innerHTML = `
  <div class="monitor">
    <div class="filterbar">
      <label class="sr-only" for="f-q">Filter by path, request id or actor</label>
      <div style="position:relative;display:flex;align-items:center">
        <span style="position:absolute;left:8px;color:var(--ink-faint);pointer-events:none">${icons.search}</span>
        <input class="input" id="f-q" placeholder="path, request id, or actor" style="padding-left:28px;width:250px" value="${esc(filters.q)}">
      </div>
      <select class="select" id="f-decision" aria-label="Decision">
        <option value="all">All decisions</option>
        <option value="block">Blocked</option>
        <option value="flag">Flagged</option>
        <option value="allow">Allowed</option>
      </select>
      <select class="select" id="f-method" aria-label="Method">
        <option value="all">All methods</option>
        ${['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].map((m) => `<option>${m}</option>`).join('')}
      </select>
      <select class="select" id="f-service" aria-label="Service">
        <option value="all">All services</option>
        ${services.map((s) => `<option>${esc(s)}</option>`).join('')}
      </select>
      <button class="btn btn-sm btn-ghost" id="f-clear">Clear</button>
      <div class="spacer"></div>
      <span class="filter-count" id="f-count"></span>
    </div>

    <div class="table-wrap">
      <table class="tbl" id="req-tbl">
        <thead><tr>
          <th style="width:82px">Time</th>
          <th style="width:58px">Method</th>
          <th style="max-width:420px">Path</th>
          <th style="width:104px">Service</th>
          <th style="width:128px">Actor</th>
          <th style="width:82px">Policy</th>
          <th style="width:56px" class="num">Status</th>
          <th style="width:72px" class="num">Time</th>
          <th style="width:54px" class="num">Risk</th>
          <th style="width:92px">Decision</th>
        </tr></thead>
        <tbody id="req-body"></tbody>
      </table>
      <div id="req-empty"></div>
    </div>

    <div class="scrim" id="scrim"></div>
    <aside class="drawer" id="drawer" aria-hidden="true" aria-label="Request detail"></aside>
  </div>`;

  const body = host.querySelector('#req-body');
  const emptyHost = host.querySelector('#req-empty');
  const count = host.querySelector('#f-count');

  host.querySelector('#f-decision').value = filters.decision;
  host.querySelector('#f-method').value = filters.method;
  host.querySelector('#f-service').value = filters.service;

  function matching() {
    const q = filters.q.trim().toLowerCase();
    return store.scopedRequests().filter((r) =>
      (filters.decision === 'all' || r.decision === filters.decision) &&
      (filters.method === 'all' || r.method === filters.method) &&
      (filters.service === 'all' || r.service === filters.service) &&
      (!q || r.path.toLowerCase().includes(q) || r.id.includes(q) || r.actor.toLowerCase().includes(q)));
  }

  function paint() {
    const rows = matching();
    const total = store.scopedRequests().length;
    count.textContent = rows.length === total
      ? `${n(total)} requests`
      : `${n(rows.length)} of ${n(total)} requests`;

    if (!rows.length) {
      body.innerHTML = '';
      emptyHost.innerHTML = emptyState(
        'No requests match these filters',
        'Widen the time window in the header, or clear a filter. The log holds every inspected request for the selected environment.',
        '<button class="btn btn-sm" id="e-clear">Clear filters</button>');
      emptyHost.querySelector('#e-clear')?.addEventListener('click', clearAll);
      return;
    }
    emptyHost.innerHTML = '';
    body.innerHTML = rows.slice(0, 120).map(row).join('');
    body.querySelectorAll('tr').forEach((tr) =>
      tr.addEventListener('click', () => openDrawer(tr.dataset.id)));
  }

  function clearAll() {
    filters.q = ''; filters.decision = 'all'; filters.method = 'all'; filters.service = 'all';
    host.querySelector('#f-q').value = '';
    host.querySelector('#f-decision').value = 'all';
    host.querySelector('#f-method').value = 'all';
    host.querySelector('#f-service').value = 'all';
    paint();
  }

  host.querySelector('#f-q').addEventListener('input', (e) => { filters.q = e.target.value; paint(); });
  ['decision', 'method', 'service'].forEach((k) =>
    host.querySelector('#f-' + k).addEventListener('change', (e) => { filters[k] = e.target.value; paint(); }));
  host.querySelector('#f-clear').addEventListener('click', clearAll);

  const drawer = host.querySelector('#drawer');
  const scrim = host.querySelector('#scrim');

  function openDrawer(id) {
    const r = store.scopedRequests().find((x) => x.id === id);
    if (!r) return;
    openId = id;
    drawer.innerHTML = detail(r);
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    scrim.classList.add('on');
    body.querySelectorAll('tr').forEach((tr) =>
      tr.setAttribute('aria-selected', String(tr.dataset.id === id)));

    requestAnimationFrame(() => {
      const meterHost = drawer.querySelector('#d-meter');
      if (meterHost) riskMeter(meterHost, r.risk);
      drawer.querySelectorAll('.factor-fill').forEach((f) => { f.style.width = f.dataset.w + '%'; });
    });

    drawer.querySelector('#d-close')?.addEventListener('click', closeDrawer);
    drawer.querySelector('#d-copy')?.addEventListener('click', (e) =>
      copy(r.id, e.currentTarget.parentElement));
    drawer.querySelectorAll('[data-pol]').forEach((b) =>
      b.addEventListener('click', () => { location.hash = '#/policies?id=' + b.dataset.pol; }));
    drawer.querySelectorAll('[data-find]').forEach((b) =>
      b.addEventListener('click', () => { location.hash = '#/code?finding=' + b.dataset.find; }));
    drawer.querySelector('#d-risk')?.addEventListener('click', () => {
      location.hash = '#/risk?req=' + r.id;
    });
  }

  function closeDrawer() {
    openId = null;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    scrim.classList.remove('on');
    body.querySelectorAll('tr').forEach((tr) => tr.setAttribute('aria-selected', 'false'));
  }

  scrim.addEventListener('click', closeDrawer);
  const onKey = (e) => { if (e.key === 'Escape' && openId) closeDrawer(); };
  document.addEventListener('keydown', onKey);

  paint();
  if (openId) openDrawer(openId);

  return () => document.removeEventListener('keydown', onKey);
}

function prettyPath(p) {
  return esc(p).replace(/(acct_|u_|tnt_|req_)\w+/g, (m) => `<span class="seg-var">${m}</span>`);
}

function row(r) {
  return `<tr data-id="${esc(r.id)}" aria-selected="false">
    <td class="mono meta tnum">${clock(r.t)}</td>
    <td>${verb(r.method)}</td>
    <td class="tbl-path truncate">${prettyPath(r.path)}</td>
    <td class="meta">${esc(r.service)}</td>
    <td class="mono meta truncate">${esc(r.actor)}</td>
    <td class="id">${r.policy ? esc(r.policy) : '<span style="color:var(--ink-faint)">&mdash;</span>'}</td>
    <td class="num mono">${statusCode(r.status)}</td>
    <td class="num mono meta">${ms(r.ms)}</td>
    <td class="num mono">${riskCell(r.risk)}</td>
    <td>${decisionBadge(r.decision)}</td>
  </tr>`;
}

/* Colour is reserved for scores that mean something. A column of green
   single-digit numbers would spend the signal on the 94% of traffic that is
   unremarkable, so baseline risk stays in muted ink. */
function riskCell(v) {
  if (v < 45) return `<span style="color:var(--ink-faint)">${v}</span>`;
  const tone = { critical: 'crit', high: 'high', medium: 'med' }[riskClass(v)];
  return `<span style="color:var(--sev-${tone})">${v}</span>`;
}

function detail(r) {
  const pol = store.get().policies.find((p) => p.id === r.policy);
  const evt = store.events.find((e) => e.requestId === r.id);
  const related = store.get().findings.filter((f) => (f.linked?.requests || []).includes(r.id));
  const maxW = Math.max(...r.factors.map((f) => Math.abs(f.w)), 1);

  return `
  <div class="drawer-hd">
    ${decisionBadge(r.decision)}
    <span class="id">${esc(r.id)}</span>
    <button class="btn btn-sm btn-ghost" id="d-copy" title="Copy request id">${icons.copy}</button>
    <div class="spacer" style="flex:1"></div>
    <button class="btn btn-sm btn-ghost" id="d-close" aria-label="Close">${icons.close}</button>
  </div>

  <div class="drawer-bd">

    <div class="dsec">
      <div style="display:flex;align-items:baseline;gap:9px;margin-bottom:9px;flex-wrap:wrap">
        ${verb(r.method)}
        <span class="mono" style="font-size:13px;color:var(--ink);overflow-wrap:anywhere">${prettyPath(r.path)}</span>
      </div>
      <dl class="kv">
        <dt>Timestamp</dt><dd>${stamp(r.t)}</dd>
        <dt>Environment</dt><dd>${esc(r.env)}</dd>
        <dt>Service</dt><dd>${esc(r.service)}</dd>
        <dt>Actor</dt><dd>${esc(r.actor)} &middot; ${esc(r.actorRef.role)}</dd>
        <dt>Response</dt><dd>${statusCode(r.status)} &middot; ${ms(r.ms)}</dd>
      </dl>
    </div>

    <div class="dsec">
      <span class="label">Risk score</span>
      <div style="display:flex;align-items:baseline;gap:9px;margin-bottom:2px">
        <span style="font-size:30px;font-weight:600;letter-spacing:-.02em;line-height:1">${r.risk}</span>
        <span class="meta">of 100</span>
        <div style="flex:1"></div>
        ${sevBadge(riskClass(r.risk))}
      </div>
      <div id="d-meter"></div>
      <p class="meta" style="margin-top:6px;line-height:1.55">
        ${r.decision === 'allow'
          ? 'Below the review threshold. The request was passed to the service unchanged.'
          : r.decision === 'flag'
          ? 'Above the review threshold but below the block threshold. The request completed and was queued for triage.'
          : 'Above the block threshold. The request was rejected at the guardrail before reaching the service.'}
      </p>
    </div>

    <div class="dsec">
      <span class="label">Contributing factors</span>
      ${r.factors.map((f) => {
        const up = f.w >= 0;
        return `<div class="factor">
          <div class="factor-hd">
            <span class="factor-k">${esc(f.k)}</span>
            <span class="factor-v">${esc(f.v)}</span>
            <span class="factor-w ${up ? 'up' : 'down'}">${up ? '+' : ''}${f.w}</span>
          </div>
          <div class="factor-track">
            <div class="factor-fill" data-w="${Math.round((Math.abs(f.w) / maxW) * 100)}" style="width:0;background:var(--sev-${up ? (Math.abs(f.w) > 25 ? 'crit' : 'med') : 'low'})"></div>
          </div>
          <div class="factor-note">${esc(f.note)}</div>
        </div>`;
      }).join('')}
      <p class="meta" style="margin-top:9px;line-height:1.55">
        Weights are contextual. The same call from a known device inside the actor&rsquo;s
        working window scores differently &mdash; this is the adaptive part of the guardrail,
        not a fixed rule table.
      </p>
    </div>

    ${pol ? `<div class="dsec">
      <span class="label">Policy evaluated</span>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;flex-wrap:wrap">
        <button class="cite" data-pol="${esc(pol.id)}">${esc(pol.id)}</button>
        <span style="font-size:12.5px;color:var(--ink)">${esc(pol.name)}</span>
      </div>
      <p class="meta" style="line-height:1.55">${esc(pol.description)}</p>
    </div>` : ''}

    ${r.body ? `<div class="dsec">
      <span class="label">Request body &middot; inspected</span>
      <div class="payload">${esc(r.body)}</div>
    </div>` : ''}

    <div class="dsec">
      <span class="label">Correlated records</span>
      <div class="chain">
        ${chainStep('Request received', `${r.id} &middot; ${stamp(r.t)}`, true, true)}
        ${chainStep(
          pol ? `Policy ${pol.id} evaluated` : 'Baseline evaluation',
          `risk ${r.risk} &middot; ${r.decision === 'allow' ? 'below threshold' : r.decision === 'flag' ? 'review threshold' : 'block threshold'}`,
          r.decision !== 'allow', true)}
        ${evt ? chainStep('Security event raised', `${evt.id} &middot; ${evt.severity}`, true, related.length > 0) : ''}
        ${related.map((f, i) => chainStep(
          `Linked code finding`,
          `<button class="cite" data-find="${esc(f.id)}">${esc(f.id)}</button> ${esc(f.file)}:${f.line}`,
          f.state === 'open', i < related.length - 1)).join('')}
        ${!evt && !related.length ? chainStep('No follow-up', 'Request completed inside the baseline; nothing queued.', false, false) : ''}
      </div>
    </div>

  </div>

  <div class="drawer-ft">
    <button class="btn btn-sm" id="d-risk">${icons.risk} Risk breakdown</button>
    <div class="spacer" style="flex:1"></div>
    <span class="meta">${relTime(r.t)}</span>
  </div>`;
}

function chainStep(title, meta, on, more) {
  return `<div class="chain-step">
    <div class="chain-rail">
      <span class="chain-node ${on ? 'on' : ''}"></span>
      ${more ? '<span class="chain-line"></span>' : ''}
    </div>
    <div class="chain-b">
      <div class="chain-t">${title}</div>
      <div class="chain-m">${meta}</div>
    </div>
  </div>`;
}
