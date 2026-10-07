/**
 * Local tool executor — mirrors lib/lambda/agent-orchestrator/tools.ts against
 * the in-memory store; captures outbound (SES) to a transcript.
 */
import { v4 as uuid } from 'uuid';
import type { Conversation, Account, PaymentPlan, Channel } from '../../lib/shared/types';
import { accounts, plans } from './store';

export interface TranscriptEntry { direction: 'inbound' | 'outbound'; channel: Channel; text: string; }
export const transcript: TranscriptEntry[] = [];
export const record = (e: TranscriptEntry) => transcript.push(e);

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

export async function executeToolCall(tool: string, input: Record<string, unknown>, conv: Conversation): Promise<unknown> {
  switch (tool) {
    case 'check_balance': return checkBalance(input, conv);
    case 'offer_payment_plan': return offerPlan(input, conv);
    case 'record_promise_to_pay': return recordPromise(input, conv);
    case 'apply_hardship': return applyHardship(input);
    case 'log_dispute': return logDispute(input, conv);
    case 'send_receipt': return sendReceipt(input, conv);
    case 'escalate_to_human': return escalate(input);
    default: return { error: `unknown tool ${tool}` };
  }
}

function sanitize(a: Account) {
  return { accountId: a.accountId, customerName: a.customerName, productType: a.productType,
    pastDue: dollars(a.pastDueCents), totalBalance: dollars(a.totalBalanceCents),
    daysPastDue: a.daysPastDue, suspensionDate: a.suspensionDate, status: a.status, monthlyCharge: dollars(a.monthlyChargeCents) };
}

function checkBalance(input: Record<string, unknown>, conv: Conversation) {
  const { accountId, recipientId } = input as { accountId?: string; recipientId?: string };
  if (accountId) { const a = accounts.get(accountId); return a ? { found: true, account: sanitize(a) } : { found: false }; }
  const list = [...accounts.values()].filter((a) => a.recipientId === (recipientId ?? conv.recipientId));
  return list.length ? { found: true, accounts: list.map(sanitize) } : { found: false, message: 'No account found.' };
}

function offerPlan(input: Record<string, unknown>, conv: Conversation) {
  const { accountId, installments, frequency } = input as { accountId: string; installments: number; frequency: 'weekly'|'biweekly'|'monthly' };
  const a = accounts.get(accountId); if (!a) return { success: false, message: 'not found' };
  const n = Math.max(2, Math.min(6, Math.round(installments)));
  const per = Math.ceil(a.pastDueCents / n);
  const first = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];
  const plan: PaymentPlan = { planId: uuid(), accountId, recipientId: conv.recipientId, totalCents: a.pastDueCents, installmentCents: per, installments: n, frequency, firstPaymentDate: first, status: 'accepted', createdAt: new Date().toISOString() };
  plans.set(plan.planId, plan); a.status = 'plan_active';
  return { success: true, plan: { total: dollars(a.pastDueCents), installment: dollars(per), installments: n, frequency, firstPaymentDate: first }, message: `${n} ${frequency} payments of ${dollars(per)}, first ${first}.` };
}

function recordPromise(input: Record<string, unknown>, conv: Conversation) {
  const { accountId, promisedDate } = input as { accountId: string; promisedDate: string };
  const a = accounts.get(accountId); if (!a) return { success: false }; a.status = 'promise_active';
  return { success: true, amount: dollars(a.pastDueCents), promisedDate, message: `Promise to pay ${dollars(a.pastDueCents)} by ${promisedDate} recorded.` };
}

function applyHardship(input: Record<string, unknown>) {
  const { accountId, reason } = input as { accountId: string; reason: string };
  const a = accounts.get(accountId); if (!a) return { success: false }; a.status = 'hardship_hold'; a.suspensionDate = undefined;
  return { success: true, message: `Hardship hold applied (${reason}). Late fees suspended, no interruption, specialist will follow up.` };
}

function logDispute(input: Record<string, unknown>, conv: Conversation) {
  const { accountId, reason } = input as { accountId: string; reason: string };
  const a = accounts.get(accountId); if (a) a.status = 'in_dispute';
  return { success: true, message: `Dispute logged: ${reason}. Collection paused while we review.` };
}

function sendReceipt(input: Record<string, unknown>, conv: Conversation) {
  const { subject, body } = input as { subject: string; body: string };
  record({ direction: 'outbound', channel: 'email', text: `Subject: ${subject}\n${body}` });
  return { success: true, message: 'Confirmation email sent.' };
}

function escalate(input: Record<string, unknown>) {
  const { reason } = input as { reason: string };
  const optOut = /opt.?out|stop|cease/i.test(reason);
  return { success: true, optedOut: optOut, referenceNumber: `ESC-${Date.now()}`, message: optOut ? 'You will not receive further messages. Specialist notified.' : 'Specialist notified; will reach out within one business day.' };
}
