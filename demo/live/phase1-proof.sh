#!/usr/bin/env bash
set -euo pipefail

PROFILE="${AWS_PROFILE:-vf-dev-team5}"
REGION="${CDK_DEFAULT_REGION:-us-east-1}"
ACCOUNT_ID="ACCT-TEL-80231"
export AWS_PROFILE="$PROFILE" CDK_DEFAULT_REGION="$REGION"
cd "$(dirname "$0")/../.."

echo "== 0. deploy =="
npx cdk deploy RecoveryAgent-Data RecoveryAgent-Agent --require-approval never

echo "== 1. opt the account out =="
aws dynamodb update-item --table-name ra-accounts \
  --key "{\"accountId\":{\"S\":\"$ACCOUNT_ID\"}}" \
  --update-expression 'SET optedOut = :t' \
  --expression-attribute-values '{":t":{"BOOL":true}}' \
  --profile "$PROFILE" --region "$REGION"

echo "== 2. invoke proactive outreach =="
aws lambda invoke --function-name ra-proactive-outreach \
  --payload '{}' --cli-binary-format raw-in-base64-out \
  /tmp/ra-outreach.json --profile "$PROFILE" --region "$REGION" >/dev/null
cat /tmp/ra-outreach.json
echo

echo "== 3. decision audit log =="
aws dynamodb scan --table-name ra-decision-log --max-items 5 \
  --profile "$PROFILE" --region "$REGION" \
  --query 'Items[].{id:decisionId.S,account:accountId.S,executed:executedAction.S,result:executionResult.S,policy:policyDecision.M.reasonCode.S}' \
  --output table

echo "== 4. issue an OTP =="
aws lambda invoke --function-name ra-identity-verification \
  --payload '{"action":"issue","channel":"sms","identifier":"+14254147755","customerId":"CUST-DEMO"}' \
  --cli-binary-format raw-in-base64-out /tmp/ra-issue.json \
  --profile "$PROFILE" --region "$REGION" >/dev/null
cat /tmp/ra-issue.json
echo

echo "== 5. restore the account =="
aws dynamodb update-item --table-name ra-accounts \
  --key "{\"accountId\":{\"S\":\"$ACCOUNT_ID\"}}" \
  --update-expression 'SET optedOut = :f' \
  --expression-attribute-values '{":f":{"BOOL":false}}' \
  --profile "$PROFILE" --region "$REGION"

echo "== done =="
