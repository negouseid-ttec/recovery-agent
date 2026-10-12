/**
 * Phase 2 benchmark invariants — run the harness and assert the properties a
 * technical judge cares about hold on the fixture set.
 */
import { runBenchmark, FIXTURES } from '../demo/benchmark/run';

describe('benchmark harness', () => {
  const m = runBenchmark();

  test('every hard-stop account is blocked (recall = 1.0)', () => {
    expect(m.hardStopRecall).toBe(1);
    expect(m.hardStopFalseNeg).toBe(0);
  });

  test('no contactable account is wrongly blocked (precision = 1.0)', () => {
    expect(m.hardStopPrecision).toBe(1);
    expect(m.hardStopFalsePos).toBe(0);
  });

  test('the AI/heuristic NEVER contacts on a policy denial (0 violations)', () => {
    expect(m.aiOverrideViolations).toBe(0);
  });

  test('authorized channel tracks the deterministic baseline on contactable accounts', () => {
    // The heuristic path reuses selectOutreachChannel, so agreement should be total.
    expect(m.baselineAgreementRate).toBe(1);
  });

  test('covers both hard-stop and contactable classes', () => {
    expect(m.total).toBe(FIXTURES.length);
    expect(m.contactable).toBeGreaterThan(0);
    expect(m.hardStopTruePos).toBeGreaterThan(0);
  });
});
