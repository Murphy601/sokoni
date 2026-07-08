import { Router } from "express";
import { config } from "../config.js";
import { sendText } from "../services/whatsapp.js";
import {
  createApplication,
  SUPPLIER_CATEGORIES,
} from "../services/suppliers.js";
import { pricingBreakdown, MARKUP_FLAT_KES, MARKUP_PERCENT } from "../services/pricing.js";

const router = Router();

router.get("/info", (_req, res) => {
  res.json({
    markup: { flatKes: MARKUP_FLAT_KES, percent: MARKUP_PERCENT },
    categories: SUPPLIER_CATEGORIES,
    note: "Customer prices are set by Sokoni after review. Submit your supply price only.",
  });
});

router.post("/apply", async (req, res) => {
  const result = createApplication(req.body || {});
  if (result.error === "missing_business") {
    return res.status(400).json({ error: "Business name and phone are required." });
  }
  if (result.error === "missing_products") {
    return res.status(400).json({ error: "Add at least one product." });
  }

  const app = result.application;
  if (config.admin.primary) {
    try {
      await sendText(
        config.admin.primary,
        `🏪 *New supplier application* ${app.id}\n` +
          `${app.business.name} · +${app.business.phone}\n` +
          `${app.business.city} · ${app.products.length} product(s)\n` +
          `Delivers: ${app.business.delivers ? "yes" : "no"}\n\n` +
          `Approve: POST /admin/suppliers/applications/${app.id}/approve?token=...`
      );
    } catch (err) {
      console.warn("[suppliers] admin notify failed:", err.message);
    }
  }

  res.status(201).json({
    applicationId: app.id,
    status: app.status,
    message: "Application received. Sokoni will review and WhatsApp you within 48 hours.",
  });
});

router.get("/preview-price", (req, res) => {
  const supplierPrice = Number(req.query.supplierPriceKes);
  if (!Number.isFinite(supplierPrice) || supplierPrice <= 0) {
    return res.status(400).json({ error: "invalid_price" });
  }
  res.json({
    ...pricingBreakdown(supplierPrice),
    note: "Final customer price is set by Sokoni on approval. This is an estimate only.",
  });
});

export default router;
