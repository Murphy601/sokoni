/**
 * Sokoni vetted boda fleet — Nairobi / Thika ops zones.
 * WhatsApp-first: sellers request riders; riders ACCEPT / SET ZONE / DELIVERED / OTP.
 * Order refs are SKN-#### strings (never integer order PKs).
 */
import { createHash, randomInt } from "node:crypto";
import { isDbEnabled, query, withTransaction } from "../db/pool.js";
import { config } from "../config.js";
import { getOrder, normalizeOrderId, updateOrderMeta } from "./orders.js";
import {
  calculateDeliveryPayoutSplit,
  formatPayoutSplitMessage,
} from "../lib/rider-payout-fees.js";
import {
  RIDER_B2C_MIN_FLOOR_KES,
  RIDER_SINGLE_FEE_MANUAL_KES,
} from "../lib/rider-b2c-guards.js";
import {
  extractMpesaDisplayName,
  namesLikelyMatch,
} from "../lib/mpesa-name-match.js";
import {
  rankRidersByDispatchScore,
  OFFER_TIMEOUT_MS,
  LATE_PICKUP_PENALTY,
  CANCEL_JOB_PENALTY,
  LATE_PICKUP_MINUTES,
  clampRiderRating,
} from "../lib/dispatch-matcher.js";

/** Unique-violation Postgres code (phone / national_id / plate). */
const PG_UNIQUE = "23505";

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

const GEOFENCE_RADIUS_M = 200;
const RIDER_LOCATION_MAX_AGE_MS = 10 * 60 * 1000;

/** Great-circle distance in metres (WGS84). */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const R = 6371000;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(Number(lat2) - Number(lat1));
  const Δλ = toRad(Number(lng2) - Number(lng1));
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function parseCoordPair(lat, lng) {
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  if (a === 0 && b === 0) return null;
  return { lat: a, lng: b };
}

/** Best-effort Nominatim geocode for Kenya drop-offs (fail-soft). */
async function geocodeKenyaAddress(address) {
  const q = String(address || "").trim();
  if (q.length < 6) return null;
  try {
    const axios = (await import("axios")).default;
    const { data } = await axios.get("https://nominatim.openstreetmap.org/search", {
      params: {
        q: `${q}, Kenya`,
        format: "json",
        limit: 1,
        countrycodes: "ke",
      },
      headers: { "User-Agent": "SokoniBodaFleet/1.0 (ops@sokonimall.com)" },
      timeout: 6000,
    });
    const hit = Array.isArray(data) ? data[0] : null;
    return parseCoordPair(hit?.lat, hit?.lon);
  } catch (err) {
    console.warn("[boda-fleet] geocode skipped:", err.message);
    return null;
  }
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
    licenseClass: row.license_class || null,
    guarantorName: row.guarantor_name || null,
    guarantorPhone: row.guarantor_phone || null,
    verificationStatus: row.verification_status,
    isAvailable: Boolean(row.is_available),
    rating: row.rating != null ? Number(row.rating) : 5,
    lastLat: row.last_lat != null ? Number(row.last_lat) : null,
    lastLng: row.last_lng != null ? Number(row.last_lng) : null,
    lastLocationAt: row.last_location_at || null,
    acceptanceRate: row.acceptance_rate != null ? Number(row.acceptance_rate) : 70,
    offersSent: row.offers_sent != null ? Number(row.offers_sent) : 0,
    offersAccepted: row.offers_accepted != null ? Number(row.offers_accepted) : 0,
    suspendReason: row.suspend_reason || null,
    docs: {
      nationalIdFrontUrl: row.national_id_front_url || null,
      nationalIdBackUrl: row.national_id_back_url || null,
      licenseUrl: row.license_url || null,
      logbookUrl: row.logbook_url || null,
      goodConductUrl: row.good_conduct_url || null,
      ntsaBadgeUrl: row.ntsa_badge_url || null,
      stageLetterUrl: row.stage_letter_url || null,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    custodyStatus: row.custody_status || null,
    feeStatus: row.fee_status,
    payoutStatus: row.payout_status || null,
    payoutHoldUntil: row.payout_hold_until || null,
    disputeWindowEndsAt: row.dispute_window_ends_at || null,
    acceptedAt: row.accepted_at,
    pickedUpAt: row.picked_up_at,
    deliveredAt: row.delivered_at,
    pinnedRiderId: row.pinned_rider_id != null ? Number(row.pinned_rider_id) : null,
    pinOfferedAt: row.pin_offered_at || null,
    dispatchSource: row.dispatch_source || null,
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

/**
 * Public web onboarding — creates/updates rider as PENDING with verification doc URLs.
 * Call after multer (or other upload) has stored files and built public URLs.
 * Required URLs: nationalIdFrontUrl, licenseUrl, stageLetterUrl.
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
  const guarantorName = String(input.guarantorName || "").trim().slice(0, 120) || null;
  const guarantorPhone = normalizeRiderPhone(input.guarantorPhone) || null;

  const nationalIdFrontUrl = String(input.nationalIdFrontUrl || "").trim() || null;
  const nationalIdBackUrl = String(input.nationalIdBackUrl || "").trim() || null;
  const licenseUrl = String(input.licenseUrl || "").trim() || null;
  const stageLetterUrl = String(input.stageLetterUrl || "").trim() || null;
  const logbookUrl = String(input.logbookUrl || "").trim() || null;
  const goodConductUrl = String(input.goodConductUrl || "").trim() || null;
  const ntsaBadgeUrl = String(input.ntsaBadgeUrl || "").trim() || null;

  if (!phone || !fullName || !zone || !plate || !nationalId || !stageLocation) {
    return {
      error: "invalid_application",
      message:
        "Fill full name, WhatsApp/M-Pesa phone, national ID, town (Nairobi or Thika), stage, and bike plate.",
    };
  }
  if (!nationalIdFrontUrl || !licenseUrl || !stageLetterUrl) {
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

  let result;
  try {
    result = await upsertRiderProfile({
      fullName,
      phone,
      nationalId,
      operatingTown: zone,
      stageLocation,
      motorbikePlate: plate,
      licenseClass: "A",
      guarantorName,
      guarantorPhone,
      nationalIdFrontUrl,
      nationalIdBackUrl,
      licenseUrl,
      logbookUrl,
      goodConductUrl,
      ntsaBadgeUrl,
      stageLetterUrl,
      verificationStatus: "PENDING",
    });
  } catch (err) {
    if (err?.code === PG_UNIQUE) {
      return {
        error: "duplicate",
        message: "Phone number, National ID, or number plate already registered.",
      };
    }
    throw err;
  }
  if (result.error) return result;

  await query(
    `UPDATE riders SET
       verification_status = 'PENDING',
       is_available = FALSE,
       national_id_front_url = $2,
       national_id_back_url = COALESCE($3, national_id_back_url),
       license_url = $4,
       stage_letter_url = $5,
       logbook_url = COALESCE($6, logbook_url),
       good_conduct_url = COALESCE($7, good_conduct_url),
       ntsa_badge_url = COALESCE($8, ntsa_badge_url),
       guarantor_name = COALESCE($9, guarantor_name),
       guarantor_phone = COALESCE($10, guarantor_phone),
       updated_at = NOW()
     WHERE id = $1`,
    [
      result.rider.id,
      nationalIdFrontUrl,
      nationalIdBackUrl,
      licenseUrl,
      stageLetterUrl,
      logbookUrl,
      goodConductUrl,
      ntsaBadgeUrl,
      guarantorName,
      guarantorPhone,
    ]
  );

  try {
    const { notifyAdminEvent } = await import("./communication-hub.js");
    await notifyAdminEvent("DISPUTE_OR_HELP", {
      orderId: null,
      details:
        `🛵 New boda rider application PENDING\n` +
        `• ${fullName} · ${phone}\n` +
        `• Zone: ${zone} · Plate: ${plate}\n` +
        `• Stage: ${stageLocation}\n` +
        `Review: /admin/boda or admin-boda.html`,
    });
  } catch (err) {
    console.warn("[boda-fleet] admin notify on apply skipped:", err.message);
  }

  console.log(`[boda-fleet] rider application PENDING #${result.rider.id} ${phone} ${zone}`);
  return {
    ok: true,
    success: true,
    riderId: result.rider.id,
    status: "PENDING",
    rider: {
      id: result.rider.id,
      full_name: fullName,
      verification_status: "PENDING",
    },
    message:
      "Application submitted successfully. Sokoni team will review your documents within 24 hours.",
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
       is_available = CASE WHEN $2 = 'VERIFIED' THEN TRUE ELSE FALSE END,
       suspend_reason = CASE WHEN $2 = 'SUSPENDED' THEN $3 ELSE NULL END,
       suspended_at = CASE WHEN $2 = 'SUSPENDED' THEN NOW() ELSE NULL END,
       suspended_order_ref = CASE WHEN $2 = 'SUSPENDED' THEN suspended_order_ref ELSE NULL END,
       updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [Number(riderId), st, String(reason || "").slice(0, 400) || null]
  );
  if (!rows[0]) return { error: "not_found", message: "Rider not found." };
  const rider = mapRider(rows[0]);

  try {
    const { sendText } = await import("./whatsapp.js");
    if (st === "VERIFIED") {
      await sendText(
        `${rider.phone}@c.us`,
        `✅ *You're a verified Sokoni rider*\n` +
          `Zone: *${rider.operatingTown}*\n` +
          `You're marked AVAILABLE for jobs.\n\n` +
          `Commands:\n` +
          `• *ACCEPT SKN-####* — claim a job offer\n` +
          `• *DECLINE SKN-####* — skip; next rider gets pinged\n` +
          `• *CANCEL JOB SKN-####* — drop after accept (−0.5 ★)\n` +
          `• *SET ZONE NAIROBI* or *THIKA*\n` +
          `• *OFFLINE* / *AVAILABLE*`
      );
    } else if (st === "REJECTED") {
      await sendText(
        `${rider.phone}@c.us`,
        `❌ Your Sokoni boda application was not approved.` +
          (reason ? `\nReason: ${reason}` : "") +
          `\nYou can fix docs and re-apply at sokonimall.com/boda/apply.html`
      );
    } else if (st === "SUSPENDED") {
      await sendText(
        `${rider.phone}@c.us`,
        `⚠️ Your Sokoni rider profile is *SUSPENDED*.` +
          (reason ? `\n${reason}` : "") +
          `\nDo not accept new jobs until ops clears you.`
      );
    }
  } catch (err) {
    console.warn("[boda-fleet] verify notify skipped:", err.message);
  }

  return { ok: true, rider };
}


export async function listRiders({ zone = null, status = null, limit = 50 } = {}) {
  if (!isDbEnabled()) return { riders: [], error: "database_not_configured" };
  const z = zone ? normalizeBodaZone(zone) : null;
  const st = status ? String(status).toUpperCase() : null;
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  let rows = [];
  try {
    const result = await query(
      `SELECT r.*,
              d.status AS active_dispatch_status,
              d.order_ref AS active_order_ref,
              d.id AS active_dispatch_id,
              COALESCE(jobs.completed_trips, 0)::int AS completed_trips,
              COALESCE(ledger.unpaid_kes, 0)::numeric AS unpaid_ledger_kes
         FROM riders r
         LEFT JOIN LATERAL (
           SELECT dd.status, dd.order_ref, dd.id
             FROM delivery_dispatches dd
            WHERE dd.rider_id = r.id
              AND dd.status IN ('ACCEPTED', 'PICKED_UP', 'OTP_SENT', 'OTP_LOCKED')
            ORDER BY dd.id DESC
            LIMIT 1
         ) d ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS completed_trips
             FROM delivery_dispatches dd
            WHERE dd.rider_id = r.id
              AND dd.status = 'DELIVERED'
         ) jobs ON TRUE
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(COALESCE(p.net_amount_paid, p.amount, 0)), 0) AS unpaid_kes
             FROM rider_payouts p
            WHERE p.rider_id = r.id
              AND UPPER(COALESCE(p.status, '')) IN (
                'CLEARED', 'ON_HOLD', 'NEEDS_APPROVAL', 'PENDING_RETRY', 'HELD', 'OWED'
              )
              AND p.paid_at IS NULL
         ) ledger ON TRUE
        WHERE ($1::text IS NULL OR r.operating_town = $1)
          AND ($2::text IS NULL OR r.verification_status = $2)
        ORDER BY r.created_at DESC
        LIMIT $3`,
      [z, st, lim]
    );
    rows = result.rows;
  } catch (err) {
    console.warn("[boda-fleet] listRiders enriched query fallback:", err.message);
    try {
      const result = await query(
        `SELECT r.*,
                d.status AS active_dispatch_status,
                d.order_ref AS active_order_ref,
                d.id AS active_dispatch_id
           FROM riders r
           LEFT JOIN LATERAL (
             SELECT dd.status, dd.order_ref, dd.id
               FROM delivery_dispatches dd
              WHERE dd.rider_id = r.id
                AND dd.status IN ('ACCEPTED', 'PICKED_UP', 'OTP_SENT', 'OTP_LOCKED')
              ORDER BY dd.id DESC
              LIMIT 1
           ) d ON TRUE
          WHERE ($1::text IS NULL OR r.operating_town = $1)
            AND ($2::text IS NULL OR r.verification_status = $2)
          ORDER BY r.created_at DESC
          LIMIT $3`,
        [z, st, lim]
      );
      rows = result.rows;
    } catch (err2) {
      console.warn("[boda-fleet] listRiders basic fallback:", err2.message);
      const result = await query(
        `SELECT * FROM riders
          WHERE ($1::text IS NULL OR operating_town = $1)
            AND ($2::text IS NULL OR verification_status = $2)
          ORDER BY created_at DESC
          LIMIT $3`,
        [z, st, lim]
      );
      rows = result.rows;
    }
  }
  return {
    ok: true,
    riders: rows.map((row) => {
      const rider = mapRider(row);
      const onDelivery = Boolean(row.active_dispatch_status);
      let fleetStatus = "OFFLINE";
      if (rider.verificationStatus === "SUSPENDED") fleetStatus = "SUSPENDED";
      else if (onDelivery) fleetStatus = "ON_DELIVERY";
      else if (rider.verificationStatus === "VERIFIED" && rider.isAvailable) fleetStatus = "AVAILABLE";
      else if (rider.verificationStatus === "PENDING") fleetStatus = "PENDING";
      else if (rider.verificationStatus === "VERIFIED") fleetStatus = "OFFLINE";
      const bikeLabel = [rider.licenseClass, rider.motorbikePlate].filter(Boolean).join(" · ") ||
        rider.motorbikePlate ||
        "Bike —";
      return {
        ...rider,
        bikeLabel,
        fleetStatus,
        completedTrips:
          row.completed_trips != null
            ? Number(row.completed_trips)
            : Number(rider.offersAccepted || 0),
        unpaidLedgerKes: Number(row.unpaid_ledger_kes || 0),
        activeDispatchStatus: row.active_dispatch_status || null,
        activeOrderRef: row.active_order_ref || null,
        activeDispatchId: row.active_dispatch_id != null ? Number(row.active_dispatch_id) : null,
      };
    }),
  };
}

/**
 * Manual bonus / fuel advance — CLEARED ledger row for B2C cycle (or accounting stub).
 */
export async function adminRiderBonusPayout({
  riderId,
  amountKes,
  reason = "admin_bonus",
  orderRef = null,
} = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured" };
  const id = Number(riderId);
  const amount = Math.round(Number(amountKes) || 0);
  if (!id || amount < 1) {
    return { error: "invalid", message: "riderId and amountKes (>= 1) required." };
  }
  const { rows } = await query(`SELECT * FROM riders WHERE id = $1`, [id]);
  if (!rows[0]) return { error: "not_found", message: "Rider not found." };
  await ensureRiderPayoutsTable();
  const ref = String(orderRef || `BONUS-${id}-${Date.now()}`).slice(0, 40);
  const { rows: inserted } = await query(
    `INSERT INTO rider_payouts (rider_id, order_ref, amount, gross_delivery_fee, net_amount_paid, status, payout_hold_reason)
     VALUES ($1, $2, $3, $3, $3, 'CLEARED', $4)
     RETURNING *`,
    [id, ref, amount, String(reason || "admin_bonus").slice(0, 200)]
  );
  return {
    ok: true,
    payout: inserted[0],
    rider: mapRider(rows[0]),
    message: `KES ${amount.toLocaleString()} bonus queued for ${rows[0].full_name || rows[0].phone}. Run B2C or mark paid in payouts.`,
  };
}

/**
 * Admin: force-bypass the 15-min no-show wait and start return trip.
 */
export async function adminOverrideNoShowTimer({ orderId, riderId = null, reason = "" } = {}) {
  const { executeReturnTrip } = await import("./boda-no-show.js");
  let phone = "";
  if (riderId && isDbEnabled()) {
    const { rows } = await query(`SELECT phone FROM riders WHERE id = $1`, [Number(riderId)]);
    phone = rows[0]?.phone || "";
  }
  const result = await executeReturnTrip({
    orderId,
    phone,
    force: true,
  });
  if (result?.error) return result;
  return {
    ok: true,
    ...result,
    message:
      result.message ||
      `No-show timer overridden for ${orderId}.${reason ? ` (${reason})` : ""}`,
  };
}

/**
 * Available = VERIFIED + online + zero active custody jobs.
 */
async function listAvailableRiders(zone) {
  const z = normalizeBodaZone(zone);
  if (!z) return [];
  try {
    await ensurePinColumns();
  } catch {
    /* ignore */
  }
  const { rows } = await query(
    `SELECT r.*
       FROM riders r
      WHERE r.operating_town = $1
        AND r.verification_status = 'VERIFIED'
        AND r.is_available = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM delivery_dispatches d
           WHERE d.rider_id = r.id
             AND d.status IN ('ACCEPTED', 'PICKED_UP', 'OTP_SENT')
        )
      ORDER BY r.rating DESC, r.id ASC
      LIMIT $2`,
    [z, Math.max(BROADCAST_LIMIT, 20)]
  );
  return rows.map(mapRider);
}

/**
 * Rank not-busy riders by radius tier + dispatch score (distance, rating, acceptance).
 */
async function rankRidersNearPickup(zone, pickupCoords) {
  const riders = await listAvailableRiders(zone);
  if (!riders.length) return [];

  const withDist = [];
  for (const r of riders) {
    let coords = parseCoordPair(r.lastLat, r.lastLng);
    if (!coords && r.stageLocation) {
      coords = await geocodeKenyaAddress(`${r.stageLocation}, ${r.operatingTown}, Kenya`);
    }
    const distanceM =
      pickupCoords && coords
        ? haversineMeters(coords.lat, coords.lng, pickupCoords.lat, pickupCoords.lng)
        : null;
    withDist.push({
      ...r,
      distanceM,
      acceptanceRate: r.acceptanceRate,
    });
  }

  if (!pickupCoords) {
    // No GPS — score by rating + acceptance only (unknown distance treated as Tier2 edge).
    return rankRidersByDispatchScore(withDist);
  }
  return rankRidersByDispatchScore(withDist);
}

function zoneFromOrder(order) {
  const blob = `${order?.deliveryCounty || ""} ${order?.deliveryTown || ""} ${order?.location || ""} ${order?.bodaZone || ""}`.toUpperCase();
  if (/\bTHIKA\b|\bJUJA\b|\bRUIRU\b|\bKIAMBU\b/.test(blob)) return "THIKA";
  return "NAIROBI";
}

async function ensurePinColumns() {
  await query(`
    ALTER TABLE delivery_dispatches
      ADD COLUMN IF NOT EXISTS pinned_rider_id INT,
      ADD COLUMN IF NOT EXISTS pin_offered_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS dispatch_source VARCHAR(40) DEFAULT 'platform',
      ADD COLUMN IF NOT EXISTS backup_pinged_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS offer_index INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS offer_expires_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS offer_queue INT[] DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS late_pickup_penalized BOOLEAN NOT NULL DEFAULT FALSE
  `);
  await query(`
    ALTER TABLE riders
      ADD COLUMN IF NOT EXISTS last_lat DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS last_lng DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS last_location_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS offers_sent INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS offers_accepted INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS acceptance_rate NUMERIC(5, 2) NOT NULL DEFAULT 70.00,
      ADD COLUMN IF NOT EXISTS rating_events JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
}

async function recordOfferSent(riderId) {
  await query(
    `UPDATE riders SET
       offers_sent = COALESCE(offers_sent, 0) + 1,
       acceptance_rate = CASE
         WHEN COALESCE(offers_sent, 0) + 1 <= 0 THEN acceptance_rate
         ELSE ROUND((COALESCE(offers_accepted, 0)::numeric * 100) / (COALESCE(offers_sent, 0) + 1), 2)
       END,
       updated_at = NOW()
     WHERE id = $1`,
    [riderId]
  );
}

async function recordOfferAccepted(riderId) {
  await query(
    `UPDATE riders SET
       offers_accepted = COALESCE(offers_accepted, 0) + 1,
       acceptance_rate = CASE
         WHEN COALESCE(offers_sent, 0) < 1 THEN 100
         ELSE ROUND(((COALESCE(offers_accepted, 0) + 1)::numeric * 100) / GREATEST(COALESCE(offers_sent, 0), 1), 2)
       END,
       updated_at = NOW()
     WHERE id = $1`,
    [riderId]
  );
}

export async function adjustRiderRating(riderId, delta, reason = "") {
  const id = Number(riderId);
  if (!Number.isInteger(id) || id < 1) return { ok: false };
  const { rows } = await query(`SELECT rating, rating_events FROM riders WHERE id = $1 LIMIT 1`, [id]);
  if (!rows[0]) return { ok: false };
  const next = clampRiderRating(Number(rows[0].rating || 5) + Number(delta));
  const events = Array.isArray(rows[0].rating_events) ? rows[0].rating_events : [];
  events.push({
    at: new Date().toISOString(),
    delta: Number(delta),
    reason: String(reason || "").slice(0, 120),
    ratingAfter: next,
  });
  await query(
    `UPDATE riders SET rating = $2, rating_events = $3::jsonb, updated_at = NOW() WHERE id = $1`,
    [id, next, JSON.stringify(events.slice(-40))]
  );
  return { ok: true, rating: next };
}

async function sendJobOfferToRider(rider, dispatchRow, { offerIndex = 0, queueLen = 1 } = {}) {
  const { sendText } = await import("./whatsapp.js");
  const id = dispatchRow.order_ref;
  const fee = Number(dispatchRow.delivery_fee_kes || 0);
  const distLabel =
    rider.distanceM != null ? `~${Math.round(rider.distanceM / 100) / 10} km away` : "nearby";
  const scoreLabel =
    rider.dispatchScore != null ? ` · score ${rider.dispatchScore}` : "";
  const pinMsg =
    `🛵 *Sokoni delivery offer (${offerIndex + 1}/${queueLen})*\n\n` +
    `Order *${id}*\n` +
    `You: ${distLabel}${scoreLabel} · ★ ${Number(rider.rating || 5).toFixed(1)}\n` +
    `Pickup: ${dispatchRow.pickup_address}\n` +
    `Drop-off: ${dispatchRow.delivery_address}\n` +
    (fee > 0 ? `Delivery fee: *KES ${fee.toLocaleString()}*\n` : "") +
    `\nReply *ACCEPT ${id}* within *45 seconds*.\n` +
    `Busy? Reply *DECLINE ${id}* — Sokoni will offer the next rider.`;
  await sendText(`${rider.phone}@c.us`, pinMsg);
  await recordOfferSent(rider.id);
}

/**
 * Platform-owned dispatch: Sokoni pins highest-scoring rider in radius.
 * Sellers do not choose riders.
 */
export async function createPlatformBodaDispatch({
  orderId,
  zone = null,
  pickupAddress = "",
  deliveryAddress = "",
  deliveryFeeKes = 0,
  sellerPhone = null,
  sellerHandle = null,
  dropoffLat = null,
  dropoffLng = null,
  pickupLat = null,
  pickupLng = null,
  source = "platform",
} = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Boda fleet needs Postgres." };
  }
  const id = normalizeOrderId(orderId);
  if (!id) return { error: "invalid_order_id", message: "Enter a valid SKN order id." };
  const order = getOrder(id);
  if (!order) return { error: "not_found", message: `Order ${id} not found.` };

  const paid =
    order.customerPaymentStatus === "confirmed" || order.paid || order.paymentStatus === "paid";
  if (!paid) return { error: "unpaid", message: "Buyer must pay into escrow first." };
  if (order.disputeHold || order.adminTakeOver) {
    return { error: "support_hold", message: "Order is with Sokoni support." };
  }

  try {
    const { resolveOrderFulfillment } = await import("./upcountry-shipments.js");
    const { FULFILLMENT_SELLER_COURIER } = await import("../lib/geo-zones.js");
    const mode = resolveOrderFulfillment(order);
    if (mode?.mode === FULFILLMENT_SELLER_COURIER || order.requiresRider === false) {
      return {
        error: "upcountry_courier",
        message: `*${id}* is outside local rider coverage — seller courier / WAYBILL flow.`,
      };
    }
  } catch (err) {
    console.warn("[boda-fleet] fulfillment check:", err.message);
  }

  const existing = await getOpenDispatchForOrder(id);
  if (existing) {
    return {
      ok: true,
      already: true,
      dispatch: existing,
      message: `Boda already open for *${id}* (${existing.status}).`,
    };
  }

  const town = normalizeBodaZone(zone) || zoneFromOrder(order);
  const pickup =
    String(pickupAddress || "").trim() ||
    String(order.sellerLocation || order.pickupAddress || "Seller pickup").slice(0, 240);
  const drop =
    String(deliveryAddress || "").trim() ||
    String(order.location || order.dropOff || order.customerLocation || "Buyer drop-off").slice(0, 240);
  const defaultFee = town === "THIKA" ? 250 : 350;
  const fee = Math.max(
    0,
    Number(deliveryFeeKes) > 0
      ? Number(deliveryFeeKes)
      : Number(order.shippingKes) > 0
        ? Number(order.shippingKes)
        : defaultFee
  );

  let dropCoords =
    parseCoordPair(dropoffLat, dropoffLng) ||
    parseCoordPair(order.buyerLat, order.buyerLng) ||
    parseCoordPair(order.dropoffLat ?? order.dropOffLat, order.dropoffLng ?? order.dropOffLng) ||
    null;
  if (!dropCoords) dropCoords = await geocodeKenyaAddress(drop);

  let pickupCoords = parseCoordPair(pickupLat, pickupLng);
  if (!pickupCoords) pickupCoords = await geocodeKenyaAddress(pickup);

  const ranked = await rankRidersNearPickup(town, pickupCoords || dropCoords);
  if (!ranked.length) {
    try {
      const { notifyAdminEvent } = await import("./communication-hub.js");
      await notifyAdminEvent("DISPUTE_OR_HELP", {
        orderId: id,
        details:
          `⚠️ *NO RIDERS IN RADIUS*\nOrder *${id}* zone ${town}.\n` +
          `No verified available riders within 7 km (or none online).`,
      });
    } catch {
      /* ignore */
    }
    return {
      error: "no_riders",
      message: `No verified available Sokoni riders within 7 km of pickup (${town}).`,
    };
  }

  try {
    await ensureOtpSafeguardColumns();
    await ensurePinColumns();
  } catch (err) {
    console.warn("[boda-fleet] pin columns:", err.message);
  }

  const primary = ranked[0];
  const riderIds = ranked.map((r) => r.id);
  const expires = new Date(Date.now() + OFFER_TIMEOUT_MS);

  const { rows } = await query(
    `INSERT INTO delivery_dispatches (
       order_ref, seller_phone, pickup_address, delivery_address,
       delivery_fee_kes, operating_town, status, custody_status, broadcast_rider_ids, meta,
       dropoff_lat, dropoff_lng, pinned_rider_id, pin_offered_at, dispatch_source,
       offer_index, offer_expires_at, offer_queue
     ) VALUES ($1,$2,$3,$4,$5,$6,'REQUESTED','UNASSIGNED',$7::int[], $8::jsonb, $9, $10, $11, NOW(), $12, 0, $13, $7::int[])
     RETURNING *`,
    [
      id,
      sellerPhone ? normalizeRiderPhone(sellerPhone) : null,
      pickup,
      drop,
      fee,
      town,
      riderIds,
      JSON.stringify({
        productName: order.productName || null,
        sellerHandle: sellerHandle || null,
        dropoffGeocoded: Boolean(dropCoords),
        pickupGeocoded: Boolean(pickupCoords),
        pinnedRiderName: primary.fullName,
        pinnedDistanceM: primary.distanceM,
        pinnedScore: primary.dispatchScore,
        pinnedTier: primary.tier,
        platformPin: true,
        rankedRiderIds: riderIds,
        rankedScores: ranked.map((r) => ({
          id: r.id,
          score: r.dispatchScore,
          tier: r.tier,
          distanceM: r.distanceM,
        })),
      }),
      dropCoords?.lat ?? null,
      dropCoords?.lng ?? null,
      primary.id,
      String(source || "platform").slice(0, 40),
      expires.toISOString(),
    ]
  );
  const dispatch = mapDispatch(rows[0]);

  try {
    await sendJobOfferToRider(primary, rows[0], { offerIndex: 0, queueLen: ranked.length });
  } catch (err) {
    console.warn("[boda-fleet] pin ping failed:", primary.phone, err.message);
  }

  // Sequential 45s escalate if still REQUESTED
  setTimeout(() => {
    advanceBodaOfferQueue(rows[0].id).catch((err) =>
      console.warn("[boda-fleet] offer advance:", err.message)
    );
  }, OFFER_TIMEOUT_MS);

  updateOrderMeta(id, {
    bodaDispatchId: dispatch.id,
    bodaZone: town,
    bodaStatus: "REQUESTED",
    bodaPinnedRiderId: primary.id,
    bodaPinnedRiderName: primary.fullName,
    deliveryMode: "sokoni_boda",
    fulfillmentMode: "LOCAL_RIDER",
    requiresRider: true,
  });

  if (sellerPhone || order.supplierId) {
    try {
      const { getSupplier } = await import("./suppliers.js");
      const { sellerNotifyTargets, dispatchMessages } = await import("./communication-hub.js");
      const sup = order.supplierId ? getSupplier(order.supplierId) : null;
      const phoneForNotify = sellerPhone || sup?.phone;
      if (phoneForNotify) {
        const targets = sellerNotifyTargets(phoneForNotify);
        const msg =
          `🛵 *Sokoni is assigning a rider for ${id}*\n\n` +
          `Prepare the parcel. A verified Sokoni rider will arrive.\n` +
          `Hand over *only* after they show the *Pickup OTP* (we will send it when they accept).\n` +
          `You do not choose or pin riders — Sokoni handles logistics.`;
        for (const to of targets.slice(0, 1)) {
          void dispatchMessages([{ to, message: msg }]);
        }
      }
    } catch (err) {
      console.warn("[boda-fleet] seller pin notify:", err.message);
    }
  }

  console.log(
    `[boda-fleet] PLATFORM PIN ${id} zone=${town} rider=#${primary.id} ${primary.fullName} ` +
      `tier=${primary.tier} score=${primary.dispatchScore} dist=${primary.distanceM ?? "—"}`
  );
  return {
    ok: true,
    dispatch,
    pinnedRider: {
      id: primary.id,
      fullName: primary.fullName,
      distanceM: primary.distanceM,
      rating: primary.rating,
      tier: primary.tier,
      dispatchScore: primary.dispatchScore,
    },
    ridersAvailable: ranked.length,
    message: `Sokoni pinned ${primary.fullName} for *${id}* (${primary.tier}, score ${primary.dispatchScore}).`,
  };
}

/**
 * After payment: auto-dispatch local-rider orders (Sokoni pins — sellers never choose).
 */
export async function autoDispatchBodaForOrder(orderId) {
  const id = normalizeOrderId(orderId);
  if (!id) return { skipped: true, reason: "invalid_order" };

  try {
    const { isDispatchPaused } = await import("./platform-flags.js");
    if (isDispatchPaused()) {
      console.warn("[boda-fleet] autoDispatch skipped — dispatchPaused (OVERRIDE: SYSTEM PAUSE)");
      return { skipped: true, reason: "dispatch_paused" };
    }
  } catch {
    /* ignore */
  }

  const order = getOrder(id);
  if (!order) return { skipped: true, reason: "not_found" };

  try {
    const { resolveOrderFulfillment } = await import("./upcountry-shipments.js");
    const { FULFILLMENT_LOCAL_RIDER } = await import("../lib/geo-zones.js");
    const mode = resolveOrderFulfillment(order);
    const local =
      mode?.mode === FULFILLMENT_LOCAL_RIDER ||
      order.fulfillmentMode === FULFILLMENT_LOCAL_RIDER ||
      order.requiresRider === true;
    if (!local) {
      return { skipped: true, reason: "not_local_rider", mode: mode?.mode || order.fulfillmentMode };
    }
  } catch (err) {
    console.warn("[boda-fleet] autoDispatch mode:", err.message);
  }

  const { getSupplier } = await import("./suppliers.js");
  const sup = order.supplierId ? getSupplier(order.supplierId) : null;
  return createPlatformBodaDispatch({
    orderId: id,
    zone: zoneFromOrder(order),
    pickupAddress: sup?.location || order.sellerLocation || "",
    deliveryAddress: order.location || order.dropOff || "",
    deliveryFeeKes: order.shippingKes || 0,
    sellerPhone: sup?.phone || null,
    sellerHandle: sup?.shopHandle || null,
    dropoffLat: order.buyerLat,
    dropoffLng: order.buyerLng,
    source: "platform_paid",
  });
}

/**
 * Sequential 45s offer loop: move to next scored rider if current pin timed out / declined.
 */
export async function advanceBodaOfferQueue(dispatchId, { reason = "timeout" } = {}) {
  if (!isDbEnabled()) return { skipped: true };
  const id = Number(dispatchId);
  if (!Number.isInteger(id) || id < 1) return { skipped: true };

  try {
    await ensurePinColumns();
  } catch {
    /* ignore */
  }

  const { rows } = await query(
    `SELECT * FROM delivery_dispatches WHERE id = $1 AND status = 'REQUESTED' LIMIT 1`,
    [id]
  );
  const d = rows[0];
  if (!d) return { skipped: true, reason: "not_open" };

  const queue = (
    Array.isArray(d.offer_queue) && d.offer_queue.length
      ? d.offer_queue
      : Array.isArray(d.broadcast_rider_ids)
        ? d.broadcast_rider_ids
        : Array.isArray(d.meta?.rankedRiderIds)
          ? d.meta.rankedRiderIds
          : []
  )
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);

  let nextIndex = Number(d.offer_index || 0) + 1;
  let nextRider = null;

  while (nextIndex < queue.length) {
    const candidateId = queue[nextIndex];
    const { rows: rrows } = await query(
      `SELECT r.*
         FROM riders r
        WHERE r.id = $1
          AND r.verification_status = 'VERIFIED'
          AND r.is_available = TRUE
          AND NOT EXISTS (
            SELECT 1 FROM delivery_dispatches x
             WHERE x.rider_id = r.id
               AND x.status IN ('ACCEPTED', 'PICKED_UP', 'OTP_SENT')
          )
        LIMIT 1`,
      [candidateId]
    );
    if (rrows[0]) {
      nextRider = mapRider(rrows[0]);
      // Attach score meta from dispatch if present
      const scored = (d.meta?.rankedScores || []).find((s) => Number(s.id) === candidateId);
      if (scored) {
        nextRider.distanceM = scored.distanceM ?? null;
        nextRider.dispatchScore = scored.score ?? null;
        nextRider.tier = scored.tier || null;
      }
      break;
    }
    nextIndex += 1;
  }

  if (!nextRider) {
    await query(
      `UPDATE delivery_dispatches SET backup_pinged_at = NOW(), offer_expires_at = NULL, updated_at = NOW() WHERE id = $1`,
      [id]
    );
    try {
      const { notifyAdminEvent } = await import("./communication-hub.js");
      await notifyAdminEvent("DISPUTE_OR_HELP", {
        orderId: d.order_ref,
        details:
          `⚠️ *DISPATCH QUEUE EXHAUSTED*\nOrder *${d.order_ref}* — no rider accepted (${reason}).\n` +
          `Ops: rebroadcast or assign manually.`,
      });
    } catch {
      /* ignore */
    }
    console.warn(`[boda-fleet] offer queue exhausted for ${d.order_ref} (${reason})`);
    return { ok: true, exhausted: true, pinged: 0 };
  }

  const expires = new Date(Date.now() + OFFER_TIMEOUT_MS);
  await query(
    `UPDATE delivery_dispatches SET
       pinned_rider_id = $2,
       pin_offered_at = NOW(),
       offer_index = $3,
       offer_expires_at = $4,
       offer_queue = $5::int[],
       meta = COALESCE(meta, '{}'::jsonb) || $6::jsonb,
       updated_at = NOW()
     WHERE id = $1 AND status = 'REQUESTED'`,
    [
      id,
      nextRider.id,
      nextIndex,
      expires.toISOString(),
      queue,
      JSON.stringify({
        pinnedRiderName: nextRider.fullName,
        pinnedDistanceM: nextRider.distanceM ?? null,
        pinnedScore: nextRider.dispatchScore ?? null,
        pinnedTier: nextRider.tier || null,
        lastOfferAdvance: reason,
      }),
    ]
  );

  try {
    await sendJobOfferToRider(nextRider, d, { offerIndex: nextIndex, queueLen: queue.length });
  } catch (err) {
    console.warn("[boda-fleet] next offer ping:", nextRider.phone, err.message);
  }

  setTimeout(() => {
    advanceBodaOfferQueue(id).catch((err) =>
      console.warn("[boda-fleet] offer advance:", err.message)
    );
  }, OFFER_TIMEOUT_MS);

  updateOrderMeta(d.order_ref, {
    bodaPinnedRiderId: nextRider.id,
    bodaPinnedRiderName: nextRider.fullName,
    bodaStatus: "REQUESTED",
  });

  console.log(
    `[boda-fleet] OFFER ADVANCE ${d.order_ref} → rider=#${nextRider.id} idx=${nextIndex} (${reason})`
  );
  return { ok: true, pinged: 1, riderId: nextRider.id, offerIndex: nextIndex };
}

/** @deprecated Prefer advanceBodaOfferQueue — kept for older call sites. */
export async function escalateBodaPinBackups(dispatchId) {
  return advanceBodaOfferQueue(dispatchId, { reason: "escalate_alias" });
}

/** Cron: advance any REQUESTED offers whose 45s window expired. */
export async function processBodaOfferTimeouts({ limit = 25 } = {}) {
  if (!isDbEnabled()) return { processed: 0 };
  try {
    await ensurePinColumns();
  } catch {
    return { processed: 0 };
  }
  const { rows } = await query(
    `SELECT id FROM delivery_dispatches
      WHERE status = 'REQUESTED'
        AND offer_expires_at IS NOT NULL
        AND offer_expires_at < NOW()
      ORDER BY offer_expires_at ASC
      LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 25, 1), 80)]
  );
  let processed = 0;
  for (const row of rows) {
    try {
      await advanceBodaOfferQueue(row.id, { reason: "timeout" });
      processed += 1;
    } catch (err) {
      console.warn("[boda-fleet] offer timeout tick:", err.message);
    }
  }
  return { processed };
}

/**
 * Late pickup SLA: ACCEPTED > 10 min without Pickup OTP → −0.2 stars,
 * unassign rider, reset to UNASSIGNED, re-offer next ranked riders.
 */
export async function applyLatePickupPenalties({ limit = 40 } = {}) {
  if (!isDbEnabled()) return { penalized: 0, reopened: 0 };
  try {
    await ensurePinColumns();
  } catch {
    return { penalized: 0, reopened: 0 };
  }

  const { rows } = await query(
    `SELECT id
       FROM delivery_dispatches
      WHERE status = 'ACCEPTED'
        AND rider_id IS NOT NULL
        AND COALESCE(late_pickup_penalized, FALSE) = FALSE
        AND accepted_at IS NOT NULL
        AND accepted_at < NOW() - ($1::int * INTERVAL '1 minute')
        AND picked_up_at IS NULL
      ORDER BY accepted_at ASC
      LIMIT $2`,
    [LATE_PICKUP_MINUTES, Math.min(Math.max(Number(limit) || 40, 1), 100)]
  );

  let penalized = 0;
  let reopened = 0;
  const { sendText } = await import("./whatsapp.js");

  for (const stub of rows) {
    try {
      const expired = await withTransaction(async (client) => {
        const { rows: locked } = await client.query(
          `SELECT * FROM delivery_dispatches WHERE id = $1 FOR UPDATE`,
          [stub.id]
        );
        const row = locked[0];
        if (
          !row ||
          row.status !== "ACCEPTED" ||
          !row.rider_id ||
          row.picked_up_at ||
          row.late_pickup_penalized
        ) {
          return null;
        }

        const riderId = Number(row.rider_id);
        const queue = (
          Array.isArray(row.offer_queue) && row.offer_queue.length
            ? row.offer_queue
            : Array.isArray(row.broadcast_rider_ids)
              ? row.broadcast_rider_ids
              : []
        )
          .map(Number)
          .filter((n) => n && n !== riderId);

        const expires = new Date(Date.now() + OFFER_TIMEOUT_MS);
        await client.query(
          `UPDATE delivery_dispatches SET
             rider_id = NULL,
             status = 'REQUESTED',
             accepted_at = NULL,
             custody_status = 'UNASSIGNED',
             pickup_otp_hash = NULL,
             pickup_otp_sent_at = NULL,
             pinned_rider_id = NULL,
             offer_index = -1,
             offer_expires_at = $2,
             offer_queue = $3::int[],
             broadcast_rider_ids = $3::int[],
             late_pickup_penalized = TRUE,
             updated_at = NOW(),
             meta = COALESCE(meta, '{}'::jsonb) || $4::jsonb
           WHERE id = $1`,
          [
            row.id,
            expires.toISOString(),
            queue,
            JSON.stringify({
              latePickupExpiredAt: new Date().toISOString(),
              latePickupRiderId: riderId,
              latePickupMinutes: LATE_PICKUP_MINUTES,
            }),
          ]
        );
        await client.query(
          `UPDATE riders SET is_available = TRUE, updated_at = NOW() WHERE id = $1`,
          [riderId]
        );
        return { row, riderId, orderRef: row.order_ref };
      });

      if (!expired) continue;

      await adjustRiderRating(
        expired.riderId,
        -LATE_PICKUP_PENALTY,
        `late_pickup_expire:${expired.orderRef}`
      );
      penalized += 1;

      updateOrderMeta(expired.orderRef, {
        bodaStatus: "REQUESTED",
        bodaRiderId: null,
        riderName: null,
        riderPhone: null,
      });

      try {
        const { rows: rrows } = await query(`SELECT phone, full_name FROM riders WHERE id = $1`, [
          expired.riderId,
        ]);
        const phone = rrows[0]?.phone;
        if (phone) {
          await sendText(
            `${phone}@c.us`,
            `⏱️ *Pickup timed out* for *${expired.orderRef}*\n` +
              `You did not enter the seller Pickup OTP within ${LATE_PICKUP_MINUTES} minutes.\n` +
              `Job released (−${LATE_PICKUP_PENALTY} ★). Stay AVAILABLE for the next offer.`
          );
        }
      } catch (err) {
        console.warn("[boda-fleet] late pickup notify:", err.message);
      }

      await advanceBodaOfferQueue(expired.row.id, { reason: "late_pickup_expire" });
      reopened += 1;
    } catch (err) {
      console.warn("[boda-fleet] late pickup expire:", err.message);
    }
  }
  return { penalized, reopened };
}

/**
 * Blend buyer 1–5 stars into the assigned rider's dynamic quality score.
 */
export async function applyBuyerRiderRating(orderId, stars) {
  const id = normalizeOrderId(orderId);
  const rating = Number(stars);
  if (!id || !Number.isFinite(rating) || rating < 1 || rating > 5) {
    return { ok: false };
  }
  if (!isDbEnabled()) return { ok: false, skipped: true };

  const order = getOrder(id);
  let riderId = order?.bodaRiderId != null ? Number(order.bodaRiderId) : null;
  if (!riderId) {
    const { rows } = await query(
      `SELECT rider_id FROM delivery_dispatches
        WHERE UPPER(order_ref) = UPPER($1) AND rider_id IS NOT NULL
        ORDER BY id DESC LIMIT 1`,
      [id]
    );
    riderId = rows[0]?.rider_id != null ? Number(rows[0].rider_id) : null;
  }
  if (!riderId) return { ok: false, reason: "no_rider" };

  const { rows: rrows } = await query(`SELECT rating FROM riders WHERE id = $1 LIMIT 1`, [riderId]);
  if (!rrows[0]) return { ok: false };
  try {
    const { applyRiderStarReview } = await import("./rating-engine.js");
    const result = await applyRiderStarReview({
      riderId,
      stars: rating,
      orderRef: id,
      reason: `buyer_stars:${id}`,
      actorLabel: "buyer",
    });
    if (result?.ok) {
      return { ok: true, riderId, rating: result.rating, stars: rating };
    }
  } catch (err) {
    console.warn("[boda] weighted rider rating failed:", err.message);
  }
  // Legacy EMA fallback if rating_count column missing
  const prev = Number(rrows[0].rating || 5);
  const next = clampRiderRating(prev * 0.7 + rating * 0.3);
  const delta = Math.round((next - prev) * 10) / 10;
  await adjustRiderRating(riderId, delta, `buyer_stars:${id}:${rating}`);
  return { ok: true, riderId, rating: next, stars: rating };
}

/**
 * Seller Hub: sellers cannot pin riders — Sokoni assigns automatically.
 * Returns current dispatch status so the UI can show progress.
 */
export async function requestBodaDispatch({
  orderId,
  phone,
  sessionToken,
  zone = "NAIROBI",
  pickupAddress = "",
  deliveryAddress = "",
  deliveryFeeKes = 0,
  dropoffLat = null,
  dropoffLng = null,
  adminForce = false,
} = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Boda fleet needs Postgres." };
  }

  // Admin / internal force path (ops only)
  if (adminForce) {
    return createPlatformBodaDispatch({
      orderId,
      zone,
      pickupAddress,
      deliveryAddress,
      deliveryFeeKes,
      dropoffLat,
      dropoffLng,
      sellerPhone: phone,
      source: "admin_force",
    });
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

  const open = await getOpenDispatchForOrder(id);
  if (open) {
    return {
      ok: true,
      already: true,
      platformAssigns: true,
      dispatch: open,
      message:
        open.status === "REQUESTED"
          ? `Sokoni already offered *${id}* to a verified rider. Prepare the parcel — wait for Pickup OTP.`
          : `Rider assigned for *${id}* (${open.status}). Hand over only after Pickup OTP.`,
    };
  }

  // Soft nudge: if paid + local and somehow missed auto-dispatch, platform creates it
  // (still Sokoni-controlled — seller cannot choose who gets pinned).
  const paid =
    order.customerPaymentStatus === "confirmed" || order.paid || order.paymentStatus === "paid";
  if (paid) {
    const result = await createPlatformBodaDispatch({
      orderId: id,
      zone: zoneFromOrder(order) || zone,
      pickupAddress:
        pickupAddress || check.supplier?.location || check.supplier?.shopName || "",
      deliveryAddress: deliveryAddress || order.location || "",
      deliveryFeeKes: deliveryFeeKes || order.shippingKes || 0,
      sellerPhone: check.supplier?.phone || phone,
      sellerHandle: check.supplier?.shopHandle || null,
      dropoffLat: dropoffLat ?? order.buyerLat,
      dropoffLng: dropoffLng ?? order.buyerLng,
      source: "platform_seller_nudge",
    });
    if (result.ok) {
      return {
        ...result,
        platformAssigns: true,
        message:
          `Sokoni is assigning a rider for *${id}* — you cannot pick riders.\n` +
          `Prepare the parcel. Hand over only after the Pickup OTP arrives.`,
      };
    }
    if (result.error === "upcountry_courier" || result.error === "no_riders") {
      return result;
    }
  }

  return {
    error: "platform_assigns_riders",
    platformAssigns: true,
    message:
      `Sokoni assigns verified riders automatically after payment.\n` +
      `Prepare *${id}* and wait — you will get a Pickup OTP when the rider is confirmed.\n` +
      `Sellers cannot pin or choose riders.`,
  };
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
 * Rider WhatsApp: ACCEPT SKN-####
 * Atomic claim via BEGIN + SELECT … FOR UPDATE so only one concurrent accept wins.
 */
export async function acceptBodaDispatch({ orderId, phone, customerKey = "" } = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured", message: "Database offline." };
  const id = normalizeOrderId(orderId);
  const riderPhone = normalizeRiderPhone(phone) || normalizeRiderPhone(customerKey);
  if (!id || !riderPhone) {
    return { error: "invalid", message: "Reply like: ACCEPT SKN-1234" };
  }

  const takenMsg =
    `⚡ *Too late!* Another rider just accepted this delivery. Stay online for the next job!`;

  try {
    await ensureOtpSafeguardColumns();
    await ensurePinColumns();
  } catch (err) {
    console.warn("[boda-fleet] pickup columns on accept:", err.message);
  }

  let claim;
  try {
    claim = await withTransaction(async (client) => {
      const { rows: riderRows } = await client.query(
        `SELECT * FROM riders WHERE phone = $1 LIMIT 1 FOR UPDATE`,
        [riderPhone]
      );
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

      const { rows: busy } = await client.query(
        `SELECT 1 FROM delivery_dispatches
          WHERE rider_id = $1 AND status IN ('ACCEPTED', 'PICKED_UP', 'OTP_SENT')
          LIMIT 1`,
        [rider.id]
      );
      if (busy[0]) {
        return {
          error: "busy",
          message: "You already have an active delivery. Finish it before accepting another.",
        };
      }

      // Lock the latest dispatch row for this order — concurrent accepts serialize here.
      const { rows: dispRows } = await client.query(
        `SELECT * FROM delivery_dispatches
          WHERE UPPER(order_ref) = UPPER($1)
          ORDER BY id DESC
          LIMIT 1
          FOR UPDATE`,
        [id]
      );
      const row = dispRows[0];
      if (!row) {
        return { error: "not_found", message: `No open boda request for *${id}*.` };
      }

      const custody = String(row.custody_status || "UNASSIGNED").toUpperCase();
      const alreadyClaimed =
        row.status !== "REQUESTED" ||
        row.rider_id != null ||
        (custody !== "UNASSIGNED" && custody !== "");
      if (alreadyClaimed) {
        return { error: "taken", message: takenMsg };
      }

      if (row.operating_town && row.operating_town !== rider.operatingTown) {
        return {
          error: "wrong_zone",
          message: `This job is ${row.operating_town}. Your zone is ${rider.operatingTown}. Reply *SET ZONE ${row.operating_town}* if you relocated.`,
        };
      }

      const pinnedId = row.pinned_rider_id != null ? Number(row.pinned_rider_id) : null;
      if (pinnedId && pinnedId !== rider.id) {
        return {
          error: "not_your_offer",
          message:
            `*${id}* is currently offered to another rider. Sokoni will ping you if they decline or time out.`,
        };
      }

      const pickupOtp = String(randomInt(1000, 9999));
      const { rows: updated } = await client.query(
        `UPDATE delivery_dispatches SET
           rider_id = $2,
           status = 'ACCEPTED',
           accepted_at = NOW(),
           custody_status = 'ASSIGNED',
           pickup_otp_hash = $3,
           pickup_otp_sent_at = NOW(),
           offer_expires_at = NULL,
           updated_at = NOW()
         WHERE id = $1
           AND status = 'REQUESTED'
           AND rider_id IS NULL
           AND (custody_status IS NULL OR custody_status = 'UNASSIGNED')
         RETURNING *`,
        [row.id, rider.id, hashOtp(pickupOtp)]
      );
      if (!updated[0]) {
        return { error: "taken", message: takenMsg };
      }

      await client.query(
        `UPDATE riders SET
           is_available = FALSE,
           offers_accepted = COALESCE(offers_accepted, 0) + 1,
           acceptance_rate = CASE
             WHEN COALESCE(offers_sent, 0) < 1 THEN 100
             ELSE ROUND(((COALESCE(offers_accepted, 0) + 1)::numeric * 100) / GREATEST(COALESCE(offers_sent, 0), 1), 2)
           END,
           updated_at = NOW()
         WHERE id = $1`,
        [rider.id]
      );

      return { ok: true, rider, updated: updated[0], pickupOtp };
    });
  } catch (err) {
    console.error("[boda-fleet] atomic accept failed:", err.message);
    return { error: "system", message: "System error processing job acceptance. Try again." };
  }

  if (!claim?.ok) {
    return {
      error: claim?.error || "taken",
      message: claim?.message || takenMsg,
    };
  }

  const { rider, updated, pickupOtp } = claim;

  const order = getOrder(id);
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
    bodaDispatchId: Number(updated.id),
    bodaStatus: "ACCEPTED",
    bodaRiderId: rider.id,
    bodaCustody: "ASSIGNED",
    deliveryMode: "sokoni_boda",
  });

  try {
    const { writeAuditLog } = await import("./audit-log.js");
    await writeAuditLog({
      orderRef: id,
      dispatchId: updated.id,
      riderId: rider.id,
      actorPhone: rider.phone,
      actorRole: "RIDER",
      action: "ACCEPT_JOB",
      fromStatus: "REQUESTED",
      toStatus: "ACCEPTED",
      fromCustody: "UNASSIGNED",
      toCustody: "ASSIGNED",
      source: "boda.acceptBodaDispatch",
    });
  } catch {
    /* ignore */
  }

  const fresh = getOrder(id) || order;
  const { sendText } = await import("./whatsapp.js");
  const plate = rider.motorbikePlate || "—";
  const sellerMsg =
    `✅ *Boda assigned — ${id}*\n` +
    `Rider: *${rider.fullName}*\n` +
    `Phone: ${rider.phone}\n` +
    `Plate: ${plate}\n` +
    `Have the parcel ready at: ${updated.pickup_address}\n\n` +
    `📦 *PICKUP OTP (give to rider at handoff only):* *${pickupOtp}*\n` +
    `Do not share this code on chat — speak it when the rider is at your door.`;
  const buyerMsg =
    `🛵 Your order *${id}* is on the way with a Sokoni vetted rider.\n` +
    `• Rider: *${rider.fullName}*\n` +
    `• Phone: ${rider.phone}\n` +
    `• Plate: ${plate}\n` +
    `When it arrives, you'll get a 4-digit code — share it only with this rider to confirm delivery.`;
  const riderMsg =
    `🎉 *JOB CONFIRMED!* You have been assigned to Order *${id}*. Proceed to pickup.\n\n` +
    `Pickup: ${updated.pickup_address}\n` +
    `Drop-off: ${updated.delivery_address}\n` +
    (Number(updated.delivery_fee_kes) > 0
      ? `Fee (held): KES ${Number(updated.delivery_fee_kes).toLocaleString()}\n`
      : "") +
    `\n⏱ Enter the seller *Pickup OTP* within *${LATE_PICKUP_MINUTES} minutes* or the job is released.\n` +
    `At the shop reply: *PICKUP ${id} ####*\n` +
    `That transfers custody to you. Buyer then gets a delivery code.\n` +
    `At the door: share live location → *CONFIRM ${id} ####*`;

  const sellerTo = updated.seller_phone
    ? `${normalizeRiderPhone(updated.seller_phone)}@c.us`
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

  const offerIdx = Number(updated.offer_index || 0);
  const queueIds = (
    Array.isArray(updated.offer_queue) && updated.offer_queue.length
      ? updated.offer_queue
      : Array.isArray(updated.broadcast_rider_ids)
        ? updated.broadcast_rider_ids
        : []
  )
    .map(Number)
    .filter(Boolean);
  const alreadyOffered = queueIds.slice(0, offerIdx + 1);
  for (const otherId of alreadyOffered) {
    if (otherId === rider.id) continue;
    try {
      const { rows: others } = await query(`SELECT phone FROM riders WHERE id = $1 LIMIT 1`, [otherId]);
      const otherPhone = others[0]?.phone;
      if (!otherPhone) continue;
      await sendText(`${otherPhone}@c.us`, takenMsg);
    } catch (err) {
      console.warn("[boda-fleet] loser notify skipped:", err.message);
    }
  }

  return {
    ok: true,
    dispatch: mapDispatch(updated),
    rider,
    message: riderMsg,
  };
}

/**
 * Rider WhatsApp: DECLINE SKN-#### — skip this offer; engine pings next ranked rider.
 */
export async function declineBodaDispatch({ orderId, phone, customerKey = "" } = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured", message: "Database offline." };
  const id = normalizeOrderId(orderId);
  const riderPhone = normalizeRiderPhone(phone) || normalizeRiderPhone(customerKey);
  if (!id || !riderPhone) {
    return { error: "invalid", message: "Reply like: DECLINE SKN-1234" };
  }

  const { rows: riderRows } = await query(`SELECT * FROM riders WHERE phone = $1 LIMIT 1`, [riderPhone]);
  const rider = mapRider(riderRows[0]);
  if (!rider) {
    return { error: "not_a_rider", message: "This WhatsApp is not a registered Sokoni boda rider." };
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
    return { error: "not_found", message: `No open offer for *${id}*.` };
  }
  const pinnedId = row.pinned_rider_id != null ? Number(row.pinned_rider_id) : null;
  if (pinnedId && pinnedId !== rider.id) {
    return {
      error: "not_your_offer",
      message: `*${id}* is not currently offered to you.`,
    };
  }

  await advanceBodaOfferQueue(row.id, { reason: "declined" });
  return {
    ok: true,
    message: `Declined *${id}*. Sokoni is offering the next rider. Reply *AVAILABLE* to stay in the pool.`,
  };
}

/**
 * Rider: CANCEL JOB SKN-#### after ACCEPT — −0.5 stars, re-offer to next riders.
 */
export async function cancelAcceptedBodaJob({ orderId, phone, customerKey = "" } = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured", message: "Database offline." };
  const id = normalizeOrderId(orderId);
  const riderPhone = normalizeRiderPhone(phone) || normalizeRiderPhone(customerKey);
  if (!id || !riderPhone) {
    return { error: "invalid", message: "Reply like: CANCEL JOB SKN-1234" };
  }

  const { rows: riderRows } = await query(`SELECT * FROM riders WHERE phone = $1 LIMIT 1`, [riderPhone]);
  const rider = mapRider(riderRows[0]);
  if (!rider) {
    return { error: "not_a_rider", message: "This WhatsApp is not a registered Sokoni boda rider." };
  }

  const { rows: dispRows } = await query(
    `SELECT * FROM delivery_dispatches
      WHERE UPPER(order_ref) = UPPER($1)
        AND rider_id = $2
        AND status = 'ACCEPTED'
      ORDER BY id DESC
      LIMIT 1`,
    [id, rider.id]
  );
  const row = dispRows[0];
  if (!row) {
    return {
      error: "not_found",
      message: `No accepted job *${id}* to cancel (pickup already done cannot be dropped this way).`,
    };
  }

  await adjustRiderRating(rider.id, -CANCEL_JOB_PENALTY, `cancel_job:${id}`);

  const queue = (
    Array.isArray(row.offer_queue) && row.offer_queue.length
      ? row.offer_queue
      : Array.isArray(row.broadcast_rider_ids)
        ? row.broadcast_rider_ids
        : []
  )
    .map(Number)
    .filter((n) => n && n !== rider.id);

  const expires = new Date(Date.now() + OFFER_TIMEOUT_MS);
  await query(
    `UPDATE delivery_dispatches SET
       rider_id = NULL,
       status = 'REQUESTED',
       accepted_at = NULL,
       custody_status = 'UNASSIGNED',
       pickup_otp_hash = NULL,
       pickup_otp_sent_at = NULL,
       pinned_rider_id = NULL,
       offer_index = -1,
       offer_expires_at = $2,
       offer_queue = $3::int[],
       broadcast_rider_ids = $3::int[],
       updated_at = NOW(),
       meta = COALESCE(meta, '{}'::jsonb) || $4::jsonb
     WHERE id = $1`,
    [
      row.id,
      expires.toISOString(),
      queue,
      JSON.stringify({ lastCancelByRiderId: rider.id, lastCancelAt: new Date().toISOString() }),
    ]
  );

  await query(`UPDATE riders SET is_available = TRUE, updated_at = NOW() WHERE id = $1`, [rider.id]);

  updateOrderMeta(id, {
    bodaStatus: "REQUESTED",
    bodaRiderId: null,
    riderName: null,
    riderPhone: null,
  });

  await advanceBodaOfferQueue(row.id, { reason: "rider_cancel" });

  return {
    ok: true,
    message:
      `Job *${id}* cancelled. Rating −${CANCEL_JOB_PENALTY} (accept-then-cancel).\n` +
      `Sokoni is offering the next rider. Stay AVAILABLE for future jobs.`,
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

/**
 * Rider: PICKUP SKN-#### #### — verify seller pickup OTP, transfer custody, send buyer delivery OTP.
 */
export async function confirmPickupWithOtp({
  orderId,
  code = "",
  phone,
  customerKey = "",
} = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured" };
  const id = normalizeOrderId(orderId);
  const riderPhone = normalizeRiderPhone(phone) || normalizeRiderPhone(customerKey);
  const otp = String(code || "").replace(/\D/g, "").slice(0, 4);
  if (!id || !riderPhone) {
    return { error: "invalid", message: "Reply like: PICKUP SKN-1234 4821" };
  }
  if (otp.length !== 4) {
    return { error: "invalid_otp", message: "Enter the seller's 4-digit Pickup OTP." };
  }

  try {
    await ensureOtpSafeguardColumns();
  } catch (err) {
    console.warn("[boda-fleet] pickup columns:", err.message);
  }

  const { rows: found } = await query(
    `SELECT d.*, r.phone AS rider_phone, r.full_name AS rider_name
       FROM delivery_dispatches d
       JOIN riders r ON r.id = d.rider_id
      WHERE UPPER(d.order_ref) = UPPER($1)
        AND r.phone = $2
        AND d.status IN ('ACCEPTED', 'PICKED_UP')
      ORDER BY d.id DESC
      LIMIT 1`,
    [id, riderPhone]
  );
  const dispatch = found[0];
  if (!dispatch) {
    return { error: "not_found", message: `No accepted job *${id}* for you.` };
  }

  if (dispatch.custody_status === "IN_TRANSIT" || dispatch.status === "OTP_SENT") {
    return {
      error: "already_picked",
      message: `⚠️ Order *${id}* is already in transit. Proceed to the buyer — use *CONFIRM ${id} ####* with their delivery code.`,
    };
  }

  if (!dispatch.pickup_otp_hash) {
    // Legacy jobs before pickup OTP — fall through to delivery OTP path.
    return markBodaPickedUp({ orderId: id, phone: riderPhone, customerKey, legacySkipPickupOtp: true });
  }

  if (hashOtp(otp) !== dispatch.pickup_otp_hash) {
    return {
      error: "bad_pickup_otp",
      message: `❌ Invalid Pickup OTP. Ask the seller for the correct 4-digit code (spoken at handoff).`,
    };
  }

  const deliveryOtp = String(randomInt(1000, 9999));
  const { rows } = await query(
    `UPDATE delivery_dispatches SET
       status = 'OTP_SENT',
       custody_status = 'IN_TRANSIT',
       picked_up_at = COALESCE(picked_up_at, NOW()),
       pickup_otp_hash = NULL,
       delivery_otp_hash = $2,
       delivery_otp_sent_at = NOW(),
       otp_failed_attempts = 0,
       otp_locked_at = NULL,
       updated_at = NOW(),
       meta = COALESCE(meta, '{}'::jsonb) || $3::jsonb
     WHERE id = $1
     RETURNING *`,
    [
      dispatch.id,
      hashOtp(deliveryOtp),
      JSON.stringify({
        custodyTransferredAt: new Date().toISOString(),
        pickupVerified: true,
      }),
    ]
  );

  const order = getOrder(id);
  const { sendText } = await import("./whatsapp.js");
  const feeKes = Number(rows[0].delivery_fee_kes || 0);

  updateOrderMeta(id, { bodaStatus: "OTP_SENT", bodaCustody: "IN_TRANSIT" });
  try {
    const { writeAuditLog } = await import("./audit-log.js");
    await writeAuditLog({
      orderRef: id,
      dispatchId: rows[0].id,
      riderId: rows[0].rider_id,
      actorPhone: riderPhone,
      actorRole: "RIDER",
      action: "VENDOR_PICKUP_OTP_SUCCESS",
      fromStatus: dispatch.status,
      toStatus: "OTP_SENT",
      fromCustody: "ASSIGNED",
      toCustody: "IN_TRANSIT",
      source: "boda.confirmPickupWithOtp",
    });
  } catch {
    /* ignore */
  }

  if (order?.customerKey) {
    try {
      await sendText(
        order.customerKey,
        `🔐 *SOKONI DELIVERY CONFIRMATION CODE*\n\n` +
          `Your Order *${id}* is currently on its way.\n` +
          `• *Delivery Confirmation Code:* *${deliveryOtp}*\n\n` +
          `⚠️ Give this 4-digit code to the rider ONLY after you have received and verified your package.\n` +
          `Or reply *YES ${id}* / *CODE ${deliveryOtp}* once you have the item.`
      );
    } catch (err) {
      console.warn("[boda-fleet] delivery OTP after pickup:", err.message);
    }
  }

  const sellerTo = rows[0].seller_phone
    ? `${normalizeRiderPhone(rows[0].seller_phone)}@c.us`
    : null;
  if (sellerTo) {
    try {
      await sendText(
        sellerTo,
        `✅ Pickup verified for *${id}*. Custody is with rider *${dispatch.rider_name || "assigned"}*. Parcel is in transit.`
      );
    } catch (err) {
      console.warn("[boda-fleet] seller pickup ack:", err.message);
    }
  }

  updateOrderMeta(id, {
    bodaStatus: "OTP_SENT",
    bodaCustody: "IN_TRANSIT",
    bodaPickedUpAt: Date.now(),
  });

  const cleanRiderMsg =
    `✅ *PICKUP CONFIRMED!* You now have custody of *${id}*.\n` +
    `Buyer has their delivery code.\n` +
    `At drop-off: 1) share *live WhatsApp location*, then 2) *CONFIRM ${id} ####*\n` +
    `(3 wrong tries locks your account)` +
    (feeKes > 0 ? `\n\nFee held: KES ${feeKes.toLocaleString()} — credited after CONFIRM.` : "");

  return { ok: true, dispatch: mapDispatch(rows[0]), message: cleanRiderMsg };
}

/**
 * Legacy PICKED without OTP — prompts for PICKUP when a pickup OTP exists.
 */
export async function markBodaPickedUp({
  orderId,
  phone,
  customerKey = "",
  legacySkipPickupOtp = false,
} = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured" };
  const id = normalizeOrderId(orderId);
  const riderPhone = normalizeRiderPhone(phone) || normalizeRiderPhone(customerKey);
  if (!id || !riderPhone) {
    return { error: "invalid", message: "Reply like: PICKUP SKN-1234 4821" };
  }

  try {
    await ensureOtpSafeguardColumns();
  } catch {
    /* ignore */
  }

  const { rows: found } = await query(
    `SELECT d.pickup_otp_hash, d.custody_status, d.status
       FROM delivery_dispatches d
       JOIN riders r ON r.id = d.rider_id
      WHERE UPPER(d.order_ref) = UPPER($1)
        AND r.phone = $2
        AND d.status IN ('ACCEPTED', 'PICKED_UP', 'OTP_SENT')
      ORDER BY d.id DESC
      LIMIT 1`,
    [id, riderPhone]
  );
  const row = found[0];
  if (!row) {
    return { error: "not_found", message: `No accepted job *${id}* for you.` };
  }

  if (!legacySkipPickupOtp && row.pickup_otp_hash && row.custody_status !== "IN_TRANSIT") {
    return {
      error: "pickup_otp_required",
      message:
        `Ask the seller for the *Pickup OTP*, then reply:\n` +
        `*PICKUP ${id} ####*\n` +
        `Custody transfers only after that code is verified.`,
    };
  }

  // Generate delivery OTP at pickup — buyer holds it until the package is verified.
  const otp = String(randomInt(1000, 9999));
  const { rows } = await query(
    `UPDATE delivery_dispatches d SET
       status = 'OTP_SENT',
       custody_status = 'IN_TRANSIT',
       picked_up_at = COALESCE(d.picked_up_at, NOW()),
       pickup_otp_hash = NULL,
       delivery_otp_hash = $3,
       delivery_otp_sent_at = NOW(),
       otp_failed_attempts = 0,
       otp_locked_at = NULL,
       updated_at = NOW()
     FROM riders r
     WHERE UPPER(d.order_ref) = UPPER($1)
       AND d.rider_id = r.id
       AND r.phone = $2
       AND d.status IN ('ACCEPTED', 'PICKED_UP')
     RETURNING d.*`,
    [id, riderPhone, hashOtp(otp)]
  );
  if (!rows[0]) {
    if (row.status === "OTP_SENT") {
      return {
        ok: true,
        message: `Already in transit for *${id}*. At the door: *CONFIRM ${id} ####* with the buyer's code.`,
      };
    }
    return { error: "not_found", message: `No accepted job *${id}* for you.` };
  }

  const order = getOrder(id);
  const { sendText } = await import("./whatsapp.js");
  const feeKes = Number(rows[0].delivery_fee_kes || 0);
  if (order?.customerKey) {
    try {
      await sendText(
        order.customerKey,
        `🔐 *SOKONI DELIVERY CONFIRMATION CODE*\n\n` +
          `Your Order *${id}* is currently on its way.\n` +
          `• *Delivery Confirmation Code:* *${otp}*\n\n` +
          `⚠️ Give this 4-digit code to the rider ONLY after you have received and verified your package.\n` +
          `Or reply *YES ${id}* / *CODE ${otp}* once you have the item.`
      );
    } catch (err) {
      console.warn("[boda-fleet] OTP to buyer on pickup failed:", err.message);
    }
  }

  updateOrderMeta(id, {
    bodaStatus: "OTP_SENT",
    bodaCustody: "IN_TRANSIT",
    bodaPickedUpAt: Date.now(),
  });

  const cleanRiderMsg =
    `📦 Marked *${id}* picked up — OTP sent to the buyer.\n` +
    `At drop-off: 1) share your *live WhatsApp location*, then 2) reply:\n` +
    `*CONFIRM ${id} 1234*\n` +
    `(use the buyer's real code — 3 wrong tries locks your account)` +
    (feeKes > 0 ? `\n\nFee held: KES ${feeKes.toLocaleString()} — credited after CONFIRM.` : "");

  return { ok: true, dispatch: mapDispatch(rows[0]), message: cleanRiderMsg };
}

/**
 * Rider: DELIVERED SKN-#### → re-send delivery OTP (only after pickup custody transferred).
 */
export async function markBodaDeliveredRequestOtp({ orderId, phone, customerKey = "" } = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured" };
  const id = normalizeOrderId(orderId);
  const riderPhone = normalizeRiderPhone(phone) || normalizeRiderPhone(customerKey);
  const otp = String(randomInt(1000, 9999));
  const { rows } = await query(
    `UPDATE delivery_dispatches d SET
       status = 'OTP_SENT',
       custody_status = COALESCE(NULLIF(d.custody_status, ''), 'IN_TRANSIT'),
       delivery_otp_hash = $3,
       delivery_otp_sent_at = NOW(),
       otp_failed_attempts = 0,
       otp_locked_at = NULL,
       updated_at = NOW()
     FROM riders r
     WHERE UPPER(d.order_ref) = UPPER($1)
       AND d.rider_id = r.id
       AND r.phone = $2
       AND d.status IN ('PICKED_UP','OTP_SENT','OTP_LOCKED')
       AND (
         d.custody_status = 'IN_TRANSIT'
         OR d.picked_up_at IS NOT NULL
         OR d.pickup_otp_hash IS NULL
       )
     RETURNING d.*`,
    [id, riderPhone, hashOtp(otp)]
  );
  if (!rows[0]) {
    return {
      error: "not_found",
      message:
        `No in-transit job *${id}* for you. Complete seller pickup first:\n` +
        `*PICKUP ${id} ####*`,
    };
  }

  const order = getOrder(id);
  const { sendText } = await import("./whatsapp.js");
  if (order?.customerKey) {
    try {
      await sendText(
        order.customerKey,
        `🔐 *SOKONI DELIVERY CONFIRMATION CODE*\n\n` +
          `Your Order *${id}* — rider is at the door / code refreshed.\n` +
          `• *Delivery Confirmation Code:* *${otp}*\n\n` +
          `⚠️ Give this 4-digit code to the rider ONLY after you have received and verified your package.\n` +
          `Or reply *YES ${id}* / *CODE ${otp}*.`
      );
    } catch (err) {
      console.warn("[boda-fleet] OTP to buyer failed:", err.message);
    }
  }
  updateOrderMeta(id, { bodaStatus: "OTP_SENT" });
  return {
    ok: true,
    dispatch: mapDispatch(rows[0]),
    message:
      `OTP re-sent to the buyer for *${id}*. Ask them for the 4-digit code, then reply *CONFIRM ${id} ####*.`,
  };
}

async function ensureRiderPayoutsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS rider_payouts (
      id          BIGSERIAL PRIMARY KEY,
      rider_id    INT REFERENCES riders(id) ON DELETE SET NULL,
      order_ref   VARCHAR(40) NOT NULL,
      amount      NUMERIC(12, 2) NOT NULL DEFAULT 0,
      status      VARCHAR(20) NOT NULL DEFAULT 'CLEARED',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rider_payouts_order_rider
      ON rider_payouts (UPPER(order_ref), rider_id)
  `);
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
}

/**
 * Apply 10% + B2C tariff to rider_payouts and mark CLEARED (or NEEDS_APPROVAL if fee > cap).
 */
async function clearRiderPayoutWithFeeSplit({
  riderId,
  orderRef,
  deliveryFee,
  statuses = ["PENDING_CLEAR", "ON_HOLD", "FORFEITED"],
} = {}) {
  const rid = Number(riderId);
  const ref = String(orderRef || "").trim();
  if (!Number.isInteger(rid) || rid < 1 || !ref) {
    return { ok: false, error: "invalid_payout_target" };
  }
  const split = calculateDeliveryPayoutSplit(deliveryFee);
  await ensureRiderPayoutsTable();

  const needsApproval = split.originalDeliveryFee > RIDER_SINGLE_FEE_MANUAL_KES;
  const nextStatus = needsApproval ? "NEEDS_APPROVAL" : "CLEARED";
  const holdReason = needsApproval
    ? `Single delivery fee KES ${split.originalDeliveryFee} exceeds auto-payout cap KES ${RIDER_SINGLE_FEE_MANUAL_KES}`
    : null;

  const statusList = Array.isArray(statuses) && statuses.length ? statuses : ["PENDING_CLEAR", "ON_HOLD"];
  const { rows } = await query(
    `UPDATE rider_payouts SET
       status = $8,
       gross_delivery_fee = $3,
       platform_commission = $4,
       transaction_fee = $5,
       net_amount_paid = $6,
       amount = $6,
       requires_manual_approval = $9,
       payout_hold_reason = $10
     WHERE rider_id = $1
       AND UPPER(order_ref) = UPPER($2)
       AND status = ANY($7::text[])
     RETURNING id`,
    [
      rid,
      ref,
      split.originalDeliveryFee,
      split.platformCommission,
      split.mpesaTariff,
      split.netRiderPayout,
      statusList,
      nextStatus,
      needsApproval,
      holdReason,
    ]
  );

  if (!rows.length) {
    await query(
      `INSERT INTO rider_payouts (
         rider_id, order_ref, amount, status,
         gross_delivery_fee, platform_commission, transaction_fee, net_amount_paid,
         requires_manual_approval, payout_hold_reason
       )
       SELECT $1, $2, $3, $4, $5, $6, $7, $3, $8, $9
        WHERE NOT EXISTS (
          SELECT 1 FROM rider_payouts
           WHERE rider_id = $1 AND UPPER(order_ref) = UPPER($2)
        )`,
      [
        rid,
        ref,
        split.netRiderPayout,
        nextStatus,
        split.originalDeliveryFee,
        split.platformCommission,
        split.mpesaTariff,
        needsApproval,
        holdReason,
      ]
    );
  }

  if (needsApproval) {
    try {
      const { notifyAdminEvent } = await import("./communication-hub.js");
      await notifyAdminEvent("DISPUTE_OR_HELP", {
        orderId: ref,
        details:
          `⚠️ *HIGH FEE — MANUAL PAYOUT APPROVAL*\n` +
          `Order *${ref}* · rider #${rid}\n` +
          `Gross fee KES ${split.originalDeliveryFee.toLocaleString()} (cap ${RIDER_SINGLE_FEE_MANUAL_KES}).\n` +
          `Net credit KES ${split.netRiderPayout.toLocaleString()} held as NEEDS_APPROVAL.\n` +
          `Approve via admin boda desk / API before B2C.`,
      });
    } catch (err) {
      console.warn("[boda-fleet] high-fee admin alert:", err.message);
    }
  }

  return { ok: true, split, needsApproval, status: nextStatus };
}

/**
 * Rider shared live WhatsApp location — store on active OTP_SENT job(s).
 */
export async function recordRiderConfirmLocation({
  phone = "",
  customerKey = "",
  lat,
  lng,
} = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured" };
  const riderPhone = normalizeRiderPhone(phone) || normalizeRiderPhone(customerKey);
  const coords = parseCoordPair(lat, lng);
  if (!riderPhone || !coords) {
    return { error: "invalid_location", message: "Share a valid live WhatsApp location pin." };
  }
  try {
    await ensureOtpSafeguardColumns();
  } catch (err) {
    console.warn("[boda-fleet] safeguard columns on location:", err.message);
  }

  const { rows } = await query(
    `UPDATE delivery_dispatches d SET
       rider_confirm_lat = $2,
       rider_confirm_lng = $3,
       rider_location_at = NOW(),
       updated_at = NOW()
     FROM riders r
     WHERE d.rider_id = r.id
       AND r.phone = $1
       AND d.status = 'OTP_SENT'
     RETURNING d.order_ref, d.id`,
    [riderPhone, coords.lat, coords.lng]
  );

  try {
    await query(
      `UPDATE riders SET
         last_lat = $2,
         last_lng = $3,
         last_location_at = NOW(),
         updated_at = NOW()
       WHERE phone = $1`,
      [riderPhone, coords.lat, coords.lng]
    );
  } catch (err) {
    console.warn("[boda-fleet] rider last gps:", err.message);
  }

  if (!rows.length) {
    return {
      error: "no_active_job",
      message:
        "Location saved only for active pickup jobs. Claim a job (`ACCEPT` + `PICKED`) first, then share location before `CONFIRM`.",
    };
  }

  const refs = rows.map((r) => r.order_ref).join(", ");
  return {
    ok: true,
    orders: rows.map((r) => r.order_ref),
    message:
      `📍 Location locked for *${refs}*.\n` +
      `You must be within ${GEOFENCE_RADIUS_M}m of the drop-off.\n` +
      `Now reply *CONFIRM ${rows[0].order_ref} ####* with the buyer's code.`,
  };
}

async function resolveDropoffCoords(dispatch) {
  let drop = parseCoordPair(dispatch.dropoff_lat, dispatch.dropoff_lng);
  if (drop) return drop;
  drop = await geocodeKenyaAddress(dispatch.delivery_address);
  if (drop && dispatch.id) {
    try {
      await query(
        `UPDATE delivery_dispatches SET dropoff_lat = $2, dropoff_lng = $3, updated_at = NOW() WHERE id = $1`,
        [dispatch.id, drop.lat, drop.lng]
      );
    } catch (err) {
      console.warn("[boda-fleet] persist dropoff coords:", err.message);
    }
  }
  return drop;
}

async function ensureOtpSafeguardColumns() {
  await query(`
    ALTER TABLE delivery_dispatches
      ADD COLUMN IF NOT EXISTS otp_failed_attempts INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS otp_locked_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS dropoff_lat DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS dropoff_lng DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS rider_confirm_lat DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS rider_confirm_lng DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS rider_location_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS dispute_window_ends_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS payout_status VARCHAR(30) DEFAULT 'HOLD_ESCROW',
      ADD COLUMN IF NOT EXISTS payout_hold_until TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS pickup_otp_hash VARCHAR(128),
      ADD COLUMN IF NOT EXISTS pickup_otp_sent_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS custody_status VARCHAR(20) DEFAULT 'ASSIGNED'
  `);
}

async function ensureDeliveryOtpAuditTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS delivery_otp_audit (
      id                BIGSERIAL PRIMARY KEY,
      order_ref         VARCHAR(40) NOT NULL,
      dispatch_id       BIGINT,
      rider_id          INT,
      otp_entered       VARCHAR(8),
      otp_match         BOOLEAN NOT NULL DEFAULT FALSE,
      submission_time   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      rider_gps_lat     DOUBLE PRECISION,
      rider_gps_lng     DOUBLE PRECISION,
      distance_m        NUMERIC(12, 2),
      geofence_ok       BOOLEAN,
      escrow_status     VARCHAR(30),
      result            VARCHAR(40) NOT NULL DEFAULT 'ATTEMPT',
      meta              JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
}

async function writeOtpAudit(row = {}) {
  try {
    await ensureDeliveryOtpAuditTable();
    await query(
      `INSERT INTO delivery_otp_audit (
         order_ref, dispatch_id, rider_id, otp_entered, otp_match,
         rider_gps_lat, rider_gps_lng, distance_m, geofence_ok,
         escrow_status, result, meta
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
      [
        row.orderRef,
        row.dispatchId || null,
        row.riderId || null,
        row.otpEntered != null ? String(row.otpEntered).slice(0, 8) : null,
        Boolean(row.otpMatch),
        row.riderGpsLat ?? null,
        row.riderGpsLng ?? null,
        row.distanceM ?? null,
        row.geofenceOk ?? null,
        row.escrowStatus || null,
        row.result || "ATTEMPT",
        JSON.stringify(row.meta || {}),
      ]
    );
  } catch (err) {
    console.warn("[boda-fleet] otp audit write skipped:", err.message);
  }
}

async function alertAdminOtpLock({ orderId, riderId, riderPhone, attempts }) {
  try {
    const { notifyAdminEvent } = await import("./communication-hub.js");
    await notifyAdminEvent("DISPUTE_OR_HELP", {
      orderId,
      details:
        `⛔ *URGENT — OTP brute-force lock*\n` +
        `Order *${orderId}*\n` +
        `Rider #${riderId} (${riderPhone}) hit ${attempts} wrong OTP attempts.\n` +
        `Rider SUSPENDED · dispatch OTP_LOCKED.`,
    });
  } catch (err) {
    console.warn("[boda-fleet] admin OTP lock alert skipped:", err.message);
  }
}

/**
 * Rider WhatsApp: CONFIRM SKN-#### 1234 — OTP match → delivered + fee payout stub.
 */
export async function verifyDeliveryOTP({
  orderId = "",
  code = "",
  phone = "",
  customerKey = "",
} = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured" };
  try {
    await ensureOtpSafeguardColumns();
  } catch (err) {
    console.warn("[boda-fleet] safeguard columns:", err.message);
  }

  const id = normalizeOrderId(orderId);
  const riderPhone = normalizeRiderPhone(phone) || normalizeRiderPhone(customerKey);
  const otp = String(code || "").replace(/\D/g, "").slice(0, 4);
  if (!id || !riderPhone) {
    return {
      error: "invalid",
      message: "Reply like: CONFIRM SKN-1234 4821",
    };
  }
  if (otp.length !== 4) {
    return { error: "invalid_otp", message: "Include the buyer's 4-digit confirmation code." };
  }

  const { rows } = await query(
    `SELECT d.*, r.phone AS rider_phone, r.full_name AS rider_name, r.motorbike_plate
       FROM delivery_dispatches d
       JOIN riders r ON d.rider_id = r.id
      WHERE UPPER(d.order_ref) = UPPER($1)
        AND d.status IN ('OTP_SENT', 'OTP_LOCKED')
        AND r.phone LIKE $2
      ORDER BY d.id DESC
      LIMIT 1`,
    [id, `%${riderPhone.slice(-9)}`]
  );

  if (!rows[0]) {
    return {
      error: "not_found",
      message: `❌ Active transit order *${id}* not found for your account.`,
    };
  }

  const dispatch = rows[0];
  const failedAttempts = Number(dispatch.otp_failed_attempts || 0);

  // Step 1 — 3-strike lockout (anti-brute-force)
  if (dispatch.status === "OTP_LOCKED" || failedAttempts >= 3 || dispatch.otp_locked_at) {
    await writeOtpAudit({
      orderRef: id,
      dispatchId: dispatch.id,
      riderId: dispatch.rider_id,
      otpEntered: otp,
      otpMatch: false,
      result: "LOCKED",
      escrowStatus: dispatch.fee_status,
      meta: { reason: "already_locked", failedAttempts },
    });
    return {
      error: "otp_locked",
      message:
        `⛔ Account locked due to multiple incorrect OTP entries. Order *${id}* escalated to Admin.`,
    };
  }

  if (dispatch.delivery_otp_hash !== hashOtp(otp)) {
    const nextFails = failedAttempts + 1;
    if (nextFails >= 3) {
      await query(
        `UPDATE delivery_dispatches SET
           otp_failed_attempts = $2,
           otp_locked_at = NOW(),
           status = 'OTP_LOCKED',
           updated_at = NOW()
         WHERE id = $1`,
        [dispatch.id, nextFails]
      );
      if (dispatch.rider_id) {
        await query(
          `UPDATE riders SET
             verification_status = 'SUSPENDED',
             is_available = FALSE,
             suspend_reason = $2,
             suspended_at = NOW(),
             suspended_order_ref = $3,
             updated_at = NOW()
           WHERE id = $1`,
          [
            dispatch.rider_id,
            `OTP brute-force lock on ${id} (${nextFails} failed attempts)`,
            id,
          ]
        );
      }
      await writeOtpAudit({
        orderRef: id,
        dispatchId: dispatch.id,
        riderId: dispatch.rider_id,
        otpEntered: otp,
        otpMatch: false,
        result: "LOCKOUT",
        escrowStatus: dispatch.fee_status,
        meta: { failedAttempts: nextFails },
      });
      await alertAdminOtpLock({
        orderId: id,
        riderId: dispatch.rider_id,
        riderPhone,
        attempts: nextFails,
      });
      return {
        error: "otp_locked",
        message:
          `⛔ Account locked due to multiple incorrect OTP entries. Order *${id}* escalated to Admin.`,
      };
    }

    await query(
      `UPDATE delivery_dispatches SET
         otp_failed_attempts = $2,
         updated_at = NOW()
       WHERE id = $1`,
      [dispatch.id, nextFails]
    );
    await writeOtpAudit({
      orderRef: id,
      dispatchId: dispatch.id,
      riderId: dispatch.rider_id,
      otpEntered: otp,
      otpMatch: false,
      result: "MISMATCH",
      escrowStatus: dispatch.fee_status,
      meta: { failedAttempts: nextFails },
    });
    return {
      error: "otp_mismatch",
      message:
        `❌ Incorrect OTP code for Order *${id}* (${nextFails}/3).\n` +
        `Please ask the buyer for the correct 4-digit code.`,
    };
  }

  if (dispatch.delivery_otp_sent_at) {
    const age = Date.now() - new Date(dispatch.delivery_otp_sent_at).getTime();
    if (Number.isFinite(age) && age > 30 * 60 * 1000) {
      await writeOtpAudit({
        orderRef: id,
        dispatchId: dispatch.id,
        riderId: dispatch.rider_id,
        otpEntered: otp,
        otpMatch: true,
        result: "EXPIRED",
        escrowStatus: dispatch.fee_status,
      });
      return {
        error: "otp_expired",
        message: `That code expired. Reply *DELIVERED ${id}* for a fresh OTP, then CONFIRM again.`,
      };
    }
  }

  // Step 2 — GPS geofence (rider must share live WA location within 200m of drop-off)
  const riderGps = parseCoordPair(dispatch.rider_confirm_lat, dispatch.rider_confirm_lng);
  const locAge = dispatch.rider_location_at
    ? Date.now() - new Date(dispatch.rider_location_at).getTime()
    : Infinity;
  if (!riderGps || !Number.isFinite(locAge) || locAge > RIDER_LOCATION_MAX_AGE_MS) {
    await writeOtpAudit({
      orderRef: id,
      dispatchId: dispatch.id,
      riderId: dispatch.rider_id,
      otpEntered: otp,
      otpMatch: true,
      result: "NO_GPS",
      escrowStatus: dispatch.fee_status,
      meta: { locAgeMs: Number.isFinite(locAge) ? locAge : null },
    });
    return {
      error: "location_required",
      message:
        `📍 Share your *live WhatsApp location* at the buyer's door first (must be fresh, <10 min),\n` +
        `then reply *CONFIRM ${id} ${otp}* again.`,
    };
  }

  const dropCoords = await resolveDropoffCoords(dispatch);
  if (!dropCoords) {
    await writeOtpAudit({
      orderRef: id,
      dispatchId: dispatch.id,
      riderId: dispatch.rider_id,
      otpEntered: otp,
      otpMatch: true,
      riderGpsLat: riderGps.lat,
      riderGpsLng: riderGps.lng,
      geofenceOk: false,
      result: "NO_DROPOFF_GPS",
      escrowStatus: dispatch.fee_status,
    });
    return {
      error: "dropoff_gps_missing",
      message:
        `❌ Drop-off GPS is not on file for *${id}*. Cannot verify you are at the door.\n` +
        `Ask Sokoni ops / the seller to set the pin, then try again.`,
    };
  }

  const distanceM = haversineMeters(riderGps.lat, riderGps.lng, dropCoords.lat, dropCoords.lng);
  if (distanceM > GEOFENCE_RADIUS_M) {
    await writeOtpAudit({
      orderRef: id,
      dispatchId: dispatch.id,
      riderId: dispatch.rider_id,
      otpEntered: otp,
      otpMatch: true,
      riderGpsLat: riderGps.lat,
      riderGpsLng: riderGps.lng,
      distanceM: Math.round(distanceM),
      geofenceOk: false,
      result: "GEOFENCE_FAIL",
      escrowStatus: dispatch.fee_status,
      meta: { dropoff: dropCoords, radiusM: GEOFENCE_RADIUS_M },
    });
    return {
      error: "geofence_fail",
      message:
        `❌ You are ~${Math.round(distanceM)}m from the drop-off (limit ${GEOFENCE_RADIUS_M}m).\n` +
        `Move to the buyer's door, share a fresh WhatsApp location, then CONFIRM again.`,
    };
  }

  const feeKes = Number(dispatch.delivery_fee_kes || 0);

  await query(
    `UPDATE delivery_dispatches SET
       status = 'DELIVERED',
       custody_status = 'DELIVERED',
       delivered_at = NOW(),
       fee_status = 'PENDING_MPESA',
       payout_status = 'HOLD_ESCROW',
       payout_hold_until = NOW() + INTERVAL '15 minutes',
       dispute_window_ends_at = NOW() + INTERVAL '15 minutes',
       delivery_otp_hash = NULL,
       otp_failed_attempts = 0,
       updated_at = NOW()
     WHERE id = $1`,
    [dispatch.id]
  );
  if (dispatch.rider_id) {
    await query(`UPDATE riders SET is_available = TRUE, updated_at = NOW() WHERE id = $1`, [
      dispatch.rider_id,
    ]);
    try {
      const { recordRiderDeliveryForQuest } = await import("./rider-daily-quest.js");
      await recordRiderDeliveryForQuest(dispatch.rider_id, id);
    } catch (err) {
      console.warn("[boda-fleet] rider daily quest:", err.message);
    }
  }

  try {
    await ensureRiderPayoutsTable();
    await query(
      `INSERT INTO rider_payouts (rider_id, order_ref, amount, gross_delivery_fee, status)
       SELECT $1, $2, $3, $3, 'PENDING_CLEAR'
        WHERE NOT EXISTS (
          SELECT 1 FROM rider_payouts
           WHERE rider_id = $1 AND UPPER(order_ref) = UPPER($2)
        )`,
      [dispatch.rider_id, id, feeKes]
    );
  } catch (err) {
    console.warn("[boda-fleet] rider_payouts insert:", err.message);
  }

  updateOrderMeta(id, {
    bodaStatus: "DELIVERED",
    bodaCustody: "DELIVERED",
    bodaFeeStatus: "PENDING_MPESA",
    bodaPayoutStatus: "HOLD_ESCROW",
    bodaDisputeWindowEndsAt: Date.now() + 15 * 60 * 1000,
    payoutStatus: "ESCROW",
  });

  await writeOtpAudit({
    orderRef: id,
    dispatchId: dispatch.id,
    riderId: dispatch.rider_id,
    otpEntered: otp,
    otpMatch: true,
    riderGpsLat: riderGps.lat,
    riderGpsLng: riderGps.lng,
    distanceM: Math.round(distanceM),
    geofenceOk: true,
    result: "DELIVERED",
    escrowStatus: "HOLD_ESCROW",
    meta: {
      riderName: dispatch.rider_name || null,
      plate: dispatch.motorbike_plate || null,
      dropoff: dropCoords,
      disputeWindowMinutes: 15,
      payoutStatus: "HOLD_ESCROW",
    },
  });

  try {
    const { writeAuditLog } = await import("./audit-log.js");
    await writeAuditLog({
      orderRef: id,
      dispatchId: dispatch.id,
      riderId: dispatch.rider_id,
      actorPhone: riderPhone,
      actorRole: "RIDER",
      action: "DELIVERY_OTP_SUCCESS",
      fromStatus: dispatch.status,
      toStatus: "DELIVERED",
      fromCustody: "IN_TRANSIT",
      toCustody: "DELIVERED",
      source: "boda.verifyDeliveryOTP",
      metadata: { payout_hold_minutes: 15 },
    });
  } catch {
    /* ignore */
  }

  const order = getOrder(id);
  const { sendText } = await import("./whatsapp.js");
  const itemName = order?.productName || order?.title || "your item";
  const shortId = String(id).replace(/^SKN-?/i, "");

  // Buyer escrow YES path (item escrow) — rider fee stays on 15-min hold.
  if (order?.customerKey) {
    try {
      const { handleOrderBusMessage } = await import("./communication-hub.js");
      await handleOrderBusMessage(order.customerKey, `YES ${id}`, {
        phone: order.phone || "",
      });
    } catch (err) {
      console.warn("[boda-fleet] YES after rider CONFIRM:", err.message);
    }
    try {
      await sendText(
        order.customerKey,
        `📦 *ORDER ${id} DELIVERED*\n\n` +
          `Item: *${itemName}*\n` +
          `Your delivery code was entered by the rider.\n\n` +
          `⚠️ *DID NOT RECEIVE YOUR ITEM OR IT IS DAMAGED?*\n` +
          `Reply *DISPUTE ${shortId}* within *15 minutes* to instantly freeze rider payment and alert Sokoni Admin.`
      );
    } catch (err) {
      console.warn("[boda-fleet] buyer dispute-window notify skipped:", err.message);
    }
  }

  return {
    ok: true,
    orderId: id,
    message:
      `✅ *DELIVERY CODE VERIFIED FOR ORDER ${id}*\n\n` +
      `Package marked delivered.` +
      (feeKes > 0
        ? ` Delivery fee (KES ${feeKes.toLocaleString()}) is in *escrow lock for 15 minutes*. Funds release automatically unless the buyer disputes.`
        : ""),
  };
}

/**
 * Buyer: DISPUTE SKN-#### / DISPUTE #### within 15-min window after rider CONFIRM.
 */
export async function handleBuyerBodaDispute({
  orderId = "",
  phone = "",
  customerKey = "",
} = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured" };
  const id = normalizeOrderId(orderId) || normalizeOrderId(`SKN-${orderId}`) || String(orderId || "").toUpperCase();
  if (!id) {
    return { error: "invalid", message: "Reply like: DISPUTE SKN-1234" };
  }

  const { rows } = await query(
    `SELECT d.*, r.phone AS rider_phone, r.full_name AS rider_name, r.motorbike_plate
       FROM delivery_dispatches d
       LEFT JOIN riders r ON r.id = d.rider_id
      WHERE UPPER(d.order_ref) = UPPER($1)
      ORDER BY d.id DESC
      LIMIT 1`,
    [id]
  );
  const dispatch = rows[0];
  if (!dispatch || (dispatch.status !== "DELIVERED" && dispatch.status !== "DISPUTED")) {
    return {
      error: "not_found",
      message: `❌ Couldn't locate an active order *${id}* for a delivery dispute.`,
    };
  }

  // Buyer must own the order (best-effort).
  const order = getOrder(id);
  if (order?.customerKey && customerKey && order.customerKey !== customerKey) {
    const orderPhone = normalizeRiderPhone(order.phone || "");
    const senderPhone = normalizeRiderPhone(phone || customerKey);
    if (orderPhone && senderPhone && orderPhone !== senderPhone) {
      return { error: "forbidden", message: "Only the buyer on this order can open a delivery dispute." };
    }
  }

  if (dispatch.payout_status === "RELEASED" || dispatch.fee_status === "RELEASED") {
    return {
      error: "window_closed",
      message:
        `⚠️ The 15-minute instant dispute window for Order *${id}* has expired and payout was released.\n` +
        `Sokoni admin will contact you to resolve this manually — reply *HELP ${id}*.`,
    };
  }

  if (dispatch.payout_status === "FROZEN" || dispatch.fee_status === "ON_HOLD" || dispatch.status === "DISPUTED") {
    return {
      ok: true,
      already: true,
      message: `Dispute for *${id}* is already open — payout remains *FROZEN*. Sokoni admin is reviewing.`,
    };
  }

  const endsAt = dispatch.payout_hold_until || dispatch.dispute_window_ends_at
    ? new Date(dispatch.payout_hold_until || dispatch.dispute_window_ends_at).getTime()
    : 0;
  if (!endsAt || Date.now() > endsAt) {
    return {
      error: "window_closed",
      message:
        `⚠️ The 15-minute instant dispute window for Order *${id}* has expired.\n` +
        `Reply *HELP ${id}* so Sokoni admin can assist manually.`,
    };
  }

  await query(
    `UPDATE delivery_dispatches SET
       status = 'DISPUTED',
       fee_status = 'ON_HOLD',
       payout_status = 'FROZEN',
       updated_at = NOW(),
       meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb
     WHERE id = $1`,
    [
      dispatch.id,
      JSON.stringify({
        buyerDisputeAt: new Date().toISOString(),
        buyerDisputeBy: normalizeRiderPhone(phone || customerKey) || null,
        confirmGps: {
          lat: dispatch.rider_confirm_lat,
          lng: dispatch.rider_confirm_lng,
        },
      }),
    ]
  );

  if (dispatch.rider_id) {
    await query(
      `UPDATE riders SET
         verification_status = 'SUSPENDED',
         is_available = FALSE,
         suspend_reason = $2,
         suspended_at = NOW(),
         suspended_order_ref = $3,
         updated_at = NOW()
       WHERE id = $1`,
      [dispatch.rider_id, `Buyer DISPUTE within 15-min window on ${id}`, id]
    );
  }

  try {
    await query(
      `UPDATE rider_payouts SET status = 'ON_HOLD'
        WHERE rider_id = $1 AND UPPER(order_ref) = UPPER($2)`,
      [dispatch.rider_id, id]
    );
  } catch (err) {
    console.warn("[boda-fleet] payout ON_HOLD:", err.message);
  }

  updateOrderMeta(id, {
    bodaStatus: "DISPUTED",
    bodaFeeStatus: "ON_HOLD",
    bodaPayoutStatus: "FROZEN",
    payoutStatus: "ON_HOLD",
    disputeHold: true,
  });

  await writeOtpAudit({
    orderRef: id,
    dispatchId: dispatch.id,
    riderId: dispatch.rider_id,
    otpMatch: true,
    riderGpsLat: dispatch.rider_confirm_lat,
    riderGpsLng: dispatch.rider_confirm_lng,
    result: "BUYER_DISPUTE",
    escrowStatus: "FROZEN",
    meta: {
      riderName: dispatch.rider_name || null,
      plate: dispatch.motorbike_plate || null,
      disputedBy: normalizeRiderPhone(phone || customerKey) || null,
      payoutStatus: "FROZEN",
    },
  });

  try {
    const { notifyAdminEvent } = await import("./communication-hub.js");
    await notifyAdminEvent("DISPUTE_OPENED", {
      orderId: id,
      details:
        `🚨 *URGENT DISPUTE ALERT*\n` +
        `Buyer flagged Order *${id}* within 15-min window.\n` +
        `Fee *FROZEN*. Rider ${dispatch.rider_name || `#${dispatch.rider_id}`} (${dispatch.rider_phone || "—"}) suspended.\n` +
        `OTP GPS: ${dispatch.rider_confirm_lat || "—"}, ${dispatch.rider_confirm_lng || "—"}`,
    });
  } catch (err) {
    console.warn("[boda-fleet] dispute admin alert:", err.message);
  }

  if (dispatch.rider_phone) {
    try {
      const { sendText } = await import("./whatsapp.js");
      await sendText(
        `${normalizeRiderPhone(dispatch.rider_phone)}@c.us`,
        `⛔ *URGENT NOTICE*: Buyer flagged non-receipt/issue for Order *${id}*.\n\n` +
          `Payout of delivery fee is *FROZEN* and your rider account is *SUSPENDED* pending investigation. Contact Sokoni Support immediately.`
      );
    } catch (err) {
      console.warn("[boda-fleet] dispute rider notify:", err.message);
    }
  }

  return {
    ok: true,
    orderId: id,
    message:
      `🚨 *DISPUTE CONFIRMED — ORDER ${id}*\n\n` +
      `• Delivery fee payout to rider (${dispatch.rider_name || "assigned"}) has been *FROZEN*.\n` +
      `• Rider account temporarily *SUSPENDED*.\n` +
      `• Sokoni Management has been alerted for review.`,
  };
}

/**
 * After 15-min HOLD_ESCROW expires with no DISPUTE — apply fee split + RELEASED.
 * Runs from the 2-minute scheduler.
 */
export async function processBodaDisputeWindows({ limit = 40 } = {}) {
  if (!isDbEnabled()) return { ok: false, skipped: true };
  try {
    await ensureOtpSafeguardColumns();
  } catch {
    /* columns may already exist */
  }

  const { rows } = await query(
    `SELECT d.id, d.order_ref, d.delivery_fee_kes, r.phone AS rider_phone
       FROM delivery_dispatches d
       LEFT JOIN riders r ON r.id = d.rider_id
      WHERE d.status = 'DELIVERED'
        AND (
          d.payout_status = 'HOLD_ESCROW'
          OR (d.payout_status IS NULL AND d.fee_status = 'PENDING_MPESA')
        )
        AND COALESCE(d.payout_hold_until, d.dispute_window_ends_at) IS NOT NULL
        AND COALESCE(d.payout_hold_until, d.dispute_window_ends_at) <= NOW()
      ORDER BY COALESCE(d.payout_hold_until, d.dispute_window_ends_at) ASC
      LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 40, 1), 100)]
  );

  let released = 0;
  for (const row of rows) {
    try {
      const feeResult = await releaseBodaRiderFee({
        dispatchId: row.id,
        reason: "dispute_window_elapsed",
      });
      if (feeResult?.ok || feeResult?.already) {
        released += 1;
      }
    } catch (err) {
      console.warn("[boda-fleet] dispute window release:", row.order_ref, err.message);
    }
  }
  if (released) console.log(`[boda-fleet] HOLD_ESCROW cleared: ${released}`);
  return { ok: true, released };
}

/**
 * Rider delivery fee release stub — logs clearly; marks RELEASED.
 * Real Daraja/Paystack B2C for riders can replace this later.
 */
export async function syncBodaDispatchOnOrderDelivered(orderRef, { via = "buyer_yes" } = {}) {
  if (!isDbEnabled()) return { ok: false, skipped: true };
  const id = normalizeOrderId(orderRef) || String(orderRef || "").toUpperCase();
  if (!id) return { ok: false };

  const { rows } = await query(
    `UPDATE delivery_dispatches SET
       status = 'DELIVERED',
       delivered_at = COALESCE(delivered_at, NOW()),
       fee_status = CASE
         WHEN fee_status IN ('RELEASED', 'FORFEITED') THEN fee_status
         ELSE 'PENDING_MPESA'
       END,
       delivery_otp_hash = NULL,
       updated_at = NOW()
     WHERE UPPER(order_ref) = UPPER($1)
       AND status IN ('REQUESTED', 'ACCEPTED', 'PICKED_UP', 'OTP_SENT')
     RETURNING *`,
    [id]
  );
  const row = rows[0];
  if (!row) return { ok: true, synced: false };

  if (row.rider_id) {
    await query(
      `UPDATE riders SET is_available = TRUE, updated_at = NOW()
        WHERE id = $1 AND verification_status = 'VERIFIED'`,
      [row.rider_id]
    );
  }
  updateOrderMeta(id, { bodaStatus: "DELIVERED", bodaFeeStatus: row.fee_status || "PENDING_MPESA" });
  await releaseBodaRiderFee({ dispatchId: row.id, reason: via });
  return { ok: true, synced: true, dispatch: mapDispatch(row) };
}

/**
 * Mark rider fee RELEASED, apply 10% + B2C tariff to CLEARED ledger, notify rider.
 */
export async function releaseBodaRiderFee({ dispatchId, reason = "stub" } = {}) {
  if (!isDbEnabled()) return { ok: false, skipped: true };
  const id = Number(dispatchId);
  if (!Number.isInteger(id) || id < 1) return { error: "invalid_dispatch" };

  const { rows } = await query(
    `SELECT d.*, r.phone AS rider_phone, r.full_name AS rider_name, r.motorbike_plate
       FROM delivery_dispatches d
       LEFT JOIN riders r ON r.id = d.rider_id
      WHERE d.id = $1
      LIMIT 1`,
    [id]
  );
  const d = rows[0];
  if (!d) return { error: "not_found" };
  if (d.fee_status === "RELEASED") {
    return { ok: true, already: true, feeKes: Number(d.delivery_fee_kes || 0) };
  }
  if (d.status === "DISPUTED" || d.fee_status === "FORFEITED" || d.fee_status === "ON_HOLD" || d.payout_status === "FROZEN") {
    console.log(
      `[boda-fleet] fee stub SKIP release dispatch=#${id} order=${d.order_ref} status=${d.status} fee_status=${d.fee_status} payout_status=${d.payout_status} reason=${reason}`
    );
    return { ok: false, skipped: true, reason: d.payout_status || d.fee_status || d.status };
  }

  const feeKes = Number(d.delivery_fee_kes || 0);
  let split = calculateDeliveryPayoutSplit(feeKes);
  let cleared = null;

  if (d.rider_id && feeKes > 0) {
    try {
      cleared = await clearRiderPayoutWithFeeSplit({
        riderId: d.rider_id,
        orderRef: d.order_ref,
        deliveryFee: feeKes,
        statuses: ["PENDING_CLEAR", "ON_HOLD", "FORFEITED", "CLEARED"],
      });
      if (cleared.split) split = cleared.split;
    } catch (err) {
      console.warn("[boda-fleet] payout split clear:", err.message);
    }
  }

  console.log(
    `[boda-fleet] fee RELEASE` +
      ` dispatch=#${id}` +
      ` order=${d.order_ref}` +
      ` rider=${d.rider_phone || "—"}` +
      ` gross=${split.originalDeliveryFee}` +
      ` platform=${split.platformCommission}` +
      ` mpesa=${split.mpesaTariff}` +
      ` net=${split.netRiderPayout}` +
      ` via=${reason}`
  );

  await query(
    `UPDATE delivery_dispatches SET
       fee_status = 'RELEASED',
       payout_status = 'RELEASED',
       meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb,
       updated_at = NOW()
     WHERE id = $1`,
    [
      id,
      JSON.stringify({
        feeReleaseStubAt: new Date().toISOString(),
        feeReleaseReason: reason,
        feeReleaseKes: feeKes,
        platformCommission: split.platformCommission,
        mpesaTariff: split.mpesaTariff,
        netRiderPayout: split.netRiderPayout,
      }),
    ]
  );
  updateOrderMeta(d.order_ref, {
    bodaFeeStatus: "RELEASED",
    bodaPayoutStatus: "RELEASED",
    bodaPlatformCommission: split.platformCommission,
    bodaNetRiderPayout: split.netRiderPayout,
  });

  if (d.rider_phone && feeKes > 0) {
    try {
      const { sendText } = await import("./whatsapp.js");
      let msg;
      if (cleared?.needsApproval) {
        msg =
          `💰 Earnings for *${d.order_ref}* calculated (net *KES ${split.netRiderPayout.toLocaleString()}*).\n` +
          `Gross fee KES ${split.originalDeliveryFee.toLocaleString()} is above the auto-payout threshold — Sokoni ops must approve before M-Pesa.`;
      } else if (reason === "dispute_window_elapsed" || reason === "admin_reactivate") {
        msg = formatPayoutSplitMessage(d.order_ref, split);
      } else {
        msg =
          `💵 Delivery fee for *${d.order_ref}* cleared.\n` +
          `• Gross KES ${split.originalDeliveryFee.toLocaleString()} → net *KES ${split.netRiderPayout.toLocaleString()}*\n` +
          `(10% platform + M-Pesa B2C fee deducted). Auto-payout via M-Pesa when balance ≥ KES ${RIDER_B2C_MIN_FLOOR_KES}.`;
      }
      await sendText(`${normalizeRiderPhone(d.rider_phone)}@c.us`, msg);
    } catch (err) {
      console.warn("[boda-fleet] fee rider notify skipped:", err.message);
    }
  }

  return {
    ok: true,
    feeKes,
    split,
    needsApproval: Boolean(cleared?.needsApproval),
    orderRef: d.order_ref,
    riderPhone: d.rider_phone || null,
  };
}

/** On fulfillment dispute: suspend assigned rider + mark dispatch DISPUTED. */


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

  if (row.delivery_otp_sent_at) {
    const age = Date.now() - new Date(row.delivery_otp_sent_at).getTime();
    if (Number.isFinite(age) && age > 30 * 60 * 1000) {
      return {
        error: "otp_expired",
        message: "That code expired. Ask the rider to reply DELIVERED again for a new code.",
      };
    }
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

  await releaseBodaRiderFee({ dispatchId: row.id, reason: "buyer_otp" });

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
export async function tryHandleBodaFleetMessage(customerKey, text, { phone = "", location = null } = {}) {
  const trimmed = String(text || "").trim();
  const { sendText } = await import("./whatsapp.js");
  const { extractOrderIdFromText } = await import("./orders.js");

  // Live WhatsApp location pin (geofence for CONFIRM)
  if (location?.lat != null && location?.lng != null) {
    const result = await recordRiderConfirmLocation({
      phone,
      customerKey,
      lat: location.lat,
      lng: location.lng,
    });
    await sendText(customerKey, result.message || result.error || "Location received.");
    return true;
  }

  if (!trimmed) return false;

  try {
    const { tryHandleBodaNoShowMessage } = await import("./boda-no-show.js");
    if (await tryHandleBodaNoShowMessage(customerKey, trimmed, { phone })) return true;
  } catch (err) {
    console.warn("[boda-fleet] no-show handler:", err.message);
  }

  // Buyer: DISPUTE SKN-#### / DISPUTE #### (15-min window after rider CONFIRM)
  const dispute = trimmed.match(/^DISPUTE\s+(?:SKN?-?)?(\d{1,6}(?:-\d+)?)\b/i);
  if (dispute) {
    const result = await handleBuyerBodaDispute({
      orderId: `SKN-${dispute[1]}`,
      phone,
      customerKey,
    });
    await sendText(customerKey, result.message || result.error || "Could not open dispute.");
    return true;
  }

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

  const decline = trimmed.match(/^DECLINE\s+(SKN?-?\d{1,6}(?:-\d+)?)\b/i);
  if (decline) {
    const result = await declineBodaDispatch({
      orderId: decline[1],
      phone,
      customerKey,
    });
    await sendText(customerKey, result.message || result.error || "Could not decline.");
    return true;
  }

  const cancelJob = trimmed.match(/^CANCEL\s+JOB\s+(SKN?-?\d{1,6}(?:-\d+)?)\b/i);
  if (cancelJob) {
    const result = await cancelAcceptedBodaJob({
      orderId: cancelJob[1],
      phone,
      customerKey,
    });
    await sendText(customerKey, result.message || result.error || "Could not cancel job.");
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

  // Rider: PICKUP SKN-#### 1234 (seller OTP → custody transfer)
  const pickupCmd = trimmed.match(
    /^PICKUP\s+(SKN?-?\d{1,6}(?:-\d+)?)\s+(\d{4})\b/i
  );
  if (pickupCmd) {
    const result = await confirmPickupWithOtp({
      orderId: pickupCmd[1],
      code: pickupCmd[2],
      phone,
      customerKey,
    });
    await sendText(customerKey, result.message || result.error || "Could not confirm pickup.");
    return true;
  }

  // Rider: CONFIRM SKN-#### 1234 (OTP from buyer → delivery + fee payout)
  const confirm = trimmed.match(
    /^CONFIRM\s+(SKN?-?\d{1,6}(?:-\d+)?)\s+(\d{4})\b/i
  );
  if (confirm) {
    const result = await verifyDeliveryOTP({
      orderId: confirm[1],
      code: confirm[2],
      phone,
      customerKey,
    });
    await sendText(customerKey, result.message || result.error || "Could not confirm.");
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

/**
 * Admin: open boda delivery disputes (FROZEN / DISPUTED / suspended riders).
 */
export async function listRiderDisputes({ limit = 40 } = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured", disputes: [] };
  try {
    await ensureOtpSafeguardColumns();
  } catch (err) {
    console.warn("[boda-fleet] list disputes columns:", err.message);
  }

  const { rows } = await query(
    `SELECT d.*, r.full_name AS rider_name, r.phone AS rider_phone, r.motorbike_plate,
            r.verification_status AS rider_status, r.suspend_reason
       FROM delivery_dispatches d
       LEFT JOIN riders r ON r.id = d.rider_id
      WHERE (
              d.status = 'DISPUTED'
           OR d.payout_status = 'FROZEN'
           OR d.fee_status IN ('ON_HOLD', 'HELD')
            )
        AND COALESCE(d.fee_status, '') <> 'FORFEITED'
        AND COALESCE(d.meta->>'adminAction', '') = ''
      ORDER BY d.updated_at DESC
      LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 40, 1), 100)]
  );

  const disputes = [];
  for (const row of rows) {
    const order = getOrder(row.order_ref);
    let audit = null;
    try {
      const auditRes = await listDeliveryOtpAudit({ orderId: row.order_ref, limit: 1 });
      audit = auditRes.entries?.[0] || null;
    } catch {
      /* ignore */
    }
    disputes.push({
      disputeId: Number(row.id),
      dispatchId: Number(row.id),
      orderId: row.order_ref,
      itemName: order?.productName || order?.title || row.meta?.productName || "—",
      deliveryFee: Number(row.delivery_fee_kes || 0),
      deliveryAddress: row.delivery_address,
      buyerPhone: order?.phone || null,
      riderId: row.rider_id != null ? Number(row.rider_id) : null,
      riderName: row.rider_name || null,
      riderPhone: row.rider_phone || null,
      motorbikePlate: row.motorbike_plate || null,
      riderStatus: row.rider_status || null,
      suspendReason: row.suspend_reason || null,
      payoutStatus: row.payout_status || null,
      feeStatus: row.fee_status || null,
      status: row.status,
      completedAt: row.delivered_at || row.updated_at,
      createdAt: row.updated_at || row.created_at,
      riderGps:
        row.rider_confirm_lat != null
          ? { lat: Number(row.rider_confirm_lat), lng: Number(row.rider_confirm_lng) }
          : audit?.riderGps || null,
      otpEntered: audit?.otpEntered || null,
      otpAudit: audit,
    });
  }

  return { ok: true, success: true, disputes };
}

/**
 * Admin resolve: REACTIVATE_RIDER (release fee) or PERMANENT_BAN (forfeit + ban).
 */
export async function resolveRiderDispute({
  disputeId = null,
  dispatchId = null,
  riderId = null,
  action = "",
  reason = "",
} = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured" };
  const id = Number(disputeId || dispatchId);
  const act = String(action || "").toUpperCase();
  if (!Number.isInteger(id) || id < 1) return { error: "invalid_dispute", message: "Missing dispute/dispatch id." };
  if (!["REACTIVATE_RIDER", "PERMANENT_BAN"].includes(act)) {
    return { error: "invalid_action", message: "Use REACTIVATE_RIDER or PERMANENT_BAN." };
  }

  const { rows } = await query(
    `SELECT d.*, r.phone AS rider_phone, r.full_name AS rider_name
       FROM delivery_dispatches d
       LEFT JOIN riders r ON r.id = d.rider_id
      WHERE d.id = $1
      LIMIT 1`,
    [id]
  );
  const dispatch = rows[0];
  if (!dispatch) return { error: "not_found", message: "Dispute dispatch not found." };

  const rid = Number(riderId || dispatch.rider_id);
  const orderId = dispatch.order_ref;
  const { sendText } = await import("./whatsapp.js");

  if (act === "REACTIVATE_RIDER") {
    if (rid) {
      await setRiderVerificationStatus(rid, "VERIFIED", {
        reason: reason || `Cleared after dispute review on ${orderId}`,
      });
    }
    await query(
      `UPDATE delivery_dispatches SET
         status = 'DELIVERED',
         fee_status = 'PENDING_MPESA',
         payout_status = 'HOLD_ESCROW',
         payout_hold_until = NOW(),
         dispute_window_ends_at = NOW(),
         updated_at = NOW(),
         meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb
       WHERE id = $1`,
      [
        id,
        JSON.stringify({
          adminResolvedAt: new Date().toISOString(),
          adminAction: act,
          adminReason: String(reason || "").slice(0, 400),
        }),
      ]
    );
    try {
      // Split + CLEARED applied inside releaseBodaRiderFee
      await releaseBodaRiderFee({ dispatchId: id, reason: "admin_reactivate" });
    } catch (err) {
      console.warn("[boda-fleet] payout clear on reactivate:", err.message);
    }
    updateOrderMeta(orderId, {
      bodaStatus: "DELIVERED",
      bodaFeeStatus: "RELEASED",
      bodaPayoutStatus: "RELEASED",
      disputeHold: false,
    });

    const order = getOrder(orderId);
    if (order?.customerKey) {
      try {
        await sendText(
          order.customerKey,
          `✅ Sokoni reviewed your dispute on *${orderId}*. Delivery stands — support closed this case. Reply *HELP ${orderId}* if you still need help.`
        );
      } catch (err) {
        console.warn("[boda-fleet] buyer resolve notify:", err.message);
      }
    }

    return {
      ok: true,
      success: true,
      action: act,
      message: `Dispute cleared. Rider reactivated and delivery fee released for ${orderId}.`,
    };
  }

  // PERMANENT_BAN
  if (rid) {
    await setRiderVerificationStatus(rid, "REJECTED", {
      reason: reason || `Permanently banned after dispute on ${orderId}`,
    });
    await query(
      `UPDATE riders SET
         suspend_reason = $2,
         suspended_at = NOW(),
         suspended_order_ref = $3,
         is_available = FALSE,
         updated_at = NOW()
       WHERE id = $1`,
      [rid, String(reason || `Banned after ${orderId}`).slice(0, 400), orderId]
    );
  }
  await query(
    `UPDATE delivery_dispatches SET
       status = 'DISPUTED',
       fee_status = 'FORFEITED',
       payout_status = 'FROZEN',
       updated_at = NOW(),
       meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb
     WHERE id = $1`,
    [
      id,
      JSON.stringify({
        adminResolvedAt: new Date().toISOString(),
        adminAction: act,
        adminReason: String(reason || "").slice(0, 400),
      }),
    ]
  );
  try {
    await ensureRiderPayoutsTable();
    await query(
      `UPDATE rider_payouts SET status = 'FORFEITED'
        WHERE UPPER(order_ref) = UPPER($1)`,
      [orderId]
    );
  } catch (err) {
    console.warn("[boda-fleet] payout FORFEITED:", err.message);
  }
  updateOrderMeta(orderId, {
    bodaStatus: "DISPUTED",
    bodaFeeStatus: "FORFEITED",
    bodaPayoutStatus: "FROZEN",
    disputeHold: true,
    buyerRefundPending: true,
  });

  const order = getOrder(orderId);
  if (order?.customerKey) {
    try {
      await sendText(
        order.customerKey,
        `🧊 Sokoni banned the rider on *${orderId}* after review. Delivery fee forfeited.\n` +
          `Buyer refund / replacement is with Sokoni support — reply *HELP ${orderId}*.`
      );
    } catch (err) {
      console.warn("[boda-fleet] buyer ban notify:", err.message);
    }
  }

  return {
    ok: true,
    success: true,
    action: act,
    message: `Rider banned and fee forfeited for ${orderId}. Buyer marked for refund follow-up.`,
  };
}

/**
 * Admin: OTP submission audit trail (evidence for disputes / NTSA).
 */
export async function listDeliveryOtpAudit({
  orderId = "",
  riderId = null,
  limit = 50,
} = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured", entries: [] };
  try {
    await ensureDeliveryOtpAuditTable();
  } catch (err) {
    console.warn("[boda-fleet] audit table ensure:", err.message);
  }

  const id = orderId ? normalizeOrderId(orderId) || String(orderId).toUpperCase() : null;
  const rid = riderId != null && riderId !== "" ? Number(riderId) : null;
  const { rows } = await query(
    `SELECT a.*, r.full_name AS rider_name, r.motorbike_plate, r.phone AS rider_phone
       FROM delivery_otp_audit a
       LEFT JOIN riders r ON r.id = a.rider_id
      WHERE ($1::text IS NULL OR UPPER(a.order_ref) = UPPER($1))
        AND ($2::int IS NULL OR a.rider_id = $2)
      ORDER BY a.submission_time DESC
      LIMIT $3`,
    [id, Number.isInteger(rid) && rid > 0 ? rid : null, Math.min(Math.max(Number(limit) || 50, 1), 200)]
  );

  return {
    ok: true,
    entries: rows.map((row) => ({
      id: Number(row.id),
      orderRef: row.order_ref,
      dispatchId: row.dispatch_id != null ? Number(row.dispatch_id) : null,
      riderId: row.rider_id != null ? Number(row.rider_id) : null,
      riderLabel:
        row.rider_id != null
          ? `Rider #${row.rider_id} (${row.rider_name || "—"} — ${row.motorbike_plate || "—"})`
          : null,
      riderPhone: row.rider_phone || null,
      otpEntered: row.otp_entered || null,
      otpMatch: Boolean(row.otp_match),
      submissionTime: row.submission_time,
      riderGps:
        row.rider_gps_lat != null && row.rider_gps_lng != null
          ? { lat: Number(row.rider_gps_lat), lng: Number(row.rider_gps_lng) }
          : null,
      distanceM: row.distance_m != null ? Number(row.distance_m) : null,
      geofenceOk: row.geofence_ok == null ? null : Boolean(row.geofence_ok),
      escrowStatus: row.escrow_status || null,
      result: row.result,
      meta: row.meta || {},
    })),
  };
}

export function bodaSupportSummary() {
  return {
    zones: [...ZONES],
    commands: [
      "ACCEPT SKN-####",
      "DECLINE SKN-####",
      "CANCEL JOB SKN-#### (after accept → −0.5 rating)",
      "NO_SHOW SKN-#### (buyer unreachable → 15-min wait)",
      "CANCEL_NO_SHOW SKN-#### (start return trip)",
      "VERIFY_RETURN SKN-#### #### (seller Return OTP → 50% fee)",
      "SET ZONE NAIROBI|THIKA",
      "AVAILABLE / OFFLINE",
      "PICKUP SKN-#### 1234 (seller OTP)",
      "PICKED SKN-#### (legacy → prompts for PICKUP)",
      "share live WhatsApp location",
      "CONFIRM SKN-#### 1234",
      "DISPUTE SKN-#### (buyer, 15 min)",
      "DELIVERED SKN-####",
      "CODE 1234",
    ],
    dispatchEngine: {
      tier1Km: 3,
      tier2Km: 7,
      offerTimeoutSec: 45,
      pickupSlaMinutes: LATE_PICKUP_MINUTES,
      atomicAccept: "SELECT FOR UPDATE",
      score: "(Rating×40) − (DistanceKm×20) + (AcceptanceRate%×0.4)",
    },
    payoutGuards: {
      minFloorKes: RIDER_B2C_MIN_FLOOR_KES,
      singleFeeManualKes: RIDER_SINGLE_FEE_MANUAL_KES,
    },
    botPublicUrl: config.botPublicUrl || null,
  };
}

/**
 * Admin: approve a NEEDS_APPROVAL rider payout so it becomes CLEARED for B2C.
 */
export async function approveRiderPayout({ payoutId = null, orderId = "", approvedBy = "admin" } = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured" };
  await ensureRiderPayoutsTable();
  const id = Number(payoutId);
  const ref = orderId ? normalizeOrderId(orderId) || String(orderId).toUpperCase() : null;

  let rows;
  if (Number.isInteger(id) && id > 0) {
    ({ rows } = await query(
      `UPDATE rider_payouts SET
         status = 'CLEARED',
         requires_manual_approval = FALSE,
         approved_at = NOW(),
         approved_by = $2,
         payout_hold_reason = NULL
       WHERE id = $1 AND status = 'NEEDS_APPROVAL'
       RETURNING *`,
      [id, String(approvedBy || "admin").slice(0, 80)]
    ));
  } else if (ref) {
    ({ rows } = await query(
      `UPDATE rider_payouts SET
         status = 'CLEARED',
         requires_manual_approval = FALSE,
         approved_at = NOW(),
         approved_by = $2,
         payout_hold_reason = NULL
       WHERE UPPER(order_ref) = UPPER($1) AND status = 'NEEDS_APPROVAL'
       RETURNING *`,
      [ref, String(approvedBy || "admin").slice(0, 80)]
    ));
  } else {
    return { error: "invalid", message: "Provide payoutId or orderId." };
  }

  if (!rows.length) {
    return { error: "not_found", message: "No NEEDS_APPROVAL payout matched." };
  }
  return { ok: true, success: true, payouts: rows };
}

/**
 * Compare B2C ReceiverPartyPublicName to rider.full_name; flag mismatches for audit.
 */
export async function auditRiderMpesaName({ riderId, receiverPublicName } = {}) {
  if (!isDbEnabled() || !riderId || !receiverPublicName) return { matched: false, skipped: true };
  const display = extractMpesaDisplayName(receiverPublicName);
  const { rows } = await query(`SELECT id, full_name, phone FROM riders WHERE id = $1 LIMIT 1`, [
    Number(riderId),
  ]);
  const rider = rows[0];
  if (!rider) return { matched: false, skipped: true };

  const verdict = namesLikelyMatch(rider.full_name, display);
  const status = verdict.match ? "MATCH" : "MISMATCH";

  await query(
    `ALTER TABLE riders
       ADD COLUMN IF NOT EXISTS mpesa_account_name VARCHAR(160),
       ADD COLUMN IF NOT EXISTS mpesa_name_match_status VARCHAR(20) DEFAULT 'UNKNOWN',
       ADD COLUMN IF NOT EXISTS mpesa_name_flagged_at TIMESTAMPTZ,
       ADD COLUMN IF NOT EXISTS mpesa_name_last_checked_at TIMESTAMPTZ`
  ).catch(() => {});

  await query(
    `UPDATE riders SET
       mpesa_account_name = $2,
       mpesa_name_match_status = $3,
       mpesa_name_last_checked_at = NOW(),
       mpesa_name_flagged_at = CASE WHEN $3 = 'MISMATCH' THEN NOW() ELSE mpesa_name_flagged_at END,
       updated_at = NOW()
     WHERE id = $1`,
    [rider.id, String(display).slice(0, 160), status]
  );

  if (!verdict.match) {
    try {
      const { notifyAdminEvent } = await import("./communication-hub.js");
      await notifyAdminEvent("DISPUTE_OR_HELP", {
        orderId: null,
        details:
          `🚩 *M-PESA NAME MISMATCH*\n` +
          `Rider #${rider.id} *${rider.full_name}* (${rider.phone})\n` +
          `M-Pesa received as: *${display}*\n` +
          `Flag for manual audit before further payouts.`,
      });
    } catch (err) {
      console.warn("[boda-fleet] mpesa name alert:", err.message);
    }
  }

  return { matched: verdict.match, status, display, reason: verdict.reason };
}
