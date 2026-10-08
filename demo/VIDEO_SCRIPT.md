# Recovery Agent — Demo Video Script (~3 minutes)

> Record the story demo full-screen (`http://127.0.0.1:8080/`), advancing one
> frame per narration beat with **Next / →**. 14 frames. Then cut to the
> live-proof segment (`demo/live/live-proof.sh` + the real inbox). Lead with the
> dollar problem; let the architecture be the proof, not the pitch.

Frame-advance cue: **[→]** means click Next / press the right-arrow to the next frame.

---

## FRAME 1 — Title (0:00 – 0:08)
> This is a recovery story — how an agentic AI recovers past-due revenue through
> conversation, on the cheapest channel that works, and knows when to stop. **[→]**

## FRAME 2 — The Problem (0:08 – 0:28)
> Telecom carriers are bleeding past-due revenue. Automated robocalls recover
> about three percent — customers ignore them. Live-agent calls cost five to
> twenty-five dollars each and mostly reach voicemail. Industry-wide, collections
> recover only about eleven cents on the dollar. Chasing harder costs more and
> drives customers to churn. **[→]**

## FRAME 3 — Meet Dana (0:28 – 0:40)
> Here's one account. Dana is eighty-four dollars past due, thirty-two days
> overdue, and her service pauses in ten days. The carrier hands it to Recovery
> Agent. **[→]**

## FRAME 4 — Email, Day 0 (0:40 – 0:52)
> The agent's first touch is **email** — through Amazon SES, about one-hundredth
> of a cent. Cheapest channel first; nothing to lose. **[→]**

## FRAME 5 — "3 DAYS LATER" (0:52 – 0:57)
> *(let the card sit a beat)* Three days later — email unopened, no reply. **[→]**

## FRAME 6 — SMS, Day 3 (0:57 – 1:10)
> Silence triggers the ladder. The agent escalates to **SMS** via AWS End User
> Messaging — higher reach, read fast, a bit pricier. **[→]**

## FRAME 7 — "4 DAYS LATER" (1:10 – 1:15)
> Four more days. Still silent. **[→]**

## FRAME 8 — RCS, Day 7 (1:15 – 1:35)
> Next rung: **RCS**, also AWS End User Messaging. Now it's branded — a verified
> sender, a rich card with the balance, tap-to-pay and payment-plan buttons, read
> receipts. And if the phone can't render RCS, it falls back to SMS automatically.
> Richer, more actionable — the right step given the silence. **[→]**

## FRAME 9 — "3 DAYS LATER" (1:35 – 1:40)
> Three more days. No tap, no reply. **[→]**

## FRAME 10 — WhatsApp, Day 10 (1:40 – 1:58)
> Day ten, severely overdue. Now — and only now — the agent escalates to the
> richest, most personal channel: **WhatsApp**, via AWS End User Messaging Social.
> It's the priciest, so it's reserved for accounts worth the touch. And this time,
> Dana replies: *"I just lost my job, money is really tight."* **[→]**

## FRAME 11 — Hardship: the agent reasons & acts (1:58 – 2:18)
> This is the moment that separates an agent from a dialer. It doesn't push. It
> detects hardship, pauses the late fees and the suspension, and offers a plan she
> can actually afford — three payments of twenty-eight dollars. Compliance and
> empathy, encoded as behavior. **[→]**

## FRAME 12 — Payment: resolved (2:18 – 2:32)
> Dana pays the first twenty-eight dollars. The agent records the payment, emails
> a receipt, and keeps her service on. Past-due to an active plan — revenue
> recovered, customer retained. **[→]**

## FRAME 13 — What did it cost? (2:32 – 2:42)
> Add it up: email, SMS, RCS, WhatsApp — four channels, ten days, one AI agent.
> About five cents. **[→]**

## FRAME 14 — The result (2:42 – 2:55)
> Eighty-four dollars recovered for a nickel — versus five to twenty-five dollars
> for a single live-agent call. At scale, on a ten-million-dollar past-due book,
> that's seven figures in recovered revenue *and* a twenty-five to thirty-five
> percent cut in cost-to-collect — while keeping customers. **[→ cut to live proof]**

---

## LIVE PROOF (2:55 – 3:15)
**[SCREEN: terminal running `demo/live/live-proof.sh`, then the real inbox]**
> And it's running on AWS right now. A hardship message hits the deployed triage
> Lambda; Amazon Bedrock — Nova 2 Lite — classifies it *hardship, distressed*. The
> deployed orchestrator decides on its own — checks the balance, applies the
> hardship hold, writes an empathetic email — and fires it through Amazon SES.
> There's the message in the inbox. Four AWS Communication Developer Services, one
> Bedrock agent, reproducible in CDK, ready for AWS Marketplace. Thank you.

---

## Recording notes
- Full-screen the story (hide the browser chrome). Advance on the beat; the
  "N days later" cards are deliberately quick.
- `?autoplay=1` auto-advances every ~2.6s if you'd rather narrate over a hands-free run.
- For the live-proof segment: `bash demo/live/seed-live.sh` then
  `bash demo/live/live-proof.sh`, and show the real inbox email.
- Keep it under 3:00 of story + ~15s live proof. 1080p. Clean VO recorded separately. No copyrighted music.
