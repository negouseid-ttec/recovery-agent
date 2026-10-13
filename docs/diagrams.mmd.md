# Recovery Agent — Architecture Diagrams (Mermaid, Lucid-ready)

Paste any block below into **Lucidchart → Insert → Mermaid**, click Insert, then
restyle with the **AWS Architecture 2021** shape library and export each page via
**File → Download As → PNG** (2× / high-res) into `docs/` with the matching filename.

> Import gotchas: if a block fails, replace `<br/>` with a space and `([text])`
> with `[text]`; dotted "reply" edges may import solid — restyle them dashed.

---

## Page 1 — Runtime pipeline  → `architecture-runtime.png`

```mermaid
flowchart TB
  subgraph IN["Inbound — customer replies"]
    direction LR
    SMSi["SMS<br/>AWS End User Messaging"]
    RCSi["RCS<br/>AWS End User Messaging"]
    WAi["WhatsApp<br/>EUM Social"]
    EMi["Email<br/>Amazon SES"]
  end
  APIGW["Amazon API Gateway<br/>one webhook per channel"]
  TRIAGE["λ ra-message-triage<br/>Bedrock Nova 2 Lite — classify intent · urgency · sentiment · needsHuman"]
  ORCH["λ ra-agent-orchestrator<br/>Bedrock Nova 2 Lite — Converse + Tool Use"]
  DDB[("Amazon DynamoDB<br/>ra-accounts · ra-plans · ra-conversations")]
  SENDER["λ ra-channel-sender<br/>EUM SMS/RCS · EUM Social WhatsApp · SES"]
  subgraph OUT["Outbound — agent replies on the chosen channel"]
    direction LR
    SMSo["SMS"]
    RCSo["RCS"]
    WAo["WhatsApp"]
    EMo["SES"]
  end
  SMSi --> APIGW
  RCSi --> APIGW
  WAi --> APIGW
  EMi --> APIGW
  APIGW --> TRIAGE --> ORCH
  ORCH <--> DDB
  ORCH --> SENDER
  SENDER --> SMSo
  SENDER --> RCSo
  SENDER --> WAo
  SENDER --> EMo
```

---

## Page 2 — Escalation-ladder decision flow  → `architecture-decision-flow.png`

```mermaid
flowchart TB
  CRON["λ ra-proactive-outreach<br/>EventBridge — daily"]
  DECIDE{"selectOutreachChannel(signals)"}
  QUIET{"Quiet hours?<br/>9pm–8am"}
  EMAIL["Day 0 · Email · ~$0.0001<br/>cheapest first touch"]
  SMS["Day 3 · SMS · ~$0.0075<br/>escalate on silence"]
  RCS["Day 7 · RCS · ~$0.012<br/>rich tap-to-pay (RCS→SMS fallback)"]
  WA["Day 10 · WhatsApp · ~$0.035<br/>GATED: ≥ $400 OR 30+ days overdue"]
  STOP(["Customer engages on ANY channel<br/>→ STOP ladder, continue the conversation there"])
  HOLD(["Hold to email only"])
  OPTOUT["Per-channel opt-out honored<br/>skip any opted-out channel"]
  CRON --> DECIDE
  DECIDE --> QUIET
  QUIET -- yes --> HOLD
  QUIET -- no --> EMAIL
  EMAIL -- no response --> SMS
  SMS -- no response --> RCS
  RCS -- no response --> WA
  EMAIL -. reply .-> STOP
  SMS -. reply .-> STOP
  RCS -. reply .-> STOP
  WA -. reply .-> STOP
  DECIDE --- OPTOUT
```

---

## Page 3 — The agent (reasoning + tool belt)  → `architecture-agent-tools.png`

```mermaid
flowchart TB
  subgraph INTENT["Inbound intent — Nova triage classifies the reply"]
    direction LR
    I1["promise-to-pay"]
    I2["payment-plan"]
    I3["dispute"]
    I4["hardship"]
    I5["opt-out"]
    I6["churn-threat"]
  end
  ORCH["λ ra-agent-orchestrator<br/>Bedrock Nova 2 Lite — Converse loop"]
  subgraph TOOLS["Tool belt — the agent calls the right tool"]
    direction LR
    T1["check_balance"]
    T2["offer_payment_plan"]
    T3["record_promise_to_pay"]
    T4["apply_hardship"]
    T5["log_dispute"]
    T6["send_receipt"]
    T7["escalate_to_human"]
  end
  COMPLY["Compliance by design<br/>no threats · honors STOP/opt-out instantly · hardship-first · quiet hours · escalates legal/bankruptcy"]
  INTENT --> ORCH
  ORCH --> TOOLS
  ORCH --- COMPLY
```

---

## Page 4 — Enterprise integration (the 3 connectors)  → `architecture-integration.png`

```mermaid
flowchart TB
  subgraph CORE["Recovery Agent core — BUILT & DEPLOYED on AWS via CDK"]
    direction LR
    L["4 Lambdas (ARM64)"]
    B["Amazon Bedrock<br/>Nova 2 Lite"]
    D[("Amazon DynamoDB")]
  end
  C1["Connector 1 · Account ingestion (INBOUND)<br/>Billing / CRM / CIS — Amdocs · Netcracker · Salesforce<br/>batch export / S3 drop / API poll → ra-accounts<br/>⚠ TODO for production (demo uses a seeded table)"]
  C2["Connector 2 · Payment rail (OUTBOUND)<br/>PCI-compliant processor — Stripe · ACH · card vault<br/>tokenized hand-off; no PAN in-agent<br/>⚠ TODO for production (demo records intent only)"]
  C3["Connector 3 · Compliance & messaging config<br/>quiet hours · freq caps (FDCPA/Reg F, TCPA) · opt-out registry<br/>carrier onboarding: 10DLC · WhatsApp WABA · RCS agent<br/>⚠ logic built; needs per-tenant config + onboarding (days)"]
  C1 -- "past-due accounts" --> CORE
  CORE -- "payment / plan actions" --> C2
  C3 --- CORE
```

---

## Styling once in Lucid
- Swap plain shapes for **AWS Architecture 2021** icons (API Gateway, Lambda, DynamoDB, Bedrock, SES, End User Messaging).
- Color language: SMS amber · RCS blue · WhatsApp green · SES/email teal · Bedrock magenta · DynamoDB cyan · connectors orange.
- Page 4: `CORE` subgroup green ("BUILT & DEPLOYED"), the 3 connectors amber ("INTEGRATION WORK").
