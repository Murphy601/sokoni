/**
 * Soft-fail WhatsApp pings for social events (follow, like, offer reply, DM).
 * Never throws to callers — DB mutations must succeed even if WAHA is down.
 * WhatsApp is notify-only: always deep-link back to the site for replies / checkout.
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
    `SELECT
       id,
       phone,
       handle,
       shop_name,
       display_name,
       social_wa_notify,
       social_wa_notify_follows,
       social_wa_notify_likes,
       social_wa_notify_offers
       FROM users
      WHERE id = $1
      LIMIT 1`,
    [Number(userId)]
  );
  return rows[0] || null;
}

function eventAllowed(user, event) {
  if (!user) return true;
  if (user.social_wa_notify === false) return false;
  if (event === "follow" && user.social_wa_notify_follows === false) return false;
  if (event === "like" && user.social_wa_notify_likes === false) return false;
  if (event === "offer" && user.social_wa_notify_offers === false) return false;
  if (event === "message" && user.social_wa_notify === false) return false;
  return true;
}

async function sendUserText(userId, text, { event = null } = {}) {
  const user = await loadUser(userId);
  if (!eventAllowed(user, event)) {
    return { skipped: true, reason: "muted" };
  }
  const phone = String(user?.phone || "").replace(/\D/g, "");
  if (!phone || phone.length < 9) {
    return { skipped: true, reason: "no_phone" };
  }
  await sendText(toChatId(phone), text);
  return { ok: true, phone };
}

function inboxPath({ viewerUserId, peerUserId, peerHandle = "", sellerAuth = false } = {}) {
  const params = new URLSearchParams();
  if (viewerUserId) params.set("viewer", String(viewerUserId));
  if (peerUserId) params.set("with", String(peerUserId));
  const handle = String(peerHandle || "")
    .trim()
    .replace(/^@+/, "");
  if (handle) params.set("handle", handle);
  if (sellerAuth) params.set("sellerAuth", "1");
  return `/inbox.html?${params.toString()}`;
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
    await sendUserText(followingUserId, msg, { event: "follow" });
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
    await sendUserText(product.seller_user_id, msg, { event: "like" });
  } catch (err) {
    console.warn("[social-notify] like ping failed:", err.message);
  }
}

function formatKesNotify(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  return `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
}

function offerEscrowLines(offer) {
  const b = offer?.breakdown;
  if (!b || b.sellerNetKes == null || b.totalKes == null) return "";
  const ship =
    b.freeShipping || !b.shippingKes
      ? "shipping free / seller-covered"
      : `shipping ${formatKesNotify(b.shippingKes)}`;
  return (
    `Buyer pays *${formatKesNotify(b.totalKes)}* into escrow.\n` +
    `You receive *${formatKesNotify(b.sellerNetKes)}* after delivery` +
    ` (${ship}, Sokoni fee ${formatKesNotify(b.platformFeeKes)}).\n\n`
  );
}

export async function notifySellerNewOffer({ offer } = {}) {
  try {
    if (!offer?.sellerUserId || !offer?.buyerUserId) return;
    const buyer = await loadUser(offer.buyerUserId);
    const buyerLabel = displayName(buyer);
    const title = offer.product?.title || offer.productId || "your item";
    const amount =
      offer.amountKsh != null ? `${formatKesNotify(offer.amountKsh)} (buyer total)` : "";
    const inbox = siteUrl(
      inboxPath({
        viewerUserId: offer.sellerUserId,
        peerUserId: offer.buyerUserId,
        peerHandle: buyer?.handle,
        sellerAuth: true,
      })
    );
    const escrow = offerEscrowLines(offer);
    const msg =
      `💸 *New offer on Sokoni*\n\n` +
      `*${buyerLabel}* offered${amount ? ` *${amount}*` : ""} on *${title}*.\n\n` +
      escrow +
      `Accept or decline on-site: ${siteUrl("/suppliers/list.html")}\n` +
      `Or open chat: ${inbox}`;
    await sendUserText(offer.sellerUserId, msg, { event: "offer" });
  } catch (err) {
    console.warn("[social-notify] new offer ping failed:", err.message);
  }
}

export async function notifyBuyerOfferResponse({ offer, countered = false } = {}) {
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

    const chatPath = inboxPath({
      viewerUserId: offer.buyerUserId,
      peerUserId: offer.sellerUserId,
      peerHandle: offer.seller?.handle,
    });

    let msg = "";
    if (status === "accepted") {
      const checkoutPath =
        offer.id != null
          ? `/checkout.html?offerId=${encodeURIComponent(String(offer.id))}`
          : "/activity.html";
      const b = offer.breakdown;
      const payLine =
        b?.totalKes != null
          ? `Pay *${formatKesNotify(b.totalKes)}* on-site (item + shipping + Sokoni fee). Funds stay in escrow until delivery.\n`
          : `Pay the agreed buyer total on-site. Funds stay in escrow until delivery.\n`;
      if (countered) {
        msg =
          `💸 *Seller countered — Sokoni*\n\n` +
          `*${sellerLabel}* countered on *${title}*` +
          `${amount ? ` at *${amount}*` : ""} (buyer total).\n\n` +
          payLine +
          `(Valid 24 hours)\n${siteUrl(checkoutPath)}\n\n` +
          `Message the shop: ${siteUrl(chatPath)}\n` +
          `Activity: ${siteUrl("/activity.html")}`;
      } else {
        msg =
          `✅ *Offer accepted — Sokoni*\n\n` +
          `*${sellerLabel}* accepted your offer` +
          `${amount ? ` of *${amount}*` : ""} on *${title}*.\n\n` +
          payLine +
          `(Valid 24 hours)\n${siteUrl(checkoutPath)}\n\n` +
          `Message the shop: ${siteUrl(chatPath)}\n` +
          `Activity: ${siteUrl("/activity.html")}`;
      }
    } else {
      msg =
        `ℹ️ *Offer update — Sokoni*\n\n` +
        `*${sellerLabel}* declined your offer on *${title}*.\n\n` +
        `Make a new offer on the listing, or message the shop on-site:\n` +
        `${siteUrl(chatPath)}\n` +
        `Activity: ${siteUrl("/activity.html")}`;
    }
    await sendUserText(offer.buyerUserId, msg, { event: "offer" });
  } catch (err) {
    console.warn("[social-notify] offer reply ping failed:", err.message);
  }
}

/**
 * Seller tapped "Send reminder" on an accepted bargain — ping buyer on WhatsApp
 * with checkout deep-link (in-app chat already got the DM).
 */
export async function notifyBuyerOfferReminder({ reminder } = {}) {
  try {
    const buyerUserId = Number(reminder?.buyerUserId);
    const sellerUserId = Number(reminder?.sellerUserId);
    const offerId = Number(reminder?.offerId);
    if (!buyerUserId || !sellerUserId || !offerId) return;

    const seller = await loadUser(sellerUserId);
    const sellerLabel = displayName(seller);
    const handle = String(seller?.handle || "")
      .trim()
      .replace(/^@+/, "");
    const title = reminder.productTitle || "your item";
    const amount =
      reminder.amountKsh != null ? formatKesNotify(reminder.amountKsh) : "";

    const checkoutPath = `/checkout.html?offerId=${encodeURIComponent(String(offerId))}`;
    const chatPath = inboxPath({
      viewerUserId: buyerUserId,
      peerUserId: sellerUserId,
      peerHandle: handle,
    });

    const msg =
      `⏰ *Offer reminder — Sokoni*\n\n` +
      `*${sellerLabel}*${handle ? ` (@${handle})` : ""} is waiting on your accepted offer` +
      `${amount ? ` of *${amount}*` : ""} for *${title}*.\n\n` +
      `Complete checkout on-site (funds go to escrow until delivery):\n` +
      `${siteUrl(checkoutPath)}\n\n` +
      `Chat: ${siteUrl(chatPath)}\n` +
      `Activity: ${siteUrl("/activity.html")}`;

    await sendUserText(buyerUserId, msg, { event: "offer" });
  } catch (err) {
    console.warn("[social-notify] offer reminder ping failed:", err.message);
  }
}

/**
 * Notify users who liked/saved a product that the listed buyer price dropped.
 * Soft-fail; never throws. Caps fan-out to avoid WA spam on viral likes.
 */
export async function notifyLikersPriceDrop({
  productId,
  title,
  oldPriceKes,
  newPriceKes,
  excludeUserId = null,
  maxLikers = 40,
} = {}) {
  try {
    if (!isDbEnabled() || !productId) return { skipped: true, reason: "no_db" };
    const oldP = Math.round(Number(oldPriceKes));
    const newP = Math.round(Number(newPriceKes));
    if (!Number.isFinite(oldP) || !Number.isFinite(newP) || newP >= oldP) {
      return { skipped: true, reason: "not_a_drop" };
    }

    const lim = Math.min(Math.max(Number(maxLikers) || 40, 1), 80);
    const params = [String(productId)];
    let excludeSql = "";
    if (excludeUserId != null && Number.isInteger(Number(excludeUserId)) && Number(excludeUserId) > 0) {
      params.push(Number(excludeUserId));
      excludeSql = ` AND pl.user_id <> $${params.length}`;
    }
    params.push(lim);
    const { rows } = await query(
      `SELECT pl.user_id
         FROM product_likes pl
        WHERE pl.product_id = $1
          ${excludeSql}
        ORDER BY pl.created_at DESC
        LIMIT $${params.length}`,
      params
    );

    const productTitle = title || productId;
    const listingUrl = siteUrl(`/?q=${encodeURIComponent(String(productId))}`);
    const bagUrl = siteUrl("/index.html#bag");
    let sent = 0;
    for (const row of rows) {
      const uid = Number(row.user_id);
      if (!uid) continue;
      const msg =
        `🔥 *Price drop — Sokoni*\n\n` +
        `An item you liked just dropped:\n` +
        `*${productTitle}*\n` +
        `${formatKesNotify(oldP)} → *${formatKesNotify(newP)}*\n\n` +
        `View listing: ${listingUrl}\n` +
        `Saved bag: ${bagUrl}`;
      const result = await sendUserText(uid, msg, { event: "like" });
      if (result?.ok) sent += 1;
    }
    return { ok: true, notified: sent, candidates: rows.length };
  } catch (err) {
    console.warn("[social-notify] price-drop ping failed:", err.message);
    return { skipped: true, reason: err.message };
  }
}

export async function notifyNewDirectMessage({ message, sender } = {}) {
  try {
    const receiverId = Number(message?.receiverUserId);
    const senderId = Number(message?.senderUserId);
    if (!receiverId || !senderId || receiverId === senderId) return;

    const senderRow = sender || (await loadUser(senderId));
    const senderLabel = displayName(senderRow);
    const handle = String(senderRow?.handle || "")
      .trim()
      .replace(/^@+/, "");
    const preview = String(message?.content || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);

    // Sellers often receive buyer DMs — try sellerAuth deep link when receiver looks like shop owner.
    // Buyer receivers open inbox without sellerAuth.
    const receiver = await loadUser(receiverId);
    const receiverIsSellerish = Boolean(receiver?.shop_name || receiver?.handle);
    const inbox = siteUrl(
      inboxPath({
        viewerUserId: receiverId,
        peerUserId: senderId,
        peerHandle: handle,
        sellerAuth: receiverIsSellerish,
      })
    );

    const msg =
      `💬 *New Sokoni message*\n\n` +
      `From *${senderLabel}*${handle ? ` (@${handle})` : ""}${preview ? `:\n"${preview}${preview.length >= 80 ? "…" : ""}"` : "."}\n\n` +
      `Reply on-site (keep deals inside Sokoni):\n${inbox}`;
    await sendUserText(receiverId, msg, { event: "message" });
  } catch (err) {
    console.warn("[social-notify] DM ping failed:", err.message);
  }
}
