/**
 * SMS/RCS Inbound Webhook — normalizes EUM inbound events to InboundMessage.
 *
 * EUM delivers inbound messages via SNS notifications (for two-way SMS)
 * or API Gateway webhooks. This handler normalizes both SMS and RCS
 * payloads into the unified InboundMessage type and invokes the
 * agent orchestrator.
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuid } from 'uuid';
import type { InboundMessage, Channel } from '../../../shared/types';

const lambdaClient = new LambdaClient({});
const AGENT_FUNCTION = process.env.AGENT_FUNCTION_NAME!;

/** Shape of the EUM SMS/RCS inbound payloads we handle (all fields optional — external JSON). */
interface EumInboundPayload {
  messageId?: string;
  messageBody?: string;
  originationNumber?: string;
  destinationNumber?: string;
  mediaUrls?: string[];
  senderPhoneNumber?: string;
  agentId?: string;
  sendTime?: string;
  rbmEvent?: unknown;
  text?: string;
  contentMessage?: {
    text?: string;
    contentInfo?: { fileUrl: string; mimeType?: string };
  };
  suggestionResponse?: { text?: string; postbackData?: string };
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('[sms-rcs-inbound] Received event');

  try {
    const body = JSON.parse(event.body ?? '{}') as { Message?: string } & EumInboundPayload;

    // Determine if this is an SNS notification wrapper or direct API Gateway
    const payload: EumInboundPayload = body.Message
      ? (JSON.parse(body.Message) as EumInboundPayload)
      : body;

    const inbound = normalizeEumInbound(payload);
    if (!inbound) {
      console.log('[sms-rcs-inbound] Unrecognized payload, skipping');
      return { statusCode: 200, body: 'OK' };
    }

    console.log(`[sms-rcs-inbound] ${inbound.channel} from ${inbound.from}: "${inbound.text?.substring(0, 60)}"`);

    // Invoke the agent orchestrator asynchronously
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: AGENT_FUNCTION,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ message: inbound })),
      }),
    );

    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('[sms-rcs-inbound] Error:', err);
    return { statusCode: 500, body: 'Internal error' };
  }
};

function normalizeEumInbound(payload: EumInboundPayload): InboundMessage | null {
  // EUM two-way SMS notification format
  if (payload.messageBody && payload.originationNumber) {
    return {
      messageId: payload.messageId ?? uuid(),
      channel: detectChannel(payload),
      from: payload.originationNumber,
      to: payload.destinationNumber ?? '',
      timestamp: new Date().toISOString(),
      text: payload.messageBody,
      media: payload.mediaUrls?.map((url) => ({
        url,
        mimeType: 'application/octet-stream',
      })),
      rawPayload: payload,
    };
  }

  // RCS inbound message format
  if (payload.senderPhoneNumber && (payload.text || payload.contentMessage)) {
    return {
      messageId: payload.messageId ?? uuid(),
      channel: 'rcs',
      from: payload.senderPhoneNumber,
      to: payload.agentId ?? '',
      timestamp: payload.sendTime ?? new Date().toISOString(),
      text: payload.text ?? payload.contentMessage?.text ?? '',
      media: payload.contentMessage?.contentInfo
        ? [
            {
              url: payload.contentMessage.contentInfo.fileUrl,
              mimeType: payload.contentMessage.contentInfo.mimeType ?? 'application/octet-stream',
            },
          ]
        : undefined,
      rawPayload: payload,
    };
  }

  // Suggestion reply (RCS postback)
  if (payload.suggestionResponse) {
    return {
      messageId: payload.messageId ?? uuid(),
      channel: 'rcs',
      from: payload.senderPhoneNumber ?? '',
      to: payload.agentId ?? '',
      timestamp: new Date().toISOString(),
      text: payload.suggestionResponse.text ?? payload.suggestionResponse.postbackData ?? '',
      rawPayload: payload,
    };
  }

  return null;
}

function detectChannel(payload: EumInboundPayload): Channel {
  // If it came through an RCS agent, it's RCS
  if (payload.agentId || payload.rbmEvent) return 'rcs';
  return 'sms';
}
