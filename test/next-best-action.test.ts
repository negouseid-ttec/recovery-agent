/**
 * Next-Best-Action engine + decision-audit tests.
 * Covers schema validation, heuristic fallback, and the hard rule that policy
 * denial overrides any AI recommendation. No live Bedrock call.
 */
import {
  validateRecommendation,
  heuristicRecommendation,
  authorize,
} from '../lib/shared/next-best-action';
import { recordDecision, minimizeSignals, InMemoryDecisionSink } from '../lib/shared/decision-audit';
import type { Account, NextBestAction } from '../lib/shared/types';

function acct(overrides: Partial<Account> = {}): Account {
  return {
    accountId: 'ACCT-1',
    recipientId: '+15551230001',
    customerId: 'CUST-1',
    customerName: 'Test',
    productType: 'mobile',
    pastDueCents: 8400,
    totalBalanceCents: 8400,
    daysPastDue: 32,
    status: 'past_due',
    monthlyChargeCents: 5000,
    ...overrides,
  };
}
const noon = new Date('2026-10-12T16:00:00Z');

describe('validateRecommendation — schema', () => {
  test('accepts a well-formed recommendation', () => {
    const r = validateRecommendation({ action: 'contact', channel: 'sms', reason: 'overdue, no reply', confidence: 0.7, expectedCostUsd: 0.0075 });
    expect(r).not.toBeNull();
    expect(r!.action).toBe('contact');
    expect(r!.confidenceBasis).toBe('model');
  });
  test('rejects an invalid action', () => {
    expect(validateRecommendation({ action: 'nuke', channel: 'sms', reason: 'x' })).toBeNull();
  });
  test('rejects an invalid channel', () => {
    expect(validateRecommendation({ action: 'contact', channel: 'carrier-pigeon', reason: 'x' })).toBeNull();
  });
  test('rejects contact with channel none (incoherent)', () => {
    expect(validateRecommendation({ action: 'contact', channel: 'none', reason: 'x' })).toBeNull();
  });
  test('rejects empty reason', () => {
    expect(validateRecommendation({ action: 'wait', channel: 'none', reason: '' })).toBeNull();
  });
  test('missing confidence degrades to heuristic basis, clamped', () => {
    const r = validateRecommendation({ action: 'wait', channel: 'none', reason: 'hold off' });
    expect(r!.confidenceBasis).toBe('heuristic');
    expect(r!.confidence).toBeGreaterThanOrEqual(0);
    expect(r!.confidence).toBeLessThanOrEqual(1);
  });
  test('non-object input returns null (no throw)', () => {
    expect(validateRecommendation('garbage')).toBeNull();
    expect(validateRecommendation(null)).toBeNull();
  });
});

describe('heuristicRecommendation — safe fallback', () => {
  test('hardship hold → hold', () => {
    expect(heuristicRecommendation(acct({ status: 'hardship_hold' }), noon).action).toBe('hold');
  });
  test('restricted → escalate', () => {
    expect(heuristicRecommendation(acct({ restricted: true }), noon).action).toBe('escalate');
  });
  test('opted out → close', () => {
    expect(heuristicRecommendation(acct({ optedOut: true }), noon).action).toBe('close');
  });
  test('clean past-due → contact via the ladder', () => {
    const r = heuristicRecommendation(acct({ attemptsWithoutResponse: 0 }), noon);
    expect(r.action).toBe('contact');
    expect(r.channel).toBe('email');
    expect(r.confidenceBasis).toBe('heuristic');
  });
});

describe('authorize — policy overrides AI', () => {
  test('AI says contact but global opt-out → executed downgraded to hold', () => {
    const rec: NextBestAction = { action: 'contact', channel: 'sms', reason: 'push now', confidence: 0.9, confidenceBasis: 'model', expectedCostUsd: 0.0075 };
    const result = authorize(acct({ optedOut: true }), rec, 'model', { now: noon, channel: 'sms' });
    expect(result.policyDecision.allowed).toBe(false);
    expect(result.policyDecision.reasonCode).toBe('GLOBAL_OPT_OUT');
    expect(result.executed).toBe('hold'); // never 'contact'
    expect(result.executed).not.toBe(rec.action);
  });

  test('AI says contact on a hardship hold → downgraded (no outbound)', () => {
    const rec: NextBestAction = { action: 'contact', channel: 'email', reason: 'remind', confidence: 0.8, confidenceBasis: 'model', expectedCostUsd: 0.0001 };
    const result = authorize(acct({ status: 'hardship_hold' }), rec, 'model', { now: noon, channel: 'email' });
    expect(result.executed).toBe('hold');
  });

  test('AI says contact but restricted → escalate', () => {
    const rec: NextBestAction = { action: 'contact', channel: 'sms', reason: 'x', confidence: 0.8, confidenceBasis: 'model', expectedCostUsd: 0.0075 };
    const result = authorize(acct({ restricted: true }), rec, 'model', { now: noon, channel: 'sms' });
    expect(result.executed).toBe('escalate');
  });

  test('quiet hours soft-limit → wait (not a hard stop)', () => {
    const lateNight = new Date('2026-10-12T04:00:00Z');
    const rec: NextBestAction = { action: 'contact', channel: 'sms', reason: 'x', confidence: 0.8, confidenceBasis: 'model', expectedCostUsd: 0.0075 };
    const result = authorize(acct({ timezone: 'America/New_York' }), rec, 'model', { now: lateNight, channel: 'sms' });
    expect(result.policyDecision.reasonCode).toBe('QUIET_HOURS');
    expect(result.executed).toBe('wait');
  });

  test('clean account → contact is authorized unchanged', () => {
    const rec: NextBestAction = { action: 'contact', channel: 'email', reason: 'x', confidence: 0.8, confidenceBasis: 'model', expectedCostUsd: 0.0001 };
    const result = authorize(acct(), rec, 'model', { now: noon, channel: 'email' });
    expect(result.policyDecision.allowed).toBe(true);
    expect(result.executed).toBe('contact');
  });
});

describe('decision audit', () => {
  test('minimizeSignals drops/redacts sensitive fields', () => {
    const out = minimizeSignals({ customerName: 'Dana', email: 'd@x.com', status: 'past_due', note: 'call +15551230001', pastDueCents: 8400 });
    expect(out.customerName).toBeUndefined();
    expect(out.email).toBeUndefined();
    expect(out.status).toBe('past_due');
    expect(out.pastDueCents).toBe(8400);
    expect(out.note).toBe('[redacted]'); // long digit string redacted
  });

  test('recordDecision persists an auditable entry with an id', async () => {
    const sink = new InMemoryDecisionSink();
    const entry = await recordDecision(sink, {
      correlationId: 'OUT-1',
      accountId: 'ACCT-1',
      signals: { status: 'past_due', pastDueCents: 8400 },
      policyDecision: { allowed: true, reasonCode: 'ALLOWED', reason: 'ok', evaluatedAt: noon.toISOString() },
      executedAction: 'contact',
      executionResult: 'dispatched',
      estCostUsd: 0.0075,
    }, noon);
    expect(entry.decisionId).toMatch(/^DEC-/);
    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0].executedAction).toBe('contact');
  });

  test('recordDecision never throws when the sink fails', async () => {
    const failing = { put: async () => { throw new Error('ddb down'); } };
    await expect(
      recordDecision(failing, {
        correlationId: 'OUT-2', accountId: 'ACCT-1', signals: {},
        policyDecision: { allowed: false, reasonCode: 'GLOBAL_OPT_OUT', reason: 'x', evaluatedAt: noon.toISOString() },
        executedAction: 'skip', executionResult: 'blocked',
      }, noon),
    ).resolves.toBeDefined();
  });
});
