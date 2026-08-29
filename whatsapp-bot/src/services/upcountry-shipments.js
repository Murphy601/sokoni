/**
 * Seller-managed upcountry courier / waybill tracking + 48h escrow release.
 */
import { isDbEnabled, query } from "../db/pool.js";
import { getOrder, normalizeOrderId, updateOrderMeta, listAllOrders } from "./orders.js";
import {
  evaluateFulfillmentMode,
  FULFILLMENT_SELLER_COURIER,
  FULFILLMENT_LOCAL_RIDER,
} from "../lib/geo-zones.js";
import { inferCountyFromText } from "./kenya-locations.js";

const UPCOUNTRY_AUTO_RELEASE_MS = 48 * 60 * 60 * 1000;

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS upcountry_shipments (
      id                BIGSERIAL PRIMARY KEY,
      order_ref         VARCHAR(40) NOT NULL,
      seller_phone      VARCHAR(20),
      seller_user_id    INT,
      courier_name      VARCHAR(100) NOT NULL,
      waybill_number    VARCHAR(100) NOT NULL,
      receipt_photo_url TEXT,
      dispatch_notes    TEXT,
      status            VARCHAR(30) NOT NULL DEFAULT 'DISPATCHED',
      dispatched_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      confirmed_at      TIMESTAMPTZ,
      meta              JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_upcountry_shipments_order
      ON upcountry_shipments (order_ref)
  `);
}

/**
 * Resolve / stamp fulfillment mode on an order (idempotent).
 */
export function resolveOrderFulfillment(order, { sellerLocationText = "" } = {}) {
  if (!order) return null;
  if (order.fulfillmentMode === FULFILLMENT_LOCAL_RIDER || order.fulfillmentMode === FULFILLMENT_SELLER_COURIER) {
    return {
      mode: order.fulfillmentMode,
      fulfillmentMode: order.fulfillmentMode,
      requiresRider: order.fulfillmentMode === FULFILLMENT_LOCAL_RIDER,
      autoReleaseHours: order.fulfillmentMode === FULFILLMENT_SELLER_COURIER ? 48 : 24,
      sellerCounty: order.sellerCounty || null,
      buyerCounty: order.deliveryCounty || null,
    };
  }

  const buyerCounty =
    order.deliveryCounty ||
    inferCountyFromText(order.location || order.dropOff || order.customerLocation || "")?.county ||
    "";
  const buyerTown = order.deliveryTown || order.landmarkTown || "";
  const evalResult = evaluateFulfillmentMode({
    sellerCounty: order.sellerCounty || "",
    buyerCounty,
    buyerTown,
    sellerLocationText: sellerLocationText || order.sellerLocation || "",
    buyerLocationText: order.location || order.dropOff || "",
  });
  return evalResult;
}

export function stampFulfillmentOnOrder(orderId, evalResult) {
  if (!evalResult?.mode) return;
  updateOrderMeta(orderId, {
    fulfillmentMode: evalResult.mode,
    requiresRider: Boolean(evalResult.requiresRider),
    sellerCounty: evalResult.sellerCounty || null,
    buyerCountyResolved: evalResult.buyerCounty || null,
    fulfillmentDescription: evalResult.description || null,
    escrowHoldHours: evalResult.escrowHoldHours || null,
    autoReleaseHours: evalResult.autoReleaseHours || 24,
  });
}

/**
 * Seller registers courier waybill for an upcountry (or any seller-courier) order.
 */
export async function registerSellerWaybill({
  orderId,
  sellerPhone = "",
  customerKey = "",
  courierName = "",
  waybillNumber = "",
  receiptPhotoUrl = null,
  dispatchNotes = "",
} = {}) {
  const id = normalizeOrderId(orderId);
  if (!id) return { error: "invalid_order_id", message: "Use a valid SKN order id." };

  const order = getOrder(id);
  if (!order) return { error: "not_found", message: `Order *${id}* not found.` };

  const {
    authorizeSellerForOrder,
    isPaidHeld,
    isAdminTakeOver,
  } = await import("./communication-hub.js");

  if (isAdminTakeOver(order) || order.disputeHold) {
    return { error: "support_hold", message: `*${id}* is with Sokoni support right now.` };
  }

  const auth = await authorizeSellerForOrder(order, sellerPhone, customerKey);
  const freshOrder = auth.order || order;
  if (!auth.ok) {
    return {
      error: "forbidden",
      message: `*${id}* is not linked to your seller shop. Reply *vendor menu*, then try again.`,
    };
  }
  if (!isPaidHeld(freshOrder)) {
    return { error: "unpaid", message: `*${id}* is not paid into escrow yet.` };
  }

  const mode = resolveOrderFulfillment(freshOrder);
  if (mode?.mode === FULFILLMENT_LOCAL_RIDER && freshOrder.deliveryMode === "sokoni_boda") {
    return {
      error: "local_rider_order",
      message:
        `*${id}* is on local rider delivery. Use Sokoni boda OTP flow — or cancel the boda job before switching to courier.`,
    };
  }

  const courier = String(courierName || "").trim().slice(0, 100);
  const waybill = String(waybillNumber || "").trim().slice(0, 100);
  if (!courier || !waybill) {
    return {
      error: "invalid_waybill",
      message: `Reply like:\n*WAYBILL ${id} Easy Coach EC-12345*`,
    };
  }

  if (isDbEnabled()) {
    try {
      await ensureTable();
      await query(
        `INSERT INTO upcountry_shipments (
           order_ref, seller_phone, courier_name, waybill_number,
           receipt_photo_url, dispatch_notes, status, dispatched_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,'DISPATCHED',NOW(),NOW())
         ON CONFLICT (order_ref) DO UPDATE SET
           courier_name = EXCLUDED.courier_name,
           waybill_number = EXCLUDED.waybill_number,
           receipt_photo_url = COALESCE(EXCLUDED.receipt_photo_url, upcountry_shipments.receipt_photo_url),
           dispatch_notes = COALESCE(EXCLUDED.dispatch_notes, upcountry_shipments.dispatch_notes),
           status = 'DISPATCHED',
           updated_at = NOW()`,
        [
          id,
          auth.resolvedPhone || sellerPhone || null,
          courier,
          waybill,
          receiptPhotoUrl || null,
          String(dispatchNotes || "").slice(0, 400) || null,
        ]
      );
    } catch (err) {
      console.warn("[upcountry] save failed:", err.message);
    }
  }

  const { advanceShipmentStatus } = await import("./shipments.js");
  const { isDispatched } = await import("./communication-hub.js");
  if (!isDispatched(freshOrder) || !freshOrder.sellerDispatchedAt) {
    advanceShipmentStatus(id, "in_transit", {
      actor: "seller_waybill",
      note: `Waybill ${courier} ${waybill}`,
      skipBuyerNotify: true,
      trackingRef: waybill,
    });
  }

  updateOrderMeta(id, {
    sellerDispatchedAt: freshOrder.sellerDispatchedAt || Date.now(),
    fulfillmentMode: FULFILLMENT_SELLER_COURIER,
    requiresRider: false,
    deliveryMode: "seller_courier",
    courierName: courier,
    courierTrackingRef: waybill,
    escrowStatus: "hold_upcountry",
    upcountryDispatchedAt: Date.now(),
    autoReleaseHours: 48,
    ...(receiptPhotoUrl ? { waybillReceiptUrl: receiptPhotoUrl } : {}),
  });

  const updated = getOrder(id) || freshOrder;
  const itemName = updated.productName || updated.title || "your item";
  const { sendText } = await import("./whatsapp.js");

  if (updated.customerKey) {
    try {
      await sendText(
        updated.customerKey,
        `🚚 *YOUR PARCEL HAS BEEN DISPATCHED!*\n\n` +
          `Order *${id}*\n` +
          `Item: *${itemName}*\n` +
          `Courier: *${courier}*\n` +
          `Waybill / Tracking: *${waybill}*\n\n` +
          `When you collect the parcel, reply:\n` +
          `👉 *YES ${id}* to release payment to the seller.\n\n` +
          `Problem? Reply *HELP ${id}* within 48 hours of dispatch.`
      );
    } catch (err) {
      console.warn("[upcountry] buyer notify:", err.message);
    }
  }

  return {
    ok: true,
    orderId: id,
    courierName: courier,
    waybillNumber: waybill,
    message:
      `✅ *WAYBILL REGISTERED!* Tracking sent to the buyer.\n` +
      `Escrow releases when they reply *YES ${id}*, or automatically after *48 hours* with no dispute.`,
  };
}

/**
 * WhatsApp: WAYBILL SKN-#### <courier words> <tracking>
 */
export async function tryHandleSellerWaybillMessage(customerKey, text, { phone = "", mediaUrl = null } = {}) {
  const trimmed = String(text || "").trim();
  const match = trimmed.match(
    /^WAYBILL\s+(SKN?-?\d{1,6}(?:-\d+)?)\s+(.+)$/i
  );
  if (!match) return false;

  const orderPart = match[1];
  const rest = String(match[2] || "").trim();
  const tokens = rest.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    const { sendText } = await import("./whatsapp.js");
    await sendText(
      customerKey,
      `Format:\n*WAYBILL SKN-1234 Easy Coach EC-99881*\n(courier name, then tracking / receipt number)`
    );
    return true;
  }

  const waybillNumber = tokens[tokens.length - 1];
  const courierName = tokens.slice(0, -1).join(" ");

  const result = await registerSellerWaybill({
    orderId: orderPart,
    sellerPhone: phone,
    customerKey,
    courierName,
    waybillNumber,
    receiptPhotoUrl: mediaUrl || null,
  });

  const { sendText } = await import("./whatsapp.js");
  await sendText(customerKey, result.message || result.error || "Could not save waybill.");
  return true;
}

/**
 * Auto-release upcountry escrows 48h after waybill dispatch (no dispute).
 * Also covers orders stamped SELLER_COURIER with sellerDispatchedAt.
 */
export async function processUpcountryEscrowReleases({ limit = 40 } = {}) {
  const now = Date.now();
  let released = 0;

  const candidates = listAllOrders()
    .filter((o) => {
      if (o.status === "delivered" || o.shipmentStatus === "delivered") return false;
      if (o.disputeHold || o.escrowStatus === "refunded" || o.adminTakeOver) return false;
      if (o.autoReleasedAt) return false;
      const mode = o.fulfillmentMode || o.deliveryMode;
      const isUpcountry =
        mode === FULFILLMENT_SELLER_COURIER ||
        mode === "seller_courier" ||
        o.escrowStatus === "hold_upcountry";
      if (!isUpcountry) return false;
      const dispatchedAt = Number(o.upcountryDispatchedAt || o.sellerDispatchedAt || o.inTransitAt || 0);
      if (!dispatchedAt) return false;
      return now - dispatchedAt >= UPCOUNTRY_AUTO_RELEASE_MS;
    })
    .slice(0, limit);

  for (const order of candidates) {
    try {
      let openDispute = false;
      try {
        const { orderHasOpenDispute } = await import("./disputes.js");
        openDispute = await orderHasOpenDispute(order.id);
      } catch {
        openDispute = false;
      }
      if (openDispute || order.disputeHold) continue;

      const { advanceShipmentStatus } = await import("./shipments.js");
      const result = advanceShipmentStatus(order.id, "delivered", {
        actor: "upcountry_auto_release_48h",
        note: "Auto-released 48h after waybill dispatch with no YES and no dispute",
        skipBuyerNotify: true,
      });
      if (result.error) continue;

      updateOrderMeta(order.id, {
        buyerConfirmedAt: Date.now(),
        buyerConfirmedVia: "upcountry_auto_release_48h",
        autoReleasedAt: Date.now(),
        escrowStatus: "released",
      });

      if (isDbEnabled()) {
        try {
          await query(
            `UPDATE upcountry_shipments SET
               status = 'AUTO_RELEASED',
               confirmed_at = NOW(),
               updated_at = NOW()
             WHERE UPPER(order_ref) = UPPER($1)`,
            [order.id]
          );
        } catch {
          /* ignore */
        }
      }

      released += 1;
      console.log(`[upcountry] auto-released ${order.id} after 48h`);

      try {
        const { notifyAdminEvent, dispatchMessages, msgAutoReleasedBuyer, msgAutoReleasedSeller, sellerNotifyTargets } =
          await import("./communication-hub.js");
        const fresh = getOrder(order.id) || order;
        const { getSupplier } = await import("./suppliers.js");
        const supplier = fresh.supplierId ? getSupplier(fresh.supplierId) : null;
        const sellerJobs = supplier?.phone
          ? sellerNotifyTargets(supplier.phone).map((to) => ({
              to,
              message: msgAutoReleasedSeller(fresh),
            }))
          : [];
        void dispatchMessages([
          fresh.customerKey ? { to: fresh.customerKey, message: msgAutoReleasedBuyer(fresh) } : null,
          ...sellerJobs,
        ]);
        void notifyAdminEvent("AUTO_RELEASED", {
          orderId: fresh.id,
          details: `Upcountry auto-completed 48h after waybill (no YES, no dispute).`,
        });
      } catch (err) {
        console.warn("[upcountry] notify after auto-release:", err.message);
      }
    } catch (err) {
      console.warn("[upcountry] release failed:", order.id, err.message);
    }
  }

  return { ok: true, released };
}
