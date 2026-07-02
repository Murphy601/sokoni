# WhatsApp Bot: Menu Tree & User Journeys

The bot mixes **structured menus** (WhatsApp interactive list/button messages — reliable, fast,
thumb-friendly) with a **free-text AI fallback** (handles anything that doesn't fit a menu: "do you
have an iPhone charger under 1000 bob?", "is this original?", "what's the difference between these
two blenders?").

## 1. Entry points

- Website "Chat with Sokoni AI" button →
  `https://wa.me/<number>?text=Hi%20Sokoni%2C%20I%20want%20to%20shop`
- Instagram/TikTok/Reels bio link → same wa.me link
- QR code on printed flyers/market stalls (great for Kenya's informal retail scene)
- Word of mouth / direct save-the-contact

## 2. Top-level menu (first message a new user sees)

Sent as a WhatsApp interactive list message (see `whatsapp-bot/src/services/menu.js`):

```
👋 Karibu! I'm Sokoni AI — your shopping buddy on WhatsApp.
Tell me what you're looking for, or pick an option below 👇

[ View Menu ▾ ]
── Shop by Category ──
📱 Electronics & Phones
👗 Fashion & Beauty
🏠 Home & Living
🍞 Groceries & Food
🚗 Motors & Accessories
── More ──
🔥 Today's Hot Deals
🌍 Shop International (AliExpress/Temu/Amazon)
📦 Track My Order
🙋 Talk to a Human
❓ How Sokoni Works
```

Row IDs map to handlers in code, e.g. `cat_electronics`, `cat_fashion`, `deals_today`, `intl_shop`,
`track_order`, `human_handoff`, `how_it_works`.

## 3. Category browsing journey

```
User taps "📱 Electronics & Phones"
        │
        ▼
Bot sends a sub-menu (list message):
  - Smartphones
  - Laptops & Accessories
  - Audio (earbuds/speakers)
  - TVs & Home Electronics
  - ⬅ Back to Main Menu
        │
        ▼ (user taps "Smartphones")
Bot sends 3-5 product cards (image + text + button per product), e.g.:

📱 *Samsung A16 128GB*
KES 16,999 (was 19,500)
⭐ 4.6 (2,300 reviews) · Kilimall
[ 🛒 Buy on Kilimall ] ← wraps the affiliate link
[ 🤖 Ask AI about this ]

(repeat for next products, then:)
Want to see more, filter by price, or ask me anything about these?
[ Show More ] [ Filter by Price ] [ Ask a Question ]
```

- "Buy on Kilimall/Jumia/…" button sends the user the affiliate link (with a personal sub-id tag for
  tracking, e.g. `?aff_sub=<hashed_phone>`), plus a short "Reply here anytime if you have questions
  before/after buying" note — this keeps them in the conversation even after they leave to check out
  on the supplier's site.
- "Ask AI about this" hands off to the free-text AI, passing the product context so the AI can answer
  follow-ups intelligently ("does it support 2 sim cards?", "is there a cheaper alternative?").

## 4. Free-text / AI journey (fallback for anything typed, not tapped)

```
User: "I need a good phone under 15k that has good camera"
        │
        ▼
AI Agent (see docs/AI_AGENT_PROMPT.md) interprets intent →
  calls internal "search_products" tool with {category: phones, max_price: 15000, sort: camera}
        │
        ▼
Bot replies with 2-3 matching product cards + a natural-language explanation:
  "Here are 3 solid options under KES 15,000 with great cameras 📸..."
        │
        ▼
Conversation continues naturally — AI remembers context (last 10-20 messages)
until user goes quiet or types "menu" to reset to the structured flow.
```

Free text also handles:

- FAQs: "is this legit?", "how do I pay?", "do you deliver to Kisumu?", "what if the product is
  damaged?"
- Price/availability questions before purchase
- Post-purchase support routing ("track_order" flow or "human_handoff")
- Casual chit-chat / greeting in Sheng/Swahili/English (AI should respond in whichever
  language/style the user used)

## 5. "Today's Hot Deals" journey

```
User taps "🔥 Today's Hot Deals"
        │
        ▼
Bot sends a rotating hand-picked list (updated daily/weekly by admin via products.json
or an admin dashboard in a later phase) — mixes local + international deals to
showcase both sides of the mall.
        │
        ▼
Optional: "Want me to alert you when there's a deal like this again?
[ Yes, notify me ] [ No thanks ]"
→ opts the user into a WhatsApp broadcast list (must respect the 24h/template rules).
```

## 6. "Shop International" journey

```
User taps "🌍 Shop International"
        │
        ▼
Bot explains briefly: "I can help you shop from AliExpress, Temu and Amazon too —
delivery usually takes 1-4 weeks internationally. Want me to show trending picks,
or are you looking for something specific?"
        │
        ▼
[ 🔥 Trending Global Picks ] [ 🔍 I know what I want ]
```

- Trending picks → curated list similar to local categories, but tagged with the source platform and
  estimated delivery time (important expectation-setting for cross-border orders).
- "I know what I want" → free text → AI searches the international catalog / can also just paraphrase
  to a searchable Temu/AliExpress affiliate deep-link if no curated match exists.

## 7. Track My Order

```
User taps "📦 Track My Order"
        │
        ▼
Bot: "Which store did you order from?"
[ Kilimall ] [ Jumia ] [ AliExpress/Temu ] [ Somewhere else ]
        │
        ▼
Bot sends the relevant official tracking link/instructions for that supplier
(Sokoni doesn't hold the order data itself in v1 — it's a concierge that points
you to the right place fast, saving you a Google search).
```

## 8. Human handoff

```
User taps "🙋 Talk to a Human" OR AI detects frustration/complex complaint
        │
        ▼
Bot: "Got it — connecting you with our team. Someone will reply here shortly. 🙏"
→ flags the conversation in the admin/agent dashboard (Phase 2) or simply
notifies the founder's own WhatsApp/Slack via webhook in v1.
```

## 9. Global message design rules

- Always confirm the language register the user used (English / Kiswahili / Sheng) and mirror it.
- Every product card must clearly show: price, source platform, and a disclosure that it's an
  affiliate link (e.g. small footer line: "Sokoni may earn a commission on this purchase 🙏").
- Menus reset to top-level if the user types `menu`, `hi`, or `start` at any point.
- Keep any single message under ~4-5 lines of body text before a button/list — WhatsApp users skim,
  they don't read essays.
- Use emojis for scannability but don't overdo it (1-2 per line max).
