# Sokoni — An AI Shopping Concierge for WhatsApp

**Your Market, On WhatsApp.** Sokoni is a concept + working starter kit for an AI-powered,
affiliate-driven "online mall" reachable entirely through WhatsApp: an AI agent helps shoppers
find and buy products from trusted local suppliers (Kilimall, Jumia) and global marketplaces
(AliExpress, Temu, Amazon) — with no inventory to manage, earning affiliate commission on every
completed sale.

Read the full concept first: [`docs/CONCEPT.md`](docs/CONCEPT.md)

## What's in this repo

| Path | What it is |
| --- | --- |
| [`docs/CONCEPT.md`](docs/CONCEPT.md) | The business model, revenue streams, real affiliate programs to join (Kilimall, Jumia KOL, AliExpress, Temu, Amazon), legal notes, and a phased launch roadmap. |
| [`docs/BRANDING.md`](docs/BRANDING.md) | Name shortlist (Sokoni, PataMall, DukaLink, ...) + logo concepts. |
| [`docs/WHATSAPP_FLOWS.md`](docs/WHATSAPP_FLOWS.md) | The full menu tree and user-journey diagrams for the WhatsApp bot. |
| [`docs/AI_AGENT_PROMPT.md`](docs/AI_AGENT_PROMPT.md) | The system prompt + example transcripts that power the AI shopping agent. |
| `website/` | A working, dependency-free storefront (HTML/Tailwind/JS) that showcases categories & deals and drives visitors to WhatsApp. |
| `whatsapp-bot/` | A working Node.js/Express WhatsApp Cloud API bot: structured menus + an AI free-text agent (with tool-calling) + affiliate-link building with per-customer tracking sub-IDs. |

## How the pieces connect

```
Website (storefront, SEO, trust) ──► "Chat on WhatsApp" (wa.me link)
        │
        ▼
WhatsApp Cloud API + Sokoni AI bot
   (menus + free-text AI agent)
        │
        ▼
Tracked affiliate link (Kilimall / Jumia / AliExpress / Temu / Amazon)
        │
        ▼
Buyer checks out on the supplier's own site
        │
        ▼
You earn a commission (M-Pesa / PayPal / Payoneer)
```

## Quick start

Website (no build step, static HTML/JS):

```bash
cd website
npx serve .
```

WhatsApp bot (Node.js, runs in a dry-run/demo mode without real API keys so you can develop the
conversation flow first):

```bash
cd whatsapp-bot
npm install
cp .env.example .env
npm run dev
```

See [`whatsapp-bot/README.md`](whatsapp-bot/README.md) for how to wire it up to a real WhatsApp
Business number via Meta's Cloud API, and [`website/README.md`](website/README.md) for deployment
notes.

## Suggested next steps

1. Pick a name from [`docs/BRANDING.md`](docs/BRANDING.md) (recommendation: **Sokoni**), register
   the domain + socials, and confirm the WhatsApp Business display name is available.
2. Register as an affiliate on Kilimall, Jumia KOL, AliExpress, and Temu (links + notes in
   [`docs/CONCEPT.md`](docs/CONCEPT.md)) — approval can take a few days for some programs.
3. Get a WhatsApp Business number and Meta Cloud API access (developers.facebook.com).
4. Replace the demo catalog (`whatsapp-bot/src/data/products.json` and
   `website/data/products.json`) with your first ~20 real curated products and real affiliate links.
5. Deploy the bot (Render/Railway/Fly.io/a small VPS) and the website
   (Netlify/Vercel/Cloudflare Pages), point your WhatsApp webhook at the deployed bot URL, and
   start driving traffic — a Reels/TikTok style works well for this.
