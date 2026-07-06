import { describe, expect, it, vi } from 'vitest';
import { ShutdownCoordinator } from './shutdown';

describe('ShutdownCoordinator', () => {
  it('closes higher phases first and starts resources in the same phase together', async () => {
    const order: string[] = [];
    const coordinator = new ShutdownCoordinator();
    coordinator.register('database', 10, async () => { order.push('database'); });
    coordinator.register('api', 30, async () => { order.push('api'); });
    let releaseWorkerA!: () => void;
    coordinator.register('worker-a', 20, async () => {
      order.push('worker-a');
      await new Promise<void>(resolve => { releaseWorkerA = resolve; });
    });
    coordinator.register('worker-b', 20, async () => {
      order.push('worker-b');
      releaseWorkerA();
    });

    const result = await coordinator.shutdown('SIGTERM');

    expect(order).toEqual(['api', 'worker-a', 'worker-b', 'database']);
    expect(result.failures).toEqual([]);
  });

  it('is idempotent when both termination signals arrive', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const coordinator = new ShutdownCoordinator();
    coordinator.register('worker', 20, close);

    const [a, b] = await Promise.all([
      coordinator.shutdown('SIGTERM'),
      coordinator.shutdown('SIGINT'),
    ]);

    expect(close).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('logs a failed close and continues draining lower phases', async () => {
    const warn = vi.fn();
    const databaseClose = vi.fn().mockResolvedValue(undefined);
    const coordinator = new ShutdownCoordinator(warn);
    coordinator.register('worker', 20, async () => { throw new Error('close failed'); });
    coordinator.register('database', 10, databaseClose);

    const result = await coordinator.shutdown('SIGTERM');

    expect(result.failures).toEqual(['worker']);
    expect(databaseClose).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatchObject({
      event: 'runtime.shutdown_task_failed',
      resource: 'worker',
      signal: 'SIGTERM',
    });
  });
});
