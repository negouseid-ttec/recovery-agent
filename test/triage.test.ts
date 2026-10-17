/**
 * Triage fallback classifier tests — the deterministic safety net used when
 * Bedrock is unavailable. Tests the production fallback() logic in
 * lib/lambda/message-triage/index.ts so the compliance-critical branches
 * (opt-out, hardship, legal) are regression-tested.
 */

type Intent =
  | 'promise_to_pay' | 'payment_plan_request' | 'dispute' | 'hardship'
  | 'already_paid' | 'churn_threat' | 'question' | 'opt_out' | 'other';

interface Cat { intent: Intent; urgency: string; needsHuman: boolean; sentiment: string; }

import {fallback} from '../lib/lambda/message-triage';


describe('triage fallback — compliance-critical branches', () => {
  test('STOP → opt_out, needsHuman, critical', () => {
    const c = fallback('please STOP texting me');
    expect(c.intent).toBe('opt_out');
    expect(c.needsHuman).toBe(true);
    expect(c.urgency).toBe('critical');
  });
  test('lawyer mention → needsHuman, critical', () => {
    const c = fallback("I'm getting my lawyer involved");
    expect(c.needsHuman).toBe(true);
    expect(c.urgency).toBe('critical');
  });
  test('job loss → hardship, distressed, high', () => {
    const c = fallback('I just lost my job and have no money');
    expect(c.intent).toBe('hardship');
    expect(c.sentiment).toBe('distressed');
    expect(c.urgency).toBe('high');
  });
  test('split request → payment_plan_request', () => {
    expect(fallback('can I split this into payments?').intent).toBe('payment_plan_request');
  });
  test('dispute language → dispute', () => {
    expect(fallback("that charge is wrong, I didn't order it").intent).toBe('dispute');
  });
  test('generic question → question, not needsHuman', () => {
    const c = fallback('what is my balance?');
    expect(c.intent).toBe('question');
    expect(c.needsHuman).toBe(false);
  });
});
