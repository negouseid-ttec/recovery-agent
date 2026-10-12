#!/usr/bin/env bash
set -euo pipefail

PROFILE="${AWS_PROFILE:-vf-dev-team5}"
REGION="${CDK_DEFAULT_REGION:-us-east-1}"
ACCOUNT_ID="${PROOF_ACCOUNT_ID:-ACCT-A}"
export AWS_PROFILE="$PROFILE" CDK_DEFAULT_REGION="$REGION"
cd "$(dirname "$0")/../.."

echo "== 0. deploy =="
npx cdk deploy RecoveryAgent-Data RecoveryAgent-Agent --require-approval never

echo "== 1. reset $ACCOUNT_ID to a fresh, contactable past_due (clear prior outreach + opt-out) =="
aws dynamodb update-item --table-name ra-accounts \
  --key "{\"accountId\":{\"S\":\"$ACCOUNT_ID\"}}" \
  --update-expression 'SET #s = :pd, optedOut = :f, attemptsWithoutResponse = :z, outreachCountWindow = :z REMOVE lastOutreachAt, lastOutreachDayKey' \
  --expression-attribute-names '{"#s":"status"}' \
  --expression-attribute-values '{":pd":{"S":"past_due"},":f":{"BOOL":false},":z":{"N":"0"}}' \
  --profile "$PROFILE" --region "$REGION"

echo "== 2. baseline: invoke outreach — $ACCOUNT_ID should be ALLOWED/dispatched =="
aws lambda invoke --function-name ra-proactive-outreach \
  --payload '{}' --cli-binary-format raw-in-base64-out \
  /tmp/ra-baseline.json --profile "$PROFILE" --region "$REGION" >/dev/null
python3 -c "import json;d=json.load(open('/tmp/ra-baseline.json'));print([r for r in d['results'] if r['accountId']=='$ACCOUNT_ID'])"

echo "== 3. opt $ACCOUNT_ID out, clear the interval guard =="
aws dynamodb update-item --table-name ra-accounts \
  --key "{\"accountId\":{\"S\":\"$ACCOUNT_ID\"}}" \
  --update-expression 'SET optedOut = :t REMOVE lastOutreachAt, lastOutreachDayKey' \
  --expression-attribute-values '{":t":{"BOOL":true}}' \
  --profile "$PROFILE" --region "$REGION"

echo "== 4. invoke outreach again — $ACCOUNT_ID MUST be blocked GLOBAL_OPT_OUT even though the AI would contact =="
aws lambda invoke --function-name ra-proactive-outreach \
  --payload '{}' --cli-binary-format raw-in-base64-out \
  /tmp/ra-optout.json --profile "$PROFILE" --region "$REGION" >/dev/null
python3 -c "import json;d=json.load(open('/tmp/ra-optout.json'));print([r for r in d['results'] if r['accountId']=='$ACCOUNT_ID'])"

echo "== 5. decision audit log =="
aws dynamodb scan --table-name ra-decision-log \
  --profile "$PROFILE" --region "$REGION" \
  --query 'Items[].{id:decisionId.S,account:accountId.S,executed:executedAction.S,policy:policyDecision.M.reasonCode.S,result:executionResult.S}' \
  --output table

echo "== 6. OTP issue =="
aws lambda invoke --function-name ra-identity-verification \
  --payload '{"action":"issue","channel":"sms","identifier":"+14254147755","customerId":"CUST-DEMO"}' \
  --cli-binary-format raw-in-base64-out /tmp/ra-issue.json \
  --profile "$PROFILE" --region "$REGION" >/dev/null
cat /tmp/ra-issue.json
echo

echo "== 7. restore $ACCOUNT_ID (contactable) =="
aws dynamodb update-item --table-name ra-accounts \
  --key "{\"accountId\":{\"S\":\"$ACCOUNT_ID\"}}" \
  --update-expression 'SET optedOut = :f' \
  --expression-attribute-values '{":f":{"BOOL":false}}' \
  --profile "$PROFILE" --region "$REGION"

echo "== done =="
