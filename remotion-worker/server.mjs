/**
 * Sokoni Remotion HTTP worker — POST /render { imageUrls } → { videoUrl }
 * Used as REMOTION_RENDER_URL=http://127.0.0.1:3105/render on the bot VM.
 *
 * Primary: Remotion bundle + renderMedia (Chromium).
 * Soft fallback: Cloudinary zoompan/multi when Remotion OOM/fails (same cream brand).
 * Never throws the bot process — this is a separate PM2 app.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Load ../whatsapp-bot/.env into process.env without adding a dotenv dependency. */
function loadBotEnv() {
  const candidates = [
    process.env.SOKONI_BOT_ENV,
    path.join(__dirname, "..", "whatsapp-bot", ".env"),
    path.join(process.env.HOME || "", "sokoni", "whatsapp-bot", ".env"),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const line of text.split("\n")) {
        const raw = line.trim();
        if (!raw || raw.startsWith("#")) continue;
        const cleaned = raw.replace(/^export\s+/, "");
        const eq = cleaned.indexOf("=");
        if (eq <= 0) continue;
        const key = cleaned.slice(0, eq).trim();
        let val = cleaned.slice(eq + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = val;
      }
      console.log("[remotion-worker] loaded env from", file);
      break;
    } catch {
      /* keep looking */
    }
  }
}
loadBotEnv();

const PORT = Number(process.env.REMOTION_WORKER_PORT || 3105);
const HOST = process.env.REMOTION_WORKER_HOST || "127.0.0.1";
const OUT_DIR = process.env.REMOTION_OUT_DIR || path.join("/tmp", "sokoni-remotion");
const ENTRY = path.join(__dirname, "src", "index.ts");
const CREAM = "#FFF8F0";

function env(name) {
  return String(process.env[name] || "").trim();
}

function normalizeUrls(list) {
  return (Array.isArray(list) ? list : [])
    .map((u) => String(u || "").trim().split("?")[0])
    .filter((u) => /^https?:\/\//i.test(u))
    .slice(0, 8);
}

let bundleLocation = null;
let bundling = null;
let renderLock = Promise.resolve();

async function ensureBundle() {
  if (bundleLocation) return bundleLocation;
  if (bundling) return bundling;
  bundling = bundle({
    entryPoint: ENTRY,
    webpackOverride: (config) => config,
  })
    .then((loc) => {
      bundleLocation = loc;
      bundling = null;
      console.log("[remotion-worker] bundle ready:", loc);
      return loc;
    })
    .catch((err) => {
      bundling = null;
      throw err;
    });
  return bundling;
}

function cloudinarySign(params, apiSecret) {
  const toSign = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return crypto.createHash("sha1").update(toSign + apiSecret).digest("hex");
}

function isCloudinaryConfigured() {
  return Boolean(env("CLOUDINARY_CLOUD_NAME") && env("CLOUDINARY_API_KEY") && env("CLOUDINARY_API_SECRET"));
}

/** Soft Cloudinary clip when Remotion Chromium cannot run on the 1GB VM. */
async function cloudinaryLightClip(imageUrls) {
  if (!isCloudinaryConfigured()) return null;
  const cloud = env("CLOUDINARY_CLOUD_NAME");
  const creamHex = "FFF8F0";
  if (imageUrls.length === 1) {
    const raw = imageUrls[0];
    const m = raw.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.(jpe?g|png|webp|gif))?$/i);
    const publicId = m ? decodeURIComponent(m[1].replace(/\.(jpe?g|png|webp|gif)$/i, "")) : null;
    if (!publicId) return null;
    const motion = `c_pad,w_1080,h_1080,b_rgb:${creamHex}/e_shadow:45/e_zoompan:du_4;fps_30;mode_ofl;maxzoom_1.4/w_720,q_auto:eco,vc_h264`;
    return `https://res.cloudinary.com/${cloud}/image/upload/${motion}/f_mp4/${publicId}.mp4`;
  }

  const apiKey = env("CLOUDINARY_API_KEY");
  const apiSecret = env("CLOUDINARY_API_SECRET");
  const timestamp = Math.floor(Date.now() / 1000);
  const transformation = `dl_2000/w_720,h_720,c_pad,b_rgb:${creamHex}/q_auto:eco,vc_h264`;
  const signParams = { format: "mp4", timestamp, transformation };
  const signature = cloudinarySign(signParams, apiSecret);
  const form = new FormData();
  form.append("api_key", apiKey);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);
  form.append("format", "mp4");
  form.append("transformation", transformation);
  imageUrls.forEach((u) => form.append("urls[]", u));
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/multi`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn("[remotion-worker] cloudinary multi failed:", res.status, text.slice(0, 160));
    return null;
  }
  const body = await res.json().catch(() => ({}));
  return body.secure_url || body.url || null;
}

async function uploadLocalMp4ToCloudinary(filePath) {
  if (!isCloudinaryConfigured()) return null;
  const cloud = env("CLOUDINARY_CLOUD_NAME");
  const apiKey = env("CLOUDINARY_API_KEY");
  const apiSecret = env("CLOUDINARY_API_SECRET");
  const folder = env("CLOUDINARY_FOLDER") || "sokoni-studio";
  const publicId = `remotion_${Math.floor(Date.now() / 1000)}_${crypto.randomBytes(3).toString("hex")}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = cloudinarySign({ folder, public_id: publicId, timestamp }, apiSecret);
  const buf = await fsPromises.readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "video/mp4" }), "clip.mp4");
  form.append("api_key", apiKey);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);
  form.append("folder", folder);
  form.append("public_id", publicId);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/video/upload`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn("[remotion-worker] cloudinary upload failed:", res.status, text.slice(0, 160));
    return null;
  }
  const body = await res.json().catch(() => ({}));
  return body.secure_url || body.url || null;
}

async function renderWithRemotion(imageUrls, opts = {}) {
  const serveUrl = await ensureBundle();
  const inputProps = {
    imageUrls,
    creamBg: opts.creamBg || CREAM,
    secondsPerSlide: Number(opts.secondsPerSlide) || 2,
  };
  const compositionId = opts.composition || env("REMOTION_COMPOSITION") || "SokoniProduct";
  const composition = await selectComposition({
    serveUrl,
    id: compositionId,
    inputProps,
  });

  await fsPromises.mkdir(OUT_DIR, { recursive: true });
  const outName = `clip_${Date.now()}_${crypto.randomBytes(2).toString("hex")}.mp4`;
  const outputLocation = path.join(OUT_DIR, outName);

  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation,
    inputProps,
    concurrency: 1,
    chromiumOptions: {
      disableWebSecurity: false,
    },
    timeoutInMilliseconds: Number(env("REMOTION_TIMEOUT_MS")) || 120_000,
  });

  const hosted = await uploadLocalMp4ToCloudinary(outputLocation);
  if (hosted) {
    await fsPromises.unlink(outputLocation).catch(() => {});
    return hosted;
  }
  return `http://${HOST}:${PORT}/files/${outName}`;
}

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/files", express.static(OUT_DIR, { maxAge: "1h", fallthrough: false }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "sokoni-remotion-worker",
    bundleReady: Boolean(bundleLocation),
    cloudinary: isCloudinaryConfigured(),
  });
});

app.post("/render", async (req, res) => {
  const imageUrls = normalizeUrls(req.body?.imageUrls || req.body?.images || []);
  if (!imageUrls.length) {
    res.status(400).json({ error: "imageUrls required" });
    return;
  }

  const key = env("REMOTION_RENDER_KEY");
  if (key) {
    const auth = String(req.headers.authorization || "");
    if (auth !== `Bearer ${key}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  }

  // Serialize renders — one Chromium at a time on the 1GB VM.
  const run = renderLock.then(async () => {
    const forceLight = env("REMOTION_LIGHT_MODE") === "true" || req.body?.light === true;
    if (!forceLight) {
      try {
        const videoUrl = await renderWithRemotion(imageUrls, {
          composition: req.body?.composition,
          creamBg: req.body?.creamBg,
          secondsPerSlide: req.body?.secondsPerSlide,
        });
        return { videoUrl, engine: "remotion" };
      } catch (err) {
        console.warn("[remotion-worker] remotion render failed:", err?.message || err);
      }
    }
    const light = await cloudinaryLightClip(imageUrls);
    if (light) return { videoUrl: light, engine: "cloudinary-light" };
    throw new Error("remotion_and_light_failed");
  });
  renderLock = run.catch(() => {});

  try {
    const out = await run;
    res.json(out);
  } catch (err) {
    console.warn("[remotion-worker] /render failed:", err?.message || err);
    res.status(503).json({ error: "render_failed", message: String(err?.message || err) });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`[remotion-worker] listening on http://${HOST}:${PORT}`);
  // Warm bundle in background (fail soft).
  ensureBundle().catch((err) => {
    console.warn("[remotion-worker] bundle warm failed (will retry on first render):", err?.message || err);
  });
});
