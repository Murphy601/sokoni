# Sokoni WhatsApp Bot

The AI-powered WhatsApp shopping concierge described in `../docs/`. It's a small Express app that:

1. Verifies & receives messages via the WhatsApp Cloud API webhook (`/webhook`).
2. Routes taps on interactive menus (categories, deals, track order, etc.) — see
   `src/services/menu.js`.
3. Routes free-text messages to an AI agent (OpenAI-compatible chat completions + tool calling) that
   searches the product catalog and replies naturally — see `src/services/ai.js` and
   `../docs/AI_AGENT_PROMPT.md`.
4. Builds tracked affiliate links per supplier (Kilimall, Jumia, AliExpress, Temu, Amazon) — see
   `src/services/affiliate.js`.

## Quick start (local/dry-run — no WhatsApp account needed yet)

```bash
cd whatsapp-bot
npm install
cp .env.example .env
npm run dev
```

Without `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` set, outgoing messages are logged to the
console instead of sent (dry-run mode) — great for developing the conversation logic before you have
a Meta WhatsApp Business account approved. Without `OPENAI_API_KEY` set, free-text messages fall back
to a simple keyword search over the demo catalog instead of full AI replies.

You can simulate an inbound webhook locally with curl, e.g. a text message:

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "entry": [{
      "changes": [{
        "value": {
          "messages": [{ "from": "254700000000", "type": "text", "text": { "body": "menu" } }]
        }
      }]
    }]
  }'
```

Or an interactive list reply:

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "entry": [{
      "changes": [{
        "value": {
          "messages": [{
            "from": "254700000000",
            "type": "interactive",
            "interactive": { "type": "list_reply", "list_reply": { "id": "cat_electronics" } }
          }]
        }
      }]
    }]
  }'
```

## Going live with real WhatsApp

1. Create a Meta developer app at developers.facebook.com, add the WhatsApp product, and get a test
   number working.
2. Fill in `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID` in
   `.env`.
3. Deploy this app somewhere with a public HTTPS URL (Render, Railway, Fly.io, a small VPS, etc.).
4. In the Meta app dashboard, set the webhook URL to `https://<your-domain>/webhook` and the verify
   token to whatever you set as `WHATSAPP_VERIFY_TOKEN`.
5. Subscribe the webhook to the `messages` field.
6. Apply for WhatsApp Business API production access (moves you off the sandbox test number).

## Extending the catalog

`src/data/products.json` is the entire product catalog for the demo. Add real products with real
affiliate-eligible `sourceUrl`s here as you get approved on each affiliate program. Longer-term,
replace `src/services/catalog.js`'s file-based `loadProducts()` with a real database and/or a
scheduled job that pulls live prices from supplier product-feed APIs where available.

## Affiliate link tracking

`src/services/affiliate.js` attaches your affiliate ID + a hashed per-customer sub-id to every
outgoing product link, so you can see in each program's dashboard which conversations are converting
— without ever sending the customer's real phone number to a third party. Swap the placeholder
query-param names for the real ones once you're approved on each program (they're usually generated
for you inside each program's own link-builder tool).
