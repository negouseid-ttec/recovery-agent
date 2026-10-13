# Recovery Agent — Video Shot List (~3 min + ~15s live proof)

Record off the three live pages + the live-proof terminal. Screen 1920×1080,
browser fullscreen, VO recorded separately. No copyrighted music.

Pages:
- Demo:          https://d3rtl5b9kojwtc.cloudfront.net/
- Architecture:  https://d3rtl5b9kojwtc.cloudfront.net/architecture.html?clean=1
- Dashboard:     https://d3rtl5b9kojwtc.cloudfront.net/dashboard.html

## SHOT 1 — The problem (0:00–0:22) · demo /?view=guided&frame=2
VO: "Every company that bills customers has two problems that are really one:
their channels are disconnected, and they can't collect. Robocalls recover about
three percent; a live call costs up to twenty-five dollars."

## SHOT 2 — Thesis + connected network (0:22–0:40) · architecture.html (scenes 1–2)
VO: "You're not failing to collect because you lack channels — they're
disconnected. Recovery Agent is the autonomous decision layer that connects them.
Amazon Bedrock recommends the next action."

## SHOT 3 — Policy blocks the AI (0:40–0:58) · architecture.html scene 3  [MONEY SHOT]
Allowed path goes green to SES; opt-out particle visibly STOPS before the channel.
VO: "A deterministic policy engine authorizes every action. Watch: even when the
AI recommends contact, a global opt-out stops the message before it reaches a
channel. The model can never override policy."

## SHOT 4 — Guided recovery (0:58–1:40) · demo /?view=guided (advance with →)
Dana: Email → 3 days later → SMS → RCS card → WhatsApp (reply) → hardship → payment;
agent-intelligence panel visible each step.
VO: "One account, one continuous thread. Cheapest channel first, escalating only
on silence. When Dana says she lost her job, the agent detects hardship, pauses
fees, and offers a plan she can afford — twenty-eight dollars now, fifty-six
scheduled. It never pushes."

## SHOT 5 — Decision log (1:40–2:05) · dashboard.html
Scroll tiles + table; point at a LIVE-CAPTURED row and the reason-code bars.
VO: "Every decision is explainable and recorded. This dashboard reads the real
decision log on DynamoDB — the signals, what Bedrock recommended, how policy
ruled, what executed, and the cost. These are real records from the deployed
system."

## SHOT 6 — Decision Lab (2:05–2:25) · demo /?view=lab
Toggle Global opt-out → BLOCKED; drag days/balance → channel changes.
VO: "You can test it yourself: flip opt-out and the engine blocks outbound; change
the account and the recommended channel changes. Deterministic, running right here."

## SHOT 7 — Live proof on AWS (2:25–2:50) · terminal + cut to dashboard
Run ./demo/live/phase1-proof.sh — show source:"model", one ALLOWED/dispatched,
one blocked/GLOBAL_OPT_OUT.
VO: "And it's running on AWS right now — Nova 2 Lite recommends live, the policy
engine blocks the opted-out account, the decision lands in the audit log. Four
AWS Communication Developer Services, one Bedrock agent, reproducible in CDK."
Fallback if SSO lapses: narrate over the dashboard's LIVE-CAPTURED rows (same real result).

## SHOT 8 — Hero close (2:50–3:00) · architecture.html scene 7
VO: "Recovery Agent. Your channels deliver messages — we decide what happens
next. Thank you."

## Tips
- Advance demo frames on the voice beat; "N days later" cards are quick.
- ?clean=1 hides controls; ?scene=3 to rehearse the block shot; ?nofx=1 kills the grid.
- Keep ≤ 3:00 — front-load shots 1–3; judges may stop at three minutes.
