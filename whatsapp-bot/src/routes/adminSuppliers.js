import { Router } from "express";
import { config } from "../config.js";
import {
  listApplications,
  getApplication,
  approveApplication,
  rejectApplication,
  listSuppliers,
} from "../services/suppliers.js";
import { getSettlementSummary, markPayoutPaid } from "../services/settlements.js";

const router = Router();

function isAdminTokenValid(token) {
  const expected =
    process.env.ADMIN_SETUP_TOKEN ||
    process.env.SUPPLIER_ADMIN_TOKEN ||
    config.tiktok.setupToken ||
    "";
  return expected && token === expected;
}

function requireToken(req, res, next) {
  if (!isAdminTokenValid(req.query.token)) {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
}

router.use(requireToken);

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

router.get("/payouts", (_req, res) => {
  res.json(getSettlementSummary());
});

router.post("/payouts/:orderId/paid", (req, res) => {
  const orderId = req.params.orderId.toUpperCase().startsWith("SK-")
    ? req.params.orderId.toUpperCase()
    : `SK-${req.params.orderId.replace(/\D/g, "")}`;
  const entry = markPayoutPaid(orderId);
  if (!entry) return res.status(404).json({ error: "not_found" });
  res.json({ entry });
});

export default router;
