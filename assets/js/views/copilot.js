/* ==========================================================================
   Copilot — conversation, tool-call trace, security context sidebar
   --------------------------------------------------------------------------
   Answers are composed from the live store, not canned text: ask about
   blocked traffic and the reply counts the same rows the monitor shows. The
   tool trace names which selector produced the answer, so the reply is
   auditable rather than oracular.
   ========================================================================== */

import * as store from '../store.js';
import { icons } from '../icons.js';
import { esc, n, ms, relTime, riskClass, sevBadge } from '../ui.js';

let thread = null;

export function render(host, ctx) {
  if (!thread) thread = [seedAnswer()];

  host.innerHTML = `
  <div class="copilot">
    <div class="chat">
      <div class="chat-scroll" id="chat-scroll">
        <div class="chat-thread" id="thread"></div>
      </div>
      <div class="composer">
        <div class="composer-in">
          <label class="sr-only" for="ask">Ask about this environment</label>
          <textarea id="ask" placeholder="Ask about a request, a finding, or a policy — e.g. why was req_9f4c21a8 blocked?"></textarea>
          <div class="composer-ft">
            <div class="suggest">
              <button data-q="Why was req_9f4c21a8 blocked?">Why was req_9f4c21a8 blocked?</button>
              <button data-q="What is riskiest right now?">What is riskiest right now?</button>
              <button data-q="Summarise the open critical findings">Open criticals</button>
            </div>
            <div style="flex:1"></div>
            <button class="btn btn-sm btn-primary" id="send">Send</button>
          </div>
          <p class="meta" style="font-size:11.5px">
            Scoped to ${esc(store.get().env)} &middot; last ${store.get().window}h. The assistant reads the same
            records the console shows and cannot act on them.
          </p>
        </div>
      </div>
    </div>

    <aside class="ctx" aria-label="Security context">
      ${contextPanel()}
    </aside>
  </div>`;

  const threadEl = host.querySelector('#thread');
  const scroll = host.querySelector('#chat-scroll');
  const ask = host.querySelector('#ask');

  const paint = () => {
    threadEl.innerHTML = thread.map(msg).join('');
    threadEl.querySelectorAll('[data-req]').forEach((b) =>
      b.addEventListener('click', () => { location.hash = '#/api?req=' + b.dataset.req; }));
    threadEl.querySelectorAll('[data-find]').forEach((b) =>
      b.addEventListener('click', () => { location.hash = '#/code?finding=' + b.dataset.find; }));
    threadEl.querySelectorAll('[data-pol]').forEach((b) =>
      b.addEventListener('click', () => { location.hash = '#/policies?id=' + b.dataset.pol; }));
    scroll.scrollTop = scroll.scrollHeight;
  };
  paint();

  function send(text) {
    const q = (text ?? ask.value).trim();
    if (!q) return;
    ask.value = '';
    thread.push({ role: 'user', body: `<p>${esc(q)}</p>` });
    thread.push({ role: 'assistant', pending: true });
    paint();

    setTimeout(() => {
      thread[thread.length - 1] = { role: 'assistant', ...answer(q) };
      paint();
    }, 560);
  }

  host.querySelector('#send').addEventListener('click', () => send());
  host.querySelectorAll('.suggest button').forEach((b) =>
    b.addEventListener('click', () => send(b.dataset.q)));
  ask.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
  });

  return () => {};
}

function msg(m) {
  if (m.pending) {
    return `<div class="msg"><div class="msg-who">GX</div>
      <div class="msg-b"><div class="thinking"><i></i><i></i><i></i></div></div></div>`;
  }
  return `<div class="msg ${m.role === 'user' ? 'msg-user' : ''}">
    <div class="msg-who">${m.role === 'user' ? 'You' : 'GX'}</div>
    <div class="msg-b">${m.trace ? traceBlock(m.trace) : ''}${m.body}</div>
  </div>`;
}

function traceBlock(rows) {
  return `<div class="trace">${rows.map((r) => `
    <div class="trace-row"><span class="ok">${icons.check}</span>
      <b>${esc(r.tool)}</b><span>${esc(r.arg)}</span>
      <span class="ms">${r.ms}ms</span></div>`).join('')}</div>`;
}

/* --- answers ------------------------------------------------------------- */

function seedAnswer() {
  const m = store.metrics();
  const w = store.get().window;
  return {
    role: 'assistant',
    trace: [
      { tool: 'metrics', arg: `env=${store.get().env} window=${w}h`, ms: 14 },
      { tool: 'scopedEvents', arg: 'decision != allow', ms: 21 },
    ],
    body: `<p>Scoped to <strong>${esc(store.get().env)}</strong>, last ${w} hours.
      ${n(m.inspected)} requests inspected, <strong>${m.blocked} blocked</strong> and
      ${m.flagged} flagged for review. ${m.openFindings} findings are open in
      <code class="inline">${esc(store.tenant.repo)}</code>, ${m.criticalFindings} of them critical.</p>
      <p>Ask about any request id, finding id or policy id and I will pull the record.</p>`,
  };
}

function answer(q) {
  const s = q.toLowerCase();

  /* A request id in the question wins over anything else. */
  const reqMatch = q.match(/req_[0-9a-f]+/i);
  if (reqMatch) {
    const r = store.requests.find((x) => x.id === reqMatch[0]);
    if (r) return explainRequest(r);
    return {
      trace: [{ tool: 'requests.find', arg: reqMatch[0], ms: 9 }],
      body: `<p>No request with id <code class="inline">${esc(reqMatch[0])}</code> in the
        retained log. Ids are retained for 30 days; older calls are available in the
        exported audit stream.</p>`,
    };
  }

  const findMatch = q.match(/GX-[A-Z]+-\d+/i);
  if (findMatch) {
    const f = store.get().findings.find((x) => x.id.toLowerCase() === findMatch[0].toLowerCase());
    if (f) return explainFinding(f);
  }

  const polMatch = q.match(/POL-\d+/i);
  if (polMatch) {
    const p = store.policyStats().find((x) => x.id.toLowerCase() === polMatch[0].toLowerCase());
    if (p) return explainPolicy(p);
  }

  if (/riskiest|highest risk|worst|most risk/.test(s)) return riskiest();
  if (/critical|open finding|vulnerab/.test(s)) return criticals();
  if (/blocked|block rate|how many/.test(s)) return blockedSummary();
  if (/polic/.test(s)) return policySummary();

  return {
    trace: [{ tool: 'index.search', arg: q.slice(0, 40), ms: 18 }],
    body: `<p>I can answer from the records this console holds: request ids
      (<code class="inline">req_…</code>), findings (<code class="inline">GX-…</code>),
      policies (<code class="inline">POL-…</code>), or summaries of blocked traffic,
      open findings and identity risk for the selected window.</p>
      <p>Try &ldquo;why was req_9f4c21a8 blocked?&rdquo; or &ldquo;summarise POL-007&rdquo;.</p>`,
  };
}

function explainRequest(r) {
  const pol = store.get().policies.find((p) => p.id === r.policy);
  const top = r.factors.slice().sort((a, b) => b.w - a.w).slice(0, 3);
  const related = store.get().findings.filter((f) => (f.linked?.requests || []).includes(r.id));

  return {
    trace: [
      { tool: 'requests.find', arg: r.id, ms: 8 },
      { tool: 'policy.evaluate', arg: r.policy || 'baseline', ms: 16 },
      { tool: 'findings.linked', arg: r.id, ms: 11 },
    ],
    body: `<p><strong>${r.method} ${esc(r.path)}</strong> was
      ${r.decision === 'block' ? '<strong>blocked</strong>' : r.decision === 'flag' ? 'allowed but flagged' : 'allowed'}
      at ${relTime(r.t)} with a composite risk of <strong>${r.risk}/100</strong>
      ${pol ? `under ${cite('pol', pol.id)} &mdash; ${esc(pol.name)}` : 'on baseline deviation alone'}.</p>
      <p>The three heaviest contributors were:</p>
      <p>${top.map((f) => `&bull; <code class="inline">${esc(f.k)} = ${esc(f.v)}</code> (+${f.w}) &mdash; ${esc(f.note)}`).join('<br>')}</p>
      <p>${r.decision === 'block'
        ? `The service never saw the call; the guardrail returned ${r.status} in ${ms(r.ms)}.`
        : `The call completed in ${ms(r.ms)} with ${r.status}.`}
      ${related.length ? `This correlates with ${related.map((f) => cite('find', f.id)).join(' and ')} in the code analyzer.` : ''}</p>
      <p>${cite('req', r.id)}</p>`,
  };
}

function explainFinding(f) {
  return {
    trace: [
      { tool: 'findings.get', arg: f.id, ms: 7 },
      { tool: 'reachability', arg: f.file, ms: 34 },
    ],
    body: `<p><strong>${esc(f.title)}</strong> &mdash; ${esc(f.severity)}, ${esc(f.cwe)},
      <code class="inline">${esc(f.file)}:${f.line}</code>, currently ${esc(f.state)}.</p>
      <p>${esc(f.why)}</p>
      <p>${f.linked?.policy ? `Runtime counterpart: ${cite('pol', f.linked.policy)}. ` : ''}
      ${(f.linked?.requests || []).length ? `Seen in traffic as ${f.linked.requests.map((r) => cite('req', r)).join(', ')}.` : ''}</p>
      <p>${cite('find', f.id)}</p>`,
  };
}

function explainPolicy(p) {
  return {
    trace: [
      { tool: 'policies.get', arg: p.id, ms: 6 },
      { tool: 'requests.byPolicy', arg: `${p.id} window=${store.get().window}h`, ms: 19 },
    ],
    body: `<p><strong>${esc(p.id)} &mdash; ${esc(p.name)}</strong>
      (${p.enabled ? `enforcing, action <code class="inline">${esc(p.action)}</code>` : 'currently disabled'}).</p>
      <p>${esc(p.description)}</p>
      <p>It matched <strong>${p.hits}</strong> request${p.hits === 1 ? '' : 's'} in the last
      ${store.get().window} hours${p.blocks ? `, rejecting ${p.blocks}` : ''}.
      ${p.lastTriggered ? `Last fired ${relTime(p.lastTriggered)}.` : ''}</p>
      <p>${cite('pol', p.id)}</p>`,
  };
}

function riskiest() {
  const rows = store.actorRisk().slice(0, 3);
  const top = store.scopedEvents()[0];
  return {
    trace: [
      { tool: 'actorRisk', arg: `window=${store.get().window}h`, ms: 23 },
      { tool: 'scopedEvents', arg: 'order by risk desc', ms: 12 },
    ],
    body: rows.length
      ? `<p>By peak score, the identities worth looking at are:</p>
         <p>${rows.map((a) => `&bull; <strong>${esc(a.actor)}</strong> (${esc(a.role)}) &mdash; peak ${a.peak}, ${a.blocked} blocked and ${a.flagged} flagged of ${a.n} calls`).join('<br>')}</p>
         <p>The single highest-scoring event is ${cite('req', top.requestId)} at risk ${top.risk}${top.policy ? ` under ${cite('pol', top.policy)}` : ''}.</p>`
      : `<p>Nothing crossed the review threshold in this window. No identity has a
         blocked or flagged call in ${esc(store.get().env)}.</p>`,
  };
}

function criticals() {
  const open = store.openFindings().filter((f) => f.severity === 'critical' || f.severity === 'high');
  return {
    trace: [{ tool: 'findings.open', arg: 'severity in (critical, high)', ms: 10 }],
    body: open.length
      ? `<p>${open.length} open at critical or high in <code class="inline">${esc(store.tenant.repo)}</code>:</p>
         <p>${open.map((f) => `&bull; ${cite('find', f.id)} <strong>${esc(f.severity)}</strong> &mdash; ${esc(f.title)} (<code class="inline">${esc(f.file)}:${f.line}</code>)`).join('<br>')}</p>
         <p>${open.filter((f) => f.linked?.requests?.length).length} of these have matching runtime traffic, which is the set I would fix first.</p>`
      : `<p>Nothing open at critical or high. ${store.metrics().resolvedFindings} resolved,
         ${store.metrics().acceptedFindings} risk-accepted.</p>`,
  };
}

function blockedSummary() {
  const m = store.metrics();
  const byPolicy = {};
  store.scopedRequests().filter((r) => r.decision === 'block')
    .forEach((r) => { byPolicy[r.policy] = (byPolicy[r.policy] || 0) + 1; });

  return {
    trace: [
      { tool: 'metrics', arg: `window=${store.get().window}h`, ms: 13 },
      { tool: 'groupBy', arg: 'decision=block by policy', ms: 15 },
    ],
    body: `<p><strong>${m.blocked}</strong> of ${n(m.inspected)} inspected requests were blocked
      (${m.blockRate.toFixed(1)}%), and ${m.flagged} more were flagged for review.</p>
      <p>${Object.entries(byPolicy).map(([p, c]) => `&bull; ${cite('pol', p)} &mdash; ${c} block${c === 1 ? '' : 's'}`).join('<br>')}</p>
      <p>Mean decision latency on stopped calls was ${m.overhead}ms.</p>`,
  };
}

function policySummary() {
  const stats = store.policyStats();
  const active = stats.filter((p) => p.enabled);
  const idle = active.filter((p) => p.hits === 0);
  return {
    trace: [{ tool: 'policyStats', arg: `window=${store.get().window}h`, ms: 17 }],
    body: `<p>${active.length} of ${stats.length} policies are enforcing.
      ${stats.length - active.length ? `${stats.length - active.length} disabled: ${stats.filter((p) => !p.enabled).map((p) => cite('pol', p.id)).join(', ')}.` : ''}</p>
      <p>${active.filter((p) => p.hits).map((p) => `&bull; ${cite('pol', p.id)} &mdash; ${p.hits} hit${p.hits === 1 ? '' : 's'}`).join('<br>') || 'No policy matched traffic in this window.'}</p>
      ${idle.length ? `<p>${idle.length} enforcing ${idle.length === 1 ? 'policy has' : 'policies have'} no matches in this window, which is expected for narrow rules.</p>` : ''}`,
  };
}

const cite = (kind, id) =>
  `<button class="cite" data-${kind === 'req' ? 'req' : kind === 'find' ? 'find' : 'pol'}="${esc(id)}">${esc(id)}</button>`;

/* --- context sidebar ----------------------------------------------------- */

function contextPanel() {
  const m = store.metrics();
  const evts = store.scopedEvents().slice(0, 4);
  const sc = store.scans[0];

  return `
  <div class="ctx-sec">
    <span class="label">Scope</span>
    <div class="ctx-item"><span class="k">environment</span><span class="v">${esc(store.get().env)}</span></div>
    <div class="ctx-item"><span class="k">window</span><span class="v">${store.get().window}h</span></div>
    <div class="ctx-item"><span class="k">repository</span><span class="v">${esc(sc.repo.split('/')[1])}</span></div>
    <div class="ctx-item"><span class="k">revision</span><span class="v">${esc(sc.branch)}@${esc(sc.commit)}</span></div>
  </div>
  <div class="ctx-sec">
    <span class="label">Records in context</span>
    <div class="ctx-item"><span class="k">requests</span><span class="v">${n(m.inspected)}</span></div>
    <div class="ctx-item"><span class="k">security events</span><span class="v">${m.blocked + m.flagged}</span></div>
    <div class="ctx-item"><span class="k">open findings</span><span class="v">${m.openFindings}</span></div>
    <div class="ctx-item"><span class="k">policies</span><span class="v">${m.activePolicies}/${m.totalPolicies}</span></div>
  </div>
  <div class="ctx-sec">
    <span class="label">Latest events</span>
    ${evts.length ? evts.map((e) => `
      <div style="padding:6px 0;border-bottom:1px solid var(--line-soft)">
        <div style="display:flex;gap:7px;align-items:center;margin-bottom:3px">
          ${sevBadge(e.severity)}<span class="meta mono" style="margin-left:auto">${esc(e.requestId)}</span>
        </div>
        <div style="font-size:12px;color:var(--ink-muted);line-height:1.45">${esc(e.summary)}</div>
      </div>`).join('')
      : '<p class="meta">No events in the selected window.</p>'}
  </div>
  <div class="ctx-sec">
    <span class="label">Limits</span>
    <p class="meta" style="line-height:1.55">
      Read-only. The assistant can pull records and explain a decision; it cannot
      change a policy, resolve a finding or replay a request.
    </p>
  </div>`;
}
