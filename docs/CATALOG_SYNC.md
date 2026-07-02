# Automated Catalog Sync

Keeps product **prices** and **availability** fresh by re-checking each supplier once a day and
committing any changes back to the repo. Both catalog files are updated together so the website and
the WhatsApp bot never drift apart:

- `website/data/products.json`
- `whatsapp-bot/src/data/products.json`

The script lives in `scripts/sync/` and uses **only Node.js built-ins** (no extra `npm install`).

## The honest reality: what's automatable vs manual

There is **no single API** that unifies every supplier's live inventory. Each program is different:

| Source | Auto price/stock? | How | Notes |
| --- | --- | --- | --- |
| **Amazon** | ✅ Yes | Product Advertising API (PA-API 5.0) | Needs an approved Associates account **with API access** (requires ~3 qualifying sales). Returns price + availability, not rating/reviews. |
| **AliExpress** | ✅ Yes | Affiliate Open Platform API | Needs an approved affiliate app (key + secret). Returns sale price + link. |
| **Kilimall** | ⚠️ Best-effort only | Reads schema.org JSON-LD off the product page (opt-in) | No public product API. Fragile + ToS-sensitive. **Off by default.** |
| **Jumia** | ⚠️ Best-effort only | Same JSON-LD reader (opt-in) | Jumia has a *limited* feed for some approved KOL affiliates — prefer that if you get access. |
| **Temu** | ❌ Effectively manual | JSON-LD reader rarely works (heavy anti-bot) | Expect to update Temu items by hand. |

So: **Amazon + AliExpress can be truly automatic.** Kilimall/Jumia/Temu are best kept **manual**
(edit the JSON) unless you explicitly opt into the structured-data reader and accept its limits.

## How it works

1. Loads both catalog files and merges them by product `id`.
2. Groups products by `source` and hands each group to its provider:
   - `providers/amazon.mjs` — signed PA-API `GetItems` (AWS SigV4).
   - `providers/aliexpress.mjs` — signed affiliate `productdetail.get`.
   - `providers/structuredData.mjs` — fetches the page and parses `Product` JSON-LD (opt-in).
3. Each provider returns `{ priceUsd?, priceKes?, inStock?, rating?, reviews? }` per product.
4. The orchestrator applies changes to **both** files, stamps `lastSyncedAt`, and writes them out.
5. Out-of-stock items (`inStock: false`) are automatically hidden from the website and from the
   bot's search/deal results.

**Safety by design:** a provider with no credentials is *skipped*, not failed — so the script always
exits cleanly and never wipes your data. Nothing changes unless a provider returns fresh values.

## Identifying products for the APIs

The API providers need a real product identifier. They resolve it in this order:

- **Amazon:** an `"asin"` field on the product, else an ASIN parsed from a `/dp/<ASIN>` `sourceUrl`.
- **AliExpress:** an `"externalId"` field, else the id parsed from a `/item/<id>.html` `sourceUrl`.

The seed catalog uses placeholder URLs, so add real ones as you curate products, e.g.:

```json
{ "id": "intl-002", "source": "amazon", "asin": "B0CHX3QBCH", "sourceUrl": "https://www.amazon.com/dp/B0CHX3QBCH" }
```

## Run it locally

Dry-run (shows what *would* change, writes nothing):

```bash
node scripts/sync/sync.mjs --dry-run
```

Real run using a local env file (Node 20.6+):

```bash
cp scripts/sync/.env.example scripts/sync/.env   # fill in your keys
node --env-file=scripts/sync/.env scripts/sync/sync.mjs
```

With no credentials set, every provider is skipped and you'll see `No catalog changes.` — that's the
expected "wired up correctly" result before you add keys.

## Run it automatically every 24h (GitHub Actions)

The workflow `.github/workflows/catalog-sync.yml` runs daily at **03:00 UTC** (and on-demand via the
Actions tab), then auto-commits any catalog changes back to `main`.

Add your credentials in the repo under **Settings → Secrets and variables → Actions**:

**Secrets** (sensitive):

- `AMAZON_ACCESS_KEY`, `AMAZON_SECRET_KEY`, `AMAZON_PARTNER_TAG`
- `ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET`, `ALIEXPRESS_TRACKING_ID`

**Variables** (non-sensitive, optional):

- `AMAZON_HOST`, `AMAZON_REGION`, `AMAZON_MARKETPLACE` (defaults target the US marketplace)
- `ALIEXPRESS_TARGET_CURRENCY` (default `USD`), `ALIEXPRESS_TARGET_LANGUAGE` (default `EN`)
- `SOKONI_ENABLE_SCRAPE` — set to `true` only if you want the opt-in JSON-LD reader to run in CI

The job needs write access to push commits; the workflow already declares `permissions: contents: write`.
The commit message includes `[skip ci]` so it won't trigger other workflows.

## Caveats to keep in mind

- **PA-API** is rate-limited and requires ongoing qualifying sales to keep API access — if it's
  revoked, the provider simply logs an error and the rest of the sync still runs.
- **AliExpress** has revised its gateway/signing more than once. If calls return an auth error,
  re-check the current Open Platform signing docs and adjust `providers/aliexpress.mjs`.
- **Scraping** (`SOKONI_ENABLE_SCRAPE=true`) is best-effort and can break any time a site changes its
  markup, and may conflict with a site's Terms of Service / `robots.txt` — verify before enabling.
- The sync only *updates existing* products; it never adds or removes items. Curating which products
  are in the catalog stays a human decision.
