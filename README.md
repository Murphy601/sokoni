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
| [`docs/CATALOG_SYNC.md`](docs/CATALOG_SYNC.md) | The automated daily price/availability sync (Amazon + AliExpress APIs, opt-in structured-data for the rest) and what's automatable vs manual. |
| [`docs/STORE.md`](docs/STORE.md) | The Sokoni Store / pay-on-delivery model, Jumia-style category tree, how to add products from one file, and **automatic product images**. |
| [`docs/GO_LIVE_WAHA.md`](docs/GO_LIVE_WAHA.md) | **Step-by-step go-live** with WAHA + free hosting (Oracle VM + Cloudflare Pages). |
| `scripts/sync/` | The catalog sync script + provider modules, run daily by a GitHub Action. |
| `website/` | A working, dependency-free storefront (HTML/Tailwind/JS) that showcases categories & deals and drives visitors to WhatsApp. |
| `whatsapp-bot/` | Node.js/Express bot via **WAHA**: numbered text menus + OpenRouter AI + pay-on-delivery orders. |

## How the pieces connect

```
Website (storefront, SEO, trust) ──► "Chat on WhatsApp" (wa.me link)
        │
        ▼
WhatsApp (WAHA) + Sokoni AI bot
   (numbered menus + free-text AI)
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

See [`docs/GO_LIVE_WAHA.md`](docs/GO_LIVE_WAHA.md) for WAHA setup and free hosting.

## Suggested next steps

1. Pick a name from [`docs/BRANDING.md`](docs/BRANDING.md) (recommendation: **Sokoni**), register
   the domain + socials, and confirm the WhatsApp Business display name is available.
2. Register as an affiliate on Kilimall, Jumia KOL, AliExpress, and Temu (links + notes in
   [`docs/CONCEPT.md`](docs/CONCEPT.md)) — approval can take a few days for some programs.
3. Go live with WAHA — scan QR with your WhatsApp number (see [`docs/GO_LIVE_WAHA.md`](docs/GO_LIVE_WAHA.md)).
4. Replace the demo catalog (`whatsapp-bot/src/data/products.json` and
   `website/data/products.json`) with your first ~20 real curated products and real affiliate links.
5. Deploy WAHA + bot (Oracle free VM) and website (Cloudflare Pages), configure the WAHA webhook,
   and start driving traffic.
