# Smoke Gate profile — plan-orchestrator (`plo`)

Lives at `smoke/PROJECT.md`. Committed. Never contains a secret. The page under
test is `plo serve`'s dashboard (`src/ui.html`), served by the real
`src/serve.js` and `src/monitor.js` over fake runs that `smoke/fixture.js`
writes. Every later gate run reads this file instead of re-deriving the
environment.

---

## App

| | |
|---|---|
| Repo root | `.` (plan-orchestrator) |
| Package manager | npm |
| Framework | none — Node `http` server plus one HTML file (`src/ui.html`); no framework, no build step, no dependencies |
| Dev command | `node smoke/fixture.js up`, in the background |
| Base URL | per scenario, `http://127.0.0.1:7411` through `http://127.0.0.1:7417` (see Routes under gate) |
| Boot signal | the line `READY mid=http://127.0.0.1:7411 suite=http://127.0.0.1:7412 review=http://127.0.0.1:7413 barrier=http://127.0.0.1:7414 empty=http://127.0.0.1:7415 drop=http://127.0.0.1:7416 idle=http://127.0.0.1:7417` |
| Cold boot time | about 1 s |

**The gate does not start this server.** Whoever runs the gate starts it and
waits for the boot signal first. Stop it with SIGTERM or SIGINT. A port already
taken is a startup error (exit 1), never a silent step to the next port: free
7411–7417 first. Each start recreates `smoke/.artifacts/fixtures/` from
scratch; `mid` and `review` are rewritten every 30 s so their "seconds ago"
values stay current.

**Dev build confirmed:** not applicable — there is no React and no production
build. The `CONSOLE` assertion checks for zero errors.

---

## Aside environment

| | |
|---|---|
| CLI | `~/.local/bin/aside` |
| MCP | not checked at bootstrap |
| Reduced motion | not forced. Aside does not force `prefers-reduced-motion`; Task 18 checks the reduced-motion rules through the CSS structure, not by toggling the setting. `requireMotion` blocks any `ANIM` row on a machine set to reduce. |
| Account / profile | n/a — no login, any profile works |

---

## Auth

**Strategy:** `none` — the dashboard has no login and holds no session.

Expiry and re-login: n/a.

---

## Data

**Strategy:** fixture files written by `smoke/fixture.js` under
`smoke/.artifacts/fixtures/` (git-ignored), read by the real monitor.

| | |
|---|---|
| API | none besides the dashboard's own server; it answers `GET` only, so nothing the page does can change a run |
| Database | none |
| Stable record ids | n/a — the fixture is recreated on every start |
| **Writes allowed** | **no** |
| Teardown | not needed; each start recreates `smoke/.artifacts/fixtures/` |

No network, no real run, never production. There is no stubbing in the Aside
repl; here it is not needed, because the server only reads.

---

## Routes under gate

One port per scenario. The plan behind each is
`smoke/.artifacts/fixtures/<name>/plan.md`, and every state's `repoRoot` is the
repository root, so the page's commands read
`plo <verb> --plan smoke/.artifacts/fixtures/<name>/plan.md`.

| Port | Name | Base URL | Auth | What it is |
|---|---|---|---|---|
| 7411 | `mid` | http://127.0.0.1:7411 | no | plan "Operator fixture", 8 tasks, 4 lanes, run halfway: T1/T4 done, T2/T6/T7 running (live pid), T5 failed after 3 attempts, T3/T8 pending |
| 7412 | `suite` | http://127.0.0.1:7412 | no | T1–T8 done; integration `suite-running`, `full-suite.log` grows one line every 700 ms |
| 7413 | `review` | http://127.0.0.1:7413 | no | T1–T8 done; suite passed; integration `reviewing`; reviewer runs subagent `tu_rv` (`code-reviewer`) with no result |
| 7414 | `barrier` | http://127.0.0.1:7414 | no | T1–T7 done; barrier T8 `failed` with subagent `tu_orph` and no result; integration `barrier-failed`, dead pid |
| 7415 | `empty` | http://127.0.0.1:7415 | no | the plan only, no state |
| 7416 | `drop` | http://127.0.0.1:7416 | no | proxy to 7411; `GET /__fixture/drop` cuts every open stream and destroys each new connection for 8 s |
| 7417 | `idle` | http://127.0.0.1:7417 | no | T1–T7 done, T8 pending, integration pending, old state form: no `pid`, `stages`, `effort`, `tries`, `edges` or `usage5h` |

**Clipboard:** before clicking a COPY control, the spec replaces
`navigator.clipboard` with
`{ writeText: (t) => { window.__copied = t; return Promise.resolve(); } }`
through `Object.defineProperty`, then reads `window.__copied`.

**Viewport:** an iframe at 390, 900 and 1200 px wide — Aside has no
`setViewportSize`.

---

## Selector convention

The `data-testid` values listed in the Global Constraints of
`docs/superpowers/plans/2026-10-26-esforco-e-painel-pipboy.md`. No positional
selectors.

---

## Known flaky / do not assert

None.

---

## Bootstrap record

| | |
|---|---|
| Bootstrapped | `2026-10-26` — Task 11 of `docs/superpowers/plans/2026-10-26-esforco-e-painel-pipboy.md` |
| Verified failing | `2026-10-26` — disposable spec against a nonexistent tab produced `VERDICT: FAIL` (not `BLOCKED`). The gate is proven able to fail. |
| Last gate run | `2026-10-26` (the probe above) |

The probe was `smoke/.artifacts/bootstrap-probe.js` (deleted afterwards). It
opened `http://127.0.0.1:7411/` with `openTab` and made one call,
`assertClickable(page, '[data-testid=tab-STAT]', <text of [data-testid=view-title]>, 'AGENTS', 'A1', 'tab STAT opens view titled AGENTS')`,
then `emit()`. `tab-STAT` does not exist on the page as it is before Task 12,
so the row is red for that reason alone.

Command (one runner invocation, run from the repo root):

```
bash /Users/nicolasibraim/.claude/skills/smoke-gate/runner/smoke-run.sh smoke/.artifacts/bootstrap-probe.js smoke/.artifacts/shots-probe
```

Exit code: 1 (FAIL). Output, verbatim:

```
VERDICT: FAIL
PASSED: 0/1
FAILED: A1 (CLICKABLE) — tab STAT opens view titled AGENTS: Selector "[data-testid=tab-STAT]" not found
SHOTS: smoke/.artifacts/shots-probe
```

An earlier attempt the same day was BLOCKED_ENV (exit 2, 3 of 3 runs) because
the probe called `assertClickable` with the wrong argument order; the harness
signature is `assertClickable(page, sel, postCondition, expected, id, label)`.
