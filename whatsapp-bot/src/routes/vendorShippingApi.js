import { Router } from "express";
import { requireApprovedSeller } from "../services/seller-listings.js";
import { sellerSessionFromReq } from "../services/seller-verification.js";
import {
  deleteVendorZone,
  getOrCreateVendorShippingProfile,
  listVendorZones,
  upsertVendorShippingProfileForSeller,
  findConfiguredVendorProfile,
  vendorKeyCandidatesFromSeller,
  saveVendorZone,
} from "../services/vendor-shipping.js";
import { listCounties, listTownsForCounty, loadKenyaLocations } from "../services/kenya-locations.js";
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
  const check = await requireApprovedSeller(phone, sessionToken);
  if (check.error) {
    res.status(sessionAuthStatus(check)).json({ error: check.error, message: check.message });
    return null;
  }
  return check;
}

/** Public: 47 counties + tiers (no auth). */
router.get("/locations/counties", (_req, res) => {
  const data = loadKenyaLocations();
  res.json({
    success: true,
    tiers: data.tiers,
    counties: listCounties(),
  });
});

router.get("/locations/towns", (req, res) => {
  const county = String(req.query.county || "").trim();
  if (!county) return res.status(400).json({ error: "county_required" });
  res.json({ success: true, county, towns: listTownsForCounty(county) });
});

router.get("/shipping-rules", async (req, res) => {
  const check = await authedSeller(req, res);
  if (!check) return;
  const keys = vendorKeyCandidatesFromSeller(check.supplier);
  const vendorKey = keys[0] || vendorKeyFromSeller(check);
  const found = findConfiguredVendorProfile(keys);
  const profile = found.profile || getOrCreateVendorShippingProfile(vendorKey);
  const zones = listVendorZones(found.vendorKey || vendorKey);
  res.json({ success: true, vendorKey: found.vendorKey || vendorKey, profile, zones });
});

router.post("/shipping-rules", async (req, res) => {
  const check = await authedSeller(req, res);
  if (!check) return;
  const vendorKey = vendorKeyCandidatesFromSeller(check.supplier)[0] || vendorKeyFromSeller(check);
  if (!vendorKey) {
    return res.status(400).json({ error: "vendor_required", message: "Complete seller profile first." });
  }
  try {
    const result = upsertVendorShippingProfileForSeller(check.supplier, req.body || {});
    if (!result.ok) return res.status(400).json(result);
    res.json({
      success: true,
      profile: result.profile,
      vendorKey: result.vendorKey || vendorKey,
      zones: listVendorZones(result.vendorKey || vendorKey),
    });
  } catch (err) {
    console.error("[vendor-shipping] shipping-rules save failed:", err?.message || err);
    res.status(500).json({ error: "save_failed", message: "Could not save shipping rates — try again." });
  }
});

router.post("/shipping-zones", async (req, res) => {
  const check = await authedSeller(req, res);
  if (!check) return;
  const vendorKey = vendorKeyFromSeller(check);
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

/** Seller demand heatmap points (lat/lng from paid orders). */
router.get("/analytics/locations", async (req, res) => {
  const check = await authedSeller(req, res);
  if (!check) return;
  const vendorKey = vendorKeyFromSeller(check);
  const data = vendorOrderLocations(vendorKey);
  res.json({ success: true, vendorKey, ...data });
});

export default router;
