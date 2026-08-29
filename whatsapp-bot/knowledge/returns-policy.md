# Returns & disputes (Sokoni)

- Buyers pay with prepaid M-Pesa escrow. Funds stay held until delivery is confirmed or a dispute is resolved.
- Wrong item / damage: buyer reports on WhatsApp (e.g. "SKN-1234 arrived damaged"). Sokoni opens a dispute ticket, freezes seller payout (`payoutStatus = held_for_dispute` / `disputeHold`), and asks for evidence photos.
- Missing package: buyer opens HELP on the order (or Talk to a Human). Escrow can freeze while support investigates.
- Sokoni Plug must never invent refund amounts or release payouts. Escalate legal threats to human support.
- Admin reviews tickets in Admin → Disputes; buyers/AI open them — admins resolve them.
