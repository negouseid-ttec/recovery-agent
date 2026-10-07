import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as path from 'path';

export interface WhatsAppStackProps extends cdk.StackProps {
  triageFunction: lambda.Function;
  conversationTable: dynamodb.Table;
}

export class WhatsAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WhatsAppStackProps) {
    super(scope, id, props);
    const lambdaDir = path.join(__dirname, '..', 'lambda');

    const fn = new nodejs.NodejsFunction(this, 'WhatsAppInbound', {
      functionName: 'ra-whatsapp-inbound',
      entry: path.join(lambdaDir, 'webhooks', 'whatsapp-inbound', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: {
        AGENT_FUNCTION_NAME: props.triageFunction.functionName,
        CONVERSATION_TABLE: props.conversationTable.tableName,
      },
      bundling: { minify: true, sourceMap: true, target: 'node20', format: nodejs.OutputFormat.CJS },
    });
    props.triageFunction.grantInvoke(fn);
    props.conversationTable.grantReadWriteData(fn);
    fn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['social-messaging:GetWhatsAppMessageMedia'], resources: ['*'] }),
    );

    const api = new apigateway.RestApi(this, 'WhatsAppWebhookApi', {
      restApiName: 'recovery-agent-whatsapp',
      description: 'WhatsApp inbound via EUM Social',
      deployOptions: { stageName: 'v1' },
    });
    const r = api.root.addResource('whatsapp');
    r.addMethod('POST', new apigateway.LambdaIntegration(fn));
    r.addMethod('GET', new apigateway.LambdaIntegration(fn)); // Meta verification

    new cdk.CfnOutput(this, 'WhatsAppWebhookUrl', { value: api.url + 'whatsapp' });
  }
}
