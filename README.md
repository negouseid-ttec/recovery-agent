# 💸 Recovery Agent — Autonomous Omnichannel Revenue Recovery

![Recovery Agent — the autonomous decision layer: problem → omnichannel escalation → hardship → $28 paid, $56 scheduled for ~5¢ messaging cost](demo/recovery-agent-demo.gif)

> An agentic AI that recovers past-due telecom revenue through **conversation instead of robocalls** — reaching each customer on the channel they actually answer, negotiating payment plans, honoring hardship and opt-outs, and keeping one continuous thread across SMS, RCS, WhatsApp, and email.

[![Built with AWS CDS](https://img.shields.io/badge/AWS-Communication%20Developer%20Services-orange)](https://aws.amazon.com/end-user-messaging/)
[![Powered by Amazon Bedrock](https://img.shields.io/badge/Amazon%20Bedrock-Nova%202%20Lite-blue)](https://aws.amazon.com/bedrock/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> **The story in one view:** Telecom Co. hands a $84 past-due account to the agent. It escalates on silence — cheapest channel first (📧 Email → 📱 SMS → 💬 RCS → 📲 WhatsApp) — **stops the moment Dana engages**, detects hardship, and sets an affordable plan: **$28 paid, $56 scheduled** on an active plan — for **~5¢ estimated messaging cost**.

## The Business Problem

Telecom is a massive, under-served collections category — and the tools used to collect are failing:

- **Telecom is more than a fifth of all U.S. debt-collection revenue**, and one of the most common tradelines in consumers' credit files. *(CFPB, 2018)*
- The ARM (collections) industry recovers only **~11% of face value** — most past-due money is never recovered. *(ACA International)*
- **Live-agent contact is expensive:** the industry median is **~$13.50 per agent-assisted contact** vs **~$1.84 for self-service** *(Gartner)*; collections calls commonly run **$5–$25 each**, most reaching voicemail.
- Aggressive collection **drives churn** — a mishandled past-due customer cancels and never comes back, destroying lifetime value far larger than the balance.
- It's also **heavily regulated** (FDCPA / Regulation F): quiet-hours limits (no contact before 8am / after 9pm), mandatory opt-out, no harassment — and debt collection is consistently among the most-complained-about financial topics to the CFPB.

The result: carriers leave money on the table *or* spend heavily to recover it while burning relationships and risking compliance violations.

## The Solution — and the ROI

**Recovery Agent** collects the way a great human agent would — on every channel, instantly, 24/7, at near-zero marginal cost — via an **intelligent escalation ladder**: start on the cheapest channel that can work, escalate only on silence, and stop the instant the customer engages.

> **Mature AI collections cut cost-to-collect by 25–35%** *(Deloitte, 2025)*. In this demo, the agent reaches and resolves an account for **~$0.05** across four channels — against **$5–$25** for a single live-agent call attempt (a 100×+ per-contact advantage). On a **$10M** past-due book, a 25–35% lower cost-to-collect plus a modest recovery lift is a **seven-figure swing**.

It reaches customers where they respond, offers real options with real numbers, and — critically — **knows when to stop**: it leads with empathy on hardship, pauses on disputes, honors opt-outs instantly, and respects quiet hours. That protects the relationship *and* keeps the carrier compliant.

```
📧 SES email   → Day 0 · cheapest first touch (~$0.0001/msg)
📱 SMS         → Day 3 · escalate on silence (~$0.0075/msg)
💬 RCS         → Day 7 · rich tap-to-pay card (~$0.012/msg; RCS→SMS fallback)
📲 WhatsApp    → Day 10 · premium touch for high-value/overdue (~$0.035/msg)
→ ladder STOPS the moment the customer engages on any channel
```

### What makes it agentic (not a robo-dialer)

| Capability | Behavior |
|---|---|
| **Inbound triage** | Bedrock classifies every reply — *promise-to-pay, payment-plan, dispute, hardship, opt-out, churn-threat* — with sentiment and a human-needed flag, then routes accordingly |
| **Payment-plan negotiation** | Splits a balance into realistic installments sized against the monthly charge |
| **Hardship handling** | Detects distress (job loss, illness), applies a hold, suppresses fees, routes to a specialist |
| **Dispute handling** | Pauses collection on the disputed amount and opens a review |
| **Compliance by design** | Never threatens; honors STOP/opt-out immediately; escalates legal/bankruptcy mentions |
| **Cross-channel memory** | One DynamoDB thread per customer — pick up on WhatsApp exactly where the SMS left off |

## Architecture

Four single-concept views — the runtime, the decision engine, the agent's tool belt, and how it integrates into a carrier.

**1 · Runtime** — inbound reply → API Gateway → Nova triage → agent orchestrator ⇄ DynamoDB → channel sender → outbound reply:

![Runtime architecture](docs/architecture-runtime.png)

**2 · Decision engine** — the escalation ladder: cheapest channel first, escalate only on silence, stop the instant the customer engages:

![Escalation-ladder decision flow](docs/architecture-decision-flow.png)

**3 · The agent** — a Bedrock Converse loop with a 7-tool belt and compliance encoded as behavior (not a dialer):

![Agent reasoning and tools](docs/architecture-agent-tools.png)

**4 · Integration** — the AWS core is built and deployed; productizing it into a carrier is a set of connectors (billing, payments, compliance, Amazon Connect) plus standard carrier onboarding:

![Enterprise integration](docs/architecture-integration.png)

| Service | Role |
|---|---|
| **AWS End User Messaging (EUM)** | SMS + RCS — proactive nudges, rich-card options |
| **AWS End User Messaging Social** | WhatsApp — negotiation, hardship, document collection |
| **Amazon SES** | Email — confirmations and the compliance paper trail |
| **Amazon Bedrock (Nova 2 Lite)** | Agent reasoning + inbound message triage |
| **AWS Lambda (ARM64)** | Serverless compute for every component |
| **Amazon DynamoDB** | Cross-channel conversation state + the past-due book |
| **Amazon API Gateway** | Inbound webhooks per channel |
| **AWS CDK** | Infrastructure as code — one-command, fully reproducible |

```
inbound reply (any channel)
  → ra-message-triage        Bedrock classifies intent + urgency + sentiment
  → ra-agent-orchestrator    Bedrock Converse loop + 7 collections tools
  → ra-channel-sender        EUM SMS/RCS · EUM Social WhatsApp · SES
       ↕ ra-accounts / ra-plans / ra-conversations (DynamoDB)
```

## Live Deployment Evidence

Real AWS CDS calls, not mocks (all Bedrock via **Amazon Nova 2 Lite**):

- **End-to-end chain** — an inbound reply flows `triage → orchestrator → sender → live SES receipt` through three deployed Lambdas in one transaction (CloudWatch-verified).
- **Message triage (live)** — a hardship message classifies as `hardship / distressed / needsHuman`, an opt-out as `opt_out / critical / needsHuman`.
- **Amazon SES (live)** — written confirmations delivered via `@aws-sdk/client-sesv2 SendEmailCommand`.
- **EUM SMS (live)** — `SendTextMessage` via `@aws-sdk/client-pinpoint-sms-voice-v2` (sandbox simulator; identical SDK path).
- **WhatsApp** — `@aws-sdk/client-socialmessaging SendWhatsAppMessage` wired; fires once a WhatsApp Business number is registered through EUM Social (a Meta-side onboarding step, not a code change).

## How a carrier adopts it

The AWS core — four Lambdas, DynamoDB, Bedrock, the four CDS channels — is **built and deployed via CDK**. Turning it into a production collections product for a specific carrier is **four connectors** plus standard messaging onboarding (see diagram 4):

| Connector | Direction | What it does | Status |
|---|---|---|---|
| **1 · Account ingestion** | inbound | Pull the past-due book from the carrier's billing/CRM/CIS (Amdocs, Netcracker, Salesforce) into `ra-accounts` — batch export / S3 drop / API poll, normalized to the shared account model | **TODO** — demo uses a seeded table |
| **2 · Payment rail** | outbound | Hand the agent's payment / plan actions to a PCI-compliant processor (Stripe, ACH, card vault) via a tokenized hand-off — no card data ever touches the agent | **TODO** — demo records intent only |
| **3 · Compliance & messaging config** | per-tenant | Quiet hours, frequency caps (FDCPA/Reg F, TCPA), the opt-out registry, plus carrier onboarding (10DLC brand reg, WhatsApp WABA, RCS agent) | **logic built** — needs per-tenant config + carrier onboarding (days) |
| **4 · Amazon Connect** | inbound/voice | Hand off to (or receive from) an existing Amazon Connect contact center — the agent handles proactive digital outreach, Connect handles inbound voice and live-agent assist, sharing one customer thread | **integration path** — for the many target customers already on Connect |

**Why a carrier buys it:** replace a **$5–25** live-agent call with a **~5¢** agent conversation on recoverable accounts (CFO); produce a **per-decision audit trail with the reason** every contact was made, on which channel, at what time — the question FDCPA/Reg F forces you to answer (compliance officer); and **detect hardship and offer an affordable plan instead of hounding**, protecting the subscriber relationship (CX/retention). The decision engine (`lib/shared/channel-strategy.ts`) returns a human-readable *reason* with every channel choice — that explainability is the moat.

**The real gap it closes — channel continuity.** Most enterprises already *have* SMS, email, and a contact center. What they lack is **continuity between channels**: today they stitch the hand-offs together with kludgy back-office processes, so a customer who replied by SMS gets a fresh, context-free email the next day. Recovery Agent keeps **one continuous agent thread per customer across every channel** (one DynamoDB conversation, cross-channel memory) — it picks up on WhatsApp exactly where the SMS left off. That continuity, not the individual channels, is the product.

**Where it fits — AWS-ecosystem customers.** The sharpest early target is a company **already on AWS (often Amazon Connect)** that hasn't yet adopted the native messaging + agentic-AI stack and is reaching for a third-party point solution (e.g. Sierra.ai) for automated outreach. Recovery Agent is the **native-AWS alternative** that keeps the workload on Amazon — a reason to deepen Connect/CDS adoption instead of bolting on an external tool. See **Connector 4** in the table above for the Amazon Connect hand-off path.

## Qualifying AWS CDS SDK usage (for judging)

| CDS service | Package | Call site |
|---|---|---|
| EUM (SMS/RCS) | `@aws-sdk/client-pinpoint-sms-voice-v2` | `lib/lambda/channel-sender/index.ts` → `SendTextMessageCommand` |
| EUM Social (WhatsApp) | `@aws-sdk/client-socialmessaging` | `lib/lambda/channel-sender/index.ts` → `SendWhatsAppMessageCommand` |
| Amazon SES | `@aws-sdk/client-sesv2` | `lib/lambda/channel-sender/index.ts` → `SendEmailCommand` |

## Try It

```bash
npm install --registry=https://registry.npmjs.org/
npm run demo:local            # full offline journey in the terminal
npm test                      # infra + logic tests

# Deploy (your AWS account)
npx cdk deploy --all
```

The demo UI (`demo/web/index.html`) is a 3-view judge-facing app — **Guided Demo** (Dana story + agent-intelligence panel), **Decision Lab** (interactive, clearly-simulated policy + ladder), and **Execution Evidence** (AWS/tool/policy timeline, LIVE-VERIFIED vs EXAMPLE). Serve with any static server; `?view=`, `?frame=`, `?autoplay=1`, `?nofx=1`. See `demo/DEMO_DELIVERABLES.md`.

## Demo Video

🎥 **3-minute demo — _recording pending_** (script: `demo/VIDEO_SCRIPT.md`). The public YouTube/Vimeo URL will be added here and on the Devpost form before submission.

## Submission Artifacts

| # | Artifact | Location |
|---|---|---|
| 1 | Code Repository | This repo |
| 2 | Architecture Diagram | `docs/architecture-runtime.png` + `docs/architecture-decision-flow.png` |
| 3 | Text Description | This README |
| 4 | Demo Video | _recording pending — URL added before submission_ |
| 5 | Deployed Project | CloudFront demo UI + deployed Lambdas (see Live Deployment Evidence) |
| 6 | ACE Opportunity ID | `O29439654` |

## Sources

Market and ROI figures above are drawn from public sources:
- CFPB, *Quarterly Consumer Credit Trends: Collection of Telecommunications Debt* (2018) — telecom = >1/5 of collection revenue
- ACA International — ARM industry recovery rate (~11% of face value)
- Gartner — cost per contact (~$1.84 self-service vs ~$13.50 agent-assisted)
- Deloitte (2025) — mature AI collections cut cost-to-collect 25–35%
- Fact.MR, *Debt Collection Services Market* (2025) — market size
- CFPB *FDCPA Annual Reports* (2023, 2025); *Regulation F* (12 CFR Part 1006) — compliance rules

See [demo/RESEARCH_BRIEF.md](demo/RESEARCH_BRIEF.md) for the full brief with per-claim confidence notes.

## License

[MIT](LICENSE) · Built for the [AWS CDS Agentic AI Partner Hackathon](https://aws-cds-partner.devpost.com/).
