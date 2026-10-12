/**
 * Deterministic policy enforcement tests — the LLM-independent authorization layer.
 */
import {
  evaluateOutbound,
  evaluateAccountAccess,
  evaluatePaymentPlan,
  evaluateAmount,
  localHour,
} from '../lib/shared/recovery-policy';
import type { Account, ResolvedIdentity } from '../lib/shared/types';

function acct(overrides: Partial<Account> = {}): Account {
  return {
    accountId: 'ACCT-1',
    recipientId: '+15551230001',
    customerId: 'CUST-1',
    customerName: 'Test Customer',
    productType: 'mobile',
    pastDueCents: 8400,
    totalBalanceCents: 8400,
    daysPastDue: 32,
    status: 'past_due',
    monthlyChargeCents: 5000,
    timezone: 'America/New_York',
    ...overrides,
  };
}

// Noon ET so quiet-hours never falsely trip in the base case.
const noonET = new Date('2026-10-12T16:00:00Z'); // 12:00 EDT

describe('outbound policy — hard compliance stops', () => {
  test('global opt-out blocks all channels', () => {
    for (const channel of ['email', 'sms', 'rcs', 'whatsapp'] as const) {
      const d = evaluateOutbound(acct({ optedOut: true }), { now: noonET, channel });
      expect(d.allowed).toBe(false);
      expect(d.reasonCode).toBe('GLOBAL_OPT_OUT');
    }
  });

  test('channel-specific opt-out blocks only that channel', () => {
    const a = acct({ optedOutChannels: ['sms'] });
    expect(evaluateOutbound(a, { now: noonET, channel: 'sms' }).allowed).toBe(false);
    expect(evaluateOutbound(a, { now: noonET, channel: 'sms' }).reasonCode).toBe('CHANNEL_OPT_OUT');
    expect(evaluateOutbound(a, { now: noonET, channel: 'email' }).allowed).toBe(true);
  });

  test('hardship hold stops further collection', () => {
    const d = evaluateOutbound(acct({ status: 'hardship_hold' }), { now: noonET, channel: 'email' });
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe('HARDSHIP_HOLD');
  });

  test('dispute hold stops further collection', () => {
    const d = evaluateOutbound(acct({ status: 'in_dispute' }), { now: noonET, channel: 'email' });
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe('DISPUTE_HOLD');
  });

  test('restricted account is human-only', () => {
    const d = evaluateOutbound(acct({ restricted: true }), { now: noonET, channel: 'email' });
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe('RESTRICTED_HUMAN_ONLY');
  });
});

describe('outbound policy — courtesy limits', () => {
  test('customer-local quiet hours block outbound', () => {
    const lateNightET = new Date('2026-10-12T03:00:00Z'); // 11pm EDT previous day
    const d = evaluateOutbound(acct(), { now: lateNightET, channel: 'sms' });
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe('QUIET_HOURS');
    expect(d.constraints?.localHour).toBe(23);
  });

  test('quiet hours respect the customer timezone, not UTC', () => {
    // 16:00 UTC = noon ET (fine) but 08:00 in a +16 zone... use a west-coast case:
    const a = acct({ timezone: 'America/Los_Angeles' });
    const earlyPT = new Date('2026-10-12T14:00:00Z'); // 7am PDT → quiet (<8)
    const d = evaluateOutbound(a, { now: earlyPT, channel: 'sms' });
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe('QUIET_HOURS');
  });

  test('minimum interval between attempts', () => {
    const a = acct({ lastOutreachAt: new Date(noonET.getTime() - 60 * 60 * 1000).toISOString() }); // 1h ago
    const d = evaluateOutbound(a, { now: noonET, channel: 'email', minIntervalMs: 20 * 3600 * 1000 });
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe('MIN_INTERVAL');
  });

  test('frequency cap per window', () => {
    const d = evaluateOutbound(acct({ outreachCountWindow: 3 }), { now: noonET, channel: 'email', maxContactsPerWindow: 3 });
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe('FREQUENCY_CAP');
  });

  test('a clean past-due account is allowed', () => {
    const d = evaluateOutbound(acct(), { now: noonET, channel: 'email' });
    expect(d.allowed).toBe(true);
    expect(d.reasonCode).toBe('ALLOWED');
  });
});

describe('account access authorization', () => {
  const verified: ResolvedIdentity = { customerId: 'CUST-1', channelIdentifier: '+15551230001', channel: 'sms', verification: 'verified', isNew: false };

  test('unverified identity cannot access an account', () => {
    const d = evaluateAccountAccess(acct(), { ...verified, verification: 'unverified' });
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe('NOT_AUTHORIZED');
  });

  test('verified owner can access their account', () => {
    expect(evaluateAccountAccess(acct(), verified).allowed).toBe(true);
  });

  test('verified identity cannot access ANOTHER customer account', () => {
    const other = acct({ accountId: 'ACCT-2', customerId: 'CUST-2', recipientId: '+15559999999' });
    const d = evaluateAccountAccess(other, verified);
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe('NOT_AUTHORIZED');
  });
});

describe('payment-plan + amount policy', () => {
  test('installments must be within [2,6]', () => {
    expect(evaluatePaymentPlan(acct(), 1).allowed).toBe(false);
    expect(evaluatePaymentPlan(acct(), 7).allowed).toBe(false);
    expect(evaluatePaymentPlan(acct(), 3).allowed).toBe(true);
  });
  test('no plan on a held account', () => {
    expect(evaluatePaymentPlan(acct({ status: 'hardship_hold' }), 3).allowed).toBe(false);
  });
  test('amount cannot exceed the past-due balance', () => {
    expect(evaluateAmount(acct(), 9000).allowed).toBe(false);
    expect(evaluateAmount(acct(), 8400).allowed).toBe(true);
    expect(evaluateAmount(acct(), 0).allowed).toBe(false);
  });
});

describe('localHour timezone helper', () => {
  test('converts UTC to the IANA zone', () => {
    expect(localHour(new Date('2026-10-12T16:00:00Z'), 'America/New_York')).toBe(12);
    expect(localHour(new Date('2026-10-12T16:00:00Z'), 'America/Los_Angeles')).toBe(9);
  });
  test('falls back to UTC on invalid zone', () => {
    expect(localHour(new Date('2026-10-12T16:00:00Z'), 'Not/AZone')).toBe(16);
  });
});
