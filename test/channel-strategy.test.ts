/**
 * Channel-strategy tests — the escalation-ladder decision logic.
 */
import { selectOutreachChannel, CHANNEL_LADDER } from '../lib/shared/channel-strategy';

const base = { pastDueCents: 8400, daysPastDue: 32, attemptsWithoutResponse: 0, localHour: 12 };

describe('escalation ladder', () => {
  test('first attempt uses the cheapest channel (email)', () => {
    const d = selectOutreachChannel({ ...base, attemptsWithoutResponse: 0 });
    expect(d.channel).toBe('email');
    expect(d.ladderStep).toBe(0);
  });
  test('escalates to SMS on the second attempt', () => {
    const d = selectOutreachChannel({ ...base, attemptsWithoutResponse: 1 });
    expect(d.channel).toBe('sms');
  });
  test('RCS attempt falls back to SMS when device not RCS-capable', () => {
    const d = selectOutreachChannel({ ...base, attemptsWithoutResponse: 2, rcsCapable: false, whatsappReachable: true });
    expect(d.channel).toBe('sms');
    expect(d.reason).toMatch(/falling back to SMS/i);
  });
  test('ladder order is email → sms → rcs → whatsapp', () => {
    expect(CHANNEL_LADDER).toEqual(['email', 'sms', 'rcs', 'whatsapp']);
  });
});

describe('engagement overrides the ladder', () => {
  test('replies on the channel the customer last engaged on', () => {
    const d = selectOutreachChannel({ ...base, attemptsWithoutResponse: 3, lastResponseChannel: 'whatsapp', whatsappReachable: true });
    expect(d.channel).toBe('whatsapp');
    expect(d.reason).toMatch(/last engaged/i);
  });
});

describe('value / risk gating', () => {
  test('low balance, not very overdue → WhatsApp is NOT selected early', () => {
    const d = selectOutreachChannel({ pastDueCents: 2000, daysPastDue: 10, attemptsWithoutResponse: 3, whatsappReachable: true, rcsCapable: true, localHour: 12 });
    expect(d.channel).not.toBe('whatsapp');
  });
  test('high balance → WhatsApp becomes eligible for escalation', () => {
    const d = selectOutreachChannel({ pastDueCents: 60000, daysPastDue: 20, attemptsWithoutResponse: 3, whatsappReachable: true, rcsCapable: true, localHour: 12 });
    expect(d.channel).toBe('whatsapp');
  });
});

describe('compliance & courtesy', () => {
  test('opted-out channel is never selected', () => {
    const d = selectOutreachChannel({ ...base, attemptsWithoutResponse: 1, optedOutChannels: ['sms'] });
    expect(d.channel).not.toBe('sms');
  });
  test('quiet hours hold non-email outreach', () => {
    const d = selectOutreachChannel({ ...base, attemptsWithoutResponse: 1, localHour: 23 });
    expect(d.channel).toBe('email');
    expect(d.hold).toBe(true);
  });
});

describe('cost ordering', () => {
  test('cheaper channels have a lower estCostUsd', () => {
    const email = selectOutreachChannel({ ...base, attemptsWithoutResponse: 0 });
    const sms = selectOutreachChannel({ ...base, attemptsWithoutResponse: 1 });
    expect(email.estCostUsd).toBeLessThan(sms.estCostUsd);
  });
});
