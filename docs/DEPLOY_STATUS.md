# Deploy status notes

## Website (`sokonimall.com`)

- Cloudflare Workers Builds deploys `website/` on every `main` merge.
- Confirm: https://sokonimall.com/activity

## Bot (`bot.sokonimall.com`)

- GitHub Actions workflow **Bot Deploy** SSHes into the GCP VM and runs `scripts/deploy-bot.sh`.
- Requires secrets: `VM_HOST`, `VM_USER`, `VM_SSH_KEY` (see `DEPLOY_BOT_GCP.md`).
- If secrets are empty, the workflow fails fast with setup errors.
- Health: https://bot.sokonimall.com/health (expect HTTP 200 after a good deploy).

## Manual bot restart (GCP VM)

```bash
cd ~/sokoni
git pull --rebase origin main
# Apply new schema columns (e.g. social_wa_notify_* per-event mutes)
psql "$DATABASE_URL" -f whatsapp-bot/db/schema-phase10-social.sql
bash scripts/deploy-bot.sh
curl -s https://bot.sokonimall.com/health
```

`deploy-bot.sh` may already run migrations — if so, the explicit `psql` step is optional.