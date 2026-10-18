# Final technical hardening — review and operator guide

Base: latest inspected `main` at `ca30689`. Branch: `fix/final-technical-hardening`. No deployment, outbound AWS call, payment collection, or remote CI execution was performed during this task.

## Phase-by-phase file inventory

| Phase | Production / configuration / documentation files |
|---|---|
| 1 — identity | `lib/shared/verified-session.ts`, `lib/shared/identity-verification.ts`, `lib/lambda/identity-verification/index.ts`, `scripts/provision-enrollment.ts`, Data/Agent CDK stacks, `bin/app.ts`, identity tests |
| 2 — final sender | `lib/lambda/channel-sender/index.ts`, new `lib/lambda/otp-sender/index.ts`, outbound contracts in `lib/shared/types.ts`, all orchestrator/receipt/outreach callers, verified channel destination resolution, Agent CDK IAM |
| 3 — ownership | `lib/lambda/agent-orchestrator/tools.ts`, orchestrator identity context, plan transaction and account conditional writes; handler adversarial tests |
| 4 — execution evidence | `lib/shared/outbound-execution.ts`, proactive handler, sender, delivery adapter, decision types/logging, `demo/web/audit-view.js`, dashboard, converter and rendering tests |
| 5 — human review | production escalation tool, support configuration/IAM and handler tests; pending tickets stored in existing plans table |
| 6 — CI | `.github/workflows/ci.yml`, offline CDK account fallback, Node 22 runtime constructs |
| 7 — tests | `test/identity-verification.test.ts`, `test/handlers-hardening.test.ts`, `test/audit-view.test.ts`, `test/dashboard-script.test.ts`, `test/stacks.test.ts` |
| 8 — claims / instructions | `README.md`, `SUBMISSION_CHECKLIST.md`, this guide, video script/shotlist disclosure, static illustrative labels, revised live-proof scripts |

## Before / after security behavior

- Before: caller-provided `{customerId,expiresAt}` authorized linking. Now: caller must complete OTP on an already verified destination or present a 256-bit opaque token. Its SHA-256 digest, customer, issue/expiry and method are server-side; conditional deletion allows only one linking authorization. Arbitrary initial customer enrollment is rejected.
- Before: OTP attempt updates and deletion were read/write pairs. Now: conditional compare-and-update/delete binds the exact challenge version, code, creation time and attempt count. Correct verification consumes before linking/session minting. Wrong OTP never mints a session.
- Before: `bypassPolicy:true` exempted arbitrary text. Now: the main sender accepts only collection purpose; OTP transport is an independently authorized Lambda, reachable from the verification role only, accepting a one-use capability and stored challenge. No arbitrary text/account detail is accepted by that path.
- Before: account-list membership and recipient strings could authorize tools; dispute writes had no ownership check. Now: verified canonical identity is required centrally, foreign accounts and recipients are denied uniformly, and plan/account acceptance is atomic. Verified alternate channel links remain supported.
- Before: the webhook wrapper was not consistently unwrapped by triage. Now: normalized messages retain their sender/channel/message ID through triage, including deterministic fallback on model errors.
- Before: public POST JSON could spoof a verified inbound address. Now: API Gateway POST methods require IAM. Only a trusted, signature-validating provider adapter/operator may originate normalized messages. No public provider adapter is claimed complete.
- Before: queue acceptance was called dispatched; provider IDs were discarded. Now: an immutable send claim and correlated execution record distinguish recommendation, queueing, policy denial, provider acceptance and configured delivery callbacks. Legacy `dispatched` reads as queued.
- Before: queueing set contact timestamps, potentially making the sender block its own message. Now: queue metadata is separate; the sender atomically reserves contact count/time, checking owner, account state, opt-out and concurrent counter changes before provider invocation. Actual channel checks cover email and explicit RCS-to-SMS fallback.
- Before: human escalation primarily logged and claimed notification. Now: a stable pending ticket is persisted. Missing inbox has an explicit not-configured result; optional SES acceptance is independent. Opt-out state is persisted before confirmation rather than inferred from free-form model reasoning.

## Deployment changes and migration

1. New `ra-verified-sessions` DynamoDB table: `tokenHash` partition key, `ttl` expiration, retained on stack removal, point-in-time recovery. Verification role gets PutItem/DeleteItem only on this table; no ordinary sender/orchestrator session access.
2. Accounts gain `by-customer`. Backfill trusted canonical `customerId` values in accounts and verified identity links before enabling outreach. Existing records without canonical ownership fail closed; do not invent mappings from names or trust `conversation.accountIds` as authorization. Existing legacy synthetic seeds are insufficient for enrollment.
3. New OTP Lambda (`ra-otp-sender`) has challenge GetItem/UpdateItem and provider sends, no account table access. Only the verification role receives its invoke grant. Identity uses `SESSION_TABLE` and `OTP_SENDER_FUNCTION_NAME` and synchronous delivery result. Its timeout now allows the OTP sender to finish.
4. Sender receives `IDENTITY_TABLE` and `DECISION_TABLE`; its contact reservation requires UpdateItem on accounts. Ledger is in `ra-decision-log` under `SEND-<sha256(decisionId)>`. Parent decisions and send records share correlation/source-decision IDs. Dashboard merges execution evidence without counting a parent and its send twice.
5. Delivery adapter ARN is a CDK output. It has UpdateItem on the decision table only. No public URL/invoke grants/subscriptions are added. Operators must validate provider source/authentication, map actual events, and enable only the relevant AWS service integration. Do not invoke synthetic delivery events as live evidence.
6. Pending escalation rows use `ra-plans`, `kind: escalation`, `planId: ESC-...`, canonical customer/account, safe reason code and notification state. `SUPPORT_INBOX` and `SES_FROM_EMAIL` are optional synth-time settings. There is no staff console or service-level promise.
7. All CDK runtime constructs target Node 22 and bundle the locked AWS SDK versions, including the RCS API, rather than relying on the runtime-installed SDK. Public inbound POST now requires AWS_IAM; existing unsigned webhook integrations must be replaced with authenticated adapters. WhatsApp verification GET is retained, but it does not authorize message POSTs.
8. Schedule remains daily after deployment. Review it before deploying into a real book of accounts. `phase1-proof.sh` no longer deploys or clears customer protections.

### IAM review

Synthesized roles were reviewed offline. Lambda invocations target specific function ARNs. Session storage access is confined to the verification function; OTP challenge access is GetItem/UpdateItem only. Sender audit is PutItem/UpdateItem only; delivery adapter is UpdateItem only. Account/plan transactions and canonical-index queries have table-specific grants. Bedrock is restricted to Nova foundation-model and configured inference-profile ARNs. SES is scoped to account/region identities; optional support notifications are also recipient-constrained.

Provider send grants retain wildcard resources **when no origination ARN configuration is supplied**, for compatibility with the existing minimal demo. Set `EUM_ORIGINATION_ARNS` and `WHATSAPP_ORIGINATION_ARN` to restrict them; inspect the synthesized policy with the actual provider resource ARNs before production. Existing CDK table grants are broader than per-operation custom policies for some legacy handlers. Further permission reduction and live access tests remain necessary. No blanket claim of production least privilege is made.

## Invocation contract changes

### Identity

```json
{"action":"issue","channel":"email","identifier":"controlled@example.com","customerId":"CANONICAL_TEST_CUSTOMER","sessionToken":"OPAQUE_CAPABILITY_IF_LINKING_OR_ENROLLING"}
```

`verifiedSession` objects no longer authorize anything. Existing verified channel re-verification needs no token; issuance sends only a fixed OTP to that same verified address. Unknown/unverified initial enrollment requires authenticated provisioning bound to a trusted account:

```sh
AWS_PROFILE=YOUR_DEMO_PROFILE npx ts-node scripts/provision-enrollment.ts YOUR_CONTROLLED_TEST_ACCOUNT email /tmp/enrollment-request.json
aws lambda invoke --function-name ra-identity-verification \
  --payload fileb:///tmp/enrollment-request.json --cli-binary-format raw-in-base64-out /tmp/issue-result.json
# Read the OTP only from the controlled inbox. Create a protected verification JSON locally:
# {"action":"verify","channel":"email","identifier":"CONTROLLED_ADDRESS","code":"RECEIVED_CODE"}
aws lambda invoke --function-name ra-identity-verification \
  --payload fileb:///tmp/verify-request.json --cli-binary-format raw-in-base64-out /tmp/verify-result.json
```

The provisioning operator needs GetItem on trusted accounts and PutItem on sessions. Provisioning uses the account's stored address and customer, not a CLI-supplied customer claim. Request files contain bearer capabilities/PII: owner-only permissions, never commit/log, remove when no longer needed. Production enrollment requires the organization's authenticated account process. Successful verification returns a new 15-minute single-use `session` string for linking another channel. Issue failure/unknown OTP transport is not reported as successful delivery.

### Collection sender

```json
{"purpose":"collection","decisionId":"UNIQUE_SERVER_DECISION","correlationId":"UNIQUE_OUTBOUND_FLOW","accountId":"AUTHORIZED_TEST_ACCOUNT","type":"text","channel":"sms","recipientId":"+15551230001","text":"Authorized account update"}
```

Required purpose and IDs are breaking additions. All in-repository runtime callers are updated. Arbitrary purpose, invalid destination/type and missing IDs are rejected. `bypassPolicy` is ignored for authorization. Destinations require verified canonical links and matching accounts. Account lookup errors, missing identity, holds, caps or contact-reservation races block sends. OTP uses the isolated wrapper, never a purpose field accepted by the collection sender.

### Execution state and safe retry

A proactive parent persists recommendation/policy before async invocation; HTTP 202 records `queued`. A sender-owned record claims once, gates policy, reserves contact, calls AWS and records provider message IDs. API acceptance is not delivered. An IAM-only delivery update requires an already provider-accepted record and matching provider message ID.

Duplicate decision IDs do not call the provider twice. A crash after claim or an uncertain provider result requires manual reconciliation; exactly-once remote delivery is not promised. Known provider acceptance followed by transient audit-write failure retries the audit only. Escalation notification retries reuse the pending ticket only after an explicit provider rejection; unknown/sending states require reconciliation before retry. An uncertain queue may conservatively reserve the day. This prioritizes duplicate suppression over automatic retry availability.

Receipts remain collection-gated, including hardship/dispute restrictions. A general purpose transactional-notification exemption is not implemented. Contact-window expiration/reset aggregation, fully signed provider adapters, provider delivery subscriptions and staffed human operations remain integration work.

## Live verification commands (run only in controlled AWS environment)

```sh
npm run build
AWS_PROFILE=YOUR_DEMO_PROFILE npm run synth -- --all --quiet
AWS_PROFILE=YOUR_DEMO_PROFILE npm run deploy
# Complete the controlled identity enrollment above first.
PROOF_MESSAGE_FILE=/absolute/path/normalized-message.json AWS_PROFILE=YOUR_DEMO_PROFILE bash demo/live/live-proof.sh
aws lambda invoke --function-name ra-proactive-outreach --payload '{}' \
  --cli-binary-format raw-in-base64-out /tmp/outreach-result.json
aws dynamodb scan --table-name ra-decision-log --output json \
  | node demo/tools/declog-to-json.js > /tmp/decisions.json
```

Use a real controlled test address, model access, verified SES identities and configured channel resources. Do not reset opt-outs/holds to force a successful message. Inspect `correlationId`, source decision, policy reason, provider ID and execution state in audit data; inspect actual carrier/inbox evidence separately. A protected/held test should correctly produce no provider call. Do not present an AWS CLI invocation response alone as downstream success.

## Final local verification

Results are recorded below after the final clean install/build/coverage/synthesis run. Local tests mock AWS SDK clients and use fixed clocks. Handler tests exercise actual production policy, validation and orchestration code, not reimplemented business algorithms. Static dashboard script is executed against bundled/mixed audit rows; all three interfaces' inline scripts are syntax checked. Pixel-level browser QA and real carrier/SES callbacks are not claimed.

## PR-ready summary

Secure canonical account linking with server-backed single-use sessions, isolate OTP transport from collection policy, enforce ownership across agent tools, and persist truthful escalation. Add correlated provider execution evidence and safe duplicate suppression, atomic final contact reservation, explicit dashboard provenance, offline CI and adversarial handler tests. Replace unverified deployment/payment/delivery claims with reproducible commands and migration requirements. No AWS deployment or live sends are included.

### Executed results — October 17, 2026

| Check | Actual result |
|---|---|
| `npm ci --no-audit --no-fund` | Passed; 466 locked packages installed. Dependency deprecation notices remain; no dependency upgrades were introduced. |
| `npm run build` | Passed |
| `npm test -- --runInBand --coverage` | Passed: **209 tests, 13 suites** |
| `npm run synth -- --all --quiet` with placeholder account/region and metadata disabled | Passed; all four stacks synthesized offline |
| `bash -n` for three live operator scripts | Passed |
| `git diff --check` | Passed |

Coverage collection includes **all `lib/**/*.ts`**, not only imported modules: **84.04% statements, 85.24% lines, 73.53% branches, 73.55% functions**. The local Node version was **24.5.0**; CI and deployed Lambda target Node 22. Node 22 execution itself has not been observed locally. Coverage HTML/XML/LCOV/JSON summary are local generated artifacts under `coverage/`.

Final synthesized IAM inspection found four wildcard-resource send statements: SMS/RCS and WhatsApp on the normal and OTP senders when provider resource ARN settings are absent. No additional wildcard-resource IAM statements were present in the synthesized stacks. Configure the documented origination ARN settings before production. The new session, OTP challenge, delivery adapter and audit permissions are table/function scoped.

No final local failures remain. Actual DynamoDB conditional races, carrier (SMS/RCS/WhatsApp) delivery, and pixel-level browser validation remain **not executed**. Existing guided demo tests/screen claims are illustrative; no payment was collected.

### Observed live end-to-end trace — October 18, 2026 (vf-dev-team5, us-east-1)

A single decision was traced from recommendation through a real Amazon SES provider acceptance, using the hardened pipeline (deployed with a verified `SES_FROM_EMAIL`). The verified email identity was established through the real OTP round-trip (operator-authenticated enrollment → `issue` → `verify`), not a hand-written link; opt-outs/holds were **not** reset to force a send. The test account was configured email-reachable only (SMS/RCS/WhatsApp opted out), which is the state that legitimately routes first contact to email.

| Stage | Record | Observed value |
|---|---|---|
| OTP issue (identity) | `ra-identity-verification` | `{ issued: true, delivery: "provider_accepted" }` — OTP delivered via SES |
| Verified link created | `ra-identity-links` | `channel=email, customerId=CUST-TRACE, verification=verified` |
| 1. AI recommendation + policy | `DEC-6a91230d-eec5-440c-87ba-f13f2f92b8c8` | `recommendation.channel=email`, `policyDecision=ALLOWED`, `executedAction=contact`, `executionState=queued` |
| 2. Sender provider result | `SEND-c1714f29…6baab` (`sourceDecisionId` → the decision above) | `executionState=provider_accepted`, `evidenceSource=aws_observed`, `providerMessageIds=[010001a14cfcaa18-22f8c8a1-ab04-4e41-9fde-a43e337e8303-000000]` |
| Correlation ID (both rows) | `by-correlation` GSI | `OUT-2b5601f4-f89d-4e31-a8c6-f91e961fb5d7:4e6b8321-744d-43a8-83b8-5a85ac1256a3` |
| Corroboration | `sesv2 get-account` | `SentLast24Hours` incremented (OTP + collection email) |
| Timestamps | sender row | `createdAt 03:09:49.118Z → updatedAt 03:09:49.572Z` (queued → provider_accepted in ~454 ms) |

This proves **Bedrock-eligible recommendation → deterministic policy authorization → real SES provider acceptance with a provider MessageId → correlated audit**, with `queued` and `provider_accepted` recorded as distinct states under one correlation ID. **Delivery** is not asserted: no SES delivery-event subscription is deployed, so the lifecycle stops at `provider_accepted`. Non-email carrier channels (SMS/RCS/WhatsApp) remain sandbox/onboarding-gated and were not sent live.
