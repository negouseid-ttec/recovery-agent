# Recovery Agent — Demo Video Script (~3 minutes)

> Record the step-by-step UI (click **Step 1 → narrate → Step 2 → …**), then cut
> to the live-proof segment. The hero idea is the **escalation ladder**: the
> agent reaches the customer on the *cheapest channel that works* and only
> escalates when there's no response — then stops the instant they engage.

---

## OPENING — the dollar problem (0:00 – 0:22)

**[SCREEN: UI initial state — four phones in cost order, "Outreach spend $0.0000"]**

> Telecom carriers carry billions in past-due receivables. Robocalls recover
> about three percent. Live agents recover twenty — but cost four to eight
> dollars a call and drive customers to churn.
>
> **Recovery Agent** collects differently. It reaches each customer on the
> cheapest channel that can work, escalates only when there's no response, and
> stops the moment they engage. Watch the "outreach spend" counter — this whole
> recovery costs about a nickel.

**[ACTION: click Step 1]**

---

## STEP 1 — Email first, because it's nearly free (0:22 – 0:45)

**[SCREEN: reason banner + Email phone]**

> Day zero. The agent's first touch is **email**, through **Amazon SES** —
> about one-hundredth of a cent. Read the reason banner: *"cheapest,
> least-intrusive channel first."* It's a real decision, not a blast.
>
> Three days pass. No open, no reply.

**[ACTION: click Step 2]**

---

## STEP 2 — Escalate to SMS (0:45 – 1:08)

**[SCREEN: reason banner + SMS phone]**

> Silence triggers the ladder. The agent escalates to **SMS** via **AWS End
> User Messaging** — ninety-eight percent open rate, but pricier at about
> three-quarters of a cent. Notice it didn't send SMS *and* email at once — it
> escalated *because* email got no response.
>
> Four more days. Still nothing.

**[ACTION: click Step 3]**

---

## STEP 3 — Escalate to RCS (1:08 – 1:30)

**[SCREEN: reason banner + RCS rich card]**

> Next rung: **RCS**, also AWS End User Messaging — a rich card with tap-to-pay
> buttons, no call, no hold. And if the handset can't render RCS, the agent
> falls back to SMS automatically. Still a little pricier, still the right next
> step given the silence.

**[ACTION: click Step 4]**

---

## STEP 4 — Escalate to WhatsApp, and she engages (1:30 – 1:58)

**[SCREEN: reason banner + WhatsApp phone]**

> Day ten. Thirty-plus days overdue, no response anywhere. Now — and only now —
> the agent escalates to **WhatsApp**, via **AWS End User Messaging Social**.
> It's the richest, most personal channel and the most expensive, so it's
> reserved for accounts worth the touch. Read the reason: *"no response on
> cheaper channels, severely overdue — escalate to WhatsApp."*
>
> And this time, Dana replies: *"I just lost my job, money is really tight."*

**[ACTION: click Step 5]**

---

## STEP 5 — The ladder STOPS; the agent reasons and acts (1:58 – 2:25)

**[SCREEN: WhatsApp — tool chips fire]**

> The instant she engages, escalation stops — no more channels, no more cost.
> Now the agent does the hard part. It doesn't push. It detects hardship, calls
> **apply_hardship** — pausing collection, suppressing late fees, stopping the
> suspension — and sends a written confirmation by **Amazon SES**.
>
> Total outreach spend for this entire recovery: about five cents. A live-agent
> campaign would have cost dollars and might have lost her to churn.

---

## STEP 6 — Live proof (2:25 – 2:52)

**[SCREEN: cut to terminal running demo/live/live-proof.sh + the real inbox]**

> And this is all running on AWS right now. When Dana's hardship message hits
> the **deployed** triage Lambda, Amazon Bedrock — Nova 2 Lite — classifies it:
> *hardship, distressed.* The deployed orchestrator then decides on its own —
> check_balance, apply_hardship, and it even composes a full, empathetic
> hardship email — and fires it through **Amazon SES**. There's the message in
> the inbox. Inbound to resolution, one unbroken chain, live Lambdas.

---

## CLOSING — the business case (2:52 – 3:05)

**[SCREEN: architecture diagram with the Business Impact box]**

> Recovery Agent: four AWS Communication Developer Services, one Bedrock agent,
> an intelligent escalation ladder that collects for cents, and compliance built
> in. On a ten-million-dollar book, lifting recovery from twenty to thirty
> percent is a **million dollars** recovered — at a fraction of the cost to
> collect. Reproducible in CDK, ready for AWS Marketplace. Thank you.

---

## Recording Notes
- Step through the UI one click per narration beat — the reason banner + the
  "outreach spend" chip are the stars; keep them in frame.
- For Step 6, re-run `demo/live/seed-live.sh` then `demo/live/live-proof.sh` on
  camera and show the real inbox email.
- Under 3:00. 1080p. Clean VO recorded separately. No copyrighted music.
