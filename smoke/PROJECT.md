# Smoke gate profile — plan-orchestrator (`plo`)

The page under test is `plo serve`'s dashboard (`src/ui.html`), served by the
real `src/serve.js` and `src/monitor.js` over fake runs that `smoke/fixture.js`
writes. Every later gate run reads this file instead of re-deriving the
environment.

**App:** Node `http` server plus one HTML file — no framework, no build step,
no dependencies. The dev command is `node smoke/fixture.js up`, run in the
background; its `READY …` line is the boot signal (about 1 s). Each scenario
has its own base URL (see Routes).

**Dev build confirmed:** not applicable — there is no React and no production
build. The `CONSOLE` assertion checks for zero errors.

**Aside environment:** runs with this machine's reduced-motion setting as it
is. Aside does not force `prefers-reduced-motion`, so Task 18 checks the
reduced-motion rules through the CSS structure, not by toggling the setting.

**Auth:** `none`.

**Data:** the fixture, behind a server that only reads. No network, no real
run, never production.

**Routes:** one port per scenario. The plan behind each is
`smoke/.artifacts/fixtures/<name>/plan.md`, and every state's `repoRoot` is the
repository root, so the page's commands read
`plo <verb> --plan smoke/.artifacts/fixtures/<name>/plan.md`.

| Port | Name | Base URL | What it is |
|---|---|---|---|
| 7411 | `mid` | http://127.0.0.1:7411 | plan "Operator fixture", 8 tasks, 4 lanes, run halfway: T1/T4 done, T2/T6/T7 running (live pid), T5 failed after 3 attempts, T3/T8 pending |
| 7412 | `suite` | http://127.0.0.1:7412 | T1–T8 done; integration `suite-running`, `full-suite.log` grows one line every 700 ms |
| 7413 | `review` | http://127.0.0.1:7413 | T1–T8 done; suite passed; integration `reviewing`; reviewer runs subagent `tu_rv` (`code-reviewer`) with no result |
| 7414 | `barrier` | http://127.0.0.1:7414 | T1–T7 done; barrier T8 `failed` with subagent `tu_orph` and no result; integration `barrier-failed`, dead pid |
| 7415 | `empty` | http://127.0.0.1:7415 | the plan only, no state |
| 7416 | `drop` | http://127.0.0.1:7416 | proxy to 7411; `GET /__fixture/drop` cuts every open stream and destroys each new connection for 8 s |
| 7417 | `idle` | http://127.0.0.1:7417 | T1–T7 done, T8 pending, integration pending, old state form: no `pid`, `stages`, `effort`, `tries`, `edges` or `usage5h` |

**Selector convention:** the `data-testid` values listed in the Global
Constraints of `docs/superpowers/plans/2026-10-26-esforco-e-painel-pipboy.md`.
No positional selectors.

**Clipboard:** before clicking a COPY control, the spec replaces
`navigator.clipboard` with
`{ writeText: (t) => { window.__copied = t; return Promise.resolve(); } }`
through `Object.defineProperty`, then reads `window.__copied`.

**Viewport:** an iframe at 390, 900 and 1200 px wide — Aside has no
`setViewportSize`.

**Known flaky:** none.

**Dev command:** `node smoke/fixture.js up`, in the background. Wait for the
line `READY mid=http://127.0.0.1:7411 suite=http://127.0.0.1:7412 review=http://127.0.0.1:7413 barrier=http://127.0.0.1:7414 empty=http://127.0.0.1:7415 drop=http://127.0.0.1:7416 idle=http://127.0.0.1:7417`.
Stop it with SIGTERM or SIGINT. A port already taken is a startup error
(exit 1), never a silent step to the next port: free 7411–7417 first. Each
start recreates `smoke/.artifacts/fixtures/` from scratch; `mid` and `review`
are rewritten every 30 s so their "seconds ago" values stay current.

**Port / base URL:** per scenario, as in Routes — `http://127.0.0.1:7411`
through `http://127.0.0.1:7417`, loopback only.

**Auth strategy:** none — the dashboard has no login and holds no session.

**Data strategy:** fixture files written by `smoke/fixture.js` under
`smoke/.artifacts/fixtures/` (git-ignored), read by the real monitor. The
server answers `GET` only; nothing the page does can change a run.

**Writes permitted:** no.

## Bootstrap record

**Date:** 2026-10-26

**By:** Task 11 of `docs/superpowers/plans/2026-10-26-esforco-e-painel-pipboy.md`.

**Proof the gate can fail:** **NOT proven.**

The probe was a disposable spec, `smoke/.artifacts/bootstrap-probe.js` (now
deleted), run against the dashboard as it is before Task 12. It opened
`http://127.0.0.1:7411/` with `openTab`, made one CLICKABLE assertion on
`[data-testid=tab-STAT]` with the post-condition `[data-testid=view-title]`
reads `AGENTS`, and ended in `emit()`. The expected verdict was FAIL, because
that tab does not exist on the current page. It never got that far: all three
allowed runner invocations ended BLOCKED_ENV (exit 2). The harness printed no
result block, so there is no CLICKABLE row at all, red or green.

| Run | Call | Verdict | Exit |
|---|---|---|---|
| 1 | `assertClickable('[data-testid=tab-STAT]', { label, post: async () => … })` (the helper name was found by `typeof` over a fixed list of candidate names) | BLOCKED_ENV | 2 |
| 2 | `assertClickable('[data-testid=tab-STAT]', async () => …, 'CLICKABLE … view-title = AGENTS')` | BLOCKED_ENV | 2 |
| 3 | `assertClickable('A1', '[data-testid=tab-STAT]', async function viewTitleReadsAGENTS() { … })` | BLOCKED_ENV | 2 |

The runner's output, verbatim (ANSI colour codes shown as text, without the
escape byte):

Run 1:

```
VERDICT: BLOCKED_ENV
REASON: no result block (repl exit 0) — run died before emit()
--- last output ---
✔︎ Opened a new tab and set it active: tabs[0], page → ⚠ 2/8 · Operator fixture (http://127.0.0.1:7411/)
[system] last tab closed. `page` is now null. call openTab(url) to open a new one.
[system] no current open tabs in this session.
[31mTypeError: not a function
    at assertClickable (repl.js:40:26)[0m
[31m[error | 894ms][0m
```

Run 2:

```
VERDICT: BLOCKED_ENV
REASON: no result block (repl exit 0) — run died before emit()
--- last output ---
✔︎ Opened a new tab and set it active: tabs[0], page → ⚠ 2/8 · Operator fixture (http://127.0.0.1:7411/)
[31mTypeError: not a function
    at assertClickable (repl.js:40:26)[0m
[31m[error | 581ms][0m
```

Run 3:

```
VERDICT: BLOCKED_ENV
REASON: no result block (repl exit 0) — run died before emit()
--- last output ---
✔︎ Opened a new tab and set it active: tabs[0], page → ⚠ 2/8 · Operator fixture (http://127.0.0.1:7411/)
[31mTypeError: not a function
    at assertClickable (repl.js:40:26)[0m
[31m[error | 495ms][0m
```

What the runs do show:
- the environment is good up to the harness: the fixture answered, Aside
  opened the page, and the page rendered (its title is `⚠ 2/8 · Operator
  fixture`);
- `assertClickable` exists, but the bootstrap could not learn its call shape.
  `SKILL.md` does not give it, and the skill's reference files were not
  readable in the bootstrap's sandbox. Three different argument shapes all
  died at the same expression, `repl.js:40:26`, within a second, before any
  click could time out.

**Still open:** before the first UI gate (Task 12), someone with
`reference/assertions.md` writes this same CLICKABLE spec with the documented
call and runs it once against the current page. The expected verdict is FAIL,
with the `tab-STAT` row red. Record that run here and only then mark the gate
proven.
