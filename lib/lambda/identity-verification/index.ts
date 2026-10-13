/**
 * Identity Verification Lambda.
 *
 * Two actions:
 *   { action: 'issue',  channel, identifier, customerId } → mints an OTP, stores
 *     a TTL challenge, and dispatches the code out-of-band via the channel sender
 *     (SMS/RCS/WhatsApp/email). The code is never returned or logged.
 *   { action: 'verify', channel, identifier, code }       → checks the code and,
 *     on success, links the identifier to the customer as VERIFIED.
 *
 * This is the trigger that promotes resolveIdentity() results from unverified to
 * verified, enabling safe cross-channel account access.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { Handler } from 'aws-lambda';
import type { Channel, IdentityLink, VerificationChallenge } from '../../shared/types';
import { issueChallenge, verifyCode, type ChallengeStore } from '../../shared/identity-verification';
import type { IdentityStore } from '../../shared/identity';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const lambdaClient = new LambdaClient({});

const IDENTITY_TABLE = process.env.IDENTITY_TABLE!;
const CHALLENGE_TABLE = process.env.CHALLENGE_TABLE!;
const SENDER_FUNCTION = process.env.SENDER_FUNCTION_NAME ?? 'ra-channel-sender';

const identityStore: IdentityStore = {
  async getLink(id: string): Promise<IdentityLink | undefined> {
    const r = await ddb.send(new GetCommand({ TableName: IDENTITY_TABLE, Key: { channelIdentifier: id } }));
    return r.Item as IdentityLink | undefined;
  },
  async putLink(link: IdentityLink): Promise<void> {
    await ddb.send(new PutCommand({ TableName: IDENTITY_TABLE, Item: link }));
  },
  async hasVerifiedForCustomer(customerId: string): Promise<boolean> {
    const r = await ddb.send(new QueryCommand({
      TableName: IDENTITY_TABLE, IndexName: 'by-customer',
      KeyConditionExpression: 'customerId = :c', ExpressionAttributeValues: { ':c': customerId },
    }));
    return (r.Items ?? []).some((i) => (i as IdentityLink).verification === 'verified');
  },
};

const challengeStore: ChallengeStore = {
  async get(id: string): Promise<VerificationChallenge | undefined> {
    const r = await ddb.send(new GetCommand({ TableName: CHALLENGE_TABLE, Key: { channelIdentifier: id } }));
    return r.Item as VerificationChallenge | undefined;
  },
  async put(c: VerificationChallenge): Promise<void> {
    await ddb.send(new PutCommand({ TableName: CHALLENGE_TABLE, Item: c }));
  },
  async delete(id: string): Promise<void> {
    await ddb.send(new DeleteCommand({ TableName: CHALLENGE_TABLE, Key: { channelIdentifier: id } }));
  },
};

export const handler: Handler = async (event) => {
  const action = event.action as 'issue' | 'verify';
  const channel = event.channel as Channel;
  const identifier = String(event.identifier ?? '');

  if (!action || !channel || !identifier) {
    return { statusCode: 400, error: 'action, channel, and identifier are required.' };
  }

  if (action === 'issue') {
    const customerId = String(event.customerId ?? '');
    if (!customerId) return { statusCode: 400, error: 'customerId is required to issue a challenge.' };
    // ENROLLMENT NOTE: for a NEW customer, the caller must bind customerId to a
    // trusted account record upstream (e.g. the billing/CRM account that owns
    // the past-due balance). This Lambda does not mint account ownership.
    // For an EXISTING customer, a fresh verifiedSession (from a completed
    // challenge on an already-verified channel, or an authenticated portal
    // session) is REQUIRED — knowing an identifier is not proof of control.
    const verifiedSession = event.verifiedSession as { customerId: string; issuedAt: string; expiresAt: string } | undefined;

    const result = await issueChallenge(challengeStore, identityStore, channel, identifier, customerId, verifiedSession);
    if (!result.issued) {
      console.log(JSON.stringify({ event: 'otp_issue_denied', channel, reason: result.reason }));
      return { statusCode: 403, issued: false, reason: result.reason,
        error: 'Not authorized: linking to an existing customer requires a fresh verifiedSession (proof of control of an existing verified channel).' };
    }
    const { channelIdentifier, code, expiresAt } = result;

    // Deliver the code out-of-band on the SAME channel being verified.
    const msg = {
      type: 'text' as const,
      recipientId: channelIdentifier,
      channel,
      text: `Your verification code is ${code}. It expires in 10 minutes. Reply with this code to confirm your account.`,
      bypassPolicy: true, // customer-requested transactional OTP, not collection outreach
    };
    await lambdaClient.send(
      new InvokeCommand({ FunctionName: SENDER_FUNCTION, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify(msg)) }),
    );
    console.log(JSON.stringify({ event: 'otp_issued', channelIdentifier, channel, expiresAt })); // no code
    return { statusCode: 200, issued: true, channelIdentifier, expiresAt };
  }

  if (action === 'verify') {
    const code = String(event.code ?? '');
    const outcome = await verifyCode(challengeStore, identityStore, channel, identifier, code);
    console.log(JSON.stringify({ event: 'otp_verify', channel, verified: outcome.verified, reason: 'reason' in outcome ? outcome.reason : undefined }));
    return { statusCode: outcome.verified ? 200 : 401, ...outcome };
  }

  return { statusCode: 400, error: `Unknown action: ${action}` };
};
