/**
 * In-memory store for the local Recovery Agent demo — telecom past-due book.
 */
import { v4 as uuid } from 'uuid';
import type { Account, PaymentPlan, Conversation } from '../../lib/shared/types';

export const DEMO_PHONE = '+15551234567';
export const DEMO_EMAIL = 'dana.whitfield@example.com';

export const accounts = new Map<string, Account>();
export const plans = new Map<string, PaymentPlan>();
export const conversations = new Map<string, Conversation>();

export function seed(): void {
  const a: Account = {
    accountId: 'ACCT-TEL-80231',
    recipientId: DEMO_PHONE,
    customerName: 'Dana Whitfield',
    productType: 'bundle',
    pastDueCents: 8400,
    totalBalanceCents: 15200,
    daysPastDue: 32,
    suspensionDate: '2026-10-16',
    status: 'past_due',
    monthlyChargeCents: 6800,
  };
  accounts.set(a.accountId, a);

  conversations.set(DEMO_PHONE, {
    recipientId: DEMO_PHONE,
    sessionId: uuid(),
    preferredChannel: 'sms',
    channels: [
      { channel: 'sms', address: DEMO_PHONE },
      { channel: 'whatsapp', address: DEMO_PHONE },
      { channel: 'email', address: DEMO_EMAIL },
    ],
    language: 'en-US',
    history: [],
    accountIds: [a.accountId],
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: new Date().toISOString(),
    ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 3600,
  });
}

export function getConversation(recipientId: string): Conversation {
  let c = conversations.get(recipientId);
  if (!c) {
    c = {
      recipientId,
      sessionId: uuid(),
      preferredChannel: 'sms',
      channels: [{ channel: 'sms', address: recipientId }],
      language: 'en-US',
      history: [],
      accountIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 3600,
    };
    conversations.set(recipientId, c);
  }
  return c;
}
