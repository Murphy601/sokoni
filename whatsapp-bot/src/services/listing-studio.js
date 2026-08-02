/**
 * AI Photo Studio — cloud background removal (+ optional product reel).
 * Providers (zero disk/RAM on the bot VM):
 *   - cloudinary  — clean PNG via e_background_removal
 *   - huggingface — image cleanup only (RMBG / Inference)
 *   - photoroom   — image cleanup only (Segment API)
 *   - remote      — POST→PNG microservice (Modal/Render rembg)
 *
 * Transform once, cache forever (Cloudinary path):
 *   1. Upload cutout_* with eager e_background_removal/f_png + eager_async=false
 *   2. Wait until cleaned PNG has alpha, then DOWNLOAD those PNG bytes
 *   3. Overwrite cutout_* with the clean PNG buffer (base asset is now transparent)
 *   4. Zoompan MP4 on that baked asset (video transforms cannot apply e_background_removal)
 *   5. 2–8 photos → Cloudinary multi from baked clean URLs → one MP4 reel
 *   6. Save those CDN URLs in the catalog
 *
 * Why bake bytes? (a) URL→upload fetch often re-pulls the original photo.
 * (b) Cloudinary ignores e_background_removal inside MP4 transformation chains.
 *
 * Studio API returns CDN URLs only (cleanImageUrl + clipVideoUrl) so the 1GB
 * bot does not JSON-encode multi‑MB PNG/MP4 (that was taking Sokoni down).
 * Set STUDIO_INLINE_IMAGES / STUDIO_CLIP_INLINE only for tests.
 *
 * STUDIO_PROVIDER=auto (default) tries configured providers free-first:
 *   cloudinary → huggingface → photoroom → remote
 * Failures always keep the original image. Bot boot never depends on studio.
 */
import crypto from "node:crypto";
import { generateListingFromImage } from "./listing-generator.js";

const PHOTOROOM_SEGMENT = "https://sdk.photoroom.com/v1/segment";

const ALL_PROVIDERS = ["cloudinary", "huggingface", "photoroom", "remote"];

/** Photoroom-like clip from a transparent cutout — no background_removal here. */
/** 3–5s teaser for grid hover — longer makes a still look stretched. */
const DEFAULT_CLIP_TRANS =
  "c_pad,w_1080,h_1080,b_rgb:FFF8F0/e_shadow:45/e_zoompan:du_4;fps_30;mode_ofl;maxzoom_1.4/w_720,q_auto:eco,vc_h264";

function env(name) {
  return String(process.env[name] || "").trim();
}

export function isCloudinaryConfigured() {
  return Boolean(env("CLOUDINARY_CLOUD_NAME") && env("CLOUDINARY_API_KEY") && env("CLOUDINARY_API_SECRET"));
}

function isHuggingFaceConfigured() {
  return Boolean(env("HUGGINGFACE_API_KEY") || env("HF_TOKEN") || env("HUGGINGFACE_RMBG_URL"));
}

function isPhotoroomConfigured() {
  return Boolean(env("PHOTOROOM_API_KEY"));
}

function isRemoteConfigured() {
  return Boolean(env("STUDIO_REMOTE_URL"));
}

const PROVIDER_READY = {
  cloudinary: isCloudinaryConfigured,
  huggingface: isHuggingFaceConfigured,
  photoroom: isPhotoroomConfigured,
  remote: isRemoteConfigured,
};

/** @returns {string[]} configured provider ids */
export function listConfiguredProviders() {
  return ALL_PROVIDERS.filter((id) => PROVIDER_READY[id]());
}

/** @returns {boolean} */
export function isStudioConfigured() {
  const pinned = env("STUDIO_PROVIDER").toLowerCase();
  if (pinned === "off" || pinned === "none") return false;
  if (pinned && ALL_PROVIDERS.includes(pinned)) return PROVIDER_READY[pinned]();
  return listConfiguredProviders().length > 0;
}

/**
 * Resolve try-order for this request.
 * @returns {string[]}
 */
export function resolveProviderOrder() {
  const pinned = env("STUDIO_PROVIDER").toLowerCase() || "auto";
  if (pinned === "off" || pinned === "none") return [];

  const fallback = env("STUDIO_FALLBACK").toLowerCase();
  const configured = listConfiguredProviders();

  if (pinned !== "auto" && ALL_PROVIDERS.includes(pinned)) {
    const order = [pinned];
    if (fallback && fallback !== pinned && ALL_PROVIDERS.includes(fallback) && PROVIDER_READY[fallback]()) {
      order.push(fallback);
    } else {
      for (const id of configured) {
        if (id !== pinned) order.push(id);
      }
    }
    return order.filter((id) => PROVIDER_READY[id]());
  }

  // auto — free-first defaults
  return configured;
}

/** Short Ken Burns clips — Cloudinary zoompan on the cleaned cutout. */
export function isStudioClipEnabled() {
  if (env("STUDIO_CLIP_ENABLED") === "false") return false;
  return isCloudinaryConfigured();
}

export function getStudioMeta() {
  const providers = listConfiguredProviders();
  const order = resolveProviderOrder();
  return {
    studioEnabled: isStudioConfigured(),
    studioProvider: order[0] || "none",
    studioProviders: providers,
    studioProviderOrder: order,
    studioClipEnabled: isStudioClipEnabled(),
  };
}

function okResult(buffer, provider, extras = {}) {
  const hasClip = Boolean(extras.clipBuffer?.length || extras.clipUrl);
  return {
    buffer: buffer || null,
    mimeType: "image/png",
    studioApplied: true,
    provider,
    /** CDN URL of the cleaned cutout — preferred over embedding base64 (1GB VM). */
    cleanUrl: extras.cleanUrl || null,
    /** Durable Cloudinary public_id for the cutout (for multi-reel tagging). */
    cleanPublicId: extras.cleanPublicId || null,
    clipBuffer: extras.clipBuffer || null,
    clipUrl: extras.clipUrl || null,
    clipMimeType: hasClip ? extras.clipMimeType || "video/mp4" : null,
  };
}

function failResult(buffer, mimeType, reason, provider = null) {
  return {
    buffer,
    mimeType,
    studioApplied: false,
    reason,
    provider,
    cleanUrl: null,
    cleanPublicId: null,
    clipBuffer: null,
    clipUrl: null,
    clipMimeType: null,
  };
}

/** Cloudinary signed upload signature (sha1). */
function cloudinarySign(params, apiSecret) {
  const toSign = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return crypto.createHash("sha1").update(toSign + apiSecret).digest("hex");
}

/** Sleep helper for Cloudinary 423 (derived still generating). */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Motion/pad/shadow segment only (no bg removal).
 * Strips legacy e_background_removal from CLOUDINARY_CLIP_TRANS.
 */
export function resolveClipTransform() {
  let t =
    env("CLOUDINARY_CLIP_TRANS") ||
    DEFAULT_CLIP_TRANS;
  t = t
    .replace(/(^|\/)e_background_removal(\/|$)/gi, "$1")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/|\/$/g, "");
  if (!t) t = DEFAULT_CLIP_TRANS;
  return t;
}

/**
 * Full Cloudinary clip chain from an *original* upload:
 * background removal first, then pad/shadow/zoompan — never zoompan the raw photo.
 */
export function resolveClipTransformFromOriginal() {
  const bgEffect = env("CLOUDINARY_BG_EFFECT") || "e_background_removal";
  const motion = resolveClipTransform();
  return `${bgEffect}/${motion}`;
}

function isPngBuffer(buf) {
  return Boolean(
    buf &&
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47
  );
}

/** True when PNG IHDR color type includes alpha (4=gray+A, 6=RGBA) or tRNS chunk. */
export function pngHasAlpha(buf) {
  if (!isPngBuffer(buf) || buf.length < 26) return false;
  const colorType = buf[25];
  if (colorType === 4 || colorType === 6) return true;
  const head = buf.subarray(0, Math.min(buf.length, 512));
  for (let i = 8; i < head.length - 4; i += 1) {
    if (
      head[i] === 0x74 &&
      head[i + 1] === 0x52 &&
      head[i + 2] === 0x4e &&
      head[i + 3] === 0x53
    ) {
      return true; // tRNS
    }
  }
  return false;
}

function bgRemovalEffect() {
  return env("CLOUDINARY_BG_EFFECT") || "e_background_removal";
}

/** Warmed clean-PNG delivery URL for a stored public_id (AI runs once, then CDN-cached). */
function cleanedPngUrl(cloud, publicId) {
  return `https://res.cloudinary.com/${cloud}/image/upload/${bgRemovalEffect()}/f_png/${publicId}`;
}

/** Clip URL for an already-baked clean PNG asset (no bg-removal in the video chain). */
function bakedClipUrl(cloud, publicId) {
  const motion = resolveClipTransform();
  return `https://res.cloudinary.com/${cloud}/image/upload/${motion}/f_mp4/${publicId}.mp4`;
}

/** FormData-safe binary part (Node Buffer → Blob). */
function binaryBlob(buffer, mimeType, filename) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return new Blob([bytes], { type: mimeType || "application/octet-stream" });
}

/**
 * Fetch a Cloudinary derived URL. Retries 420/423 while BG removal / zoompan builds.
 * @param {string} url
 * @param {{ timeoutMs?: number, attempts?: number, label?: string }} [opts]
 */
async function fetchCloudinaryDerived(url, opts = {}) {
  const timeoutMs = opts.timeoutMs || 90_000;
  const attempts =
    opts.attempts ||
    Number(env("CLOUDINARY_DERIVED_ATTEMPTS")) ||
    8;
  const label = opts.label || "derived";
  let lastStatus = 0;
  let lastText = "";

  for (let i = 0; i < attempts; i += 1) {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    lastStatus = res.status;
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length) return buf;
      lastText = "empty body";
    } else {
      lastText = await res.text().catch(() => "");
      // 423 = still generating derived; 420 = pending incoming transform.
      if (res.status !== 420 && res.status !== 423) {
        console.warn(
          `[listing-studio] Cloudinary ${label} failed:`,
          res.status,
          lastText.slice(0, 200)
        );
        return null;
      }
      console.warn(
        `[listing-studio] Cloudinary ${label} pending (${res.status}) — retry ${i + 1}/${attempts}`
      );
    }
    await sleep(1500 + i * 500);
  }

  console.warn(
    `[listing-studio] Cloudinary ${label} gave up:`,
    lastStatus,
    lastText.slice(0, 200)
  );
  return null;
}

/**
 * Wait until a derived URL is ready without keeping the body in RAM (1GB VM safe).
 */
async function waitCloudinaryDerivedReady(url, opts = {}) {
  const timeoutMs = opts.timeoutMs || 120_000;
  const attempts =
    opts.attempts ||
    Number(env("CLOUDINARY_DERIVED_ATTEMPTS")) ||
    8;
  const label = opts.label || "derived";

  for (let i = 0; i < attempts; i += 1) {
    try {
      const head = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(Math.min(timeoutMs, 30_000)),
      });
      if (head.ok) return true;
      if (head.status !== 420 && head.status !== 423 && head.status !== 405) {
        // Fall through to GET for CDNs that dislike HEAD
      } else if (head.status === 420 || head.status === 423) {
        console.warn(
          `[listing-studio] Cloudinary ${label} pending (${head.status}) — retry ${i + 1}/${attempts}`
        );
        await sleep(1500 + i * 500);
        continue;
      }
    } catch {
      // HEAD unsupported / network — try GET
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) {
      try {
        await res.body?.cancel?.();
      } catch {
        /* ignore */
      }
      return true;
    }
    if (res.status !== 420 && res.status !== 423) {
      const lastText = await res.text().catch(() => "");
      console.warn(
        `[listing-studio] Cloudinary ${label} failed:`,
        res.status,
        lastText.slice(0, 200)
      );
      return false;
    }
    console.warn(
      `[listing-studio] Cloudinary ${label} pending (${res.status}) — retry ${i + 1}/${attempts}`
    );
    await sleep(1500 + i * 500);
  }
  return false;
}

/**
 * Schedule destroy for *temporary* uploads only (raw listing_* before cutout is stored).
 * Durable cutout_* / reel_* assets are never auto-deleted — their CDN URLs live in the catalog.
 */
function scheduleCloudinaryDestroy(publicId, cloud, apiKey, apiSecret) {
  if (env("CLOUDINARY_DELETE_AFTER") === "false") return;
  const id = String(publicId || "");
  // Never wipe product assets that buyers hit via saved CDN URLs.
  if (/\/(cutout_|reel_)/i.test(`/${id}`) || /^(cutout_|reel_)/i.test(id.split("/").pop() || "")) {
    return;
  }
  const ms = Number(env("CLOUDINARY_DELETE_MS")) || 180_000;
  setTimeout(() => {
    void cloudinaryDestroy(publicId, cloud, apiKey, apiSecret).catch((err) =>
      console.warn("[listing-studio] Cloudinary destroy:", err.message)
    );
  }, ms);
}

/**
 * Wait until AI background removal produced a real transparent PNG.
 * HEAD 200 is not enough — Cloudinary can serve the original while AI is pending.
 * Reads only the first bytes (Range) so the 1GB bot never holds the full image.
 */
async function waitCloudinaryCleanPng(url, opts = {}) {
  const timeoutMs = opts.timeoutMs || 120_000;
  const attempts =
    opts.attempts ||
    Number(env("CLOUDINARY_DERIVED_ATTEMPTS")) ||
    12;
  const label = opts.label || "bg-removal-alpha";

  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, {
        headers: { Range: "bytes=0-64" },
        signal: AbortSignal.timeout(Math.min(timeoutMs, 45_000)),
      });
      if (res.status === 420 || res.status === 423) {
        console.warn(
          `[listing-studio] Cloudinary ${label} pending (${res.status}) — retry ${i + 1}/${attempts}`
        );
        await sleep(2000 + i * 750);
        continue;
      }
      if (!res.ok && res.status !== 206) {
        console.warn(`[listing-studio] Cloudinary ${label} failed:`, res.status);
        await sleep(1500 + i * 500);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      try {
        await res.body?.cancel?.();
      } catch {
        /* ignore */
      }
      if (pngHasAlpha(buf)) return true;
      console.warn(
        `[listing-studio] Cloudinary ${label} PNG has no alpha yet — retry ${i + 1}/${attempts}`
      );
    } catch (err) {
      console.warn(`[listing-studio] Cloudinary ${label} error:`, err.message);
    }
    await sleep(2000 + i * 750);
  }
  return false;
}

/**
 * Signed image upload with optional eager transforms.
 * When `eager` is set, always sends eager_async=false so AI bg-removal finishes
 * before the upload response completes (avoids zoompan racing the raw original).
 * `file` may be a Buffer or a remote HTTPS URL (Cloudinary fetches it — no bot RAM).
 * @returns {Promise<{ ok: true, publicId: string, uploaded: object, cloud: string, apiKey: string, apiSecret: string } | { ok: false, authFailed?: boolean, status: number, errText: string }>}
 */
async function cloudinaryUploadImage(file, mimeType, { publicId, folder, eager, filename, tags, overwrite }) {
  const cloud = env("CLOUDINARY_CLOUD_NAME");
  const apiKey = env("CLOUDINARY_API_KEY");
  const apiSecret = env("CLOUDINARY_API_SECRET");
  const timestamp = Math.floor(Date.now() / 1000);
  const signParams = { folder, public_id: publicId, timestamp };
  if (eager) {
    signParams.eager = eager;
    // Explicit sync eager — default is false, but sign+send so AI clean completes first.
    signParams.eager_async = "false";
  }
  if (tags) signParams.tags = tags;
  if (overwrite) signParams.overwrite = "true";
  const signature = cloudinarySign(signParams, apiSecret);

  const form = new FormData();
  if (typeof file === "string" && /^https?:\/\//i.test(file)) {
    form.append("file", file);
  } else {
    form.append(
      "file",
      binaryBlob(file, mimeType || "image/jpeg", filename || "listing.jpg"),
      filename || "listing.jpg"
    );
  }
  form.append("api_key", apiKey);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);
  form.append("folder", folder);
  form.append("public_id", publicId);
  if (eager) {
    form.append("eager", eager);
    form.append("eager_async", "false");
  }
  if (tags) form.append("tags", tags);
  if (overwrite) form.append("overwrite", "true");

  const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(180_000),
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => "");
    console.warn("[listing-studio] Cloudinary upload failed:", uploadRes.status, errText.slice(0, 200));
    const authFailed =
      uploadRes.status === 401 ||
      /api_secret mismatch|invalid signature|unauthorized/i.test(errText);
    return { ok: false, authFailed, status: uploadRes.status, errText };
  }

  const uploaded = await uploadRes.json().catch(() => ({}));
  return {
    ok: true,
    publicId: uploaded.public_id || `${folder}/${publicId}`,
    uploaded,
    cloud,
    apiKey,
    apiSecret,
  };
}

/** Extract Cloudinary public_id from a delivery URL (strips transforms + version). */
export function cloudinaryPublicIdFromUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;
  const m = raw.match(/res\.cloudinary\.com\/[^/]+\/(?:image|video)\/upload\/(.+)$/i);
  if (!m) return null;
  const parts = m[1].replace(/^\/+/, "").split("/");
  // Drop transformation segments and version (v123…) until the public_id path remains.
  while (parts.length > 1) {
    const head = parts[0];
    if (
      /^v\d+$/i.test(head) ||
      /[,=]/.test(head) ||
      /^(c_|w_|h_|e_|b_|g_|q_|f_|fl_|dpr_|ar_|a_|r_|l_|u_|t_|dl_)/i.test(head)
    ) {
      parts.shift();
      continue;
    }
    break;
  }
  // Leading version with no transforms: v123/folder/id
  if (parts.length && /^v\d+$/i.test(parts[0])) parts.shift();
  const id = parts.join("/").replace(/\.[a-z0-9]+$/i, "");
  return id || null;
}

function isCloudinaryDeliveryUrl(url) {
  try {
    const u = new URL(String(url));
    return u.hostname === "res.cloudinary.com" || u.hostname.endsWith(".cloudinary.com");
  } catch {
    return false;
  }
}

/**
 * Store an already-cleaned PNG *buffer* (Photoroom/HF/remote) on Cloudinary and
 * optionally zoompan it. Do not pass Cloudinary transformed URLs here — fetch
 * often re-pulls the original photo.
 * @param {Buffer} cleanPng
 * @param {{ wantClip?: boolean, publicId?: string, tags?: string }} [opts]
 */
async function storeCleanPngBufferAndClip(cleanPng, opts = {}) {
  if (!isCloudinaryConfigured()) return null;
  if (!isPngBuffer(cleanPng)) {
    console.warn("[listing-studio] refusing cutout store — not a cleaned PNG");
    return null;
  }
  const cloud = env("CLOUDINARY_CLOUD_NAME");
  const folder = env("CLOUDINARY_FOLDER") || "sokoni-studio";
  const stamp = Math.floor(Date.now() / 1000);
  const publicId =
    opts.publicId || `cutout_${stamp}_${crypto.randomBytes(4).toString("hex")}`;
  const wantClip =
    opts.wantClip !== undefined ? opts.wantClip : env("STUDIO_CLIP_ENABLED") !== "false";
  const clipTrans = resolveClipTransform();
  // Buffer is already cleaned — zoompan only (no second bg-removal).
  const eager = wantClip ? `${clipTrans}/f_mp4` : undefined;

  const up = await cloudinaryUploadImage(cleanPng, "image/png", {
    publicId,
    folder,
    eager,
    filename: "clean.png",
    tags: opts.tags,
  });
  if (!up.ok) return null;

  const id = up.publicId;
  const cleanUrl =
    up.uploaded.secure_url ||
    up.uploaded.url ||
    `https://res.cloudinary.com/${cloud}/image/upload/${id}`;

  if (!wantClip) {
    return { cleanUrl, cleanPublicId: id, clipUrl: null, clipBuffer: null };
  }

  const clipUrl =
    up.uploaded.eager?.[0]?.secure_url ||
    up.uploaded.eager?.[0]?.url ||
    `https://res.cloudinary.com/${cloud}/image/upload/${clipTrans}/f_mp4/${id}.mp4`;

  const clip = await finalizeClipUrl(clipUrl);
  if (!clip) return { cleanUrl, cleanPublicId: id, clipUrl: null, clipBuffer: null };
  return {
    cleanUrl,
    cleanPublicId: id,
    clipUrl: clip.clipUrl,
    clipBuffer: clip.clipBuffer,
  };
}

/** @deprecated alias — buffer-only */
async function storeCutoutAndRenderClip(cleanSource, opts = {}) {
  if (typeof cleanSource === "string") {
    console.warn(
      "[listing-studio] refusing URL cutout re-upload (Cloudinary fetch returns originals) — use removeBackgroundCloudinary"
    );
    return null;
  }
  return storeCleanPngBufferAndClip(cleanSource, opts);
}

/**
 * Wait for a clip derived URL; optionally download bytes when STUDIO_CLIP_INLINE=true.
 * @returns {Promise<{ clipUrl: string, clipBuffer: Buffer|null }|null>}
 */
async function finalizeClipUrl(clipUrl) {
  if (!clipUrl) return null;
  const derivedAttempts = Number(env("CLOUDINARY_DERIVED_ATTEMPTS")) || 10;
  const inline = env("STUDIO_CLIP_INLINE") === "true";
  const attempts = Math.max(4, Math.min(derivedAttempts, 8));

  if (inline) {
    const clipBuffer = await fetchCloudinaryDerived(clipUrl, {
      label: "clip",
      timeoutMs: 120_000,
      attempts,
    });
    if (!clipBuffer || clipBuffer.length <= 256) {
      console.warn("[listing-studio] Cloudinary clip too small / missing — skipping");
      return null;
    }
    return { clipUrl, clipBuffer };
  }

  const ready = await waitCloudinaryDerivedReady(clipUrl, {
    label: "clip",
    timeoutMs: 120_000,
    attempts,
  });
  if (!ready) {
    console.warn("[listing-studio] Cloudinary clip not ready — skipping");
    return null;
  }
  return { clipUrl, clipBuffer: null };
}

/**
 * After image-only cleanup (Photoroom/HF/remote), store cutout on Cloudinary and clip it.
 */
async function maybeAttachProductClip(result) {
  if (!result?.studioApplied) return result;
  if (result.clipUrl || result.cleanUrl) return result;
  if (!isCloudinaryConfigured()) return result;
  try {
    // Only real PNG bytes from Photoroom/HF/remote — never a Cloudinary transform URL.
    if (!result.buffer || !isPngBuffer(result.buffer)) return result;
    const stored = await storeCleanPngBufferAndClip(result.buffer);
    if (!stored?.cleanUrl) return result;
    return okResult(result.buffer, result.provider, {
      cleanUrl: stored.cleanUrl,
      cleanPublicId: stored.cleanPublicId || null,
      clipUrl: stored.clipUrl || null,
      clipBuffer: stored.clipBuffer || null,
      clipMimeType: "video/mp4",
    });
  } catch (err) {
    console.warn("[listing-studio] clip from clean failed:", err.message);
    return result;
  }
}

/**
 * Upload → AI clean derived → download PNG bytes → overwrite asset with clean PNG → zoompan.
 * Video transforms cannot apply e_background_removal, so the base asset must already be clean.
 *
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {{ wantClip?: boolean, cutoutPublicId?: string, tags?: string }} [opts]
 */
async function removeBackgroundCloudinary(buffer, mimeType, opts = {}) {
  const cloud = env("CLOUDINARY_CLOUD_NAME");
  const folder = env("CLOUDINARY_FOLDER") || "sokoni-studio";
  const stamp = Math.floor(Date.now() / 1000);
  const publicId =
    opts.cutoutPublicId || `cutout_${stamp}_${crypto.randomBytes(4).toString("hex")}`;
  const eagerClean = `${bgRemovalEffect()}/f_png`;

  const up = await cloudinaryUploadImage(buffer, mimeType, {
    publicId,
    folder,
    eager: eagerClean,
    filename: "listing.jpg",
    tags: opts.tags,
  });
  if (!up.ok) {
    if (up.authFailed) return failResult(buffer, mimeType, "auth_failed", "cloudinary");
    return failResult(buffer, mimeType, "api_failed", "cloudinary");
  }

  const id = up.publicId;
  const eagerUrl = up.uploaded.eager?.[0]?.secure_url || up.uploaded.eager?.[0]?.url || "";
  // Only trust eager URL if it is the bg-removal PNG (not a later zoompan eager).
  const derivedUrl =
    /e_background_removal/i.test(eagerUrl) && /(f_png|\.png)/i.test(eagerUrl)
      ? eagerUrl
      : cleanedPngUrl(cloud, id);

  const derivedAttempts = Number(env("CLOUDINARY_DERIVED_ATTEMPTS")) || 14;
  const cleanReady = await waitCloudinaryCleanPng(derivedUrl, {
    label: "bg-removal",
    timeoutMs: 150_000,
    attempts: derivedAttempts,
  });
  if (!cleanReady) {
    console.warn("[listing-studio] Cloudinary bg-removal never produced alpha PNG");
    return failResult(buffer, mimeType, "api_failed", "cloudinary");
  }

  // Pull the verified clean PNG and overwrite cutout_* so the base asset is transparent.
  let cleanBuf = await fetchCloudinaryDerived(derivedUrl, {
    label: "bg-removal-download",
    timeoutMs: 120_000,
    attempts: Math.min(6, derivedAttempts),
  });
  if (!cleanBuf?.length || !pngHasAlpha(cleanBuf)) {
    console.warn("[listing-studio] clean PNG download failed or has no alpha");
    return failResult(buffer, mimeType, "api_failed", "cloudinary");
  }
  if (cleanBuf.length > 12 * 1024 * 1024) {
    console.warn("[listing-studio] clean PNG too large to bake on 1GB VM:", cleanBuf.length);
    return failResult(buffer, mimeType, "api_failed", "cloudinary");
  }

  const wantClip =
    opts.wantClip !== undefined ? opts.wantClip : env("STUDIO_CLIP_ENABLED") !== "false";
  const clipTrans = resolveClipTransform();
  const baked = await cloudinaryUploadImage(cleanBuf, "image/png", {
    publicId,
    folder,
    overwrite: true,
    eager: wantClip ? `${clipTrans}/f_mp4` : undefined,
    filename: "clean.png",
    tags: opts.tags,
  });
  cleanBuf = null;

  if (!baked.ok) {
    console.warn("[listing-studio] bake clean PNG overwrite failed — using derived URL only");
    return okResult(null, "cloudinary", {
      cleanUrl: derivedUrl,
      cleanPublicId: id,
    });
  }

  const cleanUrl =
    baked.uploaded.secure_url ||
    baked.uploaded.url ||
    `https://res.cloudinary.com/${cloud}/image/upload/${id}`;

  if (!wantClip) {
    return okResult(null, "cloudinary", { cleanUrl, cleanPublicId: id });
  }

  // Zoompan on baked clean asset — do NOT put e_background_removal in the MP4 chain.
  const clipUrl =
    baked.uploaded.eager?.[0]?.secure_url ||
    baked.uploaded.eager?.[0]?.url ||
    bakedClipUrl(cloud, id);
  if (/e_background_removal/i.test(String(clipUrl))) {
    console.warn("[listing-studio] refusing video URL that still uses bg-removal transform");
    return okResult(null, "cloudinary", { cleanUrl, cleanPublicId: id });
  }

  const clip = await finalizeClipUrl(clipUrl);
  return okResult(null, "cloudinary", {
    cleanUrl,
    cleanPublicId: id,
    clipUrl: clip?.clipUrl || null,
    clipBuffer: clip?.clipBuffer || null,
    clipMimeType: "video/mp4",
  });
}

async function cloudinaryDestroy(publicId, cloud, apiKey, apiSecret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = cloudinarySign({ public_id: publicId, timestamp }, apiSecret);
  const form = new FormData();
  form.append("public_id", publicId);
  form.append("timestamp", String(timestamp));
  form.append("api_key", apiKey);
  form.append("signature", signature);
  await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/destroy`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
}

/** Default multi-reel: 2s per slide, padded square, light encode for Kenya mobile. */
function resolveReelTransform() {
  const delayMs = Number(env("CLOUDINARY_REEL_DELAY_MS")) || 2000;
  const custom = env("CLOUDINARY_REEL_TRANS");
  if (custom) return custom.includes("dl_") ? custom : `dl_${delayMs}/${custom}`;
  return `dl_${delayMs}/w_720,h_720,c_pad,b_rgb:FFF8F0/q_auto:eco,vc_h264`;
}

/**
 * Cloudinary Multi API — one MP4 from ordered cleaned image URLs (already bg-removed).
 * Prefer `urls` over tags so slide order matches the seller’s upload order.
 * @param {string[]} urls
 * @param {{ format?: string, transformation?: string }} [opts]
 */
async function cloudinaryMultiByUrls(urls, opts = {}) {
  const cloud = env("CLOUDINARY_CLOUD_NAME");
  const apiKey = env("CLOUDINARY_API_KEY");
  const apiSecret = env("CLOUDINARY_API_SECRET");
  const format = opts.format || "mp4";
  const transformation = opts.transformation || resolveReelTransform();
  const list = (urls || []).filter((u) => /^https?:\/\//i.test(String(u)));
  if (list.length < 2) return null;

  const timestamp = Math.floor(Date.now() / 1000);
  // Cloudinary signs multi urls as a pipe-separated list.
  const urlsParam = list.join("|");
  const signParams = { urls: urlsParam, timestamp, format, transformation };
  const signature = cloudinarySign(signParams, apiSecret);

  const form = new FormData();
  form.append("urls", urlsParam);
  form.append("timestamp", String(timestamp));
  form.append("api_key", apiKey);
  form.append("signature", signature);
  form.append("format", format);
  form.append("transformation", transformation);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/multi`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn("[listing-studio] Cloudinary multi failed:", res.status, errText.slice(0, 240));
    return null;
  }
  return res.json().catch(() => null);
}

/**
 * Ensure a baked clean CDN PNG (+ optional clip) for one listing photo.
 * @param {string|Buffer} source — HTTPS URL or image buffer
 * @param {string} [mimeType]
 * @param {{ publicId?: string, tags?: string, wantClip?: boolean }} [opts]
 */
export async function ensureCleanCutout(source, mimeType = "image/jpeg", opts = {}) {
  if (!isCloudinaryConfigured()) return null;
  const cloud = env("CLOUDINARY_CLOUD_NAME");

  if (Buffer.isBuffer(source)) {
    const cleaned = await removeBackgroundCloudinary(source, mimeType, {
      wantClip: opts.wantClip,
      cutoutPublicId: opts.publicId,
      tags: opts.tags,
    });
    if (!cleaned.studioApplied) return null;
    return {
      cleanUrl: cleaned.cleanUrl,
      cleanPublicId: cleaned.cleanPublicId,
      clipUrl: cleaned.clipUrl || null,
      clipBuffer: cleaned.clipBuffer || null,
    };
  }

  if (typeof source === "string" && isCloudinaryDeliveryUrl(source)) {
    const pid = cloudinaryPublicIdFromUrl(source);
    if (!pid) return null;

    // Already a baked clean asset URL (no bg-removal transform) — verify alpha then clip.
    if (!/e_background_removal/i.test(source)) {
      const ready = await waitCloudinaryCleanPng(source.split("?")[0], {
        label: "ensure-baked",
        attempts: 4,
      });
      if (ready) {
        let clipUrl = null;
        let clipBuffer = null;
        if (opts.wantClip) {
          const clip = await finalizeClipUrl(bakedClipUrl(cloud, pid));
          clipUrl = clip?.clipUrl || null;
          clipBuffer = clip?.clipBuffer || null;
        }
        return {
          cleanUrl: source.split("?")[0],
          cleanPublicId: pid,
          clipUrl,
          clipBuffer,
        };
      }
    }

    // Derived clean URL or dirty base — download PNG bytes and bake into opts.publicId / new cutout.
    const derived = /e_background_removal/i.test(source)
      ? source.split("?")[0]
      : cleanedPngUrl(cloud, pid);
    const alphaOk = await waitCloudinaryCleanPng(derived, {
      label: "ensure-clean",
      attempts: Number(env("CLOUDINARY_DERIVED_ATTEMPTS")) || 12,
    });
    if (!alphaOk) return null;
    let cleanBuf = await fetchCloudinaryDerived(derived, {
      label: "ensure-download",
      timeoutMs: 120_000,
      attempts: 5,
    });
    if (!cleanBuf?.length || !pngHasAlpha(cleanBuf)) return null;
    const stored = await storeCleanPngBufferAndClip(cleanBuf, {
      publicId: opts.publicId,
      tags: opts.tags,
      wantClip: opts.wantClip === true,
    });
    cleanBuf = null;
    return stored;
  }

  if (typeof source === "string" && /^https?:\/\//i.test(source)) {
    // Raw remote URL — download bytes here, then full Cloudinary bake pipeline.
    const res = await fetch(source, { signal: AbortSignal.timeout(90_000) });
    if (!res.ok) return null;
    const raw = Buffer.from(await res.arrayBuffer());
    if (!raw.length) return null;
    return ensureCleanCutout(raw, mimeType || res.headers.get("content-type") || "image/jpeg", opts);
  }

  return null;
}

/**
 * Build ONE continuous showcase MP4 from 1–8 cleaned product photos.
 * - 1 photo: zoompan teaser on the cutout (existing clip path)
 * - 2–8 photos: Cloudinary multi slideshow (≈2s per slide)
 *
 * Returns durable CDN URLs to persist in the catalog — never regenerate per page view.
 *
 * @param {Array<string|Buffer|{url?:string,buffer?:Buffer,mimeType?:string}>} sources
 * @param {{ existingClipUrl?: string|null, productKey?: string }} [opts]
 * @returns {Promise<{ imageUrls: string[], videoUrl: string|null, videoKind: "preview"|null }|null>}
 */
export async function prepareListingShowcaseMedia(sources, opts = {}) {
  if (!isCloudinaryConfigured()) return null;
  const list = (Array.isArray(sources) ? sources : []).slice(0, 8);
  if (!list.length) return null;

  const stamp = Math.floor(Date.now() / 1000);
  const cutouts = [];
  const wantClipSingle = list.length === 1 && env("STUDIO_CLIP_ENABLED") !== "false";

  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    let source = item;
    let mime = "image/jpeg";
    if (item && typeof item === "object" && !Buffer.isBuffer(item)) {
      source = item.url || item.buffer || null;
      mime = item.mimeType || mime;
    }
    if (!source) continue;

    const slideId = `reel_${stamp}_${String(i + 1).padStart(2, "0")}`;
    const cut = await ensureCleanCutout(source, mime, {
      publicId: slideId,
      wantClip: wantClipSingle,
    });
    if (cut?.cleanUrl) cutouts.push(cut);
  }

  if (!cutouts.length) return null;

  const imageUrls = cutouts.map((c) => c.cleanUrl);

  // Single photo: reuse existing clip only if it targets a baked asset (no bg-removal in MP4 chain).
  if (cutouts.length === 1) {
    const existing = String(opts.existingClipUrl || "");
    const videoUrl =
      (existing && !/e_background_removal/i.test(existing) ? existing : null) ||
      cutouts[0].clipUrl ||
      null;
    return {
      imageUrls,
      videoUrl,
      videoKind: videoUrl ? "preview" : null,
    };
  }

  // 2–8 photos → one multi MP4 from cleaned derived URLs (order preserved).
  // Do not put e_background_removal in multi transforms (video context ignores it).
  const multi = await cloudinaryMultiByUrls(imageUrls, {
    format: "mp4",
    transformation: resolveReelTransform(),
  });
  let videoUrl = multi?.secure_url || multi?.url || null;

  if (videoUrl) {
    const ready = await waitCloudinaryDerivedReady(videoUrl, {
      label: "showcase-reel",
      timeoutMs: 180_000,
      attempts: Number(env("CLOUDINARY_DERIVED_ATTEMPTS")) || 12,
    });
    if (!ready) {
      console.warn("[listing-studio] showcase reel not ready — falling back to first clip");
      videoUrl = cutouts[0].clipUrl || null;
    }
  } else {
    videoUrl = cutouts[0].clipUrl || null;
  }

  return {
    imageUrls,
    videoUrl,
    videoKind: videoUrl ? "preview" : null,
  };
}

/**
 * Hugging Face Inference / router — or a full custom RMBG URL (Space / dedicated endpoint).
 * Note: many Hub models (incl. briaai/RMBG-1.4) are not on free serverless anymore;
 * set HUGGINGFACE_RMBG_URL to a working Inference Endpoint or Space proxy if needed.
 */
async function removeBackgroundHuggingFace(buffer, mimeType) {
  const token = env("HUGGINGFACE_API_KEY") || env("HF_TOKEN");
  const customUrl = env("HUGGINGFACE_RMBG_URL");
  const model = env("HUGGINGFACE_RMBG_MODEL") || "briaai/RMBG-1.4";
  const url = customUrl || `https://router.huggingface.co/hf-inference/models/${model}`;

  const headers = {
    Accept: "image/png",
    "Content-Type": mimeType || "image/jpeg",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: buffer,
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn("[listing-studio] Hugging Face RMBG failed:", res.status, errText.slice(0, 240));
    // Cold-start / loading
    if (res.status === 503 && /loading/i.test(errText)) {
      return failResult(buffer, mimeType, "api_error", "huggingface");
    }
    return failResult(buffer, mimeType, "api_failed", "huggingface");
  }

  const contentType = String(res.headers.get("content-type") || "");
  const clean = Buffer.from(await res.arrayBuffer());
  if (!clean.length) return failResult(buffer, mimeType, "empty_result", "huggingface");
  // Some endpoints return JSON errors with 200 — reject obvious non-images.
  if (contentType.includes("application/json") || (clean[0] === 0x7b && clean[1] === 0x22)) {
    console.warn("[listing-studio] Hugging Face returned JSON, not PNG:", clean.toString("utf8").slice(0, 200));
    return failResult(buffer, mimeType, "api_failed", "huggingface");
  }
  return okResult(clean, "huggingface");
}

async function removeBackgroundPhotoroom(buffer, mimeType) {
  const apiKey = env("PHOTOROOM_API_KEY");
  const form = new FormData();
  form.append("image_file", new Blob([buffer], { type: mimeType }), "listing.jpg");

  const res = await fetch(PHOTOROOM_SEGMENT, {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: form,
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn("[listing-studio] Photoroom failed:", res.status, errText.slice(0, 200));
    return failResult(buffer, mimeType, "api_failed", "photoroom");
  }

  const clean = Buffer.from(await res.arrayBuffer());
  if (!clean.length) return failResult(buffer, mimeType, "empty_result", "photoroom");
  return okResult(clean, "photoroom");
}

/** Generic remote microservice: POST raw bytes → PNG (Modal/Render rembg, etc.). */
async function removeBackgroundRemote(buffer, mimeType) {
  const url = env("STUDIO_REMOTE_URL");
  const headers = {
    Accept: "image/png",
    "Content-Type": mimeType || "image/jpeg",
  };
  const remoteKey = env("STUDIO_REMOTE_KEY");
  if (remoteKey) headers.Authorization = `Bearer ${remoteKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: buffer,
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn("[listing-studio] remote studio failed:", res.status, errText.slice(0, 200));
    return failResult(buffer, mimeType, "api_failed", "remote");
  }

  const clean = Buffer.from(await res.arrayBuffer());
  if (!clean.length) return failResult(buffer, mimeType, "empty_result", "remote");
  return okResult(clean, "remote");
}

const PROVIDER_FN = {
  cloudinary: removeBackgroundCloudinary,
  huggingface: removeBackgroundHuggingFace,
  photoroom: removeBackgroundPhotoroom,
  remote: removeBackgroundRemote,
};

/**
 * Background removal only (no AI draft). Tries provider chain; keeps original on failure.
 * When clips are enabled, builds the MP4 from the cleaned cutout via Cloudinary.
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {Promise<{ buffer: Buffer, mimeType: string, studioApplied: boolean, reason?: string, provider?: string|null }>}
 */
export async function removeBackground(buffer, mimeType = "image/jpeg") {
  const order = resolveProviderOrder();
  if (!order.length) {
    return failResult(buffer, mimeType, "not_configured");
  }
  if (!buffer?.length) {
    return failResult(buffer, mimeType, "missing_image");
  }

  let lastReason = "api_failed";
  for (const provider of order) {
    const fn = PROVIDER_FN[provider];
    if (!fn) continue;
    try {
      const result = await fn(buffer, mimeType);
      if (result.studioApplied) {
        return maybeAttachProductClip(result);
      }
      lastReason = result.reason || lastReason;
      console.warn(`[listing-studio] ${provider} skipped (${result.reason}) — trying next`);
    } catch (err) {
      lastReason = "api_error";
      console.warn(`[listing-studio] ${provider} error:`, err.message);
    }
  }

  return failResult(buffer, mimeType, lastReason);
}

function formatClipPayload(cleaned) {
  const clipUrl = cleaned.clipUrl || null;
  const hasBuffer = Boolean(cleaned.clipBuffer?.length);
  const clipApplied = Boolean(clipUrl || hasBuffer);
  const inline = env("STUDIO_CLIP_INLINE") === "true";
  let clipVideoBase64 = null;
  if (inline && hasBuffer) {
    clipVideoBase64 = `data:${cleaned.clipMimeType || "video/mp4"};base64,${cleaned.clipBuffer.toString("base64")}`;
  }
  return { clipApplied, clipVideoUrl: clipUrl, clipVideoBase64 };
}

function formatCleanImagePayload(cleaned) {
  const cleanImageUrl = cleaned.cleanUrl || null;
  const inline = env("STUDIO_INLINE_IMAGES") === "true";
  let cleanImageBase64 = null;
  if (inline && cleaned.buffer?.length) {
    cleanImageBase64 = `data:image/png;base64,${cleaned.buffer.toString("base64")}`;
  }
  return { cleanImageUrl, cleanImageBase64 };
}

/** Small JPEG of the cleaned cover for vision models — keeps RAM low. */
async function fetchCleanForVision(cleaned) {
  if (cleaned.buffer?.length) return { buffer: cleaned.buffer, mimeType: cleaned.mimeType || "image/png" };
  const url = cleaned.cleanUrl;
  if (!url) return null;
  // Prefer a downscaled JPEG delivery when the URL is Cloudinary.
  let fetchUrl = url;
  if (/res\.cloudinary\.com/i.test(url) && !/\/c_limit,/i.test(url)) {
    fetchUrl = url.replace("/upload/", "/upload/c_limit,w_1024,q_auto,f_jpg/");
  }
  const buf = await fetchCloudinaryDerived(fetchUrl, {
    label: "vision-clean",
    timeoutMs: 60_000,
    attempts: 4,
  });
  if (!buf?.length) return null;
  return { buffer: buf, mimeType: "image/jpeg" };
}

/**
 * Format studio preview response for seller API (no draft generation).
 * Default: CDN URLs only — never embed multi‑MB PNG/MP4 base64 (crashes 1GB VMs).
 * @param {Buffer} buffer
 * @param {string} mimeType
 */
export async function previewStudioClean(buffer, mimeType = "image/jpeg") {
  const cleaned = await removeBackground(buffer, mimeType);
  if (!cleaned.studioApplied) {
    const messages = {
      not_configured: "Background cleanup is not configured on this bot.",
      missing_image: "Add a cover photo first.",
      auth_failed:
        "Cloudinary API secret doesn’t match — open Cloudinary → Settings → API Keys, copy the API secret again into whatsapp-bot/.env, then redeploy.",
      api_failed: "Background cleanup failed — keep your original photo.",
      empty_result: "Background cleanup returned an empty image — keep your original.",
      api_error: "Background cleanup unavailable right now — keep your original photo.",
    };
    return {
      studioApplied: false,
      cleanImageBase64: null,
      cleanImageUrl: null,
      clipVideoBase64: null,
      clipVideoUrl: null,
      clipApplied: false,
      reason: cleaned.reason || "api_failed",
      provider: cleaned.provider || null,
      message: messages[cleaned.reason] || messages.api_failed,
    };
  }

  const { clipApplied, clipVideoUrl, clipVideoBase64 } = formatClipPayload(cleaned);
  const { cleanImageUrl, cleanImageBase64 } = formatCleanImagePayload(cleaned);

  // Fallback: if we only have a buffer (e.g. Photoroom without Cloudinary store), inline once.
  let cleanB64 = cleanImageBase64;
  let cleanUrl = cleanImageUrl;
  if (!cleanUrl && !cleanB64 && cleaned.buffer?.length) {
    cleanB64 = `data:image/png;base64,${cleaned.buffer.toString("base64")}`;
  }

  let message = "Background cleaned — toggle below to switch back to the original.";
  if (clipApplied) {
    message = "Background cleaned + product clip from your cutout — use the toggles below.";
  } else if (isStudioClipEnabled()) {
    message = "Background cleaned — product clip unavailable this time; cover is ready.";
  }

  return {
    studioApplied: true,
    cleanImageBase64: cleanB64,
    cleanImageUrl: cleanUrl,
    clipVideoBase64,
    clipVideoUrl,
    clipApplied,
    reason: null,
    provider: cleaned.provider || null,
    message,
  };
}

/**
 * Studio clean-up + listing draft.
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {string} [caption]
 * @param {{ skipStudio?: boolean }} [opts]
 */
export async function processListingWithStudio(buffer, mimeType, caption = "", opts = {}) {
  let workBuffer = buffer;
  let workMime = mimeType;
  let studioApplied = false;
  let studioProvider = null;
  let clipVideoBase64 = null;
  let clipVideoUrl = null;
  let clipApplied = false;
  let cleanImageUrl = null;
  let cleanImageBase64 = null;

  if (!opts.skipStudio) {
    const cleaned = await removeBackground(buffer, mimeType);
    studioApplied = cleaned.studioApplied;
    studioProvider = cleaned.provider || null;
    const clip = formatClipPayload(cleaned);
    clipApplied = clip.clipApplied;
    clipVideoBase64 = clip.clipVideoBase64;
    clipVideoUrl = clip.clipVideoUrl;
    const clean = formatCleanImagePayload(cleaned);
    cleanImageUrl = clean.cleanImageUrl;
    cleanImageBase64 = clean.cleanImageBase64;

    if (cleaned.studioApplied) {
      const forVision = await fetchCleanForVision(cleaned);
      if (forVision?.buffer?.length) {
        workBuffer = forVision.buffer;
        workMime = forVision.mimeType;
      } else if (cleaned.buffer?.length) {
        workBuffer = cleaned.buffer;
        workMime = cleaned.mimeType;
      }
    }
  }

  const draft = await generateListingFromImage(workBuffer, workMime, caption);

  return {
    draft,
    studioApplied,
    studioProvider,
    cleanImageBase64,
    cleanImageUrl,
    clipApplied,
    clipVideoBase64,
    clipVideoUrl,
  };
}
