/**
 * Phase 13 — In-app dispute resolution + escrow freeze helpers.
 * Money stays on JSON SK-orders + settlements.json (same as live prepaid flow).
 */
import { isDbEnabled, query } from "../db/pool.js";
import { getOrder, updateOrderMeta, updateOrderStatus, listAllOrders, normalizeOrderId } from "./orders.js";
import {
  cancelSettlementPayout,
  reinstateSettlementPayout,
  scheduleSellerPayoutAfterDelivery,
  processDuePayouts,
  markSettlementReadyForMpesa,
} from "./settlements.js";
import { resolveSellerPayoutKes, orderBuyerTotal } from "./shipping-tiers.js";
import { buildPublicTrackingPayload } from "./shipments.js";

const OPEN_STATUSES = new Set(["open", "under_review"]);
const REASONS = new Set(["not_as_described", "wrong_item", "damaged", "not_received", "other"]);

/** WhatsApp fan-out for dispute lifecycle (dynamic import avoids hub↔orders cycles). */
async function notifyDisputeParties(order, dispute, {
  eventType,
  adminDetails,
  buyerMessage = null,
  sellerMessage = null,
} = {}) {
  if (!order) return;
  try {
    const { notifyOrderParties, notifyAdminEvent } = await import("./communication-hub.js");
    const sellerUserId = Number(dispute?.sellerUserId || order.sellerUserId || 0) || null;
    if (sellerUserId && !order.sellerUserId) {
      updateOrderMeta(order.id, { sellerUserId });
      order = getOrder(order.id) || order;
    }
    await notifyOrderParties(order, { buyerMessage, sellerMessage, sellerUserId });
    if (eventType && adminDetails) {
      await notifyAdminEvent(eventType, {
        orderId: order.id,
        details: adminDetails,
      });
    }
  } catch (err) {
    console.warn("[disputes] notify failed:", err?.message || err);
  }
}

function parseUserId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function normalizeOrderRef(value) {
  return normalizeOrderId(value) || "";
}

function mapDisputeRow(row) {
  return {
    id: Number(row.id),
    orderRef: row.order_ref,
    orderId: row.order_id != null ? Number(row.order_id) : null,
    buyerUserId: Number(row.buyer_user_id),
    sellerUserId: Number(row.seller_user_id),
    reason: row.reason,
    status: row.status,
    buyerStatement: row.buyer_statement || null,
    sellerResponse: row.seller_response || null,
    adminNotes: row.admin_notes || null,
    resolution: row.resolution || null,
    escrowFrozenAt: row.escrow_frozen_at || null,
    resolvedAt: row.resolved_at || null,
    resolvedBy: row.resolved_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function appendEvent(disputeId, actorRole, action, detail = null) {
  await query(
    `INSERT INTO dispute_events (dispute_id, actor_role, action, detail)
     VALUES ($1, $2, $3, $4)`,
    [disputeId, actorRole, action, detail]
  );
}

export async function freezeOrderEscrow(orderRef) {
  const order = getOrder(orderRef);
  if (!order) return { frozen: false, reason: "order_not_found" };

  cancelSettlementPayout(order.id, "dispute");
  updateOrderMeta(order.id, {
    disputeHold: true,
    escrowStatus: order.escrowStatus === "refunded" ? "refunded" : "held",
    disputeFrozenAt: Date.now(),
    payoutStatus: "held_for_dispute",
  });
  return { frozen: true, orderId: order.id };
}

export async function orderHasOpenDispute(orderRef) {
  if (!isDbEnabled()) return false;
  const ref = normalizeOrderRef(orderRef);
  if (!ref) return false;
  try {
    const { rows } = await query(
      `SELECT id FROM order_disputes
        WHERE UPPER(order_ref) = $1
          AND status IN ('open', 'under_review')
        LIMIT 1`,
      [ref]
    );
    return Boolean(rows[0]);
  } catch {
    return false;
  }
}

/** Open / under_review dispute row for an order, or null. */
export async function getOpenDisputeForOrder(orderRef) {
  if (!isDbEnabled()) return null;
  const ref = normalizeOrderRef(orderRef);
  if (!ref) return null;
  try {
    const { rows } = await query(
      `SELECT * FROM order_disputes
        WHERE UPPER(order_ref) = $1
          AND status IN ('open', 'under_review')
        ORDER BY created_at DESC
        LIMIT 1`,
      [ref]
    );
    return rows[0] ? mapDisputeRow(rows[0]) : null;
  } catch {
    return null;
  }
}

export async function createDispute({
  orderRef,
  buyerUserId,
  sellerUserId = null,
  reason = "other",
  statement = "",
  buyerPhone = "",
  /** When false, skip notifyDisputeParties — caller sends WAHA alerts (openBuyerReturnCase). */
  notifyWhatsApp = true,
} = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const buyerId = parseUserId(buyerUserId);
  const ref = normalizeOrderRef(orderRef);
  const cleanReason = REASONS.has(String(reason)) ? String(reason) : "other";
  const text = String(statement || "").trim().slice(0, 2000);

  if (!buyerId || !ref) {
    return { error: "invalid_dispute", message: "Order number and buyer are required." };
  }

  const order = getOrder(ref);
  if (!order) {
    return { error: "order_not_found", message: "Order not found. Check your SKN-#### (or older SK-####) number." };
  }
  if (order.status === "cancelled") {
    return { error: "dispute_not_allowed", message: "Cancelled orders cannot be disputed." };
  }
  if (order.customerPaymentStatus !== "confirmed" && !order.paid) {
    return { error: "dispute_not_allowed", message: "Pay for the order before opening a dispute." };
  }

  // Buyer match via customerKey or phone
  const keyOk = String(order.customerKey || "") === `web:buyer:${buyerId}`;
  const phoneDigits = String(buyerPhone || "").replace(/\D/g, "");
  const orderPhone = String(order.phone || order.mpesaPhone || "").replace(/\D/g, "");
  const phoneOk = phoneDigits && orderPhone && (
    phoneDigits === orderPhone ||
    phoneDigits.slice(-9) === orderPhone.slice(-9)
  );
  if (!keyOk && !phoneOk) {
    return {
      error: "buyer_mismatch",
      message: "This order does not match your WhatsApp buyer account.",
    };
  }

  if (await orderHasOpenDispute(ref)) {
    return { error: "dispute_exists", message: "An open dispute already exists for this order." };
  }

  let resolvedSellerId = parseUserId(sellerUserId);
  if (!resolvedSellerId) {
    try {
      const productId = String(order.productId || "").trim();
      if (productId) {
        const { rows } = await query(
          `SELECT COALESCE(p.seller_user_id, s.user_id) AS seller_user_id
             FROM products p
             LEFT JOIN sellers s ON s.id = p.seller_id
            WHERE p.id = $1
            LIMIT 1`,
          [productId]
        );
        if (rows[0]?.seller_user_id != null) resolvedSellerId = Number(rows[0].seller_user_id);
      }
    } catch {
      /* ignore */
    }
  }

  if (!resolvedSellerId) {
    try {
      const { getSupplier } = await import("./suppliers.js");
      const supplier = getSupplier(order.supplierId);
      const n = Number(supplier?.userId);
      if (Number.isInteger(n) && n > 0) resolvedSellerId = n;
    } catch {
      /* ignore */
    }
  }

  // Resolve seller from product.sellerPhone / order.sellerPhone → users.phone
  if (!resolvedSellerId) {
    try {
      const phones = [];
      if (order.sellerPhone) phones.push(order.sellerPhone);
      if (order.productId) {
        const { getProductById } = await import("./catalog.js");
        const product = await getProductById(order.productId);
        if (product?.sellerPhone) phones.push(product.sellerPhone);
      }
      const { getSupplier } = await import("./suppliers.js");
      const supplier = order.supplierId ? getSupplier(order.supplierId) : null;
      if (supplier?.phone) phones.push(supplier.phone);
      const { findUserByPhone } = await import("../db/repositories/users.js");
      for (const p of phones) {
        const found = await findUserByPhone(p);
        const uid = Number(found?.user?.id);
        if (Number.isInteger(uid) && uid > 0) {
          resolvedSellerId = uid;
          break;
        }
      }
      if (!resolvedSellerId) {
        for (const p of phones) {
          try {
            const { ensureSellerSocialProfile } = await import("../db/repositories/users.js");
            const ensured = await ensureSellerSocialProfile({
              phone: p,
              handle: supplier?.shopHandle || `seller-${String(p).replace(/\D/g, "").slice(-6)}`,
              shopName: supplier?.businessName || "Sokoni seller",
            });
            const uid = Number(ensured?.user?.id);
            if (Number.isInteger(uid) && uid > 0) {
              resolvedSellerId = uid;
              break;
            }
          } catch {
            /* try next phone */
          }
        }
      }
    } catch (err) {
      console.warn("[disputes] seller phone resolve skipped:", err.message);
    }
  }

  if (!resolvedSellerId) {
    return {
      error: "seller_not_found",
      message: "Could not match this order to a seller account yet. Message Sokoni support.",
    };
  }

  const freeze = await freezeOrderEscrow(ref);
  updateOrderMeta(order.id, { sellerUserId: resolvedSellerId, disputeHold: true, payoutStatus: "held_for_dispute" });

  const inserted = await query(
    `INSERT INTO order_disputes (
       order_ref, buyer_user_id, seller_user_id, reason, status,
       buyer_statement, escrow_frozen_at
     ) VALUES ($1, $2, $3, $4::dispute_reason, 'open', $5, NOW())
     RETURNING *`,
    [ref, buyerId, resolvedSellerId, cleanReason, text || null]
  );
  const dispute = mapDisputeRow(inserted.rows[0]);
  await appendEvent(dispute.id, "buyer", "opened", text || cleanReason);
  await appendEvent(dispute.id, "system", "escrow_frozen", freeze.frozen ? "held" : "order_meta_missing");

  // Snapshot tracking into evidence
  try {
    const tracking = buildPublicTrackingPayload?.(order) || null;
    await query(
      `INSERT INTO dispute_evidence (dispute_id, uploaded_by_user_id, kind, note, meta)
       VALUES ($1, $2, 'tracking_note', $3, $4::jsonb)`,
      [
        dispute.id,
        buyerId,
        "Auto-attached tracking snapshot",
        JSON.stringify({
          shipmentStatus: order.shipmentStatus || null,
          status: order.status || null,
          tracking,
        }),
      ]
    );
  } catch {
    /* optional */
  }

  const fresh = getOrder(order.id) || order;
  const reasonLabel = text || cleanReason;
  const short = String(reasonLabel).slice(0, 140);
  // Optional WAHA fan-out (openBuyerReturnCase prefers its own sendTextReliable alerts).
  if (notifyWhatsApp !== false) {
    try {
      await notifyDisputeParties(fresh, dispute, {
        eventType: "DISPUTE_OPENED",
        adminDetails:
          `Buyer opened a dispute (#${dispute.id}).\n` +
          `Reason: ${cleanReason}\n` +
          `${short}\n` +
          `Escrow: ${freeze.frozen ? "frozen" : "not frozen"}`,
        sellerMessage:
          `⚠️ *URGENT DISPUTE* on *${fresh.id}*.\n` +
          `Reason: ${cleanReason}\n` +
          `${short}\n\n` +
          `Payout is on hold. Reply in Seller Hub → Disputes with dispatch photos within 24 hours.`,
        // Buyer already gets the structured protocol reply — avoid double WhatsApp.
        buyerMessage: null,
      });
    } catch (err) {
      console.warn("[disputes] notifyDisputeParties failed:", err?.message || err);
    }
  }

  return { success: true, dispute, escrowFrozen: Boolean(freeze.frozen) };
}

export async function listDisputesForUser({ userId, role = "buyer", limit = 30 } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  const uid = parseUserId(userId);
  if (!uid) return { error: "invalid_user", message: "Valid userId is required." };
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const column = role === "seller" ? "seller_user_id" : "buyer_user_id";
  const { rows } = await query(
    `SELECT * FROM order_disputes
      WHERE ${column} = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [uid, safeLimit]
  );
  return { disputes: rows.map(mapDisputeRow), count: rows.length };
}

export async function getDisputeById(disputeId) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  const id = Number(disputeId);
  if (!Number.isInteger(id) || id < 1) {
    return { error: "invalid_dispute", message: "Valid dispute id is required." };
  }
  const { rows } = await query(`SELECT * FROM order_disputes WHERE id = $1 LIMIT 1`, [id]);
  if (!rows[0]) return { error: "dispute_not_found", message: "Dispute not found." };

  const evidence = await query(
    `SELECT id, dispute_id, uploaded_by_user_id, kind, url, note, meta, created_at
       FROM dispute_evidence WHERE dispute_id = $1 ORDER BY created_at ASC`,
    [id]
  );
  const events = await query(
    `SELECT id, dispute_id, actor_role, action, detail, created_at
       FROM dispute_events WHERE dispute_id = $1 ORDER BY created_at ASC`,
    [id]
  );

  const dispute = mapDisputeRow(rows[0]);
  const order = getOrder(dispute.orderRef);
  let tracking = null;
  try {
    tracking = order ? buildPublicTrackingPayload(order) : null;
  } catch {
    tracking = null;
  }

  return {
    dispute,
    order: order
      ? {
          id: order.id,
          productName: order.productName,
          status: order.status,
          shipmentStatus: order.shipmentStatus,
          escrowStatus: order.escrowStatus,
          disputeHold: Boolean(order.disputeHold),
          totalKes: order.priceKes,
          sellerNetKes: order.sellerNetKes,
          imageUrl: order.imageUrl || null,
          productId: order.productId || null,
        }
      : null,
    tracking,
    evidence: evidence.rows.map((row) => ({
      id: Number(row.id),
      kind: row.kind,
      url: row.url || null,
      note: row.note || null,
      meta: row.meta || {},
      uploadedByUserId: row.uploaded_by_user_id != null ? Number(row.uploaded_by_user_id) : null,
      createdAt: row.created_at,
    })),
    events: events.rows.map((row) => ({
      id: Number(row.id),
      actorRole: row.actor_role,
      action: row.action,
      detail: row.detail || null,
      createdAt: row.created_at,
    })),
  };
}

export async function addDisputeEvidence({
  disputeId,
  userId,
  kind = "other",
  url = null,
  note = "",
} = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  const detail = await getDisputeById(disputeId);
  if (detail.error) return detail;
  const uid = parseUserId(userId);
  const d = detail.dispute;
  if (uid !== d.buyerUserId && uid !== d.sellerUserId) {
    return { error: "forbidden", message: "Only the buyer or seller on this dispute can add evidence." };
  }
  if (!OPEN_STATUSES.has(d.status)) {
    return { error: "dispute_closed", message: "This dispute is already resolved." };
  }

  const cleanKind = String(kind || "other").slice(0, 24);
  const cleanUrl = url ? String(url).trim().slice(0, 1000) : null;
  const cleanNote = String(note || "").trim().slice(0, 1000);
  if (!cleanUrl && !cleanNote) {
    return { error: "invalid_evidence", message: "Add a photo URL or a short note." };
  }
  if (cleanUrl && !/^https?:\/\//i.test(cleanUrl)) {
    return { error: "invalid_evidence", message: "Evidence URL must be http(s)." };
  }

  const { rows } = await query(
    `INSERT INTO dispute_evidence (dispute_id, uploaded_by_user_id, kind, url, note)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, kind, url, note, created_at`,
    [d.id, uid, cleanKind, cleanUrl, cleanNote || null]
  );

  // MAS Phase 1/4 shadow — never auto-decides escrow
  try {
    const { shadowDisputeVideo, shadowInboundText } = await import("./mas/index.js");
    if (cleanUrl && /\.(mp4|webm|mov)(\?|$)/i.test(cleanUrl)) {
      shadowDisputeVideo(cleanUrl, { orderId: d.orderRef, disputeId: d.id, kind: cleanKind });
    } else if (cleanUrl) {
      const { shadowListingImage } = await import("./mas/index.js");
      shadowListingImage(cleanUrl, { caption: cleanNote || "dispute evidence" });
    }
    if (cleanNote) shadowInboundText(cleanNote, { channel: "dispute", disputeId: d.id });
  } catch (err) {
    console.warn("[disputes] MAS shadow skipped:", err.message);
  }

  const actorRole = uid === d.buyerUserId ? "buyer" : "seller";
  await appendEvent(d.id, actorRole, "evidence_added", cleanKind);
  await query(`UPDATE order_disputes SET status = 'under_review', updated_at = NOW() WHERE id = $1 AND status = 'open'`, [
    d.id,
  ]);

  const order = getOrder(d.orderRef);
  if (order) {
    const preview = String(cleanNote || cleanKind || "Evidence attached").slice(0, 140);
    const fromBuyer = actorRole === "buyer";
    void notifyDisputeParties(order, d, {
      eventType: "DISPUTE_EVIDENCE",
      adminDetails: `${actorRole} added evidence on dispute #${d.id}: ${preview}`,
      sellerMessage: fromBuyer
        ? `📎 Buyer added evidence on dispute for *${order.id}*:\n${preview}`
        : null,
      buyerMessage: !fromBuyer
        ? `📎 Seller added evidence on your dispute for *${order.id}*:\n${preview}`
        : null,
    });
  }

  return { success: true, evidence: rows[0] };
}

export async function respondToDispute({ disputeId, sellerUserId, response = "" } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  const detail = await getDisputeById(disputeId);
  if (detail.error) return detail;
  const sid = parseUserId(sellerUserId);
  if (sid !== detail.dispute.sellerUserId) {
    return { error: "forbidden", message: "Only the seller on this order can respond." };
  }
  if (!OPEN_STATUSES.has(detail.dispute.status)) {
    return { error: "dispute_closed", message: "This dispute is already resolved." };
  }
  const text = String(response || "").trim().slice(0, 2000);
  if (!text) {
    return { error: "invalid_response", message: "Write a short response for admin review." };
  }

  const { rows } = await query(
    `UPDATE order_disputes
        SET seller_response = $2,
            status = 'under_review',
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [detail.dispute.id, text]
  );
  await appendEvent(detail.dispute.id, "seller", "seller_response", text);
  const dispute = mapDisputeRow(rows[0]);
  const order = getOrder(dispute.orderRef);
  if (order) {
    const short = text.slice(0, 160);
    void notifyDisputeParties(order, dispute, {
      eventType: "DISPUTE_SELLER_REPLY",
      adminDetails: `Seller replied on dispute #${dispute.id}:\n${short}`,
      buyerMessage: `📩 Seller replied on your dispute for *${order.id}*:\n${short}`,
      sellerMessage: null,
    });
  }
  return { success: true, dispute };
}

export async function listAdminDisputes({ status = "open", limit = 50 } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const want = String(status || "open").toLowerCase();
  let rows;
  if (want === "all") {
    ({ rows } = await query(
      `SELECT * FROM order_disputes ORDER BY created_at DESC LIMIT $1`,
      [safeLimit]
    ));
  } else if (want === "open") {
    ({ rows } = await query(
      `SELECT * FROM order_disputes
        WHERE status IN ('open', 'under_review')
        ORDER BY created_at ASC
        LIMIT $1`,
      [safeLimit]
    ));
  } else {
    ({ rows } = await query(
      `SELECT * FROM order_disputes WHERE status::text = $1 ORDER BY created_at DESC LIMIT $2`,
      [want, safeLimit]
    ));
  }
  return { disputes: rows.map(mapDisputeRow), count: rows.length };
}

export async function resolveDispute({
  disputeId,
  resolution,
  notes = "",
  adminLabel = "admin",
} = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  const detail = await getDisputeById(disputeId);
  if (detail.error) return detail;
  if (!OPEN_STATUSES.has(detail.dispute.status)) {
    return { error: "dispute_closed", message: "This dispute is already resolved." };
  }

  const action = String(resolution || "").toLowerCase();
  if (action !== "refund" && action !== "release") {
    return { error: "invalid_resolution", message: "Resolution must be refund or release." };
  }

  const adminNotes = String(notes || "").trim().slice(0, 2000);
  const nextStatus = action === "refund" ? "resolved_refund" : "resolved_release";
  const { rows } = await query(
    `UPDATE order_disputes
        SET status = $2::dispute_status,
            resolution = $3,
            admin_notes = $4,
            resolved_at = NOW(),
            resolved_by = $5,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [detail.dispute.id, nextStatus, action, adminNotes || null, String(adminLabel).slice(0, 120)]
  );

  const order = getOrder(detail.dispute.orderRef);
  if (order) {
    if (action === "refund") {
      cancelSettlementPayout(order.id, "dispute_refund");
      updateOrderMeta(order.id, {
        escrowStatus: "refunded",
        disputeHold: false,
        disputeResolvedAt: Date.now(),
        disputeResolution: "refund",
        refundPendingManual: true,
      });
      try {
        if (order.status !== "cancelled") {
          updateOrderStatus(order.id, "cancelled", { force: true, source: "disputes.resolve.refund" });
        }
      } catch {
        /* ignore */
      }
      try {
        const { ensureOrderSellerUserId } = await import("../db/repositories/social.js");
        const { penalizeBuyerWonDispute } = await import("./rating-engine.js");
        const forPenalty = getOrder(order.id) || order;
        const sellerUserId = await ensureOrderSellerUserId(forPenalty);
        if (sellerUserId) {
          await penalizeBuyerWonDispute(sellerUserId, String(order.id).toUpperCase());
        }
      } catch (err) {
        console.warn("[disputes] seller rating penalty skipped:", err?.message || err);
      }
    } else {
      const eligibleAt = order.payoutEligibleAt || Date.now();
      updateOrderMeta(order.id, {
        disputeHold: false,
        disputeResolvedAt: Date.now(),
        disputeResolution: "release",
        escrowStatus: "released",
        payoutEligibleAt: eligibleAt,
        payoutStatus: "owed",
        shipmentStatus: "delivered",
        deliveredAt: order.deliveredAt || Date.now(),
        shipmentDeliveredAt: order.shipmentDeliveredAt || Date.now(),
        buyerConfirmedAt: order.buyerConfirmedAt || Date.now(),
      });
      try {
        if (order.status !== "delivered" && order.status !== "cancelled") {
          updateOrderStatus(order.id, "delivered");
        }
      } catch {
        /* ignore */
      }
      updateOrderMeta(order.id, {
        payoutEligibleAt: eligibleAt,
        payoutStatus: "owed",
        escrowStatus: "released",
      });
      const fresh = getOrder(order.id);
      reinstateSettlementPayout(order.id, { payoutEligibleAt: eligibleAt });
      if (fresh && !fresh.isPaidOut) {
        const net =
          resolveSellerPayoutKes(fresh) ||
          Math.round(Number(fresh.sellerNetKes ?? fresh.sourcePriceKes) || 0) ||
          Math.round(orderBuyerTotal(fresh) * 0.9);
        scheduleSellerPayoutAfterDelivery(
          {
            ...fresh,
            sellerNetKes: net,
            sellerPayoutKes: fresh.sellerPayoutKes || net,
            sourcePriceKes: fresh.sourcePriceKes || net,
            payoutEligibleAt: eligibleAt,
          },
          { refreshEligibleAt: true }
        );
        processDuePayouts();
        markSettlementReadyForMpesa(getOrder(order.id) || fresh, { payoutAmountKes: net });
      }
      try {
        const { ensureOrderSellerUserId, creditSellerSaleReview } = await import(
          "../db/repositories/social.js"
        );
        const forCredit = getOrder(order.id) || order;
        await ensureOrderSellerUserId(forCredit);
        await creditSellerSaleReview(forCredit);
      } catch (err) {
        console.warn("[disputes] social credit skipped:", err?.message || err);
      }
    }

    if (order.parentOrderId || order.kind === "cart_child") {
      try {
        const { refreshCartParentStatus } = await import("./cart-orders.js");
        refreshCartParentStatus(order.parentOrderId || order.id.replace(/-\d+$/, ""));
      } catch (err) {
        console.warn("[disputes] cart parent rollup skipped:", err?.message || err);
      }
    }
  }

  await appendEvent(detail.dispute.id, "admin", `resolved_${action}`, adminNotes || null);
  const dispute = mapDisputeRow(rows[0]);
  const resolvedOrder = getOrder(detail.dispute.orderRef);
  if (resolvedOrder) {
    // End WhatsApp ADMIN_TAKE_OVER / handoff so the bot resumes (same as admin #done).
    try {
      const { resolveAdminTakeOver } = await import("./communication-hub.js");
      await resolveAdminTakeOver(resolvedOrder.id, {
        note: `dispute ${dispute.id} resolved_${action}`,
        notifyParties: false,
      });
    } catch (err) {
      console.warn("[disputes] resume bot after resolve failed:", err?.message || err);
    }

    const outcome =
      action === "refund"
        ? "Refund approved — we’ll process the M-Pesa refund."
        : "Released to seller — dispute closed in seller’s favour.";
    const noteBit = adminNotes ? `\nNote: ${adminNotes.slice(0, 120)}` : "";
    const resumed = `\nBot is active again on WhatsApp.`;
    void notifyDisputeParties(getOrder(resolvedOrder.id) || resolvedOrder, dispute, {
      eventType: "DISPUTE_RESOLVED",
      adminDetails:
        `Dispute #${dispute.id} resolved: ${action}${noteBit}\n` +
        `Bot resumed (same as #done ${resolvedOrder.id}).`,
      buyerMessage: `✅ Dispute on *${resolvedOrder.id}* resolved: ${outcome}${noteBit}${resumed}`,
      sellerMessage: `✅ Dispute on *${resolvedOrder.id}* resolved: ${outcome}${noteBit}${resumed}`,
    });
  }
  return { success: true, dispute };
}

/** Used by escrow delivery hook — true if payout must wait. */
export function orderHasDisputeHold(order) {
  if (!order) return false;
  if (order.disputeHold) return true;
  if (order.escrowStatus === "refunded") return true;
  return false;
}

export async function listSellerDisputeOrders(sellerUserId, supplierId = null) {
  const listed = await listDisputesForUser({ userId: sellerUserId, role: "seller", limit: 40 });
  if (listed.error) return listed;
  if (!supplierId) return listed;
  // Soft filter by supplier ownership when possible
  const refs = new Set(
    listAllOrders()
      .filter((o) => o.supplierId === supplierId)
      .map((o) => String(o.id).toUpperCase())
  );
  const disputes = listed.disputes.filter((d) => refs.has(String(d.orderRef).toUpperCase()));
  return { disputes, count: disputes.length };
}
