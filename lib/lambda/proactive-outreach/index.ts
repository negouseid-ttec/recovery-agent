/**
 * Proactive Outreach — the autonomous recovery driver.
 *
 * For each eligible (past-due) account:
 *   1. Load the account via an INDEXED query on status (no unbounded scan).
 *   2. Evaluate deterministic policy (opt-out / holds / quiet hours / caps).
 *   3. If permitted, request a next-best-action recommendation (AI recommends).
 *   4. Re-evaluate policy immediately before send (authorize()).
 *   5. Dispatch via the existing channel sender — with idempotency so retries /
 *      overlapping invocations don't double-send.
 *   6. Persist the attempt and an auditable decision record; schedule next review.
 *
 * The AI never overrides policy: a denial downgrades the executed action to
 * wait/hold/escalate regardless of the recommendation.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { Handler } from 'aws-lambda';
import { v4 as uuid } from 'uuid';
import type { Account, OutboundMessage, DecisionLogEntry } from '../../shared/types';
import { evaluateOutbound } from '../../shared/recovery-policy';
import { recommendAndAuthorize } from '../next-best-action';
import { recordDecision, type DecisionSink } from '../../shared/decision-audit';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambdaClient = new LambdaClient({});

const ACCOUNT_TABLE = process.env.ACCOUNT_TABLE!;
const DECISION_TABLE = process.env.DECISION_TABLE ?? '';
const SENDER_FUNCTION = process.env.SENDER_FUNCTION_NAME ?? 'ra-channel-sender';
const BATCH_LIMIT = Number(process.env.OUTREACH_BATCH_LIMIT ?? 25);

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

/** DynamoDB-backed decision sink. */
const decisionSink: DecisionSink = {
  async put(entry: DecisionLogEntry): Promise<void> {
    if (!DECISION_TABLE) return; // audit table optional in minimal deploys
    await ddb.send(new PutCommand({ TableName: DECISION_TABLE, Item: entry }));
  },
};

export const handler: Handler = async (event) => {
  const now = new Date();
  const correlationId = event.correlationId ?? `OUT-${uuid()}`;

  // 1. INDEXED query on status — no unbounded Scan. Requires the by-status GSI.
  const res = await ddb.send(
    new QueryCommand({
      TableName: ACCOUNT_TABLE,
      IndexName: 'by-status',
      KeyConditionExpression: '#s = :pd',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':pd': 'past_due' },
      Limit: BATCH_LIMIT,
    }),
  );
  const accounts = (res.Items ?? []) as Account[];
  const results: unknown[] = [];

  for (const a of accounts) {
    try {
      results.push(await processAccount(a, correlationId, now, event.localHourOverride));
    } catch (err) {
      console.error(`[outreach] error processing ${a.accountId}:`, (err as Error).message);
      results.push({ accountId: a.accountId, executionResult: 'error', error: (err as Error).message });
    }
  }

  return { scanned: accounts.length, correlationId, results };
};

async function processAccount(
  a: Account,
  correlationId: string,
  now: Date,
  localHourOverride?: number,
): Promise<unknown> {
  const ctx = { now, maxContactsPerWindow: 3 };

  // 2. Pre-check policy (fast reject before spending a model call).
  const pre = evaluateOutbound(a, ctx);
  if (!pre.allowed) {
    const entry = await recordDecision(decisionSink, {
      correlationId,
      customerId: a.customerId,
      accountId: a.accountId,
      signals: { status: a.status, daysPastDue: a.daysPastDue, pastDueCents: a.pastDueCents },
      policyDecision: pre,
      executedAction: 'skip',
      executionResult: 'blocked',
      summary: `Blocked before outreach: ${pre.reasonCode}`,
    }, now);
    return { accountId: a.accountId, executionResult: 'blocked', policy: pre.reasonCode, decisionId: entry.decisionId };
  }

  // 3. AI recommends; 4. authorize() re-evaluates policy as the final gate.
  const authorized = await recommendAndAuthorize(a, ctx);
  const { recommendation, policyDecision, executed, source, modelId, tokenUsage } = authorized;

  // 5. Only dispatch when the executed action is a real outbound contact.
  let executionResult: DecisionLogEntry['executionResult'] = 'skipped';
  if (executed === 'contact' && recommendation.channel !== 'none' && policyDecision.allowed) {
    // Idempotency: guard against duplicate sends from retries/overlap using a
    // conditional update keyed on a per-day outreach marker.
    const dayKey = now.toISOString().slice(0, 10);
    const sent = await claimOutreachSlot(a.accountId, dayKey);
    if (!sent) {
      executionResult = 'skipped';
    } else {
      const msg: OutboundMessage = {
        type: 'text',
        recipientId: a.recipientId,
        channel: recommendation.channel,
        text:
          `Hi ${a.customerName}, this is your telecom. Your account has a past-due balance of ` +
          `${dollars(a.pastDueCents)}${a.suspensionDate ? ` and service may pause ${a.suspensionDate}` : ''}. ` +
          `Reply HELP and I'll make it easy — pay in full or split into smaller payments.`,
      };
      await lambdaClient.send(
        new InvokeCommand({ FunctionName: SENDER_FUNCTION, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify(msg)) }),
      );
      await recordAttempt(a, recommendation.channel, now);
      executionResult = 'dispatched';
    }
  }

  const entry = await recordDecision(decisionSink, {
    correlationId,
    customerId: a.customerId,
    accountId: a.accountId,
    signals: { status: a.status, daysPastDue: a.daysPastDue, pastDueCents: a.pastDueCents, attempts: a.attemptsWithoutResponse ?? 0 },
    recommendation,
    policyDecision,
    executedAction: executed,
    executionResult,
    estCostUsd: recommendation.expectedCostUsd,
    modelId,
    tokenUsage,
    summary: `${source}: recommend ${recommendation.action}/${recommendation.channel} → executed ${executed} (${policyDecision.reasonCode})`,
  }, now);

  return {
    accountId: a.accountId,
    recommended: recommendation.action,
    channel: recommendation.channel,
    executed,
    executionResult,
    policy: policyDecision.reasonCode,
    source,
    decisionId: entry.decisionId,
  };
}

/**
 * Idempotency: atomically claim the per-day outreach slot. Returns true only
 * if THIS invocation set it (conditional write), false if already claimed.
 */
async function claimOutreachSlot(accountId: string, dayKey: string): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: ACCOUNT_TABLE,
        Key: { accountId },
        UpdateExpression: 'SET lastOutreachDayKey = :k',
        ConditionExpression: 'attribute_not_exists(lastOutreachDayKey) OR lastOutreachDayKey <> :k',
        ExpressionAttributeValues: { ':k': dayKey },
      }),
    );
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

async function recordAttempt(a: Account, channel: string, now: Date): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: ACCOUNT_TABLE,
      Key: { accountId: a.accountId },
      UpdateExpression:
        'SET attemptsWithoutResponse = :n, lastOutreachChannel = :c, lastOutreachAt = :t, outreachCountWindow = :w',
      ExpressionAttributeValues: {
        ':n': (a.attemptsWithoutResponse ?? 0) + 1,
        ':c': channel,
        ':t': now.toISOString(),
        ':w': (a.outreachCountWindow ?? 0) + 1,
      },
    }),
  );
}
