/**
 * Sokoni vetted boda fleet — Nairobi / Thika ops zones.
 * WhatsApp-first: sellers request riders; riders ACCEPT / SET ZONE / DELIVERED / OTP.
 * Order refs are SKN-#### strings (never integer order PKs).
 */
import { createHash, randomInt } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDbEnabled, query } from "../db/pool.js";
import { config } from "../config.js";
import { getOrder, normalizeOrderId, updateOrderMeta } from "./orders.js";

const ZONES = new Set(["NAIROBI", "THIKA"]);
const BROADCAST_LIMIT = 8;

export function normalizeBodaZone(raw) {
  const z = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (z === "NAIROBI" || z === "NBI" || z === "NRB") return "NAIROBI";
  if (z === "THIKA" || z === "THK") return "THIKA";
  return null;
}

export function normalizeRiderPhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9 && /^[17]/.test(d)) d = `254${d}`;
  return d.length >= 12 && d.length <= 15 ? d : "";
}

function hashOtp(code) {
  return createHash("sha256").update(String(code)).digest("hex");
}

function mapRider(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    fullName: row.full_name,
    phone: row.phone,
    nationalId: row.national_id || null,
    operatingTown: row.operating_town,
    stageLocation: row.stage_location || null,
    motorbikePlate: row.motorbike_plate || null,
    verificationStatus: row.verification_status,
    isAvailable: Boolean(row.is_available),
    rating: row.rating != null ? Number(row.rating) : 5,
    suspendReason: row.suspend_reason || null,
    createdAt: row.created_at,
  };
}

function mapDispatch(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    orderRef: row.order_ref,
    sellerPhone: row.seller_phone || null,
    riderId: row.rider_id != null ? Number(row.rider_id) : null,
    pickupAddress: row.pickup_address,
    deliveryAddress: row.delivery_address,
    deliveryFeeKes: Number(row.delivery_fee_kes || 0),
    operatingTown: row.operating_town,
    status: row.status,
    feeStatus: row.fee_status,
    acceptedAt: row.accepted_at,
    pickedUpAt: row.picked_up_at,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
  };
}

export async function upsertRiderProfile(input = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  const phone = normalizeRiderPhone(input.phone);
  const fullName = String(input.fullName || input.full_name || "").trim().slice(0, 120);
  const zone = normalizeBodaZone(input.operatingTown || input.operating_town || input.zone);
  const plate = String(input.motorbikePlate || input.motorbike_plate || "")
    .trim()
    .toUpperCase()
    .slice(0, 32);
  const nationalId = String(input.nationalId || input.national_id || "")
    .trim()
    .slice(0, 32) || null;
  if (!phone || !fullName || !zone || !plate) {
    return {
      error: "invalid_rider",
      message: "fullName, phone (254…), operatingTown (NAIROBI|THIKA), and motorbikePlate are required.",
    };
  }

  const { rows } = await query(
    `INSERT INTO riders (
       full_name, phone, national_id, operating_town, stage_location, motorbike_plate,
       license_class, guarantor_name, guarantor_phone,
       national_id_front_url, national_id_back_url, license_url, logbook_url,
       good_conduct_url, ntsa_badge_url, stage_letter_url,
       verification_status, is_available, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
       COALESCE($17, 'PENDING'), TRUE, NOW()
     )
     ON CONFLICT (phone) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       national_id = COALESCE(EXCLUDED.national_id, riders.national_id),
       operating_town = EXCLUDED.operating_town,
       stage_location = COALESCE(EXCLUDED.stage_location, riders.stage_location),
       motorbike_plate = EXCLUDED.motorbike_plate,
       license_class = COALESCE(EXCLUDED.license_class, riders.license_class),
       guarantor_name = COALESCE(EXCLUDED.guarantor_name, riders.guarantor_name),
       guarantor_phone = COALESCE(EXCLUDED.guarantor_phone, riders.guarantor_phone),
       national_id_front_url = COALESCE(EXCLUDED.national_id_front_url, riders.national_id_front_url),
       national_id_back_url = COALESCE(EXCLUDED.national_id_back_url, riders.national_id_back_url),
       license_url = COALESCE(EXCLUDED.license_url, riders.license_url),
       logbook_url = COALESCE(EXCLUDED.logbook_url, riders.logbook_url),
       good_conduct_url = COALESCE(EXCLUDED.good_conduct_url, riders.good_conduct_url),
       ntsa_badge_url = COALESCE(EXCLUDED.ntsa_badge_url, riders.ntsa_badge_url),
       stage_letter_url = COALESCE(EXCLUDED.stage_letter_url, riders.stage_letter_url),
       updated_at = NOW()
     RETURNING *`,
    [
      fullName,
      phone,
      nationalId,
      zone,
      String(input.stageLocation || input.stage_location || "").trim().slice(0, 120) || null,
      plate,
      String(input.licenseClass || "").trim().slice(0, 40) || null,
      String(input.guarantorName || "").trim().slice(0, 120) || null,
      normalizeRiderPhone(input.guarantorPhone) || null,
      input.nationalIdFrontUrl || null,
      input.nationalIdBackUrl || null,
      input.licenseUrl || null,
      input.logbookUrl || null,
      input.goodConductUrl || null,
      input.ntsaBadgeUrl || null,
      input.stageLetterUrl || null,
      input.verificationStatus || null,
    ]
  );
  return { ok: true, rider: mapRider(rows[0]) };
}

const BODA_DOCS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "boda-docs"
);
const MAX_DOC_BYTES = 4 * 1024 * 1024;

function decodeUploadBuffer(dataUrlOrB64) {
  const raw = String(dataUrlOrB64 || "");
  const m = raw.match(/^data:([^;]+);base64,(.+)$/i);
  if (m) {
    try {
      return { buffer: Buffer.from(m[2], "base64"), mime: m[1].toLowerCase() };
    } catch {
      return { buffer: Buffer.alloc(0), mime: "" };
    }
  }
  try {
    return { buffer: Buffer.from(raw.replace(/\s/g, ""), "base64"), mime: "" };
  } catch {
    return { buffer: Buffer.alloc(0), mime: "" };
  }
}

function sniffDocExt(buffer, mime = "", filename = "") {
  const name = String(filename || "").toLowerCase();
  if (name.endsWith(".pdf") || String(mime).includes("pdf")) return "pdf";
  if (String(mime).includes("png") || (buffer[0] === 0x89 && buffer[1] === 0x50)) return "png";
  if (String(mime).includes("webp")) return "webp";
  return "jpg";
}

async function saveRiderDoc({ phone, kind, data, filename = "" }) {
  if (!data) return null;
  const { buffer, mime } = decodeUploadBuffer(data);
  if (!buffer?.byteLength) return null;
  if (buffer.byteLength > MAX_DOC_BYTES) {
    const err = new Error(`${kind}_too_large`);
    err.code = "too_large";
    throw err;
  }
  await mkdir(BODA_DOCS_DIR, { recursive: true });
  const ext = sniffDocExt(buffer, mime, filename);
  const safePhone = String(phone).replace(/\D/g, "").slice(-12);
  const file = `${safePhone}-${kind}-${Date.now()}.${ext}`;
  await writeFile(path.join(BODA_DOCS_DIR, file), buffer);
  const base = (config.botPublicUrl || "https://bot.sokonimall.com").replace(/\/$/, "");
  return `${base}/assets/boda-docs/${encodeURIComponent(file)}`;
}

/**
 * Public web onboarding — creates/updates rider as PENDING with verification docs.
 * Docs: idDocument, dlDocument, stageLetter (base64 or data-URL).
 */
export async function registerRiderApplication(input = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const phone = normalizeRiderPhone(input.phone);
  const fullName = String(input.fullName || "").trim().slice(0, 120);
  const zone = normalizeBodaZone(input.operatingTown || input.zone);
  const plate = String(input.motorbikePlate || "")
    .trim()
    .toUpperCase()
    .slice(0, 32);
  const nationalId = String(input.nationalId || "")
    .trim()
    .slice(0, 32);
  const stageLocation = String(input.stageLocation || "").trim().slice(0, 120);

  if (!phone || !fullName || !zone || !plate || !nationalId || !stageLocation) {
    return {
      error: "invalid_application",
      message:
        "Fill full name, WhatsApp/M-Pesa phone, national ID, town (Nairobi or Thika), stage, and bike plate.",
    };
  }
  if (!input.idDocument || !input.dlDocument || !input.stageLetter) {
    return {
      error: "docs_required",
      message: "Upload National ID, driving licence (Class A), and stage chairman letter.",
    };
  }

  const existing = await query(`SELECT id, verification_status FROM riders WHERE phone = $1 LIMIT 1`, [
    phone,
  ]);
  if (existing.rows[0]?.verification_status === "VERIFIED") {
    return {
      error: "already_verified",
      message: "This phone is already a verified Sokoni rider. Message Sokoni support to update docs.",
    };
  }
  if (existing.rows[0]?.verification_status === "SUSPENDED") {
    return {
      error: "suspended",
      message: "This rider profile is suspended. Contact Sokoni support before re-applying.",
    };
  }

  let nationalIdFrontUrl;
  let licenseUrl;
  let stageLetterUrl;
  try {
    nationalIdFrontUrl = await saveRiderDoc({
      phone,
      kind: "national-id",
      data: input.idDocument,
      filename: input.idDocumentName || "",
    });
    licenseUrl = await saveRiderDoc({
      phone,
      kind: "license",
      data: input.dlDocument,
      filename: input.dlDocumentName || "",
    });
    stageLetterUrl = await saveRiderDoc({
      phone,
      kind: "stage-letter",
      data: input.stageLetter,
      filename: input.stageLetterName || "",
    });
  } catch (err) {
    if (err?.code === "too_large") {
      return { error: "file_too_large", message: "Each document must be under 4 MB (image or PDF)." };
    }
    console.warn("[boda-fleet] doc save failed:", err.message);
    return { error: "upload_failed", message: "Could not save documents. Try again." };
  }

  if (!nationalIdFrontUrl || !licenseUrl || !stageLetterUrl) {
    return {
      error: "docs_required",
      message: "One or more documents could not be read. Re-select the files.",
    };
  }

  const result = await upsertRiderProfile({
    fullName,
    phone,
    nationalId,
    operatingTown: zone,
    stageLocation,
    motorbikePlate: plate,
    licenseClass: "A",
    nationalIdFrontUrl,
    licenseUrl,
    stageLetterUrl,
    verificationStatus: "PENDING",
  });
  if (result.error) return result;

  await query(
    `UPDATE riders SET
       verification_status = 'PENDING',
       is_available = FALSE,
       national_id_front_url = $2,
       license_url = $3,
       stage_letter_url = $4,
       updated_at = NOW()
     WHERE id = $1`,
    [result.rider.id, nationalIdFrontUrl, licenseUrl, stageLetterUrl]
  );

  console.log(`[boda-fleet] rider application PENDING #${result.rider.id} ${phone} ${zone}`);
  return {
    ok: true,
    riderId: result.rider.id,
    status: "PENDING",
    message:
      "Application received. Sokoni will review your documents and WhatsApp you when you're verified.",
  };
}

export async function setRiderVerificationStatus(riderId, status, { reason = "" } = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured" };
  const st = String(status || "").toUpperCase();
  if (!["PENDING", "VERIFIED", "SUSPENDED", "REJECTED"].includes(st)) {
    return { error: "invalid_status", message: "Use PENDING, VERIFIED, SUSPENDED, or REJECTED." };
  }
  const { rows } = await query(
    `UPDATE riders SET
       verification_status = $2,
       is_available = CASE WHEN $2 = 'VERIFIED' THEN is_available ELSE FALSE END,
       suspend_reason = CASE WHEN $2 = 'SUSPENDED' THEN $3 ELSE NULL END,
       suspended_at = CASE WHEN $2 = 'SUSPENDED' THEN NOW() ELSE NULL END,
       updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [Number(riderId), st, String(reason || "").slice(0, 400) || null]
  );
  if (!rows[0]) return { error: "not_found", message: "Rider not found." };
  return { ok: true, rider: mapRider(rows[0]) };
}

export async function listRiders({ zone = null, status = null, limit = 50 } = {}) {
  if (!isDbEnabled()) return { riders: [], error: "database_not_configured" };
  const z = zone ? normalizeBodaZone(zone) : null;
  const st = status ? String(status).toUpperCase() : null;
  const { rows } = await query(
    `SELECT * FROM riders
      WHERE ($1::text IS NULL OR operating_town = $1)
        AND ($2::text IS NULL OR verification_status = $2)
      ORDER BY created_at DESC
      LIMIT $3`,
    [z, st, Math.min(Math.max(Number(limit) || 50, 1), 200)]
  );
  return { ok: true, riders: rows.map(mapRider) };
}

async function listAvailableRiders(zone) {
  const z = normalizeBodaZone(zone);
  if (!z) return [];
  const { rows } = await query(
    `SELECT * FROM riders
      WHERE operating_town = $1
        AND verification_status = 'VERIFIED'
        AND is_available = TRUE
      ORDER BY rating DESC, id ASC
      LIMIT $2`,
    [z, BROADCAST_LIMIT]
  );
  return rows.map(mapRider);
}

export async function getOpenDispatchForOrder(orderRef) {
  if (!isDbEnabled()) return null;
  const id = normalizeOrderId(orderRef) || String(orderRef || "").toUpperCase();
  const { rows } = await query(
    `SELECT * FROM delivery_dispatches
      WHERE UPPER(order_ref) = UPPER($1)
        AND status IN ('REQUESTED','ACCEPTED','PICKED_UP','OTP_SENT')
      ORDER BY id DESC
      LIMIT 1`,
    [id]
  );
  return rows[0] ? mapDispatch(rows[0]) : null;
}

/**
 * Seller Hub / API: create REQUESTED dispatch and ping verified riders in zone.
 */
export async function requestBodaDispatch({
  orderId,
  phone,
  sessionToken,
  zone = "NAIROBI",
  pickupAddress = "",
  deliveryAddress = "",
  deliveryFeeKes = 0,
} = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Boda fleet needs Postgres." };
  }
  const { requireAuthenticatedSeller } = await import("./seller-onboard.js");
  const check = await requireAuthenticatedSeller(phone, sessionToken);
  if (check.error) return check;

  const id = normalizeOrderId(orderId);
  if (!id) return { error: "invalid_order_id", message: "Enter a valid SKN order id." };
  const order = getOrder(id);
  if (!order) return { error: "not_found", message: `Order ${id} not found.` };
  if (order.supplierId && order.supplierId !== check.supplier.id) {
    return { error: "forbidden", message: "This order is not linked to your shop." };
  }
  if (order.disputeHold || order.adminTakeOver) {
    return { error: "support_hold", message: "Order is with Sokoni support — cannot call a boda yet." };
  }
  const paid = order.customerPaymentStatus === "confirmed" || order.paid || order.paymentStatus === "paid";
  if (!paid) return { error: "unpaid", message: "Buyer must pay into escrow first." };

  const town = normalizeBodaZone(zone) || "NAIROBI";
  const pickup =
    String(pickupAddress || "").trim() ||
    String(check.supplier?.location || check.supplier?.shopName || "Seller pickup").slice(0, 240);
  const drop =
    String(deliveryAddress || "").trim() ||
    String(order.location || order.dropOff || order.customerLocation || "Buyer drop-off").slice(0, 240);
  const fee = Math.max(0, Number(deliveryFeeKes) || Number(order.shippingKes) || 0);

  const existing = await getOpenDispatchForOrder(id);
  if (existing) {
    return {
      ok: true,
      already: true,
      dispatch: existing,
      message: `Boda request already open for *${id}* (${existing.status}).`,
    };
  }

  const riders = await listAvailableRiders(town);
  if (!riders.length) {
    return {
      error: "no_riders",
      message: `No verified available Sokoni boda riders in ${town} right now. Try again shortly or mark dispatched yourself.`,
    };
  }

  const riderIds = riders.map((r) => r.id);
  const { rows } = await query(
    `INSERT INTO delivery_dispatches (
       order_ref, seller_phone, pickup_address, delivery_address,
       delivery_fee_kes, operating_town, status, broadcast_rider_ids, meta
     ) VALUES ($1,$2,$3,$4,$5,$6,'REQUESTED',$7::int[], $8::jsonb)
     RETURNING *`,
    [
      id,
      normalizeRiderPhone(phone) || check.supplier?.phone || null,
      pickup,
      drop,
      fee,
      town,
      riderIds,
      JSON.stringify({ productName: order.productName || null, sellerHandle: check.supplier?.shopHandle || null }),
    ]
  );
  const dispatch = mapDispatch(rows[0]);

  const { sendText } = await import("./whatsapp.js");
  const feeLine = fee > 0 ? `Fee: KES ${fee.toLocaleString()}\n` : "";
  const blast =
    `🛵 *New Sokoni pickup*\n` +
    `Order *${id}*\n` +
    `Pickup: ${pickup}\n` +
    `Drop-off: ${drop}\n` +
    feeLine +
    `Zone: ${town}\n\n` +
    `Reply *ACCEPT ${id}* to claim.\n` +
    `Busy? Ignore — first ACCEPT wins.`;

  let pinged = 0;
  for (const rider of riders) {
    try {
      await sendText(`${rider.phone}@c.us`, blast);
      pinged += 1;
    } catch (err) {
      console.warn("[boda-fleet] rider ping failed:", rider.phone, err.message);
    }
  }

  updateOrderMeta(id, {
    bodaDispatchId: dispatch.id,
    bodaZone: town,
    bodaStatus: "REQUESTED",
  });

  console.log(`[boda-fleet] REQUESTED ${id} zone=${town} riders=${pinged}/${riders.length}`);
  return {
    ok: true,
    dispatch,
    ridersPinged: pinged,
    ridersAvailable: riders.length,
    message:
      `Calling ${pinged} verified rider${pinged === 1 ? "" : "s"} in ${town} for *${id}*. ` +
      `You'll get a WhatsApp when one accepts.`,
  };
}

/**
 * Rider WhatsApp: ACCEPT SKN-####
 */
export async function acceptBodaDispatch({ orderId, phone, customerKey = "" } = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured", message: "Database offline." };
  const id = normalizeOrderId(orderId);
  const riderPhone = normalizeRiderPhone(phone) || normalizeRiderPhone(customerKey);
  if (!id || !riderPhone) {
    return { error: "invalid", message: "Reply like: ACCEPT SKN-1234" };
  }

  const { rows: riderRows } = await query(`SELECT * FROM riders WHERE phone = $1 LIMIT 1`, [riderPhone]);
  const rider = mapRider(riderRows[0]);
  if (!rider) {
    return {
      error: "not_a_rider",
      message: "This WhatsApp is not a registered Sokoni boda rider. Ask ops to onboard you.",
    };
  }
  if (rider.verificationStatus === "SUSPENDED") {
    return { error: "suspended", message: "Your rider profile is suspended pending investigation." };
  }
  if (rider.verificationStatus !== "VERIFIED") {
    return { error: "not_verified", message: "Your rider profile is not VERIFIED yet." };
  }
  if (!rider.isAvailable) {
    return { error: "unavailable", message: "You are marked unavailable. Reply *AVAILABLE* first." };
  }

  const { rows: dispRows } = await query(
    `SELECT * FROM delivery_dispatches
      WHERE UPPER(order_ref) = UPPER($1)
        AND status = 'REQUESTED'
      ORDER BY id DESC
      LIMIT 1`,
    [id]
  );
  const row = dispRows[0];
  if (!row) {
    const open = await getOpenDispatchForOrder(id);
    if (open?.status === "ACCEPTED" || open?.status === "PICKED_UP" || open?.status === "OTP_SENT") {
      return { error: "taken", message: `*${id}* was already claimed by another rider.` };
    }
    return { error: "not_found", message: `No open boda request for *${id}*.` };
  }
  if (row.operating_town && row.operating_town !== rider.operatingTown) {
    return {
      error: "wrong_zone",
      message: `This job is ${row.operating_town}. Your zone is ${rider.operatingTown}. Reply *SET ZONE ${row.operating_town}* if you relocated.`,
    };
  }

  const { rows: updated } = await query(
    `UPDATE delivery_dispatches SET
       rider_id = $2,
       status = 'ACCEPTED',
       accepted_at = NOW(),
       updated_at = NOW()
     WHERE id = $1 AND status = 'REQUESTED'
     RETURNING *`,
    [row.id, rider.id]
  );
  if (!updated[0]) {
    return { error: "taken", message: `*${id}* was claimed by another rider just now.` };
  }

  await query(
    `UPDATE riders SET is_available = FALSE, updated_at = NOW() WHERE id = $1`,
    [rider.id]
  );

  const order = getOrder(id);
  // Mark order in_transit with rider details (same path as seller DISPATCH).
  try {
    const { advanceShipmentStatus } = await import("./shipments.js");
    const { isDispatched } = await import("./communication-hub.js");
    if (order && !isDispatched(order)) {
      advanceShipmentStatus(id, "in_transit", {
        actor: "boda_accept",
        note: `Sokoni boda accepted by ${rider.fullName}`,
        skipBuyerNotify: true,
        riderName: rider.fullName,
        riderPhone: rider.phone,
      });
    }
  } catch (err) {
    console.warn("[boda-fleet] advanceShipmentStatus:", err.message);
  }

  updateOrderMeta(id, {
    sellerDispatchedAt: order?.sellerDispatchedAt || Date.now(),
    riderName: rider.fullName,
    riderPhone: rider.phone,
    riderPlate: rider.motorbikePlate,
    bodaDispatchId: Number(updated[0].id),
    bodaStatus: "ACCEPTED",
    bodaRiderId: rider.id,
    deliveryMode: "sokoni_boda",
  });

  const fresh = getOrder(id) || order;
  const { sendText } = await import("./whatsapp.js");
  const plate = rider.motorbikePlate || "—";
  const sellerMsg =
    `✅ *Boda assigned — ${id}*\n` +
    `Rider: *${rider.fullName}*\n` +
    `Phone: ${rider.phone}\n` +
    `Plate: ${plate}\n` +
    `Have the parcel ready at: ${updated[0].pickup_address}`;
  const buyerMsg =
    `🛵 Your order *${id}* is on the way with a Sokoni vetted rider.\n` +
    `• Rider: *${rider.fullName}*\n` +
    `• Phone: ${rider.phone}\n` +
    `• Plate: ${plate}\n` +
    `When it arrives, you'll get a 4-digit code — share it only with this rider to confirm delivery.`;
  const riderMsg =
    `✅ You claimed *${id}*.\n` +
    `Pickup: ${updated[0].pickup_address}\n` +
    `Drop-off: ${updated[0].delivery_address}\n` +
    (Number(updated[0].delivery_fee_kes) > 0
      ? `Fee (held): KES ${Number(updated[0].delivery_fee_kes).toLocaleString()}\n`
      : "") +
    `\nAfter pickup reply *PICKED ${id}*.\n` +
    `At the door reply *DELIVERED ${id}* — buyer gets an OTP.`;

  const sellerTo = updated[0].seller_phone
    ? `${normalizeRiderPhone(updated[0].seller_phone)}@c.us`
    : null;
  const buyerTo = fresh?.customerKey || null;

  try {
    if (sellerTo) await sendText(sellerTo, sellerMsg);
  } catch (err) {
    console.warn("[boda-fleet] seller notify:", err.message);
  }
  try {
    if (buyerTo) await sendText(buyerTo, buyerMsg);
  } catch (err) {
    console.warn("[boda-fleet] buyer notify:", err.message);
  }
  try {
    await sendText(customerKey || `${riderPhone}@c.us`, riderMsg);
  } catch (err) {
    console.warn("[boda-fleet] rider ack:", err.message);
  }

  return {
    ok: true,
    dispatch: mapDispatch(updated[0]),
    rider,
    message: riderMsg,
  };
}

export async function setRiderOperatingZone({ phone, customerKey = "", zone } = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured" };
  const riderPhone = normalizeRiderPhone(phone) || normalizeRiderPhone(customerKey);
  const town = normalizeBodaZone(zone);
  if (!riderPhone || !town) {
    return { error: "invalid", message: "Reply like: SET ZONE NAIROBI  or  SET ZONE THIKA" };
  }
  const { rows } = await query(
    `UPDATE riders SET operating_town = $2, updated_at = NOW()
      WHERE phone = $1
      RETURNING *`,
    [riderPhone, town]
  );
  if (!rows[0]) return { error: "not_a_rider", message: "Not a registered rider on this WhatsApp." };
  return {
    ok: true,
    rider: mapRider(rows[0]),
    message: `Zone updated to *${town}*. You'll only get jobs in this zone.`,
  };
}

export async function setRiderAvailability({ phone, customerKey = "", available = true } = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured" };
  const riderPhone = normalizeRiderPhone(phone) || normalizeRiderPhone(customerKey);
  if (!riderPhone) return { error: "invalid" };
  const { rows } = await query(
    `UPDATE riders SET is_available = $2, updated_at = NOW()
      WHERE phone = $1 AND verification_status = 'VERIFIED'
      RETURNING *`,
    [riderPhone, Boolean(available)]
  );
  if (!rows[0]) return { error: "not_a_rider", message: "Verified rider profile required." };
  return {
    ok: true,
    rider: mapRider(rows[0]),
    message: available ? "You are *AVAILABLE* for Sokoni jobs." : "You are *OFFLINE*. Reply *AVAILABLE* when ready.",
  };
}

export async function markBodaPickedUp({ orderId, phone, customerKey = "" } = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured" };
  const id = normalizeOrderId(orderId);
  const riderPhone = normalizeRiderPhone(phone) || normalizeRiderPhone(customerKey);
  const { rows } = await query(
    `UPDATE delivery_dispatches d SET
       status = 'PICKED_UP',
       picked_up_at = NOW(),
       updated_at = NOW()
     FROM riders r
     WHERE d.order_ref = $1
       AND d.rider_id = r.id
       AND r.phone = $2
       AND d.status = 'ACCEPTED'
     RETURNING d.*`,
    [id, riderPhone]
  );
  if (!rows[0]) return { error: "not_found", message: `No accepted job *${id}* for you.` };
  updateOrderMeta(id, { bodaStatus: "PICKED_UP" });
  return { ok: true, dispatch: mapDispatch(rows[0]), message: `Marked *${id}* picked up. Head to drop-off.` };
}

/**
 * Rider: DELIVERED SKN-#### → send OTP to buyer.
 */
export async function markBodaDeliveredRequestOtp({ orderId, phone, customerKey = "" } = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured" };
  const id = normalizeOrderId(orderId);
  const riderPhone = normalizeRiderPhone(phone) || normalizeRiderPhone(customerKey);
  const otp = String(randomInt(1000, 9999));
  const { rows } = await query(
    `UPDATE delivery_dispatches d SET
       status = 'OTP_SENT',
       delivery_otp_hash = $3,
       delivery_otp_sent_at = NOW(),
       updated_at = NOW()
     FROM riders r
     WHERE UPPER(d.order_ref) = UPPER($1)
       AND d.rider_id = r.id
       AND r.phone = $2
       AND d.status IN ('ACCEPTED','PICKED_UP','OTP_SENT')
     RETURNING d.*`,
    [id, riderPhone, hashOtp(otp)]
  );
  if (!rows[0]) {
    return { error: "not_found", message: `No active boda job *${id}* for you.` };
  }

  const order = getOrder(id);
  const { sendText } = await import("./whatsapp.js");
  if (order?.customerKey) {
    try {
      await sendText(
        order.customerKey,
        `🔐 *Delivery code for ${id}*\n` +
          `Your Sokoni rider is at the door.\n` +
          `Code: *${otp}*\n\n` +
          `Share this code only with the rider whose plate matches your earlier alert.\n` +
          `Or reply *YES ${id}* if you already received the item.`
      );
    } catch (err) {
      console.warn("[boda-fleet] OTP to buyer failed:", err.message);
    }
  }
  updateOrderMeta(id, { bodaStatus: "OTP_SENT" });
  return {
    ok: true,
    dispatch: mapDispatch(rows[0]),
    message: `OTP sent to the buyer for *${id}*. Ask them for the 4-digit code, then they can confirm — or they reply YES.`,
  };
}

/**
 * Buyer: CODE 1234 / OTP 1234 [SKN] → confirm delivery (same escrow path as YES).
 */
export async function confirmBodaDeliveryWithOtp({
  orderId = "",
  code = "",
  phone = "",
  customerKey = "",
} = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured" };
  const otp = String(code || "").replace(/\D/g, "").slice(0, 4);
  if (otp.length !== 4) return { error: "invalid_otp", message: "Enter the 4-digit code." };

  let id = normalizeOrderId(orderId);
  let row = null;
  if (id) {
    const { rows } = await query(
      `SELECT * FROM delivery_dispatches
        WHERE UPPER(order_ref) = UPPER($1)
          AND status = 'OTP_SENT'
        ORDER BY id DESC LIMIT 1`,
      [id]
    );
    row = rows[0] || null;
  } else {
    // Match by buyer phone / open OTP for their recent orders
    const orders = (await import("./orders.js")).getOrdersForCustomer(customerKey, phone).slice(0, 8);
    for (const o of orders) {
      const { rows } = await query(
        `SELECT * FROM delivery_dispatches
          WHERE UPPER(order_ref) = UPPER($1) AND status = 'OTP_SENT'
          ORDER BY id DESC LIMIT 1`,
        [o.id]
      );
      if (rows[0] && rows[0].delivery_otp_hash === hashOtp(otp)) {
        row = rows[0];
        id = o.id;
        break;
      }
    }
  }

  if (!row || row.delivery_otp_hash !== hashOtp(otp)) {
    return { error: "otp_mismatch", message: "That code doesn't match. Check the latest WhatsApp from Sokoni." };
  }

  await query(
    `UPDATE delivery_dispatches SET
       status = 'DELIVERED',
       delivered_at = NOW(),
       fee_status = 'PENDING_MPESA',
       delivery_otp_hash = NULL,
       updated_at = NOW()
     WHERE id = $1`,
    [row.id]
  );
  if (row.rider_id) {
    await query(`UPDATE riders SET is_available = TRUE, updated_at = NOW() WHERE id = $1`, [
      row.rider_id,
    ]);
  }

  updateOrderMeta(id, { bodaStatus: "DELIVERED", bodaFeeStatus: "PENDING_MPESA" });

  // Reuse buyer YES escrow confirmation path.
  try {
    const { handleOrderBusMessage } = await import("./communication-hub.js");
    await handleOrderBusMessage(customerKey, `YES ${id}`, { phone });
  } catch (err) {
    console.warn("[boda-fleet] YES after OTP:", err.message);
  }

  return {
    ok: true,
    orderId: id,
    message: `✅ Code accepted — *${id}* marked delivered. Thank you.`,
  };
}

/** On fulfillment dispute: suspend assigned rider + mark dispatch DISPUTED. */
export async function suspendBodaRiderForOrderDispute(orderRef, { reason = "Buyer dispute" } = {}) {
  if (!isDbEnabled()) return { ok: false, skipped: true };
  const id = normalizeOrderId(orderRef) || String(orderRef || "").toUpperCase();
  if (!id) return { ok: false };

  const { rows } = await query(
    `UPDATE delivery_dispatches SET
       status = 'DISPUTED',
       fee_status = 'HELD',
       updated_at = NOW()
     WHERE UPPER(order_ref) = UPPER($1)
       AND status IN ('REQUESTED','ACCEPTED','PICKED_UP','OTP_SENT','DELIVERED')
     RETURNING *`,
    [id]
  );
  const dispatch = rows[0];
  if (!dispatch?.rider_id) {
    return { ok: true, suspended: false, message: "No assigned boda on this order." };
  }

  await query(
    `UPDATE riders SET
       verification_status = 'SUSPENDED',
       is_available = FALSE,
       suspend_reason = $2,
       suspended_at = NOW(),
       suspended_order_ref = $3,
       updated_at = NOW()
     WHERE id = $1`,
    [dispatch.rider_id, String(reason || "").slice(0, 400), id]
  );

  try {
    const { rows: rrows } = await query(`SELECT phone, full_name FROM riders WHERE id = $1`, [
      dispatch.rider_id,
    ]);
    const r = rrows[0];
    if (r?.phone) {
      const { sendText } = await import("./whatsapp.js");
      await sendText(
        `${r.phone}@c.us`,
        `⚠️ *Rider suspended*\nOrder *${id}* was flagged in a dispute.\nYour profile is SUSPENDED pending Sokoni review. Do not accept new jobs.`
      );
    }
  } catch (err) {
    console.warn("[boda-fleet] suspend notify:", err.message);
  }

  console.log(`[boda-fleet] SUSPENDED rider #${dispatch.rider_id} for dispute on ${id}`);
  return { ok: true, suspended: true, riderId: dispatch.rider_id, orderId: id };
}

/**
 * WhatsApp command hook for riders + buyer OTP.
 * @returns {Promise<boolean>} true if consumed
 */
export async function tryHandleBodaFleetMessage(customerKey, text, { phone = "" } = {}) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;
  const { sendText } = await import("./whatsapp.js");
  const { extractOrderIdFromText } = await import("./orders.js");

  const accept = trimmed.match(/^ACCEPT\s+(SKN?-?\d{1,6}(?:-\d+)?)\b/i);
  if (accept) {
    const result = await acceptBodaDispatch({
      orderId: accept[1],
      phone,
      customerKey,
    });
    await sendText(customerKey, result.message || result.error || "Could not accept.");
    return true;
  }

  const setZone = trimmed.match(/^SET\s+ZONE\s+(\w+)\b/i);
  if (setZone) {
    const result = await setRiderOperatingZone({ phone, customerKey, zone: setZone[1] });
    await sendText(customerKey, result.message || result.error || "Zone update failed.");
    return true;
  }

  if (/^(AVAILABLE|ONLINE)\b/i.test(trimmed)) {
    const result = await setRiderAvailability({ phone, customerKey, available: true });
    await sendText(customerKey, result.message || result.error || "OK");
    return true;
  }
  if (/^(UNAVAILABLE|OFFLINE|BUSY)\b/i.test(trimmed)) {
    const result = await setRiderAvailability({ phone, customerKey, available: false });
    await sendText(customerKey, result.message || result.error || "OK");
    return true;
  }

  const picked = trimmed.match(/^PICKED(?:\s+UP)?\s+(SKN?-?\d{1,6}(?:-\d+)?)\b/i);
  if (picked) {
    const result = await markBodaPickedUp({ orderId: picked[1], phone, customerKey });
    await sendText(customerKey, result.message || result.error || "Could not update.");
    return true;
  }

  const delivered = trimmed.match(/^DELIVERED\s+(SKN?-?\d{1,6}(?:-\d+)?)\b/i);
  if (delivered) {
    const result = await markBodaDeliveredRequestOtp({
      orderId: delivered[1],
      phone,
      customerKey,
    });
    await sendText(customerKey, result.message || result.error || "Could not update.");
    return true;
  }

  const otpMatch = trimmed.match(/^(?:CODE|OTP)\s+(\d{4})(?:\s+(SKN?-?\d{1,6}(?:-\d+)?))?$/i);
  if (otpMatch) {
    const result = await confirmBodaDeliveryWithOtp({
      code: otpMatch[1],
      orderId: otpMatch[2] || extractOrderIdFromText(trimmed) || "",
      phone,
      customerKey,
    });
    await sendText(customerKey, result.message || result.error || "Code not accepted.");
    return true;
  }

  return false;
}

export function bodaFleetConfigured() {
  return isDbEnabled();
}

export function bodaSupportSummary() {
  return {
    zones: [...ZONES],
    commands: [
      "ACCEPT SKN-####",
      "SET ZONE NAIROBI|THIKA",
      "AVAILABLE / OFFLINE",
      "PICKED SKN-####",
      "DELIVERED SKN-####",
      "CODE 1234",
    ],
    botPublicUrl: config.botPublicUrl || null,
  };
}
