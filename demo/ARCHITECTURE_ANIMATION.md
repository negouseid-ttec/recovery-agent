# Architecture Animation — `demo/web/architecture.html`

A cinematic, looping SVG architecture animation of Recovery Agent, built for a
1920×1080 screen recording in the hackathon video. Standalone HTML/CSS/SVG/JS —
no build step, no external deps. Does not modify any backend or `index.html`.

## Local preview
```bash
cd ~/recovery-agent
python3 -m http.server 8899 --bind 127.0.0.1 --directory demo/web
# open http://127.0.0.1:8899/architecture.html
```
The stage is a fixed 1920×1080 canvas auto-scaled to fit the window — record at
1920×1080 for 1:1 pixels.

## Recording URL parameters
- `?autoplay=1` — start playing immediately
- `?scene=3` — start at scene N (1–7)
- `?speed=0.5` — playback speed (0.5 / 1 / 1.5)
- `?clean=1` — hide all recording controls (clean capture)
- `?loop=1` — loop back to scene 1 at the end
- `?nofx=1` — disable the decorative animated grid (keep the architecture)

Clean recording example: `architecture.html?clean=1&autoplay=1&loop=1`

## Keyboard shortcuts
- Space — play / pause
- → / ← — next / previous scene
- `h` — toggle the control panel
- `⛶` button — fullscreen

## Scenes (≈60s loop)
1. **The challenge** — the $84 past-due account + context nodes light; "Every overdue account presents a decision."
2. **Intelligence activates** — Recovery Agent wakes; Bedrock/Nova function lights; OBSERVE → REASON → RECOMMEND; illustrative "Contact · Email" (labeled not-live-inference).
3. **Policy validation** — AI recommendation enters the deterministic policy engine. Allowed example → green to SES. Then an **opt-out** example where the particle **visibly stops before the channel**: "POLICY: BLOCKED — GLOBAL_OPT_OUT". The AI cannot override policy.
4. **Omnichannel orchestration** — one channel illuminates per decision: Email, then (later) SMS, RCS, WhatsApp — **one at a time, never simultaneously**.
5. **Customer response** — a response travels back along the feedback loop; "Intent: Payment plan"; the real tool belt (offer_payment_plan / apply_hardship / log_dispute / escalate_to_human).
6. **Resolution & audit** — "$84 past due → payment plan accepted · No payment captured by agent" (the "$28 paid" figure is explicitly a scenario assumption, not an AWS-confirmed payment). Decision-audit node lights: "Every decision is explainable."
7. **Hero** — full network revealed; "RECOVERY AGENT — Your channels deliver messages. We decide what happens next." Fades back to loop.

## Accuracy / honesty notes
- Only the four real AWS CDS services appear: Amazon SES, AWS End User Messaging (SMS + RCS), AWS EUM Social (WhatsApp), plus Amazon Bedrock (Nova 2 Lite) and Amazon DynamoDB.
- Only real tools are shown; there is no `record_payment` and no payment-capture claim.
- Bedrock recommendations are labeled illustrative, not live inference.
- The policy-block particle never reaches a channel node (verify in scene 3).

## Reduced motion
Honors `prefers-reduced-motion`: the grid drift and the agent halo breathing are disabled; scene content still plays.
