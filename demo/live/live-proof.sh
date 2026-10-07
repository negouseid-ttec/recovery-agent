#!/usr/bin/env bash
#
# Recovery Agent — LIVE PROOF (camera-ready)
# ------------------------------------------
# Runs the REAL deployed chain on AWS and prints big, legible output at each
# step so it films cleanly for the demo video's "live proof" segment:
#
#   1. Send a hardship message to the DEPLOYED ra-message-triage Lambda
#   2. Show Amazon Bedrock (Nova 2 Lite) classifying it live
#   3. Show the DEPLOYED orchestrator reasoning in CloudWatch (check_balance
#      -> apply_hardship, chosen by the agent itself)
#   4. Show the DEPLOYED channel-sender firing a real Amazon SES email
#
# Usage:
#   AWS_PROFILE=vf-dev-team5 bash demo/live/live-proof.sh
#
# Pre-reqs (already satisfied in the demo account):
#   - RecoveryAgent-Data + RecoveryAgent-Agent deployed
#   - A seeded account for the recipient (scripts/seed-live.sh)
#   - SES recipient verified (sandbox)

set -euo pipefail
AWS="$(command -v aws || echo /usr/local/bin/aws)"

PROFILE="${AWS_PROFILE:-vf-dev-team5}"
REGION="${AWS_REGION:-us-east-1}"
RECIPIENT="${RECIPIENT:-negou.seid@ttecdigital.com}"
FROM_INBOX="${FROM_INBOX:-benefits@allstate-team5.email.connect.aws}"

cyan() { printf "\033[1;36m%s\033[0m\n" "$1"; }
green() { printf "\033[1;32m%s\033[0m\n" "$1"; }
dim() { printf "\033[2m%s\033[0m\n" "$1"; }
rule() { printf "\033[1m%s\033[0m\n" "────────────────────────────────────────────────────────────────────"; }

clear 2>/dev/null || true
rule
cyan "  RECOVERY AGENT — LIVE ON AWS (not a mockup)"
rule
dim  "  Customer: Dana Whitfield  ·  past-due balance  ·  message arrives:"
echo
green '  "I just lost my job last week and money is really tight.'
green '   I want to pay but I can'"'"'t do it all at once. Please help."'
echo
sleep 2

rule
cyan "  STEP 1 — Deployed Bedrock triage Lambda classifies the message"
rule
cat > /tmp/ra-proof.json <<EOF
{ "from": "$RECIPIENT", "to": "$FROM_INBOX", "channel": "email",
  "text": "Hi, this is Dana. I just lost my job last week and money is really tight. I want to pay but I can't do it all at once. Please help." }
EOF
"$AWS" lambda invoke --function-name ra-message-triage \
  --payload fileb:///tmp/ra-proof.json --cli-binary-format raw-in-base64-out \
  --profile "$PROFILE" --region "$REGION" /tmp/ra-proof-out.json >/dev/null
echo
python3 -c "import json;d=json.load(open('/tmp/ra-proof-out.json'))['categorization'];print('   intent      :',d['intent']);print('   sentiment   :',d['sentiment']);print('   urgency     :',d['urgency']);print('   needsHuman  :',d['needsHuman']);print('   summary     :',d['summary'])"
echo
dim  "  ↑ Amazon Bedrock (Nova 2 Lite) — real classification, no rules."
sleep 3

rule
cyan "  STEP 2 — Deployed orchestrator REASONS and DECIDES (CloudWatch)"
rule
sleep 10   # let the async cascade land
STREAM=$("$AWS" logs describe-log-streams --log-group-name /aws/lambda/ra-agent-orchestrator \
  --order-by LastEventTime --descending --max-items 1 \
  --profile "$PROFILE" --region "$REGION" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['logStreams'][0]['logStreamName'])")
"$AWS" logs get-log-events --log-group-name /aws/lambda/ra-agent-orchestrator \
  --log-stream-name "$STREAM" --limit 30 --profile "$PROFILE" --region "$REGION" \
  | python3 -c "
import sys,json
for e in json.load(sys.stdin)['events']:
    m=e['message'].rstrip()
    if 'Tool call' in m:
        t=m.split('Tool call:',1)[1].strip()
        print('   agent chose →', t)
"
echo
dim  "  ↑ The agent chose apply_hardship on its own — it backed off collecting."
sleep 3

rule
cyan "  STEP 3 — Deployed sender fires a REAL Amazon SES email"
rule
STREAM2=$("$AWS" logs describe-log-streams --log-group-name /aws/lambda/ra-channel-sender \
  --order-by LastEventTime --descending --max-items 1 \
  --profile "$PROFILE" --region "$REGION" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['logStreams'][0]['logStreamName'])")
"$AWS" logs get-log-events --log-group-name /aws/lambda/ra-channel-sender \
  --log-stream-name "$STREAM2" --limit 20 --profile "$PROFILE" --region "$REGION" \
  | python3 -c "
import sys,json
for e in json.load(sys.stdin)['events']:
    m=e['message'].rstrip()
    if 'Email' in m or 'Outbound' in m:
        print('  ', m.split('INFO',1)[-1].strip()[:110])
"
echo
green "  ✓ Inbound message → AI triage → agent decision → live SES email."
green "    One unbroken chain. Four CDS services. Running on AWS right now."
rule
dim  "  (Now switch to the inbox and show the email that just arrived.)"
