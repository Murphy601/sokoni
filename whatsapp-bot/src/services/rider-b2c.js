/**
 * Sokoni rider delivery-fee B2C — Daraja BusinessPayment for CLEARED rider_payouts.
 * Reuses existing daraja-mpesa + ResultURL; originator ids are prefixed skrboda-.
 */
import { isDbEnabled, query } from "../db/pool.js";
import {
  initiateB2CPayout,
  isB2CReady,
  b2cMeta,
} from "./daraja-mpesa.js";

function normalizePhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9 && /^[17]/.test(d)) d = `254${d}`;
  return d.length >= 12 && d.length <= 15 ? d : "";
}

async function ensureColumns() {
  await query(`
    ALTER TABLE rider_payouts
      ADD COLUMN IF NOT EXISTS b2c_conversation_id VARCHAR(64),
      ADD COLUMN IF NOT EXISTS b2c_originator_id VARCHAR(64),
      ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS mpesa_receipt VARCHAR(64)
  `);
}

/**
 * Aggregate CLEARED rider balances (>= minKes) and kick Daraja B2C.
 */
export async function processRiderB2CPayouts({ minKes = 100, limit = 10 } = {}) {
  if (!isDbEnabled()) return { ok: false, skipped: true, reason: "database_not_configured" };
  if (!isB2CReady()) {
    console.log("[rider-b2c] skipped — B2C not configured");
    return { ok: false, skipped: true, reason: "b2c_not_configured", meta: b2cMeta() };
  }

  try {
    await ensureColumns();
  } catch (err) {
    console.warn("[rider-b2c] columns:", err.message);
  }

  const { rows } = await query(
    `SELECT r.id AS rider_id, r.full_name, r.phone, SUM(p.amount)::numeric AS total_amount
       FROM rider_payouts p
       JOIN riders r ON p.rider_id = r.id
      WHERE p.status = 'CLEARED'
        AND r.verification_status = 'VERIFIED'
      GROUP BY r.id, r.full_name, r.phone
     HAVING SUM(p.amount) >= $1
      ORDER BY SUM(p.amount) DESC
      LIMIT $2`,
    [Math.max(1, Number(minKes) || 100), Math.min(Math.max(Number(limit) || 10, 1), 25)]
  );

  if (!rows.length) {
    return { ok: true, triggered: 0, message: "No pending cleared rider balances." };
  }

  let triggered = 0;
  for (const row of rows) {
    const amount = Math.floor(Number(row.total_amount) || 0);
    const phone = normalizePhone(row.phone);
    if (!phone || amount < 1) continue;

    const originator = `skrboda${row.rider_id}-${Date.now().toString(36).slice(-6)}`.slice(0, 36);

    const result = await initiateB2CPayout({
      phone,
      amount,
      remarks: "Sokoni Mall delivery earnings",
      occasion: "DeliveryPayout",
      orderId: `RIDER-${row.rider_id}`,
      originatorConversationId: originator,
    });

    if (!result.ok && !result.accepted) {
      console.warn("[rider-b2c] rejected", row.rider_id, result.message);
      continue;
    }

    const conversationId = result.conversationId || result.response?.ConversationID || null;
    await query(
      `UPDATE rider_payouts SET
         status = 'PROCESSING',
         b2c_conversation_id = COALESCE($2, b2c_conversation_id),
         b2c_originator_id = $3
       WHERE rider_id = $1 AND status = 'CLEARED'`,
      [row.rider_id, conversationId, originator]
    );
    triggered += 1;
    console.log(
      `[rider-b2c] triggered KES ${amount} → ${row.full_name} (${phone}) originator=${originator}`
    );
  }

  return { ok: true, triggered };
}

/**
 * Apply Safaricom B2C ResultURL to rider_payouts rows (skrboda originators).
 */
export async function applyRiderB2CResult(parsed) {
  if (!parsed?.valid || !isDbEnabled()) return { matched: false };
  const conversationId = parsed.conversationId || null;
  const originator = parsed.originatorConversationId || null;
  if (!conversationId && !originator) return { matched: false };

  try {
    await ensureColumns();
  } catch {
    /* ignore */
  }

  const { rows } = await query(
    `SELECT DISTINCT rider_id FROM rider_payouts
      WHERE status = 'PROCESSING'
        AND (
          ($1::text IS NOT NULL AND b2c_conversation_id = $1)
          OR ($2::text IS NOT NULL AND b2c_originator_id = $2)
        )`,
    [conversationId, originator]
  );
  if (!rows.length) return { matched: false };

  if (parsed.success) {
    const receipt = parsed.receipt || parsed.transactionId || null;
    await query(
      `UPDATE rider_payouts SET
         status = 'PAID',
         paid_at = NOW(),
         mpesa_receipt = COALESCE($3, mpesa_receipt)
       WHERE status = 'PROCESSING'
         AND (
           ($1::text IS NOT NULL AND b2c_conversation_id = $1)
           OR ($2::text IS NOT NULL AND b2c_originator_id = $2)
         )`,
      [conversationId, originator, receipt]
    );

    for (const row of rows) {
      try {
        const info = await query(
          `SELECT r.phone, COALESCE(SUM(p.amount),0)::numeric AS total
             FROM rider_payouts p
             JOIN riders r ON r.id = p.rider_id
            WHERE p.rider_id = $1
              AND (
                ($2::text IS NOT NULL AND p.b2c_conversation_id = $2)
                OR ($3::text IS NOT NULL AND p.b2c_originator_id = $3)
              )
            GROUP BY r.phone`,
          [row.rider_id, conversationId, originator]
        );
        const phone = normalizePhone(info.rows[0]?.phone);
        const total = Math.round(Number(info.rows[0]?.total || 0));
        if (phone && total > 0) {
          const { sendText } = await import("./whatsapp.js");
          await sendText(
            `${phone}@c.us`,
            `💸 *M-PESA PAYOUT CONFIRMED!*\n\n` +
              `KES ${total.toLocaleString()} has been sent to your M-Pesa.\n` +
              (receipt ? `• Transaction Ref: *${receipt}*\n` : "") +
              `Thank you for delivering with Sokoni.`
          );
        }
      } catch (err) {
        console.warn("[rider-b2c] paid notify:", err.message);
      }
    }
    console.log(`[rider-b2c] PAID conversation=${conversationId || originator}`);
    return { matched: true, paid: true };
  }

  await query(
    `UPDATE rider_payouts SET
       status = 'CLEARED',
       b2c_conversation_id = NULL
     WHERE status = 'PROCESSING'
       AND (
         ($1::text IS NOT NULL AND b2c_conversation_id = $1)
         OR ($2::text IS NOT NULL AND b2c_originator_id = $2)
       )`,
    [conversationId, originator]
  );
  console.warn(
    `[rider-b2c] failed → CLEARED again: ${parsed.resultDesc || "error"} (${conversationId || originator})`
  );
  return { matched: true, paid: false };
}

export function riderB2cConfigured() {
  return isB2CReady();
}
