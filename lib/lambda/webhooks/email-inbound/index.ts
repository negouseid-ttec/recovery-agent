/**
 * Email Inbound Webhook — normalizes SES inbound email events.
 *
 * SES receiving rules can forward inbound emails (recipient replies)
 * via SNS notification or S3 + Lambda trigger.
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuid } from 'uuid';
import type { InboundMessage } from '../../../shared/types';

const lambdaClient = new LambdaClient({});
const AGENT_FUNCTION = process.env.AGENT_FUNCTION_NAME!;

/** Minimal SES inbound mail metadata (fields optional — external JSON). */
interface SesMail {
  messageId?: string;
  source?: string;
  from?: string[];
  destination?: string[];
  timestamp?: string;
}
interface SesNotification {
  mail?: SesMail;
  content?: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('[email-inbound] Received event');

  try {
    const body = JSON.parse(event.body ?? '{}') as { Message?: string } & SesNotification;

    // SES notification via SNS wrapper
    const notification: SesNotification = body.Message
      ? (JSON.parse(body.Message) as SesNotification)
      : body;
    const mail: SesMail = notification.mail ?? {};
    const content = notification.content ?? '';

    // Extract the plain text body from the email
    const textBody = extractPlainText(content);
    if (!textBody) {
      console.log('[email-inbound] No text content, skipping');
      return { statusCode: 200, body: 'OK' };
    }

    const fromEmail = mail.source ?? mail.from?.[0] ?? '';
    // Try to find the recipient's phone from the reply-to address or headers
    // Convention: benefits+{phone}@domain.com
    const recipientId = extractRecipientId(mail);

    const inbound: InboundMessage = {
      messageId: mail.messageId ?? uuid(),
      channel: 'email',
      from: recipientId ?? fromEmail,
      to: mail.destination?.[0] ?? '',
      timestamp: mail.timestamp ?? new Date().toISOString(),
      text: textBody,
      rawPayload: notification,
    };

    console.log(`[email-inbound] From ${inbound.from}: "${inbound.text?.substring(0, 60)}"`);

    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: AGENT_FUNCTION,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ message: inbound })),
      }),
    );

    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('[email-inbound] Error:', err);
    return { statusCode: 500, body: 'Internal error' };
  }
};

function extractPlainText(content: string): string {
  if (!content) return '';

  // Simple extraction: look for text/plain MIME part or just return the content
  // A production implementation would use a MIME parser
  const textMatch = content.match(/Content-Type:\s*text\/plain[\s\S]*?\n\n([\s\S]*?)(?:\n--|\n\n--)/);
  if (textMatch) return textMatch[1].trim();

  // If it's just plain text (not MIME)
  if (!content.includes('Content-Type:')) return content.trim();

  // Fallback: strip HTML tags if it's HTML
  return content.replace(/<[^>]*>/g, '').trim().substring(0, 2000);
}

function extractRecipientId(mail: SesMail): string | null {
  // Convention: we encode the recipient's phone in the reply-to address
  // e.g., benefits+15551234567@domain.com
  const to = mail.destination?.[0] ?? '';
  const match = to.match(/benefits\+(\+?\d{10,15})@/);
  if (match) return match[1].startsWith('+') ? match[1] : `+${match[1]}`;
  return null;
}
