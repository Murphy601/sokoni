# Deploy the Sokoni bot on Google Cloud (Always Free e2-micro) + Cloudflare

Hosts the WhatsApp bot (Node/Express) + WAHA (WhatsApp, NOWEB engine) 24/7 with
HTTPS at `https://bot.sokonimall.com`. Static site stays on Cloudflare at
`https://sokonimall.com`.

The e2-micro has only **1 GB RAM**, so we:
- run WAHA with the **NOWEB** engine (no Chromium — already set in `docker-compose.waha.yml`)
- add a **2 GB swap** file

---

## Phase A — Create the GCP VM

1. Go to https://console.cloud.google.com → create or select a **project**.
2. Enable **billing** (card required, but the e2-micro below is Always Free — you won't be charged for it).
3. **Compute Engine → VM instances → Create instance:**
   - **Name:** `sokoni-bot`
   - **Region:** `us-central1` (Iowa) — MUST be a free-tier region (`us-west1`, `us-central1`, or `us-east1`). Zone: any.
   - **Machine type:** series **E2** → **`e2-micro`** (Always Free)
   - **Boot disk:** Change → **Ubuntu 22.04 LTS**, size **30 GB**, Standard persistent disk.
   - **Firewall:** check **Allow HTTP traffic** and **Allow HTTPS traffic**.
4. **Create.**

### Reserve a static IP (so DNS never breaks)

**VPC network → IP addresses → External IP addresses.** Find `sokoni-bot`'s IP, change **Type** from Ephemeral to **Static** (reserve). Note this IP.

---

## Phase B — Point bot.sokonimall.com at the VM (Cloudflare DNS)

1. Cloudflare → **sokonimall.com → DNS → Add record:**
   - Type **A**, Name **`bot`**, IPv4 = your **static IP**
   - **Proxy status: DNS only (grey cloud)** ← required for Let's Encrypt
2. Save.

---

## Phase C — Log in + prepare the VM

Use the **SSH** button next to the instance in the GCP console (opens a browser terminal — no key setup needed).

On the VM:

```bash
# 2 GB swap (critical for 1 GB RAM)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# System + tools
sudo apt update && sudo apt upgrade -y
sudo apt install -y docker.io docker-compose-plugin nginx certbot python3-certbot-nginx git

# Node.js 20 (Ubuntu's default is too old)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Docker without sudo
sudo usermod -aG docker $USER
newgrp docker
```

Clone the repo:

```bash
git clone https://github.com/Murphy601/sokoni.git
cd sokoni
```

---

## Phase D — Configure whatsapp-bot/.env

```bash
nano whatsapp-bot/.env
```

Paste (fill secrets):

```env
WAHA_API_URL=http://localhost:3000
WAHA_API_KEY=sokoni-local-dev-key
WAHA_SESSION=default

OPENAI_API_KEY=sk-or-v1-...your key...
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_MODEL=nvidia/nemotron-nano-9b-v2:free

PORT=3001
PUBLIC_SITE_URL=https://sokonimall.com

BUSINESS_WHATSAPP_NUMBER=254117422428
ADMIN_PHONES=254757764009
STORE_MARKUP_KES=100

# TikTok
TIKTOK_CLIENT_KEY=...your client key...
TIKTOK_CLIENT_SECRET=...your client secret...
TIKTOK_REDIRECT_URI=https://bot.sokonimall.com/admin/tiktok/callback
TIKTOK_SCOPES=user.info.basic,video.publish
TIKTOK_SETUP_TOKEN=sokoni_tt_setup_9f3a1c7e5b2d48a6c0e1
TIKTOK_CRON_ENABLED=true
TIKTOK_POST_TIMES=08:00,13:00,19:30
TIKTOK_TIMEZONE=Africa/Nairobi
```

Save: Ctrl+O, Enter, Ctrl+X.

---

## Phase E — Start WAHA + the bot

```bash
docker compose -f docker-compose.waha.yml up -d

cd whatsapp-bot
npm install
sudo npm install -g pm2
pm2 start src/server.js --name sokoni-bot
pm2 save
pm2 startup    # run the command it prints back
cd ..

curl http://localhost:3001/health   # expect {"status":"ok"}
```

---

## Phase F — nginx reverse proxy + HTTPS

```bash
sudo nano /etc/nginx/sites-available/bot.sokonimall.com
```

Paste:

```nginx
server {
    listen 80;
    server_name bot.sokonimall.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/bot.sokonimall.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d bot.sokonimall.com --non-interactive --agree-tos -m mikeal.murphy@snhu.edu
```

Test from your PC: `https://bot.sokonimall.com/health` → `{"status":"ok"}`

---

## Phase G — Connect WhatsApp (WAHA)

```bash
curl -X POST http://localhost:3000/api/sessions/start \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: sokoni-local-dev-key" \
  -d '{"name":"default"}'
```

Get the QR. NOWEB prints it in logs — easiest:

```bash
docker logs $(docker ps -qf "ancestor=devlikeapro/waha:latest") 2>&1 | tail -40
```

Scan the QR with the phone that owns **+254117422428** (Settings → Linked devices).

Set the webhook (WAHA → bot, same machine):

```bash
curl -X PUT http://localhost:3000/api/sessions/default \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: sokoni-local-dev-key" \
  -d '{"config":{"webhooks":[{"url":"http://localhost:3001/webhook","events":["message.any"]}]}}'
```

Test: from another phone, send `menu` to +254117422428.

---

## Phase H — TikTok OAuth

1. TikTok Developer Portal → app → register redirect URI EXACTLY:
   ```
   https://bot.sokonimall.com/admin/tiktok/callback
   ```
2. Make sure `TIKTOK_CLIENT_KEY` + `TIKTOK_CLIENT_SECRET` are in `.env`, then:
   ```bash
   pm2 restart sokoni-bot
   ```
3. Open in your browser:
   ```
   https://bot.sokonimall.com/admin/tiktok/connect?token=sokoni_tt_setup_9f3a1c7e5b2d48a6c0e1
   ```
   Approve on TikTok → "TikTok connected ✅".
4. Test one post:
   ```bash
   cd ~/sokoni && node scripts/tiktok-post.mjs
   ```

Cron posts at 08:00, 13:00, 19:30 EAT. Tokens auto-refresh.

---

## Updating later

```bash
cd ~/sokoni && git pull
cd whatsapp-bot && npm install && pm2 restart sokoni-bot
```

## Memory tips (1 GB VM)

- Check RAM: `free -h` (swap should show 2 GB).
- If WAHA is heavy, NOWEB keeps it light; avoid switching to WEBJS (Chromium).
- `pm2 restart sokoni-bot` if the bot ever OOMs.

## Security

- Regenerate the TikTok **Client secret** (shared in chat).
- Don't expose port 3000 (WAHA) — the GCP HTTP/HTTPS firewall rules only open 80/443; keep it that way.
