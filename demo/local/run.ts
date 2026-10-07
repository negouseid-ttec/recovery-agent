/**
 * Local Recovery Agent demo — plays the full omnichannel past-due recovery
 * journey offline. Run: npm run demo:local
 */
import type { Channel } from '../../lib/shared/types';
import { seed, getConversation, accounts, DEMO_PHONE } from './store';
import { runAgent } from './agent';
import { record, transcript } from './tools';

const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', sms: '\x1b[33m', rcs: '\x1b[34m', whatsapp: '\x1b[32m', email: '\x1b[35m', agent: '\x1b[36m', gray: '\x1b[90m' };
const LABEL: Record<Channel, string> = { sms: '📱 SMS', rcs: '💬 RCS', whatsapp: '📲 WhatsApp', email: '📧 EMAIL' };
const COL: Record<Channel, string> = { sms: C.sms, rcs: C.rcs, whatsapp: C.whatsapp, email: C.email };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function banner(t: string) { console.log(`\n${C.bold}${'─'.repeat(72)}\n  ${t}\n${'─'.repeat(72)}${C.reset}`); }
function user(ch: Channel, text: string) { console.log(`\n${COL[ch]}${LABEL[ch]}${C.reset} ${C.dim}Dana →${C.reset} ${text}`); record({ direction: 'inbound', channel: ch, text }); }
function agentMsg(ch: Channel, text: string, calls: { tool: string }[]) {
  if (calls.length) console.log(`${C.gray}   ⚙ agent → ${calls.map((c) => c.tool).join(', ')}${C.reset}`);
  console.log(`${COL[ch]}${LABEL[ch]}${C.reset} ${C.agent}🤖 Recovery Agent →${C.reset} ${text}`);
  record({ direction: 'outbound', channel: ch, text });
}

async function turn(ch: Channel, text: string) {
  const conv = getConversation(DEMO_PHONE);
  user(ch, text); await sleep(400);
  const r = await runAgent(conv, text, ch);
  agentMsg(ch, r.responseText, r.toolCalls); await sleep(400);
}

async function main() {
  const live = process.env.DEMO_LIVE_BEDROCK === '1';
  console.log(`${C.bold}💸 RECOVERY AGENT — Local Omnichannel Demo${C.reset}`);
  console.log(`${C.dim}   Mode: ${live ? 'LIVE Bedrock (Nova 2 Lite)' : 'scripted (offline)'} · customer: Dana Whitfield (${DEMO_PHONE})${C.reset}`);
  seed();
  const a = accounts.get('ACCT-TEL-80231')!;
  banner('STARTING STATE');
  console.log(`${C.dim}  Account ${a.accountId}: ${a.status}, past due $${(a.pastDueCents/100).toFixed(2)}, ${a.daysPastDue} days, suspends ${a.suspensionDate}${C.reset}`);

  banner('ACT 1 — Proactive SMS nudge');
  agentMsg('sms', `Hi Dana, it's your telecom. Your account is past due $84.00 and service may pause Oct 16. Reply HELP and I'll make it easy to sort out.`, []);
  await sleep(400);
  await turn('sms', 'HELP');

  banner('ACT 2 — RCS: she asks to split it');
  await turn('rcs', "I can't pay all of it right now, can I split it?");

  banner('ACT 3 — WhatsApp: hardship disclosed (agent pivots to empathy + hold)');
  await turn('whatsapp', 'honestly I just lost my job, money is really tight');

  banner('ACT 4 — Days later, SMS: dispute a charge (any channel, one thread)');
  await turn('sms', "wait, there's a $20 charge on here I don't recognize, I'm disputing that");

  banner('ACT 5 — Compliance: opt-out is honored instantly');
  await turn('whatsapp', 'actually please STOP texting me');

  banner('RESULT');
  const fa = accounts.get('ACCT-TEL-80231')!;
  console.log(`  Final account status: ${C.whatsapp}${fa.status}${C.reset} (started past_due)`);
  console.log(`  Channels exercised: ${[...new Set(transcript.map((t) => t.channel))].map((c) => LABEL[c]).join('  ')}`);
  console.log(`  SES confirmations sent: ${transcript.filter((t) => t.channel === 'email' && t.direction === 'outbound').length}`);
  console.log(`  Messages in unified thread: ${transcript.length}`);
  console.log(`\n${C.bold}${C.whatsapp}✓ One conversation · four CDS channels · empathy, compliance, and recovery.${C.reset}\n`);
}

main().catch((e) => { console.error('demo failed:', e); process.exit(1); });
