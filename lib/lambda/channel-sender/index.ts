/**
 * Channel Sender — routes outbound messages to the optimal channel.
 *
 * Receives a typed OutboundMessage and dispatches it via the
 * appropriate AWS service: EUM (SMS/RCS), EUM Social (WhatsApp), or SES.
 */
import { PinpointSMSVoiceV2Client, SendTextMessageCommand, SendRcsMessageCommand, } from '@aws-sdk/client-pinpoint-sms-voice-v2';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Handler } from 'aws-lambda';
import type { OutboundMessage, Conversation, Channel, Account } from '../../shared/types';
import { claimExecution, executionState } from '../../shared/outbound-execution';
import { validAddress } from '../../shared/identity-verification';
import { evaluateOutbound } from '../../shared/recovery-policy';
const eum = new PinpointSMSVoiceV2Client({});
const ses = new SESv2Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const CONVERSATION_TABLE = process.env.CONVERSATION_TABLE!;
const ACCOUNT_TABLE = process.env.ACCOUNT_TABLE ?? '';
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'recovery@example.com';
const EUM_PHONE_POOL_ID = process.env.EUM_PHONE_POOL_ID ?? '';
const RCS_AGENT_ID = process.env.RCS_AGENT_ID ?? '';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? '';
/** Final policy gate. All collection sends fail closed; OTP transport is isolated in a different IAM entry point. */
async function policyGate(message: OutboundMessage & {
    channel?: Channel;
}): Promise<{
    ok: true;
    account:Account;
} | {
    ok: false;
    reasonCode: string;
}> {
    if (!ACCOUNT_TABLE) {
        // No account table wired at all → misconfiguration. Fail closed.
        console.error('[sender] ACCOUNT_TABLE not configured — suppressing collection message (fail-closed).');
        return { ok: false, reasonCode: 'POLICY_UNAVAILABLE' };
    }
    let account: Account | undefined;
    try {
        const link = await ddb.send(new GetCommand({ TableName: process.env.IDENTITY_TABLE!, Key: { channelIdentifier: message.recipientId }, ConsistentRead: true }));
        if (link.Item?.verification !== 'verified')
            return { ok: false, reasonCode: 'NOT_AUTHORIZED' };
        if (message.accountId) {
            const r = await ddb.send(new GetCommand({ TableName: ACCOUNT_TABLE, Key: { accountId: message.accountId }, ConsistentRead: true }));
            account = r.Item as Account | undefined;
        }
        else
            account = await lookupAccount(message.recipientId);
        if (account?.customerId !== link.Item.customerId)
            return { ok: false, reasonCode: 'NOT_AUTHORIZED' };
    }
    catch (err) {
        console.error(JSON.stringify({ event: 'sender_lookup_failed' }));
        return { ok: false, reasonCode: 'POLICY_LOOKUP_FAILED' };
    }
    if (!account) {
        // No account for this recipient. A collection message MUST have a clean,
        // policy-checkable account; suppress rather than send unverified.
        console.warn(JSON.stringify({ event: 'sender_blocked_no_account' }));
        return { ok: false, reasonCode: 'NO_ACCOUNT' };
    }
    const requested:Channel|undefined=message.type==='email'?'email':message.channel;
    const effective:Channel|undefined=requested==='rcs'&&!RCS_AGENT_ID?'sms':requested;
    const requestedDecision=evaluateOutbound(account,{channel:requested});
    const decision=requestedDecision.allowed?evaluateOutbound(account,{channel:effective}):requestedDecision;
    if (!decision.allowed) {
        console.log(JSON.stringify({ event: 'sender_blocked', reasonCode: decision.reasonCode }));
        return { ok: false, reasonCode: decision.reasonCode };
    }
    return { ok: true, account };
}
async function lookupAccount(recipientId: string): Promise<Account | undefined> {
    const res = await ddb.send(new QueryCommand({
        TableName: ACCOUNT_TABLE,
        IndexName: 'by-recipient',
        KeyConditionExpression: 'recipientId = :r',
        ExpressionAttributeValues: { ':r': recipientId },
        Limit: 1,
    }));
    return res.Items?.[0] as Account | undefined;
}
export function validateMessage(message: any): boolean {
    if (!message || message.purpose !== 'collection' || typeof message.decisionId !== 'string' || !message.decisionId || message.decisionId.length > 200 || typeof message.correlationId !== 'string' || !message.correlationId)
        return false;
    const channel = message.type === 'email' ? 'email' : message.channel;
    if (!validAddress(channel, message.recipientId))
        return false;
    const text = (v: any) => typeof v === 'string' && v.length > 0 && v.length <= 10000;
    if (message.type === 'text')
        return text(message.text);
    if (message.type === 'email')
        return text(message.subject) && text(message.textBody) && text(message.htmlBody);
    if (message.type === 'rich_card')
        return channel === 'rcs' && text(message.title) && text(message.description) && Array.isArray(message.suggestions) && message.suggestions.length <= 4 && message.suggestions.every((v: any) => text(v.text));
    if (message.type === 'carousel')
        return channel === 'rcs' && Array.isArray(message.cards) && message.cards.length >= 2 && message.cards.length <= 10 && message.cards.every((c: any) => text(c.title) && text(c.description) && Array.isArray(c.suggestions) && c.suggestions.every((v: any) => text(v.text)));
    return false;
}
export const handler: Handler = async (event) => {
    if (!validateMessage(event))
        return { statusCode: 400, success: false, reasonCode: 'INVALID_MESSAGE' };
    const id = await claimExecution(event);
    if (!id)
        return { statusCode: 200, success: false, duplicate: true, reasonCode: 'ALREADY_CLAIMED' };
    const gate = await policyGate(event);
    if (!gate.ok) {
        await executionState(id, event.correlationId, 'policy_blocked', { reasonCode: gate.reasonCode });
        console.log(JSON.stringify({ event: 'policy_blocked', correlationId: event.correlationId, reasonCode: gate.reasonCode }));
        return { statusCode: 200, success: false, blocked: true, reasonCode: gate.reasonCode };
    }
    let acceptedIds:string[]=[];
    try {
        try {
            await ddb.send(new UpdateCommand({TableName:ACCOUNT_TABLE,Key:{accountId:gate.account.accountId},UpdateExpression:'SET outreachCountWindow = if_not_exists(outreachCountWindow,:zero) + :one, lastOutreachAt = :now, attemptsWithoutResponse = if_not_exists(attemptsWithoutResponse,:zero) + :one',ConditionExpression:'customerId = :owner AND #s = :status AND (attribute_not_exists(optedOut) OR optedOut = :no) AND (attribute_not_exists(outreachCountWindow) OR outreachCountWindow = :expected) AND (attribute_not_exists(restricted) OR restricted = :no) AND (attribute_not_exists(optedOutChannels) OR NOT contains(optedOutChannels,:channel))',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':zero':0,':one':1,':now':new Date().toISOString(),':owner':gate.account.customerId,':status':gate.account.status,':no':false,':expected':gate.account.outreachCountWindow??0,':channel':event.type==='email'?'email':event.channel==='rcs'&&!RCS_AGENT_ID?'sms':event.channel}}));
        } catch(e) {
            if((e as Error).name!=='ConditionalCheckFailedException')throw e;
            await executionState(id,event.correlationId,'policy_blocked',{reasonCode:'CONCURRENT_POLICY_CHANGE'});
            return {statusCode:200,success:false,blocked:true,reasonCode:'CONCURRENT_POLICY_CHANGE'};
        }
        await executionState(id,event.correlationId,'sending',{policyDecision:{allowed:true,reasonCode:'ALLOWED',evaluatedAt:new Date().toISOString()},executedAction:event.type});
        const result = await dispatchMessage(event);
        if (!result.providerMessageIds?.length)
            throw new Error('MISSING_PROVIDER_ID');
        acceptedIds=result.providerMessageIds;
        console.log(JSON.stringify({event:'provider_accepted',correlationId:event.correlationId,providerMessageIds:acceptedIds}));
        await executionState(id, event.correlationId, 'provider_accepted', { providerMessageIds: result.providerMessageIds });
        return { ...result, executionState: 'provider_accepted', correlationId: event.correlationId };
    }
    catch (e) {
        if(acceptedIds.length){await executionState(id,event.correlationId,'provider_accepted',{providerMessageIds:acceptedIds,errorCode:'AUDIT_WRITE_RETRIED'});return {success:true,executionState:'provider_accepted',providerMessageIds:acceptedIds};}
        await executionState(id, event.correlationId, 'failed', { errorCode: 'PROVIDER_OR_AUDIT_FAILURE', retryDisposition: 'manual_reconciliation_required' });
        return { statusCode: 502, success: false, reasonCode: 'PROVIDER_OR_AUDIT_FAILURE' };
    }
};
/** Internal transport only: not a Lambda authorization entry point. OTP wrapper builds its own fixed template. */
export async function dispatchMessage(message: OutboundMessage): Promise<{
    success: boolean;
    channel: string;
    providerMessageIds: string[];
}> {
    switch (message.type) {
        case 'text': return sendText(message);
        case 'rich_card': return sendRichCard(message);
        case 'carousel': return sendCarousel(message);
        case 'email': return sendEmail(message);
    }
}
// ─── Text Message (SMS / RCS / WhatsApp) ────────────────────────────────────
async function sendText(message: {
    recipientId: string;
    text: string;
    channel?: Channel;
}) {
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
            throw new Error('INVALID_CHANNEL');
    }
}
// ─── SMS via EUM ────────────────────────────────────────────────────────────
async function sendSms(to: string, text: string) {
    const response = await eum.send(new SendTextMessageCommand({ DestinationPhoneNumber: to, MessageBody: text, ConfigurationSetName: 'ra-messaging', ...(EUM_PHONE_POOL_ID ? { OriginationIdentity: EUM_PHONE_POOL_ID } : {}) }));
    return { success: true, channel: 'sms', providerMessageIds: response.MessageId ? [response.MessageId] : [] };
}
// ─── RCS via EUM (real SendRcsMessage API) ──────────────────────────────────
// RCS_AGENT_ID selects RCS. Without an agent we explicitly use SMS; policy checks both channels.
async function sendRcs(to: string, text: string) {
    if (!RCS_AGENT_ID) {
        return sendSms(to, text);
    }
    const response = await eum.send(new SendRcsMessageCommand({
        OriginationIdentity: RCS_AGENT_ID,
        DestinationPhoneNumber: to,
        RcsMessageContent: {
            Content: { TextMessage: { Body: text } },
        },
    }));
    return { success: true, channel: 'rcs', providerMessageIds: response.MessageId ? [response.MessageId] : [] };
}
// ─── Rich Card (RCS) ───────────────────────────────────────────────────────
async function sendRichCard(message: {
    recipientId: string;
    title: string;
    description: string;
    imageUrl?: string;
    suggestions: {
        text: string;
        postbackData?: string;
    }[];
    channel?: Channel;
}) {
    if (!RCS_AGENT_ID) {
        const flat = `${message.title}\n${message.description}\n` +
            message.suggestions.map((s) => `• ${s.text}`).join('\n');
        return sendSms(message.recipientId, flat);
    }
    const response = await eum.send(new SendRcsMessageCommand({
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
    }));
    return { success: true, channel: 'rcs', providerMessageIds: response.MessageId ? [response.MessageId] : [] };
}
// ─── Carousel (RCS) ────────────────────────────────────────────────────────
async function sendCarousel(message: {
    recipientId: string;
    cards: {
        title: string;
        description: string;
        suggestions: {
            text: string;
        }[];
    }[];
    channel?: Channel;
}) {
    if (!RCS_AGENT_ID) {
        const flat = message.cards
            .map((c) => `${c.title}\n${c.description}\n` + c.suggestions.map((s) => `• ${s.text}`).join('\n'))
            .join('\n\n');
        return sendSms(message.recipientId, flat);
    }
    const response = await eum.send(new SendRcsMessageCommand({
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
    }));
    return { success: true, channel: 'rcs', providerMessageIds: response.MessageId ? [response.MessageId] : [] };
}
// ─── WhatsApp via EUM Social ────────────────────────────────────────────────
async function sendWhatsApp(to: string, text: string) {
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
    const { SocialMessagingClient, SendWhatsAppMessageCommand } = await import('@aws-sdk/client-socialmessaging');
    const socialClient = new SocialMessagingClient({});
    const response = await socialClient.send(new SendWhatsAppMessageCommand({
        originationPhoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
        message: Buffer.from(JSON.stringify(whatsappPayload)),
        metaApiVersion: 'v21.0',
    }));
    return { success: true, channel: 'whatsapp', providerMessageIds: response.messageId ? [response.messageId] : [] };
}
// ─── Email via SES ──────────────────────────────────────────────────────────
async function sendEmail(message: {
    recipientId: string;
    subject: string;
    htmlBody: string;
    textBody: string;
}) {
    // Look up the recipient's email address from conversation
    const emailAddress = await resolveEmailAddress(message.recipientId);
    const response = await ses.send(new SendEmailCommand({
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
    }));
    return { success: true, channel: 'email', providerMessageIds: response.MessageId ? [response.MessageId] : [] };
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
        const result = await ddb.send(new GetCommand({
            TableName: CONVERSATION_TABLE,
            Key: { recipientId },
            ProjectionExpression: 'preferredChannel',
        }));
        return (result.Item?.preferredChannel as Channel) ?? 'sms';
    }
    catch {
        return 'sms'; // Default fallback
    }
}
async function resolveEmailAddress(recipientId: string): Promise<string> {
    // If it's already an email address, return it
    if (recipientId.includes('@'))
        return recipientId;
    throw new Error('VERIFIED_EMAIL_REQUIRED');
}
