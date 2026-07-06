import { describe, expect, it, vi } from 'vitest';
import { runInitializationTasks } from './database_init';

describe('runInitializationTasks', () => {
  it('runs every initializer and reports failures for a nonzero bootstrap exit', async () => {
    const events: Record<string, unknown>[] = [];
    const second = vi.fn(async () => undefined);

    const result = await runInitializationTasks([
      {
        name: 'postgres',
        run: async () => {
          throw new Error('schema rejected');
        },
      },
      { name: 'neo4j', run: second },
    ], fields => events.push(fields));

    expect(second).toHaveBeenCalledOnce();
    expect(result).toEqual({ failures: ['postgres'] });
    expect(events).toContainEqual({
      event: 'database.initialization_failed',
      resource: 'postgres',
      errorType: 'Error',
      message: 'schema rejected',
    });
  });

  it('reports success only when every initializer succeeds', async () => {
    const result = await runInitializationTasks([
      { name: 'postgres', run: async () => undefined },
      { name: 'neo4j', run: async () => undefined },
    ], () => undefined);

    expect(result.failures).toEqual([]);
  });
});
