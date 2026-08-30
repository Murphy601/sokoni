/**
 * Rating engine — weighted stars, bonuses/penalties, badge refresh.
 * Keys: seller = users.id, rider = riders.id
 */
import { query, isDbEnabled } from "../db/pool.js";
import {
  applyWeightedStar,
  applyRatingDelta,
  deriveBadgeTier,
  clampRating,
  RATING_DELTAS,
} from "../lib/weighted-rating.js";

function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

async function logEvent(row) {
  if (!isDbEnabled()) return;
  try {
    await query(
      `INSERT INTO rating_events
        (subject_type, subject_id, event_kind, stars, delta, rating_before, rating_after,
         review_count, order_ref, reason, actor_label)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        row.subjectType,
        row.subjectId,
        row.eventKind,
        row.stars ?? null,
        row.delta ?? null,
        row.ratingBefore,
        row.ratingAfter,
        row.reviewCount ?? 0,
        row.orderRef || null,
        row.reason || null,
        row.actorLabel || null,
      ]
    );
  } catch (err) {
    console.warn("[rating-engine] event log failed:", err.message);
  }
}

async function loadSeller(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id < 1) return null;
  const { rows } = await query(
    `SELECT id, handle, shop_name, is_seller_verified,
            rating_score, rating_count, completed_orders,
            dispute_count, unresolved_disputes, badge_tier, phone
       FROM users WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function loadRider(riderId) {
  const id = Number(riderId);
  if (!Number.isInteger(id) || id < 1) return null;
  const { rows } = await query(
    `SELECT id, full_name, phone, verification_status, rating, rating_count,
            completed_deliveries, badge_tier
       FROM riders WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

export async function findSellerByHandle(handleRaw) {
  if (!isDbEnabled()) return null;
  const handle = String(handleRaw || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  if (!handle) return null;
  const { rows } = await query(
    `SELECT id FROM users WHERE LOWER(handle) = $1 LIMIT 1`,
    [handle]
  );
  return rows[0]?.id != null ? Number(rows[0].id) : null;
}

export async function findRiderByPhone(phoneRaw) {
  if (!isDbEnabled()) return null;
  const digits = digitsOnly(phoneRaw);
  if (digits.length < 9) return null;
  const national = digits.slice(-9);
  const { rows } = await query(
    `SELECT id FROM riders
      WHERE regexp_replace(phone, '\\D', '', 'g') LIKE '%' || $1
      ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
    [national]
  );
  return rows[0]?.id != null ? Number(rows[0].id) : null;
}

async function refreshSellerBadge(userId, { notifyPhone = null } = {}) {
  const row = await loadSeller(userId);
  if (!row) return null;
  const derived = deriveBadgeTier({
    completedOrders: Number(row.completed_orders || 0),
    rating: Number(row.rating_score || 0),
    isVerified: Boolean(row.is_seller_verified),
    disputeCount: Number(row.dispute_count || 0),
    unresolvedDisputes: Number(row.unresolved_disputes || 0),
    previousTier: row.badge_tier,
  });
  await query(`UPDATE users SET badge_tier = $2, updated_at = NOW() WHERE id = $1`, [
    Number(userId),
    derived.tier,
  ]);

  if (derived.demotionNotice && notifyPhone) {
    try {
      const { sendText } = await import("./whatsapp.js");
      const to = String(notifyPhone).includes("@")
        ? notifyPhone
        : `${digitsOnly(notifyPhone)}@c.us`;
      await sendText(to, `⚠️ ${derived.demotionNotice}`);
    } catch (err) {
      console.warn("[rating-engine] demotion notify failed:", err.message);
    }
  }
  return derived;
}

async function refreshRiderBadge(riderId) {
  const row = await loadRider(riderId);
  if (!row) return null;
  const verified = String(row.verification_status || "").toUpperCase() === "VERIFIED";
  const derived = deriveBadgeTier({
    completedOrders: Number(row.completed_deliveries || 0),
    rating: Number(row.rating || 0),
    isVerified: verified,
    disputeCount: 0,
    unresolvedDisputes: 0,
    previousTier: row.badge_tier,
  });
  await query(`UPDATE riders SET badge_tier = $2, updated_at = NOW() WHERE id = $1`, [
    Number(riderId),
    derived.tier,
  ]);
  return derived;
}

/**
 * Apply a 1–5 star review into the seller weighted pool.
 */
export async function applySellerStarReview({
  sellerUserId,
  stars,
  orderRef = "",
  reason = "buyer_review",
  actorLabel = "buyer",
} = {}) {
  if (!isDbEnabled()) return { ok: false, reason: "no_db" };
  const row = await loadSeller(sellerUserId);
  if (!row) return { ok: false, reason: "seller_not_found" };

  const before = Number(row.rating_score || 0);
  const count = Number(row.rating_count || 0);
  const next = applyWeightedStar(before, count, stars);

  await query(
    `UPDATE users
        SET rating_score = $2, rating_count = $3, updated_at = NOW()
      WHERE id = $1`,
    [Number(sellerUserId), next.rating, next.reviewCount]
  );

  await logEvent({
    subjectType: "seller",
    subjectId: Number(sellerUserId),
    eventKind: "star_review",
    stars: Number(stars),
    ratingBefore: before,
    ratingAfter: next.rating,
    reviewCount: next.reviewCount,
    orderRef,
    reason,
    actorLabel,
  });

  const badge = await refreshSellerBadge(sellerUserId, { notifyPhone: row.phone });
  return {
    ok: true,
    rating: next.rating,
    reviewCount: next.reviewCount,
    badgeTier: badge?.tier,
    badges: badge?.badges,
  };
}

/**
 * Additive delta for seller (bonus/penalty).
 */
export async function applySellerDelta({
  sellerUserId,
  delta,
  orderRef = "",
  reason = "",
  actorLabel = "system",
  bumpCompleted = false,
  bumpDispute = false,
  resolveDispute = false,
} = {}) {
  if (!isDbEnabled()) return { ok: false, reason: "no_db" };
  const row = await loadSeller(sellerUserId);
  if (!row) return { ok: false, reason: "seller_not_found" };

  const before = Number(row.rating_score || 0);
  const count = Number(row.rating_count || 0);
  const next = applyRatingDelta(before, delta, count);

  const completed = Number(row.completed_orders || 0) + (bumpCompleted ? 1 : 0);
  const disputes = Number(row.dispute_count || 0) + (bumpDispute ? 1 : 0);
  let unresolved = Number(row.unresolved_disputes || 0);
  if (bumpDispute) unresolved += 1;
  if (resolveDispute) unresolved = Math.max(0, unresolved - 1);

  await query(
    `UPDATE users SET
        rating_score = $2,
        completed_orders = $3,
        dispute_count = $4,
        unresolved_disputes = $5,
        updated_at = NOW()
      WHERE id = $1`,
    [Number(sellerUserId), next.rating, completed, disputes, unresolved]
  );

  await logEvent({
    subjectType: "seller",
    subjectId: Number(sellerUserId),
    eventKind: Number(delta) >= 0 ? "bonus" : "penalty",
    delta: Number(delta),
    ratingBefore: before,
    ratingAfter: next.rating,
    reviewCount: count,
    orderRef,
    reason,
    actorLabel,
  });

  const badge = await refreshSellerBadge(sellerUserId, { notifyPhone: row.phone });
  return { ok: true, rating: next.rating, reviewCount: count, badgeTier: badge?.tier, badges: badge?.badges };
}

/**
 * Absolute set (Boss override). Does not change review count unless provided.
 */
export async function setSellerRating({
  sellerUserId,
  rating,
  actorLabel = "boss",
  reason = "SET RATING",
} = {}) {
  if (!isDbEnabled()) return { ok: false, reason: "no_db" };
  const row = await loadSeller(sellerUserId);
  if (!row) return { ok: false, reason: "seller_not_found" };
  const before = Number(row.rating_score || 0);
  const next = clampRating(rating);
  await query(`UPDATE users SET rating_score = $2, updated_at = NOW() WHERE id = $1`, [
    Number(sellerUserId),
    next,
  ]);
  await logEvent({
    subjectType: "seller",
    subjectId: Number(sellerUserId),
    eventKind: "admin_set",
    ratingBefore: before,
    ratingAfter: next,
    reviewCount: Number(row.rating_count || 0),
    reason,
    actorLabel,
  });
  const badge = await refreshSellerBadge(sellerUserId, { notifyPhone: row.phone });
  return { ok: true, rating: next, reviewCount: Number(row.rating_count || 0), badgeTier: badge?.tier };
}

export async function applyRiderStarReview({
  riderId,
  stars,
  orderRef = "",
  reason = "buyer_rider_review",
  actorLabel = "buyer",
} = {}) {
  if (!isDbEnabled()) return { ok: false, reason: "no_db" };
  const row = await loadRider(riderId);
  if (!row) return { ok: false, reason: "rider_not_found" };

  const before = Number(row.rating || 0);
  const count = Number(row.rating_count || 0);
  const next = applyWeightedStar(before, count, stars);

  const events = [];
  events.push({
    at: new Date().toISOString(),
    stars: Number(stars),
    reason: String(reason).slice(0, 120),
    ratingAfter: next.rating,
  });

  await query(
    `UPDATE riders SET
        rating = $2,
        rating_count = $3,
        rating_events = COALESCE(rating_events, '[]'::jsonb) || $4::jsonb,
        updated_at = NOW()
      WHERE id = $1`,
    [Number(riderId), next.rating, next.reviewCount, JSON.stringify(events)]
  );

  await logEvent({
    subjectType: "rider",
    subjectId: Number(riderId),
    eventKind: "star_review",
    stars: Number(stars),
    ratingBefore: before,
    ratingAfter: next.rating,
    reviewCount: next.reviewCount,
    orderRef,
    reason,
    actorLabel,
  });

  const badge = await refreshRiderBadge(riderId);
  return { ok: true, rating: next.rating, reviewCount: next.reviewCount, badgeTier: badge?.tier };
}

export async function applyRiderDelta({
  riderId,
  delta,
  orderRef = "",
  reason = "",
  actorLabel = "system",
  bumpCompleted = false,
} = {}) {
  if (!isDbEnabled()) return { ok: false, reason: "no_db" };
  const row = await loadRider(riderId);
  if (!row) return { ok: false, reason: "rider_not_found" };

  const before = Number(row.rating || 0);
  const count = Number(row.rating_count || 0);
  const next = applyRatingDelta(before, delta, count);
  const completed = Number(row.completed_deliveries || 0) + (bumpCompleted ? 1 : 0);

  await query(
    `UPDATE riders SET
        rating = $2,
        completed_deliveries = $3,
        rating_events = COALESCE(rating_events, '[]'::jsonb) || $4::jsonb,
        updated_at = NOW()
      WHERE id = $1`,
    [
      Number(riderId),
      next.rating,
      completed,
      JSON.stringify([
        {
          at: new Date().toISOString(),
          delta: Number(delta),
          reason: String(reason).slice(0, 120),
          ratingAfter: next.rating,
        },
      ]),
    ]
  );

  await logEvent({
    subjectType: "rider",
    subjectId: Number(riderId),
    eventKind: Number(delta) >= 0 ? "bonus" : "penalty",
    delta: Number(delta),
    ratingBefore: before,
    ratingAfter: next.rating,
    reviewCount: count,
    orderRef,
    reason,
    actorLabel,
  });

  const badge = await refreshRiderBadge(riderId);
  return { ok: true, rating: next.rating, reviewCount: count, badgeTier: badge?.tier };
}

export async function setRiderRating({
  riderId,
  rating,
  actorLabel = "boss",
  reason = "SET RATING",
} = {}) {
  if (!isDbEnabled()) return { ok: false, reason: "no_db" };
  const row = await loadRider(riderId);
  if (!row) return { ok: false, reason: "rider_not_found" };
  const before = Number(row.rating || 0);
  const next = clampRating(rating);
  await query(`UPDATE riders SET rating = $2, updated_at = NOW() WHERE id = $1`, [
    Number(riderId),
    next,
  ]);
  await logEvent({
    subjectType: "rider",
    subjectId: Number(riderId),
    eventKind: "admin_set",
    ratingBefore: before,
    ratingAfter: next,
    reviewCount: Number(row.rating_count || 0),
    reason,
    actorLabel,
  });
  const badge = await refreshRiderBadge(riderId);
  return { ok: true, rating: next, badgeTier: badge?.tier };
}

/** Dispute-free completion: +0.05 + completed_orders++ (replaces fake 5★ insert). */
export async function creditDisputeFreeCompletion(sellerUserId, orderRef = "") {
  if (!isDbEnabled()) return { ok: false, reason: "no_db" };
  const ref = String(orderRef || "").trim().toUpperCase();
  if (ref) {
    const { rows } = await query(
      `SELECT id FROM rating_events
        WHERE subject_type = 'seller' AND subject_id = $1
          AND order_ref = $2 AND event_kind = 'bonus'
          AND reason = 'dispute_free_completion'
        LIMIT 1`,
      [Number(sellerUserId), ref]
    );
    if (rows[0]) return { ok: true, skipped: true, reason: "already_credited" };
  }
  return applySellerDelta({
    sellerUserId,
    delta: RATING_DELTAS.COMPLETION_BONUS,
    orderRef: ref,
    reason: "dispute_free_completion",
    actorLabel: "system",
    bumpCompleted: true,
  });
}

export async function penalizeBuyerWonDispute(sellerUserId, orderRef = "") {
  return applySellerDelta({
    sellerUserId,
    delta: RATING_DELTAS.BUYER_WON_DISPUTE,
    orderRef,
    reason: "buyer_won_dispute",
    actorLabel: "system",
    bumpDispute: true,
    resolveDispute: true,
  });
}

export async function penalizeSellerCancel(sellerUserId, orderRef = "") {
  return applySellerDelta({
    sellerUserId,
    delta: RATING_DELTAS.SELLER_CANCEL,
    orderRef,
    reason: "seller_cancel",
    actorLabel: "system",
  });
}

export async function bonusOnTimeRider(riderId, orderRef = "") {
  return applyRiderDelta({
    riderId,
    delta: RATING_DELTAS.ON_TIME_RIDER,
    orderRef,
    reason: "on_time_delivery",
    actorLabel: "system",
    bumpCompleted: true,
  });
}

export async function penalizeRiderLate(riderId, orderRef = "") {
  return applyRiderDelta({
    riderId,
    delta: RATING_DELTAS.RIDER_LATE,
    orderRef,
    reason: "late_pickup",
    actorLabel: "system",
  });
}

/**
 * Public trust stats for seller cards — prefer weighted columns, fall back to AVG reviews.
 */
export async function getSellerRatingProfile(sellerUserId) {
  if (!isDbEnabled() || !sellerUserId) {
    return { avgRating: 0, totalReviews: 0, badgeTier: "newbie", completedOrders: 0 };
  }
  const row = await loadSeller(sellerUserId);
  if (!row) {
    return { avgRating: 0, totalReviews: 0, badgeTier: "newbie", completedOrders: 0 };
  }
  let avg = Number(row.rating_score || 0);
  let count = Number(row.rating_count || 0);
  if (count <= 0) {
    // Fall back to order_reviews AVG until weighted pool is seeded
    const { rows } = await query(
      `SELECT COALESCE(AVG(rating), 0)::numeric(10,2) AS avg_rating,
              COUNT(*)::int AS total_reviews
         FROM order_reviews
        WHERE seller_user_id = $1 AND direction = 'buyer_to_seller'`,
      [Number(sellerUserId)]
    );
    avg = Number(rows[0]?.avg_rating || 0);
    count = Number(rows[0]?.total_reviews || 0);
  }
  const derived = deriveBadgeTier({
    completedOrders: Number(row.completed_orders || 0),
    rating: avg,
    isVerified: Boolean(row.is_seller_verified),
    disputeCount: Number(row.dispute_count || 0),
    unresolvedDisputes: Number(row.unresolved_disputes || 0),
    previousTier: row.badge_tier,
  });
  return {
    avgRating: avg,
    totalReviews: count,
    badgeTier: derived.tier,
    completedOrders: Number(row.completed_orders || 0),
    badges: derived.badges,
    isSellerVerified: Boolean(row.is_seller_verified),
  };
}

export { RATING_DELTAS, deriveBadgeTier, clampRating };
