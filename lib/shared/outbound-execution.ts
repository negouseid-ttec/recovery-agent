import { createHash } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
export async function claimExecution(message: {
    decisionId: string;
    correlationId: string;
    purpose: string;
    accountId?: string;
}) {
    const id = 'SEND-' + createHash('sha256').update(message.decisionId).digest('hex');
    try {
        await ddb.send(new PutCommand({ TableName: process.env.DECISION_TABLE!, Item: { decisionId: id, sourceDecisionId: message.decisionId, correlationId: message.correlationId, accountId: message.accountId, executionState: 'sending', evidenceSource: 'aws_observed', createdAt: new Date().toISOString(), ttl: Math.floor(Date.now() / 1000) + 180 * 86400 }, ConditionExpression: 'attribute_not_exists(decisionId)' }));
        return id;
    }
    catch (e) {
        if ((e as Error).name === 'ConditionalCheckFailedException')
            return undefined;
        throw e;
    }
}
export async function executionState(id: string, correlationId: string, state: string, extra: Record<string, unknown> = {}) {
    const keys = Object.keys(extra);
    const terminalGuard=state==='provider_accepted'?'executionState <> :delivered':'executionState <> :delivered AND executionState <> :accepted';
    try{
    await ddb.send(new UpdateCommand({ TableName: process.env.DECISION_TABLE!, Key: { decisionId: id }, UpdateExpression: 'SET executionState = :s, updatedAt = :t' + keys.map((_, i) => `, #f${i} = :v${i}`).join(''), ConditionExpression: 'correlationId = :c AND '+terminalGuard, ExpressionAttributeNames: keys.length ? Object.fromEntries(keys.map((k, i) => ['#f' + i, k])) : undefined, ExpressionAttributeValues: { ':s': state, ':t': new Date().toISOString(), ':c': correlationId,':delivered':'delivered',...(state==='provider_accepted'?{}:{':accepted':'provider_accepted'}), ...Object.fromEntries(keys.map((k, i) => [':v' + i, extra[k]])) } }));
    }catch(e){if((e as Error).name!=='ConditionalCheckFailedException')throw e;}
}
