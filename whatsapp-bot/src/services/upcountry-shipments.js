/**
 * Seller-managed upcountry courier / waybill tracking + 48h escrow release.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDbEnabled, query } from "../db/pool.js";
import { getOrder, normalizeOrderId, updateOrderMeta, listAllOrders } from "./orders.js";
import {
  evaluateFulfillmentMode,
  FULFILLMENT_SELLER_COURIER,
  FULFILLMENT_LOCAL_RIDER,
} from "../lib/geo-zones.js";
import { inferCountyFromText } from "./kenya-locations.js";
import { CATALOG_IMAGES_DIR } from "../lib/catalog-images.js";
import { config } from "../config.js";
import { WAYBILL_REQUIRED_PHOTOS } from "../lib/ops-edge-constants.js";

const UPCOUNTRY_AUTO_RELEASE_MS = 48 * 60 * 60 * 1000;
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const WAYBILL_SESSION_FILE = path.join(DATA_DIR, "waybill-photo-sessions.json");

/** @type {Record<string, object>} */
let waybillSessions = {};
let waybillSessionsLoaded = false;

function loadWaybillSessions() {
  if (waybillSessionsLoaded) return;
  waybillSessionsLoaded = true;
  try {
    if (existsSync(WAYBILL_SESSION_FILE)) {
      waybillSessions = JSON.parse(readFileSync(WAYBILL_SESSION_FILE, "utf-8")) || {};
    }
  } catch {
    waybillSessions = {};
  }
}

function persistWaybillSessions() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(WAYBILL_SESSION_FILE, JSON.stringify(waybillSessions, null, 2));
  } catch (err) {
    console.warn("[upcountry] waybill session persist:", err.message);
  }
}

function sessionKey(customerKey, phone = "") {
  return String(customerKey || phone || "").trim().toLowerCase();
}

function getWaybillPhotoSession(customerKey, phone = "") {
  loadWaybillSessions();
  const key = sessionKey(customerKey, phone);
  const s = waybillSessions[key];
  if (!s) return null;
  if (Date.now() - Number(s.at || 0) > 6 * 60 * 60 * 1000) {
    delete waybillSessions[key];
    persistWaybillSessions();
    return null;
  }
  return s;
}

function setWaybillPhotoSession(customerKey, phone, data) {
  loadWaybillSessions();
  const key = sessionKey(customerKey, phone);
  waybillSessions[key] = { ...data, at: Date.now(), phone: phone || null };
  persistWaybillSessions();
}

function clearWaybillPhotoSession(customerKey, phone = "") {
  loadWaybillSessions();
  const key = sessionKey(customerKey, phone);
  delete waybillSessions[key];
  persistWaybillSessions();
}

function extFromMime(mimetype = "") {
  const m = String(mimetype || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  return "jpg";
}

async function hostWaybillPhoto(buffer, { orderId = "unknown", mimetype = "image/jpeg" } = {}) {
  await mkdir(CATALOG_IMAGES_DIR, { recursive: true });
  const safeOrder = String(orderId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const file = `waybill_${safeOrder}_${Date.now().toString(36)}.${extFromMime(mimetype)}`;
  await writeFile(path.join(CATALOG_IMAGES_DIR, file), buffer);
  const base = String(config.botPublicUrl || "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}/catalog-images/${encodeURIComponent(file)}`;
}

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
  await query(`
    ALTER TABLE upcountry_shipments
      ADD COLUMN IF NOT EXISTS pre_shipment_photo_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS packaged_photo_url TEXT,
      ADD COLUMN IF NOT EXISTS item_condition_photo_url TEXT
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
  packagedPhotoUrl = null,
  itemConditionPhotoUrl = null,
  preShipmentPhotoUrls = null,
  dispatchNotes = "",
  skipPhotoGate = false,
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

  const photos = Array.isArray(preShipmentPhotoUrls)
    ? preShipmentPhotoUrls.filter(Boolean)
    : [packagedPhotoUrl || receiptPhotoUrl, itemConditionPhotoUrl].filter(Boolean);

  if (!skipPhotoGate && photos.length < WAYBILL_REQUIRED_PHOTOS) {
    return {
      error: "photos_required",
      needsPhotos: true,
      photosHave: photos.length,
      photosNeed: WAYBILL_REQUIRED_PHOTOS,
      courierName: courier,
      waybillNumber: waybill,
      message:
        `📷 *Pre-shipment photos required (2)* before waybill is locked:\n` +
        `1) Item *packaged & sealed* next to the courier waybill receipt\n` +
        `2) Item *condition before sealing*\n\n` +
        `Send photo *${photos.length + 1} of ${WAYBILL_REQUIRED_PHOTOS}* now (caption optional).`,
    };
  }

  const packaged = photos[0] || packagedPhotoUrl || receiptPhotoUrl || null;
  const condition = photos[1] || itemConditionPhotoUrl || null;

  if (isDbEnabled()) {
    try {
      await ensureTable();
      await query(
        `INSERT INTO upcountry_shipments (
           order_ref, seller_phone, courier_name, waybill_number,
           receipt_photo_url, packaged_photo_url, item_condition_photo_url,
           pre_shipment_photo_urls, dispatch_notes, status, dispatched_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,'DISPATCHED',NOW(),NOW())
         ON CONFLICT (order_ref) DO UPDATE SET
           courier_name = EXCLUDED.courier_name,
           waybill_number = EXCLUDED.waybill_number,
           receipt_photo_url = COALESCE(EXCLUDED.receipt_photo_url, upcountry_shipments.receipt_photo_url),
           packaged_photo_url = COALESCE(EXCLUDED.packaged_photo_url, upcountry_shipments.packaged_photo_url),
           item_condition_photo_url = COALESCE(EXCLUDED.item_condition_photo_url, upcountry_shipments.item_condition_photo_url),
           pre_shipment_photo_urls = EXCLUDED.pre_shipment_photo_urls,
           dispatch_notes = COALESCE(EXCLUDED.dispatch_notes, upcountry_shipments.dispatch_notes),
           status = 'DISPATCHED',
           updated_at = NOW()`,
        [
          id,
          auth.resolvedPhone || sellerPhone || null,
          courier,
          waybill,
          packaged,
          packaged,
          condition,
          JSON.stringify(photos),
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
    waybillReceiptUrl: packaged || null,
    waybillPackagedPhotoUrl: packaged || null,
    waybillItemConditionPhotoUrl: condition || null,
    waybillPreShipmentPhotos: photos,
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
          `Problem? Reply *HELP ${id}* or *DISPUTE ${id}* within 48 hours of dispatch.`
      );
    } catch (err) {
      console.warn("[upcountry] buyer notify:", err.message);
    }
  }

  clearWaybillPhotoSession(customerKey, sellerPhone);

  return {
    ok: true,
    orderId: id,
    courierName: courier,
    waybillNumber: waybill,
    photos: photos.length,
    message:
      `✅ *WAYBILL REGISTERED!* Tracking sent to the buyer.\n` +
      `Pre-shipment photos saved (${photos.length}) for dispute evidence.\n` +
      `Escrow releases when they reply *YES ${id}*, or automatically after *48 hours* with no dispute.`,
  };
}

/**
 * WhatsApp: WAYBILL SKN-#### <courier words> <tracking>
 */
export async function tryHandleSellerWaybillMessage(
  customerKey,
  text,
  { phone = "", mediaUrl = null, mediaMimetype = "", messageId = "", chatId = "", session = "" } = {}
) {
  const trimmed = String(text || "").trim();
  const match = trimmed.match(/^WAYBILL\s+(SKN?-?\d{1,6}(?:-\d+)?)\s+(.+)$/i);
  if (!match) return false;

  const orderPart = match[1];
  const rest = String(match[2] || "").trim();
  const tokens = rest.split(/\s+/).filter(Boolean);
  const { sendText } = await import("./whatsapp.js");
  if (tokens.length < 2) {
    await sendText(
      customerKey,
      `Format:\n*WAYBILL SKN-1234 Easy Coach EC-99881*\n(courier name, then tracking / receipt number)\n\n` +
        `Then send *2 photos*: packaged+waybill, and item before sealing.`
    );
    return true;
  }

  const waybillNumber = tokens[tokens.length - 1];
  const courierName = tokens.slice(0, -1).join(" ");
  const photos = [];

  if (mediaUrl) {
    try {
      const { downloadWahaMedia } = await import("./whatsapp.js");
      const buffer = await downloadWahaMedia(mediaUrl, {
        messageId,
        chatId,
        session,
      });
      if (buffer?.length) {
        const url = await hostWaybillPhoto(buffer, {
          orderId: orderPart,
          mimetype: mediaMimetype || "image/jpeg",
        });
        if (url) photos.push(url);
        else photos.push(mediaUrl);
      } else if (mediaUrl) {
        photos.push(mediaUrl);
      }
    } catch (err) {
      console.warn("[upcountry] attach media:", err.message);
      if (mediaUrl) photos.push(mediaUrl);
    }
  }

  if (photos.length < WAYBILL_REQUIRED_PHOTOS) {
    setWaybillPhotoSession(customerKey, phone, {
      orderId: normalizeOrderId(orderPart) || orderPart,
      courierName,
      waybillNumber,
      photos,
    });
    await sendText(
      customerKey,
      `📷 Waybill *${waybillNumber}* noted for *${normalizeOrderId(orderPart) || orderPart}*.\n\n` +
        `Send *${WAYBILL_REQUIRED_PHOTOS - photos.length}* more clear photo(s):\n` +
        `1) Packaged & sealed next to waybill receipt\n` +
        `2) Item condition *before* sealing`
    );
    return true;
  }

  const result = await registerSellerWaybill({
    orderId: orderPart,
    sellerPhone: phone,
    customerKey,
    courierName,
    waybillNumber,
    preShipmentPhotoUrls: photos,
    packagedPhotoUrl: photos[0],
    itemConditionPhotoUrl: photos[1],
    receiptPhotoUrl: photos[0],
  });

  await sendText(customerKey, result.message || result.error || "Could not save waybill.");
  return true;
}

/**
 * While awaiting waybill photos, consume inbound images.
 */
export async function tryHandleWaybillEvidencePhoto(
  customerKey,
  {
    hasMedia = false,
    mediaUrl = null,
    mediaMimetype = "",
    messageId = "",
    chatId = "",
    session = "",
    phone = "",
  } = {}
) {
  if (!hasMedia || !mediaUrl) return false;
  const pending = getWaybillPhotoSession(customerKey, phone);
  if (!pending?.orderId) return false;

  const { sendText, downloadWahaMedia } = await import("./whatsapp.js");
  let url = mediaUrl;
  try {
    const buffer = await downloadWahaMedia(mediaUrl, { messageId, chatId, session });
    if (buffer?.length) {
      url =
        (await hostWaybillPhoto(buffer, {
          orderId: pending.orderId,
          mimetype: mediaMimetype || "image/jpeg",
        })) || mediaUrl;
    }
  } catch (err) {
    console.warn("[upcountry] waybill photo host:", err.message);
  }

  const photos = [...(pending.photos || []), url].filter(Boolean);
  if (photos.length < WAYBILL_REQUIRED_PHOTOS) {
    setWaybillPhotoSession(customerKey, phone, { ...pending, photos });
    await sendText(
      customerKey,
      `✅ Photo ${photos.length}/${WAYBILL_REQUIRED_PHOTOS} saved.\n` +
        `Send the next photo (${photos.length === 1 ? "item condition before sealing" : "packaged + waybill"}).`
    );
    return true;
  }

  const result = await registerSellerWaybill({
    orderId: pending.orderId,
    sellerPhone: phone,
    customerKey,
    courierName: pending.courierName,
    waybillNumber: pending.waybillNumber,
    preShipmentPhotoUrls: photos.slice(0, WAYBILL_REQUIRED_PHOTOS),
    packagedPhotoUrl: photos[0],
    itemConditionPhotoUrl: photos[1],
    receiptPhotoUrl: photos[0],
  });
  await sendText(customerKey, result.message || result.error || "Could not save waybill.");
  return true;
}

export function isAwaitingWaybillPhotos(customerKey, phone = "") {
  return Boolean(getWaybillPhotoSession(customerKey, phone)?.orderId);
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
