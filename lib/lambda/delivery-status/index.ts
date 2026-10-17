// IAM-only adapter. No public URL or caller grants. Wire only authenticated provider callbacks.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
export async function handler(event: {
    decisionId: string;
    providerMessageId: string;
    status: string;
}) {
    if (event.status !== 'delivered' || !event.decisionId || !event.providerMessageId)
        return { updated: false };
    try {
        await ddb.send(new UpdateCommand({ TableName: process.env.DECISION_TABLE!, Key: { decisionId: event.decisionId }, UpdateExpression: 'SET executionState = :d, deliveredAt = :t', ConditionExpression: 'executionState = :a AND contains(providerMessageIds,:p)', ExpressionAttributeValues: { ':d': 'delivered', ':a': 'provider_accepted', ':p': event.providerMessageId, ':t': new Date().toISOString() } }));
        return { updated: true };
    }
    catch (e) {
        if ((e as Error).name === 'ConditionalCheckFailedException')
            return { updated: false };
        throw e;
    }
}
