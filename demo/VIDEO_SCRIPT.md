> Hardening revision: guided journey outcomes are illustrative. A $28 initial payment is an agreed arrangement, not provider-confirmed collection. Queued messages are not delivered, and pending human review does not prove specialist notification. Historical footage may precede this revision; use current audit evidence for live claims.

# Recovery Agent — Demo Video Script (~3 min)
### Angle: one connected agentic network that fixes a *disconnect* problem AND a *collection* problem

> Record the 14-frame story demo full-screen (`http://127.0.0.1:8080/`, advance with
> Next / →), then cut to the integration diagram and the live-proof terminal.
> **VO is recorded separately** over a steady run — read the quoted lines verbatim,
> adjust only to sound natural. Target ≤ 3:00. 1080p. No copyrighted music.
>
> Honesty guardrail: everything shown is real (cross-channel thread, live SES).
> Amazon Connect appears only as an **architecture node + one narration line** — it is
> described as an integration path, never shown as a running call. Do not imply it's live.

Frame-advance cue: **[→]** = click Next / press right-arrow. **[SCREEN: …]** = what's on screen.

---

## BEAT 1 — The two problems (0:00 – 0:22)
**[SCREEN: Frame 1 Title, then Frame 2 Problem]**

> "Every company that bills customers has two problems — and they're actually the
> same problem. The first is a **disconnect** problem: they have SMS, email, a
> contact center — but those channels don't talk to each other. A customer replies
> by text, then gets a cold, context-free email the next day. Behind the scenes it's
> held together with manual, kludgy hand-offs. The second is a **collection**
> problem: past-due revenue they can't recover. Robocalls recover about three
> percent. A live-agent call costs five to twenty-five dollars and usually reaches
> voicemail. Industry-wide, collections recover about eleven cents on the dollar." **[→]**

## BEAT 2 — The thesis (0:22 – 0:35)
**[SCREEN: Frame 2 → 3 (Meet Dana)]**

> "Here's the insight: you're not failing to collect because you lack channels.
> You're failing because your channels are **disconnected**. So we connected them —
> into one agentic network that shares a single, continuous thread for each customer.
> Watch it work on one account. Dana is eighty-four dollars past due, thirty-two days
> overdue, service suspends in ten days." **[→]**

## BEAT 3 — One connected thread, Day 0 Email (0:35 – 0:48)
**[SCREEN: Frame 4 Email]**

> "The network opens on the cheapest channel — email, through Amazon SES, about
> one-hundredth of a cent. Nothing to lose. And every touch from here lives on **one
> thread** — the agent never forgets what's already been said." **[→]**

## BEAT 4 — Escalate on silence: SMS (0:48 – 1:02)
**[SCREEN: Frame 5 "3 DAYS LATER" → Frame 6 SMS]**

> "Three days, no reply. The agent escalates — same thread — to SMS, through AWS End
> User Messaging. It isn't blasting every channel at once; it's climbing a
> cost-ordered ladder, escalating only on silence." **[→] [→]**

## BEAT 5 — RCS, branded (1:02 – 1:18)
**[SCREEN: Frame 7 "4 DAYS LATER" → Frame 8 RCS]**

> "Still quiet. Next rung — RCS, also AWS End User Messaging. Now it's branded: a
> verified sender, a rich card with the balance and a tap-to-pay button, read
> receipts. Same conversation, richer surface. And if the phone can't render RCS, it
> falls back to SMS automatically." **[→] [→]**

## BEAT 6 — WhatsApp, and Dana replies (1:18 – 1:38)
**[SCREEN: Frame 9 "3 DAYS LATER" → Frame 10 WhatsApp]**

> "Day ten. Only now does the network reach for the richest, most personal channel —
> WhatsApp, through AWS End User Messaging Social. It's the priciest, so it's reserved
> for accounts worth the touch. And this time Dana replies: *I just lost my job, money
> is really tight.* Because it's one connected thread, the agent already knows her
> whole history — nothing is repeated." **[→]**

## BEAT 7 — The agent reasons and acts (1:38 – 1:58)
**[SCREEN: Frame 11 Hardship — apply_hardship]**

> "This is the moment that separates an agent from a dialer. It doesn't push. It
> detects hardship, pauses the late fees and the suspension, and offers a plan she can
> actually afford — three payments of twenty-eight dollars. Compliance and empathy,
> encoded as behavior." **[→]**

## BEAT 8 — Resolution (1:58 – 2:12)
**[SCREEN: Frame 12 Payment — record_payment]**

> "Dana pays the first twenty-eight dollars. The agent records it, emails a receipt,
> and keeps her service on. Past-due to an active plan — revenue recovered, customer
> retained." **[→]**

## BEAT 9 — The connected network (2:12 – 2:34)
**[SCREEN: cut to the integration / architecture diagram — docs/architecture-integration.png]**

> "Step back and here's the whole network — one system on AWS. Four messaging
> channels, a Bedrock agent reasoning over every reply, and one DynamoDB thread that
> ties it together. The channels are finally connected. And because it's native AWS,
> it hands that same thread to an existing **Amazon Connect** contact center — so when
> a customer calls in, the live agent sees the entire conversation. No bolted-on point
> solution; the workload stays on Amazon." **[→ cut to cost/success]**

## BEAT 10 — The dollars (2:34 – 2:50)
**[SCREEN: Frame 13 Cost ledger → Frame 14 Success]**

> "What did the whole journey cost? Email, SMS, RCS, WhatsApp — four channels, ten
> days, one agent. About five cents. Eighty-four dollars recovered for a nickel —
> versus five to twenty-five dollars for a single live-agent call. At scale, on a
> ten-million-dollar past-due book, that's seven figures recovered *and* a twenty-five
> to thirty-five percent cut in cost-to-collect — while keeping customers." **[→ cut to live proof]**

## BEAT 11 — Live proof (2:50 – 3:05)
**[SCREEN: terminal running demo/live/live-proof.sh, then the real inbox]**

> "And it's running on AWS right now. A hardship message hits the deployed Lambda;
> Amazon Bedrock — Nova 2 Lite — classifies it. The agent decides on its own, applies
> the hold, writes the email, and sends it through Amazon SES. There's the message in
> the inbox. One connected agentic network — reproducible in CDK, ready for AWS
> Marketplace. Thank you."

---

## Recording notes
- **Open on the pain, not the product.** The two-problems open is the hook — don't rush it.
- Full-screen the story (hide browser chrome); `?nofx=1` for crisp frames, `?autoplay=1` for a hands-free run.
- The "N days later" cards are transitions (~1.5s) — the story + network + cost beats get the time.
- **Connect is a claim, not a demo** — it appears only on the diagram with one narration line. Never show a fake call.
- Live proof: `bash demo/live/seed-live.sh` then `bash demo/live/live-proof.sh`; show the real inbox email.
- If a technical judge drills in, architecture is four single-concept pages in `docs/`: runtime, decision engine, agent tools, integration (the connected network).
- Keep it ≤ 3:00 of story + ~15s live proof. Clean VO recorded separately. No copyrighted music.

## Why this angle (for your own reference)
- Opens on a practitioner-confirmed pain (channel disconnect + collection) rather than "here's my app" — stronger for the BD/GTM-heavy panel.
- The *continuity* is shown for real (one thread across channels); Connect is positioned honestly as the next node, not faked.
- Lands Value/Impact (dollars) and Creativity (the connected-network thesis) without inventing numbers — sources: CFPB, ACA International, Gartner, Deloitte (2025).

---

# 45-SECOND TEASER CUT
### For a social post, an email to Quincy/Josh, or a hook before the full video

> Same honesty guardrails: real cross-channel thread + live SES only; Connect is one
> spoken line, never a faked call. ~45s at a natural pace (~110 words). Grab 5 quick
> screen clips — no need to run the whole 14-frame story.

**[SCREEN: Frame 2 Problem] (0:00 – 0:10)**
> "Every company that bills customers has two problems that are really one: their
> channels are **disconnected**, and they can't **collect**. Robocalls recover three
> percent; a live call costs up to twenty-five dollars." **[cut]**

**[SCREEN: quick montage — Frames 4, 6, 8, 10 (Email→SMS→RCS→WhatsApp), ~1s each] (0:10 – 0:24)**
> "Recovery Agent connects them — one agentic network, one continuous thread per
> customer. It escalates on silence, cheapest channel first, and stops the moment the
> customer engages." **[cut]**

**[SCREEN: Frame 11 Hardship → Frame 12 Payment] (0:24 – 0:36)**
> "When someone's in hardship, it doesn't push — it pauses fees and sets a plan they
> can afford. Then it takes the payment." **[cut]**

**[SCREEN: Frame 14 Success] (0:36 – 0:45)**
> "Eighty-four dollars recovered for about a nickel — native on AWS, hands off to your
> Amazon Connect contact center, running live today."

**On-screen end card (text, no VO):** `Recovery Agent · AWS CDS + Bedrock · github.com/negouseid-ttec/recovery-agent`

### Teaser recording notes
- No live-proof terminal needed here — the teaser is a hook; the full video carries the proof.
- If you want it even tighter (~30s), drop the hardship beat and go Problem → connect → recovered.
- Keep the same VO voice/tone as the full cut so they feel like one piece.

