# Go live with WAHA (free / low-cost)

Sokoni uses **WAHA** (WhatsApp HTTP API) — not Meta Cloud API. You scan a QR code with your
real WhatsApp number (`+254117422428`) and the bot sends/receives messages through WAHA.

**Important:** Quick-reply buttons are unreliable on WAHA. Sokoni uses **numbered text menus**
(e.g. reply `1`, `2`, `3`).

---

## What you need (all can be free)

| Piece | Free option | Purpose |
| --- | --- | --- |
| WAHA | Docker on Oracle Cloud Always Free VM | WhatsApp connection |
| Sokoni bot | Same VM (Node.js) | AI + menus + orders |
| Website + images | Cloudflare Pages | Product photos for WhatsApp |
| AI | OpenRouter free model | `google/gemma-2-9b-it:free` |
| Image search | Serper (optional) | Auto product photos when adding items |

**Recommended:** one **Oracle Cloud Always Free** ARM VM runs WAHA + the bot. Host the static
website on **Cloudflare Pages** (free HTTPS CDN).

---

## Step 1 — Prepare your `.env` files

Already created locally (not committed to git):

**`whatsapp-bot/.env`**

```env
WAHA_API_URL=http://localhost:3000
WAHA_SESSION=default
OPENAI_API_KEY=sk-or-v1-...          # OpenRouter key
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_MODEL=google/gemma-2-9b-it:free
PORT=8080
PUBLIC_SITE_URL=https://YOUR-SITE.pages.dev
BUSINESS_WHATSAPP_NUMBER=254117422428
```

**`scripts/.env`**

```env
SERPER_API_KEY=your_serper_key
```

> **Security:** You pasted API keys in chat. After go-live, rotate Serper + OpenRouter keys in
> their dashboards and update `.env`.

---

## Step 2 — Run WAHA locally (test on your PC first)

### Install Docker Desktop (Windows)

Download from https://www.docker.com/products/docker-desktop/

### Start WAHA

From the project root:

```bash
docker compose -f docker-compose.waha.yml up -d
```

Open **http://localhost:3000** in your browser (WAHA dashboard).

### Create a session + scan QR

```bash
curl -X POST http://localhost:3000/api/sessions/start \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: sokoni-local-dev-key" \
  -d "{\"name\": \"default\"}"
```

Then open the QR code — **browsers can't send API headers**, so use one of these:

**Option A — URL with key (easiest):**  
http://localhost:3000/api/default/auth/qr?x-api-key=sokoni-local-dev-key

**Option B — Dashboard:**  
http://localhost:3000/dashboard (login: `admin` / `sokoni`)

Scan with WhatsApp on the phone that has **+254117422428**.

Wait until session status is `WORKING`:

```bash
curl http://localhost:3000/api/sessions/default \
  -H "X-Api-Key: sokoni-local-dev-key"
```

---

## Step 3 — Start the Sokoni bot locally

```bash
cd whatsapp-bot
npm install
npm run dev
```

Bot listens on **http://localhost:3001** (website uses 8080 separately).

### Point WAHA webhook at the bot

While testing locally, expose the bot with **ngrok** (free):

```bash
ngrok http 3001
```

Copy the HTTPS URL (e.g. `https://abc123.ngrok-free.app`) and configure WAHA:

```bash
curl -X PUT http://localhost:3000/api/sessions/default \
  -H "Content-Type: application/json" \
  -d "{
    \"config\": {
      \"webhooks\": [{
        \"url\": \"https://abc123.ngrok-free.app/webhook\",
        \"events\": [\"message.any\"]
      }]
    }
  }"
```

### Test

Send **menu** to **+254117422428** from another phone. You should get a numbered menu. Reply **1**
to browse categories.

Simulate locally without WhatsApp:

```bash
curl -X POST http://localhost:3001/webhook \
  -H "Content-Type: application/json" \
  -d "{\"event\":\"message\",\"session\":\"default\",\"payload\":{\"from\":\"254712345678@c.us\",\"body\":\"menu\",\"fromMe\":false}}"
```

---

## Step 4 — Deploy the website (free — Cloudflare Pages)

1. Push this repo to GitHub.
2. Go to https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → connect repo.
3. Build settings:
   - **Build command:** (leave empty)
   - **Build output directory:** `website`
4. Deploy. Your site will be at `https://your-project.pages.dev`.
5. Update `PUBLIC_SITE_URL` in `whatsapp-bot/.env` to that URL (WhatsApp needs public HTTPS images).

Regenerate catalog + images after edits:

```bash
node scripts/sync-catalog.mjs
```

Commit updated `website/data/products.json` and `website/assets/images/products/` so Pages serves them.

---

## Step 5 — Deploy WAHA + bot (free — Oracle Cloud VM)

This is the best free option for **production** because WAHA needs Docker running 24/7.

### 5a. Create Oracle Always Free VM

1. Sign up at https://www.oracle.com/cloud/free/
2. Create an **Ampere A1** VM (Ubuntu 22.04), open ports **22**, **80**, **443**, **3000**, **8080**
   in the security list / firewall.
3. SSH in: `ssh ubuntu@YOUR_VM_IP`

### 5b. Install Docker + Node on the VM

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git nodejs npm
sudo usermod -aG docker $USER
newgrp docker
```

### 5c. Clone Sokoni and configure

```bash
git clone https://github.com/YOUR_USER/sokoni.git
cd sokoni
cp whatsapp-bot/.env.example whatsapp-bot/.env
nano whatsapp-bot/.env   # paste your keys, set PUBLIC_SITE_URL
```

Set `WAHA_API_URL=http://localhost:3000` on the same machine.

### 5d. Start WAHA

```bash
docker compose -f docker-compose.waha.yml up -d
```

Scan QR again (session data is stored in Docker volume). Use your phone with +254117422428.

If you already scanned locally, you may need to re-scan on the server (WhatsApp allows one linked
device session per WAHA instance).

### 5e. Start the bot (keep running)

```bash
cd whatsapp-bot
npm install
npm install -g pm2
pm2 start src/server.js --name sokoni-bot
pm2 save
pm2 startup
```

### 5f. Set production webhook (no ngrok)

Replace `YOUR_VM_IP` with your public IP or domain:

```bash
curl -X PUT http://localhost:3000/api/sessions/default \
  -H "Content-Type: application/json" \
  -d "{
    \"config\": {
      \"webhooks\": [{
        \"url\": \"http://YOUR_VM_IP:8080/webhook\",
        \"events\": [\"message.any\"]
      }]
    }
  }"
```

For HTTPS, put **nginx + Let's Encrypt** in front (recommended before real customers):

- `https://bot.yourdomain.com/webhook` → `localhost:8080`
- Block public access to port 3000 (WAHA admin) except your IP

---

## Step 6 — How customers use Sokoni

1. Customer opens **https://wa.me/254117422428** (website links already use this number).
2. They type **menu** or **hi**.
3. Bot sends numbered options — they reply **1**, **2**, etc.
4. On a product, reply **1** to order (pay on delivery), **2** to ask AI.
5. New COD orders are forwarded to **254117422428** on WhatsApp automatically.

---

## Menu flow (numbered)

```
Main menu
  1 Browse Categories → pick category number → pick sub-category → see products
  2 Today's Picks
  3 Track My Order
  4 Talk to a Human
  5 How Sokoni Works

After each product:
  1 Order (pay on delivery)
  2 Ask about it
  3 Main menu
```

Type **menu** anytime to restart.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Bot doesn't reply | Check WAHA session is `WORKING`; check webhook URL reaches bot (`curl /health`) |
| Images don't show in WhatsApp | Set `PUBLIC_SITE_URL` to live HTTPS site; run `sync-catalog.mjs` |
| QR won't scan | Use the phone with +254117422428; unlink old WAHA sessions |
| AI errors | Check OpenRouter credits/free tier; try another free model on OpenRouter |
| Orders not notifying you | `BUSINESS_WHATSAPP_NUMBER=254117422428` in `.env` |

---

## Files reference

| File | Role |
| --- | --- |
| `docker-compose.waha.yml` | Runs WAHA locally / on VM |
| `whatsapp-bot/.env` | Bot + WAHA + OpenRouter config |
| `whatsapp-bot/src/services/whatsapp.js` | Sends text/images via WAHA |
| `whatsapp-bot/src/services/menu.js` | Numbered menus |
| `website/assets/js/app.js` | WhatsApp number for site links |

---

## Alternative: split hosting

If Oracle feels heavy, you can split:

- **Cloudflare Pages** — website (free)
- **Render free tier** — bot only (sleeps when idle; first message may be slow)
- **Oracle VM** — WAHA only (must stay awake)

WAHA and the bot must be able to talk to each other (`WAHA_API_URL` must reach WAHA).
