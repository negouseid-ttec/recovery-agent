import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class DataStack extends cdk.Stack {
  public readonly conversationTable: dynamodb.Table;
  public readonly accountTable: dynamodb.Table;
  public readonly planTable: dynamodb.Table;
  public readonly identityTable: dynamodb.Table;
  public readonly decisionTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Conversations — one cross-channel thread per customer (keyed by E.164/email)
    this.conversationTable = new dynamodb.Table(this, 'Conversations', {
      tableName: 'ra-conversations',
      partitionKey: { name: 'recipientId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: true,
    });
    this.conversationTable.addGlobalSecondaryIndex({
      indexName: 'by-session',
      partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Accounts — the past-due book
    this.accountTable = new dynamodb.Table(this, 'Accounts', {
      tableName: 'ra-accounts',
      partitionKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    this.accountTable.addGlobalSecondaryIndex({
      indexName: 'by-recipient',
      partitionKey: { name: 'recipientId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    // Indexed access for proactive outreach — query by status instead of Scan.
    this.accountTable.addGlobalSecondaryIndex({
      indexName: 'by-status',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'daysPastDue', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Plans/Promises/Disputes — all keyed by planId (kind discriminates)
    this.planTable = new dynamodb.Table(this, 'Plans', {
      tableName: 'ra-plans',
      partitionKey: { name: 'planId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    this.planTable.addGlobalSecondaryIndex({
      indexName: 'by-account',
      partitionKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    new cdk.CfnOutput(this, 'ConversationTableName', { value: this.conversationTable.tableName });
    new cdk.CfnOutput(this, 'AccountTableName', { value: this.accountTable.tableName });
    new cdk.CfnOutput(this, 'PlanTableName', { value: this.planTable.tableName });

    // Cross-channel identity links — one verified channel identifier → one customer.
    this.identityTable = new dynamodb.Table(this, 'IdentityLinks', {
      tableName: 'ra-identity-links',
      partitionKey: { name: 'channelIdentifier', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    this.identityTable.addGlobalSecondaryIndex({
      indexName: 'by-customer',
      partitionKey: { name: 'customerId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Explainable decision audit log (TTL-expiring).
    this.decisionTable = new dynamodb.Table(this, 'DecisionLog', {
      tableName: 'ra-decision-log',
      partitionKey: { name: 'decisionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });
    this.decisionTable.addGlobalSecondaryIndex({
      indexName: 'by-correlation',
      partitionKey: { name: 'correlationId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    new cdk.CfnOutput(this, 'IdentityTableName', { value: this.identityTable.tableName });
    new cdk.CfnOutput(this, 'DecisionTableName', { value: this.decisionTable.tableName });
  }
}
