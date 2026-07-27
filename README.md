# plan-orchestrator (`plo`)

Parallel lane execution for TDD implementation plans.

Reads a superpowers-style plan, infers which tasks touch disjoint files, runs the
independent ones concurrently in isolated git worktrees, and checkpoints every
task so a dead session resumes exactly where it stopped.

    npm link          # puts `plo` on PATH
    plo --help

## The flow

    plo analyze   --plan <plan.md> --max-lanes 3   # read-only; prints the DAG for review
    # ...human corrects it in .plan-lanes.json, re-run analyze until right...
    plo init      --plan <plan.md> --max-lanes 3   # writes .plan-state.json
    plo run       --plan <plan.md>                 # worktrees + concurrent lanes
    plo resume    --plan <plan.md>                 # after a crash / limit / API error
    plo integrate --plan <plan.md>                 # merge -> barriers -> FULL suite -> cross-lane review
    plo clean     --plan <plan.md>                 # remove lane worktrees

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
| override | `.plan-lanes.json` | wins over everything |

Rule 0 runs first: already-completed tasks leave the graph. A conflict against
merged work is not a conflict.

Two details that matter in practice:

- **Negations are honoured.** `- Test: \`a.test.js\` (novo — não mexer no \`b.test.js\`)`
  records one write, not two. Counting `b.test.js` would fabricate conflicts.
- **Reads are not conflicts.** Only declared writes serialize lanes. Two tasks
  importing the same helper stay parallel.

## Correcting the DAG

Write `.plan-lanes.json` beside the plan:

```json
{
  "dropEdges": ["3->8"],
  "addEdges": [{ "from": 5, "to": 6, "reason": "both extend the same fixture" }]
}
```

Commit this file — it documents a real decision. Do not commit `.plan-state.json`;
that is run state.

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

## Resume

`.plan-state.json` is written by the CLI (never by an agent) before a task starts
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
