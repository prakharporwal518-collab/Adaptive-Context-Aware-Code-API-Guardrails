/* ==========================================================================
   Overview — what happened in the selected window
   Metric strip, decision volume, activity, riskiest identities, findings.
   Every figure comes from store.metrics() or a store selector.
   ========================================================================== */

import * as store from '../store.js';
import { decisionColumns, severityBars, latencyHistogram, legend } from '../charts.js';
import { esc, n, ms, relTime, clock, sevBadge, decisionBadge, emptyState, riskClass } from '../ui.js';

export function render(host, ctx) {
  const m = store.metrics();
  const buckets = store.hourlyDecisions();
  const sev = store.severityCounts();
  const events = store.scopedEvents();
  const reqs = store.scopedRequests();
  const w = store.get().window;

  host.innerHTML = `
  <div class="ov">
    <div class="ov-col">

      <section class="metrics" aria-label="Guardrail metrics for the last ${w} hours">
        <div class="metric">
          <span class="label">Requests inspected</span>
          <div class="v">${n(m.inspected)}</div>
          <div class="foot">last ${w}h &middot; ${esc(store.get().env)}</div>
        </div>
        <div class="metric ${m.blocked ? 'is-crit' : ''}">
          <span class="label">Blocked</span>
          <div class="v">${n(m.blocked)}<small>${m.blockRate.toFixed(1)}%</small></div>
          <div class="foot">by ${new Set(reqs.filter(r => r.decision === 'block').map(r => r.policy)).size} policies</div>
        </div>
        <div class="metric ${m.flagged ? 'is-warn' : ''}">
          <span class="label">Flagged for review</span>
          <div class="v">${n(m.flagged)}</div>
          <div class="foot">${m.flagged ? 'awaiting triage' : 'queue clear'}</div>
        </div>
        <div class="metric ${m.criticalFindings ? 'is-crit' : ''}">
          <span class="label">Open findings</span>
          <div class="v">${n(m.openFindings)}</div>
          <div class="foot">${m.criticalFindings} critical &middot; ${m.highFindings} high</div>
        </div>
        <div class="metric">
          <span class="label">Decision latency</span>
          <div class="v">${m.overhead}<small>ms avg</small></div>
          <div class="foot">p95 upstream ${ms(m.p95)}</div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-hd">
          <div class="chart-hd">
            <h2>Decision volume</h2>
            <span class="sub">per hour, last ${w}h</span>
          </div>
          <div class="spacer"></div>
          ${legend(['allowed', 'flagged', 'blocked'])}
        </div>
        <div class="panel-bd"><div id="ch-volume"></div></div>
        <details class="tblview">
          <summary>Table view</summary>
          <div class="wrap">
            <table class="tbl">
              <thead><tr><th>Hour</th><th class="num">Allowed</th><th class="num">Flagged</th><th class="num">Blocked</th><th class="num">Total</th></tr></thead>
              <tbody>${buckets.slice().reverse().map((b) => {
                const hh = new Date(Date.now() - b.hoursAgo * 3600_000).getHours();
                return `<tr><td class="mono">${String(hh).padStart(2, '0')}:00</td>
                  <td class="num mono">${b.allowed}</td><td class="num mono">${b.flagged}</td>
                  <td class="num mono">${b.blocked}</td><td class="num mono">${b.total}</td></tr>`;
              }).join('')}</tbody>
            </table>
          </div>
        </details>
      </section>

      <section class="panel">
        <div class="panel-hd">
          <h2>Security events</h2>
          <span class="sub">${events.length} in window</span>
          <div class="spacer"></div>
          <button class="btn btn-sm" data-goto="#/api">Open monitor</button>
        </div>
        <div class="panel-bd flush">
          ${events.length ? `<div class="feed">${events.slice(0, 8).map(eventRow).join('')}</div>`
            : emptyState('No guardrail events',
                `Every request inspected in the last ${w} hours matched its policy baseline. Events appear here the moment a policy blocks or flags a call.`)}
        </div>
      </section>

    </div>

    <div class="ov-col">

      <section class="panel">
        <div class="panel-hd">
          <h2>Open findings</h2>
          <div class="spacer"></div>
          <button class="btn btn-sm" data-goto="#/code">Analyzer</button>
        </div>
        <div class="panel-bd">
          ${m.openFindings
            ? `<div id="ch-sev"></div>
               <div class="hr" style="margin:11px 0 9px"></div>
               <div class="ctx-item"><span class="k">resolved</span><span class="v">${m.resolvedFindings}</span></div>
               <div class="ctx-item"><span class="k">risk accepted</span><span class="v">${m.acceptedFindings}</span></div>`
            : emptyState('Nothing open',
                'All findings from the latest scan are resolved or risk-accepted.')}
        </div>
      </section>

      <section class="panel">
        <div class="panel-hd">
          <h2>Identities under review</h2>
        </div>
        <div class="panel-bd flush">
          ${renderActors()}
        </div>
      </section>

      <section class="panel">
        <div class="panel-hd">
          <h2>Response time</h2>
          <span class="sub">upstream, ${n(reqs.length)} samples</span>
        </div>
        <div class="panel-bd"><div id="ch-lat"></div></div>
      </section>

      <section class="panel">
        <div class="panel-hd"><h2>Latest scan</h2></div>
        <div class="panel-bd">${renderScan()}</div>
      </section>

    </div>
  </div>`;

  /* Charts render after layout so they can measure their container. */
  requestAnimationFrame(() => {
    const v = host.querySelector('#ch-volume');
    if (v) decisionColumns(v, buckets);
    const s = host.querySelector('#ch-sev');
    if (s) severityBars(s, sev);
    const l = host.querySelector('#ch-lat');
    if (l) latencyHistogram(l, reqs.map((r) => r.ms), m.p95);
  });

  host.querySelectorAll('[data-goto]').forEach((b) =>
    b.addEventListener('click', () => { location.hash = b.dataset.goto; }));

  host.querySelectorAll('[data-req]').forEach((r) =>
    r.addEventListener('click', () => { location.hash = '#/api?req=' + r.dataset.req; }));

  return () => {};
}

function eventRow(e) {
  return `<div class="feed-item" data-req="${esc(e.requestId)}" style="cursor:pointer">
    <div class="feed-t">${clock(e.t)}</div>
    <div class="feed-b">
      <div class="feed-title">${esc(e.summary)}</div>
      <div class="feed-meta">
        ${sevBadge(e.severity)} ${decisionBadge(e.decision)}
        <span>${esc(e.requestId)}</span>
        <span>${esc(e.actor)}</span>
        <span>risk ${e.risk}</span>
      </div>
    </div>
  </div>`;
}

function renderActors() {
  const rows = store.actorRisk();
  if (!rows.length) {
    return emptyState('No identities flagged',
      'Nobody tripped a guardrail in this window. Identities appear here once a policy blocks or flags one of their requests.');
  }
  return `<div class="actors">${rows.slice(0, 5).map((a) => `
    <div class="actor-row">
      <div>
        <div class="actor-id">${esc(a.actor)}</div>
        <div class="actor-meta">${esc(a.role)} &middot; ${a.blocked} blocked, ${a.flagged} flagged of ${a.n}</div>
      </div>
      <div class="actor-peak">
        <div class="pv" style="color:var(--sev-${riskClass(a.peak) === 'critical' ? 'crit' : riskClass(a.peak) === 'high' ? 'high' : riskClass(a.peak) === 'medium' ? 'med' : 'low'})">${a.peak}</div>
        <div class="pl">peak risk</div>
      </div>
    </div>`).join('')}</div>`;
}

function renderScan() {
  const s = store.scans[0];
  const open = store.openFindings().filter((f) => f.scan === s.id).length;
  return `<dl class="kv">
    <dt>Scan</dt><dd>${esc(s.id)}</dd>
    <dt>Commit</dt><dd>${esc(s.branch)}@${esc(s.commit)}</dd>
    <dt>Files</dt><dd>${n(s.files)}</dd>
    <dt>Duration</dt><dd>${(s.durationMs / 1000).toFixed(1)}s</dd>
    <dt>Finished</dt><dd>${relTime(s.started)}</dd>
    <dt>Open here</dt><dd>${open}</dd>
  </dl>`;
}
