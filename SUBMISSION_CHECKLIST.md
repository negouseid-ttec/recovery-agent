# Recovery Agent — evidence-based submission checklist

This checklist supersedes historical deployment assertions. Checked means verified in the local hardening run; it does not imply an AWS deployment.

- [x] Latest `main` inspected at base commit `ca30689`.
- [x] Dedicated `fix/final-technical-hardening` branch.
- [x] Production session validation uses hashed opaque capabilities and atomic consumption.
- [x] Initial enrollment is bound to trusted operator-authenticated account data.
- [x] Separate single-use OTP authorization; caller-controlled policy bypass removed.
- [x] Central production tool ownership checks, including disputes, receipts and escalation.
- [x] Explicit queued/provider-accepted/delivered/blocked/failed audit semantics and dashboard provenance separation.
- [x] Actual persisted pending escalation; no unearned notification or response-time claims.
- [x] CI workflow added for build, coverage and offline CDK synthesis.
- [x] Handler-level adverse-path tests added; see final local results in `docs/HARDENING.md`.
- [x] README distinguishes implementation, illustrative scenarios, historical captures and unverified integrations.
- [x] Existing three static interfaces retained.
- [ ] GitHub Actions run observed passing on the remote branch.
- [ ] CDK changes deployed and IAM permissions verified against real AWS services.
- [ ] Trusted account customer IDs migrated/backfilled and identity enrollment completed.
- [ ] Authenticated channel adapters and provider onboarding tested (SMS, RCS, WhatsApp, SES as applicable).
- [ ] A single live correlation traced from Bedrock through provider response, with evidence archived safely.
- [ ] Real provider delivery callback integration configured and verified.
- [ ] Internal human-review operations staffed and notification retry/reconciliation approved.
- [ ] Payment provider connected (no actual payment collection claimed before this).
- [ ] Public video/UI URLs supplied and tested; video claims checked against current implementation.
- [ ] Submission eligibility, deadline, partner registration and opportunity information independently confirmed by entrant; private IDs excluded from public files.
