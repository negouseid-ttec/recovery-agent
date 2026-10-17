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
    identityTable: dynamodb.Table;
    decisionTable: dynamodb.Table;
    challengeTable: dynamodb.Table;
    sessionTable: dynamodb.Table;
}
export class AgentStack extends cdk.Stack {
    public readonly orchestratorFunction: lambda.Function;
    public readonly senderFunction: lambda.Function;
    public readonly triageFunction: lambda.Function;
    constructor(scope: Construct, id: string, props: AgentStackProps) {
        super(scope, id, props);
        const lambdaDir = path.join(__dirname, '..', 'lambda');
        const MODEL = process.env.BEDROCK_MODEL_ID ?? 'us.amazon.nova-2-lite-v1:0';
        const bundling = { minify: true, sourceMap: true, bundleAwsSDK:true, target: 'node22', format: nodejs.OutputFormat.CJS };
        // ── Orchestrator ───────────────────────────────────────────────────────
        this.orchestratorFunction = new nodejs.NodejsFunction(this, 'Orchestrator', {
            functionName: 'ra-agent-orchestrator',
            entry: path.join(lambdaDir, 'agent-orchestrator', 'index.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_22_X,
            architecture: lambda.Architecture.ARM_64,
            memorySize: 1024,
            timeout: cdk.Duration.seconds(60),
            environment: {
                CONVERSATION_TABLE: props.conversationTable.tableName,
                ACCOUNT_TABLE: props.accountTable.tableName,
                PLAN_TABLE: props.planTable.tableName,
                IDENTITY_TABLE: props.identityTable.tableName,
                BEDROCK_MODEL_ID: MODEL,
                SENDER_FUNCTION_NAME: 'ra-channel-sender',
                NODE_OPTIONS: '--enable-source-maps',
            },
            bundling,
        });
        this.orchestratorFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
            resources: [`arn:${this.partition}:bedrock:*::foundation-model/amazon.nova-*`, `arn:${this.partition}:bedrock:${this.region}:${this.account}:inference-profile/${MODEL}`],
        }));
        props.conversationTable.grantReadWriteData(this.orchestratorFunction);
        props.accountTable.grantReadWriteData(this.orchestratorFunction);
        props.planTable.grantReadWriteData(this.orchestratorFunction);
        props.identityTable.grantReadWriteData(this.orchestratorFunction);
        if (process.env.SUPPORT_INBOX) {
            this.orchestratorFunction.addEnvironment('SUPPORT_INBOX', process.env.SUPPORT_INBOX);
            this.orchestratorFunction.addEnvironment('SES_FROM_EMAIL', process.env.SES_FROM_EMAIL ?? 'recovery@example.com');
            this.orchestratorFunction.addToRolePolicy(new iam.PolicyStatement({ actions: ['ses:SendEmail'], resources: [`arn:${this.partition}:ses:${this.region}:${this.account}:identity/*`], conditions: { 'ForAllValues:StringEquals': { 'ses:Recipients': [process.env.SUPPORT_INBOX] } } }));
        }
        // ── Message Triage (inbound intelligence) ──────────────────────────────
        this.triageFunction = new nodejs.NodejsFunction(this, 'MessageTriage', {
            functionName: 'ra-message-triage',
            entry: path.join(lambdaDir, 'message-triage', 'index.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_22_X,
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
        this.triageFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
            resources: [`arn:${this.partition}:bedrock:*::foundation-model/amazon.nova-*`, `arn:${this.partition}:bedrock:${this.region}:${this.account}:inference-profile/${MODEL}`],
        }));
        this.orchestratorFunction.grantInvoke(this.triageFunction);
        // ── Channel Sender (SMS/RCS via EUM, WhatsApp via EUM Social, SES) ─────
        this.senderFunction = new nodejs.NodejsFunction(this, 'ChannelSender', {
            functionName: 'ra-channel-sender',
            entry: path.join(lambdaDir, 'channel-sender', 'index.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_22_X,
            architecture: lambda.Architecture.ARM_64,
            memorySize: 512,
            timeout: cdk.Duration.seconds(30),
            environment: {
                CONVERSATION_TABLE: props.conversationTable.tableName,
                ACCOUNT_TABLE: props.accountTable.tableName,
                IDENTITY_TABLE: props.identityTable.tableName,
                DECISION_TABLE: props.decisionTable.tableName,
                SES_FROM_EMAIL: process.env.SES_FROM_EMAIL ?? 'recovery@example.com',
                EUM_PHONE_POOL_ID: process.env.EUM_PHONE_POOL_ID ?? '',
                RCS_AGENT_ID: process.env.RCS_AGENT_ID ?? '',
                WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
                NODE_OPTIONS: '--enable-source-maps',
            },
            bundling,
        });
        this.senderFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: ['sms-voice:SendTextMessage', 'sms-voice:SendRcsMessage'],
            resources: process.env.EUM_ORIGINATION_ARNS?.split(',')??['*'],
        }));
        this.senderFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: ['social-messaging:SendWhatsAppMessage'],
            resources: process.env.WHATSAPP_ORIGINATION_ARN?[process.env.WHATSAPP_ORIGINATION_ARN]:['*'],
        }));
        this.senderFunction.addToRolePolicy(new iam.PolicyStatement({ actions: ['ses:SendEmail'], resources: [`arn:${this.partition}:ses:${this.region}:${this.account}:identity/*`] }));
        props.conversationTable.grantReadData(this.senderFunction);
        props.accountTable.grantReadData(this.senderFunction);
        this.senderFunction.addToRolePolicy(new iam.PolicyStatement({actions:['dynamodb:UpdateItem'],resources:[props.accountTable.tableArn]}));
        props.identityTable.grantReadData(this.senderFunction);
        this.senderFunction.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'], resources: [props.decisionTable.tableArn] }));
        this.senderFunction.grantInvoke(this.orchestratorFunction);
        // ── Proactive Outreach (escalation-ladder driver) ─────────────────────
        const outreachFn = new nodejs.NodejsFunction(this, 'ProactiveOutreach', {
            functionName: 'ra-proactive-outreach',
            entry: path.join(lambdaDir, 'proactive-outreach', 'index.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_22_X,
            architecture: lambda.Architecture.ARM_64,
            memorySize: 512,
            timeout: cdk.Duration.seconds(120),
            environment: {
                ACCOUNT_TABLE: props.accountTable.tableName,
                DECISION_TABLE: props.decisionTable.tableName,
                BEDROCK_MODEL_ID: MODEL,
                SENDER_FUNCTION_NAME: this.senderFunction.functionName,
                NODE_OPTIONS: '--enable-source-maps',
            },
            bundling,
        });
        props.accountTable.grantReadWriteData(outreachFn);
        props.identityTable.grantReadData(outreachFn);
        outreachFn.addEnvironment('IDENTITY_TABLE',props.identityTable.tableName);
        props.decisionTable.grantWriteData(outreachFn);
        outreachFn.addToRolePolicy(new iam.PolicyStatement({
            actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
            resources: [`arn:${this.partition}:bedrock:*::foundation-model/amazon.nova-*`, `arn:${this.partition}:bedrock:${this.region}:${this.account}:inference-profile/${MODEL}`],
        }));
        this.senderFunction.grantInvoke(outreachFn);
        // Run the escalation ladder once a day (customers who stay silent escalate).
        new cdk.aws_events.Rule(this, 'OutreachSchedule', {
            schedule: cdk.aws_events.Schedule.rate(cdk.Duration.days(1)),
            targets: [new cdk.aws_events_targets.LambdaFunction(outreachFn)],
        });
        new cdk.CfnOutput(this, 'OrchestratorArn', { value: this.orchestratorFunction.functionArn });
        const otpSender = new nodejs.NodejsFunction(this, 'OtpSender', { functionName: 'ra-otp-sender', entry: path.join(lambdaDir, 'otp-sender', 'index.ts'), handler: 'handler', runtime: lambda.Runtime.NODEJS_22_X, architecture: lambda.Architecture.ARM_64, timeout: cdk.Duration.seconds(30), environment: { CHALLENGE_TABLE: props.challengeTable.tableName, SES_FROM_EMAIL: process.env.SES_FROM_EMAIL ?? 'recovery@example.com', RCS_AGENT_ID: process.env.RCS_AGENT_ID ?? '', EUM_PHONE_POOL_ID: process.env.EUM_PHONE_POOL_ID ?? '', WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '' }, bundling });
        otpSender.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'], resources: [props.challengeTable.tableArn] }));
        otpSender.addToRolePolicy(new iam.PolicyStatement({actions:['sms-voice:SendTextMessage','sms-voice:SendRcsMessage'],resources:process.env.EUM_ORIGINATION_ARNS?.split(',')??['*']}));
        otpSender.addToRolePolicy(new iam.PolicyStatement({actions:['social-messaging:SendWhatsAppMessage'],resources:process.env.WHATSAPP_ORIGINATION_ARN?[process.env.WHATSAPP_ORIGINATION_ARN]:['*']}));
        otpSender.addToRolePolicy(new iam.PolicyStatement({ actions: ['ses:SendEmail'], resources: [`arn:${this.partition}:ses:${this.region}:${this.account}:identity/*`] }));
        const delivery = new nodejs.NodejsFunction(this, 'DeliveryStatus', { entry: path.join(lambdaDir, 'delivery-status', 'index.ts'), handler: 'handler', runtime: lambda.Runtime.NODEJS_22_X, environment: { DECISION_TABLE: props.decisionTable.tableName }, bundling });
        delivery.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:UpdateItem'], resources: [props.decisionTable.tableArn] }));
        // ── Identity Verification (OTP issue/verify) ───────────────────────────
        const verifyFn = new nodejs.NodejsFunction(this, 'IdentityVerification', {
            functionName: 'ra-identity-verification',
            entry: path.join(lambdaDir, 'identity-verification', 'index.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_22_X,
            architecture: lambda.Architecture.ARM_64,
            memorySize: 256,
            timeout: cdk.Duration.seconds(60),
            environment: {
                IDENTITY_TABLE: props.identityTable.tableName,
                CHALLENGE_TABLE: props.challengeTable.tableName,
                OTP_SENDER_FUNCTION_NAME: otpSender.functionName,
                SESSION_TABLE: props.sessionTable.tableName,
                NODE_OPTIONS: '--enable-source-maps',
            },
            bundling,
        });
        verifyFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:PutItem', 'dynamodb:DeleteItem'], resources: [props.sessionTable.tableArn] }));
        props.identityTable.grantReadWriteData(verifyFn);
        props.challengeTable.grantReadWriteData(verifyFn);
        otpSender.grantInvoke(verifyFn);
        new cdk.CfnOutput(this, 'TriageArn', { value: this.triageFunction.functionArn });
        new cdk.CfnOutput(this, 'SenderArn', { value: this.senderFunction.functionArn });
        new cdk.CfnOutput(this, 'OutreachArn', { value: outreachFn.functionArn });
        new cdk.CfnOutput(this,'DeliveryStatusArn',{value:delivery.functionArn});
        new cdk.CfnOutput(this, 'VerificationArn', { value: verifyFn.functionArn });
    }
}
