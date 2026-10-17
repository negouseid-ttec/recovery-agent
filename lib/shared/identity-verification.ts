import { randomInt, timingSafeEqual } from 'crypto';
import type { Channel, VerificationChallenge } from './types';
import { normalizeIdentifier, linkVerifiedIdentity, type IdentityStore } from './identity';
import { mintSession, consumeSession, type SessionStore } from './verified-session';
export { mintSession } from './verified-session';
export const validAddress = (channel: unknown, id: unknown): boolean => typeof id === 'string' && id.length <= 254 && (['email'].includes(String(channel)) ? /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(id) : ['sms', 'rcs', 'whatsapp'].includes(String(channel)) && /^\+[1-9]\d{7,14}$/.test(id));
export interface ChallengeStore {
    get(id: string): Promise<VerificationChallenge | undefined>;
    put(c: VerificationChallenge): Promise<void>;
    delete(id: string): Promise<void>;
    /** Atomic compare-and-delete/update; production must not use a read/write pair. */
    advance(challenge: VerificationChallenge, consume: boolean): Promise<boolean>;
}
export const generateCode = () => randomInt(0, 1000000).toString().padStart(6, '0');
export async function issueChallenge(cs: ChallengeStore, ids: IdentityStore, sessions: SessionStore, channel: Channel, raw: string, customerId: string, token?: unknown, now = new Date(), codeOverride?: string) {
    if (!customerId || !validAddress(channel, raw))
        return { issued: false as const, reason: 'not_authorized_for_customer' as const };
    const id = normalizeIdentifier(channel, raw);
    const link = await ids.getLink(id);
    // Existing channel re-verification is safe: the code goes only to that channel.
    const existing = link?.verification === 'verified' && link.customerId === customerId;
    if (link?.verification === 'verified' && link.customerId !== customerId)
        return { issued: false as const, reason: 'not_authorized_for_customer' as const };
    // Enrollment also requires an out-of-band, IAM-provisioned session; no arbitrary customer IDs.
    if (!existing && !await consumeSession(sessions, token, customerId, now))
        return { issued: false as const, reason: 'not_authorized_for_customer' as const };
    const code = codeOverride ?? generateCode();
    const expiresAt = new Date(now.getTime() + 600000).toISOString();
    await cs.put({ channelIdentifier: id, channel, customerId, code, attempts: 0, createdAt: now.toISOString(), expiresAt, ttl: Math.floor((now.getTime() + 600000) / 1000) });
    return { issued: true as const, channelIdentifier: id, code, expiresAt };
}
export async function verifyCode(cs: ChallengeStore, ids: IdentityStore, sessions: SessionStore, channel: Channel, raw: string, code: string, now = new Date()) {
    const fail = (reason: 'no_challenge' | 'expired' | 'too_many_attempts' | 'wrong_code') => ({ verified: false as const, reason });
    if (!validAddress(channel, raw) || !/^\d{6}$/.test(code))
        return fail('wrong_code');
    const c = await cs.get(normalizeIdentifier(channel, raw));
    if (!c || c.channel !== channel)
        return fail('no_challenge');
    if (c.expiresAt <= now.toISOString())
        return fail('expired');
    if (c.attempts >= 5)
        return fail('too_many_attempts');
    const correct = timingSafeEqual(Buffer.from(code), Buffer.from(c.code));
    if (!await cs.advance(c, correct))
        return fail('no_challenge');
    if (!correct)
        return fail('wrong_code');
    const linked = await linkVerifiedIdentity(ids, channel, c.channelIdentifier, c.customerId, now);
    if (!linked.linked)
        return fail('wrong_code');
    return { verified: true as const, customerId: c.customerId, session: await mintSession(sessions, c.customerId, now) };
}
export class InMemoryChallengeStore implements ChallengeStore {
    readonly records = new Map<string, VerificationChallenge>();
    async get(id: string) { return this.records.get(id); }
    async put(c: VerificationChallenge) { this.records.set(c.channelIdentifier, c); }
    async delete(id: string) { this.records.delete(id); }
    async advance(c: VerificationChallenge, consume: boolean) { const current = this.records.get(c.channelIdentifier); if (!current || current.code !== c.code || current.createdAt !== c.createdAt || current.attempts !== c.attempts)
        return false; if (consume)
        this.records.delete(c.channelIdentifier);
    else
        this.records.set(c.channelIdentifier, { ...c, attempts: c.attempts + 1 }); return true; }
}
