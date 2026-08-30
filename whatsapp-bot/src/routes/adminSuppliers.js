import { Router } from "express";
import {
  listApplications,
  getApplication,
  approveApplication,
  rejectApplication,
  listSuppliers,
  listSellerKycQueue,
  reviewSellerKyc,
  setSellerShopStatus,
  listShopsForAdminReview,
  getSupplier,
} from "../services/suppliers.js";
import {
  listShopsDesk,
  listShopItemsForAdmin,
  setShopVerifiedBadge,
  setShopCommissionOverride,
  setShopPayoutHold,
  overrideShopHandle,
  editShopProfile,
} from "../services/shops-desk.js";
import { getSettlementSummary, markPayoutPaid } from "../services/settlements.js";
import {
  listFlaggedListings,
  takedownListing,
  restoreListing,
} from "../services/seller-listings.js";
import { requireAdminToken } from "../lib/admin-auth.js";
import { normalizeOrderId } from "../lib/order-id.js";

const router = Router();

router.use(requireAdminToken);

router.get("/applications", (_req, res) => {
  res.json({ applications: listApplications() });
});

router.get("/applications/:id", (req, res) => {
  const app = getApplication(req.params.id.toUpperCase());
  if (!app) return res.status(404).json({ error: "not_found" });
  res.json({ application: app });
});

router.post("/applications/:id/approve", async (req, res) => {
  const result = await approveApplication(req.params.id.toUpperCase(), {
    retailOverrides: req.body?.retailOverrides || {},
  });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

router.post("/applications/:id/reject", (req, res) => {
  const result = rejectApplication(req.params.id.toUpperCase(), req.body?.reason || "");
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

router.get("/suppliers", (_req, res) => {
  res.json({ suppliers: listSuppliers() });
});

/** Peer-seller KYC queue (National ID / KRA PIN review). Soft — listing still works until hard gate is enabled. */
router.get("/kyc", (req, res) => {
  const status = String(req.query.status || "pending").toLowerCase();
  res.json({ sellers: listSellerKycQueue({ status }) });
});

router.post("/kyc/:id/approve", (req, res) => {
  const result = reviewSellerKyc(req.params.id, { approve: true, note: req.body?.note || "" });
  if (result.error) return res.status(404).json(result);
  res.json({ ok: true, seller: result.supplier });
});

router.post("/kyc/:id/reject", (req, res) => {
  const result = reviewSellerKyc(req.params.id, { approve: false, note: req.body?.note || "" });
  if (result.error) return res.status(404).json(result);
  res.json({ ok: true, seller: result.supplier });
});

/**
 * Sellers & Shops desk — searchable table of all merchant inventories.
 * GET /admin/suppliers/shops-desk?q=&status=
 */
router.get("/shops-desk", async (req, res) => {
  try {
    const q = String(req.query.q || "");
    const status = String(req.query.status || "all");
    const shops = await listShopsDesk({ q, status });
    res.json({ shops });
  } catch (err) {
    res.status(500).json({ error: "shops_desk_failed", message: err?.message || "Failed" });
  }
});

/** Items + image gallery for one shop (drawer). */
router.get("/shops/:id/items", async (req, res) => {
  try {
    const result = await listShopItemsForAdmin(req.params.id);
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "shop_items_failed", message: err?.message || "Failed" });
  }
});

router.post("/shops/:id/verify", (req, res) => {
  const verified = req.body?.verified !== false && req.body?.verified !== "false";
  const result = setShopVerifiedBadge(req.params.id, verified);
  if (result.error) return res.status(404).json(result);
  res.json({ ok: true, shop: result.supplier });
});

router.post("/shops/:id/commission", (req, res) => {
  const result = setShopCommissionOverride(req.params.id, req.body?.percent);
  if (result.error) {
    return res.status(result.error === "not_found" ? 404 : 400).json(result);
  }
  res.json({ ok: true, shop: result.supplier });
});

router.post("/shops/:id/payout-hold", (req, res) => {
  const hold = req.body?.hold !== false && req.body?.hold !== "false";
  const result = setShopPayoutHold(req.params.id, {
    hold,
    note: req.body?.note || "",
  });
  if (result.error) return res.status(404).json(result);
  res.json({ ok: true, shop: result.supplier });
});

router.post("/shops/:id/handle", (req, res) => {
  const result = overrideShopHandle(req.params.id, req.body?.handle || "");
  if (result.error) {
    return res.status(result.error === "not_found" ? 404 : 400).json(result);
  }
  res.json({ ok: true, shop: result.supplier });
});

/** Freeze = temporary pause; existing escrow untouched; listings + shop hidden. */
router.post("/shops/:id/freeze", async (req, res) => {
  const note = req.body?.note || "Frozen by Sokoni admin";
  const { enforceSellerAction } = await import("../services/enforce-account.js");
  const out = await enforceSellerAction(req.params.id, "PAUSE", {
    reason: note,
    adminLabel: "Admin panel",
  });
  if (!out.ok) return res.status(out.error === "not_found" ? 404 : 400).json(out);
  res.json({ ok: true, ...out, shop: getSupplier(req.params.id) });
});

router.post("/shops/:id/edit", (req, res) => {
  const result = editShopProfile(req.params.id, {
    name: req.body?.name,
    phone: req.body?.phone,
    bio: req.body?.bio,
    shopHandle: req.body?.shopHandle,
  });
  if (result.error) {
    return res.status(result.error === "not_found" ? 404 : 400).json(result);
  }
  res.json({ ok: true, shop: result.supplier });
});

/** Shops paused / under review / deactivated (payouts held). */
router.get("/shops", (req, res) => {
  const status = String(req.query.status || "held").toLowerCase();
  res.json({ shops: listShopsForAdminReview({ status }) });
});

router.post("/shops/:id/pause", async (req, res) => {
  const note = req.body?.note || "Paused by Sokoni admin";
  const { enforceSellerAction } = await import("../services/enforce-account.js");
  const out = await enforceSellerAction(req.params.id, "PAUSE", {
    reason: note,
    adminLabel: "Admin panel",
  });
  if (!out.ok) return res.status(out.error === "not_found" ? 404 : 400).json(out);
  res.json({ ok: true, ...out, shop: getSupplier(req.params.id) });
});

router.post("/shops/:id/review", async (req, res) => {
  const note = req.body?.note || "Shop under Sokoni review";
  const result = setSellerShopStatus(req.params.id, {
    status: "under_review",
    note,
    holdPayouts: true,
  });
  if (result.error) return res.status(result.error === "not_found" ? 404 : 400).json(result);
  const shop = getSupplier(req.params.id);
  const { hideListingsForSupplier } = await import("../services/listing-moderation.js");
  const listings = await hideListingsForSupplier(req.params.id, {
    reason: note,
    phone: shop?.phone || shop?.mpesaNumber || "",
    handle: String(shop?.shopHandle || "").replace(/^@/, ""),
  });
  res.json({ ok: true, shop: result.supplier, listings });
});

router.post("/shops/:id/deactivate", async (req, res) => {
  const note = req.body?.note || "Shop deactivated by Sokoni";
  const { enforceSellerAction } = await import("../services/enforce-account.js");
  const out = await enforceSellerAction(req.params.id, "DEACTIVATE", {
    reason: note,
    adminLabel: "Admin panel",
  });
  if (!out.ok) return res.status(out.error === "not_found" ? 404 : 400).json(out);
  res.json({ ok: true, ...out, shop: getSupplier(req.params.id) });
});

router.post("/shops/:id/restore", async (req, res) => {
  const note = req.body?.note || "Shop restored after review";
  const { enforceSellerAction } = await import("../services/enforce-account.js");
  const out = await enforceSellerAction(req.params.id, "RESTORE", {
    reason: note,
    adminLabel: "Admin panel",
  });
  if (!out.ok) return res.status(out.error === "not_found" ? 404 : 400).json(out);
  res.json({ ok: true, ...out, shop: getSupplier(req.params.id) });
});

router.get("/payouts", (_req, res) => {
  res.json(getSettlementSummary());
});

router.post("/payouts/:orderId/paid", (req, res) => {
  const orderId = normalizeOrderId(req.params.orderId);
  if (!orderId) return res.status(400).json({ error: "invalid_order_id" });
  const entry = markPayoutPaid(orderId);
  if (!entry) return res.status(404).json({ error: "not_found" });
  res.json({ entry });
});

router.get("/seller-listings/flagged", async (_req, res) => {
  const listings = await listFlaggedListings();
  res.json({ listings });
});

router.post("/seller-listings/:id/takedown", async (req, res) => {
  const result = await takedownListing(req.params.id, req.body?.reason || "");
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

router.post("/seller-listings/:id/restore", async (req, res) => {
  const result = await restoreListing(req.params.id);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

export default router;
