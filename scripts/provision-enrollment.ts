/** Operator-only authenticated enrollment. Requires GetItem on trusted account data and PutItem on session table. */
import { writeFileSync } from 'fs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mintSession } from '../lib/shared/verified-session';
import { validAddress } from '../lib/shared/identity-verification';
async function main() {
    const [accountId, channel, file] = process.argv.slice(2);
    if (!accountId || !channel || !file)
        throw Error('Usage: npx ts-node scripts/provision-enrollment.ts ACCOUNT_ID CHANNEL OUTPUT_FILE');
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    const { Item: a } = await ddb.send(new GetCommand({ TableName: process.env.ACCOUNT_TABLE ?? 'ra-accounts', Key: { accountId }, ConsistentRead: true }));
    if (!a?.customerId || !validAddress(channel, a.recipientId))
        throw Error('Trusted account must contain canonical customer and a valid enrolled channel address');
    const token = await mintSession({ put: async (record) => { await ddb.send(new PutCommand({ TableName: process.env.SESSION_TABLE ?? 'ra-verified-sessions', Item: record, ConditionExpression: 'attribute_not_exists(tokenHash)' })); }, consume: async () => false }, a.customerId, new Date(), 'authenticated_enrollment');
    writeFileSync(file, JSON.stringify({ action: 'issue', channel, identifier: a.recipientId, customerId: a.customerId, sessionToken: token }), { mode: 0o600, flag: 'wx' });
    console.log('Enrollment request written to the protected output file; expires in 15 minutes.');
}
main().catch(() => { console.error('Enrollment provisioning failed. Check trusted account data and IAM permissions.'); process.exitCode = 1; });
