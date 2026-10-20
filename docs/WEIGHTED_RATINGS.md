# Sokoni ratings, badges & growth controls

Fair scores use a **rolling window of the last 100 pool entries** (buyer stars + system penalties/bonuses). Old shocks fall off once 100 newer entries arrive.

## Display formula

```
DisplayedRating = sum(last 100 pool entries) / count(up to 100)
```

### Grace buffer (UNRATED)

- New profiles start at **5.0** internally.
- Site shows **UNRATED** until **5 successful buyer star reviews**.
- Example: fifty 5★ then one 1★ → **4.92** (not 3.0).

## Automated deltas (pushed into the same pool)

| Event | Effect |
|-------|--------|
| Buyer rates 1–5 | Star entry |
| Clean completion | +0.05 synthetic |
| On-time rider | +0.02 synthetic |
| Buyer-won dispute | −0.5 synthetic |
| Seller cancel | −0.3 synthetic |
| Rider late pickup (&gt;15 min) | −0.2 synthetic |

Low scores (1–3) on WhatsApp open a short why-prompt (late / quality / rude / other).

## Badge ladder

| Tier | Unlock | Perks |
|------|--------|-------|
| Newbie | Default | 5% commission |
| Verified | ≥10 orders, rating ≥**4.2**, ID verified | Blue check, catalog boost |
| Top Rated | ≥50 orders, ≥4.7, dispute rate &lt;2% | 4% commission / priority dispatch |
| Sokoni Legend | ≥200 orders, ≥4.9, 0 unresolved | Instant escrow, featured |

Demotion: Top Rated / Legend paused if score &lt; **4.5** (WhatsApp alert).

## Channels

- **Site:** product cards show `★ 4.8 (124 reviews)` or `UNRATED`
- **WhatsApp:** `RATE 5` / `RATE 5 SKN-####` → receipt with updated shop score
- **Boss WA:** `OVERRIDE RATING @handle 4.8`, `PURGE RATING SELLER userId poolEntryId`, `PENALIZE …`
- **Admin desk:** Actions → *Rating log / purge unfair* (or `POST /admin/command/ratings/purge`)

## Schema

`db/schema-phase33-weighted-ratings.sql` — `rating_pool` JSONB, `rating_events` ledger.

Run `npm run db:migrate` after deploy.
