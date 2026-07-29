# Deploy status notes

## Website (`sokonimall.com`)

- Cloudflare Workers Builds deploys `website/` on every `main` merge.
- Confirm: https://sokonimall.com/activity

## Bot (`bot.sokonimall.com`)

- GitHub Actions workflow **Bot Deploy** SSHes into the GCP VM and runs `scripts/deploy-bot.sh`.
- Requires secrets: `VM_HOST`, `VM_USER`, `VM_SSH_KEY` (see `DEPLOY_BOT_GCP.md`).
- If secrets are empty, the workflow fails fast with setup errors.
- Health: https://bot.sokonimall.com/health (expect HTTP 200 after a good deploy).
- `/health` also reports `wahaConfigured`, `wahaReachable`, `wahaLinked`, `wahaSessionStatus`.

## WhatsApp link (WAHA on VM)

```bash
cd ~/sokoni && git pull --rebase origin main
bash scripts/deploy-waha.sh
bash scripts/waha-link-whatsapp.sh   # if not WORKING yet
bash scripts/deploy-bot.sh
bash scripts/health-check.sh
curl -s https://bot.sokonimall.com/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('wahaLinked'), d.get('wahaSessionStatus'))"
```

Do not expose WAHA `:3000` publicly. Pairing codes / `waha-qr.png` stay on the VM (or scp locally).

## Manual bot restart (GCP VM)

```bash
cd ~/sokoni
git pull --rebase origin main
bash scripts/deploy-bot.sh   # runs db:migrate
curl -s https://bot.sokonimall.com/health
```