# Recovery Agent — Demo Video Script (~3 minutes)

> Record the web UI at `http://127.0.0.1:8778/` (click **Play the recovery**),
> then cut to a short live-proof segment (inbox + CloudWatch). Lead with the
> dollar problem; let the architecture be the proof, not the pitch.

---

## OPENING — the dollar problem (0:00 – 0:25)

**[SCREEN: UI initial state — four phones, status strip "Past due $84.00 · past_due"]**

> Telecom carriers carry billions in past-due receivables. The tools they use
> to collect are failing: automated robocalls recover about three percent and
> get ignored. Live agents recover around twenty percent — but cost four to
> eight dollars per attempt, and aggressive collection drives customers to churn.
>
> **Recovery Agent** collects the way a great human agent would — on every
> channel, instantly, at near-zero marginal cost — and it knows when to stop.
>
> Meet Dana. She's thirty-two days past due, eighty-four dollars, service
> suspends in ten days.

**[ACTION: Click "Play the recovery"]**

---

## ACT 1 — Proactive SMS (0:25 – 0:45)

**[SCREEN: SMS phone]**

> The agent reaches out by **SMS**, through **AWS End User Messaging** — not a
> robocall, a real conversation opener. Dana replies HELP. The agent calls its
> **check_balance** tool, pulls her account from DynamoDB, and lays out the
> options with real numbers: pay in full, or split it.

---

## ACT 2 — RCS payment plan (0:45 – 1:10)

**[SCREEN: RCS phone — the rich card]**

> Dana switches to **RCS** — richer AWS End User Messaging — and says she can't
> pay it all. The agent calls **offer_payment_plan**, splits eighty-four dollars
> into three biweekly payments of twenty-eight, and sends a written confirmation
> by **Amazon SES**. Watch the email phone light up. Her service stays on.
> That's revenue recovered that a robocall would have lost.

---

## ACT 3 — Hardship, handled with judgment (1:10 – 1:45)

**[SCREEN: WhatsApp phone]**

> Now the moment that separates an agent from a dialer. Dana opens **WhatsApp**
> — **AWS End User Messaging Social** — and says she just lost her job.
>
> The agent doesn't push. It calls **apply_hardship**: pauses collection,
> suppresses late fees, stops the suspension, and routes to a specialist — then
> sends a second SES confirmation. This is compliance and empathy encoded as
> behavior. It protects the customer relationship *and* the carrier.

---

## ACT 4 — Dispute, same thread (1:45 – 2:05)

**[SCREEN: SMS phone]**

> Days later, back on **SMS**, Dana spots a charge she doesn't recognize and
> disputes it. Same conversation, any channel — the agent calls **log_dispute**,
> pauses collection on that amount, and opens a review. One continuous thread,
> stored in DynamoDB, that picks up wherever she left off.

---

## ACT 5 — Compliance: opt-out (2:05 – 2:20)

**[SCREEN: WhatsApp phone]**

> And when she says STOP, the agent stops — instantly. **escalate_to_human**
> with an opt-out reason, no further messages, specialist notified. Honoring
> that in real time isn't just polite — it's a regulatory requirement, enforced
> in code.

---

## ACT 6 — Live proof (2:20 – 2:50)

**[SCREEN: cut to the real inbox + a terminal with the triage output]**

> None of this is a mockup. It's deployed on AWS right now.
>
> **[SHOW: triage JSON]** When Dana's hardship message actually hits the
> **deployed** triage Lambda, Amazon Bedrock — Nova 2 Lite — classifies it:
> *intent hardship, sentiment distressed.* **[SHOW: CloudWatch]** The deployed
> orchestrator then calls check_balance, decides on apply_hardship on its own,
> and fires a real email through Amazon SES — **[SHOW: the inbox]** — this one.
> Inbound message, classified by AI, reasoned over, answered on the right
> channel, through live Lambdas in one unbroken chain.

---

## CLOSING — the business case (2:50 – 3:05)

**[SCREEN: architecture diagram with the Business Impact box]**

> On a ten-million-dollar past-due book, lifting recovery from twenty to thirty
> percent recovers an extra **one million dollars** — while cutting live-agent
> minutes by seventy percent.
>
> Four AWS Communication Developer Services, one Bedrock agent, fully
> reproducible in CDK, and ready to list on AWS Marketplace. Recovery Agent —
> revenue recovery that customers don't hang up on. Thank you.

---

## Recording Notes
- Resolution 1400×900 or 1080p. 30fps is fine.
- The UI's status strip (Past due → status, SES receipts) visibly tracks progress — keep it in frame.
- For ACT 6, re-run `aws lambda invoke --function-name ra-message-triage ...` on camera and show the real inbox email.
- Record VO separately for clean audio; total target 2:55–3:05.
- No copyrighted music.
