/**
 * Recovery Agent — unified messaging + collections domain types.
 *
 * The cross-channel messaging model (Channel, InboundMessage, OutboundMessage,
 * Conversation) is domain-agnostic and shared with any omnichannel agent.
 * The collections model (Account, PaymentPlan, Promise, Dispute) is specific
 * to autonomous past-due recovery.
 */
// ─── Channels ───────────────────────────────────────────────────────────────
export type Channel = 'sms' | 'rcs' | 'whatsapp' | 'email';
export interface ChannelAddress {
    channel: Channel;
    /** Phone (E.164) for sms/rcs/whatsapp, email address for email */
    address: string;
}
// ─── Inbound (normalized from any channel) ──────────────────────────────────
export interface InboundMessage {
    messageId: string;
    channel: Channel;
    from: string;
    to: string;
    timestamp: string;
    text: string;
    media?: MediaAttachment[];
    /** AI categorization set by the message-triage Lambda for inbound messages */
    categorization?: InboundCategorization;
    rawPayload?: unknown;
}
export interface MediaAttachment {
    url: string;
    mimeType: string;
    filename?: string;
    sizeBytes?: number;
}
/**
 * AI classification of an inbound customer message, produced by the
 * message-triage Lambda. Collections-specific intents.
 */
export interface InboundCategorization {
    intent: 'promise_to_pay' // customer commits to pay by a date
     | 'payment_plan_request' // wants to split the balance
     | 'dispute' // disputes the charge
     | 'hardship' // job loss, illness, financial distress
     | 'already_paid' // claims already paid
     | 'churn_threat' // threatening to cancel
     | 'question' // general question about the balance
     | 'opt_out' // STOP / do not contact
     | 'other';
    urgency: 'low' | 'medium' | 'high' | 'critical';
    sentiment: 'cooperative' | 'neutral' | 'frustrated' | 'distressed' | 'hostile';
    needsHuman: boolean;
    language: string;
    summary: string;
    suggestedAction: string;
}
// ─── Outbound ───────────────────────────────────────────────────────────────
export type OutboundMessage = (TextMessage | RichCardMessage | CarouselMessage | EmailMessage) & {
    purpose?: 'collection';
    accountId?: string;
    decisionId?: string;
    correlationId?: string;
};
export interface TextMessage {
    type: 'text';
    recipientId: string;
    text: string;
    channel?: Channel;
}
export interface RichCardMessage {
    type: 'rich_card';
    recipientId: string;
    title: string;
    description: string;
    imageUrl?: string;
    suggestions: Suggestion[];
    channel?: Channel;
}
export interface CarouselMessage {
    type: 'carousel';
    recipientId: string;
    cards: {
        title: string;
        description: string;
        imageUrl?: string;
        suggestions: Suggestion[];
    }[];
    channel?: Channel;
}
export interface EmailMessage {
    type: 'email';
    recipientId: string;
    subject: string;
    htmlBody: string;
    textBody: string;
}
export interface Suggestion {
    text: string;
    postbackData?: string;
    action?: 'reply' | 'url' | 'dial';
    actionData?: string;
}
// ─── Conversation State (DynamoDB) ──────────────────────────────────────────
export interface Conversation {
    recipientId: string;
    /** Canonical cross-channel customer identity (set by identity resolution). */
    customerId?: string;
    sessionId: string;
    identityVerification?: IdentityVerification;
    currentMessageId?: string;
    currentAddress?: string;
    requestedOptOut?: boolean;
    preferredChannel: Channel;
    channels: ChannelAddress[];
    language: string;
    history: ConversationTurn[];
    accountIds: string[];
    /** Compliance: once a customer opts out, no further outbound contact */
    optedOut?: boolean;
    createdAt: string;
    updatedAt: string;
    ttl: number;
}
export interface ConversationTurn {
    role: 'user' | 'assistant';
    channel: Channel;
    content: string;
    timestamp: string;
    toolCalls?: ToolCallRecord[];
}
export interface ToolCallRecord {
    tool: string;
    input: Record<string, unknown>;
    output: string;
}
// ─── Collections Domain ─────────────────────────────────────────────────────
export interface Account {
    accountId: string;
    recipientId: string;
    customerName: string;
    /** Canonical cross-channel customer identity (independent of phone/email). */
    customerId?: string;
    /** Telecom product the balance is for */
    productType: 'mobile' | 'internet' | 'tv' | 'bundle';
    /** Past-due balance in cents (avoid float money bugs) */
    pastDueCents: number;
    /** Current total balance in cents */
    totalBalanceCents: number;
    daysPastDue: number;
    /** When service gets suspended if unresolved (ISO date) */
    suspensionDate?: string;
    status: 'current' | 'past_due' | 'promise_active' | 'plan_active' | 'in_dispute' | 'hardship_hold' | 'suspended';
    lastContactDate?: string;
    /** Monthly recurring charge in cents (for plan sizing) */
    monthlyChargeCents: number;
    // ── Policy / outreach signals (optional; default-safe when absent) ──
    /** Global opt-out — once true, NO outbound on any channel. */
    optedOut?: boolean;
    /** Channels the customer has opted out of individually. */
    optedOutChannels?: Channel[];
    /** IANA timezone for customer-local quiet-hours checks (e.g. "America/New_York"). */
    timezone?: string;
    /** ISO timestamp of the last outreach attempt (for min-interval enforcement). */
    lastOutreachAt?: string;
    /** Count of outreach attempts in the current rolling window (frequency cap). */
    outreachCountWindow?: number;
    /** Channel the customer last responded on (strongest routing signal). */
    lastResponseChannel?: Channel;
    /** Device/channel capability + reachability. */
    rcsCapable?: boolean;
    whatsappReachable?: boolean;
    /** Consecutive outreach attempts with no response. */
    attemptsWithoutResponse?: number;
    /** Restricted flag — legal / bankruptcy / cease-and-desist: human-only. */
    restricted?: boolean;
}
export interface PaymentPlan {
    planId: string;
    accountId: string;
    recipientId: string;
    totalCents: number;
    installmentCents: number;
    installments: number;
    frequency: 'weekly' | 'biweekly' | 'monthly';
    firstPaymentDate: string;
    status: 'proposed' | 'accepted' | 'active' | 'completed' | 'defaulted';
    createdAt: string;
}
export interface Promise {
    promiseId: string;
    accountId: string;
    recipientId: string;
    amountCents: number;
    promisedDate: string;
    status: 'open' | 'kept' | 'broken';
    createdAt: string;
}
export interface Dispute {
    disputeId: string;
    accountId: string;
    recipientId: string;
    reason: string;
    amountDisputedCents: number;
    status: 'open' | 'under_review' | 'resolved_valid' | 'resolved_invalid';
    createdAt: string;
}
// ─── Policy Enforcement (deterministic, LLM-independent) ─────────────────────
/** Stable, auditable reason codes for a policy decision. */
export type PolicyReasonCode = 'ALLOWED' | 'GLOBAL_OPT_OUT' | 'CHANNEL_OPT_OUT' | 'QUIET_HOURS' | 'HARDSHIP_HOLD' | 'DISPUTE_HOLD' | 'RESTRICTED_HUMAN_ONLY' | 'FREQUENCY_CAP' | 'MIN_INTERVAL' | 'NOT_AUTHORIZED' | 'ACCOUNT_NOT_COLLECTIBLE' | 'PLAN_INELIGIBLE' | 'PLAN_INSTALLMENTS_OUT_OF_RANGE' | 'AMOUNT_OUT_OF_BOUNDS' | 'MISSING_ARGUMENT';
/** The kind of action being authorized. */
export type PolicyActionType = 'outbound_message' | 'payment_plan' | 'promise' | 'hardship' | 'dispute' | 'escalate';
export interface PolicyDecision {
    allowed: boolean;
    reasonCode: PolicyReasonCode;
    reason: string;
    evaluatedAt: string;
    /** Constraints that shaped the decision (e.g. quiet-hours window, caps). */
    constraints?: Record<string, unknown>;
}
export interface PolicyContext {
    /** Now, injectable for deterministic tests. */
    now?: Date;
    /** The channel an outbound action would use (for channel opt-out / quiet hours). */
    channel?: Channel;
    /** Max outreach attempts allowed per rolling window. */
    maxContactsPerWindow?: number;
    /** Minimum milliseconds between outreach attempts. */
    minIntervalMs?: number;
    /** Quiet-hours window in customer-local time (24h). */
    quietStartHour?: number;
    quietEndHour?: number;
    /** Payment-plan bounds. */
    minInstallments?: number;
    maxInstallments?: number;
}
// ─── Cross-channel Identity ──────────────────────────────────────────────────
export type IdentityVerification = 'verified' | 'unverified';
/** Maps one verified channel identifier to a canonical customer. */
export interface IdentityLink {
    /** PK: the raw channel identifier (E.164 phone or email), lowercased for email. */
    channelIdentifier: string;
    channel: Channel;
    /** The canonical customer this identifier resolves to. */
    customerId: string;
    verification: IdentityVerification;
    verifiedAt?: string;
    createdAt: string;
}
export interface ResolvedIdentity {
    customerId: string;
    channelIdentifier: string;
    channel: Channel;
    verification: IdentityVerification;
    /** True when this is a brand-new, unknown identifier (safe-handled). */
    isNew: boolean;
}
/** A pending OTP verification challenge (TTL-expiring, single-use). */
export interface VerificationChallenge {
    /** PK: the normalized channel identifier being verified. */
    channelIdentifier: string;
    channel: Channel;
    /** The customer this identifier will be linked to on success. */
    customerId: string;
    /** The one-time code (never logged). */
    code: string;
    attempts: number;
    createdAt: string;
    expiresAt: string;
    /** DynamoDB TTL (epoch seconds). */
    ttl: number;
}
// ─── AI Next-Best-Action ─────────────────────────────────────────────────────
export type NbaAction = 'contact' | 'wait' | 'offer_plan' | 'hold' | 'escalate' | 'close';
export interface NextBestAction {
    action: NbaAction;
    channel: Channel | 'none';
    reason: string;
    /** 0..1; flagged heuristic when not model-calibrated. */
    confidence: number;
    confidenceBasis: 'model' | 'heuristic';
    expectedCostUsd: number;
    nextReviewAt?: string;
}
/** NBA plus the deterministic policy ruling that authorizes (or vetoes) it. */
export interface AuthorizedAction {
    recommendation: NextBestAction;
    policyDecision: PolicyDecision;
    /** The action actually taken after policy — may differ from the recommendation. */
    executed: NbaAction;
    source: 'model' | 'heuristic-fallback';
}
// ─── Decision Audit Log ──────────────────────────────────────────────────────
export interface DecisionLogEntry {
    /** PK */
    decisionId: string;
    /** For tracing one logical flow across Lambdas. */
    correlationId: string;
    customerId?: string;
    accountId?: string;
    createdAt: string;
    /** Minimized, non-sensitive input signals that drove the decision. */
    signals: Record<string, unknown>;
    recommendation?: NextBestAction;
    policyDecision: PolicyDecision;
    executedAction: string;
    executionResult: 'dispatched' | 'blocked' | 'skipped' | 'error' | 'queued' | 'provider_accepted' | 'delivered' | 'failed' | 'suppressed';
    executionState?: 'recommended' | 'policy_blocked' | 'queued' | 'sending' | 'provider_accepted' | 'delivered' | 'failed' | 'suppressed';
    evidenceSource?: 'aws_observed' | 'illustrative';
    providerMessageIds?: string[];
    estCostUsd?: number;
    modelId?: string;
    tokenUsage?: {
        input?: number;
        output?: number;
    };
    /** A concise, generated summary — NEVER raw model chain-of-thought. */
    summary?: string;
    ttl?: number;
}
