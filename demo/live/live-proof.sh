#!/usr/bin/env bash
set -euo pipefail
: "${PROOF_MESSAGE_FILE:?Provide a JSON normalized inbound message for a controlled, verified test identity}"
: "${AWS_PROFILE:?Use a least-privilege demo AWS profile}"
REGION="${AWS_REGION:-us-east-1}"
OUT="$(mktemp -d)"
aws lambda invoke --function-name ra-message-triage --payload "fileb://$PROOF_MESSAGE_FILE" --cli-binary-format raw-in-base64-out --profile "$AWS_PROFILE" --region "$REGION" "$OUT/triage.json"
echo "Triage response (not proof of downstream messaging): $OUT/triage.json"
echo 'After asynchronous execution, export actual decisions. No delivery is asserted by this script.'
aws dynamodb scan --table-name ra-decision-log --profile "$AWS_PROFILE" --region "$REGION" --output json | node demo/tools/declog-to-json.js > "$OUT/decisions.json"
echo "Audit export: $OUT/decisions.json — inspect correlationId, executionState, and providerMessageIds."
