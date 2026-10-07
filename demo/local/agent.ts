/**
 * Local scripted agent for the Recovery Agent demo. Reuses the REAL
 * SYSTEM_PROMPT + buildToolConfig; deterministic offline, or real Bedrock
 * (Nova 2 Lite) via DEMO_LIVE_BEDROCK=1.
 */
import type { Conversation, Channel } from '../../lib/shared/types';
import { SYSTEM_PROMPT, buildToolConfig } from '../../lib/lambda/agent-orchestrator/prompt';
import { executeToolCall } from './tools';

const USE_LIVE = process.env.DEMO_LIVE_BEDROCK === '1';
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.amazon.nova-2-lite-v1:0';

export interface AgentResult { responseText: string; toolCalls: { tool: string; input: Record<string, unknown>; output: string }[]; }

export async function runAgent(conv: Conversation, userText: string, channel: Channel): Promise<AgentResult> {
  conv.history.push({ role: 'user', channel, content: userText, timestamp: new Date().toISOString() });
  const result = USE_LIVE ? await runLive(conv) : await runScripted(conv, userText);
  conv.history.push({ role: 'assistant', channel, content: result.responseText, timestamp: new Date().toISOString(), toolCalls: result.toolCalls });
  return result;
}

async function runLive(conv: Conversation): Promise<AgentResult> {
  const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
  const bedrock = new BedrockRuntimeClient({});
  const toolConfig = buildToolConfig();
  const calls: AgentResult['toolCalls'] = [];
  const messages: any[] = conv.history.map((t) => ({ role: t.role, content: [{ text: t.content }] }));
  for (let r = 0; r < 5; r++) {
    const resp = await bedrock.send(new ConverseCommand({ modelId: MODEL_ID, system: [{ text: SYSTEM_PROMPT }], messages, toolConfig, inferenceConfig: { maxTokens: 1024, temperature: 0.3 } }));
    const msg = (resp.output as any).message; messages.push(msg);
    const tus = (msg.content ?? []).filter((b: any) => 'toolUse' in b);
    if (!tus.length) { const tb = (msg.content ?? []).find((b: any) => 'text' in b); return { responseText: tb?.text ?? '(no response)', toolCalls: calls }; }
    const results: any[] = [];
    for (const b of tus) { const tu = b.toolUse; const out = await executeToolCall(tu.name, tu.input, conv); const s = typeof out === 'string' ? out : JSON.stringify(out); calls.push({ tool: tu.name, input: tu.input, output: s }); results.push({ toolResult: { toolUseId: tu.toolUseId, content: [{ text: s }] } }); }
    messages.push({ role: 'user', content: results });
  }
  return { responseText: 'Let me connect you with a specialist.', toolCalls: calls };
}

async function runScripted(conv: Conversation, userText: string): Promise<AgentResult> {
  const t = userText.toLowerCase();
  const calls: AgentResult['toolCalls'] = [];
  const rid = conv.recipientId;
  const call = async (tool: string, input: Record<string, unknown>) => { const out = await executeToolCall(tool, input, conv); calls.push({ tool, input, output: JSON.stringify(out) }); return out as any; };
  const ACCT = 'ACCT-TEL-80231';

  // Opt-out — compliance first
  if (/\bstop\b|opt.?out|don'?t contact|cease/.test(t)) {
    const r = await call('escalate_to_human', { recipientId: rid, reason: 'opt_out' });
    return { responseText: r.message, toolCalls: calls };
  }
  // Hardship
  if (/lost my job|laid off|can'?t afford|illness|sick|hospital|no money|hardship/.test(t)) {
    await call('apply_hardship', { accountId: ACCT, reason: 'customer reported financial hardship' });
    await call('send_receipt', { recipientId: rid, subject: 'Hardship Hold Applied — Account ACCT-TEL-80231', body: 'We\'ve paused collection activity and late fees on your account. No service interruption. A specialist will reach out to find a plan that works for you.' });
    return { responseText: "I'm really sorry to hear that — thank you for telling me. I've paused everything on your account: no late fees, no service interruption. A specialist will follow up to set up terms that work for you. You don't need to do anything right now.", toolCalls: calls };
  }
  // Dispute
  if (/disput|not mine|didn'?t|don'?t recognize|wrong|incorrect|already paid/.test(t)) {
    await call('log_dispute', { accountId: ACCT, reason: userText.slice(0, 120) });
    return { responseText: "Got it — I've logged your dispute and paused collection on that amount while our team reviews it. You'll get an email confirmation, and we'll follow up within 3 business days. Thanks for flagging it.", toolCalls: calls };
  }
  // Payment plan
  if (/plan|split|installment|can'?t pay all|part/.test(t)) {
    const r = await call('offer_payment_plan', { accountId: ACCT, installments: 3, frequency: 'biweekly' });
    await call('send_receipt', { recipientId: rid, subject: 'Payment Plan Confirmed — Account ACCT-TEL-80231', body: `Your plan: ${r.plan.installments} ${r.plan.frequency} payments of ${r.plan.installment}, starting ${r.plan.firstPaymentDate}. Total ${r.plan.total}. No service interruption while the plan is active.` });
    return { responseText: `No problem — I split your ${r.plan.total} into ${r.plan.installments} payments of ${r.plan.installment} every two weeks, starting ${r.plan.firstPaymentDate}. Your service stays on. I just emailed you the confirmation. Sound good?`, toolCalls: calls };
  }
  // Promise to pay
  if (/pay (it|now|friday|next|on|by)|i'?ll pay|payday/.test(t)) {
    const date = new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0];
    await call('record_promise_to_pay', { accountId: ACCT, promisedDate: date });
    await call('send_receipt', { recipientId: rid, subject: 'Payment Arrangement Confirmed', body: `Thanks! We've noted you'll pay your balance by ${date}. No action needed until then.` });
    return { responseText: `Perfect, thank you. I've noted you'll take care of it by ${date} — I'll hold everything until then and emailed you a confirmation. Appreciate you sorting this out.`, toolCalls: calls };
  }
  // Default: engage with the balance
  const r = await call('check_balance', { recipientId: rid });
  const a = (r.accounts ?? [])[0];
  if (a) return { responseText: `Hi ${a.customerName}, this is your telecom's Recovery Agent. Your account has a past-due balance of ${a.pastDue} (${a.daysPastDue} days). To avoid a service interruption on ${a.suspensionDate}, you can pay in full, or I can split it into a few smaller payments — which would be easier?`, toolCalls: calls };
  return { responseText: 'I can help you resolve your balance. Would you like to pay now or set up a payment plan?', toolCalls: calls };
}
