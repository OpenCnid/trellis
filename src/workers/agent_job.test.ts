import { describe, expect, it } from 'vitest';
import { parseAgentJobData } from './agent_job';

describe('parseAgentJobData', () => {
  it('accepts a production goal without an oracle', () => {
    const parsed = parseAgentJobData({ goal: 'audit contested facts', goalId: 'g-1' });
    expect(parsed).toEqual({ goal: 'audit contested facts', goalId: 'g-1' });
  });

  it('validates an attached oracle script', () => {
    const parsed = parseAgentJobData({
      goal: 'g',
      goalId: 'id',
      oracle: { steps: [{ decision: { action: 'finish', finalAnswer: 'x' } }] },
    });
    expect(parsed.oracle?.steps).toHaveLength(1);
  });

  it('rejects missing fields and malformed oracles', () => {
    expect(() => parseAgentJobData({ goalId: 'g' })).toThrow(/Invalid agent_queue job data/);
    expect(() => parseAgentJobData({ goal: '', goalId: 'g' })).toThrow(/Invalid agent_queue job data/);
    expect(() => parseAgentJobData({ goal: 'g', goalId: 'id', oracle: { steps: [] } }))
      .toThrow(/Invalid agent_queue job data/);
    expect(() => parseAgentJobData({ goal: 'g', goalId: 'id', oracle: { steps: [{ decision: { action: 'noop' } }] } }))
      .toThrow(/Invalid agent_queue job data/);
  });
});
