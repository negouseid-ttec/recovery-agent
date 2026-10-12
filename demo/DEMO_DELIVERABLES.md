# Demo Redesign — Deliverables

Judge-facing redesign of `demo/web/index.html` for the AWS CDS Agentic AI Partner Hackathon.
Positioning: **"Your channels deliver messages. Recovery Agent decides what happens next."**
Recovery Agent is the autonomous decision layer over existing telecom comms — not a messaging platform.

## Changed files
- `demo/web/index.html` — rebuilt from a 14-frame linear story into a 3-view interactive app (single file, no external deps). Preserves the Dana scenario, phone UI components, responsive behavior, autoplay, `?frame=`, and `?nofx=`.
- `demo/DEMO_DELIVERABLES.md` — this document.

## The three views
1. **Guided Demo** — the Dana story with a customer phone beside an **agent-intelligence panel**. Each step shows Context → Observation → Recommendation (tagged **AI**) → Policy check (tagged **deterministic**) → Action → Outcome.
2. **Decision Lab** — interactive controls (status, global opt-out, restricted, days overdue, balance, prior attempts, RCS/WhatsApp availability, customer-local hour). Runs the ported **deterministic** policy + ladder in-browser; shows the verdict, reason code, and when the AI is overruled by policy. Clearly labeled **Simulated — no Bedrock call**.
3. **Execution Evidence** — AWS / tool-call / policy timeline, each item tagged **LIVE-VERIFIED** or **EXAMPLE**.

## Local preview
```bash
cd ~/recovery-agent
python3 -m http.server 8899 --bind 127.0.0.1 --directory demo/web
# open http://127.0.0.1:8899/
```
URL params: `?view=guided|lab|evidence` · `?frame=N` · `?autoplay=1` · `?nofx=1` (clean capture).
Keyboard: → / Space = next, ← = back, `p` = play/pause. `⛶` button = fullscreen. Honors `prefers-reduced-motion`.

## Misleading-claim fixes (vs. the old demo)
| Old (inaccurate) | New (accurate) |
|---|---|
| "$84.00 recovered" | **"$28 paid, $56 scheduled"** on an active plan |
| `record_payment` tool call | `accept_payment_plan` + `send_receipt` (the tools that actually exist); no `record_payment` anywhere |
| "5¢ total recovery cost" | **"≈ 5¢ estimated messaging cost"** — excludes Bedrock inference + infra |
| "recover seven figures" (stated) | **dashed "Hypothetical scale scenario"** box, labeled a projection |
| payment shown as real | plan is **proposed → accepted**; installments collected by billing on due dates, "not by the agent" |

## Simulated vs. live inventory
**LIVE-VERIFIED on vf-dev-team5 (us-east-1):**
- Bedrock Nova 2 Lite message triage (hardship → `hardship/distressed/needsHuman`).
- Deterministic policy gate: opted-out account → `blocked / GLOBAL_OPT_OUT` while the model recommended contact.
- Decision audit: records persisted to `ra-decision-log` with reason code + executed action.
- Proactive outreach: indexed `by-status` query, `source: "model"`, 3 past_due accounts.
- Amazon SES email delivery.

**SIMULATED / EXAMPLE (explicitly labeled in the UI):**
- The entire **Decision Lab** — in-browser deterministic logic ported from the repo; no Bedrock call.
- All **phone message bubbles / animations** — frontend presentation, not live transport.
- **SMS / RCS / WhatsApp device delivery** — real SDK call paths, but device delivery pends messaging-sandbox exit (marked EXAMPLE in Execution Evidence).
- **Scale ROI** (seven-figure / 25–35% cost-to-collect) — illustrative projection, not a measured result.

## Data contract (for wiring real traces later)
The UI renders from `GUIDED_FIXTURE` via a `loadTrace()` seam (`DATA_SOURCE = 'fixture'`). To drive it from real/sanitized decision logs, return the same shape from a `ra-decision-log` export:

```ts
// one guided step, mirroring DecisionLogEntry (lib/shared/types.ts)
interface GuidedStep {
  kind: 'step';
  day: string;                 // e.g. "Step 2 · Day 3"
  ch: 'email'|'sms'|'rcs'|'whatsapp';
  phone: string;               // rendered message HTML (or build from the thread)
  rows: Array<{ k: string; v: string }>; // Context / Observation / Recommendation / Policy / Action / Outcome
}
// source fields to populate rows from a DecisionLogEntry:
//   signals → Context/Observation; recommendation{action,channel,reason,confidenceBasis} → Recommendation
//   policyDecision{allowed,reasonCode,reason} → Policy check; executedAction → Action; executionResult → Outcome
```
No backend API is implied or called; `loadTrace()` is the only integration point.

## Not done (by design / needs approval)
- No AWS deploy or infra change.
- No live Bedrock call from the browser (would require a credentialed backend endpoint; out of scope for a static CloudFront site).
- CloudFront re-upload of this build is a separate, user-run step.
