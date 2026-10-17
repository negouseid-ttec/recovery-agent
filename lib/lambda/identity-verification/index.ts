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
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { Handler } from 'aws-lambda';
import type { Channel, IdentityLink, VerificationChallenge } from '../../shared/types';
import { issueChallenge, verifyCode, type ChallengeStore } from '../../shared/identity-verification';
import { randomBytes } from 'crypto';
import { hashToken, type SessionStore } from '../../shared/verified-session';
import { validAddress } from '../../shared/identity-verification';
import type { IdentityStore } from '../../shared/identity';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const lambdaClient = new LambdaClient({});
const IDENTITY_TABLE = process.env.IDENTITY_TABLE!;
const CHALLENGE_TABLE = process.env.CHALLENGE_TABLE!;
const SENDER_FUNCTION = process.env.OTP_SENDER_FUNCTION_NAME!;
const sessions: SessionStore = {
    async put(record) { await ddb.send(new PutCommand({ TableName: process.env.SESSION_TABLE!, Item: record, ConditionExpression: 'attribute_not_exists(tokenHash)' })); },
    async consume(tokenHash, customerId, now) { try {
        await ddb.send(new DeleteCommand({ TableName: process.env.SESSION_TABLE!, Key: { tokenHash }, ConditionExpression: 'customerId = :c AND expiresAt > :n AND issuedAt <= :n', ExpressionAttributeValues: { ':c': customerId, ':n': now } }));
        return true;
    }
    catch (e) {
        if ((e as Error).name === 'ConditionalCheckFailedException')
            return false;
        throw e;
    } }
};
const identityStore: IdentityStore = {
    async getLink(id: string): Promise<IdentityLink | undefined> {
        const r = await ddb.send(new GetCommand({ TableName: IDENTITY_TABLE, Key: { channelIdentifier: id } }));
        return r.Item as IdentityLink | undefined;
    },
    async putLink(link: IdentityLink): Promise<void> {
        await ddb.send(new PutCommand({ TableName: IDENTITY_TABLE, Item: link, ConditionExpression: 'attribute_not_exists(channelIdentifier) OR verification <> :v OR customerId = :c', ExpressionAttributeValues: { ':v': 'verified', ':c': link.customerId } }));
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
        await ddb.send(new PutCommand({ TableName: CHALLENGE_TABLE, Item: c, ConditionExpression: 'attribute_not_exists(channelIdentifier) OR expiresAt <= :now', ExpressionAttributeValues: { ':now': new Date().toISOString() } }));
    },
    async advance(c, consume) { try {
        const params = { TableName: CHALLENGE_TABLE, Key: { channelIdentifier: c.channelIdentifier }, ConditionExpression: 'code = :code AND attempts = :a AND createdAt = :t', ExpressionAttributeValues: { ':code': c.code, ':a': c.attempts, ':t': c.createdAt } };
        if (consume)
            await ddb.send(new DeleteCommand(params));
        else
            await ddb.send(new UpdateCommand({ ...params, UpdateExpression: 'SET attempts = attempts + :one', ExpressionAttributeValues: { ...params.ExpressionAttributeValues, ':one': 1 } }));
        return true;
    }
    catch (e) {
        if ((e as Error).name === 'ConditionalCheckFailedException')
            return false;
        throw e;
    } },
    async delete(id: string): Promise<void> {
        await ddb.send(new DeleteCommand({ TableName: CHALLENGE_TABLE, Key: { channelIdentifier: id } }));
    },
};
export const handler: Handler = async (event) => {
    const action = event.action as 'issue' | 'verify';
    const channel = event.channel as Channel;
    const identifier = String(event.identifier ?? '');
    if (!action || !validAddress(channel, identifier)) {
        return { statusCode: 400, error: 'action, channel, and identifier are required.' };
    }
    if (action === 'issue') {
        const customerId = String(event.customerId ?? '');
        if (!customerId)
            return { statusCode: 400, error: 'customerId is required to issue a challenge.' };
        const sessionToken = event.sessionToken;
        const result = await issueChallenge(challengeStore, identityStore, sessions, channel, identifier, customerId, sessionToken);
        if (!result.issued) {
            console.log(JSON.stringify({ event: 'otp_issue_denied', channel, reason: result.reason }));
            return { statusCode: 403, issued: false, reason: result.reason,
                error: 'Not authorized: use a server-issued sessionToken or reverify an existing verified channel.' };
        }
        const { channelIdentifier, code, expiresAt } = result;
        const deliveryToken = randomBytes(32).toString('base64url');
        await ddb.send(new UpdateCommand({ TableName: CHALLENGE_TABLE, Key: { channelIdentifier }, UpdateExpression: 'SET deliveryHash = :h', ExpressionAttributeValues: { ':h': hashToken(deliveryToken) } }));
        const response = await lambdaClient.send(new InvokeCommand({ FunctionName: SENDER_FUNCTION, InvocationType: 'RequestResponse', Payload: Buffer.from(JSON.stringify({ channelIdentifier, deliveryToken })) }));
        const delivered = response.Payload ? JSON.parse(Buffer.from(response.Payload).toString()) : {};
        if (response.FunctionError || !delivered.success)
            return { statusCode: 502, issued: false, error: 'OTP provider did not accept delivery' };
        return { statusCode: 200, issued: true, channelIdentifier, expiresAt, delivery: 'provider_accepted' };
    }
    if (action === 'verify') {
        const code = String(event.code ?? '');
        const outcome = await verifyCode(challengeStore, identityStore, sessions, channel, identifier, code);
        console.log(JSON.stringify({ event: 'otp_verify', channel, verified: outcome.verified, reason: 'reason' in outcome ? outcome.reason : undefined }));
        return { statusCode: outcome.verified ? 200 : 401, ...outcome };
    }
    return { statusCode: 400, error: `Unknown action: ${action}` };
};
