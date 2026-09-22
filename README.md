# GuardX — Adaptive Context-Aware Code & API Guardrails

An AI-assisted developer security layer that sits between a developer and the
code and API surface, and decides whether an action is risky **from the context
it happens in** rather than from a fixed rule table.

The same call — `POST /v2/ledger/entries/8841/reverse` — is routine from an
engineer on a known device with a fresh auth assertion, and an incident from a
contractor on an unrecognised device at 02:47 with a 12-minute-old assertion.
GuardX scores both against the surrounding context and reaches different,
defensible conclusions. That difference is the whole product.

This repository contains the **front end**: a public overview page and a working
console, running against a seeded demo dataset.

---

## Running it

No build step, no dependencies. It is plain ES modules and CSS, so any static
server works:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` over `file://` will not work — ES modules require a real
origin.

---

## What is in the console

| View | Layout | What it does |
|---|---|---|
| **Overview** | metric strip · charts · feed | Decision volume by hour, security events, identities under review, open-finding mix |
| **API monitor** | filter row · table · drawer | Every inspected request; the drawer shows factor weights, the policy evaluated, the inspected body and the correlation chain |
| **Risk analysis** | score · factors · timeline | One score, what composed it, and what the same identity did around it |
| **Code analyzer** | tree · source · findings | Findings inline in the source, with a suggested patch and the runtime requests that correlate |
| **Policies** | list · conditions · test bench | Conditions and action, plus an evaluator you can run against an editable request context |
| **Copilot** | thread · trace · context | Answers composed from the same records the console displays, with the lookups shown. Read-only |
| **Audit log** | filtered table | Guardrail decisions, finding lifecycle, policy changes and scans |

`g` followed by `1`–`7` jumps between views.

---

## How the data is wired

Everything in the console derives from **one dataset**. `assets/js/data.js`
holds the request log, findings, policies, scans and identities;
`assets/js/store.js` holds the mutable slice and computes every aggregate.

No view computes its own totals, and no number is written into markup. That
means the relationships hold:

- A request marked `BLOCKED` has a security event with the same id, risk score,
  policy and timestamp.
- "Blocked: 7" on the dashboard is the row count you get by filtering the
  monitor to blocked — the test suite asserts this.
- Policy hit counters are counted from the request log, not stored.
- Resolving a finding in the analyzer moves the dashboard, the rail counter,
  the severity chart, the file-tree marker and the audit log in one pass.
- Switching environment or time window re-scopes every view together.

Timestamps are generated relative to load time so the console always reads as
"now", but all offsets are fixed — two reloads tell the same story.

---

## Design notes

**Dark-first, signal-reserved.** Surfaces and ink are a warm-shifted charcoal
ramp. Colour is reserved for risk, decision and status, and never used
decoratively. Every signal colour is paired with its text label, so a severity
is never communicated by hue alone.

**Charts are hand-built inline SVG** — no charting library. The three decision
series were checked for colour-vision separation against the panel surface
(adjacent ΔE 16.4 normal / 7.7 deuteranopic, with the 2px surface gaps, legend
and table view that the floor band requires). Grid lines are solid hairlines,
bars are capped at 18px with 4px rounded data-ends, and every chart has a
table-view twin so no value is reachable only by hovering.

**Layout is per-view on purpose.** The analyzer is a three-pane IDE, the monitor
is a table with a drawer, the policy builder is a form with a live test panel.
There is no shared card grid, because the views are not showing the same shape
of information.

**Type** is IBM Plex Sans and IBM Plex Mono, self-hosted (latin subsets, ~340KB)
so there is no third-party font request and no flash of fallback text.

---

## Layout

```
index.html              public overview
app.html                console shell
assets/
  css/  tokens · base · site · app · fonts
  js/   data · store · charts · ui · icons · app
        views/  overview · api · risk · code · policies · copilot · audit
  fonts/                IBM Plex subsets
```

---

## Deployment

Published to GitHub Pages by `.github/workflows/deploy-pages.yml` on push. The
workflow checks that every asset referenced by the two HTML pages exists before
publishing.

**One-time setup by a repository admin:** Settings → Pages → Build and
deployment → Source: **GitHub Actions**. This cannot be automated — creating a
Pages site is an admin-scoped API that the workflow's `GITHUB_TOKEN` is refused
access to, even with `pages: write`. Once it is set, re-run the latest workflow
(Actions → Deploy GuardX to GitHub Pages → Re-run jobs) and every later push
deploys on its own.

The site will be served at
`https://prakharporwal518-collab.github.io/Adaptive-Context-Aware-Code-API-Guardrails/`.

---

## Scope and honesty

This is a front end on a seeded dataset. The tenant, repository, identities and
traffic are fabricated — there is no backend, no telemetry and no real system
being reported on. What is real is the wiring: the figures are computed from the
dataset rather than written into the page, and the policy evaluator in the test
bench is the same code path the console uses to describe a decision.

There are no testimonials, customer logos, adoption counts or security
statistics anywhere in this repository, because none of them would be true.
