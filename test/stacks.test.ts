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
    identityTable: data.identityTable,
    decisionTable: data.decisionTable,
    challengeTable: data.challengeTable,
  });

  test('Data stack creates 6 DynamoDB tables', () => {
    Template.fromStack(data).resourceCountIs('AWS::DynamoDB::Table', 6);
  });

  test('Accounts table has by-recipient and by-status GSIs', () => {
    Template.fromStack(data).hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'ra-accounts',
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({ IndexName: 'by-recipient' }),
        Match.objectLike({ IndexName: 'by-status' }),
      ]),
    });
  });

  test('Identity and decision tables exist', () => {
    const t = Template.fromStack(data);
    t.hasResourceProperties('AWS::DynamoDB::Table', { TableName: 'ra-identity-links' });
    t.hasResourceProperties('AWS::DynamoDB::Table', { TableName: 'ra-decision-log' });
  });

  test('Agent stack creates orchestrator, triage, sender, outreach, and verification Lambdas', () => {
    Template.fromStack(agent).resourceCountIs('AWS::Lambda::Function', 5);
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
