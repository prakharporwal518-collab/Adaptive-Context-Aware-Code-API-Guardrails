/* ==========================================================================
   Risk analysis — score, contributing factors, context timeline
   The point of this view is the third column of the story: not just what
   scored high, but what the same identity was doing around it.
   ========================================================================== */

import * as store from '../store.js';
import { riskMeter } from '../charts.js';
import {
  esc, n, ms, clock, stamp, relTime, verb, sevBadge, decisionBadge,
  riskClass, emptyState,
} from '../ui.js';

let picked = null;

export function render(host, ctx) {
  const events = store.scopedEvents();
  if (ctx?.req) picked = ctx.req;
  if (!picked || !events.some((e) => e.requestId === picked)) {
    picked = events[0]?.requestId || null;
  }

  if (!picked) {
    host.innerHTML = `<div style="padding:16px">${emptyState(
      'No scored events in this window',
      'Risk breakdowns are generated for requests that cross the review threshold. Widen the window in the header to look further back.')}</div>`;
    return () => {};
  }

  const r = store.scopedRequests().find((x) => x.id === picked);
  const evt = events.find((e) => e.requestId === picked);
  const pol = store.get().policies.find((p) => p.id === r.policy);
  const maxW = Math.max(...r.factors.map((f) => Math.abs(f.w)), 1);
  const tone = riskClass(r.risk);
  const toneVar = { critical: 'crit', high: 'high', medium: 'med', low: 'low' }[tone];

  /* Everything this identity did in the window, newest first. */
  const context = store.scopedRequests()
    .filter((x) => x.actor === r.actor)
    .slice(0, 14);

  host.innerHTML = `
  <div class="riskview">

    <div class="pane">
      <div class="pane-hd"><span class="label">Scored events</span>
        <div class="spacer" style="flex:1"></div>
        <span class="meta">${events.length}</span>
      </div>
      <div class="pane-bd">
        ${events.map((e) => {
          const rr = store.scopedRequests().find((x) => x.id === e.requestId);
          return `<div class="find-row" data-id="${esc(e.requestId)}" aria-selected="${e.requestId === picked}">
            <div class="find-hd">${sevBadge(e.severity)}<span class="rid">${esc(e.requestId)}</span></div>
            <div class="find-title">${verb(rr.method)} <span class="mono" style="font-size:12px">${esc(rr.path)}</span></div>
            <div class="find-loc">${esc(e.actor)} &middot; risk ${e.risk} &middot; ${relTime(e.t)}</div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="pane" style="overflow:auto">
      <div class="pane-hd">
        <span class="mono" style="font-size:12.5px;color:var(--ink)">${esc(r.id)}</span>
        <div class="spacer" style="flex:1"></div>
        ${decisionBadge(r.decision)}
        <button class="btn btn-sm" id="to-req">Open in monitor</button>
      </div>

      <div class="pane-bd">
        <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0;border-bottom:1px solid var(--line-soft)">

          <div class="risk-hero" style="border-bottom:0;border-right:1px solid var(--line-soft)">
            <span class="label">Composite risk</span>
            <div class="risk-score" style="color:var(--sev-${toneVar});margin-top:6px">${r.risk}<small> / 100</small></div>
            <div style="margin-top:10px;max-width:280px" id="r-meter"></div>
            <p class="risk-caption">
              ${verb(r.method)} <span class="mono">${esc(r.path)}</span><br>
              ${esc(r.actor)} &middot; ${esc(r.actorRef.role)} &middot; ${stamp(r.t)}
            </p>
          </div>

          <div class="risk-hero" style="border-bottom:0">
            <span class="label">How the score was reached</span>
            <p class="risk-caption" style="margin-top:8px">
              ${pol ? `<b style="color:var(--ink-secondary)">${esc(pol.id)}</b> &mdash; ${esc(pol.name)}.` : 'No named policy matched; the score came from baseline deviation alone.'}
            </p>
            <p class="risk-caption">
              ${r.decision === 'block'
                ? `The composite score crossed the block threshold (70), so the guardrail returned ${r.status} without forwarding the call.`
                : r.decision === 'flag'
                ? `The score sits between the review (45) and block (70) thresholds. The call completed and a triage event was raised.`
                : 'The score stayed below the review threshold (45).'}
            </p>
            <p class="risk-caption">
              Baseline for comparison: this identity averaged
              <b style="color:var(--ink-secondary)">${baselineFor(r)}</b> over the preceding window.
            </p>
          </div>
        </div>

        <div style="padding:14px 16px;border-bottom:1px solid var(--line-soft)">
          <span class="label" style="display:block;margin-bottom:9px">Contributing factors</span>
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
        </div>

        <div style="padding:14px 0 6px">
          <span class="label" style="display:block;padding:0 16px 10px">
            Context &middot; ${esc(r.actor)} in this window
          </span>
          <div class="timeline">
            ${context.map((x, i) => `
              <div class="tl-item">
                <div class="tl-t">${clock(x.t)}</div>
                <div class="tl-rail">
                  <span class="tl-dot ${x.decision === 'block' ? 'block' : x.decision === 'flag' ? 'flag' : ''}"></span>
                  ${i < context.length - 1 ? '<span class="tl-line"></span>' : ''}
                </div>
                <div class="tl-b">
                  <div class="tl-title" ${x.id === r.id ? 'style="color:var(--ink);font-weight:500"' : ''}>
                    ${verb(x.method)} <span class="mono" style="font-size:12px">${esc(x.path)}</span>
                    ${x.id === r.id ? '<span class="chip" style="margin-left:6px">this request</span>' : ''}
                  </div>
                  <div class="tl-meta">${x.status} &middot; ${ms(x.ms)} &middot; risk ${x.risk}${x.policy ? ' &middot; ' + esc(x.policy) : ''}</div>
                </div>
              </div>`).join('')}
          </div>
          ${context.length < 2 ? `<p class="meta" style="padding:0 16px 12px">No other activity from this identity in the selected window.</p>` : ''}
        </div>
      </div>
    </div>
  </div>`;

  requestAnimationFrame(() => {
    const mh = host.querySelector('#r-meter');
    if (mh) riskMeter(mh, r.risk);
    host.querySelectorAll('.factor-fill').forEach((f) => { f.style.width = f.dataset.w + '%'; });
  });

  host.querySelectorAll('.find-row').forEach((el) =>
    el.addEventListener('click', () => { picked = el.dataset.id; render(host); }));
  host.querySelector('#to-req')?.addEventListener('click', () => {
    location.hash = '#/api?req=' + r.id;
  });

  return () => {};
}

/* Average risk for the same actor+path earlier in the window — the number the
   current score is being compared against. */
function baselineFor(r) {
  const peers = store.scopedRequests()
    .filter((x) => x.actor === r.actor && x.path === r.path && x.id !== r.id);
  if (!peers.length) {
    const byActor = store.scopedRequests().filter((x) => x.actor === r.actor && x.id !== r.id);
    if (!byActor.length) return 'no prior traffic';
    return Math.round(byActor.reduce((s, x) => s + x.risk, 0) / byActor.length) +
      ' across all endpoints';
  }
  return Math.round(peers.reduce((s, x) => s + x.risk, 0) / peers.length);
}
