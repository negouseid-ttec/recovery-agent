/**
 * Identity Resolution — canonical cross-channel customer identity.
 *
 * Problem: conversation identity used to key off `message.from` (a phone number
 * or email), so the same person on SMS vs WhatsApp vs email looked like three
 * customers, and an unverified identifier could be trusted. This module maps a
 * verified channel identifier to ONE canonical `customerId`, backed by a
 * DynamoDB identity-link table, so history is continuous across channels and
 * unverified identifiers cannot reach another customer's account.
 *
 * The store is injected (IdentityStore) so the logic is unit-testable without
 * AWS and the Lambda wires in the DynamoDB-backed implementation.
 *
 * Safety rules:
 *  - Identities are merged ONLY by an explicit verified link, NEVER by matching
 *    name or any heuristic.
 *  - An unknown identifier resolves to a NEW customerId marked unverified; it is
 *    never silently attached to an existing customer.
 */

import { v4 as uuid } from 'uuid';
import type { Channel, IdentityLink, ResolvedIdentity } from './types';

/** Normalize a channel identifier so email case/whitespace doesn't fork identity. */
export function normalizeIdentifier(channel: Channel, raw: string): string {
  const v = raw.trim();
  return channel === 'email' ? v.toLowerCase() : v;
}

export interface IdentityStore {
  getLink(channelIdentifier: string): Promise<IdentityLink | undefined>;
  putLink(link: IdentityLink): Promise<void>;
}

/**
 * Resolve a raw channel identifier to a canonical identity.
 *
 * - Known identifier → returns its stored customerId + verification state.
 * - Unknown identifier → mints a NEW customerId, persists an UNVERIFIED link,
 *   and flags isNew. Unverified identifiers get a fresh customer; they are never
 *   attached to an existing one without explicit verified linking.
 */
export async function resolveIdentity(
  store: IdentityStore,
  channel: Channel,
  rawIdentifier: string,
  now: Date = new Date(),
): Promise<ResolvedIdentity> {
  const channelIdentifier = normalizeIdentifier(channel, rawIdentifier);
  const existing = await store.getLink(channelIdentifier);

  if (existing) {
    return {
      customerId: existing.customerId,
      channelIdentifier,
      channel: existing.channel,
      verification: existing.verification,
      isNew: false,
    };
  }

  // Unknown identifier → safe-handle as a new, unverified customer.
  const customerId = `CUST-${uuid()}`;
  const link: IdentityLink = {
    channelIdentifier,
    channel,
    customerId,
    verification: 'unverified',
    createdAt: now.toISOString(),
  };
  await store.putLink(link);
  return { customerId, channelIdentifier, channel, verification: 'unverified', isNew: true };
}

/**
 * Explicitly LINK a channel identifier to an existing customer as VERIFIED.
 * This is the ONLY path that attaches a new channel to an existing customer —
 * it must be driven by a real verification event (OTP, portal login, etc.),
 * never by a name match. Refuses to relink an identifier already owned by a
 * DIFFERENT verified customer (prevents account takeover).
 */
export async function linkVerifiedIdentity(
  store: IdentityStore,
  channel: Channel,
  rawIdentifier: string,
  customerId: string,
  now: Date = new Date(),
): Promise<{ linked: boolean; reason?: string; link?: IdentityLink }> {
  const channelIdentifier = normalizeIdentifier(channel, rawIdentifier);
  const existing = await store.getLink(channelIdentifier);

  if (existing && existing.verification === 'verified' && existing.customerId !== customerId) {
    return {
      linked: false,
      reason: `Identifier already verified-linked to a different customer (${existing.customerId}).`,
    };
  }

  const link: IdentityLink = {
    channelIdentifier,
    channel,
    customerId,
    verification: 'verified',
    verifiedAt: now.toISOString(),
    createdAt: existing?.createdAt ?? now.toISOString(),
  };
  await store.putLink(link);
  return { linked: true, link };
}

/** In-memory IdentityStore — for tests and the local demo. */
export class InMemoryIdentityStore implements IdentityStore {
  private readonly links = new Map<string, IdentityLink>();
  async getLink(channelIdentifier: string): Promise<IdentityLink | undefined> {
    return this.links.get(channelIdentifier);
  }
  async putLink(link: IdentityLink): Promise<void> {
    this.links.set(link.channelIdentifier, link);
  }
  /** Test/seed helper: pre-link a verified identifier. */
  seedVerified(channel: Channel, rawIdentifier: string, customerId: string, now = new Date()): void {
    const channelIdentifier = normalizeIdentifier(channel, rawIdentifier);
    this.links.set(channelIdentifier, {
      channelIdentifier,
      channel,
      customerId,
      verification: 'verified',
      verifiedAt: now.toISOString(),
      createdAt: now.toISOString(),
    });
  }
}
