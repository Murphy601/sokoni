import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config } from "../config.js";
import { sendText } from "./whatsapp.js";
import { getOrder, markReviewPromptSent } from "./orders.js";
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

export async function sendReviewPrompt(customerKey, order) {
  if (!customerKey || !order?.id) return;
  if (order.reviewPromptSent) return;

  markReviewPromptSent(order.id);
  clearMenuState(customerKey);
  setPendingReview(customerKey, {
    orderId: order.id,
    productName: order.productName,
    step: "stars",
  });

  await sendText(
    customerKey,
    `⭐ *How was your Sokoni experience?*\n\n` +
      `We hope you're happy with your *${order.productName}*!\n\n` +
      `*Rate us* — reply with a number:\n` +
      `1 ⭐  ·  2 ⭐⭐  ·  3 ⭐⭐⭐  ·  4 ⭐⭐⭐⭐  ·  5 ⭐⭐⭐⭐⭐\n\n` +
      `_Your feedback helps other shoppers trust Sokoni during our public beta._\n\n` +
      `${reviewsUrlLine()}`
  );
}

export async function handleReviewReply(customerKey, text) {
  const pending = getPendingReview(customerKey);
  if (!pending) return false;

  const trimmed = (text || "").trim();
  if (!trimmed) return false;

  if (pending.step === "stars") {
    const match = trimmed.match(/^([1-5])$/);
    if (!match) {
      await sendText(
        customerKey,
        `Please reply with a number *1* to *5* to rate your order.\n\nOr type *skip* if you'd rather not.`
      );
      return true;
    }
    if (/^skip$/i.test(trimmed)) {
      clearPendingReview(customerKey);
      await sendText(customerKey, `Asante! 🙏 Type *menu* anytime to shop again.\n\n${siteUrlLine()}`);
      return true;
    }

    const stars = Number(match[1]);
    setPendingReview(customerKey, { ...pending, step: "comment", stars });

    await sendText(
      customerKey,
      `Thanks for the ${starsLabel(stars)} rating! 💚\n\n` +
        `Want to add a short comment? Reply with your thoughts, or type *skip*.\n\n` +
        `${siteUrlLine("Shop again on our website")}`
    );
    return true;
  }

  if (pending.step === "comment") {
    const comment = /^skip$/i.test(trimmed) ? "" : trimmed;
    const order = getOrder(pending.orderId);
    addReview({
      orderId: pending.orderId,
      customerName: order?.customerName || "",
      productName: pending.productName || order?.productName || "",
      stars: pending.stars,
      comment,
      source: "whatsapp",
    });
    clearPendingReview(customerKey);

    await sendText(
      customerKey,
      `🙏 *Asante sana!* Your ${starsLabel(pending.stars)} review means a lot to us.\n\n` +
        `${reviewsUrlLine()}\n` +
        `${siteUrlLine("Browse more deals")}\n\n` +
        `_Type *menu* anytime to order again._`
    );
    return true;
  }

  return false;
}
