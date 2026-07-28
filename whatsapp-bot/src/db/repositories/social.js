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

const OFFER_STATUSES = new Set(["pending", "accepted", "declined", "expired"]);

const FORBIDDEN_PATTERNS = [
  /07\d{8}/,
  /01\d{8}/,
  /\+254\d{9}/,
  /pay outside/i,
  /direct till/i,
  /send cash/i,
];

async function userExists(userId) {
  const { rows } = await query(`SELECT 1 FROM users WHERE id = $1 LIMIT 1`, [userId]);
  return Boolean(rows[0]);
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

export async function toggleProductLike({ userId, productId } = {}) {
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

  let liked = false;
  if (existing.rows[0]) {
    await query(`DELETE FROM product_likes WHERE id = $1`, [existing.rows[0].id]);
  } else {
    await query(`INSERT INTO product_likes (user_id, product_id) VALUES ($1, $2)`, [uid, pid]);
    liked = true;
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

function hasForbiddenMessage(content) {
  return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(content));
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
      handle: row.buyer_handle || null,
      shopName: row.buyer_shop_name || null,
    },
    seller: {
      id: Number(row.seller_user_id),
      handle: row.seller_handle || null,
      shopName: row.seller_shop_name || null,
    },
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
