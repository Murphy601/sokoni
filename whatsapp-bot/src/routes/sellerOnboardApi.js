import { Router } from "express";
import {
  onboardSellerAsync,
  getSellerProfile,
  getSellerEscrowLedgerByPhone,
  getSellerOrdersByPhone,
  refreshSellerListing,
  updateSellerListingPrice,
  updateSellerListingStock,
  setSellerListingPromo,
  endSellerListingPromo,
  requireAuthenticatedSeller,
} from "../services/seller-onboard.js";
import {
  getSellerWithdrawSummaryByPhone,
  requestSellerWithdrawal,
} from "../services/seller-withdrawals.js";
import {
  sendSellerVerificationCode,
  verifySellerCode,
  revokeSellerSession,
  sellerSessionFromReq,
} from "../services/seller-verification.js";
import {
  deleteVendorZone,
  getOrCreateVendorShippingProfile,
  listVendorZones,
  upsertVendorShippingProfile,
  saveVendorZone,
} from "../services/vendor-shipping.js";
import { vendorOrderLocations } from "../services/rider-tracking.js";

const router = Router();

function phoneFromReq(req) {
  return String(req.body?.phone || req.query?.phone || req.headers["x-seller-phone"] || "").trim();
}

function vendorKeyFromSeller(check) {
  return String(check.supplier?.shopHandle || check.supplier?.id || check.supplier?.phone || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
}

function sessionAuthStatus(result) {
  if (
    result.error === "session_required" ||
    result.error === "session_invalid" ||
    result.error === "session_expired"
  ) {
    return 401;
  }
  if (result.error === "not_onboarded" || result.error === "not_approved") return 403;
  return 400;
}

async function authedSeller(req, res) {
  const phone = phoneFromReq(req);
  const sessionToken = sellerSessionFromReq(req);
  const check = await requireAuthenticatedSeller(phone, sessionToken);
  if (check.error) {
    res.status(sessionAuthStatus(check)).json({ error: check.error, message: check.message });
    return null;
  }
  return check;
}

/** POST /api/seller/onboard/send-code — WhatsApp OTP (free via WAHA) */
router.post("/send-code", async (req, res) => {
  const { phone } = req.body || {};
  const result = await sendSellerVerificationCode(phone);
  if (result.error === "rate_limited") return res.status(429).json(result);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** POST /api/seller/onboard/verify-code — confirm OTP, get session token */
router.post("/verify-code", async (req, res) => {
  const { phone, code } = req.body || {};
  const result = await verifySellerCode(phone, code);
  if (result.error === "wrong_code" || result.error === "invalid_code") {
    return res.status(400).json(result);
  }
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** POST /api/seller/onboard/sign-out — revoke server session */
router.post("/sign-out", async (req, res) => {
  const { phone } = req.body || {};
  const result = await revokeSellerSession(phone);
  res.json(result);
});

/** POST /api/seller/onboard — WhatsApp phone + shop + M-Pesa setup */
router.post("/", async (req, res) => {
  const { phone, shopName, shopHandle, mpesaNumber, nationalId, sessionToken, verificationToken } =
    req.body || {};
  const result = await onboardSellerAsync({
    phone,
    shopName,
    shopHandle,
    mpesaNumber,
    nationalId,
    sessionToken: sessionToken || verificationToken || sellerSessionFromReq(req),
  });
  if (result.error === "not_verified" || result.error === "verification_expired") {
    return res.status(403).json(result);
  }
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.error === "invalid_mpesa" || result.error === "invalid_phone" || result.error === "missing_shop") {
    return res.status(400).json(result);
  }
  if (result.error) return res.status(400).json(result);
  res.status(result.existing ? 200 : 201).json(result);
});

/** GET /api/seller/onboard?phone= — seller profile (requires session) */
router.get("/", async (req, res) => {
  const result = await getSellerProfile(req.query.phone, sellerSessionFromReq(req));
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.needsSetup) return res.status(404).json(result);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

/** GET /api/seller/onboard/ledger?phone= — escrow ledger tabs */
router.get("/ledger", async (req, res) => {
  const result = await getSellerEscrowLedgerByPhone(req.query.phone, sellerSessionFromReq(req));
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.error) return res.status(403).json(result);
  res.json(result);
});

/** GET /api/seller/onboard/orders?phone= — paid orders, labels, shipment status */
router.get("/orders", async (req, res) => {
  const result = await getSellerOrdersByPhone(req.query.phone, sellerSessionFromReq(req));
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.error) return res.status(403).json(result);
  res.json(result);
});

/** GET /api/seller/onboard/withdraw?phone= — available balance + withdrawal history */
router.get("/withdraw", async (req, res) => {
  const result = await getSellerWithdrawSummaryByPhone(req.query.phone, sellerSessionFromReq(req));
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.error) return res.status(403).json(result);
  res.json(result);
});

/** POST /api/seller/onboard/withdraw — request manual M-Pesa payout */
router.post("/withdraw", async (req, res) => {
  const { phone } = req.body || {};
  const result = await requestSellerWithdrawal(phone, sellerSessionFromReq(req));
  if (result.error === "no_balance") return res.status(400).json(result);
  if (result.error === "withdrawal_pending") return res.status(409).json(result);
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.error) return res.status(403).json(result);
  res.json(result);
});

/** POST /api/seller/onboard/refresh — bump listing timestamp */
router.post("/refresh", async (req, res) => {
  const { phone, productId } = req.body || {};
  const result = await refreshSellerListing({
    phone,
    productId,
    sessionToken: sellerSessionFromReq(req),
  });
  if (result.error === "not_found") return res.status(404).json(result);
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.error) return res.status(403).json(result);
  res.json(result);
});

/** POST /api/seller/onboard/price — update live listing seller-net (notifies likers on drop) */
router.post("/price", async (req, res) => {
  const { phone, productId, sellerNetKes, priceKes, stockQuantity, quantity } = req.body || {};
  const sessionToken = sellerSessionFromReq(req);
  const stockQty = stockQuantity ?? quantity;

  // Apply units first when present — clears wrongful sold locks so price update can proceed.
  let stockResult = null;
  if (stockQty != null && stockQty !== "") {
    stockResult = await updateSellerListingStock({
      phone,
      productId,
      stockQuantity: stockQty,
      sessionToken,
    });
    if (stockResult.error === "session_required" || stockResult.error === "session_invalid" || stockResult.error === "session_expired") {
      return res.status(401).json(stockResult);
    }
    if (stockResult.error && sellerNetKes == null && priceKes == null) {
      if (stockResult.error === "not_found") return res.status(404).json(stockResult);
      if (stockResult.error === "invalid_stock" || stockResult.error === "missing_product_id") {
        return res.status(400).json(stockResult);
      }
      return res.status(403).json(stockResult);
    }
  }

  if (sellerNetKes == null && priceKes == null) {
    if (stockResult?.success) return res.json(stockResult);
    return res.status(400).json({ error: "invalid_price", message: "Enter a price or stock quantity." });
  }

  const result = await updateSellerListingPrice({
    phone,
    productId,
    sellerNetKes: sellerNetKes ?? priceKes,
    sessionToken,
  });
  if (result.error === "not_found") return res.status(404).json(result);
  if (result.error === "invalid_price") return res.status(400).json(result);
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.error) return res.status(403).json(result);

  if (stockResult?.success) {
    return res.json({
      ...result,
      stockQuantity: stockResult.stockQuantity,
      inStock: stockResult.inStock,
      stockMessage: stockResult.message,
    });
  }
  if (stockResult?.error) {
    return res.json({
      ...result,
      stockError: stockResult.error,
      message: `${result.message} Stock note: ${stockResult.message || stockResult.error}`,
    });
  }

  res.json(result);
});

/** POST /api/seller/onboard/promo — start item promo (STK uses new priceKes) */
router.post("/promo", async (req, res) => {
  const { phone, productId, type, value } = req.body || {};
  const result = await setSellerListingPromo({
    phone,
    productId,
    type,
    value,
    sessionToken: sellerSessionFromReq(req),
  });
  if (result.error === "not_found") return res.status(404).json(result);
  if (
    result.error === "invalid_promo_value" ||
    result.error === "invalid_promo_type" ||
    result.error === "promo_too_steep" ||
    result.error === "promo_not_lower" ||
    result.error === "invalid_list_price"
  ) {
    return res.status(400).json(result);
  }
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.error) return res.status(403).json(result);
  res.json(result);
});

/** POST /api/seller/onboard/promo/end — restore list price */
router.post("/promo/end", async (req, res) => {
  const { phone, productId } = req.body || {};
  const result = await endSellerListingPromo({
    phone,
    productId,
    sessionToken: sellerSessionFromReq(req),
  });
  if (result.error === "not_found") return res.status(404).json(result);
  if (result.error === "no_active_promo" || result.error === "invalid_list_price") {
    return res.status(400).json(result);
  }
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.error) return res.status(403).json(result);
  res.json(result);
});

/** POST /api/seller/onboard/stock — update live listing units on hand */
router.post("/stock", async (req, res) => {
  const { phone, productId, stockQuantity, quantity } = req.body || {};
  const result = await updateSellerListingStock({
    phone,
    productId,
    stockQuantity: stockQuantity ?? quantity,
    sessionToken: sellerSessionFromReq(req),
  });
  if (result.error === "not_found") return res.status(404).json(result);
  if (result.error === "invalid_stock" || result.error === "missing_product_id") {
    return res.status(400).json(result);
  }
  if (result.error === "product_sold") return res.status(409).json(result);
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.error) return res.status(403).json(result);
  res.json(result);
});

/**
 * Shipping rates — same OTP session auth as ledger/orders/withdraw.
 * Prefer this path from Seller Hub (Cloudflare → bot.sokonimall.com).
 */
router.get("/shipping-rules", async (req, res) => {
  const check = await authedSeller(req, res);
  if (!check) return;
  const vendorKey = vendorKeyFromSeller(check);
  if (!vendorKey) {
    return res.status(400).json({ error: "vendor_required", message: "Complete seller profile first." });
  }
  const profile = getOrCreateVendorShippingProfile(vendorKey);
  const zones = listVendorZones(vendorKey);
  res.json({ success: true, vendorKey, profile, zones });
});

router.post("/shipping-rules", async (req, res) => {
  const check = await authedSeller(req, res);
  if (!check) return;
  const vendorKey = vendorKeyFromSeller(check);
  if (!vendorKey) {
    return res.status(400).json({ error: "vendor_required", message: "Complete seller profile first." });
  }
  try {
    const result = upsertVendorShippingProfile(vendorKey, req.body || {});
    if (!result.ok) return res.status(400).json(result);
    res.json({ success: true, profile: result.profile, zones: listVendorZones(vendorKey) });
  } catch (err) {
    console.error("[seller-onboard] shipping-rules save failed:", err?.message || err);
    res.status(500).json({ error: "save_failed", message: "Could not save shipping rates — try again." });
  }
});

router.post("/shipping-zones", async (req, res) => {
  const check = await authedSeller(req, res);
  if (!check) return;
  const vendorKey = vendorKeyFromSeller(check);
  if (!vendorKey) {
    return res.status(400).json({ error: "vendor_required", message: "Complete seller profile first." });
  }
  const result = saveVendorZone(vendorKey, {
    id: req.body?.id,
    zoneName: req.body?.zoneName || req.body?.zone_name,
    priceKes: req.body?.priceKes ?? req.body?.price_kes,
    boundary: req.body?.boundary || req.body?.boundary_geojson,
  });
  if (!result.ok) return res.status(400).json(result);
  res.json({ success: true, zone: result.zone, zones: listVendorZones(vendorKey) });
});

router.delete("/shipping-zones/:zoneId", async (req, res) => {
  const check = await authedSeller(req, res);
  if (!check) return;
  const vendorKey = vendorKeyFromSeller(check);
  const result = deleteVendorZone(vendorKey, req.params.zoneId);
  if (!result.ok) return res.status(404).json(result);
  res.json({ success: true, zones: listVendorZones(vendorKey) });
});

router.get("/shipping-analytics/locations", async (req, res) => {
  const check = await authedSeller(req, res);
  if (!check) return;
  const vendorKey = vendorKeyFromSeller(check);
  const data = vendorOrderLocations(vendorKey);
  res.json({ success: true, vendorKey, ...data });
});

export default router;
