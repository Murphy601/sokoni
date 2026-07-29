import { isDbEnabled, query } from "../pool.js";

function parseUserId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function parseOfferId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function parseOrderId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function normalizeHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function formatHandle(value, fallback = "") {
  const raw = String(value || fallback || "").trim();
  if (!raw) return "";
  return raw.startsWith("@") ? raw : `@${raw}`;
}

const OFFER_STATUSES = new Set(["pending", "accepted", "declined", "expired"]);

const FORBIDDEN_PATTERNS = [
  /07\d{8}/,
  /01\d{8}/,
  /\+254\d{9}/,
  /pay outside/i,
  /direct till/i,
  /send cash/i,
];

const DEFAULT_OFFER_REMINDER_COOLDOWN_SECONDS = 60;
const MAX_OFFER_REMINDER_COOLDOWN_SECONDS = 600;
const MAX_HANDLED_QUEUE_OFFER_IDS = 200;
const HANDLED_QUEUE_EVENT_ACTIONS = new Set(["handled", "unhandled", "reset"]);
const DEFAULT_HANDLED_QUEUE_EVENTS_LIMIT = 50;
const MAX_HANDLED_QUEUE_EVENTS_LIMIT = 200;

async function userExists(userId) {
  const { rows } = await query(`SELECT 1 FROM users WHERE id = $1 LIMIT 1`, [userId]);
  return Boolean(rows[0]);
}

function parseCooldownSeconds(value, fallback = DEFAULT_OFFER_REMINDER_COOLDOWN_SECONDS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  return Math.min(Math.max(normalized, 5), MAX_OFFER_REMINDER_COOLDOWN_SECONDS);
}

function parseOfferIdList(value, maxItems = MAX_HANDLED_QUEUE_OFFER_IDS) {
  const chunks = Array.isArray(value) ? value : [value];
  const ids = [];
  const seen = new Set();
  chunks.forEach((chunk) => {
    String(chunk || "")
      .split(",")
      .forEach((raw) => {
        const id = parseOfferId(raw);
        if (!id || seen.has(id)) return;
        seen.add(id);
        ids.push(id);
      });
  });
  return ids.slice(0, maxItems);
}

function parseHandledFlag(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return null;
}

function normalizeHandledQueueEventSource(value, fallback = "seller_dashboard") {
  const source = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .slice(0, 64);
  return source || fallback;
}

function parseListLimit(value, fallback = DEFAULT_HANDLED_QUEUE_EVENTS_LIMIT, max = MAX_HANDLED_QUEUE_EVENTS_LIMIT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 1), max);
}

function parseListOffset(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(Math.floor(parsed), 0);
}

function formatKesAmount(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return "KES 0";
  return `KES ${value.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
}

function offerReminderMessage(offer) {
  const title = offer?.product_title || offer?.product_id || "your item";
  const amount = formatKesAmount(offer?.amount_kes);
  return `Hi! I accepted your offer of ${amount} for "${title}". Please complete checkout on Sokoni within 24 hours so I can prepare shipping.`;
}

async function productExists(productId) {
  const { rows } = await query(`SELECT 1 FROM products WHERE id = $1 LIMIT 1`, [productId]);
  return Boolean(rows[0]);
}

async function getOrderByReference(orderRef) {
  const raw = String(orderRef || "").trim();
  if (!raw) return null;

  const numericId = parseOrderId(raw);
  if (numericId) {
    const byId = await query(`SELECT id, tracking_code, status, buyer_id, seller_id FROM orders WHERE id = $1 LIMIT 1`, [
      numericId,
    ]);
    if (byId.rows[0]) return byId.rows[0];
  }

  const byTracking = await query(
    `SELECT id, tracking_code, status, buyer_id, seller_id FROM orders WHERE tracking_code = $1 LIMIT 1`,
    [raw.toUpperCase()]
  );
  return byTracking.rows[0] || null;
}

async function expirePendingOffers() {
  await query(
    `UPDATE offers
      SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending'
       AND expires_at IS NOT NULL
       AND expires_at <= NOW()`
  );
}

/**
 * Toggle or set product like.
 * - omit `liked` → toggle
 * - `liked: true|false` → set absolute state (idempotent; used by bag sync)
 */
export async function toggleProductLike({ userId, productId, liked: likedTarget } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const uid = parseUserId(userId);
  const pid = String(productId || "").trim();
  if (!uid || !pid) {
    return { error: "invalid_request", message: "userId and productId are required." };
  }

  if (!(await userExists(uid))) {
    return { error: "user_not_found", message: "User not found." };
  }
  if (!(await productExists(pid))) {
    return { error: "product_not_found", message: "Product not found." };
  }

  const existing = await query(
    `SELECT id FROM product_likes WHERE user_id = $1 AND product_id = $2 LIMIT 1`,
    [uid, pid]
  );

  const wantLiked =
    likedTarget === true || likedTarget === false || likedTarget === "true" || likedTarget === "false"
      ? likedTarget === true || likedTarget === "true"
      : null;

  let liked = false;
  if (wantLiked === null) {
    if (existing.rows[0]) {
      await query(`DELETE FROM product_likes WHERE id = $1`, [existing.rows[0].id]);
    } else {
      await query(`INSERT INTO product_likes (user_id, product_id) VALUES ($1, $2)`, [uid, pid]);
      liked = true;
    }
  } else if (wantLiked) {
    if (!existing.rows[0]) {
      await query(`INSERT INTO product_likes (user_id, product_id) VALUES ($1, $2)`, [uid, pid]);
    }
    liked = true;
  } else if (existing.rows[0]) {
    await query(`DELETE FROM product_likes WHERE id = $1`, [existing.rows[0].id]);
  }

  const countResult = await query(
    `SELECT COUNT(*)::int AS likes_count FROM product_likes WHERE product_id = $1`,
    [pid]
  );
  const likesCount = Number(countResult.rows[0]?.likes_count || 0);

  return { liked, likesCount, userId: uid, productId: pid };
}

export async function toggleFollow({ followerUserId, followingUserId } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const followerId = parseUserId(followerUserId);
  const targetId = parseUserId(followingUserId);
  if (!followerId || !targetId) {
    return { error: "invalid_request", message: "followerUserId and followingUserId are required." };
  }
  if (followerId === targetId) {
    return { error: "cannot_follow_self", message: "You cannot follow yourself." };
  }

  if (!(await userExists(followerId))) {
    return { error: "follower_not_found", message: "Follower user not found." };
  }
  if (!(await userExists(targetId))) {
    return { error: "following_not_found", message: "Target user not found." };
  }

  const existing = await query(
    `SELECT id FROM follows WHERE follower_user_id = $1 AND following_user_id = $2 LIMIT 1`,
    [followerId, targetId]
  );

  let following = false;
  if (existing.rows[0]) {
    await query(`DELETE FROM follows WHERE id = $1`, [existing.rows[0].id]);
  } else {
    await query(
      `INSERT INTO follows (follower_user_id, following_user_id) VALUES ($1, $2)`,
      [followerId, targetId]
    );
    following = true;
  }

  const stats = await query(
    `SELECT
      (SELECT COUNT(*)::int FROM follows WHERE following_user_id = $1) AS followers_count,
      (SELECT COUNT(*)::int FROM follows WHERE follower_user_id = $1) AS following_count`,
    [targetId]
  );

  return {
    following,
    followerUserId: followerId,
    followingUserId: targetId,
    targetStats: {
      followersCount: Number(stats.rows[0]?.followers_count || 0),
      followingCount: Number(stats.rows[0]?.following_count || 0),
    },
  };
}

export async function getUserSocialStats(userId) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const uid = parseUserId(userId);
  if (!uid) {
    return { error: "invalid_user", message: "Valid userId is required." };
  }
  if (!(await userExists(uid))) {
    return { error: "user_not_found", message: "User not found." };
  }

  const { rows } = await query(
    `SELECT
      (SELECT COUNT(*)::int FROM follows WHERE following_user_id = $1) AS followers_count,
      (SELECT COUNT(*)::int FROM follows WHERE follower_user_id = $1) AS following_count,
      (SELECT COUNT(*)::int FROM products WHERE seller_user_id = $1 AND in_stock = TRUE AND is_sold = FALSE) AS active_listings_count,
      (SELECT COUNT(*)::int
         FROM product_likes pl
         INNER JOIN products p ON p.id = pl.product_id
        WHERE p.seller_user_id = $1) AS likes_received_count,
      (SELECT COALESCE(AVG(rating), 0)::numeric(10,2) FROM order_reviews WHERE seller_user_id = $1) AS avg_rating,
      (SELECT COUNT(*)::int FROM order_reviews WHERE seller_user_id = $1) AS total_reviews`,
    [uid]
  );

  const row = rows[0] || {};
  return {
    userId: uid,
    followersCount: Number(row.followers_count || 0),
    followingCount: Number(row.following_count || 0),
    activeListingsCount: Number(row.active_listings_count || 0),
    likesReceivedCount: Number(row.likes_received_count || 0),
    avgRating: Number(row.avg_rating || 0),
    totalReviews: Number(row.total_reviews || 0),
  };
}

async function getViewerShopState({ viewerUserId, shopUserId, productIds = [] } = {}) {
  const uid = parseUserId(viewerUserId);
  if (!uid) return null;
  if (!(await userExists(uid))) return null;

  const targetId = parseUserId(shopUserId);
  let isFollowing = false;
  if (targetId && targetId !== uid) {
    const existing = await query(
      `SELECT id FROM follows WHERE follower_user_id = $1 AND following_user_id = $2 LIMIT 1`,
      [uid, targetId]
    );
    isFollowing = Boolean(existing.rows[0]);
  }

  const ids = (Array.isArray(productIds) ? productIds : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  let likedProductIds = [];
  if (ids.length) {
    const { rows } = await query(
      `SELECT product_id
         FROM product_likes
        WHERE user_id = $1
          AND product_id = ANY($2::text[])`,
      [uid, ids]
    );
    likedProductIds = rows.map((row) => String(row.product_id));
  }

  return {
    userId: uid,
    isFollowing,
    likedProductIds,
  };
}

async function attachViewerToShopProfile(profile, viewerUserId) {
  if (!profile || profile.error) return profile;
  const viewer = await getViewerShopState({
    viewerUserId,
    shopUserId: profile?.shop?.userId,
    productIds: (profile.products || []).map((item) => item.id),
  });
  if (!viewer) return profile;

  const likedSet = new Set(viewer.likedProductIds);
  return {
    ...profile,
    viewer,
    products: (profile.products || []).map((item) => ({
      ...item,
      liked: likedSet.has(String(item.id)),
    })),
  };
}

export async function getShopProfileByHandle({
  handle,
  limit = 24,
  offset = 0,
  viewerUserId = null,
} = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const cleanHandle = normalizeHandle(handle);
  if (!cleanHandle) {
    return { error: "invalid_handle", message: "A valid shop handle is required." };
  }

  const userResult = await query(
    `SELECT
       id,
       phone,
       email,
       handle,
       display_name,
       shop_name,
       bio,
       avatar_url,
       location,
       role,
       is_seller_verified
     FROM users
     WHERE LOWER(handle) = $1 OR LOWER(handle) = $2
     LIMIT 1`,
    [cleanHandle, `@${cleanHandle}`]
  );
  const user = userResult.rows[0] || null;

  if (user) {
    const linkedSellerResult = await query(
      `SELECT id, business_name, slug, city, bio, is_verified
         FROM sellers
        WHERE user_id = $1
        LIMIT 1`,
      [user.id]
    );
    const linkedSeller = linkedSellerResult.rows[0] || null;
    const storefront = await listActiveStorefrontProducts({
      sellerUserId: user.id,
      sellerId: linkedSeller?.id || null,
      limit,
      offset,
    });
    const likesReceived = await getLikesReceivedForOwner({
      sellerUserId: user.id,
      sellerId: linkedSeller?.id || null,
    });
    const follows = await getFollowCounts(user.id);
    const reviewSummary = await getReviewSummary(user.id);

    return attachViewerToShopProfile(
      {
        shop: {
          userId: Number(user.id),
          sellerId: linkedSeller?.id != null ? Number(linkedSeller.id) : null,
          handle: formatHandle(user.handle, cleanHandle),
          shopName:
            user.shop_name ||
            linkedSeller?.business_name ||
            user.display_name ||
            `Shop ${user.id}`,
          bio: user.bio || linkedSeller?.bio || null,
          avatarUrl: user.avatar_url || null,
          location: user.location || linkedSeller?.city || null,
          isSellerVerified: Boolean(user.is_seller_verified || linkedSeller?.is_verified),
          role: user.role || "seller",
          source: linkedSeller ? "user_linked_seller" : "user",
        },
        stats: {
          listingsCount: storefront.count,
          followersCount: follows.followersCount,
          followingCount: follows.followingCount,
          likesReceivedCount: likesReceived,
          avgRating: reviewSummary.avgRating,
          totalReviews: reviewSummary.totalReviews,
        },
        products: storefront.products,
        pagination: { limit: storefront.limit, offset: storefront.offset, total: storefront.count },
      },
      viewerUserId
    );
  }

  const sellerResult = await query(
    `SELECT
       s.id,
       s.user_id,
       s.business_name,
       s.slug,
       s.city,
       s.bio,
       s.is_verified
     FROM sellers s
     WHERE LOWER(s.slug) = $1
     LIMIT 1`,
    [cleanHandle]
  );
  const seller = sellerResult.rows[0] || null;
  if (!seller) {
    return { error: "shop_not_found", message: "Shop handle not found." };
  }

  let sellerUser = null;
  if (seller.user_id != null) {
    const sellerUserResult = await query(
      `SELECT
         id,
         handle,
         display_name,
         shop_name,
         bio,
         avatar_url,
         location,
         role,
         is_seller_verified
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [seller.user_id]
    );
    sellerUser = sellerUserResult.rows[0] || null;
  }

  const storefront = await listActiveStorefrontProducts({
    sellerUserId: sellerUser?.id || null,
    sellerId: seller.id,
    limit,
    offset,
  });
  const likesReceived = await getLikesReceivedForOwner({
    sellerUserId: sellerUser?.id || null,
    sellerId: seller.id,
  });
  const follows = await getFollowCounts(sellerUser?.id || null);
  const reviewSummary = await getReviewSummary(sellerUser?.id || null);

  return attachViewerToShopProfile(
    {
      shop: {
        userId: sellerUser?.id != null ? Number(sellerUser.id) : null,
        sellerId: Number(seller.id),
        handle: formatHandle(sellerUser?.handle, seller.slug),
        shopName:
          sellerUser?.shop_name ||
          seller.business_name ||
          sellerUser?.display_name ||
          `Shop ${seller.id}`,
        bio: sellerUser?.bio || seller.bio || null,
        avatarUrl: sellerUser?.avatar_url || null,
        location: sellerUser?.location || seller.city || null,
        isSellerVerified: Boolean(sellerUser?.is_seller_verified || seller.is_verified),
        role: sellerUser?.role || "seller",
        source: sellerUser ? "seller_linked_user" : "seller",
      },
      stats: {
        listingsCount: storefront.count,
        followersCount: follows.followersCount,
        followingCount: follows.followingCount,
        likesReceivedCount: likesReceived,
        avgRating: reviewSummary.avgRating,
        totalReviews: reviewSummary.totalReviews,
      },
      products: storefront.products,
      pagination: { limit: storefront.limit, offset: storefront.offset, total: storefront.count },
    },
    viewerUserId
  );
}

function hasForbiddenMessage(content) {
  return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(content));
}

function mapStorefrontProductRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || null,
    priceKsh: row.price_kes != null ? Number(row.price_kes) : null,
    priceKes: row.price_kes != null ? Number(row.price_kes) : null,
    imageUrl: row.image_url || row.primary_image_url || null,
    category: row.category,
    subCategory: row.sub_category || null,
    size: row.size_label || null,
    condition: row.condition || null,
    brand: row.brand || null,
    genderFit: row.gender_fit || null,
    isSecondhand: Boolean(row.is_secondhand),
    likesCount: Number(row.likes_count || 0),
    createdAt: row.created_at,
  };
}

async function listActiveStorefrontProducts({ sellerUserId = null, sellerId = null, limit = 24, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 24, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const ownerParams = [];
  const ownerClauses = [];
  if (sellerUserId != null) {
    ownerParams.push(Number(sellerUserId));
    ownerClauses.push(`p.seller_user_id = $${ownerParams.length}`);
  }
  if (sellerId != null) {
    ownerParams.push(Number(sellerId));
    ownerClauses.push(`p.seller_id = $${ownerParams.length}`);
  }
  if (!ownerClauses.length) {
    return { products: [], count: 0, limit: safeLimit, offset: safeOffset };
  }

  const whereOwner = `(${ownerClauses.join(" OR ")})`;
  const whereActive = `${whereOwner} AND p.in_stock = TRUE AND p.is_sold = FALSE`;

  const listParams = [...ownerParams, safeLimit, safeOffset];
  const listLimitParam = `$${ownerParams.length + 1}`;
  const listOffsetParam = `$${ownerParams.length + 2}`;

  const { rows } = await query(
    `SELECT
       p.id,
       p.title,
       p.description,
       p.price_kes,
       p.primary_image_url,
       p.category,
       p.sub_category,
       p.size_label,
       p.condition,
       p.brand,
       p.gender_fit,
       p.is_secondhand,
       p.created_at,
       COALESCE(
         (SELECT pi.url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order ASC LIMIT 1),
         p.primary_image_url
       ) AS image_url,
       COALESCE(pl.likes_count, 0)::int AS likes_count
     FROM products p
     LEFT JOIN (
       SELECT product_id, COUNT(*)::int AS likes_count
       FROM product_likes
       GROUP BY product_id
     ) pl ON pl.product_id = p.id
     WHERE ${whereActive}
     ORDER BY p.created_at DESC
     LIMIT ${listLimitParam}
     OFFSET ${listOffsetParam}`,
    listParams
  );

  const countResult = await query(
    `SELECT COUNT(*)::int AS listings_count
       FROM products p
      WHERE ${whereActive}`,
    ownerParams
  );

  return {
    products: rows.map(mapStorefrontProductRow),
    count: Number(countResult.rows[0]?.listings_count || 0),
    limit: safeLimit,
    offset: safeOffset,
  };
}

async function getLikesReceivedForOwner({ sellerUserId = null, sellerId = null } = {}) {
  const ownerParams = [];
  const ownerClauses = [];
  if (sellerUserId != null) {
    ownerParams.push(Number(sellerUserId));
    ownerClauses.push(`p.seller_user_id = $${ownerParams.length}`);
  }
  if (sellerId != null) {
    ownerParams.push(Number(sellerId));
    ownerClauses.push(`p.seller_id = $${ownerParams.length}`);
  }
  if (!ownerClauses.length) return 0;

  const { rows } = await query(
    `SELECT COUNT(*)::int AS likes_received_count
       FROM product_likes pl
       INNER JOIN products p ON p.id = pl.product_id
      WHERE ${ownerClauses.map((c) => `(${c})`).join(" OR ")}`,
    ownerParams
  );
  return Number(rows[0]?.likes_received_count || 0);
}

async function getFollowCounts(userId = null) {
  if (!userId) return { followersCount: 0, followingCount: 0 };
  const { rows } = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM follows WHERE following_user_id = $1) AS followers_count,
       (SELECT COUNT(*)::int FROM follows WHERE follower_user_id = $1) AS following_count`,
    [Number(userId)]
  );
  return {
    followersCount: Number(rows[0]?.followers_count || 0),
    followingCount: Number(rows[0]?.following_count || 0),
  };
}

async function getReviewSummary(userId = null) {
  if (!userId) return { avgRating: 0, totalReviews: 0 };
  const { rows } = await query(
    `SELECT
       COALESCE(AVG(rating), 0)::numeric(10,2) AS avg_rating,
       COUNT(*)::int AS total_reviews
     FROM order_reviews
     WHERE seller_user_id = $1`,
    [Number(userId)]
  );
  return {
    avgRating: Number(rows[0]?.avg_rating || 0),
    totalReviews: Number(rows[0]?.total_reviews || 0),
  };
}

function mapOfferRow(row) {
  return {
    id: Number(row.id),
    productId: row.product_id,
    buyerUserId: Number(row.buyer_user_id),
    sellerUserId: Number(row.seller_user_id),
    amountKsh: Number(row.amount_kes),
    status: row.status,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    product: {
      id: row.product_id,
      title: row.product_title || null,
      priceKsh: row.product_price_kes != null ? Number(row.product_price_kes) : null,
      imageUrl: row.product_image_url || null,
    },
    buyer: {
      id: Number(row.buyer_user_id),
      handle: row.buyer_handle ? formatHandle(row.buyer_handle) : null,
      shopName: row.buyer_shop_name || null,
    },
    seller: {
      id: Number(row.seller_user_id),
      handle: row.seller_handle ? formatHandle(row.seller_handle) : null,
      shopName: row.seller_shop_name || null,
    },
  };
}

function mapHandledQueueRow(row) {
  return {
    offerId: Number(row.offer_id),
    sellerUserId: Number(row.seller_user_id),
    handled: true,
    handledAt: row.handled_at || null,
    updatedAt: row.updated_at || row.handled_at || null,
  };
}

function mapHandledQueueEventRow(row) {
  return {
    id: Number(row.id),
    offerId: Number(row.offer_id),
    sellerUserId: Number(row.seller_user_id),
    action: String(row.action || "").trim().toLowerCase(),
    source: row.source || "seller_dashboard",
    createdAt: row.created_at || null,
  };
}

export async function createOffer({
  productId,
  buyerUserId,
  sellerUserId,
  amountKsh,
  expiresInHours = 24,
} = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const product = String(productId || "").trim();
  const buyerId = parseUserId(buyerUserId);
  const sellerId = parseUserId(sellerUserId);
  const amount = Number(amountKsh);
  const expiryHours = Math.min(Math.max(Number(expiresInHours) || 24, 1), 168);

  if (!product || !buyerId || !sellerId || !Number.isFinite(amount) || amount <= 0) {
    return {
      error: "invalid_offer_payload",
      message: "productId, buyerUserId, sellerUserId and positive amountKsh are required.",
    };
  }
  if (buyerId === sellerId) {
    return { error: "invalid_offer_payload", message: "Buyer and seller cannot be the same user." };
  }
  if (!(await userExists(buyerId))) {
    return { error: "buyer_not_found", message: "Buyer user not found." };
  }
  if (!(await userExists(sellerId))) {
    return { error: "seller_not_found", message: "Seller user not found." };
  }

  const productRow = await query(
    `SELECT id, seller_user_id, price_kes, in_stock, is_sold FROM products WHERE id = $1 LIMIT 1`,
    [product]
  );
  const productData = productRow.rows[0];
  if (!productData) {
    return { error: "product_not_found", message: "Product not found." };
  }
  if (productData.seller_user_id != null && Number(productData.seller_user_id) !== sellerId) {
    return {
      error: "seller_mismatch",
      message: "Offer seller does not match this product owner.",
    };
  }
  if (productData.in_stock === false || productData.is_sold === true) {
    return {
      error: "product_unavailable",
      message: "This product is no longer available for offers.",
    };
  }
  if (productData.price_kes != null && amount > Number(productData.price_kes)) {
    return {
      error: "offer_above_price",
      message: "Offer amount cannot exceed listed product price.",
    };
  }

  await expirePendingOffers();

  const existing = await query(
    `SELECT id
       FROM offers
      WHERE product_id = $1
        AND buyer_user_id = $2
        AND seller_user_id = $3
        AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1`,
    [product, buyerId, sellerId]
  );

  let offerId = null;
  if (existing.rows[0]) {
    offerId = Number(existing.rows[0].id);
    await query(
      `UPDATE offers
          SET amount_kes = $2,
              expires_at = NOW() + ($3 || ' hours')::interval,
              updated_at = NOW()
        WHERE id = $1`,
      [offerId, amount, String(expiryHours)]
    );
  } else {
    const inserted = await query(
      `INSERT INTO offers (product_id, buyer_user_id, seller_user_id, amount_kes, status, expires_at)
       VALUES ($1, $2, $3, $4, 'pending', NOW() + ($5 || ' hours')::interval)
       RETURNING id`,
      [product, buyerId, sellerId, amount, String(expiryHours)]
    );
    offerId = Number(inserted.rows[0].id);
  }

  const hydrated = await query(
    `SELECT
       o.*,
       p.title AS product_title,
       p.price_kes AS product_price_kes,
       p.primary_image_url AS product_image_url,
       buyer.handle AS buyer_handle,
       buyer.shop_name AS buyer_shop_name,
       seller.handle AS seller_handle,
       seller.shop_name AS seller_shop_name
     FROM offers o
     LEFT JOIN products p ON p.id = o.product_id
     LEFT JOIN users buyer ON buyer.id = o.buyer_user_id
     LEFT JOIN users seller ON seller.id = o.seller_user_id
     WHERE o.id = $1
     LIMIT 1`,
    [offerId]
  );

  return { success: true, offer: mapOfferRow(hydrated.rows[0]) };
}

export async function respondToOffer({ offerId, sellerUserId, action } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const oid = parseOfferId(offerId);
  const sellerId = parseUserId(sellerUserId);
  const normalizedAction = String(action || "")
    .trim()
    .toLowerCase();
  if (!oid || !sellerId || !["accepted", "declined"].includes(normalizedAction)) {
    return {
      error: "invalid_offer_action",
      message: "offerId, sellerUserId, and action (accepted|declined) are required.",
    };
  }
  if (!(await userExists(sellerId))) {
    return { error: "seller_not_found", message: "Seller user not found." };
  }

  await expirePendingOffers();

  const current = await query(`SELECT * FROM offers WHERE id = $1 LIMIT 1`, [oid]);
  const offer = current.rows[0];
  if (!offer) {
    return { error: "offer_not_found", message: "Offer not found." };
  }
  if (Number(offer.seller_user_id) !== sellerId) {
    return { error: "forbidden_offer_action", message: "Only the seller can respond to this offer." };
  }
  if (!OFFER_STATUSES.has(offer.status) || offer.status !== "pending") {
    return {
      error: "offer_not_pending",
      message: `Offer is already ${offer.status}.`,
    };
  }
  if (offer.expires_at && new Date(offer.expires_at).getTime() <= Date.now()) {
    await query(`UPDATE offers SET status = 'expired', updated_at = NOW() WHERE id = $1`, [oid]);
    return { error: "offer_expired", message: "Offer has expired." };
  }

  const expiresSql =
    normalizedAction === "accepted"
      ? `NOW() + INTERVAL '24 hours'`
      : `expires_at`;
  await query(
    `UPDATE offers
        SET status = $2,
            expires_at = ${expiresSql},
            updated_at = NOW()
      WHERE id = $1`,
    [oid, normalizedAction]
  );

  const hydrated = await query(
    `SELECT
       o.*,
       p.title AS product_title,
       p.price_kes AS product_price_kes,
       p.primary_image_url AS product_image_url,
       buyer.handle AS buyer_handle,
       buyer.shop_name AS buyer_shop_name,
       seller.handle AS seller_handle,
       seller.shop_name AS seller_shop_name
     FROM offers o
     LEFT JOIN products p ON p.id = o.product_id
     LEFT JOIN users buyer ON buyer.id = o.buyer_user_id
     LEFT JOIN users seller ON seller.id = o.seller_user_id
     WHERE o.id = $1
     LIMIT 1`,
    [oid]
  );

  return { success: true, offer: mapOfferRow(hydrated.rows[0]) };
}

export async function sendOfferReminder({ offerId, sellerUserId, cooldownSeconds } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const oid = parseOfferId(offerId);
  const sellerId = parseUserId(sellerUserId);
  const cooldownSec = parseCooldownSeconds(cooldownSeconds);
  const cooldownMs = cooldownSec * 1000;
  if (!oid || !sellerId) {
    return {
      error: "invalid_offer_action",
      message: "offerId and sellerUserId are required.",
    };
  }
  if (!(await userExists(sellerId))) {
    return { error: "seller_not_found", message: "Seller user not found." };
  }

  await expirePendingOffers();

  const offerResult = await query(
    `SELECT
       o.*,
       p.title AS product_title
     FROM offers o
     LEFT JOIN products p ON p.id = o.product_id
     WHERE o.id = $1
     LIMIT 1`,
    [oid]
  );
  const offer = offerResult.rows[0];
  if (!offer) {
    return { error: "offer_not_found", message: "Offer not found." };
  }
  if (Number(offer.seller_user_id) !== sellerId) {
    return { error: "forbidden_offer_action", message: "Only the seller can send reminders for this offer." };
  }

  const status = String(offer.status || "")
    .trim()
    .toLowerCase();
  if (status !== "accepted") {
    return {
      error: "offer_not_accepted",
      message: `Offer is ${status || "not accepted"} and cannot be reminded.`,
    };
  }
  if (offer.expires_at && new Date(offer.expires_at).getTime() <= Date.now()) {
    await query(`UPDATE offers SET status = 'expired', updated_at = NOW() WHERE id = $1`, [oid]);
    return { error: "offer_expired", message: "Offer has expired." };
  }

  const buyerId = parseUserId(offer.buyer_user_id);
  if (!buyerId || buyerId === sellerId) {
    return {
      error: "invalid_offer_action",
      message: "Could not resolve buyer profile for this offer reminder.",
    };
  }

  const reminderRow = await query(
    `SELECT created_at
       FROM offer_reminders
      WHERE offer_id = $1
        AND seller_user_id = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [oid, sellerId]
  );
  const lastReminderAtRaw = reminderRow.rows[0]?.created_at || null;
  const lastReminderMs = lastReminderAtRaw ? new Date(lastReminderAtRaw).getTime() : 0;
  const nowMs = Date.now();
  const cooldownMsRemaining = Math.max(0, lastReminderMs + cooldownMs - nowMs);
  if (cooldownMsRemaining > 0) {
    return {
      error: "reminder_cooldown_active",
      message: `Reminder already sent. Try again in ${Math.ceil(cooldownMsRemaining / 1000)}s.`,
      cooldownMsRemaining,
      cooldownSecondsRemaining: Math.ceil(cooldownMsRemaining / 1000),
      lastReminderAt: new Date(lastReminderMs).toISOString(),
      cooldownEndsAt: new Date(lastReminderMs + cooldownMs).toISOString(),
    };
  }

  const messageResult = await sendDirectMessage({
    senderUserId: sellerId,
    receiverUserId: buyerId,
    content: offerReminderMessage(offer),
  });
  if (messageResult.error) return messageResult;

  const messageId = Number(messageResult.message?.id);
  await query(
    `INSERT INTO offer_reminders (offer_id, seller_user_id, buyer_user_id, message_id)
     VALUES ($1, $2, $3, $4)`,
    [oid, sellerId, buyerId, Number.isInteger(messageId) && messageId > 0 ? messageId : null]
  );

  const sentAtMs = Date.now();
  return {
    success: true,
    reminder: {
      offerId: oid,
      sellerUserId: sellerId,
      buyerUserId: buyerId,
      sentAt: new Date(sentAtMs).toISOString(),
      cooldownMs,
      cooldownSeconds: cooldownSec,
      cooldownEndsAt: new Date(sentAtMs + cooldownMs).toISOString(),
      messageId: Number.isInteger(messageId) && messageId > 0 ? messageId : null,
      message: messageResult.message,
    },
  };
}

export async function listSellerHandledOfferQueue({ sellerUserId, offerIds } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const sellerId = parseUserId(sellerUserId);
  if (!sellerId) {
    return { error: "invalid_user", message: "Valid sellerUserId is required." };
  }
  if (!(await userExists(sellerId))) {
    return { error: "seller_not_found", message: "Seller user not found." };
  }

  const requestedOfferIds = parseOfferIdList(offerIds);
  const params = [sellerId];
  let whereSql = `seller_user_id = $1`;
  if (requestedOfferIds.length) {
    params.push(requestedOfferIds);
    whereSql += ` AND offer_id = ANY($2::bigint[])`;
  }

  const { rows } = await query(
    `SELECT offer_id, seller_user_id, handled_at, updated_at
       FROM offer_handled_queue
      WHERE ${whereSql}
      ORDER BY handled_at DESC`,
    params
  );
  const byOfferId = new Map();
  rows.forEach((row) => {
    byOfferId.set(Number(row.offer_id), row);
  });

  const states = requestedOfferIds.length
    ? requestedOfferIds.map((id) => {
        const row = byOfferId.get(id);
        if (!row) {
          return {
            offerId: id,
            sellerUserId: sellerId,
            handled: false,
            handledAt: null,
            updatedAt: null,
          };
        }
        return mapHandledQueueRow(row);
      })
    : rows.map(mapHandledQueueRow);

  return {
    sellerUserId: sellerId,
    states,
    count: states.length,
    handledCount: rows.length,
  };
}

export async function setSellerHandledOfferQueueState({ offerId, sellerUserId, handled, source } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const oid = parseOfferId(offerId);
  const sellerId = parseUserId(sellerUserId);
  const handledFlag = parseHandledFlag(handled);
  const eventSource = normalizeHandledQueueEventSource(source);
  if (!oid || !sellerId || handledFlag == null) {
    return {
      error: "invalid_offer_action",
      message: "offerId, sellerUserId, and handled (true/false) are required.",
    };
  }
  if (!(await userExists(sellerId))) {
    return { error: "seller_not_found", message: "Seller user not found." };
  }

  await expirePendingOffers();

  const current = await query(
    `SELECT id, status, expires_at, buyer_user_id, seller_user_id
       FROM offers
      WHERE id = $1
      LIMIT 1`,
    [oid]
  );
  const offer = current.rows[0];
  if (!offer) {
    return { error: "offer_not_found", message: "Offer not found." };
  }
  if (Number(offer.seller_user_id) !== sellerId) {
    return { error: "forbidden_offer_action", message: "Only the seller can update this quick queue state." };
  }

  if (handledFlag) {
    const status = String(offer.status || "")
      .trim()
      .toLowerCase();
    if (status !== "accepted") {
      return {
        error: "offer_not_accepted",
        message: `Offer is ${status || "not accepted"} and cannot be added to handled queue.`,
      };
    }
    if (offer.expires_at && new Date(offer.expires_at).getTime() <= Date.now()) {
      await query(`UPDATE offers SET status = 'expired', updated_at = NOW() WHERE id = $1`, [oid]);
      await query(`DELETE FROM offer_handled_queue WHERE offer_id = $1 AND seller_user_id = $2`, [oid, sellerId]);
      return { error: "offer_expired", message: "Offer has expired." };
    }
    const buyerId = parseUserId(offer.buyer_user_id);
    if (!buyerId || buyerId === sellerId) {
      return {
        error: "invalid_offer_action",
        message: "Could not resolve buyer profile for this handled-offer action.",
      };
    }

    const upserted = await query(
      `INSERT INTO offer_handled_queue (offer_id, seller_user_id, handled_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (offer_id, seller_user_id)
       DO UPDATE SET handled_at = EXCLUDED.handled_at, updated_at = NOW()
       RETURNING offer_id, seller_user_id, handled_at, updated_at`,
      [oid, sellerId]
    );
    await query(
      `INSERT INTO offer_handled_queue_events (offer_id, seller_user_id, action, source)
       VALUES ($1, $2, 'handled', $3)`,
      [oid, sellerId, eventSource]
    );
    return { success: true, state: mapHandledQueueRow(upserted.rows[0]) };
  }

  const removed = await query(`DELETE FROM offer_handled_queue WHERE offer_id = $1 AND seller_user_id = $2 RETURNING offer_id`, [
    oid,
    sellerId,
  ]);
  if (removed.rows[0]) {
    await query(
      `INSERT INTO offer_handled_queue_events (offer_id, seller_user_id, action, source)
       VALUES ($1, $2, 'unhandled', $3)`,
      [oid, sellerId, eventSource]
    );
  }
  return {
    success: true,
    state: {
      offerId: oid,
      sellerUserId: sellerId,
      handled: false,
      handledAt: null,
      updatedAt: new Date().toISOString(),
    },
  };
}

export async function resetSellerHandledOfferQueue({ sellerUserId, source } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const sellerId = parseUserId(sellerUserId);
  const eventSource = normalizeHandledQueueEventSource(source);
  if (!sellerId) {
    return { error: "invalid_user", message: "Valid sellerUserId is required." };
  }
  if (!(await userExists(sellerId))) {
    return { error: "seller_not_found", message: "Seller user not found." };
  }

  const cleared = await query(
    `WITH removed AS (
       DELETE FROM offer_handled_queue
        WHERE seller_user_id = $1
      RETURNING offer_id, seller_user_id
     ),
     logged AS (
       INSERT INTO offer_handled_queue_events (offer_id, seller_user_id, action, source)
       SELECT offer_id, seller_user_id, 'reset', $2
         FROM removed
       RETURNING id
     )
     SELECT COUNT(*)::int AS cleared_count FROM removed`,
    [sellerId, eventSource]
  );
  return {
    success: true,
    sellerUserId: sellerId,
    clearedCount: Number(cleared.rows[0]?.cleared_count || 0),
  };
}

export async function listSellerHandledOfferQueueEvents({
  sellerUserId,
  offerId,
  action,
  limit = DEFAULT_HANDLED_QUEUE_EVENTS_LIMIT,
  offset = 0,
} = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const sellerId = parseUserId(sellerUserId);
  if (!sellerId) {
    return { error: "invalid_user", message: "Valid sellerUserId is required." };
  }
  if (!(await userExists(sellerId))) {
    return { error: "seller_not_found", message: "Seller user not found." };
  }

  const requestedOfferId = offerId == null || offerId === "" ? null : parseOfferId(offerId);
  if (offerId != null && offerId !== "" && !requestedOfferId) {
    return { error: "invalid_offer", message: "Valid offerId is required when provided." };
  }

  const normalizedAction = action == null ? null : String(action).trim().toLowerCase();
  if (normalizedAction && !HANDLED_QUEUE_EVENT_ACTIONS.has(normalizedAction)) {
    return {
      error: "invalid_event_action",
      message: "action must be one of handled, unhandled, or reset.",
    };
  }

  const safeLimit = parseListLimit(limit);
  const safeOffset = parseListOffset(offset);
  const params = [sellerId];
  const whereClauses = [`seller_user_id = $1`];
  if (requestedOfferId) {
    params.push(requestedOfferId);
    whereClauses.push(`offer_id = $${params.length}`);
  }
  if (normalizedAction) {
    params.push(normalizedAction);
    whereClauses.push(`action = $${params.length}`);
  }
  params.push(safeLimit);
  const limitParam = `$${params.length}`;
  params.push(safeOffset);
  const offsetParam = `$${params.length}`;

  const { rows } = await query(
    `SELECT id, offer_id, seller_user_id, action, source, created_at
       FROM offer_handled_queue_events
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}`,
    params
  );

  return {
    sellerUserId: sellerId,
    events: rows.map(mapHandledQueueEventRow),
    count: rows.length,
    limit: safeLimit,
    offset: safeOffset,
    filters: {
      offerId: requestedOfferId,
      action: normalizedAction,
    },
  };
}

export async function listOffers({ userId, role = "buyer", status, limit = 30, offset = 0 } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const uid = parseUserId(userId);
  const normalizedRole = String(role || "buyer")
    .trim()
    .toLowerCase();
  const normalizedStatus = status != null ? String(status).trim().toLowerCase() : null;
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  if (!uid) return { error: "invalid_user", message: "Valid userId is required." };
  if (!(await userExists(uid))) return { error: "user_not_found", message: "User not found." };
  if (!["buyer", "seller"].includes(normalizedRole)) {
    return { error: "invalid_role", message: "role must be buyer or seller." };
  }
  if (normalizedStatus && normalizedStatus !== "all" && !OFFER_STATUSES.has(normalizedStatus)) {
    return {
      error: "invalid_offer_status",
      message: "status must be one of pending, accepted, declined, expired, or all.",
    };
  }

  await expirePendingOffers();

  const params = [uid];
  const whereClauses = [
    normalizedRole === "buyer" ? `o.buyer_user_id = $1` : `o.seller_user_id = $1`,
  ];
  if (normalizedStatus && normalizedStatus !== "all") {
    params.push(normalizedStatus);
    whereClauses.push(`o.status = $${params.length}`);
  }

  params.push(safeLimit);
  const limitParam = `$${params.length}`;
  params.push(safeOffset);
  const offsetParam = `$${params.length}`;

  const { rows } = await query(
    `SELECT
       o.*,
       p.title AS product_title,
       p.price_kes AS product_price_kes,
       p.primary_image_url AS product_image_url,
       buyer.handle AS buyer_handle,
       buyer.shop_name AS buyer_shop_name,
       seller.handle AS seller_handle,
       seller.shop_name AS seller_shop_name
     FROM offers o
     LEFT JOIN products p ON p.id = o.product_id
     LEFT JOIN users buyer ON buyer.id = o.buyer_user_id
     LEFT JOIN users seller ON seller.id = o.seller_user_id
     WHERE ${whereClauses.join(" AND ")}
     ORDER BY o.created_at DESC
     LIMIT ${limitParam}
     OFFSET ${offsetParam}`,
    params
  );

  return { offers: rows.map(mapOfferRow), count: rows.length, limit: safeLimit, offset: safeOffset };
}

export async function sendDirectMessage({ senderUserId, receiverUserId, content } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const senderId = parseUserId(senderUserId);
  const receiverId = parseUserId(receiverUserId);
  const body = String(content || "").trim();

  if (!senderId || !receiverId || !body) {
    return {
      error: "invalid_message_payload",
      message: "senderUserId, receiverUserId, and content are required.",
    };
  }
  if (!(await userExists(senderId))) {
    return { error: "sender_not_found", message: "Sender user not found." };
  }
  if (!(await userExists(receiverId))) {
    return { error: "receiver_not_found", message: "Receiver user not found." };
  }
  if (senderId === receiverId) {
    return { error: "invalid_message_payload", message: "Cannot send a message to yourself." };
  }
  if (body.length > 2000) {
    return { error: "message_too_long", message: "Message must be 2000 characters or less." };
  }
  if (hasForbiddenMessage(body)) {
    return {
      error: "message_blocked",
      message:
        "Message blocked: For your safety, sharing phone numbers or negotiating offline payments is strictly prohibited.",
    };
  }

  const { rows } = await query(
    `INSERT INTO messages (sender_user_id, receiver_user_id, content, is_flagged)
     VALUES ($1, $2, $3, FALSE)
     RETURNING id, sender_user_id, receiver_user_id, content, created_at`,
    [senderId, receiverId, body]
  );
  const row = rows[0];
  return {
    success: true,
    message: {
      id: Number(row.id),
      senderUserId: Number(row.sender_user_id),
      receiverUserId: Number(row.receiver_user_id),
      content: row.content,
      createdAt: row.created_at,
    },
  };
}

export async function getDirectThread({ userAId, userBId, limit = 50, offset = 0 } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const a = parseUserId(userAId);
  const b = parseUserId(userBId);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  if (!a || !b) return { error: "invalid_thread_users", message: "userAId and userBId are required." };
  if (!(await userExists(a)) || !(await userExists(b))) {
    return { error: "user_not_found", message: "One or both users not found." };
  }

  const { rows } = await query(
    `SELECT id, sender_user_id, receiver_user_id, content, is_flagged, moderation_note, created_at
       FROM messages
      WHERE (sender_user_id = $1 AND receiver_user_id = $2)
         OR (sender_user_id = $2 AND receiver_user_id = $1)
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4`,
    [a, b, safeLimit, safeOffset]
  );

  const messages = rows
    .map((row) => ({
      id: Number(row.id),
      senderUserId: Number(row.sender_user_id),
      receiverUserId: Number(row.receiver_user_id),
      content: row.content,
      isFlagged: Boolean(row.is_flagged),
      moderationNote: row.moderation_note || null,
      createdAt: row.created_at,
    }))
    .reverse();

  return { messages, count: messages.length, limit: safeLimit, offset: safeOffset };
}

function mapReviewRow(row) {
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    orderTrackingCode: row.tracking_code || null,
    sellerUserId: Number(row.seller_user_id),
    buyerUserId: Number(row.buyer_user_id),
    rating: Number(row.rating),
    comment: row.comment || null,
    createdAt: row.created_at,
  };
}

export async function createOrderReview({ orderId, buyerUserId, sellerUserId, rating, comment = "" } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const buyerId = parseUserId(buyerUserId);
  const sellerId = parseUserId(sellerUserId);
  const score = Number(rating);
  const text = String(comment || "").trim();

  if (!orderId || !buyerId || !sellerId || !Number.isFinite(score)) {
    return {
      error: "invalid_review_payload",
      message: "orderId, buyerUserId, sellerUserId, and rating are required.",
    };
  }
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return { error: "invalid_rating", message: "rating must be an integer from 1 to 5." };
  }
  if (buyerId === sellerId) {
    return { error: "invalid_review_payload", message: "buyerUserId and sellerUserId cannot be the same." };
  }
  if (!(await userExists(buyerId))) {
    return { error: "buyer_not_found", message: "Buyer user not found." };
  }
  if (!(await userExists(sellerId))) {
    return { error: "seller_not_found", message: "Seller user not found." };
  }

  const order = await getOrderByReference(orderId);
  if (!order) {
    return { error: "order_not_found", message: "Order not found." };
  }

  const status = String(order.status || "").toLowerCase();
  if (!["delivered", "completed"].includes(status)) {
    return {
      error: "review_not_allowed",
      message: "Reviews can only be left for delivered items.",
    };
  }

  if (order.buyer_id != null && Number(order.buyer_id) !== buyerId) {
    return {
      error: "buyer_mismatch",
      message: "This order does not belong to the buyer provided.",
    };
  }
  if (order.seller_id != null && Number(order.seller_id) !== sellerId) {
    return {
      error: "seller_mismatch",
      message: "This order does not belong to the seller provided.",
    };
  }

  const existing = await query(`SELECT id FROM order_reviews WHERE order_id = $1 LIMIT 1`, [order.id]);
  if (existing.rows[0]) {
    return {
      error: "review_exists",
      message: "A review for this order already exists.",
    };
  }

  const inserted = await query(
    `INSERT INTO order_reviews (order_id, seller_user_id, buyer_user_id, rating, comment)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, order_id, seller_user_id, buyer_user_id, rating, comment, created_at`,
    [order.id, sellerId, buyerId, score, text || null]
  );

  const review = {
    ...mapReviewRow(inserted.rows[0]),
    orderTrackingCode: order.tracking_code || null,
  };
  return { success: true, review };
}

export async function listSellerReviews({ sellerUserId, limit = 20, offset = 0 } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const sellerId = parseUserId(sellerUserId);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  if (!sellerId) return { error: "invalid_user", message: "Valid sellerUserId is required." };
  if (!(await userExists(sellerId))) {
    return { error: "seller_not_found", message: "Seller user not found." };
  }

  const { rows } = await query(
    `SELECT
       r.id,
       r.order_id,
       r.seller_user_id,
       r.buyer_user_id,
       r.rating,
       r.comment,
       r.created_at,
       o.tracking_code
     FROM order_reviews r
     LEFT JOIN orders o ON o.id = r.order_id
     WHERE r.seller_user_id = $1
     ORDER BY r.created_at DESC
     LIMIT $2 OFFSET $3`,
    [sellerId, safeLimit, safeOffset]
  );

  return {
    reviews: rows.map(mapReviewRow),
    count: rows.length,
    limit: safeLimit,
    offset: safeOffset,
  };
}
