# plan-orchestrator (`plo`)

Parallel lane execution for TDD implementation plans.

Reads a superpowers-style plan, infers which tasks touch disjoint files, runs the
independent ones concurrently in isolated git worktrees, and checkpoints every
task so a dead session resumes exactly where it stopped.

    npm link          # puts `plo` on PATH
    plo --help

## The flow

    plo analyze   --plan <plan.md> --max-lanes 3   # read-only; prints the DAG for review
    # ...human corrects it in .plan-lanes-<plan>.json, re-run analyze until right...
    plo init      --plan <plan.md> --max-lanes 3   # writes .plan-state-<plan>.json
    plo run       --plan <plan.md>                 # worktrees + concurrent lanes
    plo resume    --plan <plan.md>                 # after a crash / limit / API error
    plo integrate --plan <plan.md>                 # merge -> barriers -> FULL suite -> cross-lane review
    plo clean     --plan <plan.md>                 # remove lane worktrees

    plo serve     --plan <plan.md>                 # in another terminal: live dashboard

`analyze` changes nothing on disk. Nothing runs until you approve the lane plan.

## What it assumes about a plan

Tasks declared as `### Task N: <title>`, with the blocks superpowers already
emits:

```markdown
### Task 3: POST /v1/requests

**Files:**
- Modify: `src/routes/external/requests.js`
- Test: `tests/external.requests.write.test.js` (novo)

**Interfaces:**
- Consumes: `requestsRepo.create(...)` (Task 2); helpers da Task 1.
- Produces: `makeRequestsRouter({ ... })` usados nas Tasks 5-7.
```

Everything the DAG needs is already there. The analyzer parses it literally —
it does not guess.

## Edge rules

| Rule | Source | Strength |
|---|---|---|
| write-write | two tasks declare the same path in `**Files:**` | hard |
| interface | a `Consumes:`/`Produces:` block names another task | hard |
| semantic | docs-only and no-writes heuristics, or an LLM pass | soft, reviewable |
| override | `.plan-lanes-<plan>.json` | wins over everything |

Rule 0 runs first: already-completed tasks leave the graph. A conflict against
merged work is not a conflict.

Two details that matter in practice:

- **Negations are honoured.** `- Test: \`a.test.js\` (novo — não mexer no \`b.test.js\`)`
  records one write, not two. Counting `b.test.js` would fabricate conflicts.
- **Reads are not conflicts.** Only declared writes serialize lanes. Two tasks
  importing the same helper stay parallel.

## Correcting the DAG

Write `.plan-lanes-<plan>.json` beside the plan (`.plan-lanes-auth-refactor.json` for
`auth-refactor.md`):

```json
{
  "dropEdges": ["3->8"],
  "addEdges": [{ "from": 5, "to": 6, "reason": "both extend the same fixture" }]
}
```

Commit this file — it documents a real decision. Do not commit the
`.plan-state-*.json` checkpoint; that is run state.

## One state file per plan

Both sidecars are named after the plan, not the directory:

    docs/superpowers/plans/auth-refactor.md
    docs/superpowers/plans/.plan-state-auth-refactor.json
    docs/superpowers/plans/.plan-lanes-auth-refactor.json

Plans conventionally share a folder, and a directory-wide name made them collide:
`init` on a second plan refused against the first one's state, and `run` matched
task **numbers** across two unrelated plans — reporting the other plan's finished
tasks as "already complete" and skipping them. Several plans can now sit in one
folder and run independently.

Two guards back the naming, because a name alone is not a check:

- `load` refuses any state file whose recorded plan is a different file, rather
  than matching task numbers across plans.
- A pre-existing `.plan-state.json` is migrated to the per-plan name on first
  load — but only when it is that plan's. Another plan's is left untouched.

The directory may legitimately differ (repo moved, fresh clone, worktree); the
plan file may not.

## Execution model

One OS process per task (`claude -p`, or whatever `PLO_AGENT_BIN` names), in the
lane's own worktree, with its own session id. A lane that hits a usage limit or
an API error dies alone; the others keep running and the CLI records it.

Inside each process, the per-task loop is
`superpowers:subagent-driven-development` — implementer, task review, five-round
fix loop, ledger. This tool does not reimplement any of that; it decides *what
runs where*, and *what survives a crash*.

SDD's rule "never dispatch multiple implementers in parallel" is a rule about
**one checkout**. Per-lane worktrees remove the shared state it protects. Within
any single worktree the rule still holds absolutely, and the scheduler enforces
it.

## Watching a run

`plo run` prints one line per task boundary, which is all the checkpoint knows.
Everything else — the tool a lane is on right now, the turn count, the usage
limit that killed it — is already on disk in `.plo-logs/task-<n>.jsonl`, because
`spawn.js` writes the agent's raw stdout before parsing it.

    plo serve --plan <plan.md>          # http://127.0.0.1:7331
    plo serve --plan <plan.md> --port 8080 --open

A second window, not a second run: read-only, loopback-bound, no dependency and
no build step.

**Its unit is the agent, not the lane.** A lane does not work; the agent running
the task does, and so do the subagents it dispatched. So the page is one row per
agent — lane, task, model, how long it has been alive, turns, and one sentence
saying what it is doing. `Bash · npx vitest run tests/theme-toggle.test.tsx`
makes you parse a command to find out the tests are running; `running the tests`
puts the verb first and leaves the command as evidence. Each agent nests the
subagents it opened, drawn from the `parent_tool_use_id` its log already carried:
a `Task` call is the subagent's birth, the matching `tool_result` its death, and
everything in between is what it did. They carry their own turns, tokens and
model, because they run on their own.

Each row expands to that agent's log, and whoever stopped opens on the account
it wrote — rendered as the Markdown it is, with the `plo resume` and the lane
branch beside it. `Task record` inside the drawer opens the task itself: session
id, log path, declared writes, plan steps and the full activity tail, at
`#task=4`, which survives a reload and pastes into Slack.

It counts output tokens, not dollars. The agent reports `total_cost_usd` and
that is an API price; nobody running this off a subscription pays it, so on
this page it was a number about someone else's bill. Tokens are what the run
spends and what a usage limit is counted in. The CLI records the figure the
agent reports at the end of each spawn, summed across attempts — a task the fix
loop ran five times spent five spawns' worth. A task that never reported one
shows `—`, never `0`.

Across the top, the run is a pipeline: `run → merge → barriers → full suite →
cross-lane review`, in the only order they can happen. A failure lands on the
stage that owns it — `Barriers ✗` with the two stages after it visibly
untouched says more than the word `barrier-failed` in a status field, which
only means something to a reader who already knows the order. It is also the
answer when nobody is working: between the last lane task and the merge the
crew is empty, and the page says which stage it is waiting on rather than
"nothing running" twice.

`Up next` lists what has not become an agent yet and what each one is waiting
behind; `Out of the way` collapses everything finished into one band. When the
last task lands, `How it went` closes the run with the only question that pays
for the tool: wall clock against summed agent time, and the multiple the lanes
returned.

`Activity` opens the whole run as one chronological feed — time, who, tool,
target, how long the call took. Each lane writes its own log, so this is the
only place that answers "what happened, in what order", and every line carries
the face of the agent it came from, because two `implementer` rows under an
identical label are the thing this surface exists to tell apart. Search it,
narrow it to errors, Bash or edits, or turn on `Wrap` when the line you want is
the one the ellipsis ate. It is a drawer at every width: as a fixed column it
spent 40% of the screen on the events nobody reads twice.

Nothing on the page asks to be retyped. The blocked banner carries the
`plo resume --plan …` it implies, and the branch, the session id and the log
path each copy with one click.

Status reads as a shape before a colour, the way an issue tracker does: an empty
ring is waiting, a half-filled one is running, a filled check is done, a crossed
ring failed. It follows the system light/dark setting and holds WCAG AA contrast
in both.

Two things it is careful about:

- **It stays quiet when nothing changed.** The payload carries timestamps, never
  elapsed times, so two identical reads compare equal and produce no frame.
  Polling runs only while a tab is open.
- **It never becomes part of the run.** No writes, no locks, `POST` refused. A
  plan deleted or a checkpoint replaced mid-read is displayed as an error rather
  than crashing the server.

`--interval <seconds>` slows the re-read; `--host` binds elsewhere, which you
want only if you actually mean to expose it.

## Resume

`.plan-state-<plan>.json` is written by the CLI (never by an agent) before a task starts
and again the moment it exits. On resume:

- a task left `running` becomes `interrupted`
- a task with commits on its lane branch that state calls unfinished is promoted
  to `done` — **git outranks the state file**
- if the plan file changed since `init`, you get a warning, because task
  numbering may have shifted

Resume never reads a transcript.

## Integration

Order is not negotiable:

1. **merge** lane branches into the feature branch, in lane order. A conflict
   stops here and leaves the conflicted tree in place — that is evidence, and it
   means the DAG was wrong.
2. **barrier tasks** (docs, PR prep) in the merged tree, because their inputs are
   the combined contracts of every lane.
3. **the FULL suite**. Each lane passed its own tests in isolation; this is the
   first run that can fail on their interaction.
4. **the cross-lane review** — orphaned references after deletions, helpers two
   lanes each wrote, drifted types, diverged conventions, semantic merge damage,
   test-fixture collisions. Per-lane reviews structurally cannot see these.

## Honest limits

- **Parallelism buys wall-clock, not budget.** Three lanes spend tokens ~3× as
  fast. If the goal is surviving usage limits, the win is the checkpoint and the
  process isolation — `--max-lanes 1` still gives exact resume.
- **Below ~6 remaining tasks, use plain subagent-driven-development.** Worktree
  and process setup costs more than the parallelism returns.
- The semantic layer is heuristic. It is deliberately soft, printed with its
  evidence, and overridable.

## Development

    npm test        # node:test, no dependencies

`test/e2e-worktree.test.js` runs against a real throwaway git repo: worktree
creation, dependency seeding, lane isolation, and crash recovery. Nothing mocked,
no agent spawned.
