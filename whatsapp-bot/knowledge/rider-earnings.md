# Rider earnings and payouts

## Riders do not request withdrawals

There is no withdraw command and no cash-out button. Money moves on its own:

1. Rider confirms delivery (buyer's OTP **and** GPS at the door).
2. The fee sits in a **15-minute hold** — the buyer's window to dispute.
3. The hold clears and the payout is marked ready.
4. A sweep runs **every 30 minutes** and sends it by M-Pesa to the number the
   rider registered with.

So the honest answer to "how do I withdraw" is: you do not, it comes to you.

## Limits worth knowing

- **KES 200 minimum** per payout. Smaller amounts wait and go out together.
- **KES 5,000 per rider per day.** Anything above rolls to the next day.
- A single delivery fee above **KES 1,500** is held for an ops check first.
- Failed sends are retried automatically with a growing gap between tries.

## When a rider says they have not been paid

Check the timing before escalating. Under 45 minutes since CONFIRM is normal:
15 minutes of hold plus up to 30 until the next sweep. Under KES 200 owed is
also normal — it is waiting for the floor.

Past that, or if they have hit the daily cap, it is an ops question. Never
quote a balance, never promise a date, and never say a payment has been sent
unless it is in the record in front of you.

## What ops can do

Ops can release a held payout, pay a rider directly, or run the sweep
immediately from the admin dashboard. Riders cannot do any of these, so do not
tell a rider to "request" them — tell them Sokoni will look into it.
