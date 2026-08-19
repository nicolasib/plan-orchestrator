'use strict';

const state = require('./state');

/**
 * Human-facing output.
 *
 * The lane plan is the artifact a person actually reviews and corrects, so it
 * shows its evidence: every edge names the rule that produced it and the text
 * that justifies it. An unexplained DAG can only be accepted or rejected whole;
 * an explained one can be corrected.
 */

const BOX = { h: '─', v: '│', tl: '┌', tr: '┐', bl: '└', br: '┘' };

function rule(title, width = 72) {
  const pad = Math.max(0, width - title.length - 4);
  return `\n${BOX.h.repeat(2)} ${title} ${BOX.h.repeat(pad)}`;
}

const STATUS_MARK = {
  [state.STATUS.DONE]: '✓',
  [state.STATUS.RUNNING]: '▶',
  [state.STATUS.PENDING]: '·',
  [state.STATUS.FAILED]: '✗',
  [state.STATUS.BLOCKED]: '■',
  [state.STATUS.INTERRUPTED]: '⚡',
};

function dag(plan, d, { planPath, overridesFile, state: st, dryRun } = {}) {
  const lines = [];
  const titleOf = (n) => {
    const t = plan.tasks.find((x) => x.n === n);
    return t ? t.title.replace(/`/g, '') : '';
  };

  lines.push(`Plan:  ${plan.title}`);
  lines.push(`File:  ${planPath}`);
  lines.push(`Lanes: max ${d.maxLanes}${dryRun ? '   (DRY RUN — nothing will be spawned)' : ''}`);
  if (overridesFile) lines.push(`Overrides applied from: ${overridesFile}`);

  if (d.done.length) {
    lines.push(rule('ALREADY COMPLETE'));
    for (const n of d.done) lines.push(`  ✓ T${n}  ${titleOf(n)}`);
    lines.push('  These are out of the graph. Conflicts against merged work are not conflicts.');
  }

  lines.push(rule(`LANES (${d.lanes.length})`));
  for (const lane of d.lanes) {
    const chain = lane.tasks.map((n) => `T${n}`).join(' → ');
    lines.push(`  Lane ${lane.id}  [weight ${lane.weight}]  ${chain}`);
    for (const n of lane.tasks) {
      const rec = st && st.tasks[String(n)];
      const mark = rec ? STATUS_MARK[rec.status] || '·' : ' ';
      lines.push(`    ${mark} T${n}  ${titleOf(n)}`);
    }
  }

  if (d.barriers.length) {
    lines.push(rule('BARRIERS (after every lane, in order)'));
    for (const n of d.barriers) {
      const rec = st && st.tasks[String(n)];
      const mark = rec ? STATUS_MARK[rec.status] || '·' : ' ';
      lines.push(`    ${mark} T${n}  ${titleOf(n)}`);
    }
  }

  const hard = d.edges.filter((e) => e.kind === 'write-write' || e.kind === 'interface' || e.kind === 'override');
  const soft = d.edges.filter((e) => e.kind === 'semantic');

  lines.push(rule(`HARD EDGES (${hard.length}) — these cannot be dropped safely`));
  if (!hard.length) lines.push('  none — every remaining task writes a disjoint file set');
  for (const e of hard) lines.push(`  T${e.from} → T${e.to}   [${e.kind}]  ${e.evidence}`);

  lines.push(rule(`SOFT EDGES (${soft.length}) — inferred, review these`));
  if (!soft.length) lines.push('  none');
  const grouped = new Map();
  for (const e of soft) {
    const key = `→ T${e.to}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(e);
  }
  for (const [key, group] of grouped) {
    lines.push(`  T${group.map((e) => e.from).join(', T')} ${key}   ${group[0].evidence.replace(/Task \d+/g, 'each')}`);
  }

  if (d.conflicts.length) {
    lines.push(rule('FILE CONFLICTS'));
    for (const c of d.conflicts) lines.push(`  ${c.path}\n      written by T${c.tasks.join(', T')} — serialized into one lane`);
  }

  const excluded = plan.tasks.filter((t) => t.excludedPaths && t.excludedPaths.length && !d.done.includes(t.n));
  if (excluded.length) {
    lines.push(rule('PATHS EXCLUDED BY NEGATION'));
    lines.push('  The plan names these to forbid touching them. Not counted as writes:');
    for (const t of excluded) lines.push(`  T${t.n}: ${t.excludedPaths.join(', ')}`);
  }

  lines.push(rule('TO CORRECT THIS PLAN'));
  lines.push(`  Write .plan-lanes-${planPath ? state.planSlug(planPath) : '<plan>'}.json beside the plan file:`);
  lines.push('');
  lines.push('    {');
  lines.push('      "dropEdges": ["3->8"],');
  lines.push('      "addEdges": [{ "from": 5, "to": 6, "reason": "shared fixture" }]');
  lines.push('    }');
  lines.push('');
  lines.push('  Then re-run `plo analyze`. When it looks right: `plo init`.');

  return lines.join('\n');
}

function runSummary(st, res) {
  const lines = [rule('RUN SUMMARY')];
  const { counts, total } = res.summary;
  lines.push(`  ${res.summary.done}/${total} tasks done` + Object.entries(counts)
    .filter(([k]) => k !== state.STATUS.DONE)
    .map(([k, v]) => `  ·  ${v} ${k}`).join(''));

  for (const lane of st.lanes) {
    const marks = lane.tasks.map((n) => {
      const rec = st.tasks[String(n)] || {};
      return `${STATUS_MARK[rec.status] || '·'}T${n}`;
    }).join(' ');
    lines.push(`  Lane ${lane.id}: ${marks}`);
  }

  if (res.stuck.length) {
    lines.push(rule('NOT DONE'));
    for (const s of res.stuck) {
      lines.push(`  T${s.n} [${s.status}] ${s.error ? `— ${String(s.error).split('\n')[0].slice(0, 160)}` : ''}`);
    }
  }
  return lines.join('\n');
}

function status(plan, st) {
  const lines = [];
  lines.push(`Plan:  ${st.plan}`);
  lines.push(`Base:  ${st.base.branch} @ ${String(st.base.commit).slice(0, 7)}`);
  lines.push(`Tests: ${st.testCommand || '(unknown)'}`);
  lines.push(`State updated: ${st.updatedAt}`);

  const titleOf = (n) => {
    const t = plan.tasks.find((x) => x.n === n);
    return t ? t.title.replace(/`/g, '') : '';
  };

  for (const lane of st.lanes) {
    lines.push(rule(`LANE ${lane.id}  (${lane.branch || 'no branch yet'})`));
    if (lane.worktree) lines.push(`  worktree: ${lane.worktree}`);
    for (const n of lane.tasks) {
      const r = st.tasks[String(n)] || {};
      const mark = STATUS_MARK[r.status] || '·';
      const bits = [];
      if (r.commits && r.commits.length) bits.push(`${r.commits.length} commit(s) ${r.commits.map((c) => c.slice(0, 7)).join(' ')}`);
      if (r.attempts > 1) bits.push(`${r.attempts} attempts`);
      if (r.turns) bits.push(`${r.turns} turns`);
      if (r.reconciled) bits.push('reconciled from git');
      lines.push(`  ${mark} T${n}  ${titleOf(n)}`);
      if (bits.length) lines.push(`        ${bits.join(' · ')}`);
      if (r.error) lines.push(`        error: ${String(r.error).split('\n')[0].slice(0, 160)}`);
      if (r.logFile) lines.push(`        log: ${r.logFile}`);
    }
  }

  if (st.barriers.length) {
    lines.push(rule('BARRIERS'));
    for (const n of st.barriers) {
      const r = st.tasks[String(n)] || {};
      lines.push(`  ${STATUS_MARK[r.status] || '·'} T${n}  ${titleOf(n)}`);
    }
  }

  lines.push(rule('INTEGRATION'));
  lines.push(`  status: ${st.integration.status}`);
  if (st.integration.mergedLanes.length) lines.push(`  merged: ${st.integration.mergedLanes.join(', ')}`);
  if (st.integration.suite) lines.push(`  suite:  ${st.integration.suite.ok ? 'PASS' : 'FAIL'}`);
  if (st.integration.review) lines.push(`  review: ${st.integration.review.verdict || (st.integration.review.clean ? 'CLEAN' : 'findings')}`);
  return lines.join('\n');
}

function integration(st, res) {
  const lines = [rule('INTEGRATION')];
  if (res.stage === 'merge' && !res.ok) {
    lines.push(`  MERGE FAILED at lane ${res.lane}`);
    lines.push(`  ${res.error}`);
    return lines.join('\n');
  }
  lines.push(`  merged lanes: ${(res.merged || st.integration.mergedLanes).join(', ') || 'none'}`);

  if (res.stage === 'barriers' && !res.ok) {
    lines.push(`  BARRIER FAILED at T${res.failedAt}`);
    return lines.join('\n');
  }
  if (res.suite) lines.push(`  full suite:   ${res.suite.ok ? 'PASS' : 'FAIL'}${res.suite.command ? ` (\`${res.suite.command}\`)` : ''}`);
  if (res.stage === 'suite' && !res.ok) {
    lines.push('');
    lines.push(`  ${res.error}`);
    lines.push('');
    lines.push('  Suite tail:');
    lines.push(String(res.suite.summary).split('\n').map((l) => `    ${l}`).join('\n'));
    return lines.join('\n');
  }
  if (res.review) {
    lines.push(`  cross-lane:   ${res.review.verdict || (res.review.clean ? 'CLEAN' : 'see report')}`);
    lines.push(`  report:       ${res.review.reportFile}`);
    if (!res.review.clean) {
      lines.push('');
      lines.push('  The cross-lane review found issues these lanes could not have seen individually.');
      lines.push('  Read the report before merging this branch anywhere.');
    }
  }
  return lines.join('\n');
}

module.exports = { dag, runSummary, status, integration, rule };
