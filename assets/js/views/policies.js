/* ==========================================================================
   Policy builder — list, conditions, action, and a test bench that really
   evaluates. The bench runs the same condition set the list shows, against a
   request context you can edit, and prints a per-condition trace.
   ========================================================================== */

import * as store from '../store.js';
import { icons } from '../icons.js';
import { esc, n, relTime, stamp, sevBadge, emptyState, flash } from '../ui.js';

let picked = null;
let sample = null;

export function render(host, ctx) {
  const stats = store.policyStats();
  if (ctx?.id) picked = ctx.id;
  if (!picked || !stats.some((p) => p.id === picked)) picked = stats[0]?.id;

  const p = stats.find((x) => x.id === picked);

  host.innerHTML = `
  <div class="policies">

    <div class="pane">
      <div class="pane-hd">
        <span class="label">Policies</span>
        <div class="spacer" style="flex:1"></div>
        <span class="meta">${stats.filter((x) => x.enabled).length}/${stats.length} active</span>
      </div>
      <div class="pane-bd">
        ${stats.map((x) => `
          <div class="pol-row ${x.enabled ? '' : 'off'}" data-id="${esc(x.id)}" aria-selected="${x.id === picked}">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="id">${esc(x.id)}</span>
              ${sevBadge(x.severity)}
            </div>
            <div class="nm">${esc(x.name)}</div>
            <div class="st">
              <span>${x.enabled ? x.action.toUpperCase() : 'DISABLED'}</span>
              <span>&middot;</span>
              <span>${x.hits} hit${x.hits === 1 ? '' : 's'} / ${store.get().window}h</span>
            </div>
          </div>`).join('')}
      </div>
    </div>

    <div class="editor">${p ? editor(p) : emptyState('No policies', 'Create a policy to start evaluating traffic.')}</div>
  </div>`;

  host.querySelectorAll('.pol-row').forEach((el) =>
    el.addEventListener('click', () => { picked = el.dataset.id; sample = null; render(host); }));

  host.querySelector('#p-toggle')?.addEventListener('click', (e) => {
    store.togglePolicy(p.id);
  });

  const ta = host.querySelector('#bench-input');
  const run = host.querySelector('#bench-run');
  const out = host.querySelector('#bench-out');

  if (run && ta) {
    run.addEventListener('click', () => {
      out.innerHTML = '<div class="bench-trace"><span class="no">evaluating…</span></div>';
      /* Deliberate 220ms — the loading state exists because the evaluation is
         a real step, not to fake latency. */
      setTimeout(() => {
        let parsed;
        try { parsed = JSON.parse(ta.value); }
        catch (err) {
          out.innerHTML = `<div class="bench-verdict" style="border-color:rgba(201,111,50,.45);background:rgba(201,111,50,.08)">
            <div class="vv" style="color:var(--sev-high)">INVALID</div>
            <div class="vl">Context is not valid JSON</div></div>
            <div class="bench-trace">${esc(err.message)}</div>`;
          return;
        }
        sample = parsed;
        out.innerHTML = verdict(p, parsed);
      }, 220);
    });

    host.querySelectorAll('[data-sample]').forEach((b) =>
      b.addEventListener('click', () => {
        ta.value = JSON.stringify(sampleFor(p, b.dataset.sample), null, 2);
        run.click();
      }));
  }

  host.querySelectorAll('[data-req]').forEach((b) =>
    b.addEventListener('click', () => { location.hash = '#/api?req=' + b.dataset.req; }));

  return () => {};
}

function editor(p) {
  const hits = store.scopedRequests().filter((r) => r.policy === p.id && r.decision !== 'allow');

  return `
  <section class="panel">
    <div class="panel-hd">
      <span class="id">${esc(p.id)}</span>
      <h2>${esc(p.name)}</h2>
      ${sevBadge(p.severity)}
      <div class="spacer"></div>
      <span class="meta">${p.enabled ? 'Enforcing' : 'Disabled'}</span>
      <button class="toggle" id="p-toggle" role="switch" aria-checked="${p.enabled}" aria-label="Enable policy ${esc(p.id)}"></button>
    </div>
    <div class="panel-bd">
      <p style="font-size:13px;color:var(--ink-secondary);line-height:1.6;max-width:70ch">${esc(p.description)}</p>
      <div class="hr" style="margin:13px 0"></div>
      <dl class="kv">
        <dt>Owner</dt><dd>${esc(p.owner)}</dd>
        <dt>Last updated</dt><dd>${stamp(p.updated)}</dd>
        <dt>Last triggered</dt><dd>${p.lastTriggered ? relTime(p.lastTriggered) : 'not in this window'}</dd>
        <dt>Linked findings</dt><dd>${p.linkedFindings}</dd>
      </dl>
    </div>
  </section>

  <section class="panel">
    <div class="panel-hd"><h2>Conditions</h2>
      <span class="sub">all must hold</span>
      <div class="spacer"></div>
      <span class="meta">evaluated in order</span>
    </div>
    <div class="panel-bd">
      ${p.conditions.map((c, i) => `
        ${i ? `<div class="cond-join">${esc(p.join)}</div>` : ''}
        <div class="cond" role="group" aria-label="Condition ${i + 1}">
          <span class="cond-field" title="${esc(c.field)}">${esc(c.field)}</span>
          <span class="cond-field op">${esc(c.op)}</span>
          <span class="cond-field val" title="${esc(c.value)}">${esc(c.value)}</span>
          <span class="cond-n">${i + 1}</span>
        </div>`).join('')}

      <div class="cond-join" style="margin:11px 0 9px">THEN</div>
      <div class="action-row">
        <span class="label">Action</span>
        <span class="decision decision-${p.action === 'block' ? 'block' : 'flag'}">${p.action.toUpperCase()}</span>
        <span class="meta">${p.action === 'block'
          ? 'Reject with 403 before the request reaches the service'
          : 'Allow through and raise a review event'}</span>
      </div>
      <p class="meta" style="margin-top:10px;line-height:1.55">
        Conditions are shown as stored; editing is disabled in this build. The evaluator below is the
        same one the guardrail runs in-line.
      </p>
    </div>
  </section>

  <section class="panel">
    <div class="panel-hd"><h2>Test bench</h2>
      <span class="sub">evaluate a request context against ${esc(p.id)}</span>
    </div>
    <div class="bench">
      <div class="bench-in">
        <span class="label" style="display:block;margin-bottom:7px">Request context</span>
        <textarea class="input mono" id="bench-input" rows="11" spellcheck="false">${esc(JSON.stringify(sample || sampleFor(p, 'hit'), null, 2))}</textarea>
        <div style="display:flex;gap:7px;margin-top:9px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-sm btn-primary" id="bench-run">${icons.play} Evaluate</button>
          <button class="btn btn-sm" data-sample="hit">Load matching</button>
          <button class="btn btn-sm" data-sample="miss">Load passing</button>
        </div>
      </div>
      <div class="bench-out" id="bench-out">${verdict(p, sample || sampleFor(p, 'hit'))}</div>
    </div>
  </section>

  <section class="panel">
    <div class="panel-hd"><h2>Recent matches</h2>
      <span class="sub">last ${store.get().window}h &middot; ${esc(store.get().env)}</span>
    </div>
    <div class="panel-bd flush">
      ${hits.length ? `<table class="tbl">
        <thead><tr><th>Request</th><th>Path</th><th>Actor</th><th class="num">Risk</th><th>When</th></tr></thead>
        <tbody>${hits.map((r) => `<tr data-req="${esc(r.id)}">
          <td class="id">${esc(r.id)}</td>
          <td class="tbl-path truncate">${esc(r.path)}</td>
          <td class="mono meta">${esc(r.actor)}</td>
          <td class="num mono">${r.risk}</td>
          <td class="meta">${relTime(r.t)}</td>
        </tr>`).join('')}</tbody>
      </table>` : emptyState(
        p.enabled ? 'No matches in this window' : 'Policy is disabled',
        p.enabled
          ? 'Nothing in the selected environment satisfied every condition. Matches appear here as they happen.'
          : 'Re-enable the policy to start evaluating traffic against it again.')}
    </div>
  </section>`;
}

/* --- evaluator ----------------------------------------------------------- */

const dig = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

const LISTS = {
  approved_sinks: ['hooks.northwind.internal', 'hooks.stripe.com', 'events.northwind.io'],
};

function evalCondition(c, ctx) {
  const actual = dig(ctx, c.field);
  const val = String(c.value);
  const list = (s) => (LISTS[s.trim()] || s.split(',').map((x) => x.trim()));

  switch (c.op) {
    case 'regex':       return { pass: new RegExp(val, 'i').test(String(actual ?? '')), actual };
    case 'contains':    return { pass: String(actual ?? '').toLowerCase().includes(val.toLowerCase()), actual };
    case 'starts_with': return { pass: String(actual ?? '').startsWith(val), actual };
    case 'in':          return { pass: list(val).includes(String(actual)), actual };
    case 'not_in':      return { pass: !list(val).includes(String(actual)), actual };
    case '>':           return { pass: Number(actual) > Number(val), actual };
    case '<':           return { pass: Number(actual) < Number(val), actual };
    case '==':          return { pass: String(actual) === String(dig(ctx, val) ?? val), actual };
    case '!=':          return { pass: String(actual) !== String(dig(ctx, val) ?? val), actual };
    default:            return { pass: false, actual };
  }
}

function verdict(p, ctx) {
  const results = p.conditions.map((c) => ({ c, ...evalCondition(c, ctx) }));
  const matched = results.every((r) => r.pass);
  const fires = matched && p.enabled;

  return `
  <div class="bench-verdict ${fires ? 'hit' : 'miss'}">
    <div class="vv" style="color:var(--${fires ? (p.action === 'block' ? 'block' : 'flag') : 'allow'})">
      ${fires ? p.action.toUpperCase() : 'PASS'}
    </div>
    <div class="vl">${fires
      ? `${p.id} fires on this context`
      : matched ? 'Conditions match but the policy is disabled' : 'Conditions not satisfied'}</div>
  </div>
  <div class="bench-trace">
    ${results.map((r, i) => `<div>
      <span class="${r.pass ? 'ok' : 'no'}">${r.pass ? '✓' : '✗'}</span>
      ${esc(r.c.field)} <span class="no">${esc(r.c.op)}</span> ${esc(r.c.value)}
      <br><span class="no" style="padding-left:16px">actual: ${r.actual === undefined ? 'undefined' : esc(String(r.actual))}</span>
    </div>`).join('')}
  </div>
  <p class="meta" style="line-height:1.5">
    ${matched ? 'Every condition held.' : `${results.filter((r) => !r.pass).length} of ${results.length} conditions failed.`}
    Fields not present in the context evaluate as undefined.
  </p>`;
}

/* Sample contexts are derived from real logged requests where one exists, so
   "Load matching" shows a shape the guardrail has actually seen. */
function sampleFor(p, kind) {
  const real = store.requests.find((r) => r.policy === p.id && (kind === 'hit' ? r.decision !== 'allow' : r.decision === 'allow'));
  const base = {
    request: { method: real?.method || 'POST' },
    endpoint: { path: real?.path || '/v2/example', class: 'reporting', sensitivity: 'tier-2' },
    actor: { id: 'u_7731', role: real?.actorRef.role || 'engineer' },
    session: { auth_age_s: 41, device: 'known' },
    payload: { classification: 'none', matches: '', entropy: 2.1 },
    destination: { host: 'hooks.northwind.internal' },
    object: { tenant_id: 'tnt_1120' },
    token: { tenant_id: 'tnt_1120' },
    rate: { zscore: 0.4 },
    ci: { source: 'branch', org_member: 'true' },
  };

  if (kind === 'miss') return base;

  /* Bend the base context until it satisfies this policy's conditions. */
  const hit = structuredClone(base);
  switch (p.id) {
    case 'POL-003':
      hit.payload.matches = "status = 'open' UNION SELECT token FROM api_credentials --";
      hit.endpoint.class = 'reporting';
      break;
    case 'POL-007':
      hit.endpoint.path = '/v2/ledger/entries/8841/reverse';
      hit.request.method = 'POST';
      hit.session.auth_age_s = 742;
      hit.session.device = 'unrecognised';
      break;
    case 'POL-014':
      hit.payload.classification = 'pii:email,pii:tax_id';
      hit.destination.host = 'hooks.unverified-partner.io';
      break;
    case 'POL-018':
      hit.endpoint.path = '/v2/secrets/stripe/live_key';
      hit.actor.role = 'contractor';
      break;
    case 'POL-022':
      hit.endpoint.path = '/v2/exports/transactions';
      hit.rate.zscore = 4.2;
      break;
    case 'POL-031':
      hit.object.tenant_id = 'tnt_3391';
      break;
    case 'POL-040':
      hit.ci.source = 'fork';
      hit.ci.org_member = 'false';
      break;
  }
  return hit;
}
