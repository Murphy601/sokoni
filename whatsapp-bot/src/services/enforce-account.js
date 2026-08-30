/**
 * Admin enforce cascade — pause / suspend / restore sellers & riders.
 * Single entry for WhatsApp Boss commands + desk APIs.
 */
import {
  getSupplierByHandle,
  getSupplier,
  setSellerShopStatus,
  isShopPubliclyVisible,
  sellerPayoutsHeld,
} from "./suppliers.js";
import { hideListingsForSupplier, restoreListingsForSupplier } from "./listing-moderation.js";

function digitsOnly(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9 && /^[17]/.test(d)) d = `254${d}`;
  return d;
}

async function notifyWhatsApp(phone, text) {
  const digits = digitsOnly(phone);
  if (!digits || digits.length < 9) return;
  try {
    const { sendText } = await import("./whatsapp.js");
    await sendText(`${digits}@c.us`, text);
  } catch (err) {
    console.warn("[enforce-account] notify:", err.message);
  }
}

/**
 * @param {"PAUSE"|"SUSPEND"|"UNPAUSE"|"UNBAN"} action
 */
export async function enforceSellerAction(handleOrId, action, { reason = "", adminLabel = "Boss" } = {}) {
  const act = String(action || "").toUpperCase().trim();
  const note = String(reason || "").trim().slice(0, 280) || `${act} by ${adminLabel}`;

  let shop =
    getSupplierByHandle(handleOrId) ||
    (String(handleOrId || "").startsWith("sup_") || String(handleOrId || "").length > 8
      ? getSupplier(handleOrId)
      : null);
  if (!shop) {
    shop = getSupplier(handleOrId);
  }
  if (!shop?.id) {
    return { ok: false, error: "not_found", message: `Shop *${handleOrId}* not found.` };
  }

  const handle = String(shop.shopHandle || shop.businessName || shop.id).replace(/^@/, "");

  if (act === "PAUSE") {
    const result = setSellerShopStatus(shop.id, {
      status: "paused",
      note,
      holdPayouts: true,
    });
    if (result.error) return { ok: false, ...result };
    const hide = await hideListingsForSupplier(shop.id, { reason: note });
    await notifyWhatsApp(
      shop.phone,
      `⚠️ *Notice from Sokoni Mall*\n\n` +
        `Your store *@${handle}* has been temporarily *PAUSED* by Administration.\n\n` +
        `• Listings are hidden from search\n` +
        `• New orders are blocked\n` +
        `• M-Pesa withdrawals are locked\n\n` +
        `You can still open Seller Hub (read-only banner). Contact support if you need this reviewed.`
    );
    return {
      ok: true,
      action: "PAUSE_SELLER",
      shopStatus: "paused",
      handle: `@${handle}`,
      supplierId: shop.id,
      hidden: hide?.hidden || 0,
      message:
        `Shop *@${handle}* *PAUSED*. Listings hidden (${hide?.hidden || 0}). ` +
        `Payouts locked. New buys blocked. Seller notified.`,
    };
  }

  if (act === "SUSPEND") {
    const result = setSellerShopStatus(shop.id, {
      status: "deactivated",
      note,
      holdPayouts: true,
    });
    if (result.error) return { ok: false, ...result };
    const hide = await hideListingsForSupplier(shop.id, { reason: note });
    try {
      const { revokeSellerSession } = await import("./seller-verification.js");
      await revokeSellerSession(shop.phone || shop.mpesaNumber);
    } catch {
      /* optional session kill */
    }
    await notifyWhatsApp(
      shop.phone,
      `🛑 *Notice from Sokoni Mall*\n\n` +
        `Your seller account *@${handle}* has been *SUSPENDED* due to platform policy.\n\n` +
        `Seller Hub access is revoked until Ops restores the account. Contact support@sokonimall.com.`
    );
    return {
      ok: true,
      action: "SUSPEND_SELLER",
      shopStatus: "deactivated",
      handle: `@${handle}`,
      supplierId: shop.id,
      hidden: hide?.hidden || 0,
      message:
        `Shop *@${handle}* *SUSPENDED* (deactivated). Listings hidden (${hide?.hidden || 0}). ` +
        `Sessions cleared. Seller notified.`,
    };
  }

  if (act === "UNPAUSE" || act === "UNBAN" || act === "RESTORE") {
    const result = setSellerShopStatus(shop.id, {
      status: "live",
      note: note || "Restored by Admin",
      holdPayouts: false,
    });
    if (result.error) return { ok: false, ...result };
    const restore = await restoreListingsForSupplier(shop.id);
    await notifyWhatsApp(
      shop.phone,
      `🟢 *Notice from Sokoni Ops*\n\n` +
        `Your seller account *@${handle}* has been *FULLY RESTORED*.\n\n` +
        `Listings are live again. You can accept orders and withdraw cleared escrow.`
    );
    return {
      ok: true,
      action: act === "UNBAN" ? "UNBAN_SELLER" : "UNPAUSE_SELLER",
      shopStatus: "live",
      handle: `@${handle}`,
      supplierId: shop.id,
      restored: restore?.restored || 0,
      message:
        `Shop *@${handle}* *LIVE* again. Listings restored (${restore?.restored || 0}). ` +
        `Payouts unlocked. Seller notified.`,
    };
  }

  return { ok: false, error: "invalid_action", message: `Unknown seller action: ${act}` };
}

/**
 * @param {"PAUSE"|"UNPAUSE"|"SUSPEND"|"UNBAN"} action
 */
export async function enforceRiderAction(phoneRaw, action, { reason = "", adminLabel = "Boss" } = {}) {
  const act = String(action || "").toUpperCase().trim();
  const note = String(reason || "").trim().slice(0, 280) || `${act} by ${adminLabel}`;
  const digits = digitsOnly(phoneRaw);
  if (digits.length < 9) {
    return { ok: false, error: "invalid_phone", message: "Need a rider phone like +2547…" };
  }

  const {
    findRiderRowByPhone,
    setRiderVerificationStatus,
    setRiderAvailabilityById,
    unassignOpenDispatchesForRider,
  } = await import("./boda-fleet.js").then(async (m) => {
    // Prefer dedicated helpers; fall back gracefully
    let findRiderRowByPhone = m.findRiderByPhoneDigits || null;
    if (!findRiderRowByPhone) {
      findRiderRowByPhone = async (p) => {
        const { query, isDbEnabled } = await import("../db/pool.js");
        if (!isDbEnabled()) return null;
        const national = digitsOnly(p).slice(-9);
        const { rows } = await query(
          `SELECT * FROM riders
            WHERE regexp_replace(phone, '\\D', '', 'g') LIKE '%' || $1
            ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
          [national]
        );
        return rows[0] || null;
      };
    }
    return {
      findRiderRowByPhone,
      setRiderVerificationStatus: m.setRiderVerificationStatus,
      setRiderAvailabilityById: m.setRiderAvailabilityById || null,
      unassignOpenDispatchesForRider: m.unassignOpenDispatchesForRider || null,
    };
  });

  const row = await findRiderRowByPhone(digits);
  if (!row?.id) {
    return { ok: false, error: "not_found", message: `Rider *${digits}* not found.` };
  }
  const riderId = Number(row.id);
  const name = row.full_name || row.fullName || "Rider";

  if (act === "PAUSE") {
    const { query, isDbEnabled } = await import("../db/pool.js");
    if (!isDbEnabled()) return { ok: false, error: "database_not_configured" };
    if (String(row.verification_status || "").toUpperCase() === "SUSPENDED") {
      return {
        ok: false,
        error: "suspended",
        message: `Rider *${name}* is SUSPENDED — use *UNBAN RIDER* first, or *UNPAUSE* after restore.`,
      };
    }
    await query(
      `UPDATE riders SET
         is_available = FALSE,
         suspend_reason = $2,
         updated_at = NOW()
       WHERE id = $1`,
      [riderId, `ADMIN_PAUSE: ${note}`.slice(0, 400)]
    );
    let unassigned = 0;
    if (unassignOpenDispatchesForRider) {
      const u = await unassignOpenDispatchesForRider(riderId, { onlyPrePickup: true });
      unassigned = u?.unassigned || 0;
    } else {
      unassigned = await unassignPrePickupJobs(riderId);
    }
    await notifyWhatsApp(
      row.phone || digits,
      `⚠️ *Notice from Sokoni Ops*\n\n` +
        `Your rider account has been *PAUSED*. You are set *OFFLINE* and will not receive new jobs.\n\n` +
        `Contact Ops if you need this reviewed.`
    );
    return {
      ok: true,
      action: "PAUSE_RIDER",
      riderId,
      phone: row.phone || digits,
      unassigned,
      message:
        `Rider *${name}* (*${row.phone || digits}*) *PAUSED* (OFFLINE). ` +
        `Pre-pickup jobs requeued: ${unassigned}. Rider notified.`,
    };
  }

  if (act === "UNPAUSE") {
    const { query, isDbEnabled } = await import("../db/pool.js");
    if (!isDbEnabled()) return { ok: false, error: "database_not_configured" };
    if (String(row.verification_status || "").toUpperCase() === "SUSPENDED") {
      return {
        ok: false,
        error: "suspended",
        message: `Rider is still SUSPENDED — run *UNBAN RIDER ${digits}* to fully restore.`,
      };
    }
    if (String(row.verification_status || "").toUpperCase() !== "VERIFIED") {
      return {
        ok: false,
        error: "not_verified",
        message: `Rider is ${row.verification_status || "PENDING"} — verify before UNPAUSE.`,
      };
    }
    await query(
      `UPDATE riders SET
         is_available = TRUE,
         suspend_reason = CASE
           WHEN suspend_reason LIKE 'ADMIN_PAUSE:%' THEN NULL
           ELSE suspend_reason
         END,
         updated_at = NOW()
       WHERE id = $1 AND verification_status = 'VERIFIED'`,
      [riderId]
    );
    await notifyWhatsApp(
      row.phone || digits,
      `🟢 *Account Restored*\n\n` +
        `Your rider profile is active again. Reply *AVAILABLE* (or stay online) to receive delivery jobs.`
    );
    return {
      ok: true,
      action: "UNPAUSE_RIDER",
      riderId,
      message: `Rider *${name}* unpaused — marked AVAILABLE. Rider notified.`,
    };
  }

  if (act === "SUSPEND") {
    const result = await setRiderVerificationStatus(riderId, "SUSPENDED", {
      reason: note,
      silent: true,
    });
    if (result.error) return { ok: false, ...result };
    const jobs = await handleRiderSuspendJobs(riderId);
    const unassigned = jobs.unassigned;
    const heldPickup = jobs.heldWithPackage;
    await notifyWhatsApp(
      row.phone || digits,
      `🛑 *Notice from Sokoni Ops*\n\n` +
        `Your Rider account has been *SUSPENDED*. Active unpicked jobs were returned to the pool.\n` +
        (heldPickup
          ? `\n⚠️ You still hold ${heldPickup} package(s) — Ops will contact you. Do not abandon the parcel.`
          : "")
    );
    return {
      ok: true,
      action: "SUSPEND_RIDER",
      riderId,
      unassigned,
      heldWithPackage: heldPickup,
      message:
        `Rider *${name}* *SUSPENDED*. Pre-pickup requeued: ${unassigned}. ` +
        `In-hand packages flagged: ${heldPickup}. Rider notified.`,
    };
  }

  if (act === "UNBAN") {
    const result = await setRiderVerificationStatus(riderId, "VERIFIED", {
      reason: note,
      silent: true,
    });
    if (result.error) return { ok: false, ...result };
    await notifyWhatsApp(
      row.phone || digits,
      `🟢 *Account Restored*\n\n` +
        `Your rider profile (+${digits}) is now *ACTIVE*. Switch to *ONLINE* / *AVAILABLE* to receive delivery jobs.`
    );
    return {
      ok: true,
      action: "UNBAN_RIDER",
      riderId,
      message: `Rider *${name}* *UNBANNED* → VERIFIED. Rider notified.`,
    };
  }

  return { ok: false, error: "invalid_action", message: `Unknown rider action: ${act}` };
}

async function unassignPrePickupJobs(riderId) {
  const { query, isDbEnabled } = await import("../db/pool.js");
  if (!isDbEnabled()) return 0;
  try {
    const { rows } = await query(
      `UPDATE delivery_dispatches SET
         status = 'REQUESTED',
         rider_id = NULL,
         custody_status = 'AWAITING_PICKUP',
         updated_at = NOW()
       WHERE rider_id = $1
         AND status IN ('ACCEPTED', 'OTP_SENT')
       RETURNING id`,
      [Number(riderId)]
    );
    return rows.length;
  } catch (err) {
    console.warn("[enforce-account] unassignPrePickup:", err.message);
    return 0;
  }
}

async function handleRiderSuspendJobs(riderId) {
  const { query, isDbEnabled } = await import("../db/pool.js");
  if (!isDbEnabled()) return { unassigned: 0, heldWithPackage: 0 };
  let unassigned = 0;
  let heldWithPackage = 0;
  try {
    const pre = await query(
      `UPDATE delivery_dispatches SET
         status = 'REQUESTED',
         rider_id = NULL,
         custody_status = 'AWAITING_PICKUP',
         updated_at = NOW()
       WHERE rider_id = $1
         AND status IN ('ACCEPTED', 'OTP_SENT')
       RETURNING order_ref`,
      [Number(riderId)]
    );
    unassigned = pre.rows.length;
  } catch (err) {
    console.warn("[enforce-account] suspend pre-pickup:", err.message);
  }
  try {
    const held = await query(
      `UPDATE delivery_dispatches SET
         updated_at = NOW()
       WHERE rider_id = $1
         AND status IN ('PICKED_UP', 'OTP_LOCKED')
       RETURNING order_ref, id`,
      [Number(riderId)]
    );
    heldWithPackage = held.rows.length;
    for (const row of held.rows) {
      try {
        const { updateOrderMeta, getOrder } = await import("./orders.js");
        const ref = String(row.order_ref || "").toUpperCase();
        if (ref && getOrder(ref)) {
          updateOrderMeta(ref, {
            bodaStatus: "RIDER_HELD_DISPUTE",
            bodaAdminHold: true,
            bodaAdminHoldReason: "Rider suspended while carrying package",
            bodaAdminHoldAt: Date.now(),
          });
        }
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    console.warn("[enforce-account] suspend in-hand:", err.message);
  }
  return { unassigned, heldWithPackage };
}

/** Hard gate for checkout — shop must be live. */
export function assertSupplierCanSell(supplierId) {
  if (!supplierId) return { ok: true };
  const s = getSupplier(supplierId);
  if (!s) return { ok: true };
  if (isShopPubliclyVisible(s)) return { ok: true };
  const st = String(s.shopStatus || "live").toLowerCase();
  return {
    ok: false,
    error: "shop_unavailable",
    shopStatus: st,
    message:
      st === "paused"
        ? "This store is temporarily unavailable."
        : "This store is currently unavailable.",
  };
}

export { isShopPubliclyVisible, sellerPayoutsHeld };
