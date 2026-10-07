/**
 * Recovery Agent prompt + Bedrock Converse tool configuration.
 */

import type { Tool, ToolConfiguration } from '@aws-sdk/client-bedrock-runtime';

export const SYSTEM_PROMPT = `You are Recovery Agent, an AI assistant for a telecom company that helps customers resolve past-due balances. You recover revenue through respectful conversation — not pressure.

## Your Goal
Help the customer bring their account current in the way that works for them: pay now, set up a payment plan, or — if they're in genuine hardship — pause and route to a specialist. A kept payment plan is a win. A customer who feels respected and pays later is a win. A churned customer is a loss.

## Tone
- Respectful, calm, and human — never threatening, shaming, or robotic.
- Acknowledge the person before the balance ("I know bills pile up — let's sort this out together").
- Match the customer's language; if they write in Spanish, respond in Spanish.
- Short messages for SMS/RCS; warmer and fuller on WhatsApp and email.

## Compliance (hard rules — never violate)
- NEVER threaten legal action, arrest, or consequences you can't substantiate.
- NEVER disclose the debt to anyone but the account holder.
- If the customer says STOP, opts out, or asks you to cease contact → call escalate_to_human with reason "opt_out" and send nothing further.
- If the customer mentions a lawyer, bankruptcy, or disputes the debt → log_dispute and/or escalate_to_human; do not keep pushing to collect.
- If the customer describes genuine hardship (job loss, illness, death in family) → lead with apply_hardship, suppress urgency, offer the most lenient plan.

## Playbook
- ALWAYS check_balance before discussing any specifics — never guess an amount.
- Offer concrete options with real numbers: "Your balance is $84. I can split that into 3 payments of $28, or you can pay today — which is easier?"
- When they commit to a date, record_promise_to_pay. When they want to split it, offer_payment_plan.
- After any commitment, send_receipt with the written confirmation (email paper trail).
- Keep plans realistic against their monthly charge; don't propose installments larger than the past-due balance.

## Channel Awareness
Conversations span SMS, RCS, WhatsApp, and email, and you keep ONE continuous thread across all of them. A customer who got an SMS nudge and taps an RCS button, then messages on WhatsApp, is the same person — pick up exactly where you left off.`;

export function buildToolConfig(): ToolConfiguration {
  return {
    tools: [
      {
        toolSpec: {
          name: 'check_balance',
          description:
            'Look up a customer\'s account and past-due balance. Search by accountId or by the customer\'s recipientId (phone E.164 or email). Returns balance, days past due, suspension date, status, and monthly charge. ALWAYS call this before discussing specific amounts.',
          inputSchema: {
            json: {
              type: 'object',
              properties: {
                accountId: { type: 'string', description: 'Specific account ID' },
                recipientId: { type: 'string', description: 'Customer phone (E.164) or email to find their account(s)' },
              },
            },
          },
        },
      },
      {
        toolSpec: {
          name: 'offer_payment_plan',
          description:
            'Create a payment plan that splits the past-due balance into installments. Returns the confirmed plan with installment amount and schedule. Keep installments realistic.',
          inputSchema: {
            json: {
              type: 'object',
              properties: {
                accountId: { type: 'string' },
                installments: { type: 'number', description: 'Number of payments (2-6 typical)' },
                frequency: { type: 'string', enum: ['weekly', 'biweekly', 'monthly'] },
                firstPaymentDate: { type: 'string', description: 'YYYY-MM-DD' },
              },
              required: ['accountId', 'installments', 'frequency'],
            },
          },
        },
      },
      {
        toolSpec: {
          name: 'record_promise_to_pay',
          description:
            'Record a customer\'s commitment to pay a specific amount by a specific date (a "promise to pay"). Use when the customer says they will pay in full by a date.',
          inputSchema: {
            json: {
              type: 'object',
              properties: {
                accountId: { type: 'string' },
                amountCents: { type: 'number', description: 'Amount in cents' },
                promisedDate: { type: 'string', description: 'YYYY-MM-DD' },
              },
              required: ['accountId', 'promisedDate'],
            },
          },
        },
      },
      {
        toolSpec: {
          name: 'apply_hardship',
          description:
            'Flag the account for financial hardship (job loss, illness, bereavement). Places a hardship hold, suppresses late fees and suspension, and offers the most lenient terms. Use the moment genuine hardship is expressed.',
          inputSchema: {
            json: {
              type: 'object',
              properties: {
                accountId: { type: 'string' },
                reason: { type: 'string', description: 'Brief hardship reason the customer gave' },
              },
              required: ['accountId', 'reason'],
            },
          },
        },
      },
      {
        toolSpec: {
          name: 'log_dispute',
          description:
            'Record a dispute when the customer contests the charge. Pauses collection on the disputed amount and routes for review.',
          inputSchema: {
            json: {
              type: 'object',
              properties: {
                accountId: { type: 'string' },
                reason: { type: 'string' },
                amountDisputedCents: { type: 'number' },
              },
              required: ['accountId', 'reason'],
            },
          },
        },
      },
      {
        toolSpec: {
          name: 'send_receipt',
          description:
            'Send a written confirmation email (the compliance paper trail): payment plan terms, promise-to-pay confirmation, hardship hold, or dispute acknowledgment. Use after any commitment or status change.',
          inputSchema: {
            json: {
              type: 'object',
              properties: {
                recipientId: { type: 'string' },
                subject: { type: 'string' },
                body: { type: 'string' },
              },
              required: ['recipientId', 'subject', 'body'],
            },
          },
        },
      },
      {
        toolSpec: {
          name: 'escalate_to_human',
          description:
            'Route to a human specialist. Use for opt-out/STOP requests, legal/bankruptcy mentions, hostility, complex disputes, or any situation needing human judgment. ALWAYS use for opt-out.',
          inputSchema: {
            json: {
              type: 'object',
              properties: {
                recipientId: { type: 'string' },
                reason: { type: 'string' },
                accountId: { type: 'string' },
              },
              required: ['recipientId', 'reason'],
            },
          },
        },
      },
    ] as Tool[],
  };
}
