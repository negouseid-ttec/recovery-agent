/**
 * Identity Verification — OTP / portal-link flow that turns an UNVERIFIED
 * channel identifier into a VERIFIED link to a canonical customer.
 *
 * This is the trigger that was missing in Phase 1: `linkVerifiedIdentity`
 * existed but nothing called it, so live identities stayed unverified. Here we
 * issue a one-time code (delivered out-of-band via the channel sender), then on
 * a correct, unexpired code we call linkVerifiedIdentity — the ONLY path that
 * attaches a channel to an existing customer.
 *
 * The challenge store is injected (ChallengeStore) so the logic is unit-testable
 * without AWS; the Lambda wires in a DynamoDB (TTL-expiring) implementation.
 *
 * Security properties (all tested):
 *  - Codes expire (TTL) and are single-use.
 *  - A capped number of attempts prevents brute force.
 *  - A wrong/expired code never verifies and never links.
 *  - Verifying channel B against customer C only links B→C if C already owns a
 *    verified identifier (you can't verify your way into someone else's account
 *    without proving control of an existing verified channel first).
 */

import { randomInt } from 'crypto';
import type { Channel, VerificationChallenge } from './types';
import { normalizeIdentifier, linkVerifiedIdentity, type IdentityStore } from './identity';

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

export interface ChallengeStore {
  get(channelIdentifier: string): Promise<VerificationChallenge | undefined>;
  put(challenge: VerificationChallenge): Promise<void>;
  delete(channelIdentifier: string): Promise<void>;
}

/** Generate a 6-digit numeric OTP using a CSPRNG. */
export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export type IssueOutcome =
  | { issued: true; channelIdentifier: string; code: string; expiresAt: string }
  | { issued: false; reason: 'not_authorized_for_customer' };

/**
 * Issue a verification challenge for a channel identifier the caller wants to
 * link to `customerId`.
 *
 * AUTHORIZATION (anti-account-takeover): a caller cannot bind an identifier to
 * an EXISTING customer that already owns verified identifiers unless they prove
 * control of that customer by supplying `provenChannelIdentifier` — an
 * identifier ALREADY verified-linked to the same customerId. Issuing for a
 * brand-new/unclaimed customerId (self-service first verification) is allowed.
 *
 * This prevents a request with an attacker-chosen customerId from starting a
 * challenge that would attach a channel to someone else's account.
 */
export async function issueChallenge(
  challengeStore: ChallengeStore,
  identityStore: IdentityStore,
  channel: Channel,
  rawIdentifier: string,
  customerId: string,
  provenChannelIdentifier?: string,
  now: Date = new Date(),
  codeOverride?: string, // tests inject a known code
): Promise<IssueOutcome> {
  const channelIdentifier = normalizeIdentifier(channel, rawIdentifier);

  // Does this customer already have ANY verified identifier?
  const customerClaimed = await identityStore.hasVerifiedForCustomer(customerId);
  if (customerClaimed) {
    // Must prove control of the existing customer.
    if (!provenChannelIdentifier) return { issued: false, reason: 'not_authorized_for_customer' };
    const proof = await identityStore.getLink(provenChannelIdentifier.trim().toLowerCase());
    const proofRaw = proof ?? (await identityStore.getLink(provenChannelIdentifier.trim()));
    if (!proofRaw || proofRaw.verification !== 'verified' || proofRaw.customerId !== customerId) {
      return { issued: false, reason: 'not_authorized_for_customer' };
    }
  }

  const code = codeOverride ?? generateCode();
  const challenge: VerificationChallenge = {
    channelIdentifier,
    channel,
    customerId,
    code,
    attempts: 0,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
    ttl: Math.floor((now.getTime() + CODE_TTL_MS) / 1000),
  };
  await challengeStore.put(challenge);
  return { issued: true, channelIdentifier, code, expiresAt: challenge.expiresAt };
}

export type VerifyOutcome =
  | { verified: true; customerId: string }
  | { verified: false; reason: 'no_challenge' | 'expired' | 'too_many_attempts' | 'wrong_code' };

/**
 * Verify a submitted code. On success, LINK the identifier to the customer as
 * verified (via linkVerifiedIdentity) and consume the challenge. The link only
 * succeeds if the customer owns an existing verified identifier OR the identifier
 * is unclaimed — linkVerifiedIdentity enforces the anti-takeover rule.
 */
export async function verifyCode(
  challengeStore: ChallengeStore,
  identityStore: IdentityStore,
  channel: Channel,
  rawIdentifier: string,
  submittedCode: string,
  now: Date = new Date(),
): Promise<VerifyOutcome> {
  const channelIdentifier = normalizeIdentifier(channel, rawIdentifier);
  const challenge = await challengeStore.get(channelIdentifier);

  if (!challenge) return { verified: false, reason: 'no_challenge' };

  if (now.getTime() > new Date(challenge.expiresAt).getTime()) {
    await challengeStore.delete(channelIdentifier);
    return { verified: false, reason: 'expired' };
  }

  if (challenge.attempts >= MAX_ATTEMPTS) {
    await challengeStore.delete(channelIdentifier);
    return { verified: false, reason: 'too_many_attempts' };
  }

  if (submittedCode !== challenge.code) {
    await challengeStore.put({ ...challenge, attempts: challenge.attempts + 1 });
    return { verified: false, reason: 'wrong_code' };
  }

  // Correct code → link as verified, then consume the challenge (single-use).
  const linked = await linkVerifiedIdentity(identityStore, channel, channelIdentifier, challenge.customerId, now);
  await challengeStore.delete(channelIdentifier);
  if (!linked.linked) {
    // Anti-takeover: identifier is owned by a different verified customer.
    return { verified: false, reason: 'wrong_code' };
  }
  return { verified: true, customerId: challenge.customerId };
}

/** In-memory ChallengeStore for tests / local demo. */
export class InMemoryChallengeStore implements ChallengeStore {
  private readonly m = new Map<string, VerificationChallenge>();
  async get(id: string): Promise<VerificationChallenge | undefined> {
    return this.m.get(id);
  }
  async put(c: VerificationChallenge): Promise<void> {
    this.m.set(c.channelIdentifier, c);
  }
  async delete(id: string): Promise<void> {
    this.m.delete(id);
  }
}
