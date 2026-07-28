import { getShopProfileByHandle } from "../db/repositories/social.js";
import { findSupplierByPhone } from "./suppliers.js";
import { sellerSessionFromReq, validateSellerSession } from "./seller-verification.js";

function normalizeHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function sellerLookupStatus(error) {
  if (error === "database_not_configured") return 503;
  if (error === "invalid_phone") return 400;
  if (error === "session_required" || error === "session_invalid" || error === "session_expired") return 401;
  return 403;
}

export async function resolveAuthenticatedSellerSocialContext(req, { requireSellerRecord = false } = {}) {
  const phone = req.body?.phone || req.query?.phone;
  const sessionToken = sellerSessionFromReq(req);
  const session = await validateSellerSession(phone, sessionToken);
  if (session.error) {
    return {
      error: session.error,
      message: session.message,
      status: sellerLookupStatus(session.error),
    };
  }

  const supplier = findSupplierByPhone(session.phone);
  if (!supplier) {
    return {
      error: "not_onboarded",
      message: "Set up your seller profile first, then try again.",
      status: 403,
    };
  }

  const handle = normalizeHandle(supplier.shopHandle || supplier.businessName || "");
  if (!handle) {
    return {
      error: "seller_handle_missing",
      message: "Add your shop handle in seller profile, then refresh and try again.",
      status: 403,
    };
  }

  const shop = await getShopProfileByHandle({ handle, limit: 1, offset: 0 });
  if (shop?.error) {
    return {
      error: shop.error,
      message: shop.message || "Could not resolve seller profile for this session.",
      status: sellerLookupStatus(shop.error),
    };
  }

  const sellerUserId = parsePositiveInt(shop?.shop?.userId);
  const sellerId = parsePositiveInt(shop?.shop?.sellerId);
  if (!sellerUserId) {
    return {
      error: "seller_user_not_linked",
      message: "Link your seller profile to a social user account before using this action.",
      status: 403,
    };
  }
  if (requireSellerRecord && !sellerId) {
    return {
      error: "seller_profile_not_linked",
      message: "Seller profile record not linked yet. Finish seller onboarding, then try again.",
      status: 403,
    };
  }

  return {
    ok: true,
    phone: session.phone,
    sellerUserId,
    sellerId,
    shopHandle: handle,
    supplierId: supplier.id,
  };
}
