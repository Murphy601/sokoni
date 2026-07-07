# Deploy the Sokoni bot on Oracle Cloud (Always Free) + Cloudflare

Hosts the WhatsApp bot (Node/Express) + WAHA (WhatsApp) 24/7 with HTTPS at
`https://bot.sokonimall.com`. The static site stays on Cloudflare Workers at
`https://sokonimall.com`.

Result:
- `https://sokonimall.com` → storefront (already live)
- `https://bot.sokonimall.com` → bot API + TikTok OAuth callback + WAHA webhook

---

## Phase A — Create the Oracle VM

1. Sign up / log in at https://www.oracle.com/cloud/free/
2. **Compute → Instances → Create instance.**
3. Settings:
   - **Image:** Ubuntu 22.04 (or 24.04)
   - **Shape:** `VM.Standard.A1.Flex` (Ampere ARM, Always Free) — 1–2 OCPU, 6 GB RAM is plenty.
   - **SSH keys:** Download/save the private key (you'll need it to log in).
4. Create. Note the **Public IP address** once it's running.

### Open firewall ports (Ingress rules)

**Networking → Virtual Cloud Networks → your VCN → Security Lists → Default → Add Ingress Rules.**

Add these (Source CIDR `0.0.0.0/0`):
| Port | Purpose |
|------|---------|
| 22 | SSH |
| 80 | HTTP (Let's Encrypt) |
| 443 | HTTPS |

> Keep WAHA (3000) and bot (3001) internal — nginx fronts them. Don't expose 3000 publicly.

Also open them in the VM's own firewall later (Phase C).

---

## Phase B — Point bot.sokonimall.com at the VM (Cloudflare DNS)

1. Cloudflare dashboard → **sokonimall.com → DNS → Records → Add record.**
2. Type: **A**
   - **Name:** `bot`
   - **IPv4 address:** your Oracle **Public IP**
   - **Proxy status:** **DNS only (grey cloud)** ← important so Let's Encrypt can verify. You can switch to proxied later.
3. Save. Test from your PC: `ping bot.sokonimall.com` should resolve to the VM IP.

---

## Phase C — Install everything on the VM

SSH in (from your PC):

```bash
ssh -i path\to\your-key.key ubuntu@YOUR_VM_IP
```

Then on the VM:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y docker.io docker-compose-plugin nodejs npm nginx certbot python3-certbot-nginx git
sudo usermod -aG docker $USER
newgrp docker

# Ubuntu firewall
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || true
```

Clone the repo:

```bash
git clone https://github.com/Murphy601/sokoni.git
cd sokoni
```

---

## Phase D — Configure the bot .env on the server

```bash
nano whatsapp-bot/.env
```

Paste (fill in secrets):

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

Save (Ctrl+O, Enter, Ctrl+X).

---

## Phase E — Start WAHA + the bot

```bash
# WAHA (WhatsApp) via Docker
docker compose -f docker-compose.waha.yml up -d

# Bot
cd whatsapp-bot
npm install
sudo npm install -g pm2
pm2 start src/server.js --name sokoni-bot
pm2 save
pm2 startup    # run the command it prints
cd ..
```

Check the bot is up locally:

```bash
curl http://localhost:3001/health   # {"status":"ok"}
```

---

## Phase F — nginx reverse proxy + HTTPS

Create the site config:

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

Enable + get SSL:

```bash
sudo ln -s /etc/nginx/sites-available/bot.sokonimall.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d bot.sokonimall.com --non-interactive --agree-tos -m mikeal.murphy@snhu.edu
```

Test from your PC:

```
https://bot.sokonimall.com/health   → {"status":"ok"}
```

---

## Phase G — Connect WhatsApp (WAHA)

Start a session and scan the QR with the phone that owns **+254117422428**:

```bash
curl -X POST http://localhost:3000/api/sessions/start \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: sokoni-local-dev-key" \
  -d '{"name":"default"}'
```

Open the QR (SSH tunnel from your PC, since 3000 isn't public):

```bash
ssh -i your-key.key -L 3000:localhost:3000 ubuntu@YOUR_VM_IP
# then on your PC browser:
http://localhost:3000/api/default/auth/qr?x-api-key=sokoni-local-dev-key
```

Set the webhook so WAHA delivers messages to the bot (same machine):

```bash
curl -X PUT http://localhost:3000/api/sessions/default \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: sokoni-local-dev-key" \
  -d '{"config":{"webhooks":[{"url":"http://localhost:3001/webhook","events":["message.any"]}]}}'
```

Test: send `menu` to +254117422428 from another phone.

---

## Phase H — TikTok OAuth (auto-posting)

1. TikTok Developer Portal → your app → **Login Kit / Redirect URI**, register EXACTLY:
   ```
   https://bot.sokonimall.com/admin/tiktok/callback
   ```
2. Ensure `TIKTOK_CLIENT_KEY` + `TIKTOK_CLIENT_SECRET` are in `.env`, then restart:
   ```bash
   pm2 restart sokoni-bot
   ```
3. From your PC, open the connect URL:
   ```
   https://bot.sokonimall.com/admin/tiktok/connect?token=sokoni_tt_setup_9f3a1c7e5b2d48a6c0e1
   ```
4. Log in to TikTok, approve. You should see "TikTok connected ✅".
5. Check status:
   ```
   https://bot.sokonimall.com/admin/tiktok/status?token=sokoni_tt_setup_9f3a1c7e5b2d48a6c0e1
   ```
6. Test one post immediately:
   ```bash
   cd ~/sokoni && node scripts/tiktok-post.mjs
   ```

Tokens auto-refresh — no manual rotation. Cron posts at 08:00, 13:00, 19:30 EAT.

---

## Updating later

```bash
cd ~/sokoni
git pull
cd whatsapp-bot && npm install && pm2 restart sokoni-bot
```

## Security reminders

- Regenerate the TikTok **Client secret** (it was shared in chat).
- Rotate the OpenRouter key if it was ever shared.
- Don't expose port 3000 (WAHA) publicly.
