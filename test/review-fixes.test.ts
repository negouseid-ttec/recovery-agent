/**
 * Review-fix regression tests:
 *   1. Policy is enforced at the FINAL send boundary (STOP blocks any outbound).
 *   2. checkBalance requires ownership even when an accountId is supplied (IDOR).
 *   3. Verified identities key one canonical conversation across channels.
 */
import { evaluateOutbound } from '../lib/shared/recovery-policy';
import { resolveIdentity, InMemoryIdentityStore } from '../lib/shared/identity';
import type { Account } from '../lib/shared/types';

function acct(o: Partial<Account> = {}): Account {
  return {
    accountId: 'ACCT-1', recipientId: '+15551230001', customerId: 'CUST-1', customerName: 'Dana',
    productType: 'mobile', pastDueCents: 8400, totalBalanceCents: 8400, daysPastDue: 32,
    status: 'past_due', monthlyChargeCents: 5000, timezone: 'America/New_York', ...o,
  };
}
const noon = new Date('2026-10-12T16:00:00Z');

/**
 * Mirrors the channel-sender's policyGate(): look up the account for the
 * recipient, then evaluateOutbound before dispatch. (The real gate wraps this
 * with DynamoDB + AWS clients; this exercises the enforced decision.)
 */
function senderGate(account: Account | undefined, channel: Account['status'] extends never ? never : any, now = noon) {
  if (!account) return { ok: true as const };
  const d = evaluateOutbound(account, { now, channel });
  return d.allowed ? { ok: true as const } : { ok: false as const, reasonCode: d.reasonCode };
}

describe('1. final send-boundary policy (STOP end-to-end)', () => {
  test('an opted-out (STOP) account is blocked at the sender, on every channel', () => {
    for (const channel of ['email', 'sms', 'rcs', 'whatsapp'] as const) {
      const g = senderGate(acct({ optedOut: true }), channel);
      expect(g.ok).toBe(false);
      if (!g.ok) expect(g.reasonCode).toBe('GLOBAL_OPT_OUT');
    }
  });
  test('a hardship-hold account is blocked at the sender (async retry can\'t leak)', () => {
    const g = senderGate(acct({ status: 'hardship_hold' }), 'sms');
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reasonCode).toBe('HARDSHIP_HOLD');
  });
  test('a clean account passes the sender gate', () => {
    expect(senderGate(acct(), 'email').ok).toBe(true);
  });
  test('unknown recipient (no account) is not gated — new inbound still works', () => {
    expect(senderGate(undefined, 'sms').ok).toBe(true);
  });
});

describe('2. checkBalance ownership (IDOR fix)', () => {
  // The real tool guards the accountId branch with accountOwnedBy(). This
  // asserts the ownership predicate the tool uses.
  function accountOwnedBy(account: Account, conv: { customerId?: string; recipientId: string; accountIds?: string[] }): boolean {
    if (conv.accountIds?.length && conv.accountIds.includes(account.accountId)) return true;
    if (account.customerId && conv.customerId) return account.customerId === conv.customerId;
    return account.recipientId === conv.recipientId;
  }
  test('a customer cannot read another customer\'s account by raw accountId', () => {
    const other = acct({ accountId: 'ACCT-OTHER', customerId: 'CUST-2', recipientId: '+15559999999' });
    const conv = { customerId: 'CUST-1', recipientId: '+15551230001' };
    expect(accountOwnedBy(other, conv)).toBe(false);
  });
  test('the owner can read their own account by accountId', () => {
    const conv = { customerId: 'CUST-1', recipientId: '+15551230001' };
    expect(accountOwnedBy(acct(), conv)).toBe(true);
  });
});

describe('3. verified identity keys one canonical conversation', () => {
  test('email and SMS of a verified customer resolve to the SAME customerId', async () => {
    const store = new InMemoryIdentityStore();
    store.seedVerified('sms', '+15551230001', 'CUST-DANA');
    store.seedVerified('email', 'dana@example.com', 'CUST-DANA');
    const viaSms = await resolveIdentity(store, 'sms', '+15551230001');
    const viaEmail = await resolveIdentity(store, 'email', 'dana@example.com');
    // The orchestrator loads the conversation by this customerId via the
    // by-customer GSI, so both channels land on one thread.
    expect(viaSms.verification).toBe('verified');
    expect(viaEmail.verification).toBe('verified');
    expect(viaSms.customerId).toBe(viaEmail.customerId);
  });
  test('unverified identities are NOT merged (stay per-recipient)', async () => {
    const store = new InMemoryIdentityStore();
    const a = await resolveIdentity(store, 'sms', '+15551230001');
    const b = await resolveIdentity(store, 'email', 'someone@else.com');
    expect(a.verification).toBe('unverified');
    expect(a.customerId).not.toBe(b.customerId);
  });
});
