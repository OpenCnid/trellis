export interface DistributionSummary {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
}

export function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  if (!Number.isFinite(percentileValue) || percentileValue < 0 || percentileValue > 100) {
    throw new Error('percentile must be between 0 and 100');
  }
  const ordered = [...values].sort((a, b) => a - b);
  if (percentileValue === 0) return ordered[0];
  const rank = Math.ceil((percentileValue / 100) * ordered.length);
  return ordered[Math.max(0, rank - 1)];
}

export function summarize(values: readonly number[]): DistributionSummary {
  if (values.length === 0) {
    return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0 };
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    mean: total / values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
  };
}

export interface ScaleGateSample {
  documentCount: number;
  semanticFacts: number;
  fixedSweepMedianMs: number;
}

export interface MigrationDecision {
  justified: boolean;
  hubArraysInThousands: boolean;
  superlinearSweep: boolean;
  maxSourceNodeIds: number;
  arrayThreshold: number;
  arrayHeadroom: number;
  factGrowth: number;
  sweepLatencyGrowth: number;
  superlinearMultiplier: number;
  reasons: string[];
}

export function evaluateMigrationDecision(
  samples: readonly ScaleGateSample[],
  maxSourceNodeIds: number,
  arrayThreshold = 1000,
  superlinearMultiplier = 1.5
): MigrationDecision {
  if (samples.length < 2) throw new Error('at least two scale samples are required');
  const ordered = [...samples].sort((a, b) => a.documentCount - b.documentCount);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const factGrowth = first.semanticFacts === 0 ? 0 : last.semanticFacts / first.semanticFacts;
  const sweepLatencyGrowth =
    first.fixedSweepMedianMs === 0 ? 0 : last.fixedSweepMedianMs / first.fixedSweepMedianMs;
  const hubArraysInThousands = maxSourceNodeIds >= arrayThreshold;
  const superlinearSweep =
    factGrowth > 0 && sweepLatencyGrowth > factGrowth * superlinearMultiplier;
  const reasons: string[] = [];
  if (hubArraysInThousands) {
    reasons.push(
      `maximum sourceNodeIds cardinality ${maxSourceNodeIds} reached threshold ${arrayThreshold}`
    );
  }
  if (superlinearSweep) {
    reasons.push(
      `sweep latency growth ${sweepLatencyGrowth.toFixed(2)}x exceeded `
      + `${superlinearMultiplier.toFixed(2)}x semantic-fact growth ${factGrowth.toFixed(2)}x`
    );
  }
  if (reasons.length === 0) {
    reasons.push(
      `maximum sourceNodeIds cardinality ${maxSourceNodeIds} remained below ${arrayThreshold}; `
      + `sweep latency growth ${sweepLatencyGrowth.toFixed(2)}x did not exceed the gate`
    );
  }
  return {
    justified: hubArraysInThousands || superlinearSweep,
    hubArraysInThousands,
    superlinearSweep,
    maxSourceNodeIds,
    arrayThreshold,
    arrayHeadroom: Math.max(0, arrayThreshold - maxSourceNodeIds),
    factGrowth,
    sweepLatencyGrowth,
    superlinearMultiplier,
    reasons,
  };
}
