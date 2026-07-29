# Phase 1 — End-to-end QA checklist

Manual QA for the Depop-style social foundation on soft buyer auth (`BUYER_AUTH_MODE=soft`, default). Run after deploy + `db:migrate`.

## Automated smoke (before manual)

```bash
cd whatsapp-bot
npm run test:social
curl -s https://bot.sokonimall.com/health
```

Expect: buyer/social auth scripts pass; health shows `dbEnabled` / `dbConnected` when Postgres is live.

## Happy path — buyer → offer → accept → chat → remind → delivered → review

Use two phones (buyer + seller) and one live listing with `seller_user_id` linked.

| Step | Action | Pass if |
|------|--------|---------|
| 1 | Seller: verify WhatsApp on seller dashboard | Session persists for the tab |
| 2 | Buyer: open shop/`product` sheet, verify WhatsApp (or soft `?viewer=` for demos) | Follow / like / offer actions work |
| 3 | Buyer: send offer below list price | Offer appears in seller inbox as pending |
| 4 | Seller: decline one offer | Buyer cannot chat on declined offer |
| 5 | Buyer: send new offer → seller accepts | Chat unlocks; accepted card shows; WA ping includes `pay_offer_<id>` |
| 5b | Buyer: reply `pay_offer_<id>` (or Activity → Pay on WhatsApp) | Pending order uses **agreed** total; STK amount matches offer, not list price |
| 6 | Buyer + seller: exchange in-app messages | Phone numbers / “pay outside” blocked |
| 7 | Seller: send reminder once, then again immediately | First OK; second `429 reminder_cooldown_active` |
| 8 | Seller: mark offer handled, reload, unhandle, reset queue | State survives reload; audit events listable |
| 9 | Complete order to `delivered` / `completed` in DB | Order status updated |
| 10 | Buyer: `POST /api/social/reviews/create` with session | Review appears on shop; second review rejected |

## Auth regression (manual)

| Case | Expect |
|------|--------|
| Soft, no session, `?viewer=ID` | Legacy demo still works |
| Soft, valid buyer session + mismatched body user id | `403 buyer_session_mismatch` (or identity overwritten to session user) |
| Soft, invalid buyer `sessionToken` | `401 session_invalid` / expired |
| Hard mode (`BUYER_AUTH_MODE=hard`) write without session | `401 session_required` |
| Seller social action without seller session | `401 session_required` |
| Seller session + wrong `sellerUserId` | `403 seller_session_mismatch` |
| Buyer chat with buyer OTP session | Messages send (not stuck on seller auth) |
| Seller chat via inbox `sellerAuth=1` | Still works with seller dashboard session |

## UI / reload

- [ ] Mobile: shop follow/like, product-sheet offer form, inbox composer (44px targets)
- [ ] Reload seller offers inbox — filters, handled queue, reminder cooldown preserved
- [ ] Reload shop/inbox after buyer verify — panel hides; actions still authenticated
- [ ] Session expiry copy shown when seller/buyer token expires mid-action

## Sign-off

| Area | Owner | OK |
|------|-------|----|
| Automated `npm run test:social` | | |
| Happy path table | | |
| Auth regression table | | |
| Mobile + reload | | |

Phase 1 social foundation is ready for hard-mode enablement only after the auth regression table passes in staging.