/**
 * Next-Best-Action engine (pure core).
 *
 * The AI RECOMMENDS; the deterministic policy engine AUTHORIZES. This module
 * holds everything that must be testable without a live Bedrock call:
 *   - the strict schema validator for model output,
 *   - the heuristic fallback (used when the model times out / returns garbage),
 *   - `authorize()`, which runs the recommendation through recovery-policy and
 *     guarantees the model can NEVER override a policy denial.
 *
 * The Bedrock call itself lives in lib/lambda/next-best-action/index.ts and
 * delegates validation + authorization back here.
 */

import type {
  Account,
  AuthorizedAction,
  Channel,
  NbaAction,
  NextBestAction,
  PolicyContext,
} from './types';
import { CHANNEL_COST_USD, selectOutreachChannel, type AccountSignals } from './channel-strategy';
import { evaluateOutbound } from './recovery-policy';

const VALID_ACTIONS: ReadonlySet<string> = new Set<NbaAction>([
  'contact', 'wait', 'offer_plan', 'hold', 'escalate', 'close',
]);
const VALID_CHANNELS: ReadonlySet<string> = new Set<Channel | 'none'>([
  'email', 'sms', 'rcs', 'whatsapp', 'none',
]);

/**
 * Validate raw (parsed-JSON) model output against the NextBestAction schema.
 * Returns null when invalid — the caller then uses the heuristic fallback.
 * No throw: invalid model output must degrade safely, not crash the handler.
 */
export function validateRecommendation(raw: unknown): NextBestAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  if (typeof r.action !== 'string' || !VALID_ACTIONS.has(r.action)) return null;
  const channel = r.channel ?? 'none';
  if (typeof channel !== 'string' || !VALID_CHANNELS.has(channel)) return null;
  if (typeof r.reason !== 'string' || r.reason.trim().length === 0) return null;

  // Confidence: coerce to [0,1]; non-numeric → treat as missing (heuristic basis).
  let confidence = typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? r.confidence : NaN;
  const confidenceBasis: 'model' | 'heuristic' = Number.isFinite(confidence) ? 'model' : 'heuristic';
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.min(1, Math.max(0, confidence));

  const expectedCostUsd =
    typeof r.expectedCostUsd === 'number' && Number.isFinite(r.expectedCostUsd) && r.expectedCostUsd >= 0
      ? r.expectedCostUsd
      : channel !== 'none'
        ? CHANNEL_COST_USD[channel as Channel]
        : 0;

  const nextReviewAt = typeof r.nextReviewAt === 'string' ? r.nextReviewAt : undefined;

  // A contact action must name a real channel; "contact + none" is incoherent.
  if (r.action === 'contact' && channel === 'none') return null;

  return {
    action: r.action as NbaAction,
    channel: channel as Channel | 'none',
    reason: r.reason.trim().slice(0, 500),
    confidence,
    confidenceBasis,
    expectedCostUsd,
    nextReviewAt,
  };
}

/**
 * Deterministic heuristic fallback — reuses the proven escalation-ladder
 * (selectOutreachChannel) so a model failure degrades to the baseline strategy
 * rather than to nothing.
 */
export function heuristicRecommendation(account: Account, now: Date = new Date()): NextBestAction {
  // Held / restricted accounts: the safe heuristic is to hold or escalate.
  if (account.restricted) {
    return { action: 'escalate', channel: 'none', reason: 'Restricted account (legal/bankruptcy) — human only.', confidence: 0.9, confidenceBasis: 'heuristic', expectedCostUsd: 0 };
  }
  if (account.status === 'hardship_hold') {
    return { action: 'hold', channel: 'none', reason: 'Hardship hold in effect — suppress collection.', confidence: 0.9, confidenceBasis: 'heuristic', expectedCostUsd: 0 };
  }
  if (account.status === 'in_dispute') {
    return { action: 'hold', channel: 'none', reason: 'Dispute open — collection paused pending review.', confidence: 0.9, confidenceBasis: 'heuristic', expectedCostUsd: 0 };
  }
  if (account.optedOut) {
    return { action: 'close', channel: 'none', reason: 'Customer globally opted out.', confidence: 0.95, confidenceBasis: 'heuristic', expectedCostUsd: 0 };
  }

  const signals: AccountSignals = {
    lastResponseChannel: account.lastResponseChannel,
    optedOutChannels: account.optedOutChannels ?? [],
    rcsCapable: account.rcsCapable,
    whatsappReachable: account.whatsappReachable,
    pastDueCents: account.pastDueCents,
    daysPastDue: account.daysPastDue,
    attemptsWithoutResponse: account.attemptsWithoutResponse ?? 0,
    localHour: now.getUTCHours(),
  };
  const ladder = selectOutreachChannel(signals);
  return {
    action: 'contact',
    channel: ladder.channel,
    reason: `Heuristic ladder: ${ladder.reason}`,
    confidence: 0.5,
    confidenceBasis: 'heuristic',
    expectedCostUsd: ladder.estCostUsd,
  };
}

/**
 * Run a (validated) recommendation through the deterministic policy engine.
 * The model can NEVER override a policy denial: when policy denies an outbound
 * `contact`, the executed action is downgraded to `wait` (or `hold`/`escalate`
 * for a hard stop), regardless of what the model asked for.
 */
export function authorize(
  account: Account,
  recommendation: NextBestAction,
  source: 'model' | 'heuristic-fallback',
  ctx: PolicyContext = {},
): AuthorizedAction {
  // Only outbound-contact actions need the outbound policy gate.
  const needsOutbound = recommendation.action === 'contact' || recommendation.action === 'offer_plan';
  const channel: Channel | undefined =
    recommendation.channel !== 'none' ? (recommendation.channel as Channel) : ctx.channel;

  const policyDecision = needsOutbound
    ? evaluateOutbound(account, { ...ctx, channel })
    : evaluateOutbound(account, { ...ctx, channel }); // still evaluated for audit even on hold/escalate/close

  let executed: NbaAction = recommendation.action;
  if (needsOutbound && !policyDecision.allowed) {
    // Downgrade: hard stops → hold/escalate; soft limits (quiet hours, cap) → wait.
    const hardStop =
      policyDecision.reasonCode === 'GLOBAL_OPT_OUT' ||
      policyDecision.reasonCode === 'CHANNEL_OPT_OUT' ||
      policyDecision.reasonCode === 'HARDSHIP_HOLD' ||
      policyDecision.reasonCode === 'DISPUTE_HOLD' ||
      policyDecision.reasonCode === 'ACCOUNT_NOT_COLLECTIBLE';
    const restricted = policyDecision.reasonCode === 'RESTRICTED_HUMAN_ONLY';
    executed = restricted ? 'escalate' : hardStop ? 'hold' : 'wait';
  }

  return { recommendation, policyDecision, executed, source };
}
