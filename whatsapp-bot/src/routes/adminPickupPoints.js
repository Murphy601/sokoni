import { Router } from "express";
import {
  listApplications,
  getApplication,
  approveApplication,
  rejectApplication,
  listPickupPoints,
} from "../services/pickupPoints.js";
import { requireAdminToken } from "../lib/admin-auth.js";

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
