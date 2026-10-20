/**
 * Automated B2C Transaction Interceptor
 * ─────────────────────────────────────
 * When Admin PAUSE/SUSPEND hits a seller or rider mid-payout:
 *  • Queued / not-yet-sent → status QUARANTINED (no Daraja call, no auto-retry)
 *  • Already sent to Safaricom → wait for ResultURL; fail → quarantine; success → paid + Boss alert
 * Restore (UNPAUSE/UNBAN) does NOT auto-release — Boss uses RELEASE PAYOUT +254…
 */
import { config } from "../config.js";
import { getSupplier, sellerPayoutsHeld, isShopPubliclyVisible } from "./suppliers.js";

function digitsOnly(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9 && /^[17]/.test(d)) d = `254${d}`;
  return d;
}

export function isSellerBlockedForB2C(supplier) {
  if (!supplier) return false;
  if (sellerPayoutsHeld(supplier)) return true;
  if (!isShopPubliclyVisible(supplier)) return true;
  const st = String(supplier.shopStatus || "live").toLowerCase();
  return st === "paused" || st === "deactivated" || st === "under_review";
}

export function isRiderBlockedForB2C(riderRow) {
  if (!riderRow) return true;
  const vs = String(riderRow.verification_status || riderRow.verificationStatus || "").toUpperCase();
  if (vs === "SUSPENDED" || vs === "REJECTED" || vs === "PENDING") return true;
  const reason = String(riderRow.suspend_reason || riderRow.suspendReason || "");
  if (reason.startsWith("ADMIN_PAUSE:")) return true;
  return false;
}

async function alertBoss(text) {
  try {
    const { sendText, toChatId } = await import("./whatsapp.js");
    const adminPhone = config.admin?.primary || config.contact?.founderPhone;
    if (!adminPhone) return;
    await sendText(toChatId(adminPhone), text);
  } catch (err) {
    console.warn("[b2c-interceptor] boss alert:", err.message);
  }
}

/**
 * Quarantine seller settlement lines + withdrawal requests that are not yet paid.
 * In-flight Daraja (`disbursing`) gets quarantineOnFail so callback failure freezes funds.
 */
export async function quarantineSellerInFlightPayouts(supplierId, { reason = "Account restricted", action = "PAUSE" } = {}) {
  const sid = String(supplierId || "").trim();
  if (!sid) return { quarantined: 0, awaitingCallback: 0, amountKes: 0 };

  const { quarantineSellerSettlements } = await import("./settlements.js");
  const settlements = quarantineSellerSettlements(sid, { reason, action });

  let wdQuarantined = 0;
  let wdAmount = 0;
  try {
    const { quarantineSellerWithdrawals } = await import("./seller-withdrawals.js");
    const wd = quarantineSellerWithdrawals(sid, { reason, action });
    wdQuarantined = wd.quarantined || 0;
    wdAmount = wd.amountKes || 0;
  } catch (err) {
    console.warn("[b2c-interceptor] withdrawal quarantine:", err.message);
  }

  const amountKes = (settlements.amountKes || 0) + wdAmount;
  const totalQ = (settlements.quarantined || 0) + wdQuarantined;
  const awaiting = settlements.awaitingCallback || 0;

  if (totalQ > 0 || awaiting > 0) {
    const shop = getSupplier(sid);
    const label = shop?.shopHandle || shop?.businessName || sid;
    await alertBoss(
      `⚠️ *B2C Intercepted*\n\n` +
        `Seller *${label}* — *${action}*\n` +
        `Quarantined: *${totalQ}* payout line(s)` +
        (amountKes ? ` · KES ${amountKes.toLocaleString()}` : "") +
        `\n` +
        (awaiting
          ? `In-flight Daraja (awaiting callback): *${awaiting}* — will quarantine on fail.\n`
          : "") +
        `Release later: *RELEASE PAYOUT* + seller M-Pesa / phone.\n` +
        `_Reason: ${String(reason).slice(0, 120)}_`
    );
  }

  return {
    quarantined: totalQ,
    awaitingCallback: awaiting,
    amountKes,
    settlements,
    withdrawals: { quarantined: wdQuarantined, amountKes: wdAmount },
  };
}

/** Quarantine CLEARED / PENDING_RETRY rider ledger; flag PROCESSING for fail→quarantine. */
export async function quarantineRiderInFlightPayouts(riderId, { reason = "Account restricted", action = "PAUSE" } = {}) {
  const id = Number(riderId);
  if (!Number.isFinite(id) || id < 1) return { quarantined: 0, awaitingCallback: 0, amountKes: 0 };

  const { isDbEnabled, query } = await import("../db/pool.js");
  if (!isDbEnabled()) return { quarantined: 0, awaitingCallback: 0, amountKes: 0, skipped: true };

  const hold = `ADMIN_QUARANTINE: ${String(reason || action).slice(0, 200)}`;

  const q = await query(
    `UPDATE rider_payouts SET
       status = 'QUARANTINED',
       payout_hold_reason = $2,
       retry_after = NULL
     WHERE rider_id = $1
       AND status IN ('CLEARED', 'PENDING_RETRY', 'NEEDS_APPROVAL')
     RETURNING id, COALESCE(net_amount_paid, amount)::numeric AS amt`,
    [id, hold]
  );

  const flag = await query(
    `UPDATE rider_payouts SET
       payout_hold_reason = $2
     WHERE rider_id = $1
       AND status = 'PROCESSING'
     RETURNING id, COALESCE(net_amount_paid, amount)::numeric AS amt`,
    [id, `AWAITING_CALLBACK_QUARANTINE: ${String(reason || action).slice(0, 180)}`]
  );

  const amountKes = q.rows.reduce((s, r) => s + Math.round(Number(r.amt) || 0), 0);
  const awaitingCallback = flag.rows.length;

  if (q.rows.length || awaitingCallback) {
    await alertBoss(
      `⚠️ *B2C Intercepted (Rider)*\n\n` +
        `Rider #${id} — *${action}*\n` +
        `Quarantined: *${q.rows.length}* row(s)` +
        (amountKes ? ` · KES ${amountKes.toLocaleString()}` : "") +
        `\n` +
        (awaitingCallback
          ? `In-flight Daraja (awaiting callback): *${awaitingCallback}*\n`
          : "") +
        `Release later: *RELEASE PAYOUT* +254…\n` +
        `_Reason: ${String(reason).slice(0, 120)}_`
    );
  }

  return {
    quarantined: q.rows.length,
    awaitingCallback,
    amountKes,
  };
}

/** Summarize quarantined seller + rider amounts for restore prompts. */
export async function summarizeQuarantinedForSeller(supplierId) {
  const { listQuarantinedSettlements } = await import("./settlements.js");
  const rows = listQuarantinedSettlements(supplierId);
  const amountKes = rows.reduce((s, e) => s + (Number(e.payoutAmountKes) || 0), 0);
  let wdAmount = 0;
  let wdCount = 0;
  try {
    const { listQuarantinedWithdrawals } = await import("./seller-withdrawals.js");
    const wd = listQuarantinedWithdrawals(supplierId);
    wdCount = wd.length;
    wdAmount = wd.reduce((s, r) => s + (Number(r.amountKes) || 0), 0);
  } catch {
    /* ignore */
  }
  return {
    count: rows.length + wdCount,
    amountKes: amountKes + wdAmount,
    settlements: rows.length,
    withdrawals: wdCount,
  };
}

export async function summarizeQuarantinedForRider(riderId) {
  const { isDbEnabled, query } = await import("../db/pool.js");
  if (!isDbEnabled()) return { count: 0, amountKes: 0 };
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n,
            COALESCE(SUM(COALESCE(net_amount_paid, amount)),0)::numeric AS amt
       FROM rider_payouts
      WHERE rider_id = $1 AND status = 'QUARANTINED'`,
    [Number(riderId)]
  );
  return {
    count: Number(rows[0]?.n || 0),
    amountKes: Math.round(Number(rows[0]?.amt || 0)),
  };
}

/**
 * Boss: RELEASE PAYOUT +254… — move quarantined seller/rider lines back to owed/CLEARED
 * for a fresh manual / scheduled B2C attempt (never auto-fires Daraja here).
 */
export async function releaseQuarantinedPayoutsForPhone(phoneRaw, { adminLabel = "Boss" } = {}) {
  const digits = digitsOnly(phoneRaw);
  if (digits.length < 9) {
    return { ok: false, error: "invalid_phone", message: "Need a phone like +2547…" };
  }
  const national = digits.slice(-9);
  const note = `Released from quarantine by ${adminLabel}`;

  let sellerReleased = { count: 0, amountKes: 0 };
  let riderReleased = { count: 0, amountKes: 0 };
  const labels = [];

  try {
    const { findSupplierByPhone, listSuppliers } = await import("./suppliers.js");
    const byPhone = findSupplierByPhone(digits);
    const matches = new Map();
    if (byPhone?.id) matches.set(byPhone.id, byPhone);
    for (const s of listSuppliers() || []) {
      const p = digitsOnly(s.phone || "");
      const m = digitsOnly(s.mpesaNumber || "");
      if ((p && (p === digits || p.endsWith(national))) || (m && (m === digits || m.endsWith(national)))) {
        matches.set(s.id, s);
      }
    }
    const { releaseQuarantinedSettlements } = await import("./settlements.js");
    const { releaseQuarantinedWithdrawals } = await import("./seller-withdrawals.js");
    for (const s of matches.values()) {
      const st = releaseQuarantinedSettlements(s.id, { note });
      const wd = releaseQuarantinedWithdrawals(s.id, { note });
      sellerReleased.count += (st.count || 0) + (wd.count || 0);
      sellerReleased.amountKes += (st.amountKes || 0) + (wd.amountKes || 0);
      if ((st.count || 0) + (wd.count || 0) > 0) {
        labels.push(s.shopHandle || s.businessName || s.id);
      }
    }
  } catch (err) {
    console.warn("[b2c-interceptor] release seller:", err.message);
  }

  try {
    const { isDbEnabled, query } = await import("../db/pool.js");
    if (isDbEnabled()) {
      const found = await query(
        `SELECT id, full_name, phone FROM riders
          WHERE regexp_replace(phone, '\\D', '', 'g') LIKE '%' || $1
          ORDER BY updated_at DESC NULLS LAST LIMIT 3`,
        [national]
      );
      for (const r of found.rows) {
        const upd = await query(
          `UPDATE rider_payouts SET
             status = 'CLEARED',
             payout_hold_reason = $2,
             retry_after = NULL,
             requires_manual_approval = TRUE
           WHERE rider_id = $1 AND status = 'QUARANTINED'
           RETURNING COALESCE(net_amount_paid, amount)::numeric AS amt`,
          [r.id, note.slice(0, 400)]
        );
        if (upd.rows.length) {
          riderReleased.count += upd.rows.length;
          riderReleased.amountKes += upd.rows.reduce((s, x) => s + Math.round(Number(x.amt) || 0), 0);
          labels.push(r.full_name || r.phone);
        }
      }
    }
  } catch (err) {
    console.warn("[b2c-interceptor] release rider:", err.message);
  }

  const total = sellerReleased.count + riderReleased.count;
  const amountKes = sellerReleased.amountKes + riderReleased.amountKes;
  if (!total) {
    return {
      ok: false,
      error: "none_found",
      message: `No quarantined payouts for *${digits}*.`,
    };
  }

  return {
    ok: true,
    sellerReleased,
    riderReleased,
    amountKes,
    count: total,
    message:
      `Quarantined payouts *released* for ${labels.join(", ") || digits}.\n` +
      `• Lines: *${total}* · KES *${amountKes.toLocaleString()}*\n` +
      `Seller: back to *owed* (use #payb2c / withdraw). Rider: *CLEARED* + manual approval flag.\n` +
      `_Daraja was NOT auto-fired — approve B2C deliberately._`,
  };
}

export { alertBoss as alertBossB2CIntercept, digitsOnly as payoutDigitsOnly };
