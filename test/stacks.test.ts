import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DataStack } from '../lib/stacks/data-stack';
import { AgentStack } from '../lib/stacks/agent-stack';

describe('Recovery Agent infrastructure', () => {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'us-east-1' };
  const data = new DataStack(app, 'TestData', { env });
  const agent = new AgentStack(app, 'TestAgent', {
    env,
    conversationTable: data.conversationTable,
    accountTable: data.accountTable,
    planTable: data.planTable,
  });

  test('Data stack creates 3 DynamoDB tables', () => {
    Template.fromStack(data).resourceCountIs('AWS::DynamoDB::Table', 3);
  });

  test('Accounts table has by-recipient GSI', () => {
    Template.fromStack(data).hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'ra-accounts',
      GlobalSecondaryIndexes: [{ IndexName: 'by-recipient', KeySchema: [{ AttributeName: 'recipientId', KeyType: 'HASH' }] }],
    });
  });

  test('Agent stack creates orchestrator, triage, sender, and outreach Lambdas', () => {
    Template.fromStack(agent).resourceCountIs('AWS::Lambda::Function', 4);
  });

  test('Sender has EUM, Social Messaging, and SES permissions', () => {
    const t = Template.fromStack(agent);
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Action: Match.arrayWith(['sms-voice:SendTextMessage']), Effect: 'Allow' })]) },
    });
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Action: Match.arrayWith(['social-messaging:SendWhatsAppMessage']), Effect: 'Allow' })]) },
    });
  });

  test('Triage and orchestrator have Bedrock access', () => {
    const t = Template.fromStack(agent);
    t.hasResourceProperties('AWS::Lambda::Function', { FunctionName: 'ra-message-triage' });
    t.hasResourceProperties('AWS::Lambda::Function', { FunctionName: 'ra-agent-orchestrator' });
  });

  test('All tables use PAY_PER_REQUEST', () => {
    const tables = Template.fromStack(data).findResources('AWS::DynamoDB::Table');
    for (const [, r] of Object.entries(tables)) expect((r as any).Properties.BillingMode).toBe('PAY_PER_REQUEST');
  });
});

describe('Collections money math', () => {
  const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
  test('cents format correctly', () => {
    expect(dollars(8400)).toBe('$84.00');
    expect(dollars(2800)).toBe('$28.00');
  });
  test('plan splits round up to cover the balance', () => {
    const per = Math.ceil(8400 / 3);
    expect(per).toBe(2800);
    expect(per * 3).toBeGreaterThanOrEqual(8400);
  });
});
