# ACE Opportunity — Hand-off for Filing

> **Why this matters:** The hackathon submission fails **Stage One (pass/fail eligibility)** without a valid ACE opportunity ID. No code change can recover this — it's a hard gate. File it, then paste the `OXXXXXXXX` ID back.

---

## Copy-paste message to the colleague filing it

**Subject: Need an ACE opportunity filed for the AWS CDS Agentic AI Hackathon (eligibility gate)**

Hey — I need your help filing an **ACE (APN Customer Engagement) opportunity** for a hackathon submission. It's the eligibility gate; the submission fails Stage One without a valid opportunity ID. Can you file it today?

**Project:** Recovery Agent — autonomous omnichannel revenue-recovery AI agent for telecom past-due balances. Built on AWS Communication Developer Services (End User Messaging SMS/RCS + Social WhatsApp + SES) and Amazon Bedrock (Nova 2 Lite). Deployed and running in `vf-dev-team5` (173919434631, us-east-1).

**What to do in Partner Central → ACE → Opportunities → Create opportunity:**

1. Create a **net-new** opportunity, dated **on or after Sept 14, 2026**. ("Created" status is enough — it does **not** need to be "Launched.")

2. **Step 2 (Add project details) → Opportunity marketing details → Sourced from marketing activity → Marketing campaign** — enter exactly (copy-paste, keep the spacing):

   ```
   AWS CDS Agentic AI Hackathon -Sept. 2026
   ```
   *(note the space before `-`, no space after, and the period after "Sept")*

3. **Step 4 (Configure deal size estimate) → Product selection** — tag these products so the opportunity attributes correctly to our CDS services:

   | Our CDS service | Product to select in ACE |
   |---|---|
   | RCS (Rich Communication Services) | AWS End User Messaging |
   | SMS (Short Message Service) | AWS End User Messaging |
   | WhatsApp | AWS End User Messaging Social |
   | SES (Simple Email Service) | Amazon Simple Email Service (SES) |

4. **Customer:** confidential is fine — use industry (**telecom**), geo, and an estimated ARR. Only AWS sees the ACE opportunity; it is not shown publicly on Devpost. If there's no named customer deal yet, that's explicitly allowed — enter the most accurate info available.

5. **Send me back the ACE Opportunity ID** — find it under **Partner Central → Sell (left nav) → Opportunities** table. Format: `OXXXXXXXX`.

ACE how-to doc: https://docs.aws.amazon.com/partner-central/latest/sales-guide/creating-opportunity.html

Takes ~10 minutes. Shout if the form asks anything you want me to answer. Thanks!

---

## Quick reference (for me)

- **Campaign code:** `AWS CDS Agentic AI Hackathon -Sept. 2026`
- **Constraints:** net-new, created ≥ 2026-09-14, "Created" status sufficient
- **ID format / location:** `OXXXXXXXX`, Partner Central → Sell → Opportunities
- **Source of truth:** [hackathon FAQ](https://aws-cds-partner.devpost.com/details/faq) · [rules](https://aws-cds-partner.devpost.com/rules)
- **Status:** ✅ **FILED 2026-10-08 — ACE Opportunity ID `O29439654`.** Paste this into the Devpost submission form's ACE-opportunity-ID field.
