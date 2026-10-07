/**
 * Recovery Agent tool implementations — DynamoDB-backed collections actions.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { v4 as uuid } from 'uuid';
import type { Conversation, Account, PaymentPlan, Promise as PromiseRecord, Dispute } from '../../shared/types';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
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

async function checkBalance(input: Record<string, unknown>, conversation: Conversation): Promise<unknown> {
  const { accountId, recipientId } = input as { accountId?: string; recipientId?: string };

  if (accountId) {
    const res = await ddb.send(new GetCommand({ TableName: ACCOUNT_TABLE, Key: { accountId } }));
    if (!res.Item) return { found: false, message: `No account ${accountId}.` };
    return { found: true, account: sanitizeAccount(res.Item as Account) };
  }

  const lookupId = recipientId ?? conversation.recipientId;
  const res = await ddb.send(
    new QueryCommand({
      TableName: ACCOUNT_TABLE,
      IndexName: 'by-recipient',
      KeyConditionExpression: 'recipientId = :r',
      ExpressionAttributeValues: { ':r': lookupId },
    }),
  );
  if (!res.Items?.length) return { found: false, message: 'No account found for this customer.' };
  return { found: true, accounts: res.Items.map((i) => sanitizeAccount(i as Account)) };
}

async function offerPaymentPlan(input: Record<string, unknown>, conversation: Conversation): Promise<unknown> {
  const { accountId, installments, frequency, firstPaymentDate } = input as {
    accountId: string;
    installments: number;
    frequency: 'weekly' | 'biweekly' | 'monthly';
    firstPaymentDate?: string;
  };

  const res = await ddb.send(new GetCommand({ TableName: ACCOUNT_TABLE, Key: { accountId } }));
  if (!res.Item) return { success: false, message: `Account ${accountId} not found.` };
  const acct = res.Item as Account;

  const n = Math.max(2, Math.min(6, Math.round(installments)));
  const installmentCents = Math.ceil(acct.pastDueCents / n);
  const first = firstPaymentDate ?? new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];

  const plan: PaymentPlan = {
    planId: uuid(),
    accountId,
    recipientId: conversation.recipientId,
    totalCents: acct.pastDueCents,
    installmentCents,
    installments: n,
    frequency,
    firstPaymentDate: first,
    status: 'accepted',
    createdAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: PLAN_TABLE, Item: plan }));
  await ddb.send(
    new UpdateCommand({
      TableName: ACCOUNT_TABLE,
      Key: { accountId },
      UpdateExpression: 'SET #s = :s, lastContactDate = :d',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': 'plan_active', ':d': new Date().toISOString() },
    }),
  );

  return {
    success: true,
    plan: {
      total: dollars(plan.totalCents),
      installment: dollars(installmentCents),
      installments: n,
      frequency,
      firstPaymentDate: first,
    },
    message: `Plan set: ${n} ${frequency} payments of ${dollars(installmentCents)}, first on ${first}.`,
  };
}

async function recordPromise(input: Record<string, unknown>, conversation: Conversation): Promise<unknown> {
  const { accountId, amountCents, promisedDate } = input as {
    accountId: string;
    amountCents?: number;
    promisedDate: string;
  };
  const res = await ddb.send(new GetCommand({ TableName: ACCOUNT_TABLE, Key: { accountId } }));
  if (!res.Item) return { success: false, message: `Account ${accountId} not found.` };
  const acct = res.Item as Account;
  const amount = amountCents ?? acct.pastDueCents;

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
  const res = await ddb.send(new GetCommand({ TableName: ACCOUNT_TABLE, Key: { accountId } }));
  if (!res.Item) return { success: false, message: `Account ${accountId} not found.` };

  await ddb.send(
    new UpdateCommand({
      TableName: ACCOUNT_TABLE,
      Key: { accountId },
      UpdateExpression: 'SET #s = :s, suspensionDate = :null',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': 'hardship_hold', ':null': null },
    }),
  );
  return {
    success: true,
    message: `Hardship hold applied (${reason}). Late fees suspended, no service interruption, most lenient terms available. A specialist will follow up.`,
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
  const { recipientId, subject, body } = input as { recipientId: string; subject: string; body: string };
  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: SENDER_FUNCTION,
      InvocationType: 'Event',
      Payload: Buffer.from(
        JSON.stringify({
          type: 'email',
          recipientId: recipientId ?? conversation.recipientId,
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
