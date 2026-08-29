# Executive AI Operating System

Expands Boss / staff control beyond a single admin switch: **RBAC**, **daily briefings**, **voice→command**, and **numbered dispute action cards**.

See also: `docs/MASTER_AI_OBEDIENCE.md` (code interceptor + `!` palette).

## 1. Staff roles (`staff_roles`)

| Role | Tone | Key powers |
|------|------|------------|
| `SUPER_ADMIN` | Executive | Full `!` palette, system pause, state force |
| `DISPUTE_MANAGER` | Analytical | Refund/release ≤ `DISPUTE_MANAGER_REFUND_CAP_KES` (default 10 000), ban/unban |
| `LOGISTICS_LEAD` | Task-focused | Brief + agent mute; no escrow release |
| `SUPPORT_AGENT` | Service | Brief + agent mute; escalate money moves |

- Schema: `whatsapp-bot/db/schema-phase31-staff-roles.sql`
- `ADMIN_PHONES` bootstrap as `SUPER_ADMIN` on bot boot
- Upsert via `upsertStaffRole({ phone, role, displayName })`

## 2. Daily briefing + alerts

- **08:00 EAT** (configurable `BOSS_BRIEFING_HOUR_EAT`) → WhatsApp summary to admin phones  
- **`!brief`** / spoken “morning briefing” → same compose  
- **High-value escrow** ping when paid order ≥ `BOSS_HIGH_VALUE_ALERT_KES` (default 50 000)  
- **Hourly :15** stale open disputes (>30 min)

Disable: `BOSS_BRIEFING_ENABLED=false`

## 3. Voice → interceptor

Admin/staff voice notes: Whisper STT → `softMapSpokenToMasterCommand` → `executeMasterAdminCommand`  
(e.g. “override escrow for order SKN-8820 and pay the seller” → `!force-release SKN-8820`)

## 4. Dispute action cards

After dispute admin alert, WhatsApp receives:

```
🚨 DISPUTE ALERT: SKN-9912
…
*1* Refund Buyer
*2* Release to Seller
*3* Split 50/50
*4* Open portal only
```

Reply `1`–`4` on the admin line (RBAC-checked).

## Env

```bash
ADMIN_PHONES=2547…
DISPUTE_MANAGER_REFUND_CAP_KES=10000
BOSS_HIGH_VALUE_ALERT_KES=50000
BOSS_BRIEFING_HOUR_EAT=8
BOSS_BRIEFING_TZ=Africa/Nairobi
BOSS_BRIEFING_ENABLED=true
```

## Deploy

Migrate DB (`phase31`), then `SKIP_WAHA_DEPLOY=1 bash scripts/deploy-bot.sh`.
