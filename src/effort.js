'use strict';

const { EFFORT_LEVELS } = require('./parse-plan');

/**
 * Which `--effort` a task's agent runs at.
 *
 * The level is the task's own `**Effort:**` line, read from the plan as it is
 * now, so a correction written mid-run is honoured on the next attempt. A task
 * that stopped on its own result comes back one level higher, up to `xhigh`:
 * the agent that failed at `medium` gets more room to think, not the same room
 * again. The count of those raises lives in the task's record and `reconcile`
 * clears it, so every `run`/`resume` starts each task back at its planned level.
 */

// The climb stops at xhigh. `max` is never reached by a raise — only a plan
// that asks for it gets it, and it stays there.
const LADDER = EFFORT_LEVELS.slice(0, EFFORT_LEVELS.indexOf('xhigh') + 1);

/** The planned level, raised `raises` times. Unmarked (null) stays inherited. */
function effortFor(planned, raises) {
  if (!planned) return null;
  const i = LADDER.indexOf(planned);
  if (i < 0) return planned;
  return LADDER[Math.min(i + (raises || 0), LADDER.length - 1)];
}

/** The task's `**Effort:**` level when the line names a valid one, else null. */
function plannedEffort(task) {
  return task && task.effort && task.effort.valid ? task.effort.level : null;
}

// A usage limit, a 529, an auth hiccup: the API failed, not the task. Matched
// on the agent's result and stderr together, because the CLI reports them in
// either place depending on when the request died.
const API_FAILURE = /\bAPI Error\b|\b529\b|overloaded|rate[ _-]?limit|usage limit|Unable to verify organization|authentication_failed/i;

function isApiFailure(outcome) {
  if (!outcome || outcome.ok) return false;
  return API_FAILURE.test(`${outcome.result || ''}\n${outcome.stderr || ''}`);
}

/**
 * Raise only when the agent ran to the end and the task stopped on what the
 * agent did. A run the human aborted, or an API that refused, says nothing
 * about how hard the task is.
 */
function shouldRaise(status, outcome, { aborted } = {}) {
  return status !== 'done' && !aborted && !isApiFailure(outcome);
}

module.exports = { effortFor, plannedEffort, isApiFailure, shouldRaise };
