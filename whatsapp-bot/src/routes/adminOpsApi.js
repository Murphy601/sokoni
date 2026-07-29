import { Router } from "express";
import { config } from "../config.js";
import {
  getOpsStatus,
  pauseCatalog,
  unpauseCatalog,
  syncPublicCatalog,
  publishCatalogToGit,
  setProductStock,
  runDbMigrate,
  runDbSeed,
  updatePlatformFlags,
} from "../services/catalog-ops.js";
import { getWahaSessionStatus } from "../services/waha-session.js";

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

router.get("/status", async (_req, res) => {
  res.json({ status: await getOpsStatus() });
});

/** GET /admin/ops/waha — WhatsApp session link status (no QR / pairing codes). */
router.get("/waha", async (_req, res) => {
  try {
    const waha = await getWahaSessionStatus();
    res.json({ ok: true, waha });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/catalog/pause", async (req, res) => {
  const status = await pauseCatalog(req.body?.reason || "Paused via admin API");
  res.json({ ok: true, status });
});

router.post("/catalog/live", async (_req, res) => {
  const status = await unpauseCatalog("Live via admin API");
  res.json({ ok: true, status });
});

router.post("/catalog/sync", async (_req, res) => {
  try {
    const status = await syncPublicCatalog();
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/catalog/publish", async (_req, res) => {
  try {
    const status = await publishCatalogToGit();
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/stock/:productId", async (req, res) => {
  const inStock = req.body?.inStock !== false && req.body?.inStock !== "false";
  const result = await setProductStock(req.params.productId, inStock);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

router.post("/flags", (req, res) => {
  const flags = updatePlatformFlags(req.body || {});
  res.json({ ok: true, flags });
});

router.post("/db/migrate", async (_req, res) => {
  try {
    const result = await runDbMigrate();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/db/seed", async (req, res) => {
  try {
    const result = await runDbSeed(Boolean(req.body?.dryRun));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
