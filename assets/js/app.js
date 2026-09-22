/* ==========================================================================
   GuardX console shell — rail, top bar, hash router
   ========================================================================== */

import * as store from './store.js';
import { icons, mark } from './icons.js';
import { esc, n, clock } from './ui.js';
import { hideTip } from './charts.js';

import * as overview from './views/overview.js';
import * as code from './views/code.js';
import * as api from './views/api.js';
import * as risk from './views/risk.js';
import * as policies from './views/policies.js';
import * as copilot from './views/copilot.js';
import * as audit from './views/audit.js';

const ROUTES = [
  { id: 'overview', title: 'Overview',      crumb: 'Guardrail activity for the selected window', icon: 'overview', mod: overview, group: 'Monitor' },
  { id: 'api',      title: 'API monitor',   crumb: 'Inspected requests and guardrail decisions', icon: 'api',      mod: api,      group: 'Monitor' },
  { id: 'risk',     title: 'Risk analysis', crumb: 'Score composition and surrounding context',  icon: 'risk',     mod: risk,     group: 'Monitor' },
  { id: 'code',     title: 'Code analyzer', crumb: 'Findings from the latest repository scan',   icon: 'code',     mod: code,     group: 'Analyze' },
  { id: 'policies', title: 'Policies',      crumb: 'Conditions, actions and the test bench',     icon: 'policy',   mod: policies, group: 'Analyze' },
  { id: 'copilot',  title: 'Copilot',       crumb: 'Question the records in this environment',   icon: 'copilot',  mod: copilot,  group: 'Analyze' },
  { id: 'audit',    title: 'Audit log',     crumb: 'Every decision and every human action',      icon: 'audit',    mod: audit,    group: 'Record' },
];

let teardown = null;
let currentId = null;

/* --- shell --------------------------------------------------------------- */

function shell() {
  const groups = [...new Set(ROUTES.map((r) => r.group))];
  document.getElementById('app').innerHTML = `
  <div class="shell">
    <nav class="rail" aria-label="Primary">
      <div class="rail-brand">
        ${mark(19)}
        <span class="wordmark">GuardX</span>
        <span class="env-chip" id="rail-env">prod</span>
      </div>
      <div class="rail-scroll">
        ${groups.map((g) => `
          <div class="nav-group">
            <span class="label">${esc(g)}</span>
            ${ROUTES.filter((r) => r.group === g).map((r) => `
              <a class="nav-item" href="#/${r.id}" data-id="${r.id}">
                ${icons[r.icon]}<span>${esc(r.title)}</span>
                <span class="nav-count" data-count="${r.id}"></span>
              </a>`).join('')}
          </div>`).join('')}
      </div>
      <div class="rail-foot">
        <div class="row"><span class="pulse"></span> Guardrail <b id="foot-state">enforcing</b></div>
        <div class="row">Policies <b id="foot-pol"></b></div>
        <div class="row">Last event <b id="foot-evt"></b></div>
      </div>
    </nav>

    <div class="main">
      <header class="topbar">
        <h1 id="tb-title"></h1>
        <span class="crumb" id="tb-crumb"></span>
        <div class="spacer"></div>
        <label class="sr-only" for="tb-env">Environment</label>
        <select class="select" id="tb-env">
          ${store.tenant.environments.map((e) => `<option value="${esc(e)}">${esc(e)}</option>`).join('')}
        </select>
        <div class="rule"></div>
        <div class="segmented" id="tb-window" role="group" aria-label="Time window">
          ${[1, 6, 24].map((h) => `<button data-h="${h}" aria-pressed="${h === 24}">${h}h</button>`).join('')}
        </div>
      </header>
      <main class="viewport" id="viewport" tabindex="-1"></main>
    </div>
  </div>`;

  document.getElementById('tb-env').value = store.get().env;
  document.getElementById('tb-env').addEventListener('change', (e) => store.setEnv(e.target.value));

  document.querySelectorAll('#tb-window button').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll('#tb-window button').forEach((o) =>
        o.setAttribute('aria-pressed', String(o === b)));
      store.setWindow(Number(b.dataset.h));
    }));
}

function paintChrome() {
  const m = store.metrics();
  const events = store.scopedEvents();

  const counts = {
    overview: '', copilot: '', risk: events.length || '',
    api: m.blocked + m.flagged || '',
    code: m.openFindings || '',
    policies: `${m.activePolicies}/${m.totalPolicies}`,
    audit: '',
  };
  document.querySelectorAll('[data-count]').forEach((el) => {
    const id = el.dataset.count;
    el.textContent = counts[id] === '' ? '' : String(counts[id]);
    el.classList.toggle('urgent', (id === 'api' && m.blocked > 0) || (id === 'code' && m.criticalFindings > 0));
  });

  document.getElementById('rail-env').textContent = store.get().env === 'production' ? 'prod' : 'stg';
  document.getElementById('foot-pol').textContent = `${m.activePolicies}/${m.totalPolicies}`;
  document.getElementById('foot-evt').textContent = events.length ? clock(events[0].t) : '—';
  document.getElementById('foot-state').textContent = m.activePolicies ? 'enforcing' : 'passive';

  document.querySelectorAll('.nav-item').forEach((a) =>
    a.setAttribute('aria-current', a.dataset.id === currentId ? 'page' : 'false'));
}

/* --- routing ------------------------------------------------------------- */

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '') || 'overview';
  const [path, qs] = raw.split('?');
  const ctx = {};
  new URLSearchParams(qs || '').forEach((v, k) => { ctx[k] = v; });
  return { id: ROUTES.some((r) => r.id === path) ? path : 'overview', ctx };
}

function route() {
  const { id, ctx } = parseHash();
  const r = ROUTES.find((x) => x.id === id);
  currentId = id;

  hideTip();
  if (teardown) { try { teardown(); } catch (_) {} teardown = null; }

  document.getElementById('tb-title').textContent = r.title;
  document.getElementById('tb-crumb').textContent = r.crumb;
  document.title = `${r.title} · GuardX`;

  const vp = document.getElementById('viewport');
  vp.scrollTop = 0;
  teardown = r.mod.render(vp, ctx) || null;
  paintChrome();
}

/* Store changes repaint the chrome and the current view together, so a
   resolved finding moves the rail counter and the dashboard in one go. */
store.subscribe(() => {
  const keep = document.getElementById('viewport')?.scrollTop || 0;
  route();
  requestAnimationFrame(() => {
    const vp = document.getElementById('viewport');
    if (vp) vp.scrollTop = keep;
  });
});

window.addEventListener('hashchange', route);

let rafId = null;
window.addEventListener('resize', () => {
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => { if (currentId === 'overview') route(); });
});

/* Keyboard: g then a number jumps between views, the way a console should. */
let gPressed = false;
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === 'g') { gPressed = true; setTimeout(() => { gPressed = false; }, 900); return; }
  if (gPressed && /^[1-7]$/.test(e.key)) {
    location.hash = '#/' + ROUTES[Number(e.key) - 1].id;
    gPressed = false;
  }
});

shell();
route();
