import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as path from 'path';

export interface MessagingStackProps extends cdk.StackProps {
  triageFunction: lambda.Function;
  conversationTable: dynamodb.Table;
}

export class MessagingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MessagingStackProps) {
    super(scope, id, props);
    const lambdaDir = path.join(__dirname, '..', 'lambda');
    const bundling = { minify: true, sourceMap: true, target: 'node20', format: nodejs.OutputFormat.CJS };

    const api = new apigateway.RestApi(this, 'WebhookApi', {
      restApiName: 'recovery-agent-webhooks',
      description: 'Inbound SMS/RCS and email webhooks → message triage',
      deployOptions: { stageName: 'v1', throttlingRateLimit: 100, throttlingBurstLimit: 200 },
    });

    const mkWebhook = (name: string, fn: string) =>
      new nodejs.NodejsFunction(this, name, {
        functionName: `ra-${fn}`,
        entry: path.join(lambdaDir, 'webhooks', fn, 'index.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 256,
        timeout: cdk.Duration.seconds(30),
        environment: {
          AGENT_FUNCTION_NAME: props.triageFunction.functionName, // inbound → triage first
          CONVERSATION_TABLE: props.conversationTable.tableName,
        },
        bundling,
      });

    const smsFn = mkWebhook('SmsRcsInbound', 'sms-rcs-inbound');
    props.triageFunction.grantInvoke(smsFn);
    props.conversationTable.grantReadWriteData(smsFn);
    api.root.addResource('sms').addMethod('POST', new apigateway.LambdaIntegration(smsFn));

    const emailFn = mkWebhook('EmailInbound', 'email-inbound');
    props.triageFunction.grantInvoke(emailFn);
    props.conversationTable.grantReadWriteData(emailFn);
    api.root.addResource('email').addMethod('POST', new apigateway.LambdaIntegration(emailFn));

    new cdk.CfnOutput(this, 'WebhookApiUrl', { value: api.url });
  }
}
