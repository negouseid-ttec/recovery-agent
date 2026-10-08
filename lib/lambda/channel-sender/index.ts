/**
 * Channel Sender — routes outbound messages to the optimal channel.
 *
 * Receives a typed OutboundMessage and dispatches it via the
 * appropriate AWS service: EUM (SMS/RCS), EUM Social (WhatsApp), or SES.
 */

import {
  PinpointSMSVoiceV2Client,
  SendTextMessageCommand,
  SendRcsMessageCommand,
} from '@aws-sdk/client-pinpoint-sms-voice-v2';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { Handler } from 'aws-lambda';
import type { OutboundMessage, Conversation, Channel } from '../../shared/types';

const eum = new PinpointSMSVoiceV2Client({});
const ses = new SESv2Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CONVERSATION_TABLE = process.env.CONVERSATION_TABLE!;
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'recovery@example.com';
const EUM_PHONE_POOL_ID = process.env.EUM_PHONE_POOL_ID ?? '';
const RCS_AGENT_ID = process.env.RCS_AGENT_ID ?? '';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? '';

export const handler: Handler = async (event) => {
  const message: OutboundMessage = event;
  console.log(`[sender] Outbound ${message.type} to ${message.recipientId}`);

  switch (message.type) {
    case 'text':
      return sendText(message);
    case 'rich_card':
      return sendRichCard(message);
    case 'carousel':
      return sendCarousel(message);
    case 'email':
      return sendEmail(message);
    default: {
      const unknownMessage: never = message;
      console.error('[sender] Unknown message type:', JSON.stringify(unknownMessage));
      return { statusCode: 400, body: 'Unknown message type' };
    }
  }
};

// ─── Text Message (SMS / RCS / WhatsApp) ────────────────────────────────────

async function sendText(message: { recipientId: string; text: string; channel?: Channel }) {
  const channel = message.channel ?? (await resolvePreferredChannel(message.recipientId));

  switch (channel) {
    case 'sms':
      return sendSms(message.recipientId, message.text);
    case 'rcs':
      return sendRcs(message.recipientId, message.text);
    case 'whatsapp':
      return sendWhatsApp(message.recipientId, message.text);
    case 'email':
      // Fallback: if channel is email but we got a text message, wrap it
      return sendEmailText(message.recipientId, message.text);
    default:
      return sendSms(message.recipientId, message.text); // SMS is always the fallback
  }
}

// ─── SMS via EUM ────────────────────────────────────────────────────────────

async function sendSms(to: string, text: string) {
  console.log(`[sender] SMS → ${to}: "${text.substring(0, 50)}..."`);

  // Split long messages for SMS (160 char segments)
  const segments = splitSmsMessage(text);

  for (const segment of segments) {
    await eum.send(
      new SendTextMessageCommand({
        DestinationPhoneNumber: to,
        MessageBody: segment,
        ConfigurationSetName: 'ra-messaging',
        // MessageType defaults to TRANSACTIONAL
      }),
    );
  }

  return { success: true, channel: 'sms', segments: segments.length };
}

function splitSmsMessage(text: string, maxLen = 160): string[] {
  if (text.length <= maxLen) return [text];
  const segments: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      segments.push(remaining);
      break;
    }
    // Find a word boundary near the limit
    let splitAt = remaining.lastIndexOf(' ', maxLen);
    if (splitAt < maxLen * 0.6) splitAt = maxLen; // No good break point
    segments.push(remaining.substring(0, splitAt).trim());
    remaining = remaining.substring(splitAt).trim();
  }
  return segments;
}

// ─── RCS via EUM (real SendRcsMessage API) ──────────────────────────────────
// RCS_AGENT_ID is the origination identity for RCS; EUM auto-falls back to SMS
// (billed as SMS) when the device/carrier can't receive RCS.

async function sendRcs(to: string, text: string) {
  console.log(`[sender] RCS → ${to}: "${text.substring(0, 50)}..."`);

  if (!RCS_AGENT_ID) {
    return sendSms(to, text);
  }

  await eum.send(
    new SendRcsMessageCommand({
      OriginationIdentity: RCS_AGENT_ID,
      DestinationPhoneNumber: to,
      RcsMessageContent: {
        Content: { TextMessage: { Body: text } },
      },
    }),
  );

  return { success: true, channel: 'rcs' };
}

// ─── Rich Card (RCS) ───────────────────────────────────────────────────────

async function sendRichCard(message: {
  recipientId: string;
  title: string;
  description: string;
  imageUrl?: string;
  suggestions: { text: string; postbackData?: string }[];
  channel?: Channel;
}) {
  console.log(`[sender] Rich Card → ${message.recipientId}: "${message.title}"`);

  if (!RCS_AGENT_ID) {
    const flat = `${message.title}\n${message.description}\n` +
      message.suggestions.map((s) => `• ${s.text}`).join('\n');
    return sendSms(message.recipientId, flat);
  }

  await eum.send(
    new SendRcsMessageCommand({
      OriginationIdentity: RCS_AGENT_ID,
      DestinationPhoneNumber: message.recipientId,
      RcsMessageContent: {
        Content: {
          RichCard: {
            CardContent: {
              Title: message.title,
              Description: message.description,
              ...(message.imageUrl && {
                Media: { Height: 'MEDIUM', FileUrl: message.imageUrl },
              }),
              Suggestions: message.suggestions.map((s) => ({
                Reply: { Text: s.text, PostbackData: s.postbackData ?? s.text },
              })),
            },
            CardOrientation: 'VERTICAL',
          },
        },
      },
    }),
  );

  return { success: true, channel: 'rcs', type: 'rich_card' };
}

// ─── Carousel (RCS) ────────────────────────────────────────────────────────

async function sendCarousel(message: {
  recipientId: string;
  cards: { title: string; description: string; suggestions: { text: string }[] }[];
  channel?: Channel;
}) {
  console.log(`[sender] Carousel → ${message.recipientId}: ${message.cards.length} cards`);

  if (!RCS_AGENT_ID) {
    const flat = message.cards
      .map((c) => `${c.title}\n${c.description}\n` + c.suggestions.map((s) => `• ${s.text}`).join('\n'))
      .join('\n\n');
    return sendSms(message.recipientId, flat);
  }

  await eum.send(
    new SendRcsMessageCommand({
      OriginationIdentity: RCS_AGENT_ID,
      DestinationPhoneNumber: message.recipientId,
      RcsMessageContent: {
        Content: {
          Carousel: {
            CardWidth: 'MEDIUM',
            CardContents: message.cards.map((card) => ({
              Title: card.title,
              Description: card.description,
              Suggestions: card.suggestions.map((s) => ({
                Reply: { Text: s.text, PostbackData: s.text },
              })),
            })),
          },
        },
      },
    }),
  );

  return { success: true, channel: 'rcs', type: 'carousel' };
}

// ─── WhatsApp via EUM Social ────────────────────────────────────────────────

async function sendWhatsApp(to: string, text: string) {
  console.log(`[sender] WhatsApp → ${to}: "${text.substring(0, 50)}..."`);

  // AWS EUM Social uses the social-messaging:SendWhatsAppMessage API
  // For now, we construct the WhatsApp Cloud API message format
  const whatsappPayload = {
    messaging_product: 'whatsapp',
    to: to.replace('+', ''), // WhatsApp wants no + prefix
    type: 'text',
    text: { body: text },
  };

  // In production, this calls the EUM Social SendWhatsAppMessage API
  // which wraps the WhatsApp Cloud API
  const { SocialMessagingClient, SendWhatsAppMessageCommand } = await import(
    '@aws-sdk/client-socialmessaging'
  );
  const socialClient = new SocialMessagingClient({});
  await socialClient.send(
    new SendWhatsAppMessageCommand({
      originationPhoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
      message: Buffer.from(JSON.stringify(whatsappPayload)),
      metaApiVersion: 'v21.0',
    }),
  );

  return { success: true, channel: 'whatsapp' };
}

// ─── Email via SES ──────────────────────────────────────────────────────────

async function sendEmail(message: {
  recipientId: string;
  subject: string;
  htmlBody: string;
  textBody: string;
}) {
  console.log(`[sender] Email → ${message.recipientId}: "${message.subject}"`);

  // Look up the recipient's email address from conversation
  const emailAddress = await resolveEmailAddress(message.recipientId);

  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: SES_FROM_EMAIL,
      Destination: { ToAddresses: [emailAddress] },
      Content: {
        Simple: {
          Subject: { Data: message.subject },
          Body: {
            Html: { Data: message.htmlBody },
            Text: { Data: message.textBody },
          },
        },
      },
    }),
  );

  return { success: true, channel: 'email' };
}

async function sendEmailText(to: string, text: string) {
  return sendEmail({
    recipientId: to,
    subject: 'Recovery Agent — Account Update',
    htmlBody: `<p>${text.replace(/\n/g, '<br>')}</p>`,
    textBody: text,
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function resolvePreferredChannel(recipientId: string): Promise<Channel> {
  try {
    const result = await ddb.send(
      new GetCommand({
        TableName: CONVERSATION_TABLE,
        Key: { recipientId },
        ProjectionExpression: 'preferredChannel',
      }),
    );
    return (result.Item?.preferredChannel as Channel) ?? 'sms';
  } catch {
    return 'sms'; // Default fallback
  }
}

async function resolveEmailAddress(recipientId: string): Promise<string> {
  // If it's already an email address, return it
  if (recipientId.includes('@')) return recipientId;

  // Look up from conversation record
  const result = await ddb.send(
    new GetCommand({
      TableName: CONVERSATION_TABLE,
      Key: { recipientId },
      ProjectionExpression: 'channels',
    }),
  );

  const emailChannel = (result.Item?.channels ?? []).find(
    (c: { channel: string }) => c.channel === 'email',
  );
  return emailChannel?.address ?? `${recipientId}@placeholder.example.com`;
}
