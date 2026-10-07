/**
 * Logic tests for Recovery Agent collections behavior.
 * Exercises the local tool executor (mirrors the deployed tools) against the
 * in-memory store, plus the triage keyword-fallback classifier.
 */
import { executeToolCall } from '../demo/local/tools';
import { seed, getConversation, accounts, DEMO_PHONE } from '../demo/local/store';
import type { Conversation } from '../lib/shared/types';

function freshConv(): Conversation {
  // reset store between tests
  accounts.clear();
  seed();
  return getConversation(DEMO_PHONE);
}

describe('check_balance', () => {
  test('finds account by recipient', async () => {
    const conv = freshConv();
    const r: any = await executeToolCall('check_balance', { recipientId: DEMO_PHONE }, conv);
    expect(r.found).toBe(true);
    expect(r.accounts[0].pastDue).toBe('$84.00');
    expect(r.accounts[0].daysPastDue).toBe(32);
  });
  test('returns not-found for unknown recipient', async () => {
    const conv = freshConv();
    const r: any = await executeToolCall('check_balance', { recipientId: '+10000000000' }, conv);
    expect(r.found).toBe(false);
  });
});

describe('offer_payment_plan', () => {
  test('splits the balance into installments that cover it', async () => {
    const conv = freshConv();
    const r: any = await executeToolCall('offer_payment_plan', { accountId: 'ACCT-TEL-80231', installments: 3, frequency: 'biweekly' }, conv);
    expect(r.success).toBe(true);
    expect(r.plan.installments).toBe(3);
    expect(r.plan.installment).toBe('$28.00');
    expect(accounts.get('ACCT-TEL-80231')!.status).toBe('plan_active');
  });
  test('clamps installments to the 2-6 range', async () => {
    const conv = freshConv();
    const r: any = await executeToolCall('offer_payment_plan', { accountId: 'ACCT-TEL-80231', installments: 99, frequency: 'monthly' }, conv);
    expect(r.plan.installments).toBe(6);
  });
});

describe('apply_hardship', () => {
  test('sets hardship hold and clears suspension', async () => {
    const conv = freshConv();
    const r: any = await executeToolCall('apply_hardship', { accountId: 'ACCT-TEL-80231', reason: 'job loss' }, conv);
    expect(r.success).toBe(true);
    const a = accounts.get('ACCT-TEL-80231')!;
    expect(a.status).toBe('hardship_hold');
    expect(a.suspensionDate).toBeUndefined();
  });
});

describe('log_dispute', () => {
  test('pauses collection by moving account to in_dispute', async () => {
    const conv = freshConv();
    await executeToolCall('log_dispute', { accountId: 'ACCT-TEL-80231', reason: 'unrecognized $20 charge' }, conv);
    expect(accounts.get('ACCT-TEL-80231')!.status).toBe('in_dispute');
  });
});

describe('escalate_to_human — compliance', () => {
  test('opt-out is flagged', async () => {
    const conv = freshConv();
    const r: any = await executeToolCall('escalate_to_human', { recipientId: DEMO_PHONE, reason: 'opt_out' }, conv);
    expect(r.optedOut).toBe(true);
    expect(r.message).toMatch(/will not receive/i);
  });
  test('non-opt-out escalation routes to specialist', async () => {
    const conv = freshConv();
    const r: any = await executeToolCall('escalate_to_human', { recipientId: DEMO_PHONE, reason: 'customer mentioned a lawyer' }, conv);
    expect(r.optedOut).toBe(false);
    expect(r.message).toMatch(/specialist/i);
  });
});

describe('send_receipt', () => {
  test('reports success (SES path)', async () => {
    const conv = freshConv();
    const r: any = await executeToolCall('send_receipt', { recipientId: DEMO_PHONE, subject: 'Plan Confirmed', body: 'details' }, conv);
    expect(r.success).toBe(true);
  });
});
