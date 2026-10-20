#!/usr/bin/env bash
# Fail if any customer-facing copy still OFFERS cash on delivery.
#
# A plain `grep -r "COD"` is not usable here: the prepaid messaging itself has to
# say the words ("No cash on delivery", "Safer than cash on delivery", the AI's
# objection-handling block), and `cod` is also a stored enum value in Postgres
# and in order.paymentModel. Those are kept on purpose.
#
# So this greps for the terms, then drops two allowlists:
#   1. negations / objection handling — the copy we want
#   2. internal identifiers — schema enums, code values, legacy-flag comments
# Whatever survives is a genuine COD offer and fails the build.
#
# Usage: bash scripts/audit-cod-copy.sh

set -uo pipefail
cd "$(dirname "$0")/.."

TERMS='cash[- ]on[- ]delivery|\bcod\b|pay[- ]on[- ]delivery|pay cash|cash payment'

# Copy that is supposed to mention COD in order to rule it out.
NEGATIONS='no cash on delivery|no cash-on-delivery|not available|not supported|does not exist|do not offer|we do not|never'
NEGATIONS="$NEGATIONS"'|no cod|without cod|instead of|rather than|safer than|why no|not accepted'
NEGATIONS="$NEGATIONS"'|not cod|not pay-on-delivery|100% prepaid|prepaid escrow or|do you accept'
NEGATIONS="$NEGATIONS"'|answering a buyer|stop|legacy|deliberate|ruled out|objection|copy cleanup|older revisions'
NEGATIONS="$NEGATIONS"'|doesnotmatch|assert\.'

# Values and identifiers, not prose.
IDENTIFIERS="payment_method|payment +VARCHAR|method +payment_method|paymentModel|payment: \"|\"payment\":|ENUM|prepaidOnly|PREPAID_ONLY|STORE_COD_AREAS|prepaid escrow\\)|audit-cod-copy"

hits="$(grep -rnIiE "$TERMS" \
  --exclude-dir=node_modules \
  --exclude-dir=.git \
  --exclude-dir=dist \
  . 2>/dev/null \
  | grep -viE "$NEGATIONS" \
  | grep -viE "$IDENTIFIERS" || true)"

if [ -z "$hits" ]; then
  echo "OK — no cash-on-delivery offers in customer-facing copy."
  exit 0
fi

echo "FAIL — these still read as a cash-on-delivery offer:"
echo ""
echo "$hits"
echo ""
echo "Fix the copy, or extend the allowlist above if it is a deliberate negation."
exit 1
