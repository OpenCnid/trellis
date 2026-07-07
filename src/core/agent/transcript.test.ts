import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ORCHESTRATOR_SYSTEM_PROMPT } from './orchestrator_prompt';
import {
  buildDecisionMessages,
  renderHistory,
  truncateForTranscript,
  TRANSCRIPT_ANSWER_CHAR_LIMIT,
} from './transcript';
import type { GoalBounds, GoalIterationRecord } from './decision';

const BOUNDS: GoalBounds = {
  maxIterationsPerGoal: 4,
  maxTasksPerGoal: 8,
  maxConcurrentTasks: 2,
  taskMaxIterations: 5,
};

const ROUND: GoalIterationRecord = {
  decision: {
    assessment: 'need one fact',
    action: 'dispatch',
    tasks: [{ taskId: 't1', query: 'what does the graph say?' }],
    finalAnswer: null,
    reason: null,
  },
  observations: [{
    taskId: 't1',
    query: 'what does the graph say?',
    status: 'ok',
    answer: 'the graph says 42',
    toolCalls: 3,
    spend: { inputTokens: 10, outputTokens: 5, subcalls: 0 },
  }],
};

describe('buildDecisionMessages', () => {
  it('leads with the orchestrator system prompt and embeds goal, budget, and history', () => {
    const messages = buildDecisionMessages('audit the contested facts', BOUNDS, [ROUND]);
    expect(messages[0]).toEqual({ role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT });
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toContain('GOAL:\naudit the contested facts');
    expect(messages[1].content).toContain('decision rounds: 2 of 4');
    expect(messages[1].content).toContain('total tasks: 1 of 8 used');
    expect(messages[1].content).toContain('at most 2');
    expect(messages[1].content).toContain('the graph says 42');
  });

  it('tells a fresh goal it is on its first round', () => {
    const messages = buildDecisionMessages('goal', BOUNDS, []);
    expect(messages[1].content).toContain('first decision round');
    expect(messages[1].content).toContain('decision rounds: 1 of 4');
  });

  it('is deterministic for identical inputs', () => {
    const a = buildDecisionMessages('goal', BOUNDS, [ROUND]);
    const b = buildDecisionMessages('goal', BOUNDS, [ROUND]);
    expect(a).toEqual(b);
  });
});

describe('transcript truncation', () => {
  it('caps each observation answer independently', () => {
    const long = 'y'.repeat(TRANSCRIPT_ANSWER_CHAR_LIMIT + 500);
    const history: GoalIterationRecord[] = [{
      decision: ROUND.decision,
      observations: [
        { ...ROUND.observations[0], answer: long },
        { ...ROUND.observations[0], taskId: 't2', answer: 'short' },
      ],
    }];
    const rendered = renderHistory(history);
    expect(rendered).toContain('[truncated, 4500 chars]');
    expect(rendered).toContain('short');
    expect(rendered).not.toContain(long);
  });

  it('leaves text under the limit untouched', () => {
    expect(truncateForTranscript('hello')).toBe('hello');
  });
});

// Guardrail 8: the orchestrator persona is plain chat completions. It
// must never be routed through rlms — whose custom_system_prompt
// REPLACES the REPL protocol prompt and whose .format() call forbids
// literal braces. Nothing in the Python half may reference it, and the
// decision path must not import the rlms-facing agent.
describe('orchestrator prompt hygiene', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');

  it('is never referenced by the Python RLM harness', () => {
    for (const file of ['trellis_agent.py', 'trellis_tools.py']) {
      const source = readFileSync(path.join(repoRoot, 'src', 'rlm', file), 'utf8');
      expect(source).not.toMatch(/ORCHESTRATOR_SYSTEM_PROMPT|orchestrator_prompt/);
    }
  });

  it('never mentions the rlms REPL protocol or its placeholders', () => {
    // The rlms base prompt fills {custom_tools_section}; an orchestrator
    // prompt containing repl fences or format placeholders would suggest
    // it was copied from (or destined for) the wrong harness.
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain('```repl');
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain('custom_tools_section');
  });

  it('states the decision contract and the no-recursive-goal rule', () => {
    for (const term of ['dispatch', 'finish', 'fail', 'JSON']) {
      expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain(term);
    }
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain('goals are never delegated as goals');
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain('NO database access');
  });
});
