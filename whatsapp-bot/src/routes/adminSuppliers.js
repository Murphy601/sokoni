import { Router } from "express";
import {
  listApplications,
  getApplication,
  approveApplication,
  rejectApplication,
  listSuppliers,
  listSellerKycQueue,
  reviewSellerKyc,
} from "../services/suppliers.js";
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
