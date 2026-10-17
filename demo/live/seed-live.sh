#!/usr/bin/env bash
# Operator-controlled TEST account only. Does not overwrite accounts, reset protections or pre-verify identities.
set -euo pipefail
: "${AWS_PROFILE:?Use an authorized demo operator profile}"
: "${SEED_ACCOUNT_FILE:?Supply a private DynamoDB JSON item for a controlled TEST- account}"
python3 - "$SEED_ACCOUNT_FILE" <<'PY'
import json,sys
item=json.load(open(sys.argv[1]))
if not item.get('accountId',{}).get('S','').startswith('TEST-'): raise SystemExit('Controlled fixture must use a TEST- account ID')
for key in ['customerId','recipientId']:
    if not item.get(key,{}).get('S'): raise SystemExit('Fixture lacks trusted canonical account binding')
PY
aws dynamodb put-item --table-name ra-accounts --item "file://$SEED_ACCOUNT_FILE" --condition-expression 'attribute_not_exists(accountId)' --profile "$AWS_PROFILE" --region "${AWS_REGION:-us-east-1}"
echo 'New controlled test account created. Complete authenticated enrollment and OTP before live account access.'
