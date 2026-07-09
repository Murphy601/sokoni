import express from "express";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { handleWahaWebhook } from "./handlers/webhookHandler.js";
import { runTiktokPostJob } from "./services/tiktok.js";
import { startTokenRefreshScheduler, getConnectionStatus } from "./services/tiktok-auth.js";
import tiktokOAuthRouter from "./routes/tiktokOAuth.js";
import suppliersApiRouter from "./routes/suppliersApi.js";
import adminSuppliersRouter from "./routes/adminSuppliers.js";
import pickupPointsApiRouter from "./routes/pickupPointsApi.js";
import adminPickupPointsRouter from "./routes/adminPickupPoints.js";
import { listReviews, addReview } from "./services/reviews.js";

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
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && SITE_ORIGINS.has(origin.replace(/\/$/, ""))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: `${config.brand.name} WhatsApp bot (WAHA)`,
    session: config.waha.session,
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", build: BUILD_ID });
});

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

app.listen(config.port, () => {
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
});

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
