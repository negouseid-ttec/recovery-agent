/**
 * WhatsApp Inbound Webhook — normalizes EUM Social (WhatsApp) events.
 *
 * Handles both:
 * - GET: Meta webhook verification challenge
 * - POST: Incoming WhatsApp messages (text, media, interactive replies)
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuid } from 'uuid';
import type { InboundMessage } from '../../../shared/types';

const lambdaClient = new LambdaClient({});
const AGENT_FUNCTION = process.env.AGENT_FUNCTION_NAME!;

/** Minimal WhatsApp Cloud API inbound shapes (fields optional — external JSON). */
interface WhatsAppMedia {
  id?: string;
  mime_type?: string;
  filename?: string;
  caption?: string;
}
interface WhatsAppMessage {
  id?: string;
  from: string;
  timestamp: string;
  type: 'text' | 'image' | 'document' | 'video' | 'interactive' | string;
  text?: { body?: string };
  image?: WhatsAppMedia;
  document?: WhatsAppMedia;
  video?: WhatsAppMedia;
  interactive?: {
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
}
interface WhatsAppChangeValue {
  metadata?: { display_phone_number?: string };
  messages?: WhatsAppMessage[];
}
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN ?? 'benefits-concierge-verify';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // ── GET: Webhook verification challenge ──────────────────────────────
  if (event.httpMethod === 'GET') {
    const mode = event.queryStringParameters?.['hub.mode'];
    const token = event.queryStringParameters?.['hub.verify_token'];
    const challenge = event.queryStringParameters?.['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[whatsapp-inbound] Webhook verified');
      return { statusCode: 200, body: challenge ?? '' };
    }
    return { statusCode: 403, body: 'Forbidden' };
  }

  // ── POST: Incoming WhatsApp message ──────────────────────────────────
  try {
    const body = JSON.parse(event.body ?? '{}') as {
      entry?: { changes?: { field?: string; value?: WhatsAppChangeValue }[] }[];
    };

    // WhatsApp Cloud API webhook payload structure
    const entries = body.entry ?? [];
    for (const entry of entries) {
      const changes = entry.changes ?? [];
      for (const change of changes) {
        if (change.field !== 'messages') continue;

        const messages = change.value?.messages ?? [];
        for (const msg of messages) {
          const inbound = normalizeWhatsAppMessage(msg, change.value ?? {});
          if (!inbound) continue;

          console.log(`[whatsapp-inbound] From ${inbound.from}: "${inbound.text?.substring(0, 60)}"`);

          await lambdaClient.send(
            new InvokeCommand({
              FunctionName: AGENT_FUNCTION,
              InvocationType: 'Event',
              Payload: Buffer.from(JSON.stringify({ message: inbound })),
            }),
          );
        }
      }
    }

    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('[whatsapp-inbound] Error:', err);
    return { statusCode: 500, body: 'Internal error' };
  }
};

function normalizeWhatsAppMessage(msg: WhatsAppMessage, value: WhatsAppChangeValue): InboundMessage | null {
  const from = msg.from; // WhatsApp phone number (no + prefix)
  const recipientPhone = `+${from}`;

  switch (msg.type) {
    case 'text':
      return {
        messageId: msg.id ?? uuid(),
        channel: 'whatsapp',
        from: recipientPhone,
        to: value.metadata?.display_phone_number ?? '',
        timestamp: new Date(parseInt(msg.timestamp) * 1000).toISOString(),
        text: msg.text?.body ?? '',
        rawPayload: msg,
      };

    case 'image':
    case 'document':
    case 'video': {
      const media: WhatsAppMedia | undefined =
        msg.type === 'image' ? msg.image : msg.type === 'document' ? msg.document : msg.video;
      return {
        messageId: msg.id ?? uuid(),
        channel: 'whatsapp',
        from: recipientPhone,
        to: value.metadata?.display_phone_number ?? '',
        timestamp: new Date(parseInt(msg.timestamp) * 1000).toISOString(),
        text: media?.caption ?? `[${msg.type} attachment]`,
        media: [
          {
            url: media?.id ?? '', // WhatsApp media ID — needs download via API
            mimeType: media?.mime_type ?? 'application/octet-stream',
            filename: media?.filename,
          },
        ],
        rawPayload: msg,
      };
    }

    case 'interactive': {
      // Button reply or list selection
      const interactive = msg.interactive;
      const replyText =
        interactive?.button_reply?.title ??
        interactive?.list_reply?.title ??
        interactive?.button_reply?.id ??
        '';
      return {
        messageId: msg.id ?? uuid(),
        channel: 'whatsapp',
        from: recipientPhone,
        to: value.metadata?.display_phone_number ?? '',
        timestamp: new Date(parseInt(msg.timestamp) * 1000).toISOString(),
        text: replyText,
        rawPayload: msg,
      };
    }

    default:
      console.log(`[whatsapp-inbound] Unsupported message type: ${msg.type}`);
      return null;
  }
}
