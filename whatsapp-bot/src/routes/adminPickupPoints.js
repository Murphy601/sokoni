import { Router } from "express";
import { config } from "../config.js";
import {
  listApplications,
  getApplication,
  approveApplication,
  rejectApplication,
  listPickupPoints,
} from "../services/pickupPoints.js";

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

router.post("/applications/:id/approve", (req, res) => {
  const result = approveApplication(req.params.id.toUpperCase());
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

router.post("/applications/:id/reject", (req, res) => {
  const result = rejectApplication(req.params.id.toUpperCase(), req.body?.reason || "");
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

router.get("/points", (_req, res) => {
  res.json({ pickupPoints: listPickupPoints() });
});

export default router;
