/**
 * Message Triage — the inbound-intelligence hero component.
 *
 * When a past-due customer replies (via SES receiving, two-way SMS/RCS, or
 * WhatsApp), we DON'T just hand the raw text to the agent. First we use Amazon
 * Bedrock to CLASSIFY the message: what's their intent (promise to pay? dispute?
 * hardship? opt-out?), how do they feel, and does it need a human? That drives
 * routing — a distressed hardship message gets empathy and a hold, a dispute
 * pauses collection, an opt-out stops contact immediately.
 *
 * Mirrors AWS's "Email Categorization" reference sample for an Agentic AI
 * Communications Hub, applied to autonomous revenue recovery.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type ContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { Handler } from 'aws-lambda';
import { v4 as uuid } from 'uuid';
import type { InboundMessage, InboundCategorization } from '../../shared/types';

const bedrock = new BedrockRuntimeClient({});
const lambdaClient = new LambdaClient({});

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.amazon.nova-2-lite-v1:0';
const AGENT_FUNCTION = process.env.AGENT_FUNCTION_NAME ?? 'ra-agent-orchestrator';

const CLASSIFY_PROMPT = `You triage inbound messages from telecom customers who have a PAST-DUE balance and were contacted by a collections agent.

Return a JSON object (and NOTHING else) with these fields:
- intent: one of promise_to_pay | payment_plan_request | dispute | hardship | already_paid | churn_threat | question | opt_out | other
- urgency: low | medium | high | critical  (critical = legal/bankruptcy mention, severe distress, or opt-out)
- sentiment: cooperative | neutral | frustrated | distressed | hostile
- needsHuman: boolean (true for opt-out, legal/bankruptcy, hostility, or complex disputes)
- language: BCP-47 code (e.g. en-US, es-US)
- summary: one plain-language sentence of what the customer wants
- suggestedAction: short phrase for the next step (e.g. "record promise to pay", "apply hardship hold", "pause and route dispute", "stop contact")

Rules: "STOP", "stop texting me", "do not contact" => intent opt_out, needsHuman true. Any mention of a lawyer or bankruptcy => needsHuman true. Job loss / illness / "can't afford" => intent hardship, sentiment distressed. Classify accurately; a missed opt-out or hardship is a compliance failure.`;

export const handler: Handler = async (event) => {
  const text: string = event.text ?? event.emailBody ?? extractText(event);
  const from: string = event.from ?? event.source ?? 'unknown';
  const channel = (event.channel as InboundMessage['channel']) ?? 'email';

  console.log(`[triage] Inbound ${channel} from ${from}: "${text.substring(0, 80)}"`);

  const categorization = await classify(text);
  console.log('[triage] Result:', JSON.stringify(categorization));

  const inbound: InboundMessage = {
    messageId: uuid(),
    channel,
    from,
    to: event.to ?? event.destination ?? '',
    timestamp: new Date().toISOString(),
    text,
    categorization,
  };

  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: AGENT_FUNCTION,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ message: inbound })),
    }),
  );

  return { statusCode: 200, categorization };
};

async function classify(text: string): Promise<InboundCategorization> {
  const messages: Message[] = [{ role: 'user', content: [{ text: `Triage this message:\n\n${text}` }] }];
  const resp = await bedrock.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: CLASSIFY_PROMPT }],
      messages,
      inferenceConfig: { maxTokens: 512, temperature: 0 },
    }),
  );
  const output = resp.output;
  if (!output || !('message' in output) || !output.message) return fallback(text);
  const content: ContentBlock[] = output.message.content ?? [];
  const textBlock = content.find((b): b is ContentBlock.TextMember => b.text !== undefined);
  if (!textBlock) return fallback(text);
  try {
    const match = textBlock.text.match(/\{[\s\S]*\}/);
    if (!match) return fallback(text);
    const p = JSON.parse(match[0]) as Partial<InboundCategorization>;
    return {
      intent: p.intent ?? 'other',
      urgency: p.urgency ?? 'medium',
      sentiment: p.sentiment ?? 'neutral',
      needsHuman: p.needsHuman ?? false,
      language: p.language ?? 'en-US',
      summary: p.summary ?? 'Inbound message',
      suggestedAction: p.suggestedAction ?? 'route to agent',
    };
  } catch {
    return fallback(text);
  }
}

function fallback(text: string): InboundCategorization {
  const t = text.toLowerCase();
  const optOut = /\bstop\b|opt.?out|do not contact|cease/.test(t);
  const legal = /lawyer|attorney|bankrupt|sue|legal/.test(t);
  const hardship = /lost my job|laid off|can.?t afford|illness|sick|hospital|hardship|no money/.test(t);
  const dispute = /dispute|not my|didn.?t|wrong|already paid|incorrect/.test(t);
  return {
    intent: optOut ? 'opt_out' : hardship ? 'hardship' : dispute ? 'dispute' : /plan|split|installment/.test(t) ? 'payment_plan_request' : 'question',
    urgency: optOut || legal ? 'critical' : hardship ? 'high' : 'medium',
    sentiment: hardship ? 'distressed' : /angry|ridiculous|unacceptable|!!/.test(t) ? 'frustrated' : 'neutral',
    needsHuman: optOut || legal,
    language: 'en-US',
    summary: 'Inbound message (keyword fallback)',
    suggestedAction: optOut ? 'stop contact' : hardship ? 'apply hardship hold' : 'route to agent',
  };
}

function extractText(event: Record<string, unknown>): string {
  if (typeof event.content === 'string') return event.content;
  if (typeof event.body === 'string') return event.body;
  return JSON.stringify(event);
}
