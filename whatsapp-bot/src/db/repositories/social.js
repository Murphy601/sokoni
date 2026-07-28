import { isDbEnabled, query } from "../pool.js";

function parseUserId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

async function userExists(userId) {
  const { rows } = await query(`SELECT 1 FROM users WHERE id = $1 LIMIT 1`, [userId]);
  return Boolean(rows[0]);
}

async function productExists(productId) {
  const { rows } = await query(`SELECT 1 FROM products WHERE id = $1 LIMIT 1`, [productId]);
  return Boolean(rows[0]);
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
