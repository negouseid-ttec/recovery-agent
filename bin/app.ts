#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DataStack } from '../lib/stacks/data-stack';
import { AgentStack } from '../lib/stacks/agent-stack';
import { MessagingStack } from '../lib/stacks/messaging-stack';
import { WhatsAppStack } from '../lib/stacks/whatsapp-stack';

const app = new cdk.App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID,
  region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
};

const data = new DataStack(app, 'RecoveryAgent-Data', { env });

const agent = new AgentStack(app, 'RecoveryAgent-Agent', {
  env,
  conversationTable: data.conversationTable,
  accountTable: data.accountTable,
  planTable: data.planTable,
});

new MessagingStack(app, 'RecoveryAgent-Messaging', {
  env,
  triageFunction: agent.triageFunction,
  conversationTable: data.conversationTable,
});

new WhatsAppStack(app, 'RecoveryAgent-WhatsApp', {
  env,
  triageFunction: agent.triageFunction,
  conversationTable: data.conversationTable,
});

app.synth();
