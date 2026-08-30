import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config } from "../config.js";
import { sendText } from "./whatsapp.js";
import { getOrder, markReviewPromptSent, listRecentOrders } from "./orders.js";
import {
  setPendingReview,
  getPendingReview,
  clearPendingReview,
  clearMenuState,
} from "./session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const REVIEWS_FILE = path.join(DATA_DIR, "reviews.json");
const WEBSITE_REVIEWS_FILE = path.join(__dirname, "..", "..", "..", "website", "data", "reviews.json");

let store = { reviews: [] };
let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(REVIEWS_FILE)) {
      store = { reviews: [], ...JSON.parse(readFileSync(REVIEWS_FILE, "utf-8")) };
    }
  } catch (err) {
    console.error("[reviews] failed to load store:", err.message);
  }
}

function persist() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(REVIEWS_FILE, JSON.stringify(store, null, 2));
    try {
      const webDir = path.dirname(WEBSITE_REVIEWS_FILE);
      if (!existsSync(webDir)) mkdirSync(webDir, { recursive: true });
      writeFileSync(WEBSITE_REVIEWS_FILE, JSON.stringify(store, null, 2));
    } catch (err) {
      console.warn("[reviews] could not sync website copy:", err.message);
    }
  } catch (err) {
    console.error("[reviews] failed to persist store:", err.message);
  }
}

export function siteUrlLine(label = "Browse our full store online") {
  return `🌐 *${label}:* ${config.publicSiteUrl}`;
}

export function reviewsUrlLine() {
  return `⭐ *See customer reviews:* ${config.publicSiteUrl}/#reviews`;
}

function starsLabel(n) {
  return "⭐".repeat(Math.min(5, Math.max(1, n)));
}

function parseStarsToken(text) {
  const t = String(text || "").trim();
  const rate = t.match(/^rate\s+([1-5])(?:\s+(SKN-[\w-]+|SK-[\w-]+))?$/i);
  if (rate) {
    return { stars: Number(rate[1]), orderId: rate[2] ? rate[2].toUpperCase() : null };
  }
  const bare = t.match(/^([1-5])$/);
  if (bare) return { stars: Number(bare[1]), orderId: null };
  return null;
}

export function listReviews(limit = 20) {
  load();
  return [...store.reviews]
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, limit);
}

export function addReview({ orderId = "", customerName = "", productName = "", stars, comment = "", source = "whatsapp" }) {
  load();
  const rating = Number(stars);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return { error: "invalid_stars" };
  }
  const review = {
    id: `RV-${Date.now()}`,
    orderId: orderId || null,
    customerName: String(customerName || "Sokoni customer").trim().slice(0, 80),
    productName: String(productName || "").trim().slice(0, 120),
    stars: rating,
    comment: String(comment || "").trim().slice(0, 500),
    source,
    createdAt: Date.now(),
  };
  store.reviews.unshift(review);
  if (store.reviews.length > 200) store.reviews.length = 200;
  persist();
  return { review };
}

async function applySellerStarsForOrder(order, stars, customerKey) {
  if (!order?.id) return null;
  try {
    const { ensureOrderSellerUserId, createOrderReview } = await import(
      "../db/repositories/social.js"
    );
    const { findOrCreateBuyerUserByPhone } = await import("../db/repositories/users.js");
    const { query } = await import("../db/pool.js");
    const sellerUserId = await ensureOrderSellerUserId(order);
    if (!sellerUserId) return null;

    const phone = String(order.phone || order.mpesaPhone || customerKey || "").replace(/\D/g, "");
    let buyerUserId = null;
    if (phone) {
      const created = await findOrCreateBuyerUserByPhone(phone);
      if (created?.ok && created.user?.id) buyerUserId = Number(created.user.id);
    }
    if (!buyerUserId) return null;

    const result = await createOrderReview({
      orderId: order.id,
      buyerUserId,
      sellerUserId,
      rating: stars,
      comment: "",
      buyerPhone: phone,
      direction: "buyer_to_seller",
    });
    if (result?.success && result.review) {
      try {
        const { getSellerRatingProfile } = await import("./rating-engine.js");
        const profile = await getSellerRatingProfile(sellerUserId);
        const { rows } = await query(`SELECT handle FROM users WHERE id = $1 LIMIT 1`, [
          sellerUserId,
        ]);
        result.review.handle = rows?.[0]?.handle
          ? `@${String(rows[0].handle).replace(/^@/, "")}`
          : null;
        if (profile) {
          result.review.weightedRating = profile.avgRating;
          result.review.weightedCount = profile.totalReviews;
          result.review.unrated = profile.unrated;
          result.review.badgeTier = profile.badgeTier;
        }
      } catch {
        /* non-fatal */
      }
    }
    return result;
  } catch (err) {
    console.warn("[reviews] seller star apply:", err.message);
    return null;
  }
}

export async function sendReviewPrompt(customerKey, order) {
  if (!customerKey || !order?.id) return;
  if (order.reviewPromptSent) return;

  markReviewPromptSent(order.id);
  clearMenuState(customerKey);

  const riderName = order.riderName || null;
  const hasBoda = Boolean(order.bodaRiderId || riderName);

  setPendingReview(customerKey, {
    orderId: order.id,
    productName: order.productName,
    step: "stars",
    rateRider: hasBoda,
    rateSeller: true,
    riderName: riderName || null,
  });

  if (hasBoda) {
    await sendText(
      customerKey,
      `⭐ *How was your delivery${riderName ? ` with ${riderName}` : ""}?*\n\n` +
        `Reply *1–5* or *RATE 5* for the rider.\n` +
        `1 ⭐  ·  2 ⭐⭐  ·  3 ⭐⭐⭐  ·  4 ⭐⭐⭐⭐  ·  5 ⭐⭐⭐⭐⭐\n\n` +
        `_Next we'll ask you to rate the seller._`
    );
    return;
  }

  await sendText(
    customerKey,
    `⭐ *Rate your seller*\n\n` +
      `How was *${order.productName}*?\n\n` +
      `Reply *1–5* or *RATE 5*:\n` +
      `1 ⭐  ·  2 ⭐⭐  ·  3 ⭐⭐⭐  ·  4 ⭐⭐⭐⭐  ·  5 ⭐⭐⭐⭐⭐\n\n` +
      `_Scores use a fair weighted average — one review can't wipe a shop's history._\n\n` +
      `${reviewsUrlLine()}`
  );
}

/**
 * Handle RATE 5 / RATE 5 SKN-… when no pending session (or with one).
 * @returns {Promise<boolean>}
 */
export async function handleRateCommand(customerKey, text, { phone = "" } = {}) {
  const parsed = parseStarsToken(text);
  if (!parsed || !/^rate\s+/i.test(String(text || "").trim())) return false;

  const pending = getPendingReview(customerKey);
  if (pending) {
    return handleReviewReply(customerKey, String(parsed.stars));
  }

  let order = parsed.orderId ? getOrder(parsed.orderId) : null;
  if (!order) {
    const phoneDigits = String(phone || customerKey || "").replace(/\D/g, "").slice(-9);
    const recent = listRecentOrders(40).filter((o) => {
      const p = String(o.phone || o.mpesaPhone || "").replace(/\D/g, "");
      return p.endsWith(phoneDigits) && (o.buyerConfirmedAt || o.status === "delivered");
    });
    order = recent[0] || null;
  }
  if (!order) {
    await sendText(
      customerKey,
      `Couldn't find a delivered order to rate. After delivery, reply *RATE 5* or *RATE 5 SKN-####*.`
    );
    return true;
  }

  setPendingReview(customerKey, {
    orderId: order.id,
    productName: order.productName,
    step: "stars",
    rateRider: Boolean(order.bodaRiderId || order.riderName),
    rateSeller: true,
    riderName: order.riderName || null,
  });
  return handleReviewReply(customerKey, String(parsed.stars));
}

export async function handleReviewReply(customerKey, text) {
  const pending = getPendingReview(customerKey);
  if (!pending) return false;

  const trimmed = (text || "").trim();
  if (!trimmed) return false;

  if (pending.step === "stars") {
    if (/^skip$/i.test(trimmed)) {
      clearPendingReview(customerKey);
      await sendText(customerKey, `Asante! Type *menu* anytime to shop again.\n\n${siteUrlLine()}`);
      return true;
    }
    const parsed = parseStarsToken(trimmed);
    if (!parsed) {
      await sendText(
        customerKey,
        `Please reply with *1*–*5* or *RATE 5*.\n\nOr type *skip* if you'd rather not.`
      );
      return true;
    }

    const stars = parsed.stars;

    if (pending.rateRider) {
      try {
        const { applyBuyerRiderRating } = await import("./boda-fleet.js");
        await applyBuyerRiderRating(pending.orderId, stars);
      } catch (err) {
        console.warn("[reviews] rider rating apply:", err.message);
      }
      // Next: rate seller
      setPendingReview(customerKey, {
        ...pending,
        step: "stars",
        rateRider: false,
        rateSeller: true,
        riderStars: stars,
      });
      await sendText(
        customerKey,
        `Thanks for the rider ${starsLabel(stars)}!\n\n` +
          `Now rate the *seller* for this order — reply *1–5* or *RATE 5*.`
      );
      return true;
    }

    // Seller (or platform) stars
    const order = getOrder(pending.orderId);
    let receipt = "";
    let weighted = null;
    if (pending.rateSeller !== false && order) {
      const result = await applySellerStarsForOrder(order, stars, customerKey);
      if (result?.success && result.review?.weightedRating != null) {
        weighted = result.review;
        const handle =
          result.review.handle ||
          (order.sellerHandle ? `@${String(order.sellerHandle).replace(/^@/, "")}` : "this shop");
        const label = result.review.unrated
          ? "UNRATED (needs 5 reviews)"
          : `${Number(result.review.weightedRating).toFixed(1)}`;
        const count = result.review.weightedCount ?? result.review.totalReviews ?? "";
        receipt =
          `\n\nThank you! *${handle}*'s updated score is now ⭐ *${label}*` +
          (count !== "" && !result.review.unrated ? ` (${count} reviews)` : "") +
          `.`;
      } else if (result?.error === "review_exists") {
        receipt = `\n\n_You already rated this seller for ${order.id}._`;
      }
    }

    addReview({
      orderId: pending.orderId,
      customerName: order?.customerName || "",
      productName: pending.productName || order?.productName || "",
      stars,
      comment: "",
      source: "whatsapp",
    });

    // 1–3 stars → short why prompt (2 options)
    if (stars <= 3) {
      setPendingReview(customerKey, {
        ...pending,
        step: "low_feedback",
        stars,
        rateRider: false,
        weighted,
      });
      await sendText(
        customerKey,
        `Thanks for the ${starsLabel(stars)}.${receipt}\n\n` +
          `What went wrong? Reply with a number:\n` +
          `*1* Late delivery\n` +
          `*2* Bad quality / not as described\n` +
          `*3* Rude service\n` +
          `*4* Other — or type a short note\n\n` +
          `_Or type *skip*._`
      );
      return true;
    }

    setPendingReview(customerKey, { ...pending, step: "comment", stars, rateRider: false });

    await sendText(
      customerKey,
      `Thanks for the ${starsLabel(stars)} rating!${receipt}\n\n` +
        `Want to add a short comment? Reply with your thoughts, or type *skip*.\n\n` +
        `${siteUrlLine("Shop again on our website")}`
    );
    return true;
  }

  if (pending.step === "low_feedback") {
    if (/^skip$/i.test(trimmed)) {
      clearPendingReview(customerKey);
      await sendText(customerKey, `Asante — noted.\n\n${siteUrlLine()}`);
      return true;
    }
    const map = {
      1: "Late delivery",
      2: "Bad quality / not as described",
      3: "Rude service",
    };
    const reason = map[trimmed] || trimmed.slice(0, 200);
    const order = getOrder(pending.orderId);
    addReview({
      orderId: pending.orderId,
      customerName: order?.customerName || "",
      productName: pending.productName || order?.productName || "",
      stars: pending.stars,
      comment: reason,
      source: "whatsapp-low-feedback",
    });
    clearPendingReview(customerKey);
    await sendText(
      customerKey,
      `Got it — *${reason}*. We'll use this to coach the shop/rider.\n\n` +
        `${reviewsUrlLine()}\n${siteUrlLine("Browse more deals")}`
    );
    return true;
  }

  if (pending.step === "comment") {
    const comment = /^skip$/i.test(trimmed) ? "" : trimmed;
    const order = getOrder(pending.orderId);
    if (comment) {
      addReview({
        orderId: pending.orderId,
        customerName: order?.customerName || "",
        productName: pending.productName || order?.productName || "",
        stars: pending.stars,
        comment,
        source: "whatsapp",
      });
    }
    clearPendingReview(customerKey);

    await sendText(
      customerKey,
      `Asante sana! Your ${starsLabel(pending.stars)} review helps other shoppers trust Sokoni.\n\n` +
        `${reviewsUrlLine()}\n` +
        `${siteUrlLine("Browse more deals")}\n\n` +
        `_Type *menu* anytime to order again._`
    );
    return true;
  }

  return false;
}
