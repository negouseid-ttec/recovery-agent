import { randomBytes, createHash } from 'crypto';
export interface SessionRecord {
    tokenHash: string;
    customerId: string;
    issuedAt: string;
    expiresAt: string;
    method: 'existing_channel_otp' | 'authenticated_enrollment';
    ttl: number;
}
export interface SessionStore {
    put(record: SessionRecord): Promise<void>;
    consume(tokenHash: string, customerId: string, now: string): Promise<boolean>;
}
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export async function mintSession(store: SessionStore, customerId: string, now = new Date(), method: SessionRecord['method'] = 'existing_channel_otp'): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const expires = new Date(now.getTime() + 15 * 60000);
    await store.put({ tokenHash: hashToken(token), customerId, issuedAt: now.toISOString(), expiresAt: expires.toISOString(), method, ttl: Math.floor(expires.getTime() / 1000) });
    return token;
}
export async function consumeSession(store: SessionStore, token: unknown, customerId: string, now: Date): Promise<boolean> {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token))
        return false;
    return store.consume(hashToken(token), customerId, now.toISOString());
}
export class InMemorySessionStore implements SessionStore {
    readonly records = new Map<string, SessionRecord>();
    async put(record: SessionRecord) { this.records.set(record.tokenHash, record); }
    async consume(hash: string, customerId: string, now: string) { const r = this.records.get(hash); if (!r || r.customerId !== customerId || r.expiresAt <= now || r.issuedAt > now)
        return false; this.records.delete(hash); return true; }
}
