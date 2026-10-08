# Submission Checklist — AWS CDS Agentic AI Partner Hackathon

Project: **Recovery Agent** — autonomous omnichannel revenue-recovery AI agent for telecom past-due balances.
Deadline: **Oct 28, 2026, 1:00 pm PT**. Judging: Nov 6–12. Winners: ~Nov 19.
Sources checked: [Rules](https://aws-cds-partner.devpost.com/rules) · [FAQ](https://aws-cds-partner.devpost.com/details/faq)

Legend: ✅ done · ⚠️ ready, action pending · ❌ not started / blocking

---

## 1. Eligibility (Stage One pass/fail)

| Item | Status | Notes |
|---|---|---|
| Entrant is an APN-registered partner / authorized individual | ⚠️ | Confirm TTEC APN registration + corporate email on the APN domain used at Devpost registration |
| Project reasonably fits the theme | ✅ | Agentic AI on AWS for a real telecom revenue-recovery use case |
| Uses ≥1 qualifying AWS CDS service at runtime (imported **and** called) | ✅ | See §3 |
| **ACE opportunity ID** submitted (net-new, created ≥ 9/14/2026, campaign-coded) | ❌ | **Eligibility gate.** Colleague filing. See §5 |

## 2. Project requirements

| Item | Status | Notes |
|---|---|---|
| Newly created during submission window (Sep 14 – Oct 28, 2026) | ✅ | Built Sep–Oct 2026 |
| Deployed and runs consistently; functions as shown in video/description | ✅ | Deployed to `vf-dev-team5` (173919434631, us-east-1); stacks `RecoveryAgent-Data` + `-Agent` live |
| Agentic AI framework on AWS (AgentCore NOT required) | ✅ | Custom Bedrock (Nova 2 Lite) orchestrator on AWS Lambda — FAQ explicitly accepts custom Lambda agents |
| Third-party integrations properly licensed / disclosed | ✅ | AWS SDKs only; MIT license |

## 3. AWS CDS SDK usage (imported + actually called — judged in Technical Execution 40%)

| CDS service | SDK client | Operation called | Status |
|---|---|---|---|
| AWS End User Messaging — SMS | `@aws-sdk/client-pinpoint-sms-voice-v2` | `SendTextMessage` | ✅ |
| AWS End User Messaging — RCS | `@aws-sdk/client-pinpoint-sms-voice-v2` | `SendRcsMessage` | ✅ real agent `rcs-ee05df3ee8b64d2a8778fd5fbefae34c` (TESTING) |
| AWS End User Messaging Social — WhatsApp | `@aws-sdk/client-socialmessaging` | `SendWhatsAppMessage` | ✅ |
| Amazon SES | `@aws-sdk/client-sesv2` | `SendEmail` | ✅ **live-proven** (real inbox delivery) |

> Legacy clients (`pinpoint`, `pinpoint-email`, v1 `sms-voice`) and EUM Push do **not** qualify — we use none of them.
> RCS note (per FAQ): a **testing agent** that sends only to pre-registered devices is **sufficient** for the demo. Our sandbox limitation is expected, not a gap.

## 4. Submission form assets (Devpost)

| Asset | Status | Location / action |
|---|---|---|
| Code repo URL (GitHub) | ✅ | https://github.com/negouseid-ttec/recovery-agent |
| Repo reachable for judging | ⚠️ | **Private today.** Either make public (MIT already present, must show in About) **or** share with the two judging emails (see §5) |
| Open-source license (if public) | ✅ | `LICENSE` (MIT) in repo root |
| Architecture diagram | ✅ | `docs/architecture-runtime.(svg\|png)` + `docs/architecture-decision-flow.(svg\|png)` |
| Text description (features + functionality) | ✅ | `README.md` |
| **Demo video (~3 min, public on YouTube/Vimeo)** | ❌ | **Top gap (Demo = 20%).** Script ready: `demo/VIDEO_SCRIPT.md` + Word doc in `~/Documents`. No copyrighted music; must show the project functioning |
| Deployed project URL | ⚠️ | CloudFront `https://d3rtl5b9kojwtc.cloudfront.net` — **re-upload latest story build** (see §6). README also carries interaction instructions as fallback |
| Meta WhatsApp Prize: describe EUM Social (WhatsApp) usage | ⚠️ | Add a dedicated WhatsApp-usage section to README to lock eligibility |
| English (or translation provided) | ✅ | All English |

## 5. ACE opportunity (Partner Central) — colleague filing

- **Must be net-new, created on/after 9/14/2026.** "Created" status is enough (need not be "Launched").
- **Campaign code (copy exactly, keep spacing):** `AWS CDS Agentic AI Hackathon -Sept. 2026`
  - Create Opportunity → **Step 2 (Add project details)** → Opportunity marketing details → *Sourced from marketing activity* → **Marketing campaign** → paste the code.
- **Product tags → Step 4 (Configure deal size estimate) → Product selection:**
  | Our CDS service | Select in ACE |
  |---|---|
  | RCS | AWS End User Messaging |
  | SMS | AWS End User Messaging |
  | WhatsApp | AWS End User Messaging Social |
  | SES | Amazon Simple Email Service (SES) |
- **Customer:** confidential OK — use industry (telecom), geo, and estimated ARR; only AWS sees the opportunity.
- **Find the ID:** Partner Central → **Sell → Opportunities** table. Format: `OXXXXXXXX`.
- ACE how-to: https://docs.aws.amazon.com/partner-central/latest/sales-guide/creating-opportunity.html

## 6. Deploy / CloudFront re-upload (agent-blocked — run in your terminal)

```bash
aws s3 cp ~/recovery-agent/demo/web/index.html \
  s3://recovery-agent-demo-173919434631/index.html \
  --content-type "text/html; charset=utf-8" --profile vf-dev-team5

aws cloudfront create-invalidation \
  --distribution-id E2SFKCZNIIEKQ3 --paths "/index.html" "/" --profile vf-dev-team5
```

## 7. Repo-share emails (private-repo path)

The two judging addresses are obfuscated on Devpost; the exact strings live in the hackathon's private GitHub README:
https://github.com/aws-cds-partner/aws-cds-agentic-ai-partner-hackathon-private/blob/main/README.md
(one is a `devpost.com` testing address, the other an `amazon.com` CDS-partner address). Add both as repo collaborators if staying private.

---

## Open blockers (do these to submit)

1. ❌ **Record + upload the ~3-min demo video** to YouTube/Vimeo (public). Script + Word doc ready. — *you*
2. ❌ **File the ACE opportunity**, get the `OXXXXXXXX` ID. — *colleague (today)*
3. ⚠️ **Make the repo reachable** — flip public or share the two judging emails. — *you*
4. ⚠️ **Re-upload the story UI to CloudFront** (§6). — *you*
5. ⚠️ **Confirm APN registration / corporate email** matches at Devpost registration. — *you*

## Done (build complete)

- ✅ 4 CDS SDKs imported + called (SES live-proven; RCS real `SendRcsMessage`; SMS; WhatsApp)
- ✅ Bedrock Nova 2 Lite agent orchestrator on Lambda; 4 CDK stacks; 33 tests passing
- ✅ Two architecture diagrams; product README with sourced ROI; demo GIF (14-frame story)
- ✅ Video script (+ Word doc); research brief; live-proof scripts

_Last updated: 2026-10-08._
