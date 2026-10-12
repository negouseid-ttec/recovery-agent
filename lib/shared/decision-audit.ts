/**
 * Decision Audit — an explainable, DynamoDB-backed record of each meaningful
 * action: what signals went in, what the model recommended, what policy ruled,
 * what actually executed, and the result.
 *
 * Privacy: we store a concise, generated SUMMARY and observable facts only —
 * NEVER raw model hidden reasoning / chain-of-thought, and sensitive fields are
 * minimized by `minimizeSignals()` before persistence.
 *
 * The sink is injected so the logic is unit-testable and the Lambda wires in a
 * DynamoDB implementation.
 */

import { v4 as uuid } from 'uuid';
import type { DecisionLogEntry } from './types';

export interface DecisionSink {
  put(entry: DecisionLogEntry): Promise<void>;
}

/** Drop/redact sensitive fields; keep only decision-relevant observable facts. */
export function minimizeSignals(signals: Record<string, unknown>): Record<string, unknown> {
  const DENY = new Set(['customerName', 'email', 'phone', 'address', 'pan', 'card', 'ssn', 'rawText', 'text']);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(signals)) {
    if (DENY.has(k)) continue;
    // Redact anything that looks like an email or long digit string.
    if (typeof v === 'string' && (/@/.test(v) || /\d{7,}/.test(v))) {
      out[k] = '[redacted]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Build + persist a decision log entry. Returns the entry (with its generated
 * decisionId) so the caller can echo the id into CloudWatch for correlation.
 * Never throws on sink failure — auditing must not break the action path; it
 * logs the failure and returns the entry.
 */
export async function recordDecision(
  sink: DecisionSink,
  partial: Omit<DecisionLogEntry, 'decisionId' | 'createdAt' | 'signals'> & { signals: Record<string, unknown> },
  now: Date = new Date(),
): Promise<DecisionLogEntry> {
  const entry: DecisionLogEntry = {
    decisionId: `DEC-${uuid()}`,
    createdAt: now.toISOString(),
    ...partial,
    signals: minimizeSignals(partial.signals),
    ttl: Math.floor(now.getTime() / 1000) + 180 * 24 * 3600, // 180-day retention
  };
  try {
    await sink.put(entry);
  } catch (err) {
    console.error('[audit] failed to persist decision', entry.decisionId, err);
  }
  // Structured CloudWatch line for queryability even if the table write failed.
  console.log(
    JSON.stringify({
      event: 'decision',
      decisionId: entry.decisionId,
      correlationId: entry.correlationId,
      accountId: entry.accountId,
      executedAction: entry.executedAction,
      executionResult: entry.executionResult,
      policy: entry.policyDecision.reasonCode,
      allowed: entry.policyDecision.allowed,
      estCostUsd: entry.estCostUsd,
      modelId: entry.modelId,
    }),
  );
  return entry;
}

/** In-memory sink for tests / local demo. */
export class InMemoryDecisionSink implements DecisionSink {
  readonly entries: DecisionLogEntry[] = [];
  async put(entry: DecisionLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}
