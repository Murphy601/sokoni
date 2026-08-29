/**
 * Buyer no-show → 15-min wait → return-to-seller with Return OTP + 50% rider fee.
 */
import { createHash, randomInt } from "node:crypto";
import { isDbEnabled, query } from "../db/pool.js";
import { getOrder, normalizeOrderId, updateOrderMeta, updateOrderStatus } from "./orders.js";
import { orderBuyerTotal } from "./shipping-tiers.js";
import {
  NO_SHOW_WAIT_MINUTES,
  NO_SHOW_RETURN_FEE_FRACTION,
} from "../lib/ops-edge-constants.js";
import { calculateDeliveryPayoutSplit } from "../lib/rider-payout-fees.js";

function normalizeRiderPhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9 && /^[17]/.test(d)) d = `254${d}`;
  return d.length >= 12 && d.length <= 15 ? d : "";
}

function hashOtp(code) {
  return createHash("sha256").update(String(code)).digest("hex");
}

async function ensureNoShowColumns() {
  await query(`
    ALTER TABLE delivery_dispatches
      ADD COLUMN IF NOT EXISTS wait_timer_started_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS return_otp_hash VARCHAR(128),
      ADD COLUMN IF NOT EXISTS return_confirmed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS delivery_failed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS return_fee_kes NUMERIC(12, 2)
  `);
}

function halfFeeKes(deliveryFee) {
  const fee = Math.max(0, Number(deliveryFee) || 0);
  return Math.round(fee * NO_SHOW_RETURN_FEE_FRACTION);
}

async function loadRiderDispatch(orderId, riderPhone) {
  const id = normalizeOrderId(orderId);
  const phone = normalizeRiderPhone(riderPhone);
  if (!id || !phone) return { error: "invalid" };
  const { rows } = await query(
    `SELECT d.*, r.phone AS rider_phone, r.full_name AS rider_name, r.id AS rid
       FROM delivery_dispatches d
       JOIN riders r ON r.id = d.rider_id
      WHERE UPPER(d.order_ref) = UPPER($1)
        AND r.phone = $2
      ORDER BY d.id DESC
      LIMIT 1`,
    [id, phone]
  );
  if (!rows[0]) return { error: "not_found", orderId: id };
  return { orderId: id, dispatch: rows[0] };
}

/**
 * Rider: NO_SHOW SKN-#### — start 15-minute wait; ping buyer.
 */
export async function handleRiderNoShowTrigger({ orderId, phone, customerKey = "" } = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured", message: "Database offline." };
  try {
    await ensureNoShowColumns();
  } catch (err) {
    console.warn("[boda-no-show] columns:", err.message);
  }

  const loaded = await loadRiderDispatch(orderId, phone || customerKey);
  if (loaded.error === "invalid") {
    return { error: "invalid", message: "Reply like: NO_SHOW SKN-1234" };
  }
  if (loaded.error) {
    return {
      error: "not_found",
      message: `Dispatch for *${normalizeOrderId(orderId) || orderId}* not found or not assigned to you.`,
    };
  }

  const { dispatch, orderId: id } = loaded;
  const custody = String(dispatch.custody_status || "").toUpperCase();
  const inTransit =
    custody === "IN_TRANSIT" ||
    dispatch.status === "OTP_SENT" ||
    dispatch.status === "PICKED_UP";
  if (!inTransit) {
    return {
      error: "wrong_status",
      message: `⚠️ Order *${id}* is not in transit (status ${dispatch.status}). Complete pickup first.`,
    };
  }
  if (custody === "RETURN_IN_TRANSIT" || custody === "RETURNED") {
    return { error: "already_returning", message: `*${id}* is already on a return trip.` };
  }
  if (dispatch.wait_timer_started_at) {
    const started = new Date(dispatch.wait_timer_started_at).getTime();
    const elapsed = (Date.now() - started) / 60000;
    if (elapsed >= NO_SHOW_WAIT_MINUTES) {
      return {
        ok: true,
        ready: true,
        message:
          `⏱️ Wait window already over for *${id}*. Reply *CANCEL_NO_SHOW ${id}* to start the return trip.`,
      };
    }
    const remaining = Math.ceil(NO_SHOW_WAIT_MINUTES - elapsed);
    return {
      ok: true,
      already: true,
      message: `⏱️ Timer already running for *${id}*. ~${remaining} min left. Then reply *CANCEL_NO_SHOW ${id}*.`,
    };
  }

  await query(
    `UPDATE delivery_dispatches SET wait_timer_started_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [dispatch.id]
  );

  const order = getOrder(id);
  const half = halfFeeKes(dispatch.delivery_fee_kes || order?.shippingKes);
  const { sendText } = await import("./whatsapp.js");
  const buyerTo = order?.customerKey || null;
  if (buyerTo) {
    try {
      await sendText(
        buyerTo,
        `⚠️ *RIDER IS WAITING (ORDER ${id})*\n\n` +
          `Your rider is at the drop-off but cannot reach you.\n` +
          `Please meet them within *${NO_SHOW_WAIT_MINUTES} minutes*.\n\n` +
          `If you do not claim the parcel in time, the order is cancelled and ` +
          `*KES ${half.toLocaleString()}* (50% of delivery) covers the rider's return trip.`
      );
    } catch (err) {
      console.warn("[boda-no-show] buyer ping:", err.message);
    }
  }

  const deadline = new Date(Date.now() + NO_SHOW_WAIT_MINUTES * 60000);
  const timeLabel = deadline.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
  return {
    ok: true,
    message:
      `⏱️ *${NO_SHOW_WAIT_MINUTES}-MINUTE TIMER STARTED!* Buyer notified.\n` +
      `If they do not respond by *${timeLabel}*, reply:\n` +
      `*CANCEL_NO_SHOW ${id}*`,
  };
}

/**
 * Rider: CANCEL_NO_SHOW SKN-#### — after wait, start return + seller Return OTP.
 */
export async function executeReturnTrip({ orderId, phone, customerKey = "", force = false } = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured", message: "Database offline." };
  try {
    await ensureNoShowColumns();
  } catch (err) {
    console.warn("[boda-no-show] columns:", err.message);
  }

  const loaded = await loadRiderDispatch(orderId, phone || customerKey);
  if (loaded.error === "invalid") {
    return { error: "invalid", message: "Reply like: CANCEL_NO_SHOW SKN-1234" };
  }
  if (loaded.error) {
    return { error: "not_found", message: `Order not found or not assigned to you.` };
  }

  const { dispatch, orderId: id } = loaded;
  if (String(dispatch.custody_status || "").toUpperCase() === "RETURN_IN_TRANSIT") {
    return {
      ok: true,
      already: true,
      message: `Return already in progress for *${id}*. Ask seller for Return OTP → *VERIFY_RETURN ${id} ####*`,
    };
  }

  const started = dispatch.wait_timer_started_at
    ? new Date(dispatch.wait_timer_started_at).getTime()
    : NaN;
  const minutesPassed = (Date.now() - started) / 60000;
  if (!force && (isNaN(started) || minutesPassed < NO_SHOW_WAIT_MINUTES)) {
    if (isNaN(started)) {
      return {
        error: "no_timer",
        message: `Start with *NO_SHOW ${id}* first, then wait ${NO_SHOW_WAIT_MINUTES} minutes.`,
      };
    }
    const remaining = Math.ceil(NO_SHOW_WAIT_MINUTES - minutesPassed);
    return {
      error: "wait",
      message: `⏳ Please wait *${remaining}* more minute(s). The ${NO_SHOW_WAIT_MINUTES}-minute window is not over yet.`,
    };
  }

  const returnOtp = String(randomInt(1000, 9999));
  const half = halfFeeKes(dispatch.delivery_fee_kes);
  await query(
    `UPDATE delivery_dispatches SET
       custody_status = 'RETURN_IN_TRANSIT',
       status = 'DELIVERY_FAILED',
       return_otp_hash = $2,
       delivery_failed_at = NOW(),
       return_fee_kes = $3,
       fee_status = 'ON_HOLD',
       updated_at = NOW(),
       meta = COALESCE(meta, '{}'::jsonb) || $4::jsonb
     WHERE id = $1`,
    [
      dispatch.id,
      hashOtp(returnOtp),
      half,
      JSON.stringify({
        noShowReturnAt: new Date().toISOString(),
        noShowReturnFeeKes: half,
      }),
    ]
  );

  const order = getOrder(id);
  const itemKes = Math.round(Number(order?.priceKes || order?.sourcePriceKes || 0));
  const totalKes = Math.round(Number(orderBuyerTotal(order || {}) || 0));
  const buyerRefundKes = Math.max(0, totalKes - half);

  try {
    const { cancelSettlementPayout } = await import("./settlements.js");
    cancelSettlementPayout(id, "buyer_no_show_return");
  } catch (err) {
    console.warn("[boda-no-show] cancel settlement:", err.message);
  }

  updateOrderMeta(id, {
    bodaStatus: "DELIVERY_FAILED",
    bodaCustody: "RETURN_IN_TRANSIT",
    noShowAt: Date.now(),
    noShowPenaltyKes: half,
    buyerRefundKes,
    refundPendingManual: true,
    refundReason: `Buyer no-show — refund KES ${buyerRefundKes} (item + half shipping; rider return fee KES ${half})`,
    escrowStatus: "refunded",
    disputeHold: false,
  });
  try {
    if (order && order.status !== "cancelled") updateOrderStatus(id, "cancelled");
  } catch {
    /* ignore */
  }

  const { sendText } = await import("./whatsapp.js");
  if (order?.customerKey) {
    try {
      await sendText(
        order.customerKey,
        `❌ *ORDER CANCELLED — UNABLE TO LOCATE BUYER*\n\n` +
          `Order *${id}* timed out after ${NO_SHOW_WAIT_MINUTES} minutes.\n` +
          `• Item + remaining shipping refund: *KES ${buyerRefundKes.toLocaleString()}* (manual M-Pesa)\n` +
          `• Return logistics deducted: *KES ${half.toLocaleString()}* (50% delivery fee)`
      );
    } catch (err) {
      console.warn("[boda-no-show] buyer cancel notify:", err.message);
    }
  }

  const sellerPhone = dispatch.seller_phone
    ? normalizeRiderPhone(dispatch.seller_phone)
    : null;
  if (sellerPhone) {
    try {
      await sendText(
        `${sellerPhone}@c.us`,
        `📦 *PARCEL RETURN IN PROGRESS (${id})*\n\n` +
          `Buyer failed to collect. Rider is returning the item.\n` +
          `When you receive the parcel, give the rider this code:\n` +
          `• *Return OTP: ${returnOtp}*\n\n` +
          `Do not share it on chat — speak it at handoff.`
      );
    } catch (err) {
      console.warn("[boda-no-show] seller return otp:", err.message);
    }
  }

  return {
    ok: true,
    returnFeeKes: half,
    message:
      `🚨 *RETURN INITIATED!* Take the parcel back to the seller.\n` +
      `Ask for the *Return OTP*, then reply:\n` +
      `*VERIFY_RETURN ${id} ####*\n` +
      `to unlock your *KES ${half.toLocaleString()}* return payout.`,
  };
}

/**
 * Rider: VERIFY_RETURN SKN-#### #### — seller Return OTP → 50% CLEARED payout.
 */
export async function confirmSellerReturn({
  orderId,
  code = "",
  phone,
  customerKey = "",
} = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured", message: "Database offline." };
  try {
    await ensureNoShowColumns();
  } catch (err) {
    console.warn("[boda-no-show] columns:", err.message);
  }

  const otp = String(code || "").replace(/\D/g, "").slice(0, 4);
  const loaded = await loadRiderDispatch(orderId, phone || customerKey);
  if (loaded.error === "invalid" || otp.length !== 4) {
    return { error: "invalid", message: "Reply like: VERIFY_RETURN SKN-1234 4821" };
  }
  if (loaded.error) {
    return { error: "not_found", message: `Order not found or not assigned to you.` };
  }

  const { dispatch, orderId: id } = loaded;
  if (String(dispatch.custody_status || "").toUpperCase() !== "RETURN_IN_TRANSIT") {
    return {
      error: "wrong_status",
      message: `⚠️ *${id}* is not in RETURN_IN_TRANSIT. Start with NO_SHOW → CANCEL_NO_SHOW first.`,
    };
  }
  if (!dispatch.return_otp_hash || hashOtp(otp) !== dispatch.return_otp_hash) {
    return {
      error: "bad_otp",
      message: `❌ Invalid Return OTP. Ask the seller for the 4-digit code from WhatsApp.`,
    };
  }

  const half =
    dispatch.return_fee_kes != null
      ? Math.round(Number(dispatch.return_fee_kes))
      : halfFeeKes(dispatch.delivery_fee_kes);

  await query(
    `UPDATE delivery_dispatches SET
       custody_status = 'RETURNED',
       return_confirmed_at = NOW(),
       return_otp_hash = NULL,
       fee_status = 'RELEASED',
       payout_status = 'RELEASED',
       updated_at = NOW()
     WHERE id = $1`,
    [dispatch.id]
  );

  if (dispatch.rider_id) {
    await query(`UPDATE riders SET is_available = TRUE, updated_at = NOW() WHERE id = $1`, [
      dispatch.rider_id,
    ]);
  }

  // Credit 50% return fee as CLEARED (fee split on the half).
  const split = calculateDeliveryPayoutSplit(half);
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS rider_payouts (
        id          BIGSERIAL PRIMARY KEY,
        rider_id    INT,
        order_ref   VARCHAR(40) NOT NULL,
        amount      NUMERIC(12, 2) NOT NULL DEFAULT 0,
        status      VARCHAR(20) NOT NULL DEFAULT 'CLEARED',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query(`
      ALTER TABLE rider_payouts
        ADD COLUMN IF NOT EXISTS gross_delivery_fee NUMERIC(12, 2),
        ADD COLUMN IF NOT EXISTS platform_commission NUMERIC(12, 2),
        ADD COLUMN IF NOT EXISTS transaction_fee NUMERIC(12, 2),
        ADD COLUMN IF NOT EXISTS net_amount_paid NUMERIC(12, 2)
    `);
    const payoutRef = `${id}-RETURN`;
    const { rows: existing } = await query(
      `SELECT id FROM rider_payouts WHERE rider_id = $1 AND UPPER(order_ref) = UPPER($2) LIMIT 1`,
      [dispatch.rider_id, payoutRef]
    );
    if (!existing[0]) {
      await query(
        `INSERT INTO rider_payouts (
           rider_id, order_ref, amount, status,
           gross_delivery_fee, platform_commission, transaction_fee, net_amount_paid
         ) VALUES ($1,$2,$3,'CLEARED',$4,$5,$6,$3)`,
        [
          dispatch.rider_id,
          payoutRef,
          split.netRiderPayout,
          split.originalDeliveryFee,
          split.platformCommission,
          split.mpesaTariff,
        ]
      );
    } else {
      await query(
        `UPDATE rider_payouts SET
           amount = $2, status = 'CLEARED',
           gross_delivery_fee = $3, platform_commission = $4,
           transaction_fee = $5, net_amount_paid = $2
         WHERE id = $1`,
        [
          existing[0].id,
          split.netRiderPayout,
          split.originalDeliveryFee,
          split.platformCommission,
          split.mpesaTariff,
        ]
      );
    }
  } catch (err) {
    console.warn("[boda-no-show] return payout ledger:", err.message);
  }

  updateOrderMeta(id, {
    bodaCustody: "RETURNED",
    bodaReturnConfirmedAt: Date.now(),
    bodaReturnFeeKes: half,
    bodaReturnNetKes: split.netRiderPayout,
  });

  return {
    ok: true,
    returnFeeKes: half,
    netKes: split.netRiderPayout,
    message:
      `✅ *RETURN CONFIRMED!* Seller received the item.\n` +
      `Your return fee *KES ${split.netRiderPayout.toLocaleString()}* (50% trip, after fees) is queued for M-Pesa B2C.`,
  };
}

/** Cron: auto-run CANCEL_NO_SHOW when wait timer elapsed and still IN_TRANSIT. */
export async function processNoShowTimeouts({ limit = 25 } = {}) {
  if (!isDbEnabled()) return { processed: 0 };
  try {
    await ensureNoShowColumns();
  } catch {
    return { processed: 0 };
  }
  const { rows } = await query(
    `SELECT d.id, d.order_ref, r.phone AS rider_phone
       FROM delivery_dispatches d
       JOIN riders r ON r.id = d.rider_id
      WHERE d.wait_timer_started_at IS NOT NULL
        AND d.wait_timer_started_at < NOW() - ($1::int * INTERVAL '1 minute')
        AND d.return_confirmed_at IS NULL
        AND d.custody_status = 'IN_TRANSIT'
        AND d.status IN ('OTP_SENT', 'PICKED_UP', 'ACCEPTED')
      ORDER BY d.wait_timer_started_at ASC
      LIMIT $2`,
    [NO_SHOW_WAIT_MINUTES, Math.min(Math.max(Number(limit) || 25, 1), 60)]
  );

  let processed = 0;
  for (const row of rows) {
    try {
      const result = await executeReturnTrip({
        orderId: row.order_ref,
        phone: row.rider_phone,
        force: true,
      });
      if (result.ok) {
        processed += 1;
        try {
          const { sendText } = await import("./whatsapp.js");
          await sendText(`${row.rider_phone}@c.us`, result.message);
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      console.warn("[boda-no-show] auto timeout:", err.message);
    }
  }
  return { processed };
}

export async function tryHandleBodaNoShowMessage(customerKey, text, { phone = "" } = {}) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;
  const { sendText } = await import("./whatsapp.js");

  const noShow = trimmed.match(/^NO[_ ]?SHOW\s+(SKN?-?\d{1,6}(?:-\d+)?)\b/i);
  if (noShow) {
    const result = await handleRiderNoShowTrigger({
      orderId: noShow[1],
      phone,
      customerKey,
    });
    await sendText(customerKey, result.message || result.error || "Could not start no-show timer.");
    return true;
  }

  const cancel = trimmed.match(/^CANCEL[_ ]?NO[_ ]?SHOW\s+(SKN?-?\d{1,6}(?:-\d+)?)\b/i);
  if (cancel) {
    const result = await executeReturnTrip({
      orderId: cancel[1],
      phone,
      customerKey,
    });
    await sendText(customerKey, result.message || result.error || "Could not start return.");
    return true;
  }

  const verify = trimmed.match(
    /^VERIFY[_ ]?RETURN\s+(SKN?-?\d{1,6}(?:-\d+)?)\s+(\d{4})\b/i
  );
  if (verify) {
    const result = await confirmSellerReturn({
      orderId: verify[1],
      code: verify[2],
      phone,
      customerKey,
    });
    await sendText(customerKey, result.message || result.error || "Could not verify return.");
    return true;
  }

  return false;
}
