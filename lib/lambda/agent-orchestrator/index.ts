/**
 * Agent Orchestrator — the brain of Recovery Agent.
 *
 * Receives a normalized InboundMessage from any channel webhook,
 * loads/creates the cross-channel conversation state, calls Bedrock
 * (Claude) with tool definitions, executes tool calls, and dispatches
 * outbound messages via the channel sender.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type ContentBlock,
  type ToolUseBlock,
} from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { Handler } from 'aws-lambda';
import { v4 as uuid } from 'uuid';
import type { InboundMessage, Conversation, ConversationTurn, OutboundMessage, Channel } from '../../shared/types';
import { SYSTEM_PROMPT, buildToolConfig } from './prompt';
import { executeToolCall } from './tools';

const bedrock = new BedrockRuntimeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambdaClient = new LambdaClient({});

const CONVERSATION_TABLE = process.env.CONVERSATION_TABLE!;
const ACCOUNT_TABLE = process.env.ACCOUNT_TABLE!;
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.amazon.nova-2-lite-v1:0';
const SENDER_FUNCTION = process.env.SENDER_FUNCTION_NAME ?? 'ra-channel-sender';
const MAX_HISTORY_TURNS = 20;
const MAX_TOOL_ROUNDS = 5;

export const handler: Handler = async (event) => {
  const message: InboundMessage = event.message ?? event;
  console.log(`[orchestrator] Inbound from ${message.channel}: ${message.from} → "${message.text?.substring(0, 80)}"`);

  // 1. Load or create conversation
  const conversation = await loadOrCreateConversation(message);

  // 2. Build transient turn-context (sender's stable ID + AI categorization).
  //    This is injected into the system prompt for THIS turn only — it is NOT
  //    persisted into conversation history (which stores the clean message).
  const senderHint =
    `The sender's stable recipientId is "${message.from}". ALWAYS pass this exact ` +
    `value as the recipientId argument to any tool (check_balance, send_receipt, ` +
    `escalate_to_human). Never use a name from the message text as the recipientId.`;

  const categoryHint = message.categorization
    ? ` This inbound message was pre-classified by AI — intent: ${message.categorization.intent}, ` +
      `urgency: ${message.categorization.urgency}, sentiment: ${message.categorization.sentiment}, ` +
      `needsHuman: ${message.categorization.needsHuman}, language: ${message.categorization.language}. ` +
      `${message.categorization.summary} Respect this: if intent is opt_out, call escalate_to_human and send nothing else; ` +
      `if hardship, lead with apply_hardship; if dispute, call log_dispute; if needsHuman is true, escalate_to_human.`
    : '';

  const turnContext = senderHint + categoryHint;

  const userTurn: ConversationTurn = {
    role: 'user',
    channel: message.channel,
    content: message.text,
    timestamp: message.timestamp,
  };
  conversation.history.push(userTurn);

  // 3. Run the agent loop (Bedrock Converse with tool use)
  const { responseText, toolCalls } = await runAgentLoop(conversation, turnContext);

  // 4. Append assistant turn
  const assistantTurn: ConversationTurn = {
    role: 'assistant',
    channel: message.channel,
    content: responseText,
    timestamp: new Date().toISOString(),
    toolCalls,
  };
  conversation.history.push(assistantTurn);

  // 5. Trim history to last N turns
  if (conversation.history.length > MAX_HISTORY_TURNS) {
    conversation.history = conversation.history.slice(-MAX_HISTORY_TURNS);
  }

  // 6. Save conversation
  await saveConversation(conversation);

  // 7. Send the response back via the best channel
  await sendResponse(conversation, responseText, message.channel);

  return { statusCode: 200, body: 'OK' };
};

// ─── Agent Loop ──────────────────────────────────────────────────────────────

async function runAgentLoop(
  conversation: Conversation,
  turnContext: string,
): Promise<{ responseText: string; toolCalls: ConversationTurn['toolCalls'] }> {
  const toolConfig = buildToolConfig();
  const allToolCalls: NonNullable<ConversationTurn['toolCalls']> = [];

  // System prompt + this turn's transient context (sender id, categorization)
  const systemText = turnContext ? `${SYSTEM_PROMPT}\n\n## This Turn\n${turnContext}` : SYSTEM_PROMPT;

  // Build message history for Bedrock (typed as Message[])
  const messages: Message[] = conversation.history.map((turn) => ({
    role: turn.role,
    content: [{ text: turn.content }],
  }));

  let rounds = 0;
  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    const response = await bedrock.send(
      new ConverseCommand({
        modelId: MODEL_ID,
        system: [{ text: systemText }],
        messages,
        toolConfig,
        inferenceConfig: {
          maxTokens: 2048,
          temperature: 0.3,
        },
      }),
    );

    const output = response.output;
    if (output?.$unknown || !output || !('message' in output) || !output.message) {
      break;
    }

    const assistantMessage: Message = output.message;
    messages.push(assistantMessage);

    const content: ContentBlock[] = assistantMessage.content ?? [];

    // Collect tool-use blocks via the SDK's type guard (no casts)
    const toolUseBlocks: ToolUseBlock[] = content
      .filter((block): block is ContentBlock.ToolUseMember => block.toolUse !== undefined)
      .map((block) => block.toolUse);

    if (toolUseBlocks.length === 0) {
      // No tool calls — extract the text response
      const textBlock = content.find(
        (block): block is ContentBlock.TextMember => block.text !== undefined,
      );
      return {
        responseText: textBlock?.text ?? 'I apologize, I was unable to process your request.',
        toolCalls: allToolCalls,
      };
    }

    // Execute each tool call
    const toolResults: ContentBlock[] = [];
    for (const toolUse of toolUseBlocks) {
      console.log(`[orchestrator] Tool call: ${toolUse.name}`, JSON.stringify(toolUse.input));

      const result = await executeToolCall(
        toolUse.name!,
        (toolUse.input ?? {}) as Record<string, unknown>,
        conversation,
      );
      const outputStr = typeof result === 'string' ? result : JSON.stringify(result);

      allToolCalls.push({
        tool: toolUse.name!,
        input: (toolUse.input ?? {}) as Record<string, unknown>,
        output: outputStr,
      });

      toolResults.push({
        toolResult: {
          toolUseId: toolUse.toolUseId,
          content: [{ text: outputStr }],
        },
      });
    }

    // Feed tool results back
    messages.push({ role: 'user', content: toolResults });
  }

  return {
    responseText: 'I apologize, I encountered an issue processing your request. Please try again.',
    toolCalls: allToolCalls,
  };
}

// ─── Conversation Persistence ────────────────────────────────────────────────

async function loadOrCreateConversation(message: InboundMessage): Promise<Conversation> {
  const recipientId = message.from; // E.164 phone or email

  const result = await ddb.send(
    new GetCommand({
      TableName: CONVERSATION_TABLE,
      Key: { recipientId },
    }),
  );

  if (result.Item) {
    const conv = result.Item as Conversation;
    // Update channel list if this is a new channel for this recipient
    if (!conv.channels.find((c) => c.channel === message.channel && c.address === message.from)) {
      conv.channels.push({ channel: message.channel, address: message.from });
    }
    conv.updatedAt = new Date().toISOString();
    return conv;
  }

  // New conversation
  const now = new Date();
  return {
    recipientId,
    sessionId: uuid(),
    preferredChannel: message.channel,
    channels: [{ channel: message.channel, address: message.from }],
    language: 'en-US',
    history: [],
    accountIds: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ttl: Math.floor(now.getTime() / 1000) + 90 * 24 * 3600, // 90 days
  };
}

async function saveConversation(conversation: Conversation): Promise<void> {
  conversation.updatedAt = new Date().toISOString();
  await ddb.send(
    new PutCommand({
      TableName: CONVERSATION_TABLE,
      Item: conversation,
    }),
  );
}

// ─── Send Response ───────────────────────────────────────────────────────────

async function sendResponse(
  conversation: Conversation,
  text: string,
  inboundChannel: Channel,
): Promise<void> {
  const outbound: OutboundMessage = {
    type: 'text',
    recipientId: conversation.recipientId,
    text,
    channel: inboundChannel, // Reply on the same channel they wrote on
  };

  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: SENDER_FUNCTION,
      InvocationType: 'Event', // Async — don't block the response
      Payload: Buffer.from(JSON.stringify(outbound)),
    }),
  );
}
