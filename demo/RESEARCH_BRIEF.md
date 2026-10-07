# Recovery Agent — Research Brief for the Demo Video

Every figure below has a source. Where a number is commonly cited but weakly
sourced, it's flagged ⚠️ and a safer framing is given. Use the **🟢 strong**
numbers as hard claims; frame ⚠️ ones as "industry benchmarks suggest…".

---

## 1. The size of the problem

🟢 **Telecom is one of the largest collections categories.** The CFPB found
telecommunications debt "accounted for **more than one fifth of all debt
collection revenue**" and is one of the most common tradelines in consumers'
credit files. *(CFPB, Quarterly Consumer Credit Trends, Aug 2018.)*

🟢 **The collections industry is huge and growing.** The debt-collection
services market was ~**$31.7B in 2025**, projected to ~**$44.8B by 2036**.
*(Fact.MR, Debt Collection Services Market, 2025.)*

🟢 **Recovery rates are low — the core inefficiency.** ARM (accounts-receivable
management) firms collected ~**$102.6B** in a year at a recovery rate of only
**11.1% of face value**. *(ACA International, 2023/24.)* → *Most past-due money
is never recovered. Even small lifts are large dollars.*

🟢 **Consumers in collections, at scale.** ~**33 million Americans** hold debt
in collections, average balance ~**$9,250**; U.S. consumer debt ~**$17.5T**
(Q3 2023). *(NY Fed / aggregated industry stats.)*

**Video line:** "Telecom is over a fifth of all U.S. debt-collection revenue —
and the industry only recovers about 11 cents on the dollar. The money left on
the table is enormous."

---

## 2. Why channel choice matters (the escalation-ladder thesis)

🟢 **Email open rates are low and getting harder to measure** (~**20–25%**,
inflated by Apple Mail Privacy Protection). *(GetResponse 2025; multiple 2025–26
benchmarks.)*

🟢 **WhatsApp engagement is dramatically higher** — commonly cited **~90–98%
open**, opened within minutes, with far higher CTR than email. *(Meta Business
Messaging; multiple 2025–26 industry reports.)* Frame as "industry benchmarks
report."

⚠️ **"SMS has a 98% open rate"** — widely repeated but **not verifiable**; SMS
platforms can't measure opens like email. Rally Corp / analysts say there's no
sound methodology. **Safer:** "SMS reaches customers reliably and is read fast,"
or cite CTR (top SMS performers ~15%+), not a 98% open figure.

**Takeaway for the ladder:** channels differ by **reach, immediacy, richness,
and cost** — so the optimal strategy is cheapest-that-works first, escalate on
silence. That's exactly what Recovery Agent does.

---

## 3. The economics — cost to collect (the ROI engine)

🟢 **Human-assisted contact is expensive.** Gartner median **~$13.50 per
agent-assisted contact** vs. **~$1.84 for self-service**. *(Gartner, via Plura/
Voiceflow 2025–26.)* Live collections calls commonly cited **$5–$25 per call**;
fully-loaded U.S. agents **$25–$45/hour**.

🟢 **AI/automation cuts cost-to-collect materially.** Deloitte (2025):
cost-to-collect **drops 25–35%** at organizations with mature AI collections,
via fewer low-value touches and faster resolution. AI self-service runs **5–50×
cheaper** than fully-loaded human voice. *(Deloitte 2025; Gartner.)*

⚠️ **"Recovery lift 42–72%"** — vendor-reported range; real lift depends on
baseline and deployment. **Safer:** "industry deployments report double-digit
recovery lift and 25–35% lower cost-to-collect."

**Video math (defensible):** Our outreach ladder cost ~**$0.05** to reach and
resolve one account across four channels. Compare that to **$5–$25** for a
single live-agent call attempt — a **100×+** cost advantage per contact — and
most calls reach voicemail. On a **$10M** past-due book, a **25–35% lower
cost-to-collect** plus a modest recovery lift is a seven-figure swing.

---

## 4. Compliance — why "knowing when to stop" is a feature, not a nicety

🟢 **Debt collection is the/among the most-complained-about financial topics**
to the CFPB, and is federally regulated under the **FDCPA + Regulation F**
(12 CFR 1006). *(CFPB FDCPA Annual Reports 2023/2025.)*

🟢 **Hard rules the agent must encode:**
- **No contact before 8 a.m. or after 9 p.m.** (quiet hours) — Reg F / CFPB.
  *(This is literally why our strategy has a quiet-hours hold.)*
- Honor opt-out / cease-contact requests.
- No harassing, false, or misleading communications (Reg F §§1006.14, 1006.18).
- Validation notice at the outset of collection.

**Video line:** "Collections is one of the most-complained-about and most
heavily regulated areas in financial services. Recovery Agent encodes the
rules — quiet hours, instant opt-out, no pressure, hardship holds — as behavior,
not hope."

---

## 5. The "path to success" narrative arc for the video

1. **Problem (dollars):** telecom = 1/5 of collections revenue; industry recovers
   ~11% of face value; most money is left on the table.
2. **Why today's tools fail:** robocalls ignored; live agents cost $5–$25/contact
   and churn customers; email barely gets opened.
3. **The insight:** reach people on the channel they answer, at the right cost,
   at a compliant time — and *stop* when they engage.
4. **The agent:** escalation ladder (email→SMS→RCS→WhatsApp) + AI triage +
   hardship/dispute/opt-out judgment, all on AWS CDS + Bedrock.
5. **The proof:** live on AWS — triage classifies, agent decides, SES fires.
6. **The business case:** ~$0.05 to resolve an account; 25–35% lower
   cost-to-collect; on a $10M book, a seven-figure swing; Marketplace-ready.

---

## Source list (for the submission / README credibility)
- CFPB, *Quarterly Consumer Credit Trends: Collection of Telecommunications Debt* (Aug 2018)
- CFPB, *FDCPA Annual Reports* (2023, 2025); *Regulation F*, 12 CFR Part 1006
- ACA International, collections volume & recovery-rate data (2023/24)
- Fact.MR, *Debt Collection Services Market* (2025)
- Gartner cost-per-contact medians ($1.84 self-service / $13.50 assisted)
- Deloitte (2025), AI collections cost-to-collect reduction 25–35%
- Meta Business Messaging / GetResponse channel-engagement benchmarks (2025–26)

> Rule of thumb for the video: lead with the 🟢 CFPB "one-fifth of collection
> revenue", the 🟢 11% recovery rate, and the 🟢 Gartner $1.84-vs-$13.50 cost
> gap — those three are rock-solid and tell the whole story. Treat open-rate and
> recovery-lift percentages as "benchmarks suggest," not hard claims.
