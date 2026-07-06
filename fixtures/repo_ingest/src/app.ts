const DEFAULT_NAME = 'fixture';

export function greet(name: string): string {
  return `Hello, ${name || DEFAULT_NAME}.`;
}

export class Counter {
  private value = 0;

  increment(): number {
    this.value += 1;
    return this.value;
  }

  reset(): void {
    this.value = 0;
  }
}

export function farewell(name: string): string {
  return `Goodbye, ${name}.`;
}
