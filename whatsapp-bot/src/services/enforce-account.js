/**
 * Admin enforce cascade — pause / suspend / restore sellers & riders.
 * Single entry for WhatsApp Boss commands + desk APIs.
 */
import {
  getSupplierByHandle,
  getSupplier,
  findSupplierByPhone,
  listSuppliers,
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
  if (!digits || digits.length < 9) return { ok: false, error: "no_phone" };
  try {
    const { sendTextReliable } = await import("./whatsapp.js");
    await sendTextReliable(`${digits}@c.us`, text, { label: "enforce-account" });
    return { ok: true, phone: digits };
  } catch (err) {
    console.warn("[enforce-account] notify:", err.message);
    try {
      const { sendText } = await import("./whatsapp.js");
      await sendText(`${digits}@c.us`, text);
      return { ok: true, phone: digits, soft: true };
    } catch (err2) {
      console.warn("[enforce-account] notify fallback:", err2.message);
      return { ok: false, error: err2.message };
    }
  }
}

async function notifyBoss(text) {
  try {
    const { config } = await import("../config.js");
    const phones = [
      ...(config.admin?.phones || []),
      config.admin?.primary,
      config.contact?.founderPhone,
    ].filter(Boolean);
    const seen = new Set();
    for (const p of phones) {
      const d = digitsOnly(p);
      if (!d || d.length < 9 || seen.has(d.slice(-9))) continue;
      seen.add(d.slice(-9));
      await notifyWhatsApp(d, text);
    }
  } catch (err) {
    console.warn("[enforce-account] boss notify:", err.message);
  }
}

async function hideShopCatalog(shop, note) {
  const handle = String(shop.shopHandle || "").replace(/^@/, "");
  return hideListingsForSupplier(shop.id, {
    reason: note,
    phone: shop.phone || shop.mpesaNumber || "",
    handle,
  });
}

async function restoreShopCatalog(shop) {
  const handle = String(shop.shopHandle || "").replace(/^@/, "");
  return restoreListingsForSupplier(shop.id, {
    phone: shop.phone || shop.mpesaNumber || "",
    handle,
  });
}

/**
 * @param {"PAUSE"|"SUSPEND"|"DEACTIVATE"|"UNPAUSE"|"UNBAN"|"RESTORE"} action
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
    // Try phone lookup for panel IDs / numbers
    try {
      const { findSupplierByPhone } = await import("./suppliers.js");
      shop = findSupplierByPhone(handleOrId);
    } catch {
      /* ignore */
    }
  }
  if (!shop?.id) {
    return { ok: false, error: "not_found", message: `Shop *${handleOrId}* not found.` };
  }

  const handle = String(shop.shopHandle || shop.businessName || shop.id).replace(/^@/, "");
  const sellerPhone = shop.phone || shop.mpesaNumber;

  if (act === "PAUSE") {
    const result = setSellerShopStatus(shop.id, {
      status: "paused",
      note,
      holdPayouts: true,
    });
    if (result.error) return { ok: false, ...result };
    const hide = await hideShopCatalog(shop, note);
    let b2c = { quarantined: 0, awaitingCallback: 0, amountKes: 0 };
    try {
      const { quarantineSellerInFlightPayouts } = await import("./b2c-interceptor.js");
      b2c = await quarantineSellerInFlightPayouts(shop.id, { reason: note, action: "PAUSE" });
    } catch (err) {
      console.warn("[enforce-account] B2C quarantine:", err.message);
    }
    const sellerMsg =
      `⚠️ *Notice from Sokoni Mall*\n\n` +
      `Your store *@${handle}* has been temporarily *PAUSED* by Administration.\n\n` +
      `• Shop page & listings are hidden from buyers\n` +
      `• New orders are blocked\n` +
      `• M-Pesa withdrawals are locked\n\n` +
      `You can still open Seller Hub (read-only banner). Contact support if you need this reviewed.`;
    const notified = await notifyWhatsApp(sellerPhone, sellerMsg);
    await notifyBoss(
      `⚠️ *Shop PAUSED*\n*@${handle}* · ${sellerPhone || "no phone"}\n` +
        `Listings hidden: ${hide?.hidden || 0}\n` +
        `Seller WA notify: ${notified.ok ? "sent" : "FAILED"}\n` +
        `_By ${adminLabel}_`
    );
    const qNote =
      b2c.quarantined || b2c.awaitingCallback
        ? ` B2C quarantined ${b2c.quarantined || 0}` +
          (b2c.amountKes ? ` (KES ${b2c.amountKes.toLocaleString()})` : "") +
          (b2c.awaitingCallback ? `; ${b2c.awaitingCallback} awaiting Safaricom callback.` : ".")
        : "";
    return {
      ok: true,
      action: "PAUSE_SELLER",
      shopStatus: "paused",
      handle: `@${handle}`,
      supplierId: shop.id,
      hidden: hide?.hidden || 0,
      notified: Boolean(notified.ok),
      b2c,
      message:
        `Shop *@${handle}* *PAUSED*. Listings/shop hidden (${hide?.hidden || 0}). ` +
        `Payouts locked. Seller ${notified.ok ? "notified" : "notify FAILED"}.${qNote}`,
    };
  }

  if (act === "SUSPEND" || act === "DEACTIVATE") {
    const result = setSellerShopStatus(shop.id, {
      status: "deactivated",
      note,
      holdPayouts: true,
    });
    if (result.error) return { ok: false, ...result };
    const hide = await hideShopCatalog(shop, note);
    let b2c = { quarantined: 0, awaitingCallback: 0, amountKes: 0 };
    try {
      const { quarantineSellerInFlightPayouts } = await import("./b2c-interceptor.js");
      b2c = await quarantineSellerInFlightPayouts(shop.id, {
        reason: note,
        action: act === "DEACTIVATE" ? "DEACTIVATE" : "SUSPEND",
      });
    } catch (err) {
      console.warn("[enforce-account] B2C quarantine:", err.message);
    }
    try {
      const { revokeSellerSession } = await import("./seller-verification.js");
      await revokeSellerSession(sellerPhone);
    } catch {
      /* optional session kill */
    }
    const hardLabel = act === "DEACTIVATE" ? "DEACTIVATED" : "SUSPENDED";
    const sellerMsg =
      `🛑 *Notice from Sokoni Mall*\n\n` +
      `Your seller account *@${handle}* has been *${hardLabel}* due to platform policy.\n\n` +
      `• Shop page is unlisted (not found)\n` +
      `• All listings are hidden\n` +
      `• Seller Hub login is blocked\n\n` +
      `Contact support@sokonimall.com if you need a review.`;
    const notified = await notifyWhatsApp(sellerPhone, sellerMsg);
    await notifyBoss(
      `🛑 *Shop ${hardLabel}*\n*@${handle}* · ${sellerPhone || "no phone"}\n` +
        `Listings hidden: ${hide?.hidden || 0}\n` +
        `Seller WA notify: ${notified.ok ? "sent" : "FAILED"}\n` +
        `_By ${adminLabel}_ · ${note}`
    );
    const qNote =
      b2c.quarantined || b2c.awaitingCallback
        ? ` B2C quarantined ${b2c.quarantined || 0}` +
          (b2c.amountKes ? ` (KES ${b2c.amountKes.toLocaleString()})` : "") +
          "."
        : "";
    return {
      ok: true,
      action: act === "DEACTIVATE" ? "DEACTIVATE_SELLER" : "SUSPEND_SELLER",
      shopStatus: "deactivated",
      handle: `@${handle}`,
      supplierId: shop.id,
      hidden: hide?.hidden || 0,
      notified: Boolean(notified.ok),
      b2c,
      message:
        `Shop *@${handle}* *${hardLabel}*. Listings/shop unlisted (${hide?.hidden || 0}). ` +
        `Sessions cleared. Seller ${notified.ok ? "notified" : "notify FAILED"}.${qNote}`,
    };
  }

  if (act === "UNPAUSE" || act === "UNBAN" || act === "RESTORE" || act === "ACTIVATE") {
    const result = setSellerShopStatus(shop.id, {
      status: "live",
      note: note || "Restored by Admin",
      holdPayouts: false,
    });
    if (result.error) return { ok: false, ...result };
    const restore = await restoreShopCatalog(shop);
    let qPrompt = "";
    try {
      const { summarizeQuarantinedForSeller } = await import("./b2c-interceptor.js");
      const q = await summarizeQuarantinedForSeller(shop.id);
      if (q.count > 0) {
        qPrompt =
          `\n\n⚠️ *Release quarantined payout of KES ${q.amountKes.toLocaleString()}?*\n` +
          `Reply *RELEASE PAYOUT ${shop.mpesaNumber || shop.phone}* to unblock (does not auto-send B2C).`;
      }
    } catch {
      /* ignore */
    }
    const sellerMsg =
      `🟢 *Notice from Sokoni Ops*\n\n` +
      `Your seller account *@${handle}* has been *FULLY RESTORED*.\n\n` +
      `Listings and shop page are live again. You can accept orders and withdraw cleared escrow.`;
    const notified = await notifyWhatsApp(sellerPhone, sellerMsg);
    await notifyBoss(
      `🟢 *Shop RESTORED*\n*@${handle}* · ${sellerPhone || "no phone"}\n` +
        `Listings restored: ${restore?.restored || 0}\n` +
        `Seller WA notify: ${notified.ok ? "sent" : "FAILED"}\n` +
        `_By ${adminLabel}_` +
        (qPrompt ? `\n${qPrompt.replace(/\*/g, "")}` : "")
    );
    return {
      ok: true,
      action: act === "UNBAN" ? "UNBAN_SELLER" : "UNPAUSE_SELLER",
      shopStatus: "live",
      handle: `@${handle}`,
      supplierId: shop.id,
      restored: restore?.restored || 0,
      notified: Boolean(notified.ok),
      message:
        `Shop *@${handle}* *LIVE* again. Listings restored (${restore?.restored || 0}). ` +
        `Seller ${notified.ok ? "notified" : "notify FAILED"}.` +
        qPrompt,
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
    let b2c = { quarantined: 0, awaitingCallback: 0, amountKes: 0 };
    try {
      const { quarantineRiderInFlightPayouts } = await import("./b2c-interceptor.js");
      b2c = await quarantineRiderInFlightPayouts(riderId, { reason: note, action: "PAUSE" });
    } catch (err) {
      console.warn("[enforce-account] rider B2C quarantine:", err.message);
    }
    const notified = await notifyWhatsApp(
      row.phone || digits,
      `⚠️ *Notice from Sokoni Ops*\n\n` +
        `Your rider account has been *PAUSED*. You are set *OFFLINE* and will not receive new jobs.\n\n` +
        `Contact Ops if you need this reviewed.`
    );
    await notifyBoss(
      `⚠️ *Rider PAUSED*\n*${name}* · ${row.phone || digits}\n` +
        `Jobs requeued: ${unassigned}\n` +
        `Rider WA: ${notified.ok ? "sent" : "FAILED"}\n_By ${adminLabel}_`
    );
    const qNote =
      b2c.quarantined || b2c.awaitingCallback
        ? ` B2C quarantined ${b2c.quarantined || 0}` +
          (b2c.amountKes ? ` (KES ${b2c.amountKes.toLocaleString()})` : "") +
          "."
        : "";
    return {
      ok: true,
      action: "PAUSE_RIDER",
      riderId,
      phone: row.phone || digits,
      unassigned,
      b2c,
      notified: Boolean(notified.ok),
      message:
        `Rider *${name}* (*${row.phone || digits}*) *PAUSED* (OFFLINE). ` +
        `Pre-pickup jobs requeued: ${unassigned}. Rider ${notified.ok ? "notified" : "notify FAILED"}.${qNote}`,
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
    let qPrompt = "";
    try {
      const { summarizeQuarantinedForRider } = await import("./b2c-interceptor.js");
      const q = await summarizeQuarantinedForRider(riderId);
      if (q.count > 0) {
        qPrompt =
          `\n\n⚠️ *Release quarantined payout of KES ${q.amountKes.toLocaleString()}?*\n` +
          `Reply *RELEASE PAYOUT ${row.phone || digits}* (manual — does not auto-send B2C).`;
      }
    } catch {
      /* ignore */
    }
    const notified = await notifyWhatsApp(
      row.phone || digits,
      `🟢 *Account Restored*\n\n` +
        `Your rider profile is active again. Reply *AVAILABLE* (or stay online) to receive delivery jobs.`
    );
    await notifyBoss(
      `🟢 *Rider UNPAUSED*\n*${name}* · ${row.phone || digits}\n` +
        `Rider WA: ${notified.ok ? "sent" : "FAILED"}\n_By ${adminLabel}_`
    );
    return {
      ok: true,
      action: "UNPAUSE_RIDER",
      riderId,
      notified: Boolean(notified.ok),
      message:
        `Rider *${name}* unpaused — marked AVAILABLE. Rider ${notified.ok ? "notified" : "notify FAILED"}.` +
        qPrompt,
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
    let b2c = { quarantined: 0, awaitingCallback: 0, amountKes: 0 };
    try {
      const { quarantineRiderInFlightPayouts } = await import("./b2c-interceptor.js");
      b2c = await quarantineRiderInFlightPayouts(riderId, { reason: note, action: "SUSPEND" });
    } catch (err) {
      console.warn("[enforce-account] rider B2C quarantine:", err.message);
    }
    const notified = await notifyWhatsApp(
      row.phone || digits,
      `🛑 *Notice from Sokoni Ops*\n\n` +
        `Your Rider account has been *SUSPENDED*. Active unpicked jobs were returned to the pool.\n` +
        (heldPickup
          ? `\n⚠️ You still hold ${heldPickup} package(s) — Ops will contact you. Do not abandon the parcel.`
          : "")
    );
    await notifyBoss(
      `🛑 *Rider SUSPENDED*\n*${name}* · ${row.phone || digits}\n` +
        `Requeued: ${unassigned} · In-hand: ${heldPickup}\n` +
        `Rider WA: ${notified.ok ? "sent" : "FAILED"}\n_By ${adminLabel}_`
    );
    return {
      ok: true,
      action: "SUSPEND_RIDER",
      riderId,
      unassigned,
      heldWithPackage: heldPickup,
      b2c,
      notified: Boolean(notified.ok),
      message:
        `Rider *${name}* *SUSPENDED*. Pre-pickup requeued: ${unassigned}. ` +
        `In-hand packages flagged: ${heldPickup}. Rider ${notified.ok ? "notified" : "notify FAILED"}.` +
        (b2c.quarantined ? ` B2C quarantined ${b2c.quarantined}.` : ""),
    };
  }

  if (act === "UNBAN") {
    const result = await setRiderVerificationStatus(riderId, "VERIFIED", {
      reason: note,
      silent: true,
    });
    if (result.error) return { ok: false, ...result };
    let qPrompt = "";
    try {
      const { summarizeQuarantinedForRider } = await import("./b2c-interceptor.js");
      const q = await summarizeQuarantinedForRider(riderId);
      if (q.count > 0) {
        qPrompt =
          `\n\n⚠️ *Release quarantined payout of KES ${q.amountKes.toLocaleString()}?*\n` +
          `Reply *RELEASE PAYOUT ${row.phone || digits}*.`;
      }
    } catch {
      /* ignore */
    }
    const notified = await notifyWhatsApp(
      row.phone || digits,
      `🟢 *Account Restored*\n\n` +
        `Your rider profile (+${digits}) is now *ACTIVE*. Switch to *ONLINE* / *AVAILABLE* to receive delivery jobs.`
    );
    await notifyBoss(
      `🟢 *Rider UNBANNED*\n*${name}* · ${row.phone || digits}\n` +
        `Rider WA: ${notified.ok ? "sent" : "FAILED"}\n_By ${adminLabel}_`
    );
    return {
      ok: true,
      action: "UNBAN_RIDER",
      riderId,
      notified: Boolean(notified.ok),
      message:
        `Rider *${name}* *UNBANNED* → VERIFIED. Rider ${notified.ok ? "notified" : "notify FAILED"}.` +
        qPrompt,
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

function normalizeShopHandle(raw) {
  return String(raw || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

/** Platform / default storefront listings — not peer seller shops. */
export function isPlatformOwnedListing(product) {
  if (!product) return true;
  const handle = normalizeShopHandle(product.shopHandle || product.sellerHandle);
  // Explicit peer handle → never platform.
  if (handle && handle !== "sokoni-store") return false;
  const sid = String(product.supplierId || "").trim();
  // Peer supplier ids survive purge remaps that wipe the handle.
  if (sid && /^(sup[_-]|seller[_-])/i.test(sid)) return false;
  const phone = String(product.sellerPhone || "").replace(/\D/g, "");
  if (phone.length >= 9) return false;
  return true;
}

/** Resolve supplier for a product (id → handle → phone). */
export function resolveProductSupplier(product) {
  if (!product) return null;
  try {
    if (product.supplierId) {
      const byId = getSupplier(product.supplierId);
      if (byId) return byId;
    }
    const { getSupplierByHandle, findSupplierByPhone } = requireSuppliersLazy();
    const handle = normalizeShopHandle(product.shopHandle || product.sellerHandle);
    if (handle && handle !== "sokoni-store") {
      const byHandle = getSupplierByHandle(handle);
      if (byHandle) return byHandle;
    }
    const phone = product.sellerPhone || product.phone;
    if (phone) {
      const byPhone = findSupplierByPhone(phone);
      if (byPhone) return byPhone;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Peer listings whose seller was hard-deleted (or never provisioned) must not
 * stay on the public grid — otherwise DELETE SELLER leaves orphan products live.
 */
export function isProductFromMissingShop(product) {
  if (!product || isPlatformOwnedListing(product)) return false;
  return !resolveProductSupplier(product);
}

/** Hard gate for checkout — shop must be live. Missing supplier = blocked for peer ids. */
export function assertSupplierCanSell(supplierId) {
  if (!supplierId) return { ok: true };
  const s = getSupplier(supplierId);
  if (!s) {
    // Orphan after hard delete — do not allow sell / public show.
    return {
      ok: false,
      error: "shop_unavailable",
      shopStatus: "deleted",
      message: "This store is currently unavailable.",
    };
  }
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

/** Gate a catalog product by supplier id, shop handle, or seller phone. */
export function assertProductShopVisible(product) {
  if (!product) return { ok: true };

  // Peer shop must still exist and be live (deleted sellers → hide orphans).
  if (!isPlatformOwnedListing(product)) {
    const supplier = resolveProductSupplier(product);
    if (!supplier) {
      return {
        ok: false,
        error: "shop_unavailable",
        shopStatus: "deleted",
        message: "This store is currently unavailable.",
      };
    }
    if (!isShopPubliclyVisible(supplier)) {
      const st = String(supplier.shopStatus || "live").toLowerCase();
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
    return { ok: true };
  }

  if (product.supplierId) {
    const byId = assertSupplierCanSell(product.supplierId);
    if (!byId.ok) return byId;
  }
  return { ok: true };
}

function requireSuppliersLazy() {
  return {
    getSupplierByHandle,
    findSupplierByPhone,
  };
}

/** Build lookup sets for paused/deactivated shops (list/search filter). */
export function blockedShopLookup() {
  const ids = new Set();
  const handles = new Set();
  const phones = new Set();
  try {
    for (const s of listSuppliers() || []) {
      if (isShopPubliclyVisible(s)) continue;
      if (s.id) ids.add(String(s.id));
      for (const raw of [s.shopHandle, s.businessName, s.shopName]) {
        const h = String(raw || "")
          .trim()
          .replace(/^@+/, "")
          .toLowerCase();
        if (h) handles.add(h);
      }
      const d = String(s.phone || s.mpesaNumber || "").replace(/\D/g, "");
      if (d.length >= 9) phones.add(d.slice(-9));
    }
  } catch {
    /* ignore */
  }
  return { ids, handles, phones };
}

export function isProductFromBlockedShop(product, lookup = null) {
  if (!product) return false;
  // Hard-deleted shops leave no supplier row — treat as blocked for public lists.
  if (isProductFromMissingShop(product)) return true;
  const blocked = lookup || blockedShopLookup();
  if (product.supplierId && blocked.ids.has(String(product.supplierId))) return true;
  const handle = String(product.shopHandle || product.sellerHandle || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
  if (handle && blocked.handles.has(handle)) return true;
  const d = String(product.sellerPhone || product.phone || "").replace(/\D/g, "");
  if (d.length >= 9 && blocked.phones.has(d.slice(-9))) return true;
  return false;
}

export { isShopPubliclyVisible, sellerPayoutsHeld };
