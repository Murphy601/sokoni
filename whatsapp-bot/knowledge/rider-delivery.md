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
- Rider onboarding for MVP is **manual** (ops registers trusted riders).
- Location: riders share WhatsApp **Live Location** when online; no separate GPS app required for MVP answers.
