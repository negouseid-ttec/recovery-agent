#!/usr/bin/env bash
# Seed the live demo account + conversation before filming the live-proof.
# Resets Dana's account to past_due so the hardship decision is fresh on camera.
set -euo pipefail
AWS="$(command -v aws || echo /usr/local/bin/aws)"
PROFILE="${AWS_PROFILE:-vf-dev-team5}"
REGION="${AWS_REGION:-us-east-1}"
RECIPIENT="${RECIPIENT:-negou.seid@ttecdigital.com}"

"$AWS" dynamodb put-item --table-name ra-accounts --profile "$PROFILE" --region "$REGION" --item "{
  \"accountId\":{\"S\":\"ACCT-TEL-80231\"},\"recipientId\":{\"S\":\"$RECIPIENT\"},
  \"customerName\":{\"S\":\"Dana Whitfield\"},\"productType\":{\"S\":\"bundle\"},
  \"pastDueCents\":{\"N\":\"8400\"},\"totalBalanceCents\":{\"N\":\"15200\"},
  \"daysPastDue\":{\"N\":\"32\"},\"suspensionDate\":{\"S\":\"2026-10-16\"},
  \"status\":{\"S\":\"past_due\"},\"monthlyChargeCents\":{\"N\":\"6800\"} }"

"$AWS" dynamodb put-item --table-name ra-conversations --profile "$PROFILE" --region "$REGION" --item "{
  \"recipientId\":{\"S\":\"$RECIPIENT\"},\"sessionId\":{\"S\":\"ra-film-001\"},
  \"preferredChannel\":{\"S\":\"email\"},
  \"channels\":{\"L\":[{\"M\":{\"channel\":{\"S\":\"email\"},\"address\":{\"S\":\"$RECIPIENT\"}}}]},
  \"language\":{\"S\":\"en-US\"},\"history\":{\"L\":[]},
  \"accountIds\":{\"L\":[{\"S\":\"ACCT-TEL-80231\"}]},
  \"createdAt\":{\"S\":\"2026-09-01T00:00:00Z\"},\"updatedAt\":{\"S\":\"2026-10-06T00:00:00Z\"},
  \"ttl\":{\"N\":\"9999999999\"} }"

echo "Seeded ACCT-TEL-80231 (past_due) + conversation for $RECIPIENT"
