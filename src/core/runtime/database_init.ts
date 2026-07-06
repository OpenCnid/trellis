import { rootLogger } from '../observability/logger.js';

export interface InitializationTask {
  name: string;
  run: () => void | Promise<void>;
}

export interface InitializationResult {
  failures: string[];
}

export type StructuredEmit = (fields: Record<string, unknown>) => void;

/**
 * Runs every bootstrap task so one unavailable store does not hide the state
 * of another. Callers must exit nonzero when failures is non-empty.
 */
export async function runInitializationTasks(
  tasks: readonly InitializationTask[],
  warn: StructuredEmit = fields => rootLogger().warn(fields)
): Promise<InitializationResult> {
  const failures: string[] = [];
  for (const task of tasks) {
    try {
      await task.run();
    } catch (error) {
      failures.push(task.name);
      warn({
        event: 'database.initialization_failed',
        resource: task.name,
        errorType: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { failures };
}
