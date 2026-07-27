'use strict';

/**
 * Prompts handed to spawned agent processes.
 *
 * Design rule: these prompts delegate the per-task loop to
 * superpowers:subagent-driven-development rather than restating it. That skill
 * already owns the implement → review → fix cycle, the five-round cap, the
 * escalation ladder and the ledger contract. Reimplementing any of it here
 * would fork a well-tested process and let the two drift.
 *
 * What these prompts DO own is the part SDD cannot know: that this process is
 * one lane of several running concurrently, and what it must therefore never
 * touch.
 */

/** Shared boundary rules. Violations here are what cross-lane corruption looks like. */
function laneBoundary({ laneId, laneTasks, taskNumber, branch }) {
  const others = laneTasks.filter((n) => n !== taskNumber);
  return `## Lane boundary — read this before anything else

You are lane **${laneId}**, running on branch \`${branch}\`, in your own git worktree.
Other lanes are executing OTHER tasks from this same plan RIGHT NOW, in their own
worktrees, on their own branches.

Hard rules:

- **Implement Task ${taskNumber} and nothing else.** ${others.length ? `Tasks ${others.join(', ')} are also yours but belong to later runs — do not start them.` : 'No other task in this plan is yours.'}
- **Only touch the files Task ${taskNumber} declares** in its \`**Files:**\` block. A file
  you were not given belongs to another lane; editing it produces a merge
  conflict that a human has to untangle.
- **Never merge, rebase, pull, or switch branches.** Commit to \`${branch}\` and stop.
  Integration is a separate phase that runs after every lane finishes.
- **Never edit the plan file, and never edit \`.plan-state.json\`.** The orchestrator
  owns that file; anything you write there is overwritten and lost.
- If the task cannot be completed, stop and say so plainly in your final message.
  A clear failure is useful; a half-finished lane that reports success is not.`;
}

/**
 * The per-task prompt: one task, full implement → review → fix cycle, via SDD.
 */
function laneTaskPrompt({ planPath, taskNumber, taskTitle, laneId, laneTasks, branch, worktree, testCommand, globalConstraints, priorInterfaces }) {
  return `${laneBoundary({ laneId, laneTasks, taskNumber, branch })}

## Your task

Implement **Task ${taskNumber}: ${taskTitle}** from the plan at:

    ${planPath}

Read only that task's section plus the plan's **Global Constraints**. Do not read
or act on other tasks' sections beyond what you need to understand an interface.

## How to execute it

Use the **superpowers:subagent-driven-development** skill, scoped to this single
task. That means, in its terms:

1. Resolve the plan workspace and check the ledger (\`scripts/sdd-workspace\`).
2. Generate the task brief (\`scripts/task-brief ${planPath} ${taskNumber}\`).
3. Record BASE (\`git rev-parse HEAD\`), then dispatch an implementer subagent
   with the brief path and a report path.
4. Generate the review package and dispatch the task reviewer.
5. Run the fix loop to its documented cap if the review has findings.
6. Append the completion line to the ledger.

Then STOP. Do not proceed to another task, do not run the final whole-branch
review, and do not invoke finishing-a-development-branch — the orchestrator runs
those once, after all lanes converge.

## Verification

Test command for this repo: \`${testCommand || 'see Global Constraints'}\`
Run it from the worktree root: \`${worktree}\`
The task is not done until the tests it specifies pass and the work is committed.

${globalConstraints ? `## Global Constraints (from the plan)\n\n${globalConstraints}\n` : ''}${priorInterfaces ? `## Interfaces settled by earlier tasks\n\nThese are already merged into your base. Use them as given; do not redefine them.\n\n${priorInterfaces}\n` : ''}
## Final message contract

End with exactly one of:

- \`STATUS: DONE — <commit shas> — <one-line test result>\`
- \`STATUS: BLOCKED — <what stopped you, in one or two sentences>\`

Nothing else after that line.`;
}

/**
 * A barrier task runs in the integrated base after every lane has merged.
 */
function barrierTaskPrompt({ planPath, taskNumber, taskTitle, branch, worktree, testCommand, globalConstraints, mergedLanes }) {
  return `## Context

You are running in the **integrated feature branch** \`${branch}\`, at \`${worktree}\`.
Every parallel lane for this plan has finished and been merged: ${mergedLanes.length ? `lanes ${mergedLanes.join(', ')}` : '(none recorded)'}.
The working tree contains the combined output of all of them.

## Your task

Implement **Task ${taskNumber}: ${taskTitle}** from the plan at:

    ${planPath}

Use **superpowers:subagent-driven-development** scoped to this single task:
brief → implementer → review package → task reviewer → fix loop → ledger line.
Then STOP.

Because this task runs after integration, its inputs are the merged contracts of
every lane — not any single lane's view of them. If the plan's text for this task
disagrees with what the merged code actually does, the merged code is the fact:
report the discrepancy rather than writing documentation that describes code that
does not exist.

## Verification

Test command: \`${testCommand || 'see Global Constraints'}\`, run from \`${worktree}\`.

${globalConstraints ? `## Global Constraints (from the plan)\n\n${globalConstraints}\n` : ''}
## Final message contract

End with exactly one of:

- \`STATUS: DONE — <commit shas> — <one-line test result>\`
- \`STATUS: BLOCKED — <what stopped you>\`

Nothing else after that line.`;
}

/**
 * The cross-lane reviewer. This is the review that only exists because the work
 * was parallel: each lane's own review already passed, in isolation, on a diff
 * that could not see the other lanes.
 */
function crossLaneReviewPrompt({ planPath, branch, worktree, reviewPackage, lanes, testCommand, suiteResult }) {
  const laneLines = lanes.map((l) => `- **Lane ${l.id}** (\`${l.branch}\`): tasks ${l.tasks.join(', ')}`).join('\n');

  return `## What you are reviewing

The branch \`${branch}\` at \`${worktree}\` is the merge of several lanes that were
implemented **concurrently and in isolation**:

${laneLines}

Each lane already passed its own per-task review. Those reviews were correct and
are not your job to repeat. Every one of them, however, reviewed a diff that could
not see the other lanes. You are reviewing exactly the class of defect that
creates: problems that are invisible in any single lane's diff and only appear
once the lanes sit in the same tree.

Full branch diff (commits, stat, and \`-U10\` context) is prepared for you at:

    ${reviewPackage}

Read that file. Do not re-derive the diff with git commands.

Full test suite result at the merge point: ${suiteResult || '(not recorded)'}
Test command: \`${testCommand || 'unknown'}\`

## What to hunt for — in priority order

1. **Orphaned references after deletions.** Lane A deleted or renamed a symbol,
   file, or export; lane B still imports or calls it. Grep the branch for every
   identifier a lane removed. A passing test suite does NOT clear this — dead
   imports in untested paths survive green runs.

2. **Duplicated helpers.** Two lanes independently needed the same utility and
   each wrote its own. Look for near-identical functions across lane boundaries,
   especially in \`utils/\`, \`helpers/\`, \`lib/\`, and test fixtures. Report the
   duplicate pair and recommend which one survives.

3. **Inconsistent types and contracts.** The same conceptual value typed or
   shaped differently by different lanes: one lane returns \`{id}\`, another
   returns a bare string; one widens a union the other still narrows; one adds a
   field to a shared response shape that the other's presenter drops.

4. **Divergent conventions on a shared surface.** Two lanes extending the same
   module in incompatible styles — different error classes for the same failure,
   different argument ordering on parallel functions, different naming for the
   same concept.

5. **Semantic merge damage.** Changes that merged cleanly at the text level but
   are wrong together: two lanes each adding a route with the same path, each
   incrementing the same counter, each registering the same key.

6. **Test collisions.** Two lanes writing fixtures, ports, temp paths, or global
   state under the same name — a source of tests that pass alone and fail in a
   full run, or vice versa.

## What NOT to report

- Style or preference issues inside a single lane. Its own review owned that.
- Anything you cannot tie to a specific file and line in the diff.
- Defects that would exist identically had the plan been executed serially —
  those belong to the per-task reviews, not here.

## Output

For each finding:

    ### <short title>
    **Lanes:** <which lanes collide>
    **Files:** <path:line>, <path:line>
    **Category:** orphaned-reference | duplicate-helper | type-inconsistency | convention-drift | semantic-merge | test-collision
    **Severity:** Critical | Important | Minor
    **Why parallel execution caused it:** <one sentence>
    **Fix:** <concrete, specific>

If you find nothing, say so explicitly and name which of the six categories you
actively checked and how. "Looks fine" is not a review.

End with: \`CROSS-LANE VERDICT: CLEAN\` or \`CROSS-LANE VERDICT: <n> FINDINGS (<c> critical, <i> important)\`.`;
}

module.exports = { laneTaskPrompt, barrierTaskPrompt, crossLaneReviewPrompt, laneBoundary };
