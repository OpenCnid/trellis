export type ShutdownSignal = 'SIGINT' | 'SIGTERM';
export type ShutdownTask = () => void | Promise<void>;

interface RegisteredTask {
  name: string;
  phase: number;
  close: ShutdownTask;
}

export interface ShutdownResult {
  signal: ShutdownSignal;
  failures: string[];
}

/**
 * Resource shutdown is phase-ordered: stop admission first, then workers,
 * queues/publishers, and finally database pools. Calls are idempotent so a
 * second termination signal cannot double-close shared clients.
 */
export class ShutdownCoordinator {
  private readonly tasks: RegisteredTask[] = [];
  private shutdownPromise: Promise<ShutdownResult> | undefined;

  constructor(
    private readonly warn: (line: string) => void = console.warn
  ) {}

  register(name: string, phase: number, close: ShutdownTask): void {
    if (this.shutdownPromise) {
      throw new Error(`Cannot register shutdown resource '${name}' after shutdown started`);
    }
    this.tasks.push({ name, phase, close });
  }

  shutdown(signal: ShutdownSignal): Promise<ShutdownResult> {
    if (!this.shutdownPromise) {
      this.shutdownPromise = this.run(signal);
    }
    return this.shutdownPromise;
  }

  private async run(signal: ShutdownSignal): Promise<ShutdownResult> {
    const failures: string[] = [];
    const phases = [...new Set(this.tasks.map(task => task.phase))]
      .sort((a, b) => b - a);
    for (const phase of phases) {
      const tasks = this.tasks.filter(task => task.phase === phase);
      await Promise.all(tasks.map(async task => {
        try {
          await task.close();
        } catch (error) {
          failures.push(task.name);
          this.warn(JSON.stringify({
            event: 'runtime.shutdown_task_failed',
            signal,
            resource: task.name,
            errorType: error instanceof Error ? error.name : typeof error,
            message: error instanceof Error ? error.message : String(error),
          }));
        }
      }));
    }
    return { signal, failures };
  }
}

export const shutdownCoordinator = new ShutdownCoordinator();
let signalHandlersInstalled = false;

export function installShutdownSignalHandlers(): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  const handle = (signal: ShutdownSignal) => {
    console.log(JSON.stringify({ event: 'runtime.shutdown_started', signal }));
    void shutdownCoordinator.shutdown(signal).then(result => {
      console.log(JSON.stringify({
        event: 'runtime.shutdown_completed',
        signal: result.signal,
        failures: result.failures,
      }));
      if (result.failures.length > 0) process.exitCode = 1;
    });
  };
  process.once('SIGTERM', () => handle('SIGTERM'));
  process.once('SIGINT', () => handle('SIGINT'));
}
