/**
 * Recovery Agent tool implementations — DynamoDB-backed collections actions.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { v4 as uuid } from 'uuid';
import type { Conversation, Account, PaymentPlan, Promise as PromiseRecord, Dispute } from '../../shared/types';
import { evaluatePaymentPlan, evaluateAmount } from '../../shared/recovery-policy';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const lambdaClient = new LambdaClient({});

const ACCOUNT_TABLE = process.env.ACCOUNT_TABLE!;
const PLAN_TABLE = process.env.PLAN_TABLE!;
const SENDER_FUNCTION = process.env.SENDER_FUNCTION_NAME ?? 'ra-channel-sender';

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export async function executeToolCall(
  toolName: string,
  input: Record<string, unknown>,
  conversation: Conversation,
): Promise<unknown> {
  switch (toolName) {
    case 'check_balance':
      return checkBalance(input, conversation);
    case 'offer_payment_plan':
      return offerPaymentPlan(input, conversation);
    case 'accept_payment_plan':
      return acceptPaymentPlan(input, conversation);
    case 'record_promise_to_pay':
      return recordPromise(input, conversation);
    case 'apply_hardship':
      return applyHardship(input, conversation);
    case 'log_dispute':
      return logDispute(input, conversation);
    case 'send_receipt':
      return sendReceipt(input, conversation);
    case 'escalate_to_human':
      return escalateToHuman(input, conversation);
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

function sanitizeAccount(a: Account): Record<string, unknown> {
  return {
    accountId: a.accountId,
    customerName: a.customerName,
    productType: a.productType,
    pastDue: dollars(a.pastDueCents),
    totalBalance: dollars(a.totalBalanceCents),
    daysPastDue: a.daysPastDue,
    suspensionDate: a.suspensionDate,
    status: a.status,
    monthlyCharge: dollars(a.monthlyChargeCents),
  };
}

/**
 * Ownership check: the account must belong to this conversation's customer,
 * matched by canonical customerId when present, else by the recipientId the
 * conversation is keyed on. Blocks acting on another customer's account.
 */
function accountOwnedBy(account: Account, conversation: Conversation): boolean {
  if (conversation.accountIds?.length && conversation.accountIds.includes(account.accountId)) return true;
  if (account.customerId && conversation.customerId) return account.customerId === conversation.customerId;
  return account.recipientId === conversation.recipientId;
}

async function checkBalance(input: Record<string, unknown>, conversation: Conversation): Promise<unknown> {
  const { accountId, recipientId } = input as { accountId?: string; recipientId?: string };

  if (accountId) {
    const res = await ddb.send(new GetCommand({ TableName: ACCOUNT_TABLE, Key: { accountId } }));
    if (!res.Item) return { found: false, message: `No account ${accountId}.` };
    const acct = res.Item as Account;
    // Ownership: never return another customer's account by raw accountId.
    if (!accountOwnedBy(acct, conversation)) {
      return { found: false, message: 'Not authorized: that account does not belong to this customer.' };
    }
    return { found: true, account: sanitizeAccount(acct) };
  }

  // Never trust a model-supplied recipientId for lookup: only honor it when it
  // belongs to THIS conversation (its key or one of its verified channels).
  // Otherwise fall back to the conversation's own identity — the model cannot
  // pivot to another customer by passing a different recipientId.
  const ownsRequested =
    recipientId !== undefined &&
    (recipientId === conversation.recipientId ||
      (conversation.channels ?? []).some((c) => c.address === recipientId));
  const lookupId = ownsRequested ? recipientId! : conversation.recipientId;
  const res = await ddb.send(
    new QueryCommand({
      TableName: ACCOUNT_TABLE,
      IndexName: 'by-recipient',
      KeyConditionExpression: 'recipientId = :r',
      ExpressionAttributeValues: { ':r': lookupId },
    }),
  );
  if (!res.Items?.length) return { found: false, message: 'No account found for this customer.' };
  // Filter EVERY returned account through ownership — defense-in-depth even
  // though the query is keyed on the (verified) recipient identity.
  const owned = (res.Items as Account[]).filter((a) => accountOwnedBy(a, conversation));
  if (!owned.length) return { found: false, message: 'No account found for this customer.' };
  return { found: true, accounts: owned.map((a) => sanitizeAccount(a)) };
}

async function offerPaymentPlan(input: Record<string, unknown>, conversation: Conversation): Promise<unknown> {
  const { accountId, installments, frequency, firstPaymentDate } = input as {
    accountId: string;
    installments: number;
    frequency: 'weekly' | 'biweekly' | 'monthly';
    firstPaymentDate?: string;
  };

  if (!accountId || installments === undefined || !frequency) {
    return { success: false, message: 'Missing required argument: accountId, installments, and frequency are required.' };
  }

  const res = await ddb.send(new GetCommand({ TableName: ACCOUNT_TABLE, Key: { accountId } }));
  if (!res.Item) return { success: false, message: `Account ${accountId} not found.` };
  const acct = res.Item as Account;

  // Ownership: the account must belong to this conversation's customer.
  if (!accountOwnedBy(acct, conversation)) {
    return { success: false, message: 'Not authorized: this account does not belong to this customer.' };
  }

  // Deterministic policy: installment bounds + collectible/not-held status.
  const policy = evaluatePaymentPlan(acct, Math.round(Number(installments)));
  if (!policy.allowed) {
    return { success: false, policy, message: `Cannot offer a plan: ${policy.reason}` };
  }

  const n = Math.round(Number(installments));
  const installmentCents = Math.ceil(acct.pastDueCents / n);
  const first = firstPaymentDate ?? new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];

  // Honest state machine: an OFFERED plan is "proposed", not "accepted". It
  // becomes accepted only when the customer agrees (acceptPaymentPlan), and no
  // funds are "collected" until a payment provider confirms.
  const plan: PaymentPlan = {
    planId: uuid(),
    accountId,
    recipientId: conversation.recipientId,
    totalCents: acct.pastDueCents,
    installmentCents,
    installments: n,
    frequency,
    firstPaymentDate: first,
    status: 'proposed',
    createdAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: PLAN_TABLE, Item: plan }));

  return {
    success: true,
    planId: plan.planId,
    status: 'proposed',
    plan: {
      total: dollars(plan.totalCents),
      installment: dollars(installmentCents),
      installments: n,
      frequency,
      firstPaymentDate: first,
    },
    message:
      `Here's a plan option: ${n} ${frequency} payments of ${dollars(installmentCents)}, ` +
      `first on ${first}. This is an OFFER — reply to confirm and I'll set it up.`,
  };
}

async function acceptPaymentPlan(input: Record<string, unknown>, conversation: Conversation): Promise<unknown> {
  const { accountId, planId } = input as { accountId: string; planId: string };
  if (!accountId || !planId) {
    return { success: false, message: 'Missing required argument: accountId and planId are required.' };
  }
  const [acctRes, planRes] = await Promise.all([
    ddb.send(new GetCommand({ TableName: ACCOUNT_TABLE, Key: { accountId } })),
    ddb.send(new GetCommand({ TableName: PLAN_TABLE, Key: { planId } })),
  ]);
  if (!acctRes.Item) return { success: false, message: `Account ${accountId} not found.` };
  if (!planRes.Item) return { success: false, message: `Plan ${planId} not found.` };
  const acct = acctRes.Item as Account;
  const plan = planRes.Item as PaymentPlan;
  if (!accountOwnedBy(acct, conversation) || plan.accountId !== accountId) {
    return { success: false, message: 'Not authorized: plan does not belong to this customer/account.' };
  }
  // Idempotent: accepting an already-accepted/active plan is a no-op success.
  if (plan.status === 'accepted' || plan.status === 'active') {
    return { success: true, status: plan.status, message: 'Plan already accepted.' };
  }
  await ddb.send(
    new UpdateCommand({
      TableName: PLAN_TABLE,
      Key: { planId },
      UpdateExpression: 'SET #s = :s',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': 'accepted' },
    }),
  );
  await ddb.send(
    new UpdateCommand({
      TableName: ACCOUNT_TABLE,
      Key: { accountId },
      UpdateExpression: 'SET #s = :s, lastContactDate = :d',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': 'plan_active', ':d': new Date().toISOString() },
    }),
  );
  // NOTE: 'plan_active' means an accepted schedule exists — NOT that any funds
  // have been collected. Payment capture is a separate, provider-confirmed step.
  return { success: true, status: 'accepted', message: 'Payment plan accepted and activated. No funds have been charged yet; each installment is collected on its due date.' };
}

async function recordPromise(input: Record<string, unknown>, conversation: Conversation): Promise<unknown> {
  const { accountId, amountCents, promisedDate } = input as {
    accountId: string;
    amountCents?: number;
    promisedDate: string;
  };
  if (!accountId || !promisedDate) {
    return { success: false, message: 'Missing required argument: accountId and promisedDate are required.' };
  }
  const res = await ddb.send(new GetCommand({ TableName: ACCOUNT_TABLE, Key: { accountId } }));
  if (!res.Item) return { success: false, message: `Account ${accountId} not found.` };
  const acct = res.Item as Account;
  if (!accountOwnedBy(acct, conversation)) {
    return { success: false, message: 'Not authorized: this account does not belong to this customer.' };
  }
  const amount = amountCents ?? acct.pastDueCents;
  const bounds = evaluateAmount(acct, amount);
  if (!bounds.allowed) {
    return { success: false, policy: bounds, message: `Cannot record that promise: ${bounds.reason}` };
  }

  const promise: PromiseRecord = {
    promiseId: uuid(),
    accountId,
    recipientId: conversation.recipientId,
    amountCents: amount,
    promisedDate,
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: PLAN_TABLE, Item: { ...promise, planId: promise.promiseId, kind: 'promise' } }));
  await ddb.send(
    new UpdateCommand({
      TableName: ACCOUNT_TABLE,
      Key: { accountId },
      UpdateExpression: 'SET #s = :s',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': 'promise_active' },
    }),
  );
  return { success: true, amount: dollars(amount), promisedDate, message: `Promise to pay ${dollars(amount)} by ${promisedDate} recorded.` };
}

async function applyHardship(input: Record<string, unknown>, conversation: Conversation): Promise<unknown> {
  const { accountId, reason } = input as { accountId: string; reason: string };
  if (!accountId || !reason) {
    return { success: false, message: 'Missing required argument: accountId and reason are required.' };
  }
  const res = await ddb.send(new GetCommand({ TableName: ACCOUNT_TABLE, Key: { accountId } }));
  if (!res.Item) return { success: false, message: `Account ${accountId} not found.` };
  const acct = res.Item as Account;
  if (!accountOwnedBy(acct, conversation)) {
    return { success: false, message: 'Not authorized: this account does not belong to this customer.' };
  }

  // Record the hold and clear the scheduled suspension date in OUR record.
  // We only claim what this write actually did — we do not assert a downstream
  // billing system has canceled anything it hasn't confirmed.
  await ddb.send(
    new UpdateCommand({
      TableName: ACCOUNT_TABLE,
      Key: { accountId },
      UpdateExpression: 'SET #s = :s REMOVE suspensionDate',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': 'hardship_hold' },
    }),
  );
  return {
    success: true,
    status: 'hardship_hold',
    message:
      `Hardship hold recorded (${reason}). Collection outreach is now suppressed on this account and ` +
      `the scheduled suspension is paused in our records. A hardship specialist will confirm the final terms with you.`,
  };
}

async function logDispute(input: Record<string, unknown>, conversation: Conversation): Promise<unknown> {
  const { accountId, reason, amountDisputedCents } = input as {
    accountId: string;
    reason: string;
    amountDisputedCents?: number;
  };
  const dispute: Dispute = {
    disputeId: uuid(),
    accountId,
    recipientId: conversation.recipientId,
    reason,
    amountDisputedCents: amountDisputedCents ?? 0,
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: PLAN_TABLE, Item: { ...dispute, planId: dispute.disputeId, kind: 'dispute' } }));
  await ddb.send(
    new UpdateCommand({
      TableName: ACCOUNT_TABLE,
      Key: { accountId },
      UpdateExpression: 'SET #s = :s',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': 'in_dispute' },
    }),
  );
  return { success: true, disputeId: dispute.disputeId, message: `Dispute logged: ${reason}. Collection paused on the disputed amount while we review.` };
}

async function sendReceipt(input: Record<string, unknown>, conversation: Conversation): Promise<unknown> {
  const { recipientId, subject, body } = input as { recipientId?: string; subject: string; body: string };
  // Never send a receipt to a model-supplied address that isn't this customer's.
  // Honor a requested recipientId only if it's the conversation key or a known
  // channel address; otherwise send to the conversation's own identity.
  const ownsRequested =
    recipientId !== undefined &&
    (recipientId === conversation.recipientId ||
      (conversation.channels ?? []).some((c) => c.address === recipientId));
  const dest = ownsRequested ? recipientId! : conversation.recipientId;
  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: SENDER_FUNCTION,
      InvocationType: 'Event',
      Payload: Buffer.from(
        JSON.stringify({
          type: 'email',
          recipientId: dest,
          subject,
          htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#0f766e;color:#fff;padding:18px 20px;border-radius:8px 8px 0 0">
              <h2 style="margin:0">Recovery Agent — Confirmation</h2></div>
            <div style="border:1px solid #e5e7eb;border-top:none;padding:20px;border-radius:0 0 8px 8px">
              ${body.replace(/\n/g, '<br>')}
              <hr style="border-color:#e5e7eb;margin:20px 0">
              <p style="color:#6b7280;font-size:12px">This written confirmation is sent via Amazon SES for your records. Reply to this email or text us anytime.</p>
            </div></div>`,
          textBody: body,
        }),
      ),
    }),
  );
  return { success: true, message: 'Confirmation email sent.' };
}

async function escalateToHuman(input: Record<string, unknown>, conversation: Conversation): Promise<unknown> {
  const { reason, accountId } = input as { recipientId: string; reason: string; accountId?: string };
  console.log(`[escalate] ${conversation.recipientId} → ${reason} (account ${accountId ?? 'n/a'})`);
  const isOptOut = /opt.?out|stop|cease/i.test(reason);
  return {
    success: true,
    optedOut: isOptOut,
    referenceNumber: `ESC-${Date.now()}`,
    message: isOptOut
      ? 'Understood — you will not receive further messages. A specialist has been notified.'
      : 'A specialist has been notified and will reach out within one business day.',
  };
}
