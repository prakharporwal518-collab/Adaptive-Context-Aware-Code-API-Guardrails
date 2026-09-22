/* ==========================================================================
   GuardX demo dataset
   --------------------------------------------------------------------------
   One dataset. Every number anywhere in the console is derived from the
   arrays below — nothing is hardcoded into a view. If a request is BLOCKED
   here, the matching security event, the policy hit counter, the risk score
   and the audit entry all read from this same record.

   Timestamps are generated relative to load time so the demo always reads as
   "now", but all offsets are fixed, so two reloads tell the same story.
   ========================================================================== */

/* Deterministic PRNG — background traffic must be reproducible. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0x47555831); // "GUX1"

const MIN = 60_000, HOUR = 60 * MIN;
const NOW = Math.floor(Date.now() / MIN) * MIN;
const ago = (m) => NOW - m * MIN;

/* --------------------------------------------------------------------------
   Tenant / environment
   -------------------------------------------------------------------------- */

export const tenant = {
  org: 'northwind-labs',
  environments: ['production', 'staging'],
  repo: 'northwind-labs/ledger-platform',
  branch: 'main',
};

export const actors = [
  { id: 'u_4812', name: 'r.okonkwo',   role: 'engineer',        team: 'payments'  },
  { id: 'u_2290', name: 'l.fabbri',    role: 'engineer',        team: 'identity'  },
  { id: 'u_7731', name: 'd.mehta',     role: 'contractor',      team: 'payments'  },
  { id: 'u_1043', name: 's.alvarez',   role: 'sre',             team: 'platform'  },
  { id: 'u_5567', name: 'j.park',      role: 'support-agent',   team: 'success'   },
  { id: 'svc_ci', name: 'svc/ci-runner', role: 'service-account', team: 'platform'  },
  { id: 'svc_rp', name: 'svc/reporting', role: 'service-account', team: 'analytics' },
];
const actorBy = (name) => actors.find((a) => a.name === name);

/* --------------------------------------------------------------------------
   Policies
   `hits` is never stored — it is counted from the request log below.
   -------------------------------------------------------------------------- */

export const policies = [
  {
    id: 'POL-003', name: 'Deny raw SQL passthrough', enabled: true,
    action: 'block', severity: 'critical', owner: 'platform-security',
    updated: ago(60 * 24 * 9),
    description:
      'Any request body carrying an executable SQL fragment to a non-admin endpoint is rejected before it reaches the service.',
    conditions: [
      { field: 'payload.matches', op: 'regex', value: '\\b(UNION|SELECT|DROP|;--)\\b' },
      { field: 'endpoint.class', op: 'not_in', value: 'admin, migration' },
    ],
    join: 'AND',
  },
  {
    id: 'POL-007', name: 'Step-up auth for ledger mutations', enabled: true,
    action: 'block', severity: 'high', owner: 'payments',
    updated: ago(60 * 24 * 3),
    description:
      'Mutating a posted ledger entry requires an auth assertion no older than 5 minutes. Context-aware: the window tightens to 60s when the session device is unrecognised.',
    conditions: [
      { field: 'endpoint.path', op: 'starts_with', value: '/v2/ledger/entries' },
      { field: 'request.method', op: 'in', value: 'POST, PATCH, DELETE' },
      { field: 'session.auth_age_s', op: '>', value: '300' },
    ],
    join: 'AND',
  },
  {
    id: 'POL-014', name: 'Block PII egress to unapproved sinks', enabled: true,
    action: 'block', severity: 'critical', owner: 'platform-security',
    updated: ago(60 * 24 * 12),
    description:
      'Outbound payloads classified as containing PII may only target destinations on the approved sink list.',
    conditions: [
      { field: 'payload.classification', op: 'contains', value: 'pii' },
      { field: 'destination.host', op: 'not_in', value: 'approved_sinks' },
    ],
    join: 'AND',
  },
  {
    id: 'POL-018', name: 'Restrict secret reads to CI identities', enabled: true,
    action: 'block', severity: 'high', owner: 'platform',
    updated: ago(60 * 24 * 21),
    description:
      'Reads against the secret store are limited to service accounts holding the ci-runner role.',
    conditions: [
      { field: 'endpoint.path', op: 'starts_with', value: '/v2/secrets' },
      { field: 'actor.role', op: 'not_in', value: 'service-account' },
    ],
    join: 'AND',
  },
  {
    id: 'POL-022', name: 'Throttle bulk export by role', enabled: true,
    action: 'flag', severity: 'medium', owner: 'analytics',
    updated: ago(60 * 24 * 2),
    description:
      'Export volume is scored against the actor’s own 30-day baseline rather than a fixed ceiling. Deviation beyond 3σ raises a review event.',
    conditions: [
      { field: 'endpoint.path', op: 'starts_with', value: '/v2/exports' },
      { field: 'rate.zscore', op: '>', value: '3.0' },
    ],
    join: 'AND',
  },
  {
    id: 'POL-031', name: 'Flag cross-tenant object access', enabled: true,
    action: 'flag', severity: 'high', owner: 'platform-security',
    updated: ago(60 * 24 * 5),
    description:
      'Raises an event when the tenant id in the resolved object does not match the tenant claim on the caller’s token.',
    conditions: [
      { field: 'object.tenant_id', op: '!=', value: 'token.tenant_id' },
    ],
    join: 'AND',
  },
  {
    id: 'POL-040', name: 'Quarantine untrusted fork builds', enabled: false,
    action: 'block', severity: 'medium', owner: 'platform',
    updated: ago(60 * 24 * 34),
    description:
      'Blocks CI jobs originating from forks outside the organisation from reaching the artefact registry. Disabled while the fork allow-list is rebuilt.',
    conditions: [
      { field: 'ci.source', op: '==', value: 'fork' },
      { field: 'ci.org_member', op: '==', value: 'false' },
    ],
    join: 'AND',
  },
];

/* --------------------------------------------------------------------------
   API request log
   Authored records first — these are the ones with a story. Background
   traffic is generated afterwards so the 24h volume chart has a real shape.
   -------------------------------------------------------------------------- */

const authored = [
  {
    id: 'req_9f4c21a8', t: ago(4), method: 'POST', path: '/v2/ledger/entries/8841/reverse',
    service: 'ledger', env: 'production', actor: 'd.mehta', status: 403, ms: 12,
    decision: 'block', risk: 91, policy: 'POL-007',
    factors: [
      { k: 'session.auth_age_s', v: '742', w: 26, note: 'Assertion older than the 60s window applied to unrecognised devices' },
      { k: 'session.device', v: 'unrecognised', w: 22, note: 'First observation of this device fingerprint for u_7731' },
      { k: 'actor.role', v: 'contractor', w: 19, note: 'Role has no standing grant on posted ledger entries' },
      { k: 'endpoint.sensitivity', v: 'tier-1', w: 16, note: 'Reversal mutates a settled financial record' },
      { k: 'time.local', v: '02:47 +05:30', w: 8, note: 'Outside the actor’s observed working window' },
    ],
    body: '{ "entry_id": 8841, "reason": "duplicate", "actor_note": "manual reversal" }',
  },
  {
    id: 'req_7b10dd35', t: ago(19), method: 'POST', path: '/v2/reports/query',
    service: 'analytics', env: 'production', actor: 'j.park', status: 403, ms: 8,
    decision: 'block', risk: 96, policy: 'POL-003',
    factors: [
      { k: 'payload.matches', v: 'UNION SELECT', w: 44, note: 'Executable SQL fragment in a templated filter field' },
      { k: 'endpoint.class', v: 'reporting', w: 18, note: 'Endpoint is not on the admin/migration exemption list' },
      { k: 'actor.role', v: 'support-agent', w: 21, note: 'Role never issues parameterised query overrides' },
      { k: 'payload.entropy', v: '5.1', w: 9, note: 'Field entropy inconsistent with prior values for this field' },
    ],
    body: '{ "filter": "status = \'open\' UNION SELECT token FROM api_credentials --" }',
  },
  {
    id: 'req_3d88ef02', t: ago(37), method: 'GET', path: '/v2/secrets/stripe/live_key',
    service: 'identity', env: 'production', actor: 'd.mehta', status: 403, ms: 6,
    decision: 'block', risk: 88, policy: 'POL-018',
    factors: [
      { k: 'actor.role', v: 'contractor', w: 34, note: 'Secret store reads are limited to service-account identities' },
      { k: 'secret.tier', v: 'live-credential', w: 27, note: 'Path resolves to a production payment credential' },
      { k: 'actor.first_access', v: 'true', w: 15, note: 'No prior read of this secret path by this identity' },
      { k: 'time.local', v: '02:51 +05:30', w: 12, note: 'Outside the actor’s observed working window' },
    ],
    body: null,
  },
  {
    id: 'req_c052aa71', t: ago(52), method: 'POST', path: '/v2/webhooks/dispatch',
    service: 'notifications', env: 'production', actor: 'svc/reporting', status: 403, ms: 14,
    decision: 'block', risk: 84, policy: 'POL-014',
    factors: [
      { k: 'payload.classification', v: 'pii:email,pii:tax_id', w: 38, note: '412 records carrying tax identifiers' },
      { k: 'destination.host', v: 'hooks.unverified-partner.io', w: 30, note: 'Destination absent from the approved sink list' },
      { k: 'payload.size', v: '1.8 MB', w: 11, note: 'Roughly 40x the median dispatch size for this integration' },
    ],
    body: '{ "sink": "https://hooks.unverified-partner.io/ingest", "records": 412 }',
  },
  {
    id: 'req_18ba4490', t: ago(71), method: 'GET', path: '/v2/exports/transactions',
    service: 'analytics', env: 'production', actor: 'j.park', status: 200, ms: 2140,
    decision: 'flag', risk: 63, policy: 'POL-022',
    factors: [
      { k: 'rate.zscore', v: '4.2', w: 30, note: '9 exports in 12 minutes against a 30-day baseline of 2 per day' },
      { k: 'result.rows', v: '186,400', w: 20, note: 'Full-table extract rather than the usual scoped range' },
      { k: 'actor.role', v: 'support-agent', w: 13, note: 'Role’s typical export is a single-account statement' },
    ],
    body: null,
  },
  {
    id: 'req_a41f6b7d', t: ago(96), method: 'GET', path: '/v2/accounts/tnt_3391/statements',
    service: 'ledger', env: 'production', actor: 'l.fabbri', status: 200, ms: 184,
    decision: 'flag', risk: 58, policy: 'POL-031',
    factors: [
      { k: 'object.tenant_id', v: 'tnt_3391', w: 32, note: 'Token carries tnt_1120; resolved object belongs to another tenant' },
      { k: 'endpoint.sensitivity', v: 'tier-2', w: 14, note: 'Statement bodies include counterparty names' },
      { k: 'actor.support_ticket', v: 'absent', w: 12, note: 'No linked ticket justifying cross-tenant read' },
    ],
    body: null,
  },
  {
    id: 'req_6e2200fc', t: ago(128), method: 'DELETE', path: '/v2/ledger/entries/7712',
    service: 'ledger', env: 'production', actor: 'r.okonkwo', status: 403, ms: 9,
    decision: 'block', risk: 79, policy: 'POL-007',
    factors: [
      { k: 'session.auth_age_s', v: '1,904', w: 30, note: 'Assertion well past the 300s window for tier-1 endpoints' },
      { k: 'request.method', v: 'DELETE', w: 24, note: 'Destructive verb against a settled entry' },
      { k: 'endpoint.sensitivity', v: 'tier-1', w: 16, note: 'Entry is referenced by a closed reconciliation batch' },
    ],
    body: null,
  },
  {
    id: 'req_0cd7715e', t: ago(163), method: 'POST', path: '/v2/exports/ledger',
    service: 'analytics', env: 'production', actor: 'svc/reporting', status: 200, ms: 4820,
    decision: 'flag', risk: 47, policy: 'POL-022',
    factors: [
      { k: 'rate.zscore', v: '3.1', w: 22, note: 'Scheduled run fired twice after a retry storm' },
      { k: 'actor.role', v: 'service-account', w: -10, note: 'Established batch identity with a stable 90-day pattern' },
      { k: 'result.rows', v: '41,880', w: 11, note: 'Within one standard deviation of the nightly baseline' },
    ],
    body: '{ "range": "2026-09-01..2026-09-21", "format": "parquet" }',
  },
  {
    id: 'req_be934102', t: ago(214), method: 'PATCH', path: '/v2/identity/users/u_5567/roles',
    service: 'identity', env: 'production', actor: 's.alvarez', status: 200, ms: 96,
    decision: 'flag', risk: 54, policy: 'POL-031',
    factors: [
      { k: 'privilege.delta', v: '+export:bulk', w: 26, note: 'Grant widens an account that already tripped POL-022 today' },
      { k: 'actor.role', v: 'sre', w: 12, note: 'SRE holds break-glass grant capability' },
      { k: 'approval.ref', v: 'absent', w: 16, note: 'No change ticket linked to the grant' },
    ],
    body: '{ "add": ["export:bulk"], "expires_in": 86400 }',
  },
  {
    id: 'req_45c1093b', t: ago(287), method: 'POST', path: '/v2/reports/query',
    service: 'analytics', env: 'staging', actor: 'd.mehta', status: 403, ms: 7,
    decision: 'block', risk: 73, policy: 'POL-003',
    factors: [
      { k: 'payload.matches', v: 'DROP TABLE', w: 40, note: 'Destructive DDL fragment in a filter field' },
      { k: 'env', v: 'staging', w: -14, note: 'Non-production blast radius' },
      { k: 'actor.role', v: 'contractor', w: 18, note: 'Third consecutive rejected payload from this identity' },
    ],
    body: '{ "filter": "1=1; DROP TABLE sessions --" }',
  },
  {
    id: 'req_d7710ac4', t: ago(352), method: 'GET', path: '/v2/secrets/datadog/api_key',
    service: 'identity', env: 'production', actor: 'svc/ci-runner', status: 200, ms: 11,
    decision: 'allow', risk: 14, policy: 'POL-018',
    factors: [
      { k: 'actor.role', v: 'service-account', w: -20, note: 'ci-runner is on the permitted identity list' },
      { k: 'ci.workflow', v: 'release.yml', w: -8, note: 'Read originates from a pinned workflow on a protected branch' },
      { k: 'secret.tier', v: 'observability', w: 6, note: 'Non-payment credential' },
    ],
    body: null,
  },
  {
    id: 'req_2fa80b6c', t: ago(418), method: 'POST', path: '/v2/webhooks/dispatch',
    service: 'notifications', env: 'production', actor: 'svc/reporting', status: 200, ms: 132,
    decision: 'allow', risk: 9, policy: 'POL-014',
    factors: [
      { k: 'destination.host', v: 'hooks.northwind.internal', w: -22, note: 'Approved internal sink' },
      { k: 'payload.classification', v: 'pii:email', w: 14, note: 'PII present but destination is permitted' },
    ],
    body: '{ "sink": "https://hooks.northwind.internal/ingest", "records": 38 }',
  },
  {
    id: 'req_8804ce19', t: ago(503), method: 'POST', path: '/v2/ledger/entries',
    service: 'ledger', env: 'production', actor: 'r.okonkwo', status: 201, ms: 78,
    decision: 'allow', risk: 11, policy: 'POL-007',
    factors: [
      { k: 'session.auth_age_s', v: '41', w: -18, note: 'Fresh step-up assertion' },
      { k: 'session.device', v: 'known', w: -10, note: 'Device seen on 214 prior sessions' },
    ],
    body: '{ "amount_minor": 249900, "currency": "EUR", "account": "acct_7781" }',
  },
  {
    id: 'req_51e09d73', t: ago(612), method: 'GET', path: '/v2/accounts/tnt_1120/statements',
    service: 'ledger', env: 'production', actor: 'l.fabbri', status: 200, ms: 141,
    decision: 'allow', risk: 6, policy: 'POL-031',
    factors: [{ k: 'object.tenant_id', v: 'tnt_1120', w: -24, note: 'Matches the tenant claim on the caller token' }],
    body: null,
  },
  {
    id: 'req_ff2a6810', t: ago(740), method: 'POST', path: '/v2/webhooks/dispatch',
    service: 'notifications', env: 'production', actor: 'svc/reporting', status: 403, ms: 16,
    decision: 'block', risk: 81, policy: 'POL-014',
    factors: [
      { k: 'payload.classification', v: 'pii:tax_id', w: 36, note: 'Tax identifiers in an unencrypted field' },
      { k: 'destination.host', v: 'hooks.unverified-partner.io', w: 30, note: 'Same unapproved sink as req_c052aa71' },
      { k: 'retry.count', v: '3', w: 12, note: 'Third attempt after two rejections' },
    ],
    body: '{ "sink": "https://hooks.unverified-partner.io/ingest", "records": 96 }',
  },
  {
    id: 'req_93bb4e5a', t: ago(881), method: 'GET', path: '/v2/exports/transactions',
    service: 'analytics', env: 'production', actor: 'j.park', status: 200, ms: 1980,
    decision: 'flag', risk: 51, policy: 'POL-022',
    factors: [
      { k: 'rate.zscore', v: '3.4', w: 24, note: 'Export cadence climbing through the shift' },
      { k: 'result.rows', v: '44,120', w: 14, note: 'Scoped extract, but broad for this role' },
    ],
    body: null,
  },
  {
    id: 'req_1a7c60d2', t: ago(1004), method: 'POST', path: '/v2/ledger/entries/6620/reverse',
    service: 'ledger', env: 'production', actor: 'd.mehta', status: 403, ms: 10,
    decision: 'block', risk: 86, policy: 'POL-007',
    factors: [
      { k: 'session.auth_age_s', v: '611', w: 28, note: 'Stale assertion on an unrecognised device' },
      { k: 'actor.role', v: 'contractor', w: 20, note: 'No standing grant on reversals' },
      { k: 'endpoint.sensitivity', v: 'tier-1', w: 16, note: 'Settled entry inside a closed batch' },
      { k: 'actor.recent_blocks', v: '2', w: 14, note: 'Two prior guardrail rejections in the last 6 hours' },
    ],
    body: '{ "entry_id": 6620, "reason": "customer request" }',
  },
  {
    id: 'req_74d3b8e0', t: ago(1188), method: 'GET', path: '/v2/identity/users',
    service: 'identity', env: 'production', actor: 's.alvarez', status: 200, ms: 64,
    decision: 'allow', risk: 8, policy: null,
    factors: [{ k: 'actor.role', v: 'sre', w: -12, note: 'Routine directory read within baseline' }],
    body: null,
  },
];

/* Background traffic. Shapes the 24h volume chart; every record is a real row
   in the API monitor, not a chart-only number. */
/* Each endpoint lists the identities that plausibly call it, so the log does
   not show a support agent posting ledger entries. */
const bgPaths = [
  ['GET',   '/v2/accounts/:id/balance',    'ledger',        200, ['r.okonkwo', 'j.park', 'l.fabbri']],
  ['GET',   '/v2/identity/session',        'identity',      200, ['r.okonkwo', 'l.fabbri', 'j.park', 's.alvarez', 'd.mehta']],
  ['POST',  '/v2/ledger/entries',          'ledger',        201, ['r.okonkwo', 'l.fabbri']],
  ['GET',   '/v2/reports/summary',         'analytics',     200, ['svc/reporting', 'j.park', 's.alvarez']],
  ['POST',  '/v2/webhooks/dispatch',       'notifications', 200, ['svc/reporting', 'svc/ci-runner']],
  ['GET',   '/v2/accounts/:id/statements', 'ledger',        200, ['j.park', 'l.fabbri', 'r.okonkwo']],
  ['PATCH', '/v2/identity/users/:id',      'identity',      200, ['s.alvarez', 'l.fabbri']],
  ['GET',   '/v2/exports/transactions',    'analytics',     200, ['svc/reporting', 'j.park']],
  ['GET',   '/v2/identity/session',        'identity',      401, ['d.mehta', 'j.park']],
  ['POST',  '/v2/reports/query',           'analytics',     200, ['svc/reporting', 's.alvarez', 'l.fabbri']],
];
/* Diurnal weight per hour-ago bucket: business hours carry more traffic. */
const diurnal = [9, 8, 8, 7, 6, 6, 5, 4, 3, 2, 2, 2, 3, 4, 6, 8, 9, 10, 10, 9, 8, 7, 6, 5];

const background = [];
let bgSeq = 0;
for (let h = 0; h < 24; h++) {
  const n = diurnal[h] + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const [method, rawPath, service, baseStatus, callers] = bgPaths[Math.floor(rnd() * bgPaths.length)];
    const minutes = h * 60 + Math.floor(rnd() * 60);
    const acct = 1000 + Math.floor(rnd() * 8999);
    const path = rawPath.replace('/:id', '/' + (service === 'identity' ? 'u_' : 'acct_') + acct);
    const actor = callers[Math.floor(rnd() * callers.length)];
    const risk = Math.floor(rnd() * 18);
    background.push({
      id: 'req_' + (0x10000000 + Math.floor(rnd() * 0xefffffff)).toString(16).slice(0, 8) + (bgSeq++).toString(16),
      t: ago(minutes), method, path, service, env: 'production', actor,
      status: baseStatus, ms: 20 + Math.floor(rnd() * 260),
      decision: 'allow', risk, policy: null,
      factors: [{ k: 'baseline.match', v: 'true', w: -risk, note: 'Consistent with the 30-day behavioural baseline for this identity' }],
      body: null,
    });
  }
}

export const requests = [...authored, ...background]
  .sort((a, b) => b.t - a.t)
  .map((r) => ({ ...r, actorRef: actorBy(r.actor) || { name: r.actor, role: 'unknown' } }));

/* Security events are a projection of the request log, not a parallel list. */
export const events = requests
  .filter((r) => r.decision !== 'allow')
  .map((r) => ({
    id: 'evt_' + r.id.slice(4),
    requestId: r.id,
    t: r.t,
    severity: r.risk >= 85 ? 'critical' : r.risk >= 70 ? 'high' : r.risk >= 45 ? 'medium' : 'low',
    decision: r.decision,
    policy: r.policy,
    risk: r.risk,
    actor: r.actor,
    summary:
      r.decision === 'block'
        ? `${policies.find((p) => p.id === r.policy)?.name ?? 'Guardrail'} rejected ${r.method} ${r.path}`
        : `${policies.find((p) => p.id === r.policy)?.name ?? 'Guardrail'} raised review on ${r.method} ${r.path}`,
  }));

/* --------------------------------------------------------------------------
   Code analysis — repository tree, scans, findings
   -------------------------------------------------------------------------- */

export const scans = [
  { id: 'scan_0d41ab', repo: tenant.repo, branch: 'main', commit: '9e2a1c7', started: ago(23), durationMs: 41800, files: 1284, trigger: 'push' },
  { id: 'scan_0d3f92', repo: tenant.repo, branch: 'main', commit: '4b7f0d1', started: ago(311), durationMs: 39240, files: 1281, trigger: 'push' },
  { id: 'scan_0d3c07', repo: tenant.repo, branch: 'fix/webhook-retry', commit: 'c10e88a', started: ago(602), durationMs: 12100, files: 46, trigger: 'pull_request' },
];

export const findings = [
  {
    id: 'GX-SQLI-002', rule: 'sql-injection/string-concat', cwe: 'CWE-89',
    severity: 'critical', state: 'open', file: 'src/ledger/query.ts', line: 148,
    scan: 'scan_0d41ab', introduced: 'a71c39d', owner: 'payments',
    title: 'Query built by concatenating a request-controlled filter',
    why: 'The filter string arrives from POST /v2/reports/query and reaches the driver without parameterisation. GuardX rates this critical rather than high because the route is reachable by the support-agent role, which has no other database access — the same path POL-003 rejected twice today at the API layer, once in production and once in staging.',
    linked: { requests: ['req_7b10dd35', 'req_45c1093b'], policy: 'POL-003' },
    snippet: [
      [144, "export async function runReport(filter: string, tenantId: string) {"],
      [145, "  const conn = await pool.acquire();"],
      [146, ""],
      [147, "  // filter is passed straight through from the report builder UI"],
      [148, "  const sql = `SELECT * FROM transactions WHERE tenant = '${tenantId}' AND ${filter}`;"],
      [149, ""],
      [150, "  return conn.query(sql);"],
      [151, "}"],
    ],
    hot: 148,
    fix: [
      ['-', "  const sql = `SELECT * FROM transactions WHERE tenant = '${tenantId}' AND ${filter}`;"],
      ['-', "  return conn.query(sql);"],
      ['+', "  const clause = compileFilter(filter); // validates against the column allow-list"],
      ['+', "  return conn.query('SELECT * FROM transactions WHERE tenant = $1 AND ' + clause.sql,"],
      ['+', "                    [tenantId, ...clause.params]);"],
    ],
  },
  {
    id: 'GX-RAND-002', rule: 'crypto/insecure-randomness', cwe: 'CWE-338',
    severity: 'critical', state: 'open', file: 'src/auth/reset.ts', line: 19,
    scan: 'scan_0d41ab', introduced: '2f0b84e', owner: 'identity',
    title: 'Password reset token derived from Math.random()',
    why: 'Math.random() is seeded from a predictable source in V8 and is not a CSPRNG. Because the token is the sole factor in the reset flow, an attacker who observes one token can narrow the search space for others issued in the same tick.',
    linked: { requests: [], policy: null },
    snippet: [
      [16, "export function issueResetToken(userId: string) {"],
      [17, "  const ttl = 15 * 60 * 1000;"],
      [18, ""],
      [19, "  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);"],
      [20, ""],
      [21, "  return store.put({ userId, token, expiresAt: Date.now() + ttl });"],
      [22, "}"],
    ],
    hot: 19,
    fix: [
      ['-', "  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);"],
      ['+', "  const token = crypto.randomBytes(32).toString('base64url');"],
    ],
  },
  {
    id: 'GX-AUTHZ-004', rule: 'authz/missing-tenant-scope', cwe: 'CWE-639',
    severity: 'high', state: 'open', file: 'src/api/routes/exports.ts', line: 67,
    scan: 'scan_0d41ab', introduced: '6d9e412', owner: 'analytics',
    title: 'Export query omits the tenant predicate',
    why: 'The handler trusts the account id in the path without checking it against the tenant claim on the token. This is the code-level counterpart to the cross-tenant reads POL-031 flagged at runtime today.',
    linked: { requests: ['req_a41f6b7d'], policy: 'POL-031' },
    snippet: [
      [63, "router.get('/v2/exports/transactions', requireAuth, async (req, res) => {"],
      [64, "  const { accountId, from, to } = req.query;"],
      [65, ""],
      [66, "  // TODO(6d9e412): scope to req.auth.tenantId"],
      [67, "  const rows = await ledger.transactions({ accountId, from, to });"],
      [68, ""],
      [69, "  res.json({ rows });"],
      [70, "});"],
    ],
    hot: 67,
    fix: [
      ['-', "  const rows = await ledger.transactions({ accountId, from, to });"],
      ['+', "  const rows = await ledger.transactions({"],
      ['+', "    accountId, from, to, tenantId: req.auth.tenantId,"],
      ['+', "  });"],
    ],
  },
  {
    id: 'GX-SSRF-001', rule: 'ssrf/unvalidated-outbound-url', cwe: 'CWE-918',
    severity: 'high', state: 'open', file: 'src/integrations/webhook.ts', line: 88,
    scan: 'scan_0d41ab', introduced: '8814fc0', owner: 'notifications',
    title: 'Outbound fetch target taken from the request body',
    why: 'The sink URL is caller-controlled and is not checked against the approved sink list before the request leaves the network. POL-014 is currently catching this at the egress boundary, but the code path itself is unguarded.',
    linked: { requests: ['req_c052aa71', 'req_ff2a6810'], policy: 'POL-014' },
    snippet: [
      [85, "export async function dispatch(payload: Payload, sink: string) {"],
      [86, "  const body = JSON.stringify(payload);"],
      [87, ""],
      [88, "  const res = await fetch(sink, { method: 'POST', body });"],
      [89, ""],
      [90, "  return { status: res.status, sink };"],
      [91, "}"],
    ],
    hot: 88,
    fix: [
      ['-', "  const res = await fetch(sink, { method: 'POST', body });"],
      ['+', "  if (!approvedSinks.has(new URL(sink).host)) {"],
      ['+', "    throw new SinkNotApprovedError(sink);"],
      ['+', "  }"],
      ['+', "  const res = await fetch(sink, { method: 'POST', body });"],
    ],
  },
  {
    id: 'GX-PATH-006', rule: 'path-traversal/unresolved-join', cwe: 'CWE-22',
    severity: 'high', state: 'open', file: 'src/storage/local.ts', line: 29,
    scan: 'scan_0d41ab', introduced: 'b02aa18', owner: 'platform',
    title: 'User-supplied key joined onto the storage root',
    why: 'path.join collapses ../ segments, so a key of ../../etc/passwd escapes the storage root. The route is authenticated, which is why this is high rather than critical.',
    linked: { requests: [], policy: null },
    snippet: [
      [26, "export function read(key: string) {"],
      [27, "  const root = config.storage.root;"],
      [28, ""],
      [29, "  return fs.readFileSync(path.join(root, key));"],
      [30, "}"],
    ],
    hot: 29,
    fix: [
      ['-', "  return fs.readFileSync(path.join(root, key));"],
      ['+', "  const resolved = path.resolve(root, key);"],
      ['+', "  if (!resolved.startsWith(root + path.sep)) throw new InvalidKeyError(key);"],
      ['+', "  return fs.readFileSync(resolved);"],
    ],
  },
  {
    id: 'GX-SECRET-011', rule: 'secrets/hardcoded-credential', cwe: 'CWE-798',
    severity: 'high', state: 'resolved', file: 'src/integrations/stripeClient.ts', line: 23,
    scan: 'scan_0d3f92', introduced: '1c40a77', owner: 'payments',
    resolvedBy: 'r.okonkwo', resolvedAt: ago(268), resolvedIn: '9e2a1c7',
    title: 'Live payment key committed to source',
    why: 'A live-mode Stripe secret key was present in the client constructor. The credential was rotated before the fix landed; GuardX verified the old key no longer authenticates.',
    linked: { requests: ['req_3d88ef02'], policy: 'POL-018' },
    snippet: [
      [21, "const client = new Stripe(", ],
      [22, "  process.env.STRIPE_KEY ??"],
      [23, "    'sk_live_51H8xQ2Kp...redacted...', // fallback for local dev"],
      [24, ");"],
    ],
    hot: 23,
    fix: [
      ['-', "  process.env.STRIPE_KEY ?? 'sk_live_51H8xQ2Kp...redacted...',"],
      ['+', "  requireEnv('STRIPE_KEY'),"],
    ],
  },
  {
    id: 'GX-CRYPTO-009', rule: 'crypto/weak-hash', cwe: 'CWE-327',
    severity: 'medium', state: 'open', file: 'src/auth/token.ts', line: 41,
    scan: 'scan_0d41ab', introduced: '5510e2b', owner: 'identity',
    title: 'SHA-1 used to derive a session lookup key',
    why: 'SHA-1 is collision-prone but the value is a lookup key, not an authenticator, and it is salted per session. Rated medium on that basis rather than high.',
    linked: { requests: [], policy: null },
    snippet: [
      [39, "export function lookupKey(sessionId: string, salt: string) {"],
      [40, ""],
      [41, "  return crypto.createHash('sha1').update(sessionId + salt).digest('hex');"],
      [42, "}"],
    ],
    hot: 41,
    fix: [
      ['-', "  return crypto.createHash('sha1').update(sessionId + salt).digest('hex');"],
      ['+', "  return crypto.createHash('sha256').update(sessionId + salt).digest('hex');"],
    ],
  },
  {
    id: 'GX-LOG-015', rule: 'logging/pii-in-log', cwe: 'CWE-532',
    severity: 'medium', state: 'open', file: 'src/api/middleware/audit.ts', line: 52,
    scan: 'scan_0d41ab', introduced: 'd9017c4', owner: 'platform',
    title: 'Full request body written to the application log',
    why: 'Bodies on /v2/identity routes carry email and tax identifiers, and application logs ship to a third-party aggregator with a 400-day retention.',
    linked: { requests: [], policy: 'POL-014' },
    snippet: [
      [49, "export const audit: Middleware = (req, res, next) => {"],
      [50, "  const started = Date.now();"],
      [51, ""],
      [52, "  log.info({ path: req.path, body: req.body }, 'request');"],
      [53, ""],
      [54, "  res.on('finish', () => log.info({ ms: Date.now() - started }, 'done'));"],
      [55, "  next();"],
      [56, "};"],
    ],
    hot: 52,
    fix: [
      ['-', "  log.info({ path: req.path, body: req.body }, 'request');"],
      ['+', "  log.info({ path: req.path, body: redactPii(req.body) }, 'request');"],
    ],
  },
  {
    id: 'GX-CORS-001', rule: 'cors/wildcard-with-credentials', cwe: 'CWE-942',
    severity: 'medium', state: 'accepted', file: 'src/server/cors.ts', line: 12,
    scan: 'scan_0d41ab', introduced: '33b7e91', owner: 'platform',
    acceptedBy: 's.alvarez', acceptedAt: ago(1440 * 4), acceptedNote: 'Staging-only config; production sets an explicit origin list in the edge layer. Re-review 2026-12-01.',
    title: 'Wildcard origin paired with credentialed requests',
    why: 'The wildcard is gated behind NODE_ENV !== "production", and the production edge terminates CORS before this middleware runs. Accepted by platform with a review date.',
    linked: { requests: [], policy: null },
    snippet: [
      [10, "app.use(cors({"],
      [11, "  credentials: true,"],
      [12, "  origin: process.env.NODE_ENV === 'production' ? allowList : '*',"],
      [13, "}));"],
    ],
    hot: 12,
    fix: [
      ['-', "  origin: process.env.NODE_ENV === 'production' ? allowList : '*',"],
      ['+', "  origin: allowList, // same list in every environment"],
    ],
  },
  {
    id: 'GX-INPUT-008', rule: 'input/unbounded-body', cwe: 'CWE-770',
    severity: 'low', state: 'open', file: 'src/server/index.ts', line: 34,
    scan: 'scan_0d41ab', introduced: '0a52f10', owner: 'platform',
    title: 'JSON body parser configured without a size limit',
    why: 'Defaults to 100kb in this version of the parser, so the practical exposure is small, but the limit is implicit and would change silently on upgrade.',
    linked: { requests: [], policy: null },
    snippet: [
      [32, "const app = express();"],
      [33, ""],
      [34, "app.use(express.json());"],
      [35, ""],
      [36, "app.use('/v2', routes);"],
    ],
    hot: 34,
    fix: [
      ['-', "app.use(express.json());"],
      ['+', "app.use(express.json({ limit: '256kb' }));"],
    ],
  },
  {
    id: 'GX-DEPS-003', rule: 'dependency/known-vulnerability', cwe: 'CVE-2025-41209',
    severity: 'medium', state: 'open', file: 'package.json', line: 28,
    scan: 'scan_0d41ab', introduced: 'fb3c220', owner: 'platform',
    title: 'node-tar 6.1.11 — arbitrary write via symlink',
    why: 'Reachable only through the artefact unpack step in CI, which runs on trusted inputs. Fix is a patch-level bump with no API change.',
    linked: { requests: [], policy: null },
    snippet: [
      [26, '  "dependencies": {'],
      [27, '    "express": "4.19.2",'],
      [28, '    "tar": "6.1.11",'],
      [29, '    "pg": "8.11.5"'],
      [30, '  }'],
    ],
    hot: 28,
    fix: [
      ['-', '    "tar": "6.1.11",'],
      ['+', '    "tar": "6.2.1",'],
    ],
  },
];

/* Repository tree. Finding counts are computed from `findings`, never typed. */
export const tree = [
  { type: 'dir', path: 'src', depth: 0 },
  { type: 'dir', path: 'src/api', depth: 1 },
  { type: 'dir', path: 'src/api/middleware', depth: 2 },
  { type: 'file', path: 'src/api/middleware/audit.ts', depth: 3 },
  { type: 'file', path: 'src/api/middleware/auth.ts', depth: 3 },
  { type: 'dir', path: 'src/api/routes', depth: 2 },
  { type: 'file', path: 'src/api/routes/exports.ts', depth: 3 },
  { type: 'file', path: 'src/api/routes/ledger.ts', depth: 3 },
  { type: 'dir', path: 'src/auth', depth: 1 },
  { type: 'file', path: 'src/auth/reset.ts', depth: 2 },
  { type: 'file', path: 'src/auth/token.ts', depth: 2 },
  { type: 'dir', path: 'src/integrations', depth: 1 },
  { type: 'file', path: 'src/integrations/stripeClient.ts', depth: 2 },
  { type: 'file', path: 'src/integrations/webhook.ts', depth: 2 },
  { type: 'dir', path: 'src/ledger', depth: 1 },
  { type: 'file', path: 'src/ledger/query.ts', depth: 2 },
  { type: 'dir', path: 'src/server', depth: 1 },
  { type: 'file', path: 'src/server/cors.ts', depth: 2 },
  { type: 'file', path: 'src/server/index.ts', depth: 2 },
  { type: 'dir', path: 'src/storage', depth: 1 },
  { type: 'file', path: 'src/storage/local.ts', depth: 2 },
  { type: 'file', path: 'package.json', depth: 0 },
];
