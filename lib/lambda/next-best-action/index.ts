/**
 * Next-Best-Action Lambda — the AI recommender.
 *
 * Calls Amazon Bedrock (the repo's configured model) to recommend the next
 * action for an account, then delegates to the PURE core (lib/shared/
 * next-best-action.ts) for strict schema validation and — critically — policy
 * authorization. The model only ever RECOMMENDS; recovery-policy authorizes.
 *
 * On any model failure (timeout, malformed output, Bedrock error) it falls back
 * to the deterministic heuristic (the escalation ladder). It never throws to
 * the caller: a failed model call produces a safe, authorized fallback.
 */

import { BedrockRuntimeClient, ConverseCommand, type ContentBlock } from '@aws-sdk/client-bedrock-runtime';
import type { Handler } from 'aws-lambda';
import type { Account, AuthorizedAction, NextBestAction, PolicyContext } from '../../shared/types';
import { validateRecommendation, heuristicRecommendation, authorize } from '../../shared/next-best-action';

const bedrock = new BedrockRuntimeClient({});
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.amazon.nova-2-lite-v1:0';
const BEDROCK_TIMEOUT_MS = Number(process.env.NBA_TIMEOUT_MS ?? 8000);

const NBA_PROMPT = `You are the planning brain for an autonomous telecom collections agent. Given one past-due account's facts, recommend the single next-best action.

Return ONLY a JSON object with these fields:
- action: one of contact | wait | offer_plan | hold | escalate | close
- channel: one of email | sms | rcs | whatsapp | none  (use "none" for wait/hold/escalate/close)
- reason: one concise sentence grounded ONLY in the facts given
- confidence: a number 0..1
- expectedCostUsd: estimated channel cost (0 for none)
- nextReviewAt: optional ISO timestamp for the next check

Principles: cheapest effective channel first; escalate only on silence; reserve WhatsApp for high-value or severely overdue; recommend hold for hardship/dispute; escalate for legal/bankruptcy; close on opt-out. You recommend; a separate deterministic policy layer makes the final call.`;

/** Build the minimized, factual signal set the model reasons over. */
function accountSignals(a: Account): Record<string, unknown> {
  return {
    status: a.status,
    pastDueCents: a.pastDueCents,
    daysPastDue: a.daysPastDue,
    suspensionDate: a.suspensionDate,
    attemptsWithoutResponse: a.attemptsWithoutResponse ?? 0,
    lastResponseChannel: a.lastResponseChannel ?? null,
    rcsCapable: a.rcsCapable ?? null,
    whatsappReachable: a.whatsappReachable ?? null,
    optedOut: !!a.optedOut,
    optedOutChannels: a.optedOutChannels ?? [],
    restricted: !!a.restricted,
  };
}

async function callModel(account: Account): Promise<{ rec: NextBestAction | null; tokenUsage?: { input?: number; output?: number } }> {
  const facts = JSON.stringify(accountSignals(account));
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), BEDROCK_TIMEOUT_MS);
  try {
    const resp = await bedrock.send(
      new ConverseCommand({
        modelId: MODEL_ID,
        system: [{ text: NBA_PROMPT }],
        messages: [{ role: 'user', content: [{ text: `Account facts:\n${facts}\n\nReturn the JSON recommendation.` }] }],
        inferenceConfig: { maxTokens: 400, temperature: 0 },
      }),
      { abortSignal: ac.signal },
    );
    const content: ContentBlock[] = resp.output && 'message' in resp.output ? resp.output.message?.content ?? [] : [];
    const textBlock = content.find((b): b is ContentBlock.TextMember => b.text !== undefined);
    const tokenUsage = { input: resp.usage?.inputTokens, output: resp.usage?.outputTokens };
    if (!textBlock) return { rec: null, tokenUsage };
    const match = textBlock.text.match(/\{[\s\S]*\}/);
    if (!match) return { rec: null, tokenUsage };
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return { rec: null, tokenUsage };
    }
    return { rec: validateRecommendation(parsed), tokenUsage };
  } catch (err) {
    console.warn('[nba] model call failed; using heuristic fallback:', (err as Error).message);
    return { rec: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Recommend + authorize for one account. Exported for direct invocation and
 * reuse by proactive-outreach.
 */
export async function recommendAndAuthorize(
  account: Account,
  ctx: PolicyContext = {},
): Promise<AuthorizedAction & { modelId: string; tokenUsage?: { input?: number; output?: number } }> {
  const { rec, tokenUsage } = await callModel(account);
  const source: 'model' | 'heuristic-fallback' = rec ? 'model' : 'heuristic-fallback';
  const recommendation = rec ?? heuristicRecommendation(account, ctx.now);
  const authorized = authorize(account, recommendation, source, ctx);
  return { ...authorized, modelId: MODEL_ID, tokenUsage };
}

export const handler: Handler = async (event) => {
  const account: Account = event.account ?? event;
  const result = await recommendAndAuthorize(account);
  return { statusCode: 200, ...result };
};
