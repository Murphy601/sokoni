import express from "express";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { CATALOG_IMAGES_DIR } from "./lib/catalog-images.js";
import { handleWahaWebhook } from "./handlers/webhookHandler.js";
import { runTiktokPostJob } from "./services/tiktok.js";
import { startTokenRefreshScheduler, getConnectionStatus } from "./services/tiktok-auth.js";
import tiktokOAuthRouter from "./routes/tiktokOAuth.js";
import suppliersApiRouter from "./routes/suppliersApi.js";
import adminSuppliersRouter from "./routes/adminSuppliers.js";
import pickupPointsApiRouter from "./routes/pickupPointsApi.js";
import adminPickupPointsRouter from "./routes/adminPickupPoints.js";
import { listReviews, addReview } from "./services/reviews.js";
import { checkoutMeta } from "./services/prepaid-checkout.js";
import productsApiRouter from "./routes/productsApi.js";
import sellerListingsApiRouter from "./routes/sellerListingsApi.js";
import sellerOnboardApiRouter from "./routes/sellerOnboardApi.js";
import socialApiRouter from "./routes/socialApi.js";
import buyerAuthApiRouter from "./routes/buyerAuthApi.js";
import ordersApiRouter from "./routes/ordersApi.js";
import disputesApiRouter from "./routes/disputesApi.js";
import checkoutApiRouter from "./routes/checkoutApi.js";
import paymentsApiRouter from "./routes/paymentsApi.js";
import trackingApiRouter from "./routes/trackingApi.js";
import adminShipmentsRouter from "./routes/adminShipments.js";
import agentApiRouter from "./routes/agentApi.js";
import adminOpsApiRouter from "./routes/adminOpsApi.js";
import whatsappApiRouter from "./routes/whatsappApi.js";
import feedApiRouter from "./routes/feedApi.js";
import { processDuePayouts } from "./services/settlements.js";
import { agentMeta } from "./services/ai-agent.js";
import { feedMeta } from "./services/feed-ranking.js";
import { refreshFeedCache } from "./services/feed-ranking.js";
import { pingDb, isDbEnabled } from "./db/pool.js";

const app = express();

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function resolveBuildId() {
  if (process.env.BUILD_COMMIT) return process.env.BUILD_COMMIT;
  try {
    return execSync("git rev-parse --short HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const BUILD_ID = resolveBuildId();

const SITE_ORIGINS = new Set([
  config.publicSiteUrl,
  "https://sokonimall.com",
  "https://www.sokonimall.com",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && SITE_ORIGINS.has(origin.replace(/\/$/, ""))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Seller-Session, X-Buyer-Session, X-Admin-Token");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "25mb" }));

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: `${config.brand.name} WhatsApp bot (WAHA)`,
    session: config.waha.session,
  });
});

app.get("/health/live", (_req, res) => {
  res.json({ status: "ok", build: BUILD_ID });
});

app.get("/health", async (_req, res) => {
  const withTimeout = (promise, ms, fallback) =>
    Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);

  const db = await withTimeout(pingDb(), 3000, { ok: false, reason: "timeout" });
  const checkout = checkoutMeta();
  const agent = agentMeta();
  const feed = feedMeta();
  let ops = { phase: 9, catalog: { paused: false } };
  try {
    const { getOpsStatus } = await import("./services/catalog-ops.js");
    ops = await withTimeout(getOpsStatus(), 5000, ops);
  } catch (err) {
    ops = { phase: 9, catalog: { paused: false }, opsError: err.message };
  }
  let wahaHealth = {
    wahaConfigured: Boolean(config.waha.apiUrl),
    wahaReachable: false,
    wahaLinked: false,
    wahaSessionStatus: null,
  };
  try {
    const { getWahaHealthSummary } = await import("./services/waha-session.js");
    wahaHealth = await withTimeout(getWahaHealthSummary(), 3500, wahaHealth);
  } catch {
    /* keep defaults */
  }

  res.json({
    status: "ok",
    build: BUILD_ID,
    aiModel: config.openai.model || null,
    catalogVisionModel: config.catalog.visionModel || null,
    aiConfigured: Boolean(config.openai.apiKey),
    aiAgent: agent.name,
    aiTools: agent.tools,
    feedPhase: feed.phase,
    opsPhase: ops.phase,
    catalogPaused: ops.catalog.paused,
    wahaConfigured: wahaHealth.wahaConfigured,
    wahaReachable: wahaHealth.wahaReachable,
    wahaLinked: wahaHealth.wahaLinked,
    wahaSessionStatus: wahaHealth.wahaSessionStatus,
    dbEnabled: isDbEnabled(),
    dbConnected: db.ok,
    dbError: db.ok ? null : db.reason,
    prepaidOnly: checkout.prepaidOnly,
    darajaConfigured: checkout.darajaConfigured,
  });
});

/** Product photos — served from VM disk (no Cloudflare wait). */
const catalogImageStatic = express.static(CATALOG_IMAGES_DIR, {
  maxAge: "1d",
  setHeaders(res) {
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");
  },
});
app.use("/catalog-images", catalogImageStatic);
/** Alias so relative assets/images/products/* URLs also hit the VM when proxied. */
app.use("/assets/images/products", catalogImageStatic);

/** Seller shop avatars — optional profile photos. */
const avatarsDir = path.join(CATALOG_IMAGES_DIR, "..", "avatars");
app.use(
  "/assets/images/avatars",
  express.static(avatarsDir, {
    maxAge: "1d",
    setHeaders(res) {
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("Access-Control-Allow-Origin", "*");
    },
  })
);

/** Public reviews for website + WhatsApp-collected feedback. */
app.get("/api/reviews", (_req, res) => {
  res.json({ reviews: listReviews(30) });
});

app.post("/api/reviews", (req, res) => {
  const { customerName, productName, stars, comment, orderId } = req.body || {};
  const result = addReview({
    customerName,
    productName,
    stars,
    comment,
    orderId,
    source: "website",
  });
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
  res.status(201).json({ review: result.review });
});

app.use("/api/suppliers", suppliersApiRouter);
app.use("/api/products", productsApiRouter);
app.use("/api/seller/listings", sellerListingsApiRouter);
app.use("/api/seller/onboard", sellerOnboardApiRouter);
app.use("/api/social", socialApiRouter);
app.use("/api/buyer/auth", buyerAuthApiRouter);
app.use("/api/orders", ordersApiRouter);
app.use("/api/disputes", disputesApiRouter);
app.use("/api/checkout", checkoutApiRouter);
app.use("/api/payments", paymentsApiRouter);
app.use("/api/tracking", trackingApiRouter);
app.use("/api/agent", agentApiRouter);
app.use("/api/feed", feedApiRouter);
app.use("/api/whatsapp", whatsappApiRouter);
app.use("/admin/shipments", adminShipmentsRouter);
app.use("/admin/ops", adminOpsApiRouter);
app.use("/admin/suppliers", adminSuppliersRouter);
app.use("/api/pickup-points", pickupPointsApiRouter);
app.use("/admin/pickup-points", adminPickupPointsRouter);

/** Backend-only TikTok OAuth (connect once; tokens auto-refresh). */
app.use("/admin/tiktok", tiktokOAuthRouter);

/** WAHA posts inbound message events here. */
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    for (const event of events) {
      await handleWahaWebhook(event);
    }
  } catch (err) {
    console.error("Error handling webhook:", err);
  }
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`${config.brand.name} WhatsApp bot listening on port ${config.port} (build ${BUILD_ID})`);
  if (!config.waha.apiUrl) {
    console.log("⚠️ WAHA_API_URL not set — running in dry-run mode (messages will be logged, not sent).");
  } else {
    console.log(`✓ WAHA: ${config.waha.apiUrl} (session: ${config.waha.session})`);
  }
  if (!config.openai.apiKey) {
    console.log("⚠️ OPENAI_API_KEY not set — free-text replies will use a basic keyword-search fallback.");
  }
  const tiktok = getConnectionStatus();
  if (tiktok.connected) {
    console.log(`✓ TikTok connected (access until ${tiktok.accessExpiresAt})`);
  } else if (config.tiktok.clientKey) {
    console.log("⚠️ TikTok not connected — run: node scripts/tiktok-connect.mjs");
  }
  startTokenRefreshScheduler();
  startTiktokScheduler();
  startPayoutScheduler();
  startFeedScheduler();
  // Ensure platform storefront has a social user id (Make an offer / inbox).
  if (isDbEnabled()) {
    import("./db/repositories/sellers.js")
      .then(({ ensureDefaultSeller }) => ensureDefaultSeller())
      .then(() => import("./services/catalog.js"))
      .then(({ invalidateProductCache }) => invalidateProductCache())
      .catch((err) => console.warn("[sellers] default storefront ensure:", err.message));
  }
});

/** Refresh trending / price-tier feed slices hourly. */
function startFeedScheduler() {
  const tick = () => {
    refreshFeedCache().catch((err) => console.error("[feed] refresh:", err.message));
  };
  tick();
  setInterval(tick, 60 * 60 * 1000);
  console.log("✓ Feed ranking scheduler enabled (hourly)");
}

/** Move scheduled seller payouts to owed after 2–3 business day escrow hold. */
function startPayoutScheduler() {
  const tick = () => {
    try {
      const n = processDuePayouts();
      if (n > 0) console.log(`[settlements] ${n} seller payout(s) now owed`);
    } catch (err) {
      console.error("[settlements] payout cron:", err.message);
    }
  };
  tick();
  setInterval(tick, 60 * 60 * 1000);
  console.log("✓ Seller payout scheduler enabled (hourly)");
}

/** Parse "HH:MM" slots for daily posting. */
function parsePostTimes(times) {
  return times
    .map((t) => {
      const [h, m = "0"] = t.split(":");
      return { hour: Number(h), minute: Number(m) };
    })
    .filter((t) => !Number.isNaN(t.hour) && !Number.isNaN(t.minute));
}

/** Current clock in configured timezone (default EAT / Africa/Nairobi). */
function clockInTimezone(tz) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value || "0";
  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

/** 3× daily at Kenyan peak hours (8:00, 13:00, 19:30 EAT by default). */
function startTiktokScheduler() {
  if (!config.tiktok.cronEnabled) return;
  const slots = parsePostTimes(config.tiktok.postTimes);
  const tz = config.tiktok.timezone;
  let lastRunKey = "";

  setInterval(() => {
    const now = clockInTimezone(tz);
    const match = slots.find((s) => s.hour === now.hour && s.minute === now.minute);
    if (!match) return;
    const runKey = `${now.dateKey}-${match.hour}:${String(match.minute).padStart(2, "0")}`;
    if (runKey === lastRunKey) return;
    lastRunKey = runKey;
    runTiktokPostJob().catch((err) => console.error("[tiktok:cron]", err.message));
  }, 60_000);

  const label = slots.map((s) => `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`).join(", ");
  console.log(`✓ TikTok cron enabled (${tz}): ${label}`);
}
