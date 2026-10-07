/**
 * Proactive Outreach — the escalation-ladder driver.
 *
 * Runs on a schedule (EventBridge) or on demand. For each past-due account that
 * still hasn't engaged, it asks the channel-strategy which channel to use for
 * the NEXT attempt (cheapest-that-works, escalate on silence, honor opt-outs and
 * quiet hours), records the attempt, and dispatches via the channel sender.
 *
 * This is what makes the four channels a STRATEGY: the agent reaches the
 * customer on the cheapest channel that can work and only escalates to a richer,
 * pricier channel when there's been no response — stopping the instant the
 * customer engages anywhere.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { Handler } from 'aws-lambda';
import type { Account, OutboundMessage } from '../../shared/types';
import { selectOutreachChannel, type AccountSignals } from '../../shared/channel-strategy';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambdaClient = new LambdaClient({});

const ACCOUNT_TABLE = process.env.ACCOUNT_TABLE!;
const SENDER_FUNCTION = process.env.SENDER_FUNCTION_NAME ?? 'ra-channel-sender';

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

export const handler: Handler = async (event) => {
  // Scan past-due accounts that haven't been resolved yet.
  const res = await ddb.send(
    new ScanCommand({
      TableName: ACCOUNT_TABLE,
      FilterExpression: '#s = :pd',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':pd': 'past_due' },
    }),
  );
  const accounts = (res.Items ?? []) as Account[];
  const decisions: unknown[] = [];

  for (const a of accounts) {
    const signals: AccountSignals = {
      lastResponseChannel: (a as any).lastResponseChannel,
      optedOutChannels: (a as any).optedOutChannels ?? [],
      rcsCapable: (a as any).rcsCapable,
      whatsappReachable: (a as any).whatsappReachable,
      pastDueCents: a.pastDueCents,
      daysPastDue: a.daysPastDue,
      attemptsWithoutResponse: (a as any).attemptsWithoutResponse ?? 0,
      localHour: event.localHour ?? new Date().getUTCHours(),
    };

    const decision = selectOutreachChannel(signals);
    console.log(`[outreach] ${a.accountId} → ${decision.channel} (step ${decision.ladderStep}, ~$${decision.estCostUsd}) — ${decision.reason}`);
    decisions.push({ accountId: a.accountId, ...decision });

    if (decision.hold) continue; // quiet hours / nothing to send now

    const msg: OutboundMessage = {
      type: 'text',
      recipientId: a.recipientId,
      channel: decision.channel,
      text:
        `Hi ${a.customerName}, this is your telecom. Your account has a past-due ` +
        `balance of ${dollars(a.pastDueCents)}${a.suspensionDate ? ` and service may pause ${a.suspensionDate}` : ''}. ` +
        `Reply HELP and I'll make it easy to sort out — pay in full or split into smaller payments.`,
    };

    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: SENDER_FUNCTION,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify(msg)),
      }),
    );

    // Record the attempt so the next run escalates if still no response.
    await ddb.send(
      new UpdateCommand({
        TableName: ACCOUNT_TABLE,
        Key: { accountId: a.accountId },
        UpdateExpression: 'SET attemptsWithoutResponse = :n, lastOutreachChannel = :c, lastOutreachAt = :t',
        ExpressionAttributeValues: {
          ':n': signals.attemptsWithoutResponse + 1,
          ':c': decision.channel,
          ':t': new Date().toISOString(),
        },
      }),
    );
  }

  return { scanned: accounts.length, decisions };
};
