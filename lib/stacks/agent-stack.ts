import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as path from 'path';

export interface AgentStackProps extends cdk.StackProps {
  conversationTable: dynamodb.Table;
  accountTable: dynamodb.Table;
  planTable: dynamodb.Table;
}

export class AgentStack extends cdk.Stack {
  public readonly orchestratorFunction: lambda.Function;
  public readonly senderFunction: lambda.Function;
  public readonly triageFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props);
    const lambdaDir = path.join(__dirname, '..', 'lambda');
    const MODEL = process.env.BEDROCK_MODEL_ID ?? 'us.amazon.nova-2-lite-v1:0';

    const bundling = { minify: true, sourceMap: true, target: 'node20', format: nodejs.OutputFormat.CJS };

    // ── Orchestrator ───────────────────────────────────────────────────────
    this.orchestratorFunction = new nodejs.NodejsFunction(this, 'Orchestrator', {
      functionName: 'ra-agent-orchestrator',
      entry: path.join(lambdaDir, 'agent-orchestrator', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(60),
      environment: {
        CONVERSATION_TABLE: props.conversationTable.tableName,
        ACCOUNT_TABLE: props.accountTable.tableName,
        PLAN_TABLE: props.planTable.tableName,
        BEDROCK_MODEL_ID: MODEL,
        SENDER_FUNCTION_NAME: 'ra-channel-sender',
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling,
    });
    this.orchestratorFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      }),
    );
    props.conversationTable.grantReadWriteData(this.orchestratorFunction);
    props.accountTable.grantReadWriteData(this.orchestratorFunction);
    props.planTable.grantReadWriteData(this.orchestratorFunction);

    // ── Message Triage (inbound intelligence) ──────────────────────────────
    this.triageFunction = new nodejs.NodejsFunction(this, 'MessageTriage', {
      functionName: 'ra-message-triage',
      entry: path.join(lambdaDir, 'message-triage', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        BEDROCK_MODEL_ID: MODEL,
        AGENT_FUNCTION_NAME: this.orchestratorFunction.functionName,
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling,
    });
    this.triageFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      }),
    );
    this.orchestratorFunction.grantInvoke(this.triageFunction);

    // ── Channel Sender (SMS/RCS via EUM, WhatsApp via EUM Social, SES) ─────
    this.senderFunction = new nodejs.NodejsFunction(this, 'ChannelSender', {
      functionName: 'ra-channel-sender',
      entry: path.join(lambdaDir, 'channel-sender', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        CONVERSATION_TABLE: props.conversationTable.tableName,
        SES_FROM_EMAIL: process.env.SES_FROM_EMAIL ?? 'recovery@example.com',
        EUM_PHONE_POOL_ID: process.env.EUM_PHONE_POOL_ID ?? '',
        RCS_AGENT_ID: process.env.RCS_AGENT_ID ?? '',
        WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling,
    });
    this.senderFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sms-voice:SendTextMessage', 'sms-voice:SendRcsMessage', 'sms-voice:SendMediaMessage'],
        resources: ['*'],
      }),
    );
    this.senderFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['social-messaging:SendWhatsAppMessage', 'social-messaging:GetWhatsAppMessageMedia'],
        resources: ['*'],
      }),
    );
    this.senderFunction.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['ses:SendEmail', 'ses:SendRawEmail'], resources: ['*'] }),
    );
    props.conversationTable.grantReadData(this.senderFunction);
    this.senderFunction.grantInvoke(this.orchestratorFunction);

    new cdk.CfnOutput(this, 'OrchestratorArn', { value: this.orchestratorFunction.functionArn });
    new cdk.CfnOutput(this, 'TriageArn', { value: this.triageFunction.functionArn });
    new cdk.CfnOutput(this, 'SenderArn', { value: this.senderFunction.functionArn });
  }
}
