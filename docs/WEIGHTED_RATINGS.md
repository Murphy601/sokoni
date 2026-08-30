# Weighted ratings & badge tiers

Fair shop/rider scores use a **cumulative weighted average**, not “last review wins.”

## Formula

```
newRating = (currentRating × totalReviews + newStars) / (totalReviews + 1)
```

Bonuses/penalties adjust the score **without** changing review count:

| Event | Delta |
|-------|-------|
| Dispute-free completion | +0.05 |
| On-time rider delivery | +0.02 |
| Buyer-won dispute | −0.5 |
| Seller cancel (accepted order) | −0.3 |
| Rider late pickup (>20 min) | −0.2 |

## Channels

- WhatsApp: reply `1`–`5` or `RATE 5` / `RATE 5 SKN-####` after delivery
- Web: `createOrderReview` updates the weighted pool + `order_reviews` history
- Boss: `SET RATING @handle 4.8`, `PENALIZE RIDER +254… 0.5`, `PENALIZE SELLER @handle 0.3`

## Badge ladder

| Tier | Unlock |
|------|--------|
| Newbie | Default |
| Verified | ≥10 completed, rating ≥4.0, ID verified |
| Top Rated | ≥50 completed, rating ≥4.7, dispute rate &lt;2% |
| Sokoni Legend | ≥200 completed, rating ≥4.9, zero unresolved disputes |

Demotion: Top Rated / Legend paused if rating drops below **4.5** (WhatsApp alert).

## Schema

`db/schema-phase33-weighted-ratings.sql` — `users.rating_*`, `riders.rating_count` / `badge_tier`, `rating_events` ledger.

Run `npm run db:migrate` in `whatsapp-bot/` after deploy.
