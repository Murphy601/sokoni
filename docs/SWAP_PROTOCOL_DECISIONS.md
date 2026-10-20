# Swap protocol — decisions, deferred

Item-for-item trading with an optional cash top-up. **Not built.** Deferred
because it is a second fulfilment engine, not an inbox card: two items move in
opposite directions, so there are two dispatches, two pickup OTPs, two delivery
confirmations, and escrow holding money that belongs to neither party until
both legs land.

These answers are settled. Written down so whoever picks this up is not
re-deciding them.

## 1. The top-up on a partial delivery

The top-up stays **fully locked in escrow until both delivery OTPs confirm**.
Not released on the first leg, not split.

If leg B fails:

- the top-up is **refunded to whoever sent it**
- a **reverse-dispatch ticket** is raised to return leg A's item to its owner
- if the return cannot be completed, it becomes an **escrow claim** for ops

The reason: releasing on the first confirmation would mean a swap can end with
one person holding both items and the money. There is no automated way back
from that.

## 2. Riders

**Two independent dispatches**, one per leg.

Not one rider carrying both. Synchronising a single rider across a two-way
swap in Nairobi traffic multiplies the delay of each leg by the other and
turns two ordinary deliveries into one fragile one. Independent legs fail
independently, which is the whole point.

## 3. Cancellation

Unilateral cancellation is available until **either** leg reaches `In Transit`.

From that moment it is disabled for both parties, and any cancellation needs
**Escrow Referee (admin) intervention**. Once an item is on a bike, cancelling
is a physical operation, not a state change.

## What this needs before it can be built

- A swap record holding two legs, each with its own dispatch, OTPs and status
- Escrow that can hold a top-up against two conditions rather than one
- A reverse-dispatch flow, which does not exist today
- Dispute handling that knows which leg is being disputed
- An ops view showing both legs side by side

## Why it is last

Every other inbox feature either adds a card or reuses the existing
offer -> STK -> escrow path. This one adds a fulfilment model. It should not be
attempted until the rest of the inbox is live and the boda fleet has enough
history to show how often a single leg fails in practice -- that number decides
how much of the above has to be automated rather than handled by ops.
