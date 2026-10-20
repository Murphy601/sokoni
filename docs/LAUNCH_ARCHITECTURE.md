# Launch architecture (Sokoni — additive on live stack)

Sokoni does **not** replace file-backed SKN orders or INT rider IDs with the greenfield UUID schema.
Launch fail-safes are layered on the existing bot:

1. **State machine** — `src/lib/status-transitions.js` gates `updateOrderStatus` and documents custody/dispatch transitions. Cancel after pickup/`IN_TRANSIT` is rejected unless `force` (admin/dispute/no-show return).
2. **Per-user WhatsApp rate limit** — `middleware/wa-user-rate-limit.js` (~10 msgs/min/user) before menus/AI; spam gets a static reply (no LLM).
3. **Audit logs** — `audit_logs` (phase30) + `writeAuditLog` on order status changes and rider ACCEPT / PICKUP / CONFIRM.

IP webhook limiting remains in `middleware/security.js` (`webhookLimiter`).
