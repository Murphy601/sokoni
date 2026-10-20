/**
 * Rating engine — rolling last-100 pool, bonuses/penalties, badge refresh, purge.
 * Keys: seller = users.id, rider = riders.id
 */
import { query, isDbEnabled } from "../db/pool.js";
import {
  pushStarToPool,
  pushDeltaToPool,
  purgePoolEntry,
  scoreFromPool,
  buildAdminOverridePool,
  deriveBadgeTier,
  clampRating,
  RATING_DELTAS,
  INITIAL_RATING,
  MIN_PUBLIC_REVIEWS,
} from "../lib/weighted-rating.js";

function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

function entryId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function logEvent(row) {
  if (!isDbEnabled()) return;
  try {
    await query(
      `INSERT INTO rating_events
        (subject_type, subject_id, event_kind, stars, delta, rating_before, rating_after,
         review_count, order_ref, reason, actor_label, pool_entry_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
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
        row.poolEntryId || null,
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
            rating_score, rating_count, rating_pool, completed_orders,
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
            rating_pool, completed_deliveries, badge_tier
       FROM riders WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

export async function findSellerByHandle(handleRaw) {
  if (!isDbEnabled()) return null;
  const { shopHandleLookupKeys } = await import("../lib/shop-handle.js");
  const keys = shopHandleLookupKeys(handleRaw);
  if (!keys.length) return null;

  // Prefer exact LOWER(handle) hits across slug variants (adiv_thrift, adiv-thrift, …)
  for (const key of keys) {
    const { rows } = await query(
      `SELECT id FROM users
        WHERE LOWER(REGEXP_REPLACE(COALESCE(handle, ''), '^@+', '')) = $1
           OR LOWER(REGEXP_REPLACE(COALESCE(shop_name, ''), '^@+', '')) = $1
           OR LOWER(REGEXP_REPLACE(COALESCE(display_name, ''), '^@+', '')) = $1
        LIMIT 1`,
      [key]
    );
    if (rows[0]?.id != null) return Number(rows[0].id);
  }

  // Last resort: strip non-alphanumerics so "Adiv's thrift" ≈ "adivthrift" ≈ "adiv_thrift"
  const compact = keys.find((k) => /^[a-z0-9]+$/.test(k)) || keys[0].replace(/[^a-z0-9]/g, "");
  if (compact.length >= 3) {
    const { rows } = await query(
      `SELECT id FROM users
        WHERE REGEXP_REPLACE(LOWER(COALESCE(handle, '')), '[^a-z0-9]', '', 'g') = $1
           OR REGEXP_REPLACE(LOWER(COALESCE(shop_name, '')), '[^a-z0-9]', '', 'g') = $1
        LIMIT 1`,
      [compact]
    );
    if (rows[0]?.id != null) return Number(rows[0].id);
  }
  return null;
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
  const scored = scoreFromPool(row.rating_pool);
  const prevTier = String(row.badge_tier || "newbie").toLowerCase();
  const derived = deriveBadgeTier({
    completedOrders: Number(row.completed_orders || 0),
    rating: scored.rating,
    unrated: scored.unrated,
    isVerified: Boolean(row.is_seller_verified),
    disputeCount: Number(row.dispute_count || 0),
    unresolvedDisputes: Number(row.unresolved_disputes || 0),
    previousTier: row.badge_tier,
  });
  await query(`UPDATE users SET badge_tier = $2, updated_at = NOW() WHERE id = $1`, [
    Number(userId),
    derived.tier,
  ]);

  const TIER_RANK = { newbie: 0, verified: 1, rising: 1, top_rated: 2, legend: 3 };
  if ((TIER_RANK[derived.tier] || 0) > (TIER_RANK[prevTier] || 0)) {
    try {
      const { awardPoints } = await import("./sokoni-points.js");
      await awardPoints({
        subjectType: "seller",
        subjectId: Number(userId),
        reason: "seller_badge_level_up",
        ref: `badge_${prevTier}_to_${derived.tier}_${userId}`,
      });
    } catch (err) {
      console.warn("[rating-engine] badge level-up points:", err.message);
    }
  }

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
  return { ...derived, unrated: scored.unrated, buyerReviewCount: scored.buyerReviewCount };
}

async function refreshRiderBadge(riderId) {
  const row = await loadRider(riderId);
  if (!row) return null;
  const scored = scoreFromPool(row.rating_pool);
  const verified = String(row.verification_status || "").toUpperCase() === "VERIFIED";
  const derived = deriveBadgeTier({
    completedOrders: Number(row.completed_deliveries || 0),
    rating: scored.rating,
    unrated: scored.unrated,
    isVerified: verified,
    disputeCount: 0,
    unresolvedDisputes: 0,
    previousTier: row.badge_tier,
  });
  await query(`UPDATE riders SET badge_tier = $2, updated_at = NOW() WHERE id = $1`, [
    Number(riderId),
    derived.tier,
  ]);
  return { ...derived, unrated: scored.unrated };
}

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

  const before = Number(row.rating_score || INITIAL_RATING);
  const id = entryId("star");
  const next = pushStarToPool(row.rating_pool, stars, { id, orderRef });

  await query(
    `UPDATE users
        SET rating_score = $2, rating_count = $3, rating_pool = $4::jsonb, updated_at = NOW()
      WHERE id = $1`,
    [Number(sellerUserId), next.rating, next.buyerReviewCount, JSON.stringify(next.pool)]
  );

  await logEvent({
    subjectType: "seller",
    subjectId: Number(sellerUserId),
    eventKind: "star_review",
    stars: Number(stars),
    ratingBefore: before,
    ratingAfter: next.rating,
    reviewCount: next.buyerReviewCount,
    orderRef,
    reason,
    actorLabel,
    poolEntryId: id,
  });

  const badge = await refreshSellerBadge(sellerUserId, { notifyPhone: row.phone });
  return {
    ok: true,
    rating: next.rating,
    reviewCount: next.buyerReviewCount,
    unrated: next.unrated,
    displayLabel: next.displayLabel,
    handle: row.handle ? `@${String(row.handle).replace(/^@/, "")}` : null,
    badgeTier: badge?.tier,
    badges: badge?.badges,
    poolEntryId: id,
  };
}

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

  const before = Number(row.rating_score || INITIAL_RATING);
  const id = entryId("delta");
  const next = pushDeltaToPool(row.rating_pool, delta, { id, orderRef });

  const completed = Number(row.completed_orders || 0) + (bumpCompleted ? 1 : 0);
  const disputes = Number(row.dispute_count || 0) + (bumpDispute ? 1 : 0);
  let unresolved = Number(row.unresolved_disputes || 0);
  if (bumpDispute) unresolved += 1;
  if (resolveDispute) unresolved = Math.max(0, unresolved - 1);

  await query(
    `UPDATE users SET
        rating_score = $2,
        rating_count = $3,
        rating_pool = $4::jsonb,
        completed_orders = $5,
        dispute_count = $6,
        unresolved_disputes = $7,
        updated_at = NOW()
      WHERE id = $1`,
    [
      Number(sellerUserId),
      next.rating,
      next.buyerReviewCount,
      JSON.stringify(next.pool),
      completed,
      disputes,
      unresolved,
    ]
  );

  await logEvent({
    subjectType: "seller",
    subjectId: Number(sellerUserId),
    eventKind: Number(delta) >= 0 ? "bonus" : "penalty",
    delta: Number(delta),
    ratingBefore: before,
    ratingAfter: next.rating,
    reviewCount: next.buyerReviewCount,
    orderRef,
    reason,
    actorLabel,
    poolEntryId: id,
  });

  const badge = await refreshSellerBadge(sellerUserId, { notifyPhone: row.phone });
  return {
    ok: true,
    rating: next.rating,
    reviewCount: next.buyerReviewCount,
    unrated: next.unrated,
    badgeTier: badge?.tier,
    badges: badge?.badges,
  };
}

export async function setSellerRating({
  sellerUserId,
  rating,
  actorLabel = "boss",
  reason = "OVERRIDE RATING",
} = {}) {
  if (!isDbEnabled()) return { ok: false, reason: "no_db" };
  const row = await loadSeller(sellerUserId);
  if (!row) return { ok: false, reason: "seller_not_found" };
  const before = Number(row.rating_score || INITIAL_RATING);
  const next = clampRating(rating);
  // Absolute override: seed enough public star entries + admin_set so site leaves UNRATED
  const pool = buildAdminOverridePool(next, { idPrefix: "set" });
  const scored = scoreFromPool(pool);
  const buyerCount = Math.max(
    Number(row.rating_count || 0),
    scored.buyerReviewCount,
    MIN_PUBLIC_REVIEWS
  );
  await query(
    `UPDATE users SET rating_score = $2, rating_count = $3, rating_pool = $4::jsonb, updated_at = NOW()
      WHERE id = $1`,
    [Number(sellerUserId), next, buyerCount, JSON.stringify(pool)]
  );
  await logEvent({
    subjectType: "seller",
    subjectId: Number(sellerUserId),
    eventKind: "admin_set",
    ratingBefore: before,
    ratingAfter: next,
    reviewCount: buyerCount,
    reason,
    actorLabel,
    poolEntryId: pool[pool.length - 1]?.id,
  });
  const badge = await refreshSellerBadge(sellerUserId, { notifyPhone: row.phone });
  return {
    ok: true,
    rating: next,
    reviewCount: buyerCount,
    unrated: false,
    displayLabel: next.toFixed(1),
    badgeTier: badge?.tier,
    badges: badge?.badges,
  };
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

  const before = Number(row.rating || INITIAL_RATING);
  const id = entryId("star");
  const next = pushStarToPool(row.rating_pool, stars, { id, orderRef });

  await query(
    `UPDATE riders SET
        rating = $2,
        rating_count = $3,
        rating_pool = $4::jsonb,
        rating_events = COALESCE(rating_events, '[]'::jsonb) || $5::jsonb,
        updated_at = NOW()
      WHERE id = $1`,
    [
      Number(riderId),
      next.rating,
      next.buyerReviewCount,
      JSON.stringify(next.pool),
      JSON.stringify([{ at: new Date().toISOString(), stars: Number(stars), ratingAfter: next.rating }]),
    ]
  );

  await logEvent({
    subjectType: "rider",
    subjectId: Number(riderId),
    eventKind: "star_review",
    stars: Number(stars),
    ratingBefore: before,
    ratingAfter: next.rating,
    reviewCount: next.buyerReviewCount,
    orderRef,
    reason,
    actorLabel,
    poolEntryId: id,
  });

  const badge = await refreshRiderBadge(riderId);
  return {
    ok: true,
    rating: next.rating,
    reviewCount: next.buyerReviewCount,
    unrated: next.unrated,
    badgeTier: badge?.tier,
  };
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

  const before = Number(row.rating || INITIAL_RATING);
  const id = entryId("delta");
  const next = pushDeltaToPool(row.rating_pool, delta, { id, orderRef });
  const completed = Number(row.completed_deliveries || 0) + (bumpCompleted ? 1 : 0);

  await query(
    `UPDATE riders SET
        rating = $2,
        rating_count = $3,
        rating_pool = $4::jsonb,
        completed_deliveries = $5,
        rating_events = COALESCE(rating_events, '[]'::jsonb) || $6::jsonb,
        updated_at = NOW()
      WHERE id = $1`,
    [
      Number(riderId),
      next.rating,
      next.buyerReviewCount,
      JSON.stringify(next.pool),
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
    reviewCount: next.buyerReviewCount,
    orderRef,
    reason,
    actorLabel,
    poolEntryId: id,
  });

  const badge = await refreshRiderBadge(riderId);
  return { ok: true, rating: next.rating, reviewCount: next.buyerReviewCount, badgeTier: badge?.tier };
}

export async function setRiderRating({
  riderId,
  rating,
  actorLabel = "boss",
  reason = "OVERRIDE RATING",
} = {}) {
  if (!isDbEnabled()) return { ok: false, reason: "no_db" };
  const row = await loadRider(riderId);
  if (!row) return { ok: false, reason: "rider_not_found" };
  const before = Number(row.rating || INITIAL_RATING);
  const next = clampRating(rating);
  const pool = buildAdminOverridePool(next, { idPrefix: "rset" });
  const scored = scoreFromPool(pool);
  const buyerCount = Math.max(
    Number(row.rating_count || 0),
    scored.buyerReviewCount,
    MIN_PUBLIC_REVIEWS
  );
  await query(
    `UPDATE riders SET rating = $2, rating_count = $3, rating_pool = $4::jsonb, updated_at = NOW()
      WHERE id = $1`,
    [Number(riderId), next, buyerCount, JSON.stringify(pool)]
  );
  await logEvent({
    subjectType: "rider",
    subjectId: Number(riderId),
    eventKind: "admin_set",
    ratingBefore: before,
    ratingAfter: next,
    reviewCount: buyerCount,
    reason,
    actorLabel,
    poolEntryId: pool[pool.length - 1]?.id,
  });
  const badge = await refreshRiderBadge(riderId);
  return {
    ok: true,
    rating: next,
    reviewCount: buyerCount,
    unrated: false,
    badgeTier: badge?.tier,
  };
}

/** Boss: remove one unfair pool entry and recalc. */
export async function purgeRatingEntry({
  subjectType,
  subjectId,
  poolEntryId,
  actorLabel = "boss",
} = {}) {
  if (!isDbEnabled()) return { ok: false, reason: "no_db" };
  const type = subjectType === "rider" ? "rider" : "seller";
  const id = Number(subjectId);
  if (!Number.isInteger(id) || id < 1 || !poolEntryId) {
    return { ok: false, reason: "invalid_args" };
  }

  if (type === "seller") {
    const row = await loadSeller(id);
    if (!row) return { ok: false, reason: "seller_not_found" };
    const before = Number(row.rating_score || INITIAL_RATING);
    const next = purgePoolEntry(row.rating_pool, poolEntryId);
    await query(
      `UPDATE users SET rating_score = $2, rating_count = $3, rating_pool = $4::jsonb, updated_at = NOW()
        WHERE id = $1`,
      [id, next.rating, next.buyerReviewCount, JSON.stringify(next.pool)]
    );
    await query(
      `UPDATE rating_events SET purged_at = NOW()
        WHERE subject_type = 'seller' AND subject_id = $1 AND pool_entry_id = $2 AND purged_at IS NULL`,
      [id, String(poolEntryId)]
    );
    await logEvent({
      subjectType: "seller",
      subjectId: id,
      eventKind: "purge",
      ratingBefore: before,
      ratingAfter: next.rating,
      reviewCount: next.buyerReviewCount,
      reason: `purge:${poolEntryId}`,
      actorLabel,
      poolEntryId: String(poolEntryId),
    });
    const badge = await refreshSellerBadge(id, { notifyPhone: row.phone });
    return { ok: true, rating: next.rating, unrated: next.unrated, badgeTier: badge?.tier };
  }

  const row = await loadRider(id);
  if (!row) return { ok: false, reason: "rider_not_found" };
  const before = Number(row.rating || INITIAL_RATING);
  const next = purgePoolEntry(row.rating_pool, poolEntryId);
  await query(
    `UPDATE riders SET rating = $2, rating_count = $3, rating_pool = $4::jsonb, updated_at = NOW()
      WHERE id = $1`,
    [id, next.rating, next.buyerReviewCount, JSON.stringify(next.pool)]
  );
  await query(
    `UPDATE rating_events SET purged_at = NOW()
      WHERE subject_type = 'rider' AND subject_id = $1 AND pool_entry_id = $2 AND purged_at IS NULL`,
    [id, String(poolEntryId)]
  );
  const badge = await refreshRiderBadge(id);
  return {
    ok: true,
    rating: next.rating,
    unrated: next.unrated,
    badgeTier: badge?.tier,
    before,
  };
}

export async function listRatingEvents({ subjectType, subjectId, limit = 40 } = {}) {
  if (!isDbEnabled()) return { events: [] };
  const { rows } = await query(
    `SELECT id, subject_type, subject_id, event_kind, stars, delta, rating_before, rating_after,
            review_count, order_ref, reason, actor_label, pool_entry_id, purged_at, created_at
       FROM rating_events
      WHERE subject_type = $1 AND subject_id = $2
      ORDER BY created_at DESC
      LIMIT $3`,
    [subjectType === "rider" ? "rider" : "seller", Number(subjectId), Math.min(100, Math.max(1, limit))]
  );
  return {
    events: rows.map((r) => ({
      id: Number(r.id),
      subjectType: r.subject_type,
      subjectId: Number(r.subject_id),
      eventKind: r.event_kind,
      stars: r.stars != null ? Number(r.stars) : null,
      delta: r.delta != null ? Number(r.delta) : null,
      ratingBefore: Number(r.rating_before),
      ratingAfter: Number(r.rating_after),
      reviewCount: Number(r.review_count || 0),
      orderRef: r.order_ref,
      reason: r.reason,
      actorLabel: r.actor_label,
      poolEntryId: r.pool_entry_id,
      purged: Boolean(r.purged_at),
      createdAt: r.created_at,
    })),
  };
}

export async function creditDisputeFreeCompletion(sellerUserId, orderRef = "") {
  if (!isDbEnabled()) return { ok: false, reason: "no_db" };
  const ref = String(orderRef || "").trim().toUpperCase();
  if (ref) {
    const { rows } = await query(
      `SELECT id FROM rating_events
        WHERE subject_type = 'seller' AND subject_id = $1
          AND order_ref = $2 AND event_kind = 'bonus'
          AND reason = 'dispute_free_completion' AND purged_at IS NULL
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
  }).then(async (result) => {
    if (result?.ok && !result.skipped) {
      try {
        const { awardPoints } = await import("./sokoni-points.js");
        await awardPoints({
          subjectType: "seller",
          subjectId: Number(sellerUserId),
          reason: "seller_order_complete",
          ref: ref ? `seller_order_${ref}` : `seller_order_${sellerUserId}_${Date.now()}`,
        });
      } catch (err) {
        console.warn("[rating-engine] seller order points:", err.message);
      }
    }
    return result;
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

export async function getSellerRatingProfile(sellerUserId) {
  if (!isDbEnabled() || !sellerUserId) {
    return {
      avgRating: INITIAL_RATING,
      totalReviews: 0,
      unrated: true,
      badgeTier: "newbie",
      completedOrders: 0,
    };
  }
  const row = await loadSeller(sellerUserId);
  if (!row) {
    return {
      avgRating: INITIAL_RATING,
      totalReviews: 0,
      unrated: true,
      badgeTier: "newbie",
      completedOrders: 0,
    };
  }
  let scored = scoreFromPool(row.rating_pool);
  const denormCount = Number(row.rating_count || 0);
  const denormScore = Number(row.rating_score || 0);

  // Denormalized columns are written by the engine / Boss override — trust them for public UI
  // so the site never stays UNRATED after a successful SET RATING (even with legacy admin_set pools).
  if (denormCount >= MIN_PUBLIC_REVIEWS && denormScore > 0) {
    scored = {
      rating: clampRating(denormScore),
      reviewCount: denormCount,
      buyerReviewCount: denormCount,
      unrated: false,
      displayLabel: clampRating(denormScore).toFixed(2),
      pool: scored.pool || [],
    };
  } else if (scored.buyerReviewCount <= 0 && denormCount <= 0) {
    const { rows } = await query(
      `SELECT COALESCE(AVG(rating), 0)::numeric(10,2) AS avg_rating,
              COUNT(*)::int AS total_reviews
         FROM order_reviews
        WHERE seller_user_id = $1 AND direction = 'buyer_to_seller'`,
      [Number(sellerUserId)]
    );
    const avg = Number(rows[0]?.avg_rating || 0);
    const count = Number(rows[0]?.total_reviews || 0);
    if (count > 0) {
      scored = {
        rating: avg,
        reviewCount: count,
        buyerReviewCount: count,
        unrated: count < MIN_PUBLIC_REVIEWS,
        displayLabel: count < MIN_PUBLIC_REVIEWS ? "UNRATED" : avg.toFixed(2),
      };
    }
  }
  const derived = deriveBadgeTier({
    completedOrders: Number(row.completed_orders || 0),
    rating: scored.rating,
    unrated: scored.unrated,
    isVerified: Boolean(row.is_seller_verified),
    disputeCount: Number(row.dispute_count || 0),
    unresolvedDisputes: Number(row.unresolved_disputes || 0),
    previousTier: row.badge_tier,
  });
  return {
    avgRating: scored.rating,
    totalReviews: scored.buyerReviewCount,
    unrated: scored.unrated,
    displayLabel: scored.displayLabel,
    badgeTier: derived.tier,
    completedOrders: Number(row.completed_orders || 0),
    disputeCount: Number(row.dispute_count || 0),
    unresolvedDisputes: Number(row.unresolved_disputes || 0),
    badges: derived.badges,
    isSellerVerified: Boolean(row.is_seller_verified),
    isVerifiedStore: Boolean(row.is_seller_verified),
  };
}

export {
  RATING_DELTAS,
  deriveBadgeTier,
  clampRating,
  scoreFromPool,
  MIN_PUBLIC_REVIEWS,
  INITIAL_RATING,
};
