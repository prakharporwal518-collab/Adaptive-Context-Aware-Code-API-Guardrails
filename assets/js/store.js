/* ==========================================================================
   GuardX store
   --------------------------------------------------------------------------
   Holds the mutable slice of the demo (finding lifecycle, policy enablement)
   and derives every aggregate the UI renders. Views never compute their own
   totals — they read from here, so resolving a finding moves the dashboard,
   the severity chart, the file tree counts and the audit log in one pass.
   ========================================================================== */

import { requests, events, findings, policies, scans, tenant, actors } from './data.js';

const listeners = new Set();

const state = {
  env: 'production',
  window: 24,                       // hours
  findings: findings.map((f) => ({ ...f })),
  policies: policies.map((p) => ({ ...p })),
  /* Entries appended by user action during the session. Seeded history lives
     in seedAudit() below so the log is never empty on first load. */
  auditExtra: [],
};

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((fn) => fn()); }

export const get = () => state;

export function setEnv(env) { state.env = env; emit(); }
export function setWindow(h) { state.window = h; emit(); }

/* --- mutations ----------------------------------------------------------- */

export function resolveFinding(id, by = 'you') {
  const f = state.findings.find((x) => x.id === id);
  if (!f || f.state === 'resolved') return;
  f.state = 'resolved';
  f.resolvedBy = by;
  f.resolvedAt = Date.now();
  f.resolvedIn = 'working-tree';
  pushAudit({ action: 'finding.resolved', actor: by, target: f.id,
    detail: `${f.severity.toUpperCase()} · ${f.file}:${f.line}` });
  emit();
}

export function reopenFinding(id, by = 'you') {
  const f = state.findings.find((x) => x.id === id);
  if (!f || f.state === 'open') return;
  const was = f.state;
  f.state = 'open';
  delete f.resolvedBy; delete f.resolvedAt; delete f.resolvedIn;
  pushAudit({ action: 'finding.reopened', actor: by, target: f.id,
    detail: `previously ${was}` });
  emit();
}

export function acceptFinding(id, note, by = 'you') {
  const f = state.findings.find((x) => x.id === id);
  if (!f || f.state === 'accepted') return;
  f.state = 'accepted';
  f.acceptedBy = by;
  f.acceptedAt = Date.now();
  f.acceptedNote = note || 'Accepted without a note.';
  pushAudit({ action: 'finding.risk_accepted', actor: by, target: f.id, detail: f.acceptedNote });
  emit();
}

export function togglePolicy(id, by = 'you') {
  const p = state.policies.find((x) => x.id === id);
  if (!p) return;
  p.enabled = !p.enabled;
  p.updated = Date.now();
  pushAudit({ action: p.enabled ? 'policy.enabled' : 'policy.disabled', actor: by,
    target: p.id, detail: p.name });
  emit();
}

function pushAudit(entry) {
  state.auditExtra.unshift({ t: Date.now(), env: state.env, ...entry });
}
export { pushAudit };

/* --- selectors ----------------------------------------------------------- */

const inWindow = (t, hours) => t >= Date.now() - hours * 3_600_000;

export function scopedRequests() {
  return requests.filter((r) => r.env === state.env && inWindow(r.t, state.window));
}

export function scopedEvents() {
  const ids = new Set(scopedRequests().map((r) => r.id));
  return events.filter((e) => ids.has(e.requestId));
}

export const openFindings = () => state.findings.filter((f) => f.state === 'open');

/* Headline metrics. Every tile on the overview reads one of these. */
export function metrics() {
  const reqs = scopedRequests();
  const blocked = reqs.filter((r) => r.decision === 'block');
  const flagged = reqs.filter((r) => r.decision === 'flag');
  const open = openFindings();
  const latencies = reqs.map((r) => r.ms).sort((a, b) => a - b);
  const p95 = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] : 0;

  /* Guardrail overhead is the decision cost, not the upstream service time:
     only inspected-and-stopped requests are measured. */
  const stopped = [...blocked, ...flagged.filter((r) => r.ms < 100)];
  const overhead = stopped.length
    ? Math.round((stopped.reduce((s, r) => s + r.ms, 0) / stopped.length) * 10) / 10
    : 0;

  return {
    inspected: reqs.length,
    blocked: blocked.length,
    flagged: flagged.length,
    allowed: reqs.length - blocked.length - flagged.length,
    openFindings: open.length,
    criticalFindings: open.filter((f) => f.severity === 'critical').length,
    highFindings: open.filter((f) => f.severity === 'high').length,
    resolvedFindings: state.findings.filter((f) => f.state === 'resolved').length,
    acceptedFindings: state.findings.filter((f) => f.state === 'accepted').length,
    activePolicies: state.policies.filter((p) => p.enabled).length,
    totalPolicies: state.policies.length,
    p95,
    overhead,
    blockRate: reqs.length ? (blocked.length / reqs.length) * 100 : 0,
  };
}

/* Hourly decision buckets for the volume chart. Oldest bucket first. */
export function hourlyDecisions() {
  const buckets = Array.from({ length: state.window }, (_, i) => ({
    hoursAgo: state.window - 1 - i, allowed: 0, flagged: 0, blocked: 0, total: 0,
  }));
  for (const r of scopedRequests()) {
    const h = Math.floor((Date.now() - r.t) / 3_600_000);
    const b = buckets[state.window - 1 - h];
    if (!b) continue;
    b[r.decision === 'block' ? 'blocked' : r.decision === 'flag' ? 'flagged' : 'allowed']++;
    b.total++;
  }
  return buckets;
}

/* Open findings by severity, ordered low -> critical. */
export function severityCounts() {
  const order = ['critical', 'high', 'medium', 'low'];
  const open = openFindings();
  return order.map((s) => ({ severity: s, count: open.filter((f) => f.severity === s).length }));
}

/* Policy hit counts are counted from the request log, never stored. */
export function policyStats() {
  const reqs = scopedRequests();
  return state.policies.map((p) => {
    const hits = reqs.filter((r) => r.policy === p.id && r.decision !== 'allow');
    const last = hits[0];
    return {
      ...p,
      hits: hits.length,
      blocks: hits.filter((r) => r.decision === 'block').length,
      lastTriggered: last ? last.t : null,
      linkedFindings: state.findings.filter((f) => f.linked?.policy === p.id).length,
    };
  });
}

/* Per-file finding counts for the repository tree. */
export function fileFindings(path) {
  return state.findings.filter((f) => f.file === path);
}

/* Riskiest identities in the window — drives the overview's actor panel. */
export function actorRisk() {
  const reqs = scopedRequests();
  const map = new Map();
  for (const r of reqs) {
    const cur = map.get(r.actor) || { actor: r.actor, role: r.actorRef.role, n: 0, blocked: 0, flagged: 0, peak: 0 };
    cur.n++;
    if (r.decision === 'block') cur.blocked++;
    if (r.decision === 'flag') cur.flagged++;
    cur.peak = Math.max(cur.peak, r.risk);
    map.set(r.actor, cur);
  }
  return [...map.values()]
    .filter((a) => a.blocked + a.flagged > 0)
    .sort((a, b) => b.peak - a.peak || b.blocked - a.blocked);
}

/* Audit log — seeded history plus anything done this session. */
function seedAudit() {
  /* Floored to the minute so seeded entries line up with the request log. */
  const ago = (m) => Math.floor(Date.now() / 60_000) * 60_000 - m * 60_000;
  const fromEvents = scopedEvents().slice(0, 10).map((e) => ({
    t: e.t, env: state.env, actor: e.actor,
    action: e.decision === 'block' ? 'guardrail.blocked' : 'guardrail.flagged',
    target: e.requestId, detail: `${e.policy ?? '—'} · risk ${e.risk}`,
  }));
  const fromScans = scans.map((s) => ({
    t: s.started, env: 'production', actor: 'guardx-scanner',
    action: 'scan.completed', target: s.id,
    detail: `${s.branch}@${s.commit} · ${s.files.toLocaleString()} files · ${Math.round(s.durationMs / 1000)}s`,
  }));
  const authored = [
    { t: ago(268), env: 'production', actor: 'r.okonkwo', action: 'finding.resolved', target: 'GX-SECRET-011', detail: 'Fixed in 9e2a1c7 · credential rotated' },
    { t: ago(272), env: 'production', actor: 'r.okonkwo', action: 'secret.rotated', target: 'stripe/live_key', detail: 'Rotation confirmed; previous key revoked' },
    { t: ago(1440 * 2 + 15), env: 'production', actor: 's.alvarez', action: 'policy.updated', target: 'POL-022', detail: 'Threshold changed from fixed 50k rows to 3σ of per-actor baseline' },
    { t: ago(1440 * 3 + 92), env: 'production', actor: 'l.fabbri', action: 'policy.created', target: 'POL-007', detail: 'Step-up auth for ledger mutations' },
    { t: ago(1440 * 4), env: 'staging', actor: 's.alvarez', action: 'finding.risk_accepted', target: 'GX-CORS-001', detail: 'Staging-only config; re-review 2026-12-01' },
    { t: ago(1440 * 5 + 30), env: 'production', actor: 's.alvarez', action: 'policy.disabled', target: 'POL-040', detail: 'Paused while the fork allow-list is rebuilt' },
  ];
  return [...fromEvents, ...fromScans, ...authored];
}

export function auditLog() {
  return [...state.auditExtra, ...seedAudit()].sort((a, b) => b.t - a.t);
}

export { requests, events, policies, scans, tenant, actors };
