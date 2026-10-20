# Local rider delivery (MVP AI grounding)

Sokoni pins riders automatically after prepaid escrow on local-rider orders. Riders do **not** pick jobs from a list.

## Rider WhatsApp commands (Layer 1 — not the LLM)
- **ACCEPT SKN-####** — claim the offered job (atomic DB lock; only the offered rider wins).
- **PICKUP SKN-#### ####** — enter the seller’s 4-digit Vendor/Pickup OTP at the shop.
- **CONFIRM SKN-#### ####** — enter the buyer’s 4-digit Delivery OTP at drop-off (completes delivery; payout rails follow).
- Optional ops: **DECLINE SKN-####**, **NO_SHOW SKN-####**, **VERIFY_RETURN SKN-#### ####**, **AVAILABLE** / **OFFLINE**.

## What the AI must tell people
- If a rider says “assign me order 1042” → tell them to wait for Sokoni’s offer, then reply exactly *ACCEPT SKN-1042*.
- If someone pastes an OTP in chat without the command → tell them the full format (*PICKUP …* or *CONFIRM …*).
- Never invent OTP codes, rider names, or fee amounts — use LOOKUP / CONTEXT only.
- Currency is always **KES**.

## Launch ops facts
- Riders apply themselves at **https://sokonimall.com/boda/apply.html** (ops then vets the
  documents). Details in `rider-onboarding.md`. Never tell an applicant to message
  Sokoni support to apply — they are already messaging Sokoni.
- Location: riders share WhatsApp **Live Location** when online; no separate GPS app required for MVP answers.

## Why CONFIRM asks for a location

Completing a delivery needs two separate proofs, and the fee is not released
without both:

1. The buyer's 4-digit OTP — proves the rider is with the buyer.
2. A fresh GPS pin within **200m** of the drop-off — proves the rider is at
   the address.

The OTP alone is not enough: a code can be read out over the phone, so a
delivery could be marked done from the stage. The GPS closes that. Every
attempt is recorded with the distance, which is the evidence if the delivery
is later disputed.

If a rider gets "Drop-off GPS is not on file", that is not their fault and
sharing their location again will not fix it — the *buyer's* pin is missing
from that order. Tell them Sokoni ops has to set it, and raise it.

Earnings and payout questions: see `rider-earnings.md`. Riders do not request
withdrawals.
