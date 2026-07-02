# Sokoni Website (Storefront)

A lightweight, dependency-free storefront (plain HTML + Tailwind via CDN + vanilla JS) that
showcases categories and deals, and drives every visitor toward the real conversion channel: the
WhatsApp AI concierge. No build step required.

## Run locally

Any static file server works, e.g.:

```bash
cd website
npx serve .
# or: python3 -m http.server 8080
```

Then open the printed local URL in your browser. (Opening `index.html` directly via `file://` may
block the `fetch("data/products.json")` call in some browsers due to CORS on local files — use a
local server instead.)

## Structure

- `index.html` — the whole one-page storefront (hero, categories, deals, international, how it works,
  footer).
- `assets/css/styles.css` — small custom styles layered on top of Tailwind's CDN build.
- `assets/js/app.js` — renders category tiles and product cards from `data/products.json`, and builds
  the "Ask on WhatsApp" deep links (`wa.me/<number>?text=...`) that hand the visitor off to the AI
  bot with the product already in context.
- `data/products.json` — demo catalog. In production, replace this with a small API endpoint backed
  by the same catalog/database the WhatsApp bot uses (`../whatsapp-bot/src/data/products.json`) so you
  only maintain product data in one place.

## Before you launch

1. Replace `WHATSAPP_NUMBER` in `assets/js/app.js` (and the `wa.me` links in `index.html`) with your
   real WhatsApp Business number, in international format without `+` or spaces (e.g.
   `2547XXXXXXXX`).
2. Swap the emoji placeholders for real product photos once you have them (update `imageUrl`-style
   fields and card markup).
3. Point `data/products.json` at real curated products with your real affiliate links (see
   `../docs/CONCEPT.md` for how to get approved on each affiliate program).
4. Add a real privacy policy + affiliate disclosure page (linked from the footer) before running any
   paid traffic.
5. Deploy anywhere that serves static files: Netlify, Vercel, GitHub Pages, Cloudflare Pages, or a
   simple Nginx server.
