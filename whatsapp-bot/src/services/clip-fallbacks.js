/**
 * Soft product-clip fallbacks when Cloudinary zoompan / multi reel fails.
 *
 * Order (env STUDIO_CLIP_FALLBACKS, default hyperframes,remotion):
 *   1. HyperFrames (HeyGen cloud) — HEYGEN_API_KEY or HYPERFRAMES_API_KEY
 *   2. Remotion — REMOTION_RENDER_URL (HTTP worker) or optional Lambda env
 *      (REMOTION_SERVE_URL + REMOTION_FUNCTION_NAME + REMOTION_REGION) when
 *      @remotion/lambda is installed separately — never a required bot dep.
 *
 * Fail-soft: unset keys / errors → null. Never throws into seller publish.
 * Presigned / ephemeral URLs are re-hosted to Cloudinary when possible.
 */

import crypto from "node:crypto";

function env(name) {
  return String(process.env[name] || "").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeImageUrls(imageUrls) {
  return (Array.isArray(imageUrls) ? imageUrls : [])
    .map((u) => String(u || "").trim().split("?")[0])
    .filter((u) => /^https?:\/\//i.test(u))
    .slice(0, 8);
}

/** Enabled providers in configured order (only those with credentials). */
export function listConfiguredClipFallbacks() {
  const raw = env("STUDIO_CLIP_FALLBACKS") || "hyperframes,remotion";
  const wanted = raw
    .split(/[,+\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const out = [];
  for (const id of wanted) {
    if (id === "hyperframes" && isHyperframesConfigured()) out.push("hyperframes");
    if (id === "remotion" && isRemotionConfigured()) out.push("remotion");
  }
  return out;
}

export function isClipFallbackConfigured() {
  return listConfiguredClipFallbacks().length > 0;
}

export function isHyperframesConfigured() {
  return Boolean(env("HEYGEN_API_KEY") || env("HYPERFRAMES_API_KEY"));
}

export function isRemotionConfigured() {
  if (env("REMOTION_RENDER_URL")) return true;
  return Boolean(
    env("REMOTION_SERVE_URL") && env("REMOTION_FUNCTION_NAME") && env("REMOTION_REGION")
  );
}

function heygenApiKey() {
  return env("HEYGEN_API_KEY") || env("HYPERFRAMES_API_KEY");
}

function heygenHeaders() {
  return {
    "x-api-key": heygenApiKey(),
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/* ---------- minimal ZIP (store) for HyperFrames project bundle ---------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Build an uncompressed ZIP from { name: string|Buffer } entries. */
export function zipStoreFiles(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  const entries = Object.entries(files);
  for (const [name, content] of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    parts.push(local, data);

    const cen = Buffer.alloc(46 + nameBuf.length);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    nameBuf.copy(cen, 46);
    central.push(cen);
    offset += local.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, centralBuf, end]);
}

/**
 * Self-contained Ken Burns / slideshow HTML for HyperFrames cloud render.
 * Uses Web Animations API (seekable via getAnimations) + cream Sokoni stage.
 */
export function buildHyperframesCompositionHtml(imageUrls, opts = {}) {
  const urls = normalizeImageUrls(imageUrls);
  const perSlide = Math.max(1.5, Math.min(4, Number(opts.secondsPerSlide) || 2));
  const duration = Math.max(3, Math.round(urls.length * perSlide * 10) / 10);
  const imagesJson = JSON.stringify(urls);
  const varsDecl = JSON.stringify({
    images: { type: "string", default: imagesJson },
  });

  return `<!DOCTYPE html>
<html lang="en"
  data-composition-id="sokoni-listing-clip"
  data-composition-duration="${duration}"
  data-composition-variables='${varsDecl.replace(/'/g, "&#39;")}'>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: #FFF8F0; overflow: hidden; }
  .stage {
    position: relative; width: 1080px; height: 1080px; margin: 0 auto;
    background: #FFF8F0; overflow: hidden;
  }
  .slide {
    position: absolute; inset: 0; opacity: 0;
    display: flex; align-items: center; justify-content: center;
  }
  .slide img {
    width: 100%; height: 100%; object-fit: contain;
    transform: scale(1); transform-origin: 50% 50%;
    will-change: transform;
  }
</style>
</head>
<body>
  <div class="stage" id="stage"></div>
  <script>
(function () {
  var DURATION = ${duration};
  var PER = ${perSlide};
  function readImages() {
    try {
      if (window.__HF_VARIABLES__ && window.__HF_VARIABLES__.images) {
        var v = window.__HF_VARIABLES__.images;
        return typeof v === "string" ? JSON.parse(v) : (v || []);
      }
    } catch (e) {}
    try {
      var raw = document.documentElement.getAttribute("data-composition-variables") || "{}";
      var decl = JSON.parse(raw);
      var def = decl.images && decl.images.default;
      return typeof def === "string" ? JSON.parse(def) : (def || []);
    } catch (e2) {
      return ${imagesJson};
    }
  }
  var images = readImages().filter(Boolean).slice(0, 8);
  if (!images.length) images = ${imagesJson};
  var stage = document.getElementById("stage");
  var anims = [];
  images.forEach(function (src, i) {
    var slide = document.createElement("div");
    slide.className = "slide";
    var img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.decoding = "sync";
    slide.appendChild(img);
    stage.appendChild(slide);
    var start = i * PER;
    var end = Math.min(DURATION, start + PER);
    var fadeIn = Math.min(0.35, PER * 0.15);
    var fadeOut = Math.min(0.35, PER * 0.15);
    var opacityKeyframes = [
      { offset: 0, opacity: 0 },
      { offset: fadeIn / PER, opacity: 1 },
      { offset: Math.max(fadeIn / PER, 1 - fadeOut / PER), opacity: 1 },
      { offset: 1, opacity: 0 }
    ];
    var op = slide.animate(opacityKeyframes, {
      duration: (end - start) * 1000,
      delay: start * 1000,
      fill: "both",
      easing: "linear"
    });
    op.pause();
    anims.push(op);
    var zoom = img.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.28)" }
      ],
      {
        duration: (end - start) * 1000,
        delay: start * 1000,
        fill: "both",
        easing: "linear"
      }
    );
    zoom.pause();
    anims.push(zoom);
  });
  window.__sokoniSeek = function (t) {
    var ms = Math.max(0, Math.min(DURATION, Number(t) || 0)) * 1000;
    for (var i = 0; i < anims.length; i++) {
      try {
        anims[i].currentTime = ms;
      } catch (e) {}
    }
  };
  window.__sokoniSeek(0);
})();
  </script>
</body>
</html>`;
}

function buildHyperframesProjectZip(imageUrls) {
  const html = buildHyperframesCompositionHtml(imageUrls);
  return zipStoreFiles({ "index.html": html });
}

async function pollHyperframesRender(renderId, timeoutMs, pollMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`https://api.heygen.com/v3/hyperframes/renders/${encodeURIComponent(renderId)}`, {
      method: "GET",
      headers: heygenHeaders(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[clip-fallbacks] HyperFrames poll failed:", res.status, text.slice(0, 160));
      return null;
    }
    const body = await res.json().catch(() => ({}));
    const data = body.data || body;
    const status = String(data.status || "").toLowerCase();
    if (status === "completed") {
      const videoUrl = data.video_url || data.videoUrl || null;
      return videoUrl ? String(videoUrl) : null;
    }
    if (status === "failed") {
      console.warn(
        "[clip-fallbacks] HyperFrames render failed:",
        data.failure_message || data.error || data.status
      );
      return null;
    }
    await sleep(pollMs);
  }
  console.warn("[clip-fallbacks] HyperFrames render timed out:", renderId);
  return null;
}

/**
 * @param {string[]} imageUrls
 * @returns {Promise<{ videoUrl: string, provider: "hyperframes" }|null>}
 */
export async function renderWithHyperframes(imageUrls) {
  if (!isHyperframesConfigured()) return null;
  const urls = normalizeImageUrls(imageUrls);
  if (!urls.length) return null;

  const projectAssetId = env("HYPERFRAMES_PROJECT_ASSET_ID");
  const projectUrl = env("HYPERFRAMES_PROJECT_URL");
  let project;
  if (projectAssetId) {
    project = { type: "asset_id", asset_id: projectAssetId };
  } else if (projectUrl) {
    project = { type: "url", url: projectUrl };
  } else {
    const zip = buildHyperframesProjectZip(urls);
    // Keep base64 modest — composition is tiny HTML; images stay remote URLs.
    if (zip.length > 900_000) {
      console.warn("[clip-fallbacks] HyperFrames zip too large — skip");
      return null;
    }
    project = {
      type: "base64",
      media_type: "application/zip",
      data: zip.toString("base64"),
    };
  }

  const variables = {
    images: JSON.stringify(urls),
  };
  urls.forEach((u, i) => {
    variables[`image${i + 1}`] = u;
  });

  const payload = {
    project,
    fps: 30,
    quality: env("HYPERFRAMES_QUALITY") || "draft",
    format: "mp4",
    resolution: "1080p",
    aspect_ratio: "1:1",
    composition: env("HYPERFRAMES_COMPOSITION") || "index.html",
    variables,
    title: "Sokoni listing clip",
  };

  try {
    const res = await fetch("https://api.heygen.com/v3/hyperframes/renders", {
      method: "POST",
      headers: {
        ...heygenHeaders(),
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[clip-fallbacks] HyperFrames submit failed:", res.status, text.slice(0, 220));
      return null;
    }
    const body = await res.json().catch(() => ({}));
    const renderId = body?.data?.render_id || body?.render_id;
    if (!renderId) {
      console.warn("[clip-fallbacks] HyperFrames missing render_id");
      return null;
    }
    const timeoutMs = Number(env("HYPERFRAMES_TIMEOUT_MS")) || 180_000;
    const pollMs = Number(env("HYPERFRAMES_POLL_MS")) || 3_000;
    const videoUrl = await pollHyperframesRender(renderId, timeoutMs, pollMs);
    if (!videoUrl) return null;
    return { videoUrl, provider: "hyperframes" };
  } catch (err) {
    console.warn("[clip-fallbacks] HyperFrames error:", err?.message || err);
    return null;
  }
}

/* ---------- Remotion (remote HTTP or optional Lambda client) ---------- */

async function pollJsonUrl(url, headers, timeoutMs, pollMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      await sleep(pollMs);
      continue;
    }
    const data = await res.json().catch(() => ({}));
    const status = String(data.status || data.state || "").toLowerCase();
    const videoUrl = data.videoUrl || data.video_url || data.url || data.outputUrl || null;
    if (videoUrl && (status === "completed" || status === "done" || status === "success" || !status)) {
      return String(videoUrl);
    }
    if (status === "failed" || status === "error") {
      console.warn("[clip-fallbacks] Remotion poll failed:", data.error || data.message || status);
      return null;
    }
    await sleep(pollMs);
  }
  return null;
}

/**
 * HTTP Remotion worker — POST image URLs, get a video URL (or poll URL).
 * Expected responses:
 *   { videoUrl } | { video_url } | { statusUrl } | { pollUrl } | { renderId, pollUrl }
 */
async function renderWithRemotionHttp(imageUrls) {
  const endpoint = env("REMOTION_RENDER_URL");
  if (!endpoint) return null;
  const urls = normalizeImageUrls(imageUrls);
  if (!urls.length) return null;

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const key = env("REMOTION_RENDER_KEY");
  if (key) headers.Authorization = `Bearer ${key}`;

  const body = {
    imageUrls: urls,
    images: urls,
    composition: env("REMOTION_COMPOSITION") || "SokoniProduct",
    codec: "h264",
    fps: 30,
    width: 720,
    height: 720,
    creamBg: "#FFF8F0",
    secondsPerSlide: Number(env("REMOTION_SECONDS_PER_SLIDE")) || 2,
  };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(env("REMOTION_TIMEOUT_MS")) || 120_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[clip-fallbacks] Remotion HTTP failed:", res.status, text.slice(0, 200));
      return null;
    }
    const data = await res.json().catch(() => ({}));
    let videoUrl = data.videoUrl || data.video_url || data.url || null;
    if (!videoUrl) {
      const pollUrl = data.statusUrl || data.pollUrl || data.poll_url || null;
      if (pollUrl) {
        videoUrl = await pollJsonUrl(
          pollUrl,
          headers,
          Number(env("REMOTION_TIMEOUT_MS")) || 180_000,
          Number(env("REMOTION_POLL_MS")) || 3_000
        );
      }
    }
    if (!videoUrl) return null;
    return { videoUrl: String(videoUrl), provider: "remotion" };
  } catch (err) {
    console.warn("[clip-fallbacks] Remotion HTTP error:", err?.message || err);
    return null;
  }
}

/**
 * Optional Remotion Lambda — only if @remotion/lambda is installed on the host.
 * Not a package.json dependency (keeps the 1GB bot lean).
 */
async function renderWithRemotionLambda(imageUrls) {
  const serveUrl = env("REMOTION_SERVE_URL");
  const functionName = env("REMOTION_FUNCTION_NAME");
  const region = env("REMOTION_REGION");
  if (!serveUrl || !functionName || !region) return null;

  const urls = normalizeImageUrls(imageUrls);
  if (!urls.length) return null;

  let renderMediaOnLambda;
  let getRenderProgress;
  try {
    const mod = await import("@remotion/lambda/client");
    renderMediaOnLambda = mod.renderMediaOnLambda;
    getRenderProgress = mod.getRenderProgress;
  } catch {
    console.warn(
      "[clip-fallbacks] Remotion Lambda env set but @remotion/lambda not installed — use REMOTION_RENDER_URL instead"
    );
    return null;
  }

  try {
    const { renderId, bucketName } = await renderMediaOnLambda({
      region,
      functionName,
      serveUrl,
      composition: env("REMOTION_COMPOSITION") || "SokoniProduct",
      inputProps: {
        imageUrls: urls,
        images: urls,
        creamBg: "#FFF8F0",
        secondsPerSlide: Number(env("REMOTION_SECONDS_PER_SLIDE")) || 2,
      },
      codec: "h264",
      imageFormat: "jpeg",
      maxRetries: 1,
      privacy: "public",
      downloadBehavior: { type: "play-in-browser" },
    });

    const timeoutMs = Number(env("REMOTION_TIMEOUT_MS")) || 180_000;
    const pollMs = Number(env("REMOTION_POLL_MS")) || 3_000;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const progress = await getRenderProgress({
        renderId,
        bucketName,
        functionName,
        region,
      });
      if (progress.done) {
        const videoUrl = progress.outputFile || progress.outFile || null;
        if (!videoUrl) return null;
        return { videoUrl: String(videoUrl), provider: "remotion" };
      }
      if (progress.fatalErrorEncountered) {
        console.warn(
          "[clip-fallbacks] Remotion Lambda fatal:",
          progress.errors?.[0]?.message || "unknown"
        );
        return null;
      }
      await sleep(pollMs);
    }
    console.warn("[clip-fallbacks] Remotion Lambda timed out:", renderId);
    return null;
  } catch (err) {
    console.warn("[clip-fallbacks] Remotion Lambda error:", err?.message || err);
    return null;
  }
}

/**
 * @param {string[]} imageUrls
 * @returns {Promise<{ videoUrl: string, provider: "remotion" }|null>}
 */
export async function renderWithRemotion(imageUrls) {
  if (!isRemotionConfigured()) return null;
  if (env("REMOTION_RENDER_URL")) {
    const http = await renderWithRemotionHttp(imageUrls);
    if (http) return http;
  }
  if (env("REMOTION_SERVE_URL") && env("REMOTION_FUNCTION_NAME") && env("REMOTION_REGION")) {
    return renderWithRemotionLambda(imageUrls);
  }
  return null;
}

/* ---------- Cloudinary re-host (durable CDN) ---------- */

function cloudinarySign(params, apiSecret) {
  const toSign = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return crypto.createHash("sha1").update(toSign + apiSecret).digest("hex");
}

function isCloudinaryConfigured() {
  return Boolean(
    env("CLOUDINARY_CLOUD_NAME") && env("CLOUDINARY_API_KEY") && env("CLOUDINARY_API_SECRET")
  );
}

/**
 * Download a remote MP4 and store on Cloudinary so catalog URLs stay durable
 * (HyperFrames presigned URLs expire).
 * @returns {Promise<string|null>}
 */
export async function rehostVideoToCloudinary(videoUrl) {
  if (!videoUrl || !isCloudinaryConfigured()) return null;
  if (/res\.cloudinary\.com/i.test(videoUrl)) return videoUrl;

  const cloud = env("CLOUDINARY_CLOUD_NAME");
  const apiKey = env("CLOUDINARY_API_KEY");
  const apiSecret = env("CLOUDINARY_API_SECRET");
  const folder = env("CLOUDINARY_FOLDER") || "sokoni-studio";
  const publicId = `fallback_${Math.floor(Date.now() / 1000)}_${crypto.randomBytes(3).toString("hex")}`;
  const timestamp = Math.floor(Date.now() / 1000);
  // resource_type lives in the upload URL path — do not include it in the signed string.
  const signature = cloudinarySign(
    { folder, public_id: publicId, timestamp },
    apiSecret
  );

  try {
    const form = new FormData();
    form.append("file", videoUrl);
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
      // Fallback: download bytes then upload (some remotes block Cloudinary fetch).
      const dl = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
      if (!dl.ok) {
        console.warn("[clip-fallbacks] rehost download failed:", dl.status);
        return null;
      }
      const buf = Buffer.from(await dl.arrayBuffer());
      if (!buf.length || buf.length > 20 * 1024 * 1024) {
        console.warn("[clip-fallbacks] rehost buffer empty or too large:", buf.length);
        return null;
      }
      const form2 = new FormData();
      form2.append("file", new Blob([buf], { type: "video/mp4" }), "clip.mp4");
      form2.append("api_key", apiKey);
      form2.append("timestamp", String(timestamp));
      form2.append("signature", signature);
      form2.append("folder", folder);
      form2.append("public_id", publicId);
      const res2 = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/video/upload`, {
        method: "POST",
        body: form2,
        signal: AbortSignal.timeout(180_000),
      });
      if (!res2.ok) {
        const errText = await res2.text().catch(() => "");
        console.warn("[clip-fallbacks] Cloudinary video upload failed:", res2.status, errText.slice(0, 160));
        return null;
      }
      const uploaded2 = await res2.json().catch(() => ({}));
      return uploaded2.secure_url || uploaded2.url || null;
    }
    const uploaded = await res.json().catch(() => ({}));
    return uploaded.secure_url || uploaded.url || null;
  } catch (err) {
    console.warn("[clip-fallbacks] rehost error:", err?.message || err);
    return null;
  }
}

/**
 * Try configured clip fallbacks in order. Returns durable video URL when possible.
 * @param {string[]} imageUrls — cleaned still URLs
 * @returns {Promise<{ videoUrl: string, provider: string, videoKind: "preview" }|null>}
 */
export async function tryClipFallbacks(imageUrls) {
  if (env("STUDIO_CLIP_ENABLED") === "false") return null;
  const urls = normalizeImageUrls(imageUrls);
  if (!urls.length) return null;

  const providers = listConfiguredClipFallbacks();
  if (!providers.length) return null;

  for (const id of providers) {
    let result = null;
    try {
      if (id === "hyperframes") result = await renderWithHyperframes(urls);
      else if (id === "remotion") result = await renderWithRemotion(urls);
    } catch (err) {
      console.warn(`[clip-fallbacks] ${id} threw:`, err?.message || err);
      result = null;
    }
    if (!result?.videoUrl) continue;

    let videoUrl = result.videoUrl;
    const hosted = await rehostVideoToCloudinary(videoUrl);
    if (hosted) videoUrl = hosted;
    else if (!/res\.cloudinary\.com/i.test(videoUrl)) {
      console.warn(
        `[clip-fallbacks] ${id} produced ephemeral URL and Cloudinary rehost failed — skipping to avoid broken catalog links`
      );
      continue;
    }

    console.warn(`[clip-fallbacks] clip via ${id}`, videoUrl.slice(0, 96));
    return { videoUrl, provider: result.provider || id, videoKind: "preview" };
  }
  return null;
}
