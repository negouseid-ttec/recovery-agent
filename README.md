# 💸 Recovery Agent — Autonomous Omnichannel Revenue Recovery

> An agentic AI that recovers past-due telecom revenue through **conversation instead of robocalls** — reaching each customer on the channel they actually answer, negotiating payment plans, honoring hardship and opt-outs, and keeping one continuous thread across SMS, RCS, WhatsApp, and email.

[![Built with AWS CDS](https://img.shields.io/badge/AWS-Communication%20Developer%20Services-orange)](https://aws.amazon.com/end-user-messaging/)
[![Powered by Amazon Bedrock](https://img.shields.io/badge/Amazon%20Bedrock-Nova%202%20Lite-blue)](https://aws.amazon.com/bedrock/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## The Business Problem

Telecom carriers carry **billions in past-due accounts receivable**. The tools they use to collect are failing:

- **Automated robocalls** recover ~**3%** and customers ignore them.
- **Live agents** recover ~**20%** but cost **$4–8 per contact attempt** — most of which reach voicemail.
- Aggressive collection **drives churn**: a mishandled past-due customer cancels and never comes back, destroying lifetime value far larger than the balance.

The result: carriers either leave money on the table or spend heavily to recover it while burning customer relationships.

## The Solution — and the ROI

**Recovery Agent** is an AI that collects the way a great human agent would — but on every channel, instantly, 24/7, and at near-zero marginal cost.

> **On a $10M past-due book, lifting recovery from 20% to 30% recovers an additional $1,000,000 — while cutting live-agent contact minutes by ~70%.**

It reaches customers where they respond, offers real options with real numbers, and — critically — **knows when to stop**: it leads with empathy on hardship, pauses on disputes, and honors opt-outs instantly. That protects the customer relationship *and* keeps the carrier compliant.

```
📱 SMS         → "Your account is past due $84. Reply HELP and I'll make it easy."
💬 RCS         → tap: Pay now · Split into payments · Dispute · I need help
📲 WhatsApp    → negotiates a plan, handles hardship, collects documents
📧 SES email   → the written confirmation / compliance paper trail
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

![Architecture](docs/architecture.png)

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

The four-phone demo UI (`demo/web/index.html`) animates the full journey for the video — serve it with any static server.

## Demo Video

🎥 **[3-minute demo](https://youtu.be/PLACEHOLDER)** — robocall problem → agent recovers a balance across four channels → the dollar-ROI close.

## Submission Artifacts

| # | Artifact | Location |
|---|---|---|
| 1 | Code Repository | This repo |
| 2 | Architecture Diagram | `docs/architecture.png` |
| 3 | Text Description | This README |
| 4 | Demo Video | [YouTube](https://youtu.be/PLACEHOLDER) |
| 5 | Deployed Project | CloudFront demo UI + deployed Lambdas (see Live Deployment Evidence) |
| 6 | ACE Opportunity ID | `OPP-XXXXXXXXX` |

## License

[MIT](LICENSE) · Built for the [AWS CDS Agentic AI Partner Hackathon](https://aws-cds-partner.devpost.com/).
