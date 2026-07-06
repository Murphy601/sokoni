# Sokoni Store (Pay-on-Delivery)

This is the model Sokoni runs on **right now**, so you don't have to wait for
affiliate approvals to start selling. Customers just see "Sokoni Store" — the
words "reseller/dropship" are never shown to them.

## How it works

1. You pick winning products from a supplier (Jumia, Kilimall, or a wholesale
   market like Gikomba / River Road).
2. They're listed in the store at **your price = supplier cost + margin**. The
   current rule is a flat **+ KES 100** (buy at 300 → sell at 400).
3. A customer orders through the website or the WhatsApp bot.
4. They **pay on delivery** — cash or M-Pesa to the rider. No paying upfront,
   which removes the #1 trust problem for a new brand.
5. You place the actual order with the supplier / buy from the wholesaler, and
   deliver.

## Where you add / edit products — ONE file

You edit **only** the master catalog:

```
whatsapp-bot/src/data/products.json
```

Then regenerate the public website catalog with one command:

```
node scripts/build-site-catalog.mjs
```

That command writes `website/data/products.json` for you, automatically:

- strips your **cost price** (`sourcePriceKes`) and **supplier** so customers
  never see them,
- keeps only your selling price,
- so you never hand-edit two files or leak private data.

> You do **not** edit the website HTML to add products. Products live in the
> JSON catalog; the site and the bot both read from it.

## The product data model

A store item in the master file looks like this:

```json
{
  "id": "pt-001",
  "name": "Tecno Spark 20C 128GB + 4GB RAM",
  "category": "phones-tablets",
  "subcategory": "smartphones",
  "sourcePriceKes": 13499,
  "priceKes": 13599,
  "rating": 4.5,
  "reviews": 2100,
  "source": "jumia",
  "sourceUrl": "https://www.jumia.co.ke/catalog/?q=tecno+spark+20c",
  "imageUrl": "https://images.example.com/tecno-spark-20c.jpg",
  "emoji": "📱",
  "tags": ["smartphone", "camera", "battery"],
  "scope": "local",
  "fulfillment": "store",
  "payment": "cod"
}
```

| Field            | Meaning                                                       |
| ---------------- | ------------------------------------------------------------ |
| `sourcePriceKes` | What it costs **you** from the supplier (private).           |
| `priceKes`       | What the customer pays = `sourcePriceKes` + your margin.     |
| `source`         | Supplier, for **your** reference only (private).             |
| `sourceUrl`      | Where **you** buy it to fulfil (private).                    |
| `fulfillment`    | `"store"` — shows the pay-on-delivery "Order" button.       |
| `payment`        | `"cod"` — pay on delivery.                                    |

## Adding a real product in ~20 seconds

1. Find the item on Jumia/Kilimall/wholesale; note the real price.
2. Copy any object in the master file; give it a new unique `id`.
3. Set `sourcePriceKes` to the real cost and `priceKes = sourcePriceKes + 100`.
4. Set `category` + `subcategory` to ones that already exist (see the tree
   below) so it appears in the menus.
5. Run **`node scripts/sync-catalog.mjs`** — this auto-generates product photos and
   rebuilds the website catalog. **You never add images manually.**

## Automatic product images

Every product gets a **realistic photo that matches its name** — automatically.

When you add or rename an item, run:

```
node scripts/sync-catalog.mjs
```

That command:

1. **Generates/fetches images** for any new or renamed products (skips ones that
   already have a matching image).
2. **Rebuilds** `website/data/products.json` for the storefront.

Images are saved to `website/assets/images/products/{id}.jpg` and appear on
both the **website** and the **WhatsApp bot** (as product photo messages).

**How images are sourced (automatic, no manual work):**

| Priority | Source | Setup |
| -------- | ------ | ----- |
| 1 (best) | Google Images via [Serper](https://serper.dev) | Set `SERPER_API_KEY` in env (free tier) — real product photos |
| 2 (default) | Pollinations AI | No key needed — AI generates a studio product photo from the item name |

Optional env vars (in `scripts/.env` or your shell):

```
SERPER_API_KEY=              # optional — real Google product photos
IMAGE_FETCH_DELAY_MS=2500      # pause between API calls (avoid rate limits)
PUBLIC_SITE_URL=https://yoursite.com   # for WhatsApp image links (bot .env too)
```

If you **rename** a product, the script detects the change (`imageKey`) and
generates a new matching image. Use `--force` to regenerate everything:

```
node scripts/enrich-product-images.mjs --force
node scripts/build-site-catalog.mjs
```

## Category tree (mirrors Jumia)

| Category (`category`) | Subcategories (`subcategory`) |
| --------------------- | ------------------------------ |
| `phones-tablets`      | smartphones, tablets, power-banks, phone-accessories |
| `tvs-audio`           | televisions, headphones, speakers, home-theatre |
| `appliances`          | kitchen-appliances, kettles, blenders, irons, washing-machines |
| `health-beauty`       | skincare, haircare, makeup, personal-care, fragrances |
| `home-office`         | kitchen-dining, bedding, cleaning, home-decor, stationery |
| `fashion`             | mens-fashion, womens-fashion, shoes, bags, watches |
| `computing`           | laptops, printers, storage, computer-accessories |
| `gaming`              | consoles, controllers, gaming-accessories |
| `supermarket`         | food-cupboard, drinks, household-supplies |
| `baby-products`       | diapering, feeding, toys, baby-gear |

Add a new subcategory by using it on a product **and** adding a row in
`whatsapp-bot/src/services/menu.js` (`CATEGORY_SUBMENUS`) so it shows in the bot
menu. The website picks up categories automatically.

### Why we can't "import all of Jumia" automatically

The JForce link (`jforce.jumia.co.ke/s/...`) just redirects to the whole Jumia
Kenya homepage with your affiliate tag — it's not a curated feed. Mirroring
Jumia's entire catalogue isn't feasible (prices are JavaScript-rendered and
change constantly) and mass-copying a retailer's catalogue would be a legal
problem. The seeded items are a **starter set** across the tree above — curate
the ones you actually want to sell.

## Configuration (bot `.env`)

```
BUSINESS_WHATSAPP_NUMBER=2547XXXXXXXX   # your selling number
STORE_MARKUP_KES=100                    # flat margin per item
STORE_COD_AREAS=Nairobi & environs
STORE_DELIVERY_NOTE=Delivery in 1-3 days within Nairobi; countrywide via courier. Pay cash/M-Pesa on delivery.
ADMIN_NOTIFY_URL=                       # optional webhook to receive new orders
```

Also update `WHATSAPP_NUMBER` at the top of `website/assets/js/app.js` to your
real number so the website "Order" buttons open a chat with you.

## Order flow in the bot

1. Customer taps **🛒 Order (COD)** on a product card.
2. Bot asks for name + delivery location + phone.
3. Customer replies in one message; the bot confirms, logs the order, and (if
   `ADMIN_NOTIFY_URL` is set) POSTs the order to your webhook.
4. You arrange delivery and collect payment on arrival.
