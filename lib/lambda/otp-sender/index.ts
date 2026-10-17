import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { hashToken } from '../../shared/verified-session';
import { validAddress } from '../../shared/identity-verification';
import { dispatchMessage } from '../channel-sender';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
export async function handler(event: {
    channelIdentifier: string;
    deliveryToken: string;
}) {
    if (typeof event.deliveryToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(event.deliveryToken))
        return { success: false, statusCode: 403 };
    const record = await ddb.send(new GetCommand({ TableName: process.env.CHALLENGE_TABLE!, Key: { channelIdentifier: event.channelIdentifier }, ConsistentRead: true }));
    const c = record.Item;
    if (!c || c.expiresAt <= new Date().toISOString() || !validAddress(c.channel, c.channelIdentifier))
        return { success: false, statusCode: 403 };
    try {
        await ddb.send(new UpdateCommand({ TableName: process.env.CHALLENGE_TABLE!, Key: { channelIdentifier: c.channelIdentifier }, UpdateExpression: 'SET deliveryStartedAt = :n REMOVE deliveryHash', ConditionExpression: 'deliveryHash = :h AND attribute_not_exists(deliveryStartedAt) AND createdAt = :t', ExpressionAttributeValues: { ':h': hashToken(event.deliveryToken), ':n': new Date().toISOString(), ':t': c.createdAt } }));
    }
    catch (e) {
        if ((e as Error).name === 'ConditionalCheckFailedException')
            return { success: false, statusCode: 403 };
        throw e;
    }
    try {
        const result = await dispatchMessage({ type: 'text', recipientId: c.channelIdentifier, channel: c.channel, text: `Your verification code is ${c.code}. It expires in 10 minutes. Never share this code.` });
        return { ...result, success: result.providerMessageIds.length > 0 };
    }
    catch {
        return { success: false, statusCode: 502 };
    }
}
