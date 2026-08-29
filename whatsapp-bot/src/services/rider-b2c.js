/**
 * Sokoni rider delivery-fee B2C — Daraja BusinessPayment for CLEARED rider_payouts.
 * Guardrails: KES 200 floor, KES 5k/day cap, PENDING_RETRY backoff, float alerts.
 */
import { isDbEnabled, query } from "../db/pool.js";
import {
  initiateB2CPayout,
  isB2CReady,
  b2cMeta,
} from "./daraja-mpesa.js";
import { calculateDeliveryPayoutSplit } from "../lib/rider-payout-fees.js";
import {
  RIDER_B2C_MIN_FLOOR_KES,
  RIDER_B2C_DAILY_CAP_KES,
  RIDER_B2C_RETRY_MAX,
  nextRetryAt,
  isInsufficientFloatError,
} from "../lib/rider-b2c-guards.js";

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
      ADD COLUMN IF NOT EXISTS mpesa_receipt VARCHAR(64),
      ADD COLUMN IF NOT EXISTS gross_delivery_fee NUMERIC(12, 2),
      ADD COLUMN IF NOT EXISTS platform_commission NUMERIC(12, 2),
      ADD COLUMN IF NOT EXISTS transaction_fee NUMERIC(12, 2),
      ADD COLUMN IF NOT EXISTS net_amount_paid NUMERIC(12, 2),
      ADD COLUMN IF NOT EXISTS retry_after TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS requires_manual_approval BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS payout_hold_reason TEXT,
      ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS approved_by VARCHAR(80)
  `);
  await query(`
    ALTER TABLE riders
      ADD COLUMN IF NOT EXISTS mpesa_account_name VARCHAR(160),
      ADD COLUMN IF NOT EXISTS mpesa_name_match_status VARCHAR(20) DEFAULT 'UNKNOWN',
      ADD COLUMN IF NOT EXISTS mpesa_name_flagged_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS mpesa_name_last_checked_at TIMESTAMPTZ
  `);
}

async function backfillMissingFeeSplits() {
  const { rows } = await query(
    `SELECT id, amount, gross_delivery_fee, platform_commission, net_amount_paid
       FROM rider_payouts
      WHERE status IN ('CLEARED', 'PENDING_RETRY')
        AND (
          platform_commission IS NULL
          OR net_amount_paid IS NULL
          OR transaction_fee IS NULL
        )
      ORDER BY id ASC
      LIMIT 200`
  );
  for (const row of rows) {
    const gross = Math.round(
      Number(row.gross_delivery_fee != null ? row.gross_delivery_fee : row.amount) || 0
    );
    if (gross < 1) continue;
    const split = calculateDeliveryPayoutSplit(gross);
    await query(
      `UPDATE rider_payouts SET
         gross_delivery_fee = $2,
         platform_commission = $3,
         transaction_fee = $4,
         net_amount_paid = $5,
         amount = $5
       WHERE id = $1 AND status IN ('CLEARED', 'PENDING_RETRY')`,
      [
        row.id,
        split.originalDeliveryFee,
        split.platformCommission,
        split.mpesaTariff,
        split.netRiderPayout,
      ]
    );
  }
  return rows.length;
}

async function promoteDueRetries() {
  await query(
    `UPDATE rider_payouts SET
       status = 'CLEARED',
       retry_after = NULL
     WHERE status = 'PENDING_RETRY'
       AND (retry_after IS NULL OR retry_after <= NOW())
       AND retry_count <= $1`,
    [RIDER_B2C_RETRY_MAX]
  );
}

async function paidTodayKes(riderId) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(COALESCE(net_amount_paid, amount)), 0)::numeric AS total
       FROM rider_payouts
      WHERE rider_id = $1
        AND (
          (status = 'PAID' AND paid_at::date = CURRENT_DATE)
          OR status = 'PROCESSING'
        )`,
    [riderId]
  );
  return Math.floor(Number(rows[0]?.total || 0));
}

async function alertOps(details) {
  try {
    const { notifyAdminEvent } = await import("./communication-hub.js");
    await notifyAdminEvent("DISPUTE_OR_HELP", { orderId: null, details });
  } catch (err) {
    console.warn("[rider-b2c] ops alert:", err.message);
  }
}

async function markPendingRetry({ riderId, conversationId = null, originator = null, reason = "" }) {
  const { rows } = await query(
    `SELECT id, retry_count FROM rider_payouts
      WHERE rider_id = $1
        AND status = 'PROCESSING'
        AND (
          ($2::text IS NOT NULL AND b2c_conversation_id = $2)
          OR ($3::text IS NOT NULL AND b2c_originator_id = $3)
          OR ($2::text IS NULL AND $3::text IS NULL)
        )`,
    [riderId, conversationId, originator]
  );

  for (const row of rows) {
    const nextCount = Number(row.retry_count || 0) + 1;
    const when = nextRetryAt(nextCount);
    await query(
      `UPDATE rider_payouts SET
         status = 'PENDING_RETRY',
         retry_count = $2,
         retry_after = $3,
         b2c_conversation_id = NULL,
         payout_hold_reason = $4
       WHERE id = $1`,
      [row.id, nextCount, when.toISOString(), String(reason || "b2c_failed").slice(0, 400)]
    );
  }
  return rows.length;
}

/**
 * Aggregate CLEARED nets (≥ floor), enforce daily cap, kick Daraja B2C.
 */
export async function processRiderB2CPayouts({
  minKes = RIDER_B2C_MIN_FLOOR_KES,
  dailyCapKes = RIDER_B2C_DAILY_CAP_KES,
  limit = 10,
} = {}) {
  if (!isDbEnabled()) return { ok: false, skipped: true, reason: "database_not_configured" };
  if (!isB2CReady()) {
    console.log("[rider-b2c] skipped — B2C not configured");
    return { ok: false, skipped: true, reason: "b2c_not_configured", meta: b2cMeta() };
  }

  const floor = Math.max(Number(minKes) || RIDER_B2C_MIN_FLOOR_KES, RIDER_B2C_MIN_FLOOR_KES);
  const dailyCap = Math.max(Number(dailyCapKes) || RIDER_B2C_DAILY_CAP_KES, floor);

  try {
    await ensureColumns();
    await backfillMissingFeeSplits();
    await promoteDueRetries();
  } catch (err) {
    console.warn("[rider-b2c] columns/backfill:", err.message);
  }

  const { rows } = await query(
    `SELECT r.id AS rider_id, r.full_name, r.phone,
            SUM(COALESCE(p.net_amount_paid, p.amount))::numeric AS total_amount
       FROM rider_payouts p
       JOIN riders r ON p.rider_id = r.id
      WHERE p.status = 'CLEARED'
        AND r.verification_status = 'VERIFIED'
        AND COALESCE(r.mpesa_name_match_status, 'UNKNOWN') <> 'MISMATCH'
      GROUP BY r.id, r.full_name, r.phone
     HAVING SUM(COALESCE(p.net_amount_paid, p.amount)) >= $1
      ORDER BY SUM(COALESCE(p.net_amount_paid, p.amount)) DESC
      LIMIT $2`,
    [floor, Math.min(Math.max(Number(limit) || 10, 1), 25)]
  );

  if (!rows.length) {
    return { ok: true, triggered: 0, message: `No riders meet the KES ${floor} minimum payout floor.` };
  }

  let triggered = 0;
  let capped = 0;

  for (const row of rows) {
    const clearedTotal = Math.floor(Number(row.total_amount) || 0);
    const alreadyToday = await paidTodayKes(row.rider_id);
    const remainingCap = Math.max(0, dailyCap - alreadyToday);

    if (remainingCap < floor) {
      capped += 1;
      continue;
    }

    let amountToPay = Math.min(clearedTotal, remainingCap);
    if (amountToPay < floor) {
      capped += 1;
      continue;
    }

    if (clearedTotal > remainingCap) {
      capped += 1;
      await alertOps(
        `⚠️ *PAYOUT CAP TRIGGERED*\n` +
          `Rider ${row.full_name} (${row.phone}) cleared KES ${clearedTotal.toLocaleString()}.\n` +
          `Auto-payout capped at KES ${amountToPay.toLocaleString()} (daily cap ${dailyCap}). Excess rolls to next cycle.`
      );
    }

    // Select CLEARED rows up to amountToPay (FIFO)
    const { rows: ledgerRows } = await query(
      `SELECT id, COALESCE(net_amount_paid, amount)::numeric AS amt
         FROM rider_payouts
        WHERE rider_id = $1 AND status = 'CLEARED'
        ORDER BY id ASC`,
      [row.rider_id]
    );
    const pickIds = [];
    let running = 0;
    for (const lr of ledgerRows) {
      const amt = Math.floor(Number(lr.amt) || 0);
      if (amt < 1) continue;
      if (running + amt > amountToPay && pickIds.length) break;
      if (running + amt > amountToPay && !pickIds.length) {
        // Single row larger than remaining cap — leave for next day / manual
        break;
      }
      pickIds.push(lr.id);
      running += amt;
      if (running >= amountToPay) break;
    }
    if (!pickIds.length || running < 1) continue;

    amountToPay = running;
    const phone = normalizePhone(row.phone);
    if (!phone) continue;

    const originator = `skrboda${row.rider_id}-${Date.now().toString(36).slice(-6)}`.slice(0, 36);

    const result = await initiateB2CPayout({
      phone,
      amount: amountToPay,
      remarks: "Sokoni Mall delivery earnings",
      occasion: "DeliveryPayout",
      orderId: `RIDER-${row.rider_id}`,
      originatorConversationId: originator,
    });

    if (!result.ok && !result.accepted) {
      const msg = result.message || "B2C rejected";
      console.warn("[rider-b2c] rejected", row.rider_id, msg);
      if (isInsufficientFloatError(msg, result.errorCode)) {
        await alertOps(
          `🚨 *CRITICAL B2C FLOAT LOW*\n\n` +
            `Daraja rejected rider payout (rider #${row.rider_id}, KES ${amountToPay}).\n` +
            `${msg}\n` +
            `Top up utility shortcode float before retry. Queued as PENDING_RETRY.`
        );
        await query(
          `UPDATE rider_payouts SET
             status = 'PENDING_RETRY',
             retry_count = COALESCE(retry_count, 0) + 1,
             retry_after = $2,
             payout_hold_reason = $3
           WHERE id = ANY($1::bigint[])`,
          [pickIds, nextRetryAt(1).toISOString(), String(msg).slice(0, 400)]
        );
        break;
      }
      await query(
        `UPDATE rider_payouts SET
           status = 'PENDING_RETRY',
           retry_count = COALESCE(retry_count, 0) + 1,
           retry_after = $2,
           payout_hold_reason = $3
         WHERE id = ANY($1::bigint[])`,
        [pickIds, nextRetryAt(1).toISOString(), String(msg).slice(0, 400)]
      );
      continue;
    }

    const conversationId = result.conversationId || result.response?.ConversationID || null;
    await query(
      `UPDATE rider_payouts SET
         status = 'PROCESSING',
         b2c_conversation_id = COALESCE($2, b2c_conversation_id),
         b2c_originator_id = $3,
         retry_after = NULL
       WHERE id = ANY($1::bigint[])`,
      [pickIds, conversationId, originator]
    );
    triggered += 1;
    console.log(
      `[rider-b2c] triggered net KES ${amountToPay} → ${row.full_name} (${phone}) rows=${pickIds.length} originator=${originator}`
    );
  }

  return { ok: true, triggered, capped, floor, dailyCap };
}

/**
 * Apply Safaricom B2C ResultURL to rider_payouts (success → PAID, fail → PENDING_RETRY).
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
         mpesa_receipt = COALESCE($3, mpesa_receipt),
         retry_count = 0,
         retry_after = NULL,
         payout_hold_reason = NULL
       WHERE status = 'PROCESSING'
         AND (
           ($1::text IS NOT NULL AND b2c_conversation_id = $1)
           OR ($2::text IS NOT NULL AND b2c_originator_id = $2)
         )`,
      [conversationId, originator, receipt]
    );

    for (const row of rows) {
      try {
        if (parsed.receiverPublicName) {
          const { auditRiderMpesaName } = await import("./boda-fleet.js");
          await auditRiderMpesaName({
            riderId: row.rider_id,
            receiverPublicName: parsed.receiverPublicName,
          });
        }
      } catch (err) {
        console.warn("[rider-b2c] name audit:", err.message);
      }

      try {
        const info = await query(
          `SELECT r.phone,
                  COALESCE(SUM(COALESCE(p.net_amount_paid, p.amount)),0)::numeric AS total
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

  const reason = parsed.resultDesc || (parsed.timeout ? "B2C queue timeout" : "b2c_failed");
  for (const row of rows) {
    await markPendingRetry({
      riderId: row.rider_id,
      conversationId,
      originator,
      reason,
    });
  }

  if (isInsufficientFloatError(reason, String(parsed.resultCode || ""))) {
    await alertOps(
      `🚨 *B2C RESULT — FLOAT / FAIL*\n${reason}\nConversation ${conversationId || originator}. Queued PENDING_RETRY.`
    );
  }

  console.warn(
    `[rider-b2c] failed → PENDING_RETRY: ${reason} (${conversationId || originator})`
  );
  return { matched: true, paid: false, retry: true };
}

export function riderB2cConfigured() {
  return isB2CReady();
}

export {
  RIDER_B2C_MIN_FLOOR_KES,
  RIDER_B2C_DAILY_CAP_KES,
};
