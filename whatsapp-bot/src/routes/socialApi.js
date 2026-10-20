import { clientError } from "../lib/public-error.js";
import { Router } from "express";
import { attachFitCheckPhoto } from "../services/fit-check.js";
import { storeFitPhoto } from "../services/fit-photo-store.js";
import {
  sendLockedDrop,
  eligibleDropRecipients,
} from "../services/locked-drops.js";
import { sendNudge } from "../services/inbox-nudge.js";
import {
  sendScratchCard,
  revealScratchCard,
  perkOptions,
} from "../services/scratch-cards.js";
import {
  createBundle,
  respondToBundle,
  getBundle,
} from "../db/repositories/bundles.js";
import { postBundleCard } from "../services/bundle-cards.js";
import multer from "multer";
import path from "node:path";
import {
  validateVoiceUpload,
  storeVoiceNote,
  relayVoiceToWhatsApp,
  MAX_VOICE_BYTES,
  VOICE_TTL_MS,
  VOICE_DIR,
} from "../services/voice-upload.js";
import {
  validatePhotoUpload,
  storeChatPhoto,
  relayPhotoToWhatsApp,
  MAX_PHOTO_BYTES,
  PHOTO_TTL_MS,
  CHAT_PHOTO_DIR,
} from "../services/chat-photo-store.js";
import { isSystemKind } from "../lib/message-kinds.js";
import {
  createOrderReview,
  createOffer,
  getAcceptedOfferForCheckout,
  getDirectThread,
  getShopProfileByHandle,
  listReviewableOrdersForSeller,
  listReviewableBuyersForSeller,
  listSellerHandledOfferQueueEvents,
  listSellerHandledOfferQueue,
  listSellerReviews,
  listBuyerReviews,
  getUserSocialStats,
  listOffers,
  listThreadOffers,
  listBuyerSocialActivity,
  listSellerSocialActivity,
  listUserFollowConnections,
  getUserNotifyPrefs,
  updateUserNotifyPrefs,
  resetSellerHandledOfferQueue,
  respondToOffer,
  sendOfferReminder,
  setSellerHandledOfferQueueState,
  sendDirectMessage,
  toggleMessageReaction,
  getMessageMedia,
  ALLOWED_REACTIONS,
  toggleFollow,
  updateUserShopProfile,
} from "../db/repositories/social.js";
import { resolveAuthenticatedSellerSocialContext } from "../services/seller-social-auth.js";
import { isDbEnabled } from "../db/pool.js";
import { updatePeerSellerProfile } from "../services/suppliers.js";
import { uploadSellerShopAvatar } from "../services/seller-avatar.js";
import {
  notifyBuyerOfferResponse,
  notifyBuyerOfferReminder,
  notifySellerNewFollower,
  notifySellerNewOffer,
} from "../services/social-notifications.js";
import { placeOrderFromAcceptedOffer } from "../services/offer-web-checkout.js";
import {
  applyBuyerIdentityAuth,
  hasBuyerSessionContext,
  resolveAuthenticatedBuyerSocialContext,
} from "../services/buyer-social-auth.js";

const router = Router();

function hasSellerSessionContext(req, payload = req.body || {}) {
  const phone = payload?.phone || req.query?.phone;
  const sessionToken =
    payload?.sessionToken ||
    payload?.verificationToken ||
    req.query?.sessionToken ||
    req.query?.verificationToken ||
    req.headers["x-seller-session"];
  // Require phone + token so buyer sessions (same field names) are not misrouted
  // through seller auth on chat/offers endpoints.
  return Boolean(phone && sessionToken);
}

function socialErrorStatus(error) {
  if (error === "database_not_configured") return 503;
  if (
    error === "forbidden_offer_action" ||
    error === "forbidden_offer_checkout" ||
    error === "seller_session_mismatch" ||
    error === "buyer_session_mismatch"
  ) {
    return 403;
  }
  if (error === "session_required" || error === "session_invalid" || error === "session_expired") return 401;
  if (error === "reminder_cooldown_active") return 429;
  if (
    error === "offer_not_pending" ||
    error === "offer_not_accepted" ||
    error === "offer_expired" ||
    error === "product_unavailable" ||
    error === "offer_above_list" ||
    error === "offer_above_price" ||
    error === "offer_too_low_for_shipping" ||
    error === "invalid_counter_amount" ||
    error === "counter_not_higher" ||
    error === "invalid_delivery_details" ||
    error === "review_exists" ||
    error === "review_not_allowed"
  ) {
    return 409;
  }
  if (
    error === "buyer_mismatch" ||
    error === "seller_mismatch"
  ) {
    return 403;
  }
  if (
    error === "user_not_found" ||
    error === "buyer_not_found" ||
    error === "seller_not_found" ||
    error === "follower_not_found" ||
    error === "following_not_found" ||
    error === "product_not_found" ||
    error === "offer_not_found" ||
    error === "order_not_found" ||
    error === "shop_not_found" ||
    error === "sender_not_found" ||
    error === "receiver_not_found"
  ) {
    return 404;
  }
  if (error === "handle_taken") return 409;
  return 400;
}

/** POST /api/social/follow — toggle follow relation */
router.post("/follow", async (req, res) => {
  try {
    const gated = await applyBuyerIdentityAuth(req, req.body || {}, "followerUserId");
    if (gated.error) {
      return res.status(gated.status || socialErrorStatus(gated.error)).json({
        error: gated.error,
        message: gated.message,
      });
    }
    const result = await toggleFollow(gated.payload || {});
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    if (result.created) {
      void notifySellerNewFollower({
        followerUserId: result.followerUserId,
        followingUserId: result.followingUserId,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** GET /api/social/users/:userId/stats — social counters for storefront */
router.get("/users/:userId/stats", async (req, res) => {
  try {
    const result = await getUserSocialStats(req.params.userId);
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json({ stats: result });
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** GET /api/social/users/:userId/followers — people who follow this user */
router.get("/users/:userId/followers", async (req, res) => {
  try {
    const result = await listUserFollowConnections({
      userId: req.params.userId,
      direction: "followers",
      limit: req.query.limit,
      offset: req.query.offset,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** GET /api/social/users/:userId/following — people this user follows */
router.get("/users/:userId/following", async (req, res) => {
  try {
    const result = await listUserFollowConnections({
      userId: req.params.userId,
      direction: "following",
      limit: req.query.limit,
      offset: req.query.offset,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** GET /api/social/shop/pins — seller's pinned shelf (max 3) */
router.get("/shop/pins", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({ error: auth.error, message: auth.message });
    }
    const { listShopPins } = await import("../db/repositories/social.js");
    const { MAX_SHOP_PINS } = await import("../lib/shop-pins.js");
    const pins = await listShopPins(auth.sellerUserId);
    res.json({ pins, max: MAX_SHOP_PINS, remaining: Math.max(0, MAX_SHOP_PINS - pins.length) });
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** POST /api/social/shop/pins — pin a listing to the top of the shop grid */
router.post("/shop/pins", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({ error: auth.error, message: auth.message });
    }
    const { pinShopProduct } = await import("../db/repositories/social.js");
    const result = await pinShopProduct({
      sellerUserId: auth.sellerUserId,
      productId: req.body?.productId,
      rank: req.body?.rank ?? null,
    });
    if (result.error) {
      const status =
        result.error === "not_your_listing"
          ? 403
          : result.error === "database_not_configured"
            ? 503
            : 400;
      return res.status(status).json({ error: result.error, message: result.message });
    }
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** DELETE /api/social/shop/pins/:productId — unpin and close the gap */
router.delete("/shop/pins/:productId", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({ error: auth.error, message: auth.message });
    }
    const { unpinShopProduct } = await import("../db/repositories/social.js");
    const result = await unpinShopProduct({
      sellerUserId: auth.sellerUserId,
      productId: req.params.productId,
    });
    if (result.error) {
      return res
        .status(result.error === "database_not_configured" ? 503 : 400)
        .json({ error: result.error, message: result.message });
    }
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** POST /api/social/shop/avatar — optional shop profile photo upload */
router.post("/shop/avatar", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }

    const result = await uploadSellerShopAvatar({
      userId: auth.sellerUserId,
      sellerId: auth.sellerId,
      imageBase64: req.body?.imageBase64 || req.body?.avatarBase64,
      mimeType: req.body?.mimeType || "image/jpeg",
    });
    if (result.error) {
      const status =
        result.error === "missing_image" || result.error === "image_too_large" || result.error === "invalid_avatar_url"
          ? 400
          : socialErrorStatus(result.error);
      return res.status(status).json({
        error: result.error,
        message: result.message,
      });
    }

    res.json({
      success: true,
      avatarUrl: result.avatarUrl,
      shop: result.shop,
      message: result.message || "Profile photo updated.",
    });
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** PATCH /api/social/shop/profile — seller updates storefront identity fields */
router.patch("/shop/profile", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }

    const result = await updateUserShopProfile({
      userId: auth.sellerUserId,
      sellerId: auth.sellerId,
      handle: req.body?.handle ?? req.body?.shopHandle,
      shopName: req.body?.shopName ?? req.body?.businessName,
      bio: req.body?.bio,
      avatarUrl: req.body?.avatarUrl,
      location: req.body?.location ?? req.body?.city,
      instagramUrl: req.body?.instagramUrl ?? req.body?.instagram,
      tiktokUrl: req.body?.tiktokUrl ?? req.body?.tiktok,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }

    // Optional notify prefs on the same save.
    let notifyPrefs = null;
    if (
      req.body?.socialWaNotify !== undefined ||
      req.body?.socialWaNotifyFollows !== undefined ||
      req.body?.socialWaNotifyLikes !== undefined ||
      req.body?.socialWaNotifyOffers !== undefined
    ) {
      notifyPrefs = await updateUserNotifyPrefs({
        userId: auth.sellerUserId,
        socialWaNotify: req.body.socialWaNotify,
        socialWaNotifyFollows: req.body.socialWaNotifyFollows,
        socialWaNotifyLikes: req.body.socialWaNotifyLikes,
        socialWaNotifyOffers: req.body.socialWaNotifyOffers,
      });
    } else {
      notifyPrefs = await getUserNotifyPrefs({ userId: auth.sellerUserId });
    }

    // Keep JSON supplier handle/name in sync so seller session auth still resolves.
    updatePeerSellerProfile(auth.phone, {
      shopName: result.shop?.shopName,
      shopHandle: result.shop?.handle,
      city: result.shop?.location,
    });

    const prefsOk = notifyPrefs && !notifyPrefs.error;
    res.json({
      success: true,
      shop: {
        ...result.shop,
        socialWaNotify: prefsOk ? notifyPrefs.socialWaNotify : result.shop?.socialWaNotify !== false,
        socialWaNotifyFollows: prefsOk ? notifyPrefs.socialWaNotifyFollows : true,
        socialWaNotifyLikes: prefsOk ? notifyPrefs.socialWaNotifyLikes : true,
        socialWaNotifyOffers: prefsOk ? notifyPrefs.socialWaNotifyOffers : true,
      },
      message: "Shop profile updated.",
    });
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/**
 * Soft-resolve buyer or seller session for notify prefs.
 * Prefer seller when seller context is present and valid; else buyer.
 */
async function resolveNotifyPrefsUser(req) {
  if (hasSellerSessionContext(req, req.body || req.query || {})) {
    const seller = await resolveAuthenticatedSellerSocialContext(req);
    if (seller.ok) {
      return { ok: true, userId: seller.sellerUserId, role: "seller" };
    }
    if (!isAmbiguousSessionAuthError(seller.error)) {
      return seller;
    }
  }
  if (hasBuyerSessionContext(req, req.body || req.query || {})) {
    const buyer = await resolveAuthenticatedBuyerSocialContext(req);
    if (buyer.error) return buyer;
    return { ok: true, userId: buyer.buyerUserId, role: "buyer" };
  }
  return {
    error: "session_required",
    message: "Sign in with WhatsApp to manage notification preferences.",
    status: 401,
  };
}

/** GET /api/social/notify-prefs — buyer or seller WhatsApp social ping preference */
router.get("/notify-prefs", async (req, res) => {
  try {
    const auth = await resolveNotifyPrefsUser(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }
    const result = await getUserNotifyPrefs({ userId: auth.userId });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json({ ...result, role: auth.role });
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** PATCH /api/social/notify-prefs — mute/unmute WhatsApp social pings */
router.patch("/notify-prefs", async (req, res) => {
  try {
    const auth = await resolveNotifyPrefsUser(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }
    const result = await updateUserNotifyPrefs({
      userId: auth.userId,
      socialWaNotify: req.body?.socialWaNotify,
      socialWaNotifyFollows: req.body?.socialWaNotifyFollows,
      socialWaNotifyLikes: req.body?.socialWaNotifyLikes,
      socialWaNotifyOffers: req.body?.socialWaNotifyOffers,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json({ ...result, role: auth.role });
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** GET /api/social/activity — seller feed: new followers + likes on your items */
router.get("/activity", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }

    const requested = Number(req.query.userId);
    if (
      Number.isInteger(requested) &&
      requested > 0 &&
      requested !== auth.sellerUserId
    ) {
      return res.status(403).json({
        error: "seller_session_mismatch",
        message: "Seller session does not match the activity profile in this request.",
      });
    }

    const result = await listSellerSocialActivity({
      sellerUserId: auth.sellerUserId,
      limit: req.query.limit,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** GET /api/social/buyer/activity — buyer feed: offer replies, follows, likes */
router.get("/buyer/activity", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedBuyerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }

    const requested = Number(req.query.userId);
    if (
      Number.isInteger(requested) &&
      requested > 0 &&
      requested !== auth.buyerUserId
    ) {
      return res.status(403).json({
        error: "buyer_session_mismatch",
        message: "Buyer session does not match the activity profile in this request.",
      });
    }

    const result = await listBuyerSocialActivity({
      buyerUserId: auth.buyerUserId,
      limit: req.query.limit,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err, "buyer_activity_failed"));
  }
});

function parseOptionalViewerUserId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Soft-resolve viewer for public shop reads.
 * Prefer buyer session when present; fall back to ?viewer= / ?viewerUserId=.
 * Invalid sessions do not fail the public GET — viewer state is simply omitted.
 */
async function resolveOptionalShopViewerUserId(req) {
  if (hasBuyerSessionContext(req, req.query || {})) {
    const auth = await resolveAuthenticatedBuyerSocialContext(req);
    if (auth.ok) return auth.buyerUserId;
  }
  return (
    parseOptionalViewerUserId(req.query?.viewer) ||
    parseOptionalViewerUserId(req.query?.viewerUserId) ||
    null
  );
}

/** GET /api/social/shop/:handle — storefront profile + active listings */
router.get("/shop/:handle", async (req, res) => {
  try {
    try {
      const {
        getSupplierByHandle,
        findSupplierByPhone,
        isShopPubliclyVisible,
      } = await import("../services/suppliers.js");
      let supplier = getSupplierByHandle(req.params.handle);
      // Handle may live on users table only — resolve supplier via phone
      if (!supplier && isDbEnabled()) {
        try {
          const clean = String(req.params.handle || "")
            .trim()
            .replace(/^@+/, "")
            .toLowerCase();
          const { query } = await import("../db/pool.js");
          const { rows } = await query(
            `SELECT phone FROM users
              WHERE LOWER(REPLACE(handle, '@', '')) = $1
              LIMIT 1`,
            [clean]
          );
          if (rows[0]?.phone) supplier = findSupplierByPhone(rows[0].phone);
        } catch {
          /* ignore */
        }
      }
      if (supplier && !isShopPubliclyVisible(supplier)) {
        const st = String(supplier.shopStatus || "under_review").toLowerCase();
        if (st === "deactivated") {
          return res.status(404).json({
            error: "not_found",
            shopStatus: "deactivated",
            message: "This shop is no longer available.",
          });
        }
        return res.status(403).json({
          error: "shop_unavailable",
          message:
            supplier.shopStatusNote ||
            "This store is currently unavailable.",
          shopStatus: st,
        });
      }
      // Hard-deleted supplier: do not fall through to users/sellers ghost profile.
      const cleanHandle = String(req.params.handle || "")
        .trim()
        .replace(/^@+/, "")
        .toLowerCase();
      if (!supplier && cleanHandle && cleanHandle !== "sokoni-store") {
        return res.status(404).json({
          error: "not_found",
          shopStatus: "deleted",
          message: "This shop is no longer available.",
        });
      }
    } catch {
      /* fail-soft — shop still loads if supplier store unavailable */
    }
    const viewerUserId = await resolveOptionalShopViewerUserId(req);
    const result = await getShopProfileByHandle({
      handle: req.params.handle,
      limit: req.query.limit,
      offset: req.query.offset,
      viewerUserId,
      tab: req.query.tab || req.query.status || "active",
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    try {
      const { getSupplierByHandle } = await import("../services/suppliers.js");
      const supplier = getSupplierByHandle(req.params.handle);
      if (result.shop && supplier) {
        result.shop.promoBanner = supplier.promoBanner || "";
        result.shop.offerNote = supplier.offerNote || "";
      }
    } catch {
      /* fail-soft */
    }
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** POST /api/social/offers/create — buyer makes/updates pending offer */
router.post("/offers/create", async (req, res) => {
  try {
    const gated = await applyBuyerIdentityAuth(req, req.body || {}, "buyerUserId");
    if (gated.error) {
      return res.status(gated.status || socialErrorStatus(gated.error)).json({
        error: gated.error,
        message: gated.message,
      });
    }
    const result = await createOffer(gated.payload || {});
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
        minBuyerTotalKes: result.minBuyerTotalKes,
        shippingKes: result.shippingKes,
        breakdown: result.breakdown,
      });
    }
    if (result.offer) {
      void notifySellerNewOffer({ offer: result.offer });
    }
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/**
 * GET /api/social/offers/:offerId/checkout
 * Buyer-only preview of agreed-price fee breakdown for an accepted offer.
 * amount_kes is negotiated buyer all-in (same semantics as listing price_kes).
 */
router.get("/offers/:offerId/checkout", async (req, res) => {
  try {
    const gated = await applyBuyerIdentityAuth(
      req,
      { ...(req.query || {}), buyerUserId: req.query?.buyerUserId },
      "buyerUserId"
    );
    if (gated.error) {
      return res.status(gated.status || socialErrorStatus(gated.error)).json({
        error: gated.error,
        message: gated.message,
      });
    }
    const result = await getAcceptedOfferForCheckout({
      offerId: req.params.offerId,
      buyerUserId: gated.payload?.buyerUserId,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/**
 * POST /api/social/offers/:offerId/place-order
 * Create prepaid order from an accepted offer (on-site checkout).
 */
router.post("/offers/:offerId/place-order", async (req, res) => {
  try {
    const gated = await applyBuyerIdentityAuth(req, req.body || {}, "buyerUserId");
    if (gated.error) {
      return res.status(gated.status || socialErrorStatus(gated.error)).json({
        error: gated.error,
        message: gated.message,
      });
    }
    const body = gated.payload || req.body || {};
    const result = await placeOrderFromAcceptedOffer({
      offerId: req.params.offerId,
      buyerUserId: gated.payload?.buyerUserId,
      name: body.name ?? req.body?.name,
      location: body.location ?? req.body?.location,
      phone: body.deliveryPhone ?? req.body?.deliveryPhone ?? body.phone ?? req.body?.phone,
      deliveryType: body.deliveryType ?? req.body?.deliveryType,
      landmarkTown: body.landmarkTown ?? req.body?.landmarkTown,
      landmarkSpot: body.landmarkSpot ?? req.body?.landmarkSpot,
      landmarkId: body.landmarkId ?? req.body?.landmarkId,
      landmarkInstructions: body.landmarkInstructions ?? req.body?.landmarkInstructions,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.status(201).json({
      ok: true,
      orderId: result.orderId,
      breakdown: result.breakdown,
      productName: result.productName,
      offer: result.offer,
    });
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** POST /api/social/offers/:offerId/respond — seller accepts/declines */
router.post("/offers/:offerId/respond", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }

    const requestedSellerUserId = Number(req.body?.sellerUserId);
    if (
      Number.isInteger(requestedSellerUserId) &&
      requestedSellerUserId > 0 &&
      requestedSellerUserId !== auth.sellerUserId
    ) {
      return res.status(403).json({
        error: "seller_session_mismatch",
        message: "Seller session does not match the seller profile in this request.",
      });
    }

    const result = await respondToOffer({
      offerId: req.params.offerId,
      sellerUserId: auth.sellerUserId,
      action: req.body?.action,
      amountKsh: req.body?.amountKsh ?? req.body?.amountKes ?? req.body?.counterAmountKsh,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
        minBuyerTotalKes: result.minBuyerTotalKes,
        shippingKes: result.shippingKes,
        breakdown: result.breakdown,
      });
    }
    if (result.offer) {
      void notifyBuyerOfferResponse({ offer: result.offer, countered: Boolean(result.countered) });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** POST /api/social/offers/:offerId/remind — seller reminder with cooldown */
router.post("/offers/:offerId/remind", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }

    const requestedSellerUserId = Number(req.body?.sellerUserId);
    if (
      Number.isInteger(requestedSellerUserId) &&
      requestedSellerUserId > 0 &&
      requestedSellerUserId !== auth.sellerUserId
    ) {
      return res.status(403).json({
        error: "seller_session_mismatch",
        message: "Seller session does not match the seller profile in this request.",
      });
    }

    const result = await sendOfferReminder({
      offerId: req.params.offerId,
      sellerUserId: auth.sellerUserId,
      cooldownSeconds: req.body?.cooldownSeconds,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
        cooldownMsRemaining: result.cooldownMsRemaining,
        cooldownSecondsRemaining: result.cooldownSecondsRemaining,
        lastReminderAt: result.lastReminderAt,
        cooldownEndsAt: result.cooldownEndsAt,
      });
    }
    if (result.reminder) {
      // In-app DM is already written; also ping buyer on WhatsApp (soft-fail).
      void notifyBuyerOfferReminder({ reminder: result.reminder });
    }
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** GET /api/social/offers/handled?offerIds=12,18 */
router.get("/offers/handled", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }

    const requestedSellerUserId = Number(req.query.userId);
    if (
      Number.isInteger(requestedSellerUserId) &&
      requestedSellerUserId > 0 &&
      requestedSellerUserId !== auth.sellerUserId
    ) {
      return res.status(403).json({
        error: "seller_session_mismatch",
        message: "Seller session does not match the seller profile in this request.",
      });
    }

    const result = await listSellerHandledOfferQueue({
      sellerUserId: auth.sellerUserId,
      offerIds: req.query.offerIds,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** GET /api/social/offers/handled/events?offerId=12&action=handled */
router.get("/offers/handled/events", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }

    const requestedSellerUserId = Number(req.query.userId);
    if (
      Number.isInteger(requestedSellerUserId) &&
      requestedSellerUserId > 0 &&
      requestedSellerUserId !== auth.sellerUserId
    ) {
      return res.status(403).json({
        error: "seller_session_mismatch",
        message: "Seller session does not match the seller profile in this request.",
      });
    }

    const result = await listSellerHandledOfferQueueEvents({
      sellerUserId: auth.sellerUserId,
      offerId: req.query.offerId,
      action: req.query.action,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** POST /api/social/offers/handled/reset — clear seller handled queue */
router.post("/offers/handled/reset", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }

    const requestedSellerUserId = Number(req.body?.sellerUserId);
    if (
      Number.isInteger(requestedSellerUserId) &&
      requestedSellerUserId > 0 &&
      requestedSellerUserId !== auth.sellerUserId
    ) {
      return res.status(403).json({
        error: "seller_session_mismatch",
        message: "Seller session does not match the seller profile in this request.",
      });
    }

    const result = await resetSellerHandledOfferQueue({
      sellerUserId: auth.sellerUserId,
      source: req.body?.source,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** POST /api/social/offers/:offerId/handled — set seller handled queue state */
router.post("/offers/:offerId/handled", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }

    const requestedSellerUserId = Number(req.body?.sellerUserId);
    if (
      Number.isInteger(requestedSellerUserId) &&
      requestedSellerUserId > 0 &&
      requestedSellerUserId !== auth.sellerUserId
    ) {
      return res.status(403).json({
        error: "seller_session_mismatch",
        message: "Seller session does not match the seller profile in this request.",
      });
    }

    const result = await setSellerHandledOfferQueueState({
      offerId: req.params.offerId,
      sellerUserId: auth.sellerUserId,
      handled: req.body?.handled,
      source: req.body?.source,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** GET /api/social/offers?userId=1&role=buyer|seller&status=pending */
router.get("/offers", async (req, res) => {
  try {
    const normalizedRole = String(req.query.role || "buyer")
      .trim()
      .toLowerCase();

    let userId = req.query.userId;
    if (normalizedRole === "seller") {
      const auth = await resolveAuthenticatedSellerSocialContext(req);
      if (auth.error) {
        return res.status(auth.status || 403).json({
          error: auth.error,
          message: auth.message,
        });
      }
      const requestedSellerUserId = Number(req.query.userId);
      if (
        Number.isInteger(requestedSellerUserId) &&
        requestedSellerUserId > 0 &&
        requestedSellerUserId !== auth.sellerUserId
      ) {
        return res.status(403).json({
          error: "seller_session_mismatch",
          message: "Seller session does not match the seller profile in this request.",
        });
      }
      userId = auth.sellerUserId;
    } else if (hasBuyerSessionContext(req, req.query || {})) {
      const auth = await resolveAuthenticatedBuyerSocialContext(req);
      if (auth.error) {
        return res.status(auth.status || 403).json({
          error: auth.error,
          message: auth.message,
        });
      }
      const requestedBuyerUserId = Number(req.query.userId);
      if (
        Number.isInteger(requestedBuyerUserId) &&
        requestedBuyerUserId > 0 &&
        requestedBuyerUserId !== auth.buyerUserId
      ) {
        return res.status(403).json({
          error: "buyer_session_mismatch",
          message: "Buyer session does not match the buyer profile in this request.",
        });
      }
      userId = auth.buyerUserId;
    }

    const result = await listOffers({
      userId,
      role: req.query.role,
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

function isAmbiguousSessionAuthError(error) {
  return (
    error === "session_required" ||
    error === "session_invalid" ||
    error === "session_expired" ||
    error === "invalid_phone"
  );
}

/** GET /api/social/chat/offers?userAId=1&userBId=2 — offers for an inbox thread */
router.get("/chat/offers", async (req, res) => {
  try {
    const hasSellerContext = hasSellerSessionContext(req, req.query || {});
    let userAId = req.query.userAId;
    let userBId = req.query.userBId;
    let usedSellerIdentity = false;

    if (hasSellerContext) {
      const auth = await resolveAuthenticatedSellerSocialContext(req);
      if (auth.ok) {
        const requestedUserA = Number(req.query.userAId);
        const requestedUserB = Number(req.query.userBId);
        const matchesA = Number.isInteger(requestedUserA) && requestedUserA > 0 && requestedUserA === auth.sellerUserId;
        const matchesB = Number.isInteger(requestedUserB) && requestedUserB > 0 && requestedUserB === auth.sellerUserId;
        if (!matchesA && !matchesB) {
          return res.status(403).json({
            error: "seller_session_mismatch",
            message: "Seller session does not match the chat participants in this request.",
          });
        }
        userAId = matchesA ? auth.sellerUserId : userAId;
        userBId = matchesB ? auth.sellerUserId : userBId;
        usedSellerIdentity = true;
      } else if (!isAmbiguousSessionAuthError(auth.error)) {
        return res.status(auth.status || 403).json({
          error: auth.error,
          message: auth.message,
        });
      }
    }

    if (!usedSellerIdentity && hasBuyerSessionContext(req, req.query || {})) {
      const auth = await resolveAuthenticatedBuyerSocialContext(req);
      if (auth.error) {
        return res.status(auth.status || 403).json({
          error: auth.error,
          message: auth.message,
        });
      }
      const requestedUserA = Number(req.query.userAId);
      const requestedUserB = Number(req.query.userBId);
      const matchesA = Number.isInteger(requestedUserA) && requestedUserA > 0 && requestedUserA === auth.buyerUserId;
      const matchesB = Number.isInteger(requestedUserB) && requestedUserB > 0 && requestedUserB === auth.buyerUserId;
      if (!matchesA && !matchesB) {
        return res.status(403).json({
          error: "buyer_session_mismatch",
          message: "Buyer session does not match the chat participants in this request.",
        });
      }
      userAId = matchesA ? auth.buyerUserId : userAId;
      userBId = matchesB ? auth.buyerUserId : userBId;
    }

    const result = await listThreadOffers({
      userAId,
      userBId,
      limit: req.query.limit,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** POST /api/social/chat/send — moderated in-app DM */
router.post("/chat/send", async (req, res) => {
  try {
    let payload = { ...(req.body || {}) };
    // The body is spread straight into the repository, so anything the client
    // sets it sets. isSystem is what marks a card as "Sokoni says this" -- a
    // seller who could set it could post "KES 1,500 locked in escrow" into a
    // chat where no money exists. Only server code may raise these.
    delete payload.isSystem;
    delete payload.expiresAt;
    delete payload.isPinned;
    if (isSystemKind(payload.kind)) {
      return res.status(403).json({
        error: "system_kind_only",
        message: "That card can only be sent by Sokoni.",
      });
    }
    const hasSellerContext = hasSellerSessionContext(req, payload);
    let usedSellerIdentity = false;

    if (hasSellerContext) {
      const auth = await resolveAuthenticatedSellerSocialContext(req);
      if (auth.ok) {
        const requestedSenderId = Number(payload.senderUserId);
        if (Number.isInteger(requestedSenderId) && requestedSenderId > 0 && requestedSenderId !== auth.sellerUserId) {
          return res.status(403).json({
            error: "seller_session_mismatch",
            message: "Seller session does not match the sender profile in this request.",
          });
        }
        payload.senderUserId = auth.sellerUserId;
        usedSellerIdentity = true;
      } else if (!isAmbiguousSessionAuthError(auth.error)) {
        // Valid-looking seller session that failed profile linkage — do not fall through.
        return res.status(auth.status || 403).json({
          error: auth.error,
          message: auth.message,
        });
      }
      // session_invalid/expired: may be a buyer OTP session using the same field names.
    }

    if (!usedSellerIdentity) {
      const gated = await applyBuyerIdentityAuth(req, payload, "senderUserId");
      if (gated.error) {
        return res.status(gated.status || socialErrorStatus(gated.error)).json({
          error: gated.error,
          message: gated.message,
        });
      }
      payload = gated.payload || payload;
    }

    const result = await sendDirectMessage(payload);
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    // The WhatsApp ping fires inside sendDirectMessage, so every card kind
    // gets one rather than only this route.
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** POST /api/social/chat/react — toggle one reaction on a message. */
router.post("/chat/react", async (req, res) => {
  try {
    let payload = { ...(req.body || {}) };
    const hasSellerContext = hasSellerSessionContext(req, payload);
    let usedSellerIdentity = false;

    if (hasSellerContext) {
      const auth = await resolveAuthenticatedSellerSocialContext(req);
      if (auth.ok) {
        const requested = Number(payload.userId);
        if (Number.isInteger(requested) && requested > 0 && requested !== auth.sellerUserId) {
          return res.status(403).json({
            error: "seller_session_mismatch",
            message: "Seller session does not match the reacting profile in this request.",
          });
        }
        payload.userId = auth.sellerUserId;
        usedSellerIdentity = true;
      } else if (!isAmbiguousSessionAuthError(auth.error)) {
        return res.status(auth.status || 403).json({ error: auth.error, message: auth.message });
      }
    }

    if (!usedSellerIdentity) {
      const gated = await applyBuyerIdentityAuth(req, payload, "userId");
      if (gated.error) {
        return res.status(gated.status || socialErrorStatus(gated.error)).json({
          error: gated.error,
          message: gated.message,
        });
      }
      payload = gated.payload || payload;
    }

    const result = await toggleMessageReaction(payload);
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** GET /api/social/chat/reactions/available */
router.get("/chat/reactions/available", (_req, res) => {
  res.json({ emojis: ALLOWED_REACTIONS });
});

/**
 * POST /api/social/chat/voice
 *
 * A browser recording, multipart, held in memory only. Nothing is buffered
 * beyond the request: the bytes are written once as a short-lived playback
 * copy, handed to WAHA for the seller's WhatsApp, and then dropped.
 */
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
});

/**
 * POST /api/social/chat/photo
 *
 * "Send a photo of the back" is the most common message on a secondhand
 * marketplace and there was no way to answer it on the site -- images could
 * arrive from WhatsApp but never leave the browser.
 *
 * Same shape as /chat/voice: identity first, validate before anything touches
 * disk, write, post the message, then relay to WhatsApp without blocking the
 * response.
 */
router.post("/chat/photo", photoUpload.single("photo"), async (req, res) => {
  try {
    let payload = { ...(req.body || {}) };
    const hasSellerContext = hasSellerSessionContext(req, payload);
    let usedSellerIdentity = false;

    if (hasSellerContext) {
      const auth = await resolveAuthenticatedSellerSocialContext(req);
      if (auth.ok) {
        const requested = Number(payload.senderUserId);
        if (Number.isInteger(requested) && requested > 0 && requested !== auth.sellerUserId) {
          return res.status(403).json({
            error: "seller_session_mismatch",
            message: "Seller session does not match the sender profile in this request.",
          });
        }
        payload.senderUserId = auth.sellerUserId;
        usedSellerIdentity = true;
      } else if (!isAmbiguousSessionAuthError(auth.error)) {
        return res.status(auth.status || 403).json({ error: auth.error, message: auth.message });
      }
    }
    if (!usedSellerIdentity) {
      const gated = await applyBuyerIdentityAuth(req, payload, "senderUserId");
      if (gated.error) {
        return res.status(gated.status || socialErrorStatus(gated.error)).json({
          error: gated.error,
          message: gated.message,
        });
      }
      payload = gated.payload || payload;
    }

    const check = validatePhotoUpload({
      buffer: req.file?.buffer,
      mimetype: req.file?.mimetype || payload.mimetype,
    });
    if (!check.ok) {
      return res.status(400).json({ error: check.error, message: check.message });
    }

    // A caption rides the normal content field, so it goes through the same
    // contact-details filter as any other message.
    const caption = String(payload.caption || "").trim().slice(0, 500);
    const stored = await storeChatPhoto(req.file.buffer, check.ext);
    const result = await sendDirectMessage({
      senderUserId: Number(payload.senderUserId),
      receiverUserId: Number(payload.receiverUserId),
      content: caption,
      kind: "image",
      payload: {
        mediaUrl: stored.url,
        mimetype: req.file.mimetype,
        source: "web",
      },
      expiresAt: new Date(Date.now() + PHOTO_TTL_MS),
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }

    // Not awaited: WAHA can be slow or restarting, and the photo is already in
    // the thread. A failed relay costs a WhatsApp copy, not the message.
    void (async () => {
      try {
        const { findUserById } = await import("../db/repositories/users.js");
        const peer = await findUserById(Number(payload.receiverUserId));
        if (peer?.phone) {
          await relayPhotoToWhatsApp(
            peer.phone,
            req.file.buffer,
            req.file.mimetype,
            stored.filename,
            caption
          );
        }
      } catch (err) {
        console.warn("[social] photo relay skipped:", err.message);
      }
    })();

    res.status(201).json(result);
  } catch (err) {
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: "photo_too_large",
        message: "That photo is too big. Try a smaller one.",
      });
    }
    console.warn("[social] photo upload failed:", err.message);
    res.status(500).json(clientError(err, "photo_upload_failed"));
  }
});

const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VOICE_BYTES, files: 1 },
});

router.post("/chat/voice", voiceUpload.single("audio"), async (req, res) => {
  try {
    let payload = { ...(req.body || {}) };
    const hasSellerContext = hasSellerSessionContext(req, payload);
    let usedSellerIdentity = false;

    if (hasSellerContext) {
      const auth = await resolveAuthenticatedSellerSocialContext(req);
      if (auth.ok) {
        const requested = Number(payload.senderUserId);
        if (Number.isInteger(requested) && requested > 0 && requested !== auth.sellerUserId) {
          return res.status(403).json({
            error: "seller_session_mismatch",
            message: "Seller session does not match the sender profile in this request.",
          });
        }
        payload.senderUserId = auth.sellerUserId;
        usedSellerIdentity = true;
      } else if (!isAmbiguousSessionAuthError(auth.error)) {
        return res.status(auth.status || 403).json({ error: auth.error, message: auth.message });
      }
    }
    if (!usedSellerIdentity) {
      const gated = await applyBuyerIdentityAuth(req, payload, "senderUserId");
      if (gated.error) {
        return res.status(gated.status || socialErrorStatus(gated.error)).json({
          error: gated.error,
          message: gated.message,
        });
      }
      payload = gated.payload || payload;
    }

    const check = validateVoiceUpload({
      buffer: req.file?.buffer,
      mimetype: req.file?.mimetype || payload.mimetype,
      durationMs: payload.durationMs,
    });
    if (!check.ok) {
      return res.status(400).json({ error: check.error, message: check.message });
    }

    const stored = await storeVoiceNote(req.file.buffer, check.ext);
    const durationMs = Number(payload.durationMs);
    const result = await sendDirectMessage({
      senderUserId: Number(payload.senderUserId),
      receiverUserId: Number(payload.receiverUserId),
      content: "",
      kind: "voice",
      payload: {
        mediaUrl: stored.url,
        mimetype: req.file.mimetype,
        source: "web",
        ...(Number.isFinite(durationMs) && durationMs > 0 ? { durationMs: Math.round(durationMs) } : {}),
      },
      expiresAt: new Date(Date.now() + VOICE_TTL_MS),
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }

    // Not awaited: WAHA can be slow or restarting, and the message is already
    // in the thread. A failed relay costs a WhatsApp copy, not the note.
    void (async () => {
      try {
        const { findUserById } = await import("../db/repositories/users.js");
        const peer = await findUserById(Number(payload.receiverUserId));
        if (peer?.phone) {
          await relayVoiceToWhatsApp(peer.phone, req.file.buffer, req.file.mimetype, stored.filename);
        }
      } catch (err) {
        console.warn("[social] voice relay skipped:", err.message);
      }
    })();

    res.status(201).json(result);
  } catch (err) {
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: "recording_too_large",
        message: "That recording is too long. Keep it under 30 seconds.",
      });
    }
    console.warn("[social] voice upload failed:", err.message);
    res.status(500).json(clientError(err, "voice_upload_failed"));
  }
});

/**
 * The stored filename when a media URL points at a voice note on our own
 * disk, otherwise null.
 *
 * Only a bare UUID-style name is accepted. The name comes out of the message
 * payload rather than the request, but a path segment must never be able to
 * walk out of the folder regardless of where it came from.
 */
/**
 * Serve a note from our own disk.
 *
 * sendFile answers Range requests. A browser playing audio asks for ranges,
 * and a server that ignores them hands back the whole file from byte zero
 * every time the player rebuffers -- which is what made playback stall and
 * cut out part way through a note.
 */
function serveLocalMedia(res, { dir, name }) {
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.sendFile(path.join(dir, name), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "media_unavailable" });
  });
}

/** Folders we serve ourselves, by the path they appear under. */
const LOCAL_MEDIA_DIRS = new Map([
  ["voice-notes", () => VOICE_DIR],
  ["chat-photos", () => CHAT_PHOTO_DIR],
]);

/**
 * Resolve a media URL to a file on our own disk, or null if it is not ours.
 *
 * Only a bare filename is accepted. The value comes from the message payload
 * rather than the request, but a path segment must never be able to walk out
 * of the folder regardless of where it came from.
 *
 * @returns {{dir:string, name:string}|null}
 */
export function localMediaFile(mediaUrl) {
  const match = /\/assets\/(voice-notes|chat-photos)\/([A-Za-z0-9._-]+)$/.exec(
    String(mediaUrl || "")
  );
  if (!match) return null;
  const name = match[2];
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) return null;
  const dir = LOCAL_MEDIA_DIRS.get(match[1]);
  return dir ? { dir: dir(), name } : null;
}

/**
 * GET /api/social/chat/media/:messageId
 *
 * Two sources behind one URL. A note recorded on the site is on our disk and
 * goes out through sendFile, so Range requests work and a player can seek and
 * rebuffer. Anything that arrived over WhatsApp is streamed from WAHA and
 * passes straight through, buffering nothing on this VM.
 */
router.get("/chat/media/:messageId", async (req, res) => {
  try {
    const messageId = Number(req.params.messageId);
    if (!Number.isInteger(messageId) || messageId < 1) {
      return res.status(400).json({ error: "invalid_message_id" });
    }

    let payload = { ...(req.query || {}) };
    const hasSellerContext = hasSellerSessionContext(req, payload);
    let viewerId = null;

    if (hasSellerContext) {
      const auth = await resolveAuthenticatedSellerSocialContext(req);
      if (auth.ok) viewerId = auth.sellerUserId;
      else if (!isAmbiguousSessionAuthError(auth.error)) {
        return res.status(auth.status || 403).json({ error: auth.error, message: auth.message });
      }
    }
    if (!viewerId) {
      const gated = await applyBuyerIdentityAuth(req, payload, "userId");
      if (gated.error) {
        return res.status(gated.status || socialErrorStatus(gated.error)).json({
          error: gated.error,
          message: gated.message,
        });
      }
      viewerId = Number((gated.payload || payload).userId);
    }

    const media = await getMessageMedia({ messageId, viewerUserId: viewerId });
    if (media.error) {
      return res.status(socialErrorStatus(media.error)).json({
        error: media.error,
        message: media.message,
      });
    }

    const local = localMediaFile(media.mediaUrl);
    if (local) return serveLocalMedia(res, local);

    const { streamWahaMedia } = await import("../services/whatsapp.js");
    const { stream, contentType, contentLength } = await streamWahaMedia(media.mediaUrl);
    // This one is a straight proxy and cannot serve a partial range, so say
    // so rather than letting the player assume it can seek.
    res.setHeader("Accept-Ranges", "none");

    res.setHeader("Content-Type", media.mimetype || contentType);
    if (contentLength) res.setHeader("Content-Length", String(contentLength));
    // Private: the URL is per-message and only a participant may fetch it.
    res.setHeader("Cache-Control", "private, max-age=300");

    // If the listener navigates away mid-play, stop pulling from WAHA rather
    // than finishing a download nobody is waiting for.
    res.on("close", () => stream.destroy?.());
    stream.on("error", (err) => {
      console.warn("[social] media stream error:", err.message);
      if (!res.headersSent) res.status(502).json({ error: "media_unavailable" });
      else res.end();
    });
    stream.pipe(res);
  } catch (err) {
    console.warn("[social] media route failed:", err.message);
    if (!res.headersSent) res.status(502).json(clientError(err, "media_unavailable"));
  }
});

/** POST /api/social/bundles — propose a bundle of items from one shop. */
router.post("/bundles", async (req, res) => {
  try {
    let payload = { ...(req.body || {}) };
    const gated = await applyBuyerIdentityAuth(req, payload, "buyerUserId");
    if (gated.error) {
      return res.status(gated.status || socialErrorStatus(gated.error)).json({
        error: gated.error,
        message: gated.message,
      });
    }
    payload = gated.payload || payload;

    const result = await createBundle(payload);
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }

    // Drop the card into the thread so the seller sees it where they are
    // already talking, rather than only in a list somewhere.
    void postBundleCard(result.bundle).catch((err) =>
      console.warn("[social] bundle card skipped:", err.message)
    );
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** POST /api/social/bundles/:bundleId/respond — accept, counter or decline. */
router.post("/bundles/:bundleId/respond", async (req, res) => {
  try {
    let payload = { ...(req.body || {}), bundleId: req.params.bundleId };
    const hasSellerContext = hasSellerSessionContext(req, payload);
    let usedSellerIdentity = false;

    if (hasSellerContext) {
      const auth = await resolveAuthenticatedSellerSocialContext(req);
      if (auth.ok) {
        const requested = Number(payload.userId);
        if (Number.isInteger(requested) && requested > 0 && requested !== auth.sellerUserId) {
          return res.status(403).json({
            error: "seller_session_mismatch",
            message: "Seller session does not match the responding profile in this request.",
          });
        }
        payload.userId = auth.sellerUserId;
        usedSellerIdentity = true;
      } else if (!isAmbiguousSessionAuthError(auth.error)) {
        return res.status(auth.status || 403).json({ error: auth.error, message: auth.message });
      }
    }
    if (!usedSellerIdentity) {
      const gated = await applyBuyerIdentityAuth(req, payload, "userId");
      if (gated.error) {
        return res.status(gated.status || socialErrorStatus(gated.error)).json({
          error: gated.error,
          message: gated.message,
        });
      }
      payload = gated.payload || payload;
    }

    const result = await respondToBundle(payload);
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    void postBundleCard(result.bundle).catch((err) =>
      console.warn("[social] bundle card skipped:", err.message)
    );
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** GET /api/social/bundles/:bundleId */
router.get("/bundles/:bundleId", async (req, res) => {
  try {
    const result = await getBundle(req.params.bundleId);
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** POST /api/social/chat/scratch-card — seller sends a funded discount. */
router.post("/chat/scratch-card", async (req, res) => {
  try {
    let payload = { ...(req.body || {}) };
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (!auth.ok) {
      // Only a seller may discount their own item, so there is no buyer path.
      return res.status(auth.status || 403).json({
        error: auth.error || "seller_session_required",
        message: auth.message || "Sign in as the seller to send a deal.",
      });
    }
    payload.sellerUserId = auth.sellerUserId;

    const result = await sendScratchCard(payload);
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** POST /api/social/chat/scratch-card/:messageId/reveal — buyer scratches. */
router.post("/chat/scratch-card/:messageId/reveal", async (req, res) => {
  try {
    let payload = { ...(req.body || {}), messageId: req.params.messageId };
    const gated = await applyBuyerIdentityAuth(req, payload, "userId");
    if (gated.error) {
      return res.status(gated.status || socialErrorStatus(gated.error)).json({
        error: gated.error,
        message: gated.message,
      });
    }
    payload = gated.payload || payload;

    const result = await revealScratchCard(payload);
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** GET /api/social/chat/scratch-card/options?productId=... */
router.get("/chat/scratch-card/options", async (req, res) => {
  try {
    const { rows } = await import("../db/pool.js").then(({ query }) =>
      query(`SELECT price_kes FROM products WHERE id = $1`, [String(req.query.productId || "")])
    );
    if (!rows[0]) return res.status(404).json({ error: "product_not_found" });
    res.json({ options: perkOptions(rows[0].price_kes) });
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** POST /api/social/chat/nudge — buzz the other side, once an hour. */
router.post("/chat/nudge", async (req, res) => {
  try {
    let payload = { ...(req.body || {}) };
    const hasSellerContext = hasSellerSessionContext(req, payload);
    let usedSellerIdentity = false;

    if (hasSellerContext) {
      const auth = await resolveAuthenticatedSellerSocialContext(req);
      if (auth.ok) {
        const requested = Number(payload.senderUserId);
        if (Number.isInteger(requested) && requested > 0 && requested !== auth.sellerUserId) {
          return res.status(403).json({
            error: "seller_session_mismatch",
            message: "Seller session does not match the sender profile in this request.",
          });
        }
        payload.senderUserId = auth.sellerUserId;
        usedSellerIdentity = true;
      } else if (!isAmbiguousSessionAuthError(auth.error)) {
        return res.status(auth.status || 403).json({ error: auth.error, message: auth.message });
      }
    }
    if (!usedSellerIdentity) {
      const gated = await applyBuyerIdentityAuth(req, payload, "senderUserId");
      if (gated.error) {
        return res.status(gated.status || socialErrorStatus(gated.error)).json({
          error: gated.error,
          message: gated.message,
        });
      }
      payload = gated.payload || payload;
    }

    const result = await sendNudge(payload);
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** GET /api/social/drops/recipients — past buyers a drop may go to. */
router.get("/drops/recipients", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (!auth.ok) {
      return res.status(auth.status || 403).json({
        error: auth.error || "seller_session_required",
        message: auth.message || "Sign in as the seller.",
      });
    }
    res.json({ recipients: await eligibleDropRecipients(auth.sellerUserId) });
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** POST /api/social/drops — send early access to chosen past buyers. */
router.post("/drops", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (!auth.ok) {
      // Only a seller can drop their own item, so there is no buyer path.
      return res.status(auth.status || 403).json({
        error: auth.error || "seller_session_required",
        message: auth.message || "Sign in as the seller.",
      });
    }
    const result = await sendLockedDrop({ ...(req.body || {}), sellerUserId: auth.sellerUserId });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/**
 * POST /api/social/chat/fit-check/:messageId
 *
 * The buyer's photo, uploaded in memory and written once -- same shape as the
 * voice route, for the same reason.
 */
const fitUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

router.post("/chat/fit-check/:messageId", fitUpload.single("photo"), async (req, res) => {
  try {
    let payload = { ...(req.body || {}), messageId: req.params.messageId };
    const gated = await applyBuyerIdentityAuth(req, payload, "userId");
    if (gated.error) {
      return res.status(gated.status || socialErrorStatus(gated.error)).json({
        error: gated.error,
        message: gated.message,
      });
    }
    payload = gated.payload || payload;

    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: "no_photo", message: "Attach a photo." });
    }
    if (!/^image\/(jpe?g|png|webp)$/i.test(String(req.file.mimetype || ""))) {
      return res.status(400).json({ error: "unsupported_image", message: "Send a JPG, PNG or WebP." });
    }

    const stored = await storeFitPhoto(req.file.buffer, req.file.mimetype);
    const result = await attachFitCheckPhoto({
      messageId: payload.messageId,
      userId: payload.userId,
      photoUrl: stored.url,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.status(201).json(result);
  } catch (err) {
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "photo_too_large", message: "That photo is too big." });
    }
    res.status(500).json(clientError(err));
  }
});

/** GET /api/social/chat/thread?userAId=1&userBId=2 */
router.get("/chat/thread", async (req, res) => {
  try {
    const hasSellerContext = hasSellerSessionContext(req, req.query || {});
    let userAId = req.query.userAId;
    let userBId = req.query.userBId;
    let usedSellerIdentity = false;

    if (hasSellerContext) {
      const auth = await resolveAuthenticatedSellerSocialContext(req);
      if (auth.ok) {
        const requestedUserA = Number(req.query.userAId);
        const requestedUserB = Number(req.query.userBId);
        const matchesA = Number.isInteger(requestedUserA) && requestedUserA > 0 && requestedUserA === auth.sellerUserId;
        const matchesB = Number.isInteger(requestedUserB) && requestedUserB > 0 && requestedUserB === auth.sellerUserId;
        if (!matchesA && !matchesB) {
          return res.status(403).json({
            error: "seller_session_mismatch",
            message: "Seller session does not match the chat thread participants in this request.",
          });
        }

        userAId = matchesA ? auth.sellerUserId : userAId;
        userBId = matchesB ? auth.sellerUserId : userBId;
        usedSellerIdentity = true;
      } else if (!isAmbiguousSessionAuthError(auth.error)) {
        return res.status(auth.status || 403).json({
          error: auth.error,
          message: auth.message,
        });
      }
    }

    if (!usedSellerIdentity && hasBuyerSessionContext(req, req.query || {})) {
      const auth = await resolveAuthenticatedBuyerSocialContext(req);
      if (auth.error) {
        return res.status(auth.status || 403).json({
          error: auth.error,
          message: auth.message,
        });
      }
      const requestedUserA = Number(req.query.userAId);
      const requestedUserB = Number(req.query.userBId);
      const matchesA = Number.isInteger(requestedUserA) && requestedUserA > 0 && requestedUserA === auth.buyerUserId;
      const matchesB = Number.isInteger(requestedUserB) && requestedUserB > 0 && requestedUserB === auth.buyerUserId;
      if (!matchesA && !matchesB) {
        return res.status(403).json({
          error: "buyer_session_mismatch",
          message: "Buyer session does not match the chat thread participants in this request.",
        });
      }
      userAId = matchesA ? auth.buyerUserId : userAId;
      userBId = matchesB ? auth.buyerUserId : userBId;
    }

    const result = await getDirectThread({
      userAId,
      userBId,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** POST /api/social/reviews/create — buyer→seller or seller→buyer after delivery */
router.post("/reviews/create", async (req, res) => {
  try {
    const direction =
      String(req.body?.direction || "buyer_to_seller").toLowerCase() === "seller_to_buyer"
        ? "seller_to_buyer"
        : "buyer_to_seller";

    if (direction === "seller_to_buyer") {
      const auth = await resolveAuthenticatedSellerSocialContext(req);
      if (auth.error) {
        return res.status(auth.status || socialErrorStatus(auth.error)).json({
          error: auth.error,
          message: auth.message,
        });
      }
      const result = await createOrderReview({
        orderId: req.body?.orderId ?? req.body?.orderRef,
        sellerUserId: auth.sellerUserId,
        buyerUserId: req.body?.buyerUserId,
        rating: req.body?.rating,
        comment: req.body?.comment,
        direction: "seller_to_buyer",
        buyerPhone: req.body?.buyerPhone || req.body?.phone,
      });
      if (result.error) {
        return res.status(socialErrorStatus(result.error)).json({
          error: result.error,
          message: result.message,
        });
      }
      return res.status(201).json(result);
    }

    const gated = await applyBuyerIdentityAuth(req, req.body || {}, "buyerUserId");
    if (gated.error) {
      return res.status(gated.status || socialErrorStatus(gated.error)).json({
        error: gated.error,
        message: gated.message,
      });
    }
    const payload = gated.payload || {};
    const result = await createOrderReview({
      ...payload,
      orderId: payload.orderId ?? payload.orderRef ?? req.body?.orderId ?? req.body?.orderRef,
      sellerUserId: payload.sellerUserId ?? req.body?.sellerUserId,
      rating: payload.rating ?? req.body?.rating,
      comment: payload.comment ?? req.body?.comment,
      buyerPhone: gated.phone || payload.phone || req.body?.phone,
      direction: "buyer_to_seller",
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json(clientError(err, "review_create_failed"));
  }
});

/** GET /api/social/reviews/reviewable?sellerUserId= — delivered orders buyer can still rate */
router.get("/reviews/reviewable", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedBuyerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || socialErrorStatus(auth.error)).json({
        error: auth.error,
        message: auth.message,
      });
    }
    const result = await listReviewableOrdersForSeller({
      buyerUserId: auth.buyerUserId,
      sellerUserId: req.query.sellerUserId,
      buyerPhone: auth.phone,
      limit: req.query.limit,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err, "reviewable_orders_failed"));
  }
});

/** GET /api/social/reviews/reviewable-buyers — delivered orders seller can still rate */
router.get("/reviews/reviewable-buyers", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || socialErrorStatus(auth.error)).json({
        error: auth.error,
        message: auth.message,
      });
    }
    const result = await listReviewableBuyersForSeller({
      sellerUserId: auth.sellerUserId,
      supplierId: auth.supplierId || null,
      limit: req.query.limit,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err, "reviewable_buyers_failed"));
  }
});

/** GET /api/social/reviews/seller/:sellerUserId */
router.get("/reviews/seller/:sellerUserId", async (req, res) => {
  try {
    const result = await listSellerReviews({
      sellerUserId: req.params.sellerUserId,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** GET /api/social/reviews/buyer/:buyerUserId — seller→buyer ratings on this buyer */
router.get("/reviews/buyer/:buyerUserId", async (req, res) => {
  try {
    const result = await listBuyerReviews({
      buyerUserId: req.params.buyerUserId,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

export default router;
