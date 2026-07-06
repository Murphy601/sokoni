# TikTok automation (backend only)

Sokoni can auto-post product photos to your **admin TikTok account** ~3× daily. Posts are **not configured on the website** — only the resulting product IDs appear under **Viral Bargains** via `website/data/tiktok-featured.json`.

## How it works

1. **Connect once** via OAuth (tokens saved to `whatsapp-bot/data/tiktok-oauth.json`).
2. **Auto-refresh** — access tokens renew every ~24h without manual `.env` updates.
3. **Cron** posts at **8:00 AM, 1:00 PM, and 7:30 PM EAT** (or set `TIKTOK_POST_TIMES`), via `TIKTOK_CRON_ENABLED=true` on the bot or system cron running `scripts/tiktok-post.mjs`.
4. Script picks a random in-stock product, AI writes the caption, TikTok API publishes the photo.
5. Post metadata syncs to `website/data/tiktok-featured.json`.

## One-time OAuth connect

### 1. TikTok Developer Portal

1. Create an app at [developers.tiktok.com](https://developers.tiktok.com/).
2. Enable **Login Kit** and **Content Posting API** (photo posts).
3. Add redirect URI (must match exactly, HTTPS in production):

   ```
   http://localhost:3001/admin/tiktok/callback
   ```

   Production example:

   ```
   https://your-bot-host.example.com/admin/tiktok/callback
   ```

4. Request scopes: `user.info.basic`, `video.publish`.

### 2. Environment

In `whatsapp-bot/.env`:

```env
TIKTOK_CLIENT_KEY=your_client_key
TIKTOK_CLIENT_SECRET=your_client_secret
TIKTOK_REDIRECT_URI=http://localhost:3001/admin/tiktok/callback
TIKTOK_SCOPES=user.info.basic,video.publish
TIKTOK_SETUP_TOKEN=pick-a-long-random-secret
PUBLIC_SITE_URL=https://your-live-site.com
TIKTOK_CRON_ENABLED=true
```

You do **not** need to set `TIKTOK_ACCESS_TOKEN` after OAuth — it is stored and refreshed automatically in `data/tiktok-oauth.json`.

### 3. Connect your TikTok account

```bash
# Terminal 1 — start the bot
cd whatsapp-bot && npm start

# Terminal 2 — print the connect URL
node scripts/tiktok-connect.mjs
```

Open the printed URL in your browser, log in to TikTok, approve permissions. You should see “TikTok connected ✅”.

Check status anytime:

```
http://localhost:3001/admin/tiktok/status?token=YOUR_TIKTOK_SETUP_TOKEN
```

## Token refresh (automatic)

- **Access token** expires in ~24 hours → bot refreshes using the refresh token before posting.
- **Refresh token** valid ~365 days → if it expires, run `tiktok-connect.mjs` again (one-time re-auth).
- Scheduler runs every 6 hours and on bot startup if access is expiring within 2 hours.

Optional bootstrap (migrate existing tokens once):

```env
TIKTOK_ACCESS_TOKEN=...
TIKTOK_REFRESH_TOKEN=...
```

On first run these are copied into `data/tiktok-oauth.json`; env vars are no longer needed for daily operation.

## Manual test (dry-run)

Without OAuth connected, the job logs the caption and image URL but does not post:

```bash
node scripts/tiktok-post.mjs
```

## System cron (production)

Matches default EAT peak hours (8:00, 13:00, 19:30):

```cron
0 8,13 * * * cd /path/to/sokoni && node scripts/tiktok-post.mjs >> /var/log/sokoni-tiktok.log 2>&1
30 19 * * * cd /path/to/sokoni && node scripts/tiktok-post.mjs >> /var/log/sokoni-tiktok.log 2>&1
```

Or rely on `TIKTOK_CRON_ENABLED=true` on the bot (uses `TIKTOK_POST_TIMES` + `TIKTOK_TIMEZONE`).

## WhatsApp handoff

Customers from TikTok can message **TikTokDeals**, **viral bargains**, or mention TikTok — the bot shows recent featured items.
