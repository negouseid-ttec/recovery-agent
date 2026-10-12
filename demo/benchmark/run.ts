/**
 * Phase 2 Benchmark Harness — POLICY + HEURISTIC benchmark (NOT a live AI benchmark).
 *
 * SCOPE / HONESTY: this measures the DETERMINISTIC policy engine and the
 * HEURISTIC recommender against labeled fixtures. It deliberately does NOT call
 * Amazon Bedrock, so it does NOT establish real Nova/Bedrock recovery
 * performance (recovery rate, dollars recovered, decision quality vs. a human).
 * It proves safety/correctness invariants only. To benchmark the live model,
 * pass a Bedrock-backed `recommender` AND evaluate against ground-truth outcomes
 * on a replayed book — see the Phase 2 plan in the README.
 *
 * Evaluates the decision stack against a labeled fixture set WITHOUT any live
 * Bedrock call: it exercises the pure authorize() + heuristic path and the
 * deterministic policy engine, and reports metrics that matter to a technical
 * judge:
 *
 *   1. hardStopPrecision / hardStopRecall — on accounts that MUST be stopped
 *      (opt-out, holds, restricted), did policy block every one and only those?
 *      Target: 1.0 / 1.0.
 *   2. aiOverrideViolations — count of cases where the executed action was an
 *      outbound 'contact' despite a policy denial. MUST be 0.
 *   3. baselineAgreement — how often the authorized action's channel matches the
 *      deterministic selectOutreachChannel() baseline on contactable accounts
 *      (sanity that the AI/heuristic path tracks the proven ladder).
 *
 * Run:  npx ts-node demo/benchmark/run.ts     (or import runBenchmark in a test)
 *
 * Swap `recommender` for a live-Bedrock recommender to benchmark the model; the
 * default heuristic recommender keeps the harness deterministic and offline.
 */

import type { Account, AuthorizedAction, NextBestAction, PolicyContext } from '../../lib/shared/types';
import { authorize, heuristicRecommendation } from '../../lib/shared/next-best-action';
import { selectOutreachChannel, type AccountSignals } from '../../lib/shared/channel-strategy';

export interface LabeledCase {
  name: string;
  account: Account;
  /** Ground truth: must this account be hard-stopped from outbound contact? */
  mustHardStop: boolean;
}

export interface BenchmarkMetrics {
  total: number;
  hardStopTruePos: number;
  hardStopFalseNeg: number;
  hardStopFalsePos: number;
  hardStopPrecision: number;
  hardStopRecall: number;
  aiOverrideViolations: number;
  contactable: number;
  baselineAgreement: number;
  baselineAgreementRate: number;
  rows: Array<{ name: string; executed: string; policy: string; allowed: boolean }>;
}

export type Recommender = (account: Account, now: Date) => NextBestAction;

function acct(o: Partial<Account>): Account {
  return {
    accountId: o.accountId ?? 'A', recipientId: o.recipientId ?? '+15550000000', customerId: o.customerId ?? 'C',
    customerName: 'Fixture', productType: 'mobile', pastDueCents: 8400, totalBalanceCents: 8400,
    daysPastDue: 32, status: 'past_due', monthlyChargeCents: 5000, timezone: 'America/New_York', ...o,
  };
}

/** A representative labeled fixture set spanning hard stops and contactable cases. */
export const FIXTURES: LabeledCase[] = [
  { name: 'global opt-out', account: acct({ accountId: 'OPT', optedOut: true }), mustHardStop: true },
  { name: 'hardship hold', account: acct({ accountId: 'HARD', status: 'hardship_hold' }), mustHardStop: true },
  { name: 'dispute hold', account: acct({ accountId: 'DISP', status: 'in_dispute' }), mustHardStop: true },
  { name: 'restricted/legal', account: acct({ accountId: 'LEGAL', restricted: true }), mustHardStop: true },
  { name: 'already current', account: acct({ accountId: 'CUR', status: 'current', pastDueCents: 0 }), mustHardStop: true },
  { name: 'fresh past-due', account: acct({ accountId: 'PD0', attemptsWithoutResponse: 0 }), mustHardStop: false },
  { name: 'silent, 1 attempt', account: acct({ accountId: 'PD1', attemptsWithoutResponse: 1 }), mustHardStop: false },
  { name: 'silent, 2 attempts (rcs)', account: acct({ accountId: 'PD2', attemptsWithoutResponse: 2, rcsCapable: true }), mustHardStop: false },
  { name: 'high-value, 3 attempts', account: acct({ accountId: 'PDH', pastDueCents: 60000, daysPastDue: 40, attemptsWithoutResponse: 3, whatsappReachable: true, rcsCapable: true }), mustHardStop: false },
  { name: 'engaged on whatsapp', account: acct({ accountId: 'ENG', lastResponseChannel: 'whatsapp', whatsappReachable: true }), mustHardStop: false },
];

const HARD_STOP_CODES = new Set(['GLOBAL_OPT_OUT', 'CHANNEL_OPT_OUT', 'HARDSHIP_HOLD', 'DISPUTE_HOLD', 'RESTRICTED_HUMAN_ONLY', 'ACCOUNT_NOT_COLLECTIBLE']);

export function runBenchmark(
  cases: LabeledCase[] = FIXTURES,
  recommender: Recommender = heuristicRecommendation,
  now: Date = new Date('2026-10-12T16:00:00Z'), // noon ET — avoid quiet-hours noise
): BenchmarkMetrics {
  let hardStopTruePos = 0, hardStopFalseNeg = 0, hardStopFalsePos = 0;
  let aiOverrideViolations = 0, contactable = 0, baselineAgreement = 0;
  const rows: BenchmarkMetrics['rows'] = [];

  for (const c of cases) {
    const rec = recommender(c.account, now);
    const ctx: PolicyContext = { now, channel: rec.channel !== 'none' ? (rec.channel as any) : undefined };
    const result: AuthorizedAction = authorize(c.account, rec, 'model', ctx);
    const blocked = !result.policyDecision.allowed && HARD_STOP_CODES.has(result.policyDecision.reasonCode);

    if (c.mustHardStop && blocked) hardStopTruePos++;
    if (c.mustHardStop && !blocked) hardStopFalseNeg++;
    if (!c.mustHardStop && blocked) hardStopFalsePos++;

    // Invariant: never an outbound 'contact' on a denied policy.
    if (result.executed === 'contact' && !result.policyDecision.allowed) aiOverrideViolations++;

    // Baseline agreement on genuinely contactable accounts.
    if (!c.mustHardStop) {
      contactable++;
      const sig: AccountSignals = {
        lastResponseChannel: c.account.lastResponseChannel,
        optedOutChannels: c.account.optedOutChannels ?? [],
        rcsCapable: c.account.rcsCapable, whatsappReachable: c.account.whatsappReachable,
        pastDueCents: c.account.pastDueCents, daysPastDue: c.account.daysPastDue,
        attemptsWithoutResponse: c.account.attemptsWithoutResponse ?? 0, localHour: 12,
      };
      if (selectOutreachChannel(sig).channel === rec.channel) baselineAgreement++;
    }

    rows.push({ name: c.name, executed: result.executed, policy: result.policyDecision.reasonCode, allowed: result.policyDecision.allowed });
  }

  const hardStopPrecision = hardStopTruePos + hardStopFalsePos === 0 ? 1 : hardStopTruePos / (hardStopTruePos + hardStopFalsePos);
  const hardStopRecall = hardStopTruePos + hardStopFalseNeg === 0 ? 1 : hardStopTruePos / (hardStopTruePos + hardStopFalseNeg);

  return {
    total: cases.length,
    hardStopTruePos, hardStopFalseNeg, hardStopFalsePos,
    hardStopPrecision, hardStopRecall,
    aiOverrideViolations,
    contactable, baselineAgreement,
    baselineAgreementRate: contactable === 0 ? 1 : baselineAgreement / contactable,
    rows,
  };
}

// CLI entry: `npx ts-node demo/benchmark/run.ts`
if (require.main === module) {
  const m = runBenchmark();
  // eslint-disable-next-line no-console
  console.log('[scope] policy + heuristic benchmark — NOT a live Bedrock recovery benchmark.');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(m, null, 2));
}
