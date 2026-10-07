/**
 * Channel Strategy — the "why" behind omnichannel outreach.
 *
 * This is the intelligence that makes Recovery Agent an omnichannel STRATEGY,
 * not just four channels. It decides WHICH channel to use for the next outreach
 * attempt, based on cost, intrusiveness, device capability, account value/risk,
 * prior engagement, quiet hours, and per-channel opt-outs — and returns the
 * decision WITH a human-readable reason.
 *
 * Principle: start on the cheapest, least-intrusive channel that can work;
 * escalate only when there is no response; stop the ladder the instant the
 * customer engages on ANY channel and continue there.
 */

import type { Channel } from './types';

/** Approximate per-message cost + intrusiveness, cheapest/softest first. */
export const CHANNEL_LADDER: Channel[] = ['email', 'sms', 'rcs', 'whatsapp'];

/** Illustrative unit economics (USD per message) for the ROI narrative. */
export const CHANNEL_COST_USD: Record<Channel, number> = {
  email: 0.0001, // SES — effectively free
  sms: 0.0075, // EUM SMS
  rcs: 0.012, // EUM RCS (richer, pricier)
  whatsapp: 0.035, // EUM Social — conversation-based pricing
};

export interface AccountSignals {
  /** Channel the customer last RESPONDED on (strongest signal). */
  lastResponseChannel?: Channel;
  /** Channels the customer has explicitly opted OUT of (per-channel). */
  optedOutChannels?: Channel[];
  /** Device supports RCS (else RCS falls back to SMS). */
  rcsCapable?: boolean;
  /** Has a WhatsApp number on file / previously messaged on WhatsApp. */
  whatsappReachable?: boolean;
  /** Past-due amount in cents (value/risk). */
  pastDueCents: number;
  /** Days past due (urgency). */
  daysPastDue: number;
  /** How many prior outreach attempts got NO response. */
  attemptsWithoutResponse: number;
  /** Local hour (0-23) for the customer, for quiet-hours checks. */
  localHour?: number;
}

export interface ChannelDecision {
  channel: Channel;
  reason: string;
  /** The ladder step index (0 = first/cheapest). */
  ladderStep: number;
  estCostUsd: number;
  /** True if we deliberately held off (e.g., quiet hours, all opted out). */
  hold?: boolean;
}

const HIGH_VALUE_CENTS = 40000; // $400+ justifies the premium channel
const QUIET_START = 21; // 9pm
const QUIET_END = 8; // 8am

/**
 * Choose the channel for the NEXT outreach attempt.
 */
export function selectOutreachChannel(sig: AccountSignals): ChannelDecision {
  const optedOut = new Set(sig.optedOutChannels ?? []);

  const decide = (channel: Channel, reason: string): ChannelDecision => ({
    channel,
    reason,
    ladderStep: CHANNEL_LADDER.indexOf(channel),
    estCostUsd: CHANNEL_COST_USD[channel],
  });

  // 0. Quiet hours — hold non-email outreach overnight (email is non-intrusive).
  if (sig.localHour !== undefined && (sig.localHour >= QUIET_START || sig.localHour < QUIET_END)) {
    if (!optedOut.has('email')) {
      return { ...decide('email', `Quiet hours (${sig.localHour}:00) — using non-intrusive email only; will escalate during daytime.`), hold: true };
    }
  }

  // 1. Strongest signal: reply on the channel the customer last engaged on.
  if (sig.lastResponseChannel && !optedOut.has(sig.lastResponseChannel)) {
    return decide(sig.lastResponseChannel, `Customer last engaged on ${sig.lastResponseChannel.toUpperCase()} — continue the conversation there.`);
  }

  // 2. No engagement yet → climb the escalation ladder by attempt count,
  //    skipping opted-out / unreachable / unsupported channels.
  const attempt = Math.max(0, sig.attemptsWithoutResponse);
  const highValue = sig.pastDueCents >= HIGH_VALUE_CENTS;

  // Build the eligible ladder for THIS account. RCS stays in the ladder even if
  // the device isn't RCS-capable — we handle that as an RCS→SMS fallback below,
  // so the escalation step count stays stable.
  const eligible = CHANNEL_LADDER.filter((ch) => {
    if (optedOut.has(ch)) return false;
    if (ch === 'whatsapp' && !sig.whatsappReachable) return false;
    // Reserve the premium WhatsApp touch for high-value or very-overdue accounts.
    if (ch === 'whatsapp' && !highValue && sig.daysPastDue < 30) return false;
    return true;
  });

  if (eligible.length === 0) {
    return { ...decide('email', 'All richer channels opted out/unavailable — email is the only compliant path.'), hold: optedOut.has('email') };
  }

  // Pick the ladder step for this attempt, clamped to the eligible list.
  const idx = Math.min(attempt, eligible.length - 1);
  const picked = eligible[idx];

  // RCS fallback: if we'd use RCS but the device isn't confirmed RCS-capable,
  // fall back to SMS (unless SMS is opted out, in which case keep RCS and let
  // the carrier's own RCS→SMS fallback handle it).
  if (picked === 'rcs' && sig.rcsCapable !== true) {
    if (!optedOut.has('sms')) {
      return decide('sms', `Attempt ${attempt + 1}: would use RCS, but device isn't confirmed RCS-capable — falling back to SMS.`);
    }
  }

  const why =
    attempt === 0
      ? `First touch on the cheapest channel (${picked.toUpperCase()}, ~$${CHANNEL_COST_USD[picked].toFixed(4)}/msg).`
      : picked === 'whatsapp'
        ? `Attempt ${attempt + 1}: no response on cheaper channels and ${highValue ? 'high-value balance' : 'severely overdue'} — escalating to WhatsApp for a richer, personal touch.`
        : `Attempt ${attempt + 1}: no response yet — escalating to ${picked.toUpperCase()} (higher reach, higher cost).`;

  return decide(picked, why);
}
