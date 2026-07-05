import { describe, it, expect } from 'vitest';
import { StreamGate } from './stream_gate';

describe('StreamGate', () => {
  it('admits up to the cap and rejects the next acquire', () => {
    const gate = new StreamGate(2);
    expect(gate.tryAcquire()).toBeTypeOf('function');
    expect(gate.tryAcquire()).toBeTypeOf('function');
    expect(gate.tryAcquire()).toBeNull();
    expect(gate.activeCount).toBe(2);
  });

  it('release frees exactly one slot', () => {
    const gate = new StreamGate(1);
    const release = gate.tryAcquire()!;
    expect(gate.tryAcquire()).toBeNull();
    release();
    expect(gate.activeCount).toBe(0);
    expect(gate.tryAcquire()).toBeTypeOf('function');
  });

  it('double release cannot free someone else\'s slot', () => {
    const gate = new StreamGate(2);
    const releaseA = gate.tryAcquire()!;
    gate.tryAcquire();
    releaseA();
    releaseA(); // second call must be a no-op
    expect(gate.activeCount).toBe(1);
  });

  it('exposes its configured limit', () => {
    expect(new StreamGate(7).limit).toBe(7);
  });

  it('rejects a non-positive or non-integer cap', () => {
    expect(() => new StreamGate(0)).toThrow();
    expect(() => new StreamGate(-1)).toThrow();
    expect(() => new StreamGate(2.5)).toThrow();
  });
});
