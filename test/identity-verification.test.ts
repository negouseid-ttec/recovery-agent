/**
 * OTP identity-verification tests — issue, verify, expiry, brute-force cap,
 * single-use, and anti-takeover.
 */
import {
  issueChallenge,
  verifyCode,
  generateCode,
  InMemoryChallengeStore,
} from '../lib/shared/identity-verification';
import { InMemoryIdentityStore, resolveIdentity } from '../lib/shared/identity';

const now = new Date('2026-10-12T16:00:00Z');

function stores() {
  return { cs: new InMemoryChallengeStore(), is: new InMemoryIdentityStore() };
}

describe('generateCode', () => {
  test('is a 6-digit numeric string', () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });
});

describe('issue + verify happy path', () => {
  test('a correct code verifies and links the identity', async () => {
    const { cs, is } = stores();
    await issueChallenge(cs, 'whatsapp', '+15551230001', 'CUST-DANA', now, '123456');
    const out = await verifyCode(cs, is, 'whatsapp', '+15551230001', '123456', now);
    expect(out.verified).toBe(true);
    // Now resolution returns the verified customer.
    const resolved = await resolveIdentity(is, 'whatsapp', '+15551230001');
    expect(resolved.verification).toBe('verified');
    expect(resolved.customerId).toBe('CUST-DANA');
  });

  test('cross-channel: verifying a 2nd channel links it to the same customer', async () => {
    const { cs, is } = stores();
    is.seedVerified('sms', '+15551230001', 'CUST-DANA');
    await issueChallenge(cs, 'email', 'dana@example.com', 'CUST-DANA', now, '222222');
    const out = await verifyCode(cs, is, 'email', 'dana@example.com', '222222', now);
    expect(out.verified).toBe(true);
    const viaEmail = await resolveIdentity(is, 'email', 'dana@example.com');
    const viaSms = await resolveIdentity(is, 'sms', '+15551230001');
    expect(viaEmail.customerId).toBe(viaSms.customerId);
  });
});

describe('failure modes', () => {
  test('wrong code does not verify or link', async () => {
    const { cs, is } = stores();
    await issueChallenge(cs, 'sms', '+15551230001', 'CUST-DANA', now, '123456');
    const out = await verifyCode(cs, is, 'sms', '+15551230001', '000000', now);
    expect(out).toEqual({ verified: false, reason: 'wrong_code' });
    const resolved = await resolveIdentity(is, 'sms', '+15551230001');
    expect(resolved.verification).toBe('unverified');
  });

  test('expired code does not verify', async () => {
    const { cs, is } = stores();
    await issueChallenge(cs, 'sms', '+15551230001', 'CUST-DANA', now, '123456');
    const later = new Date(now.getTime() + 11 * 60 * 1000); // 11 min > 10 min TTL
    const out = await verifyCode(cs, is, 'sms', '+15551230001', '123456', later);
    expect(out).toEqual({ verified: false, reason: 'expired' });
  });

  test('no challenge issued → no_challenge', async () => {
    const { cs, is } = stores();
    const out = await verifyCode(cs, is, 'sms', '+15559999999', '123456', now);
    expect(out).toEqual({ verified: false, reason: 'no_challenge' });
  });

  test('brute force is capped after 5 wrong attempts', async () => {
    const { cs, is } = stores();
    await issueChallenge(cs, 'sms', '+15551230001', 'CUST-DANA', now, '123456');
    for (let i = 0; i < 5; i++) {
      await verifyCode(cs, is, 'sms', '+15551230001', '000000', now);
    }
    // 6th attempt (even with the RIGHT code) is locked out.
    const out = await verifyCode(cs, is, 'sms', '+15551230001', '123456', now);
    expect(out).toEqual({ verified: false, reason: 'too_many_attempts' });
  });

  test('single-use: a verified code cannot be replayed', async () => {
    const { cs, is } = stores();
    await issueChallenge(cs, 'sms', '+15551230001', 'CUST-DANA', now, '123456');
    expect((await verifyCode(cs, is, 'sms', '+15551230001', '123456', now)).verified).toBe(true);
    const replay = await verifyCode(cs, is, 'sms', '+15551230001', '123456', now);
    expect(replay).toEqual({ verified: false, reason: 'no_challenge' });
  });

  test('anti-takeover: cannot verify an identifier already owned by another verified customer', async () => {
    const { cs, is } = stores();
    is.seedVerified('email', 'shared@example.com', 'CUST-A');
    // Attacker tries to verify the same identifier against their own customer id.
    await issueChallenge(cs, 'email', 'shared@example.com', 'CUST-ATTACKER', now, '123456');
    const out = await verifyCode(cs, is, 'email', 'shared@example.com', '123456', now);
    expect(out.verified).toBe(false);
    // Ownership unchanged.
    const resolved = await resolveIdentity(is, 'email', 'shared@example.com');
    expect(resolved.customerId).toBe('CUST-A');
  });
});
