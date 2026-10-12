/**
 * OTP identity-verification tests — issue, verify, expiry, brute-force cap,
 * single-use, anti-takeover, and ISSUE authorization.
 */
import {
  issueChallenge,
  verifyCode,
  generateCode,
  InMemoryChallengeStore,
} from '../lib/shared/identity-verification';
import { InMemoryIdentityStore, resolveIdentity } from '../lib/shared/identity';

const now = new Date('2026-10-12T16:00:00Z');
function stores() { return { cs: new InMemoryChallengeStore(), is: new InMemoryIdentityStore() }; }

/** New-customer (unclaimed) issue — no proof needed. */
async function issue(cs: InMemoryChallengeStore, is: InMemoryIdentityStore, channel: any, id: string, cust: string, code: string, proven?: string) {
  return issueChallenge(cs, is, channel, id, cust, proven, now, code);
}

describe('generateCode', () => {
  test('is a 6-digit numeric string', () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });
});

describe('issue + verify happy path', () => {
  test('a correct code verifies and links the identity (new customer)', async () => {
    const { cs, is } = stores();
    const iss = await issue(cs, is, 'whatsapp', '+15551230001', 'CUST-DANA', '123456');
    expect(iss.issued).toBe(true);
    const out = await verifyCode(cs, is, 'whatsapp', '+15551230001', '123456', now);
    expect(out.verified).toBe(true);
    const resolved = await resolveIdentity(is, 'whatsapp', '+15551230001');
    expect(resolved.verification).toBe('verified');
    expect(resolved.customerId).toBe('CUST-DANA');
  });

  test('cross-channel link with PROOF of control of the existing customer', async () => {
    const { cs, is } = stores();
    is.seedVerified('sms', '+15551230001', 'CUST-DANA'); // existing verified channel
    const iss = await issue(cs, is, 'email', 'dana@example.com', 'CUST-DANA', '222222', '+15551230001');
    expect(iss.issued).toBe(true);
    const out = await verifyCode(cs, is, 'email', 'dana@example.com', '222222', now);
    expect(out.verified).toBe(true);
    const viaEmail = await resolveIdentity(is, 'email', 'dana@example.com');
    const viaSms = await resolveIdentity(is, 'sms', '+15551230001');
    expect(viaEmail.customerId).toBe(viaSms.customerId);
  });
});

describe('ISSUE authorization (anti-takeover at issuance)', () => {
  test('cannot issue for an EXISTING customer without proof of control', async () => {
    const { cs, is } = stores();
    is.seedVerified('sms', '+15551230001', 'CUST-DANA');
    const iss = await issue(cs, is, 'email', 'attacker@evil.com', 'CUST-DANA', '123456'); // no proof
    expect(iss.issued).toBe(false);
    if (!iss.issued) expect(iss.reason).toBe('not_authorized_for_customer');
  });

  test('cannot issue with proof that belongs to a DIFFERENT customer', async () => {
    const { cs, is } = stores();
    is.seedVerified('sms', '+15551230001', 'CUST-DANA');
    is.seedVerified('sms', '+15552220002', 'CUST-BOB'); // attacker proves Bob, targets Dana
    const iss = await issue(cs, is, 'email', 'attacker@evil.com', 'CUST-DANA', '123456', '+15552220002');
    expect(iss.issued).toBe(false);
  });

  test('new/unclaimed customer can self-issue (first verification)', async () => {
    const { cs, is } = stores();
    const iss = await issue(cs, is, 'sms', '+15559990000', 'CUST-NEW', '123456');
    expect(iss.issued).toBe(true);
  });
});

describe('failure modes', () => {
  test('wrong code does not verify or link', async () => {
    const { cs, is } = stores();
    await issue(cs, is, 'sms', '+15551230001', 'CUST-DANA', '123456');
    const out = await verifyCode(cs, is, 'sms', '+15551230001', '000000', now);
    expect(out).toEqual({ verified: false, reason: 'wrong_code' });
  });

  test('expired code does not verify', async () => {
    const { cs, is } = stores();
    await issue(cs, is, 'sms', '+15551230001', 'CUST-DANA', '123456');
    const later = new Date(now.getTime() + 11 * 60 * 1000);
    expect(await verifyCode(cs, is, 'sms', '+15551230001', '123456', later)).toEqual({ verified: false, reason: 'expired' });
  });

  test('no challenge issued → no_challenge', async () => {
    const { cs, is } = stores();
    expect(await verifyCode(cs, is, 'sms', '+15559999999', '123456', now)).toEqual({ verified: false, reason: 'no_challenge' });
  });

  test('brute force is capped after 5 wrong attempts', async () => {
    const { cs, is } = stores();
    await issue(cs, is, 'sms', '+15551230001', 'CUST-DANA', '123456');
    for (let i = 0; i < 5; i++) await verifyCode(cs, is, 'sms', '+15551230001', '000000', now);
    expect(await verifyCode(cs, is, 'sms', '+15551230001', '123456', now)).toEqual({ verified: false, reason: 'too_many_attempts' });
  });

  test('single-use: a verified code cannot be replayed', async () => {
    const { cs, is } = stores();
    await issue(cs, is, 'sms', '+15551230001', 'CUST-DANA', '123456');
    expect((await verifyCode(cs, is, 'sms', '+15551230001', '123456', now)).verified).toBe(true);
    expect(await verifyCode(cs, is, 'sms', '+15551230001', '123456', now)).toEqual({ verified: false, reason: 'no_challenge' });
  });
});
