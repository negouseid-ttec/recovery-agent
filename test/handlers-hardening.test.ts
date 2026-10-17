import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { PinpointSMSVoiceV2Client } from '@aws-sdk/client-pinpoint-sms-voice-v2';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { SESv2Client } from '@aws-sdk/client-sesv2';
process.env.ACCOUNT_TABLE = 'accounts';
process.env.IDENTITY_TABLE = 'identities';
process.env.PLAN_TABLE = 'plans';
process.env.DECISION_TABLE = 'decisions';
process.env.CHALLENGE_TABLE = 'challenges';
process.env.SESSION_TABLE = 'sessions';
const sender = require('../lib/lambda/channel-sender').handler;
const tools = require('../lib/lambda/agent-orchestrator/tools').executeToolCall;
const otp = require('../lib/lambda/otp-sender').handler;
const identity = require('../lib/lambda/identity-verification').handler;
const delivery = require('../lib/lambda/delivery-status').handler;
const ddb = jest.spyOn(DynamoDBDocumentClient.prototype, 'send');
const provider = jest.spyOn(PinpointSMSVoiceV2Client.prototype, 'send');
const ses = jest.spyOn(SESv2Client.prototype, 'send');
const invoke = jest.spyOn(LambdaClient.prototype, 'send');
const conditional = () => Object.assign(new Error('condition'), { name: 'ConditionalCheckFailedException' });
let account: any;
const conv: any = { recipientId: '+15551230001', customerId: 'C1', identityVerification: 'verified', currentMessageId: 'm1', sessionId: 's1', channels: [], accountIds: [] };
function database(cmd: any): any {
    const p = cmd.input;
    if (cmd.constructor.name === 'GetCommand') {
        if (p.TableName === 'identities')
            return p.Key.channelIdentifier===conv.recipientId||p.Key.channelIdentifier==='alias@example.com'||p.Key.channelIdentifier==='dana@example.com'?{Item:{customerId:'C1',verification:'verified',channelIdentifier:p.Key.channelIdentifier}}:{};
        if (p.TableName === 'accounts')
            return { Item: account };
        if (p.TableName === 'plans')
            return { Item: { planId: 'P1', accountId: 'A1', recipientId: conv.recipientId, status: 'proposed', installments: 3 } };
    }
    if (cmd.constructor.name === 'QueryCommand')
        return { Items: p.TableName === 'identities' ? [{channel:'email',verification:'verified',channelIdentifier:'dana@example.com',customerId:'C1'},{channel:'sms',verification:'verified',channelIdentifier:conv.recipientId,customerId:'C1'}] : [account] };
    return {};
}
beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date('2026-10-12T16:00:00Z')); jest.clearAllMocks(); delete process.env.SUPPORT_INBOX; account = { accountId: 'A1', customerId: 'C1', recipientId: conv.recipientId, status: 'past_due', pastDueCents: 8400, totalBalanceCents: 8400, daysPastDue: 32, customerName: 'Example', monthlyChargeCents: 5000 }; ddb.mockImplementation((async (c: any) => database(c)) as any); provider.mockResolvedValue({ MessageId: 'PROVIDER1' } as never); ses.mockResolvedValue({ MessageId: 'EMAIL1' } as never); invoke.mockResolvedValue({ StatusCode: 202 } as never); });
afterEach(() => jest.useRealTimers());
const msg = (extra = {}) => ({ type: 'text', purpose: 'collection', recipientId: conv.recipientId, channel: 'sms', text: 'Account update', decisionId: 'D1', correlationId: 'COR1', ...extra });
test('actual sender records provider acceptance and correlation', async () => { expect(await sender(msg(), {}, () => { })).toMatchObject({ success: true, executionState: 'provider_accepted', providerMessageIds: ['PROVIDER1'] }); expect(provider).toHaveBeenCalledTimes(1); expect(ddb.mock.calls.some(([c]: any) => c.input.ExpressionAttributeValues?.[':s'] === 'provider_accepted')).toBe(true); });
test.each([{ optedOut: true }, { status: 'hardship_hold' }, { status: 'in_dispute' }, { restricted: true }, { outreachCountWindow: 3 }, { lastOutreachAt: '2026-10-12T15:59:00Z' }])('sender policy blocks %p', async (flags) => { Object.assign(account, flags); expect(await sender(msg({ bypassPolicy: true }), {}, () => { })).toMatchObject({ blocked: true }); expect(provider).not.toHaveBeenCalled(); });
test('quiet hours blocked', async () => { jest.setSystemTime(new Date('2026-10-12T23:00:00Z')); expect(await sender(msg(), {}, () => { })).toMatchObject({ blocked: true, reasonCode: 'QUIET_HOURS' }); expect(provider).not.toHaveBeenCalled(); });
test('missing account fails closed', async () => { account = undefined; expect(await sender(msg(), {}, () => { })).toMatchObject({ blocked: true }); expect(provider).not.toHaveBeenCalled(); });
test('lookup failure fails closed', async () => { ddb.mockImplementation((async (c: any) => { if (c.input.TableName === 'accounts')
    throw Error('outage'); return database(c); }) as any); expect(await sender(msg(), {}, () => { })).toMatchObject({ blocked: true, reasonCode: 'POLICY_LOOKUP_FAILED' }); expect(provider).not.toHaveBeenCalled(); });
test.each([{ purpose: 'identity_verification' }, { purpose: undefined }, { channel: 'fax' }, { recipientId: 'invalid' }])('invalid sender payload %p', async (e) => { expect(await sender(msg(e), {}, () => { })).toMatchObject({ statusCode: 400 }); expect(provider).not.toHaveBeenCalled(); });
test('provider failure accurately failed', async () => { provider.mockRejectedValue(Error('AWS refused') as never); expect(await sender(msg(), {}, () => { })).toMatchObject({ success: false, statusCode: 502 }); expect(ddb.mock.calls.some(([c]: any) => c.input.ExpressionAttributeValues?.[':s'] === 'failed')).toBe(true); });
test('missing provider ID not accepted or delivered', async () => { provider.mockResolvedValue({} as never); expect(await sender(msg(), {}, () => { })).toMatchObject({ success: false }); });
test('concurrent duplicate dispatch is claimed only once', async () => { let claimed = false; ddb.mockImplementation((async (c: any) => { if (c.constructor.name === 'PutCommand' && c.input.TableName === 'decisions') {
    if (claimed)
        throw conditional();
    claimed = true;
} return database(c); }) as any); const r = await Promise.all([sender(msg(), {}, () => { }), sender(msg(), {}, () => { })]); expect(provider).toHaveBeenCalledTimes(1); expect(r.some(x => x.duplicate)).toBe(true); });
test('failed provider call is not automatically replayed', async () => { let claimed = false; ddb.mockImplementation((async (c: any) => { if (c.constructor.name === 'PutCommand') {
    if (claimed)
        throw conditional();
    claimed = true;
} return database(c); }) as any); provider.mockRejectedValue(Error('uncertain') as never); await sender(msg(), {}, () => { }); expect(await sender(msg(), {}, () => { })).toMatchObject({ duplicate: true }); expect(provider).toHaveBeenCalledTimes(1); });
const names = ['check_balance', 'offer_payment_plan', 'accept_payment_plan', 'record_promise_to_pay', 'apply_hardship', 'log_dispute', 'send_receipt', 'escalate_to_human'];
const input = { accountId: 'A1', planId: 'P1', installments: 3, frequency: 'weekly', reason: 'review', promisedDate: '2026-10-20', subject: 'Confirmation', body: 'Arrangement recorded' };
test.each(names)('%s denies foreign canonical owner without mutation', async (name) => { account.customerId = 'FOREIGN'; const r = await tools(name, input, conv); expect(r.code).toBe('NOT_AUTHORIZED'); expect(ddb.mock.calls.every(([c]: any) => ['GetCommand', 'QueryCommand'].includes(c.constructor.name))).toBe(true); expect(invoke).not.toHaveBeenCalled(); });
test.each(names)('%s denies missing verified identity', async (name) => { expect(await tools(name, input, { ...conv, identityVerification: 'unverified' })).toMatchObject({ code: 'NOT_AUTHORIZED' }); expect(ddb).not.toHaveBeenCalled(); });
test.each(names)('%s safely denies missing account', async (name) => { account = undefined; expect(await tools(name, input, conv)).toMatchObject({ code: 'NOT_AUTHORIZED' }); expect(invoke).not.toHaveBeenCalled(); });
test.each(names)('%s rejects foreign recipient',async name=>{expect(await tools(name,{...input,recipientId:'other@example.com'},conv)).toMatchObject({code:'NOT_AUTHORIZED'});expect(ddb.mock.calls.every(([c]:any)=>c.constructor.name==='GetCommand')).toBe(true);expect(invoke).not.toHaveBeenCalled();});
test.each(names)('%s authorized customer succeeds', async (name) => { const r = await tools(name, input, conv); expect(r.success ?? r.found).toBe(true); });
test('plan ownership rejects a foreign plan', async () => { ddb.mockImplementation((async (c: any) => c.input.TableName === 'plans' ? { Item: { accountId: 'FOREIGN', recipientId: 'other' } } : database(c)) as any); expect(await tools('accept_payment_plan', input, conv)).toMatchObject({ success: false }); expect(ddb.mock.calls.every(([c]: any) => c.constructor.name === 'GetCommand')).toBe(true); });
test('escalation is persisted and truthful without inbox', async () => { expect(await tools('escalate_to_human', input, conv)).toMatchObject({ status: 'pending', notificationStatus: 'not_configured', message: 'Your request has been recorded for human review.' }); expect(ddb.mock.calls.some(([c]: any) => c.input.Item?.kind === 'escalation')).toBe(true); expect(ses).not.toHaveBeenCalled(); });
test.each([true, false])('notification reports provider outcome: %s', async (success) => { process.env.SUPPORT_INBOX = 'internal@example.com'; if (!success)
    ses.mockRejectedValue(Object.assign(Error('rejected'),{$metadata:{httpStatusCode:400}}) as never); expect(await tools('escalate_to_human', input, conv)).toMatchObject({ notificationStatus: success ? 'provider_accepted' : 'failed' }); const body: any = (ses.mock.calls[0][0] as any).input; expect(JSON.stringify(body)).not.toContain('C1'); expect(body.Destination.ToAddresses).toEqual(['internal@example.com']); });
test('opt-out persists explicit state before ticket confirmation', async () => { await tools('escalate_to_human', input, { ...conv, requestedOptOut: true }); const writes = ddb.mock.calls.map(([c]: any) => c.input).filter(c => c.UpdateExpression || c.Item); expect(writes[0].UpdateExpression).toContain('optedOut'); });
test('OTP sender refuses arbitrary exemption token', async () => { expect(await otp({ channelIdentifier: conv.recipientId, deliveryToken: 'fake' })).toMatchObject({ success: false, statusCode: 403 }); expect(provider).not.toHaveBeenCalled(); });
test('identity handler rejects fabricated session enrollment', async () => { ddb.mockImplementation((async () => ({})) as any); expect(await identity({ action: 'issue', channel: 'email', identifier: 'new@example.com', customerId: 'C1', verifiedSession: { customerId: 'C1', expiresAt: '2099' } }, {}, () => { })).toMatchObject({ statusCode: 403 }); expect(invoke).not.toHaveBeenCalled(); });
test('delivery callback uses conditional provider ID match', async () => { expect(await delivery({ decisionId: 'SEND-1', providerMessageId: 'PROVIDER1', status: 'delivered' })).toEqual({ updated: true }); const p: any = (ddb.mock.calls[0][0] as any).input; expect(p.ConditionExpression).toContain('contains(providerMessageIds'); expect(p.ExpressionAttributeValues[':a']).toBe('provider_accepted'); });
// Actual outreach + model response parser + final sender, mocking only AWS clients.
const outreach = require('../lib/lambda/proactive-outreach').handler;
const { BedrockRuntimeClient } = require('@aws-sdk/client-bedrock-runtime');
const model = jest.spyOn(BedrockRuntimeClient.prototype, 'send');
function modelResponse(text = JSON.stringify({ action: 'contact', channel: 'sms', reason: 'Eligible follow-up', confidence: .8, expectedCostUsd: .01 })) {
    return { output: { message: { role: 'assistant', content: [{ text }] } }, usage: { inputTokens: 10, outputTokens: 12 } };
}
test('mocked AWS end-to-end: Bedrock -> policy -> queued -> sender -> provider audit', async () => {
    model.mockResolvedValue(modelResponse());
    invoke.mockImplementation((async (c: any) => { const payload = JSON.parse(Buffer.from(c.input.Payload).toString()); expect(payload.purpose).toBe('collection'); await sender(payload, {}, () => { }); return { StatusCode: 202 }; }) as any);
    const result = await outreach({}, {}, () => { });
    expect(result.results[0].executionResult).toBe('queued');
    expect(provider).toHaveBeenCalledTimes(1);
    const writes = ddb.mock.calls.map(([c]: any) => c.input);
    const parent = writes.find(p => p.Item?.executionState === 'recommended').Item;
    const ledger = writes.find(p => p.Item?.executionState === 'sending').Item;
    expect(ledger.correlationId).toBe(parent.correlationId);
    expect(writes.some(p => p.ExpressionAttributeValues?.[':s'] === 'provider_accepted')).toBe(true);
    expect(writes.some(p => p.ExpressionAttributeValues?.[':q'] === 'queued')).toBe(true);
});
test('opted out end-to-end never invokes model or sender', async () => { model.mockClear(); account.optedOut = true; expect((await outreach({}, {}, () => { })).results[0].executionResult).toBe('blocked'); expect(model).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled(); expect(provider).not.toHaveBeenCalled(); });
test('invalid Bedrock output runs deterministic policy fallback', async () => { model.mockResolvedValue(modelResponse('malformed')); account.optedOut = true; const { recommendAndAuthorize } = require('../lib/lambda/next-best-action'); const result = await recommendAndAuthorize(account, { now: new Date() }); expect(result.source).toBe('heuristic-fallback'); expect(result.policyDecision.allowed).toBe(false); expect(provider).not.toHaveBeenCalled(); });
test('outreach slot replay suppresses asynchronous duplicate', async () => { model.mockResolvedValue(modelResponse()); let slot = false; ddb.mockImplementation((async (c: any) => { if (c.input.UpdateExpression === 'SET lastOutreachDayKey = :k') {
    if (slot)
        throw conditional();
    slot = true;
} return database(c); }) as any); await outreach({}, {}, () => { }); await outreach({}, {}, () => { }); expect(invoke).toHaveBeenCalledTimes(1); });
test('outreach rejected queue records failure without provider call', async () => { model.mockResolvedValue(modelResponse()); invoke.mockResolvedValue({ StatusCode: 500 } as never); expect((await outreach({}, {}, () => { })).results[0].executionResult).toBe('failed'); expect(provider).not.toHaveBeenCalled(); });
test('identity issue existing verified channel validates delivery result', async () => { invoke.mockResolvedValue({ Payload: Buffer.from(JSON.stringify({ success: true, providerMessageIds: ['OTP1'] })) } as never); expect(await identity({ action: 'issue', channel: 'sms', identifier: conv.recipientId, customerId: 'C1' }, {}, () => { })).toMatchObject({ issued: true, delivery: 'provider_accepted' }); expect((invoke.mock.calls[0][0] as any).input.InvocationType).toBe('RequestResponse'); });
test('identity OTP provider failure is not reported issued', async () => { invoke.mockResolvedValue({ Payload: Buffer.from(JSON.stringify({ success: false })) } as never); expect(await identity({ action: 'issue', channel: 'sms', identifier: conv.recipientId, customerId: 'C1' }, {}, () => { })).toMatchObject({ statusCode: 502, issued: false }); });
test('identity session consumes with customer and expiry atomically', async () => { const { hashToken } = require('../lib/shared/verified-session'); const token = 'x'.repeat(43); ddb.mockImplementation((async (c: any) => { if (c.input.TableName === 'identities')
    return {}; return database(c); }) as any); invoke.mockResolvedValue({ Payload: Buffer.from('{"success":true}') } as never); await identity({ action: 'issue', channel: 'email', identifier: 'new@example.com', customerId: 'C1', sessionToken: token }, {}, () => { }); const consume: any = ddb.mock.calls.map(([c]: any) => c).find(c => c.input.TableName === 'sessions'); expect(consume.input.Key.tokenHash).toBe(hashToken(token)); expect(consume.input.ConditionExpression).toContain('customerId = :c AND expiresAt > :n'); });
test('authorized OTP builds only fixed template from challenge record', async () => { const { hashToken } = require('../lib/shared/verified-session'); const token = 'x'.repeat(43); ddb.mockImplementation((async (c: any) => { if (c.input.TableName === 'challenges' && c.constructor.name === 'GetCommand')
    return { Item: { channel: 'sms', channelIdentifier: conv.recipientId, code: '123456', createdAt: '2026-10-12T16:00:00Z', expiresAt: '2026-10-12T16:10:00Z', deliveryHash: hashToken(token) } }; return {}; }) as any); expect(await otp({ channelIdentifier: conv.recipientId, deliveryToken: token, text: 'leak account' })).toMatchObject({ success: true }); expect((provider.mock.calls[0][0] as any).input.MessageBody).toMatch(/^Your verification code is 123456/); });
test('forged OTP capability conditional failure prevents provider', async () => { ddb.mockImplementation((async (c: any) => { if (c.constructor.name === 'GetCommand')
    return { Item: { channel: 'sms', channelIdentifier: conv.recipientId, code: '123456', expiresAt: '2026-10-12T16:10:00Z' } }; throw conditional(); }) as any); expect(await otp({ channelIdentifier: conv.recipientId, deliveryToken: 'x'.repeat(43) })).toMatchObject({ success: false }); expect(provider).not.toHaveBeenCalled(); });
test('duplicate escalation returns same ticket without notification', async () => { process.env.SUPPORT_INBOX = 'internal@example.com'; ddb.mockImplementation((async (c: any) => { if (c.constructor.name === 'PutCommand')
    throw conditional(); return database(c); }) as any); expect(await tools('escalate_to_human', input, conv)).toMatchObject({ status: 'pending' }); expect(ses).not.toHaveBeenCalled(); });
test('actual identity handler verifies OTP and mints server-backed session', async () => { ddb.mockImplementation((async (c: any) => { if (c.input.TableName === 'challenges' && c.constructor.name === 'GetCommand')
    return { Item: { channelIdentifier: 'dana@example.com', channel: 'email', customerId: 'C1', code: '123456', attempts: 0, createdAt: '2026-10-12T16:00:00Z', expiresAt: '2026-10-12T16:10:00Z' } }; return database(c); }) as any); expect(await identity({ action: 'verify', channel: 'email', identifier: 'dana@example.com', code: '123456' }, {}, () => { })).toMatchObject({ verified: true, session: expect.any(String) }); expect(ddb.mock.calls.some(([c]: any) => c.input.TableName === 'sessions' && c.input.Item?.tokenHash)).toBe(true); });
test('contact reservation race fails closed before provider',async()=>{ddb.mockImplementation((async(c:any)=>{if(c.input.UpdateExpression?.includes('outreachCountWindow = if_not_exists'))throw conditional();return database(c);}) as any);expect(await sender(msg(),{},()=>{})).toMatchObject({blocked:true,reasonCode:'CONCURRENT_POLICY_CHANGE'});expect(provider).not.toHaveBeenCalled();});
test('known rejected escalation notification can retry same persisted ticket',async()=>{process.env.SUPPORT_INBOX='internal@example.com';ddb.mockImplementation((async(c:any)=>{if(c.constructor.name==='PutCommand')throw conditional();if(c.input.TableName==='plans'&&c.constructor.name==='GetCommand')return {Item:{notificationStatus:'failed'}};return database(c);}) as any);expect(await tools('escalate_to_human',input,conv)).toMatchObject({notificationStatus:'provider_accepted'});expect(ses).toHaveBeenCalledTimes(1);expect(ddb.mock.calls.some(([c]:any)=>c.input.ConditionExpression==='notificationStatus = :old')).toBe(true);});
test('uncertain support notification is not blindly retried',async()=>{process.env.SUPPORT_INBOX='internal@example.com';ses.mockRejectedValue(Error('network timeout') as never);expect(await tools('escalate_to_human',input,conv)).toMatchObject({notificationStatus:'unknown'});});
test('verified alternate channel retains canonical account access',async()=>{expect(await tools('check_balance',{accountId:'A1',recipientId:'alias@example.com'},conv)).toMatchObject({found:true});});
test('conversation accountIds cannot authorize foreign canonical owner',async()=>{account.customerId='FOREIGN';expect(await tools('log_dispute',input,{...conv,accountIds:['A1']})).toMatchObject({code:'NOT_AUTHORIZED'});});
test('email channel opt-out is enforced for email payloads without channel field',async()=>{account.optedOutChannels=['email'];expect(await sender(msg({type:'email',channel:undefined,recipientId:'alias@example.com',subject:'Update',htmlBody:'<p>Update</p>',textBody:'Update',accountId:'A1'}),{},()=>{})).toMatchObject({blocked:true,reasonCode:'CHANNEL_OPT_OUT'});expect(ses).not.toHaveBeenCalled();});
test('RCS fallback cannot bypass SMS channel opt-out',async()=>{account.optedOutChannels=['sms'];expect(await sender(msg({channel:'rcs'}),{},()=>{})).toMatchObject({blocked:true,reasonCode:'CHANNEL_OPT_OUT'});expect(provider).not.toHaveBeenCalled();});
test('provider acceptance survives retry of a failed audit write without resending',async()=>{let failed=false;ddb.mockImplementation((async(c:any)=>{if(c.input.ExpressionAttributeValues?.[':s']==='provider_accepted'&&!failed){failed=true;throw Error('transient audit failure');}return database(c);}) as any);expect(await sender(msg(),{},()=>{})).toMatchObject({success:true,executionState:'provider_accepted'});expect(provider).toHaveBeenCalledTimes(1);});
test('actual triage accepts normalized webhook wrapper and preserves message ID',async()=>{model.mockResolvedValue(modelResponse(JSON.stringify({intent:'question',urgency:'medium',sentiment:'neutral',needsHuman:false,language:'en-US',summary:'Account question',suggestedAction:'review'})));const triage=require('../lib/lambda/message-triage').handler;const result=await triage({message:{messageId:'INBOUND1',channel:'sms',from:conv.recipientId,text:'Can I review my balance?'}},{},()=>{});expect(result.statusCode).toBe(200);const input:any=(invoke.mock.calls[0][0] as any).input;const forwarded=JSON.parse(Buffer.from(input.Payload).toString()).message;expect(forwarded).toMatchObject({messageId:'INBOUND1',from:conv.recipientId,channel:'sms'});});
test('triage AWS failure uses actual deterministic fallback',async()=>{model.mockRejectedValue(Error('model unavailable'));const triage=require('../lib/lambda/message-triage').handler;expect(await triage({messageId:'STOP1',channel:'sms',from:conv.recipientId,text:'STOP'},{},()=>{})).toMatchObject({statusCode:200,categorization:{intent:'opt_out'}});});
test('proactive email uses canonical verified email instead of phone destination',async()=>{model.mockResolvedValue(modelResponse(JSON.stringify({action:'contact',channel:'email',reason:'Email first',confidence:.8,expectedCostUsd:.0001})));await outreach({}, {},()=>{});const payload=JSON.parse(Buffer.from((invoke.mock.calls[0][0] as any).input.Payload).toString());expect(payload.recipientId).toBe('dana@example.com');expect(payload.accountId).toBe('A1');});
test('late audit retry cannot downgrade a delivered record',async()=>{const {executionState}=require('../lib/shared/outbound-execution');ddb.mockRejectedValue(conditional() as never);await expect(executionState('SEND-1','C1','provider_accepted',{providerMessageIds:['P1']})).resolves.toBeUndefined();const p:any=(ddb.mock.calls[0][0] as any).input;expect(p.ConditionExpression).toContain('executionState <> :delivered');});
test('receipt never reports queued when Lambda rejects event',async()=>{invoke.mockResolvedValue({StatusCode:500} as never);expect(await tools('send_receipt',input,conv)).toMatchObject({success:false,status:'failed',code:'QUEUE_REJECTED'});});
