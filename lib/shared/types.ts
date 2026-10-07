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
  intent:
    | 'promise_to_pay'      // customer commits to pay by a date
    | 'payment_plan_request'// wants to split the balance
    | 'dispute'             // disputes the charge
    | 'hardship'            // job loss, illness, financial distress
    | 'already_paid'        // claims already paid
    | 'churn_threat'        // threatening to cancel
    | 'question'            // general question about the balance
    | 'opt_out'             // STOP / do not contact
    | 'other';
  urgency: 'low' | 'medium' | 'high' | 'critical';
  sentiment: 'cooperative' | 'neutral' | 'frustrated' | 'distressed' | 'hostile';
  needsHuman: boolean;
  language: string;
  summary: string;
  suggestedAction: string;
}

// ─── Outbound ───────────────────────────────────────────────────────────────

export type OutboundMessage = TextMessage | RichCardMessage | CarouselMessage | EmailMessage;

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
  cards: { title: string; description: string; imageUrl?: string; suggestions: Suggestion[] }[];
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
  sessionId: string;
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
