import { Router } from "express";
import { config } from "../config.js";
import { sendText } from "../services/whatsapp.js";
import {
  createApplication,
  listPickupPoints,
  COMMISSION_PER_PARCEL_KES,
  SHOP_TYPES,
  KENYA_COUNTIES,
} from "../services/pickupPoints.js";

const router = Router();

router.get("/info", (_req, res) => {
  res.json({
    commissionPerParcelKes: COMMISSION_PER_PARCEL_KES,
    shopTypes: SHOP_TYPES,
    counties: KENYA_COUNTIES,
    note: "Earn a commission for every parcel you receive and hand to customers. Sokoni reviews all applications within 48 hours.",
  });
});

router.get("/", (_req, res) => {
  res.json({ pickupPoints: listPickupPoints() });
});

router.post("/apply", async (req, res) => {
  const result = createApplication(req.body || {});
  if (result.error === "missing_shop") {
    return res.status(400).json({ error: "Shop name and WhatsApp phone are required." });
  }
  if (result.error === "missing_location") {
    return res.status(400).json({ error: "County, town, and street address are required." });
  }

  const app = result.application;
  if (config.admin.primary) {
    try {
      await sendText(
        config.admin.primary,
        `📦 *New pickup point application* ${app.id}\n` +
          `${app.shop.name} · +${app.shop.phone}\n` +
          `${app.shop.city}, ${app.shop.county}\n` +
          `${app.shop.shopType}\n\n` +
          `Approve: POST /admin/pickup-points/applications/${app.id}/approve?token=...`
      );
    } catch (err) {
      console.warn("[pickup-points] admin notify failed:", err.message);
    }
  }

  res.status(201).json({
    applicationId: app.id,
    status: app.status,
    message: "Application received. Sokoni will WhatsApp you within 48 hours.",
  });
});

export default router;
