/**
 * Cross-channel identity resolution tests.
 */
import {
  resolveIdentity,
  linkVerifiedIdentity,
  normalizeIdentifier,
  InMemoryIdentityStore,
} from '../lib/shared/identity';

describe('normalizeIdentifier', () => {
  test('lowercases + trims email, leaves phone as-is', () => {
    expect(normalizeIdentifier('email', '  Dana@Example.COM ')).toBe('dana@example.com');
    expect(normalizeIdentifier('sms', '+15551230001')).toBe('+15551230001');
  });
});

describe('resolveIdentity — unknown identifiers', () => {
  test('unknown identifier gets a NEW unverified customerId', async () => {
    const store = new InMemoryIdentityStore();
    const r = await resolveIdentity(store, 'sms', '+15550000001');
    expect(r.isNew).toBe(true);
    expect(r.verification).toBe('unverified');
    expect(r.customerId).toMatch(/^CUST-/);
  });

  test('two different unknown identifiers never share a customerId', async () => {
    const store = new InMemoryIdentityStore();
    const a = await resolveIdentity(store, 'sms', '+15550000001');
    const b = await resolveIdentity(store, 'email', 'someone@else.com');
    expect(a.customerId).not.toBe(b.customerId);
  });
});

describe('resolveIdentity — verified cross-channel continuity', () => {
  test('one verified customer resolves to the SAME customerId across channels', async () => {
    const store = new InMemoryIdentityStore();
    store.seedVerified('sms', '+15551230001', 'CUST-DANA');
    store.seedVerified('whatsapp', '+15551230001', 'CUST-DANA');
    store.seedVerified('email', 'dana@example.com', 'CUST-DANA');

    const viaSms = await resolveIdentity(store, 'sms', '+15551230001');
    const viaWa = await resolveIdentity(store, 'whatsapp', '+15551230001');
    const viaEmail = await resolveIdentity(store, 'email', 'DANA@example.com'); // case-insensitive

    expect(viaSms.customerId).toBe('CUST-DANA');
    expect(viaWa.customerId).toBe('CUST-DANA');
    expect(viaEmail.customerId).toBe('CUST-DANA');
    expect(viaSms.verification).toBe('verified');
  });

  test('a DIFFERENT customer never resolves to the first customer id', async () => {
    const store = new InMemoryIdentityStore();
    store.seedVerified('sms', '+15551230001', 'CUST-DANA');
    const intruder = await resolveIdentity(store, 'sms', '+15559999999');
    expect(intruder.customerId).not.toBe('CUST-DANA');
    expect(intruder.verification).toBe('unverified');
  });
});

describe('linkVerifiedIdentity — safe linking', () => {
  test('links a new channel to an existing customer when verified', async () => {
    const store = new InMemoryIdentityStore();
    store.seedVerified('sms', '+15551230001', 'CUST-DANA');
    const res = await linkVerifiedIdentity(store, 'whatsapp', '+15551230001', 'CUST-DANA');
    expect(res.linked).toBe(true);
    const resolved = await resolveIdentity(store, 'whatsapp', '+15551230001');
    expect(resolved.customerId).toBe('CUST-DANA');
    expect(resolved.verification).toBe('verified');
  });

  test('refuses to relink an identifier owned by a different verified customer', async () => {
    const store = new InMemoryIdentityStore();
    store.seedVerified('email', 'shared@example.com', 'CUST-A');
    const res = await linkVerifiedIdentity(store, 'email', 'shared@example.com', 'CUST-B');
    expect(res.linked).toBe(false);
    expect(res.reason).toMatch(/different customer/i);
    // Still resolves to the original owner — no takeover.
    const resolved = await resolveIdentity(store, 'email', 'shared@example.com');
    expect(resolved.customerId).toBe('CUST-A');
  });

  test('identities are never merged by matching name (only by explicit link)', async () => {
    const store = new InMemoryIdentityStore();
    // Two "Dana"s on different numbers — resolution must keep them separate.
    const dana1 = await resolveIdentity(store, 'sms', '+15551110001');
    const dana2 = await resolveIdentity(store, 'sms', '+15552220002');
    expect(dana1.customerId).not.toBe(dana2.customerId);
  });
});
