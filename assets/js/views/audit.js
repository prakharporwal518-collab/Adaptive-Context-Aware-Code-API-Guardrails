/* ==========================================================================
   Audit log — append-only record of every decision and every human action
   Includes anything done in this session, so resolving a finding shows up
   here immediately.
   ========================================================================== */

import * as store from '../store.js';
import { esc, n, stamp, relTime, emptyState } from '../ui.js';

let filter = 'all';

export function render(host) {
  const all = store.auditLog();

  const kinds = {
    all: () => true,
    guardrail: (e) => e.action.startsWith('guardrail.'),
    finding: (e) => e.action.startsWith('finding.'),
    policy: (e) => e.action.startsWith('policy.'),
    scan: (e) => e.action.startsWith('scan.') || e.action.startsWith('secret.'),
  };
  const rows = all.filter(kinds[filter]);

  host.innerHTML = `
  <div class="audit">
    <section class="panel">
      <div class="panel-hd">
        <h2>Audit log</h2>
        <span class="sub">append-only &middot; ${n(all.length)} entries retained</span>
        <div class="spacer"></div>
        <div class="segmented" id="a-filter">
          ${Object.keys(kinds).map((k) =>
            `<button data-k="${k}" aria-pressed="${k === filter}">${k === 'all' ? 'All' : k[0].toUpperCase() + k.slice(1)}</button>`).join('')}
        </div>
      </div>
      <div class="panel-bd flush">
        ${rows.length ? `
        <table class="tbl audit-tbl">
          <thead><tr>
            <th style="width:158px">Timestamp</th>
            <th style="width:176px">Action</th>
            <th style="width:124px">Actor</th>
            <th style="width:150px">Target</th>
            <th>Detail</th>
            <th style="width:84px">When</th>
          </tr></thead>
          <tbody>
            ${rows.map((e) => `<tr>
              <td class="mono meta tnum">${stamp(e.t)}</td>
              <td><span class="act ${tone(e.action)}"><span class="act-dot"></span>${esc(e.action)}</span></td>
              <td class="mono meta">${esc(e.actor)}</td>
              <td class="id">${esc(e.target)}</td>
              <td class="meta">${esc(e.detail)}</td>
              <td class="meta">${relTime(e.t)}</td>
            </tr>`).join('')}
          </tbody>
        </table>` : emptyState('No entries of this kind',
          'Switch the filter above. The log keeps guardrail decisions, finding lifecycle changes, policy edits and scan completions.')}
      </div>
    </section>
    <p class="meta" style="margin-top:11px;max-width:74ch;line-height:1.55">
      Entries are written at decision time and are not editable from the console.
      Actions you take in this session &mdash; resolving a finding, accepting a risk,
      toggling a policy &mdash; are appended here as they happen.
    </p>
  </div>`;

  host.querySelectorAll('#a-filter button').forEach((b) =>
    b.addEventListener('click', () => { filter = b.dataset.k; render(host); }));

  return () => {};
}

function tone(action) {
  if (action === 'guardrail.blocked') return 'act-block';
  if (action === 'guardrail.flagged') return 'act-flag';
  if (action.startsWith('finding.resolved') || action === 'secret.rotated' || action === 'policy.enabled') return 'act-good';
  if (action.startsWith('scan.')) return 'act-info';
  return '';
}
