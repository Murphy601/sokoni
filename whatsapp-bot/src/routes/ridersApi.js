/**
 * Public rider onboarding — POST /api/riders/register
 */
import { Router } from "express";
import { registerRiderApplication, bodaSupportSummary } from "../services/boda-fleet.js";

const router = Router();

router.get("/info", (_req, res) => {
  res.json({ ok: true, ...bodaSupportSummary() });
});

/**
 * Body (JSON): fullName, phone, nationalId, operatingTown, stageLocation,
 * motorbikePlate, idDocument, dlDocument, stageLetter (base64 / data-URLs).
 */
router.post("/register", async (req, res) => {
  try {
    const result = await registerRiderApplication(req.body || {});
    if (result.error === "database_not_configured") return res.status(503).json(result);
    if (result.error) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (err) {
    console.warn("[riders/register]", err.message);
    res.status(500).json({ error: "register_failed", message: "Could not submit application." });
  }
});

export default router;
