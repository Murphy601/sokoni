/**
 * Soft-fail WhatsApp pings for social events (follow, like, offer reply).
 * Never throws to callers — DB mutations must succeed even if WAHA is down.
 */
import { isDbEnabled, query } from "../db/pool.js";
import { config } from "../config.js";
import { sendText, toChatId } from "./whatsapp.js";

function siteUrl(path) {
  const base = String(config.publicSiteUrl || "https://sokonimall.com").replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function displayName(row) {
  if (!row) return "Someone";
  const handle = String(row.handle || "")
    .trim()
    .replace(/^@+/, "");
  return row.shop_name || row.display_name || (handle ? `@${handle}` : `User ${row.id}`);
}

async function loadUser(userId) {
  if (!isDbEnabled() || !userId) return null;
  const { rows } = await query(
    `SELECT id, phone, handle, shop_name, display_name
       FROM users
      WHERE id = $1
      LIMIT 1`,
    [Number(userId)]
  );
  return rows[0] || null;
}

async function sendUserText(userId, text) {
  const user = await loadUser(userId);
  const phone = String(user?.phone || "").replace(/\D/g, "");
  if (!phone || phone.length < 9) {
    return { skipped: true, reason: "no_phone" };
  }
  await sendText(toChatId(phone), text);
  return { ok: true, phone };
}

export async function notifySellerNewFollower({ followerUserId, followingUserId } = {}) {
  try {
    if (!followerUserId || !followingUserId || followerUserId === followingUserId) return;
    const follower = await loadUser(followerUserId);
    const name = displayName(follower);
    const handle = String(follower?.handle || "")
      .trim()
      .replace(/^@+/, "");
    const msg =
      `👋 *New follower on Sokoni*\n\n` +
      `*${name}*${handle ? ` (@${handle})` : ""} started following your shop.\n\n` +
      `See activity: ${siteUrl("/suppliers/list.html")}`;
    await sendUserText(followingUserId, msg);
  } catch (err) {
    console.warn("[social-notify] follow ping failed:", err.message);
  }
}

export async function notifySellerProductLiked({ userId, productId } = {}) {
  try {
    if (!userId || !productId || !isDbEnabled()) return;
    const productResult = await query(
      `SELECT id, title, seller_user_id
         FROM products
        WHERE id = $1
        LIMIT 1`,
      [String(productId)]
    );
    const product = productResult.rows[0];
    if (!product?.seller_user_id) return;
    if (Number(product.seller_user_id) === Number(userId)) return;

    const liker = await loadUser(userId);
    const name = displayName(liker);
    const title = product.title || product.id;
    const msg =
      `♥ *New like on Sokoni*\n\n` +
      `*${name}* liked *${title}*.\n\n` +
      `Shop activity: ${siteUrl("/suppliers/list.html")}`;
    await sendUserText(product.seller_user_id, msg);
  } catch (err) {
    console.warn("[social-notify] like ping failed:", err.message);
  }
}

export async function notifyBuyerOfferResponse({ offer } = {}) {
  try {
    if (!offer?.buyerUserId || !offer?.status) return;
    const status = String(offer.status).toLowerCase();
    if (status !== "accepted" && status !== "declined") return;

    const sellerLabel =
      offer.seller?.shopName ||
      offer.seller?.handle ||
      `Seller #${offer.sellerUserId || ""}`;
    const title = offer.product?.title || offer.productId || "your item";
    const amount =
      offer.amountKsh != null ? `KES ${Number(offer.amountKsh).toLocaleString()}` : "";

    let msg = "";
    if (status === "accepted") {
      msg =
        `✅ *Offer accepted — Sokoni*\n\n` +
        `*${sellerLabel}* accepted your offer` +
        `${amount ? ` of *${amount}*` : ""} on *${title}*.\n\n` +
        `Complete checkout within 24 hours.\n` +
        `Activity: ${siteUrl("/activity.html")}`;
    } else {
      msg =
        `ℹ️ *Offer update — Sokoni*\n\n` +
        `*${sellerLabel}* declined your offer on *${title}*.\n\n` +
        `You can make a new offer or message the shop.\n` +
        `Activity: ${siteUrl("/activity.html")}`;
    }
    await sendUserText(offer.buyerUserId, msg);
  } catch (err) {
    console.warn("[social-notify] offer reply ping failed:", err.message);
  }
}
