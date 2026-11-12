# Sokoni repo + live-site audit

Offline pack/scrape/analysis of [github.com/Murphy601/sokoni](https://github.com/Murphy601/sokoni) and [sokonimall.com](https://sokonimall.com/login?next=index.html). No remote LLM tokens were used for the scrape or static scans.

**When:** 10 Oct 2026  
**Branch tools:** Repomix 1.18.1, Gitingest 0.3.1, Crawl4AI 0.9.4, ast-grep 0.50.0, Semgrep 1.180.0  
**Raw dumps:** `docs/analysis/raw/` (gitignored). Re-run steps: `scripts/analysis/README.md`.

---

## What this marketplace actually is

The root `README.md` still describes an affiliate concierge that sends shoppers to Jumia / Kilimall / AliExpress / Temu / Amazon. **That is not what the code or the live FAQ do.**

Live FAQ: *“Sokoni lists local Kenya inventory only — brand new and pre-loved items from sellers on our platform. We do not route to overseas marketplaces.”*

The running system is a **Kenya prepaid P2P marketplace**:

| Layer | Path | Role |
| --- | --- | --- |
| Storefront | `website/` | Static HTML + Tailwind CDN + vanilla JS, deployed via Wrangler (`assets.directory: website`) |
| Motion | `website-motion/` | React + Framer Motion, built into `website/assets/js/sokoni-motion/` |
| API / WhatsApp | `whatsapp-bot/` | Express + WAHA + Postgres + Daraja/Paystack + AI (Groq / OpenRouter / Gemini) |
| Clips | `remotion-worker/` | Product video worker |
| Docs / ops | `docs/`, `scripts/` | Phase plans, deploy, catalog sync, Daraja helpers |

Gitingest: **732 files**, ~**1.6M tokens**, ~6.0 MB of text. Repomix full pack: **8.7 MB / 171,884 lines**. Bot `src/` has **345 JS files** and **159 tests**. Website: **37 HTML** pages, **53 JS** modules.

---

## Live site (Crawl4AI + curl)

### Account wall

`website/index.html` sets `<meta name="sokoni-account-gate" content="hard">` and an inline script that `location.replace`s to `login.html?next=index.html` when `sokoni-account-session` is missing.

So for an anonymous browser:

- `https://sokonimall.com/` HTTP 200 serves `index.html`, then **JS bounces to the login landing**.
- `https://sokonimall.com/login?next=index.html` is the page real visitors see.
- `*.html` URLs 307 to extensionless paths (`/about`, `/faq`, …) on Cloudflare.

Crawl4AI confirmed `/` and `/login?next=index.html` render the same Depop-style landing: Buy / Sell / Ride, login + signup modals, WhatsApp OTP, Ask AI sheet, `wa.me/254117422428`.

`?gate=off` (and `?gate=soft`) is a **production bypass**. It writes `localStorage.sokoni-account-gate` and shows the catalog. That is intentional for debugging; it is also public.

### What the ungated shop looks like

`https://sokonimall.com/?gate=off` (34k chars of rendered Markdown):

- Jumia-style category mega-menu (Women → Wines & Spirits, Mashinani, etc.).
- Trust rail: prepaid escrow, SKN tracking, pre-loved + brand-new.
- **One live listing:** Black Itel Feature Phone, **KES 12**, `@adiv-s-mini-mart`, Cloudinary cutout, “New Joiner / New Store”.
- Repeated empty states: “Nothing listed for that yet”, “Fresh listings loading”, “Trending coming soon”.
- Heavy Unsplash stock for categories; Nairobi-street alts on marketing images (`trust-exchange-nairobi.jpg`, “Nairobi street”, “Nairobi coffee shop”).
- `wa.me` CTAs and SKN-1002 example timeline are intact.

Public catalog API matches that:

```http
GET https://bot.sokonimall.com/api/products?limit=5
→ {"total":1,"products":[{"id":"pt-tondx-001","priceKes":12,"sellerHandle":"adiv-s-mini-mart"}]}
```

`GET /api/search?q=phone` returns the same item via `sokoni-smart`. `GET /api/feed` is **404** (`Cannot GET /api/feed`) even though the bot mounts `app.use("/api/feed", …)` in this repo — live build `60d5624` is behind this tree, or the feed router path does not match.

### Copy contradictions (shopper-visible)

| Surface | Says | Reality |
| --- | --- | --- |
| Homepage “How Sokoni Works” | “No app to download. **No account to create.** Just chat.” | Website catalog is **hard-gated**. WhatsApp still works without a web account. |
| Seller pitch | “**0% selling fees** — you keep 100%” | Bot has commission / Paystack / B2C payout rails (`paymentRail: paystack`, `b2c.ready: true`). |
| Root README | Affiliate outbound mall | Local escrow marketplace. |
| DESIGN.md | Cream `#FFF8F0`, purple `#1B1035`, green `#25D366` for actions | Live shop Tailwind maps `brand.green` to **`#FF2300`** (Depop red) and dark surfaces. Login landing is closer to Depop than DESIGN.md. |

Countrywide voice is mostly held. Registered-office copy on About correctly says the Kandara BRS address is **not** a “we only serve one town” claim. Image **alts/filenames** still lean Nairobi.

### Trust / legal pages (good)

About, FAQ, Trust, Terms, Privacy scrape cleanly:

- SKN MALL KENYA / **BN-36SM2YW9**, BRS SMS **21546**.
- Prepaid M-Pesa STK, no COD, never pay riders.
- Escrow hold 24h local / 48h upcountry; inspect before sharing delivery code.
- Support `+254 117 422 428` / `support@sokonimall.com`.
- Kenya DPA 2019 called out on auth + privacy.

### Headers

Cloudflare on `sokonimall.com`: HSTS, `X-Frame-Options: SAMEORIGIN`, `nosniff`, Permissions-Policy. CSP is real but loose:

- `script-src` includes **`'unsafe-inline' 'unsafe-eval'`** plus Tailwind / Socket.IO / unpkg.
- `connect-src` includes **`http://localhost:3001` and `ws://localhost:3001`** on production.

Bot (`bot.sokonimall.com`): nginx → Express, rate-limit headers, `X-Powered-By: Express`, CSP `default-src 'none'`.

`GET /health` is **very chatty** for a public endpoint: Groq/OpenRouter flags, MAS shadow, WAHA `WORKING`, DB connected, Daraja + Paystack + ElevenLabs configured, B2C ready/auto=false, catalog not paused. Useful for you; also a map for anyone else.

---

## Code architecture (from the packs)

```
Browser (website/*.html)
   │  account-gate / account-auth  (localStorage session)
   │  app.js catalog + product-sheet + shop-shell
   ▼
https://bot.sokonimall.com
   /api/products  /api/search  /api/social  /api/account/auth
   /api/seller/*  /api/checkout  /api/orders  /api/disputes
   /api/agent     /api/cart     /api/payments  /api/tracking
   /api/riders    /admin/*      /webhook (WAHA HMAC)
   ▼
Postgres + WAHA session "default" + Daraja STK / Paystack + LLM router
```

`whatsapp-bot/src/server.js` is the spine: chunked 16 MB video uploads **before** `express.json({ limit: "25mb" })`, then ~25 routers, then a pile of schedulers (payouts, boda dispute windows, feed, voice-note purge, inspection window, orphan catalog scrub).

Frontend `fetch()` (ast-grep): **58** calls, concentrated in `seller-listing.js` (10), `app.js` (8), `inbox.js` (8), `shop-profile.js` / `checkout.js` (5 each). All point at `bot.sokonimall.com` or relative `/data/products.json`.

`innerHTML =` : **278** writes across 40 files — worst in `seller-listing.js` (69), `inbox.js` (23), `shop-profile.js` (22), `admin-command.js` (18). Mitigated by `website/assets/js/html-guard.js` + DOMPurify (`purify.min.js` on every page). **0 `eval()`**, **0 `document.write()`**.

No live API keys showed up in the packed tree (`.env` gitignored; test files use fake `sk_live_…` placeholders). There is a `SECRET_PURGE_RUNBOOK.md` — treat that as a reminder this repo has leaked keys before.

---

## Semgrep (JS + OWASP packs)

6 warnings, no errors:

| Rule | Where | Notes |
| --- | --- | --- |
| Open redirect | `website/assets/js/account-auth.js` ~368 | `window.location.href = next` after `?next=`. `normalizePostAuthDest` blocks `http(s):` and `//` but still allows odd schemes / relative paths. Tighten to a allowlist of `*.html` site files. |
| CORS “user-controlled origin” | `whatsapp-bot/src/middleware/security.js` ~30 | **False positive.** Origin is echoed only after a `Set` allowlist (`sokonimall.com`, www, localhost:8080). |
| Raw HTML / XSS | `whatsapp-bot/src/routes/tiktokOAuth.js` 59–75 | Admin TikTok OAuth callback writes HTML. Confirm values are escaped; do not reflect query strings. |

Recommended follow-ups Semgrep did **not** cover, from reading the packs:

1. **Remove or auth-gate `?gate=`** on production so the hard wall cannot be flipped from the URL bar.
2. **Shrink `/health`** (or put the chatty fields behind an admin token). `/` also publishes `session: "default"`.
3. **Drop `localhost:3001` and `unsafe-eval` from production CSP** when the Socket.IO/dev path is unused.
4. **25 MB JSON body** on the public API is large; keep it only on upload routes.
5. Seller video auth via **query `sessionToken`** can leak in access logs / Referer. Prefer headers only (`X-Seller-Session` already exists).
6. Align **README + “0% fees” + “no account”** copy with the live prepaid + hard-gate + Paystack model.
7. Restore DESIGN.md tokens on the shop (or officially replace DESIGN.md if Depop red/black is the new brand). Green `#25D366` is reserved for WhatsApp/order actions.
8. `/api/feed` 404 on production vs mounted router in this tree — confirm deploy parity.

---

## Ollama / $0 Cursor routing

Not installed in this Cloud Agent environment (no GPU, 14B weights are the wrong tool here). The analysis above is the local-tool pass.

On a desktop, if you want Cursor Chat to read `docs/analysis/raw/repomix-output.xml` without OpenRouter:

1. `ollama run qwen2.5-coder:14b`
2. Cursor Settings → Models → OpenAI key `ollama`
3. Override base URL `http://localhost:11434/v1`
4. Add model name `qwen2.5-coder:14b` and disable cloud models

---

## Suggested next product moves (from this scrape)

The **platform is built**; the **shelf is empty**. One KES 12 feature phone cannot support the category grid, “Popular this week”, or “Sellers to follow”. Until there are real listings, the hard login wall hides an empty shop and trains people that Sokoni is a signup page.

Highest-leverage order:

1. Seed 20–40 real SKUs (or keep the wall off / soft until the grid is full).
2. Kill the production `?gate=` bypass and the “no account needed” sentence on the gated homepage.
3. Fix `/api/feed` (or stop the client from calling it).
4. One brand: either cream/purple/WhatsApp green (DESIGN.md) or Depop red — not both.
5. Refresh `README.md` so new agents stop implementing the old affiliate-mall story.
