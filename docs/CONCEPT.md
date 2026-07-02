# Concept: An AI-Powered WhatsApp Affiliate Mall

Working title: **Sokoni** (shortlist + logos in [`BRANDING.md`](BRANDING.md))

## 1. The one-line pitch

A WhatsApp-first "online mall" where an AI shopping assistant helps anyone in Kenya (and eventually
worldwide) discover, compare, and buy products from a curated network of local suppliers (Kilimall,
Jumia, local shops) and global marketplaces (Amazon, AliExpress, Temu) — while you earn affiliate
commission on every sale, automatically, without ever holding inventory.

This is **affiliate marketing + conversational commerce**, not a traditional e-commerce store. You
are not buying stock or shipping anything. You are the trusted curator + AI concierge that sits
between the buyer and the supplier, and you get paid a commission when the referred sale completes.

## 2. Why this model (and not "build your own Shopify")

Building your own inventory-based store (like Shopify/Temu) is capital-heavy: you'd need stock,
warehousing, logistics, returns, payment processing. That's a multi-year, capital-intensive
business. The affiliate mall model sidesteps all of that:

- **No inventory, no logistics, no returns risk** — the supplier (Kilimall, Jumia, Amazon, etc.)
  handles fulfillment.
- You only need: a catalog/content layer (website + WhatsApp bot), traffic, and trust.
- Revenue is commission-based, paid by the supplier's affiliate program per completed sale.
- It's realistic to start solo, from Kenya, at zero/low cost, and scale content and traffic over
  time.

Later, once you have traffic, data, and supplier relationships, you can layer on your own
private-label products, a real marketplace with your own checkout, or exclusive dropshipping deals
— but that is Phase 3+, not the starting point.

## 3. How the pieces fit together

```
┌───────────────────────────────┐
│ Website ("the online mall")   │
│ sokoni.co.ke (or .com)        │
│  - Category pages             │
│  - Deal pages / product cards │
│  - "Chat with Sokoni AI on    │
│    WhatsApp" button everywhere │
└───────────────┬───────────────┘
                │ click-to-chat (wa.me link)
                ▼
┌───────────────────────────────┐
│ WhatsApp Business number      │
│ + Cloud API webhook + AI bot  │
│  - Menu-driven browsing       │
│  - Free-text AI Q&A           │
│  - Sends product cards + your │
│    affiliate links            │
└───────────────┬───────────────┘
                │ affiliate / referral link (+ sub-id = your tracking tag)
                ▼
┌─────────────┬─────────────┬─────────────┬─────────────┐
│ Kilimall    │ Jumia       │ Amazon      │ AliExpress  │
│ (KE/UG/NG)  │ KOL prog.   │ Associates  │ / Temu      │
└─────────────┴─────────────┴─────────────┴─────────────┘
                │
                ▼
        Buyer completes checkout & pays
        on the SUPPLIER's own site/app
                │
                ▼
        Supplier tracks the sale to your affiliate ID
                │
                ▼
        You get paid commission (M-Pesa / PayPal /
        Payoneer, per program's payout rules)
```

The website is the discovery/SEO/trust layer. WhatsApp is the conversational conversion layer
where the AI actually closes the sale by answering questions instantly. The affiliate links are the
monetization layer.

## 4. Suppliers to plug in (real programs, verified)

### Local (Kenya first)

| Supplier | Program | Commission | Payout | Notes |
| --- | --- | --- | --- | --- |
| Kilimall | Kilimall Affiliate | ~2–10% (varies by category) | M-Pesa | Kenya/Uganda/Nigeria. Easiest local program to start with. |
| Jumia Kenya | Jumia KOL (formerly "Jumia Affiliate") | 1–12% (Fashion 12%, Health & Beauty 10%, Electronics 4–6%) | M-Pesa / bank | Register at kol.jumia.com, pick "Affiliate" account type. Approval can take a few days. |
| Local independent shops / boutiques | Direct deals you negotiate | Negotiable (flat fee or % per sale) | M-Pesa direct | Once you have traffic, approach local Instagram/WhatsApp sellers directly and offer to feature them for a cut — no formal "affiliate API" needed, you track manually via a discount code or "mention Sokoni" line. |

### International / global reach

| Supplier | Program | Commission | Payout | Notes |
| --- | --- | --- | --- | --- |
| AliExpress | AliExpress Affiliate (via Alibaba.com Affiliate Portal / Admitad / CJ) | Up to ~9% | PayPal / Payoneer | Great for electronics/gadgets/accessories with worldwide shipping. |
| Temu | Temu Affiliate Program | 5–20% tiered by order size, + ~$5 per new-user download bonus | PayPal / bank | Zero-cost signup, global, works well for viral "crazy cheap deal" content. |
| Amazon | Amazon Associates | 1–10% by category | Payoneer (works for Kenya) | Best for higher-trust/higher-ticket items (electronics, books, home). |
| Global dropship catalogs (CJdropshipping, Spocket, etc.) | Affiliate or white-label | Varies | Varies | Optional Phase 2+ for a "Sokoni Exclusive" private-label line. |

**Important reality check:** there is no single API that "auto-connects" your store to all these
suppliers' live inventories with one integration — each affiliate program only gives you tracking
links/banners, not a shared product database. That means for v1, you (or a small team/VA) manually
curate a catalog of the best-selling, best-reviewed products per category and store them in your own
database with the affiliate link attached. As you find product-feed APIs (Jumia and Amazon both have
limited product APIs for approved affiliates), you can start pulling prices/stock automatically —
that's a Phase 2 upgrade, not a blocker for launch.

## 5. Revenue model

1. **Affiliate commission (primary)** — the core engine described above.
2. **Featured placement fees** — once you have traffic, local sellers can pay a small weekly fee to
   be pinned to the top of a category in the WhatsApp menu ("Sponsored" tag, disclosed).
3. **WhatsApp broadcast deals** — a "Deal of the Day" opt-in list; suppliers pay to be featured in
   the broadcast (subject to WhatsApp's messaging policies — must be opt-in).
4. **Data/insights (later)** — anonymized trending-product insights sold back to suppliers.
5. **Own-brand / dropship margin (Phase 3)** — once trust + traffic exist, add a small number of
   exclusive products with real margin instead of commission.

## 6. Legal & compliance notes (Kenya-specific, non-exhaustive — verify with a professional)

- **Disclose that you're an affiliate.** FTC-style disclosure ("As an affiliate, we may earn a
  commission on qualifying purchases") builds trust and is best practice even where not strictly
  mandated locally.
- **WhatsApp Business Platform policy:** you can only send free-form messages within 24 hours of the
  user messaging you first; outside that window you must use pre-approved "template" messages
  (important for your "Deal of the Day" broadcast idea).
- **Data protection:** Kenya's Data Protection Act (2019) applies if you store customer phone
  numbers/order history — register with the ODPC as a data controller once you're operating at
  scale, and keep a clear privacy policy on the website.
- **Business registration:** operate as a sole proprietor initially (Business Name registration via
  eCitizen) — enough to open a business M-Pesa/bank account for receiving affiliate payouts; upgrade
  to a limited company once revenue justifies it.

## 7. Phased roadmap

### Phase 0 — Foundations (this repo, today)

- Brand name + logo
- Website skeleton (storefront) + WhatsApp bot skeleton (this scaffold)
- Curated seed catalog (10–20 products across a few categories, Kilimall + Jumia + AliExpress links)
- Register as affiliate on Kilimall + Jumia KOL + AliExpress + Temu

### Phase 1 — Kenya launch

- Get a WhatsApp Business number + Meta Cloud API access
- Wire the AI bot to real affiliate links with your own sub-IDs for tracking
- Launch with Reels/TikTok content driving to `wa.me/<number>?text=Hi`
- Track clicks → conversions per category to learn what sells

### Phase 2 — Optimize & expand catalog

- Add product-feed automation where affiliate programs allow it (Jumia/Amazon APIs)
- Add order-status / "where's my order" AI flows (linking out to the supplier's tracking page)
- Introduce sponsored placement for local sellers
- Add more African markets (Uganda, Nigeria — Kilimall already covers these)

### Phase 3 — Go global & add your own margin

- Add AliExpress/Temu/Amazon international content in English + other languages
- Introduce a small exclusive/dropship product line with direct margin
- Consider your own checkout for the exclusive line only (Pesapal/Flutterwave/Stripe), while
  everything else stays pure-affiliate
