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
} from "../services/suppliers.js";
import { getSettlementSummary, markPayoutPaid } from "../services/settlements.js";
import {
  listFlaggedListings,
  takedownListing,
  restoreListing,
  hideListingsForSupplier,
  restoreListingsForSupplier,
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

/** Shops paused / under review / deactivated (payouts held). */
router.get("/shops", (req, res) => {
  const status = String(req.query.status || "held").toLowerCase();
  res.json({ shops: listShopsForAdminReview({ status }) });
});

router.post("/shops/:id/pause", async (req, res) => {
  const note = req.body?.note || "Paused by Sokoni admin";
  const result = setSellerShopStatus(req.params.id, { status: "paused", note, holdPayouts: true });
  if (result.error) return res.status(result.error === "not_found" ? 404 : 400).json(result);
  const listings = await hideListingsForSupplier(req.params.id, { reason: note });
  res.json({ ok: true, shop: result.supplier, listings });
});

router.post("/shops/:id/review", async (req, res) => {
  const note = req.body?.note || "Shop under Sokoni review";
  const result = setSellerShopStatus(req.params.id, {
    status: "under_review",
    note,
    holdPayouts: true,
  });
  if (result.error) return res.status(result.error === "not_found" ? 404 : 400).json(result);
  const listings = await hideListingsForSupplier(req.params.id, { reason: note });
  res.json({ ok: true, shop: result.supplier, listings });
});

router.post("/shops/:id/deactivate", async (req, res) => {
  const note = req.body?.note || "Shop deactivated by Sokoni";
  const result = setSellerShopStatus(req.params.id, {
    status: "deactivated",
    note,
    holdPayouts: true,
  });
  if (result.error) return res.status(result.error === "not_found" ? 404 : 400).json(result);
  const listings = await hideListingsForSupplier(req.params.id, { reason: note });
  res.json({ ok: true, shop: result.supplier, listings });
});

router.post("/shops/:id/restore", async (req, res) => {
  const note = req.body?.note || "Shop restored after review";
  const result = setSellerShopStatus(req.params.id, {
    status: "live",
    note,
    holdPayouts: false,
  });
  if (result.error) return res.status(result.error === "not_found" ? 404 : 400).json(result);
  const listings = await restoreListingsForSupplier(req.params.id);
  res.json({ ok: true, shop: result.supplier, listings });
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
