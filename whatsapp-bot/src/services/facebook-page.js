/**
 * Facebook Page publishing — same VM pattern as WhatsApp Status/Channel:
 * public HTTPS media (Cloudinary / sokonimall.com) + caption, Meta Graph API.
 */
import { config } from "../config.js";

function apiVersion() {
  return String(config.facebook?.apiVersion || "v21.0").replace(/^v/, "v");
}

function pageAuth() {
  const pageId = String(config.facebook?.pageId || "").trim();
  const token = String(config.facebook?.pageAccessToken || "").trim();
  return { pageId, token };
}

export function facebookPageConfigured() {
  const { pageId, token } = pageAuth();
  return Boolean(pageId && token);
}

async function graphPost(path, body = {}) {
  const { token } = pageAuth();
  const url = `https://graph.facebook.com/${apiVersion()}${path.startsWith("/") ? "" : "/"}${path}`;
  const form = new URLSearchParams();
  form.set("access_token", token);
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== null) form.set(k, String(v));
  }
  const res = await fetch(url, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    const err = data?.error?.message || text.slice(0, 200);
    throw new Error(`Graph ${res.status}: ${err}`);
  }
  return data;
}

export function mediaKindFromUrl(url = "") {
  const u = String(url || "").toLowerCase();
  if (/\.(mp4|mov|m4v|webm)(\?|#|$)/.test(u) || /\/video\/upload\//.test(u)) return "video";
  return "image";
}

/** Feed post — catalog photo or link caption. */
export async function publishFacebookFeed({ text = "", mediaUrl = "", link = "" } = {}) {
  const { pageId } = pageAuth();
  if (!facebookPageConfigured()) {
    return { dryRun: true, surface: "POST", text, mediaUrl: mediaUrl || null, link: link || null };
  }
  const caption = String(text || "").trim().slice(0, 2000);
  const media = String(mediaUrl || "").trim();
  const href = String(link || config.facebook?.pageUrl || "https://sokonimall.com/").trim();
  if (media && mediaKindFromUrl(media) === "image") {
    const data = await graphPost(`/${pageId}/photos`, {
      url: media,
      caption,
      published: "true",
    });
    return { ok: true, surface: "POST", kind: "photo", id: data.id || data.post_id, raw: data };
  }
  if (media && mediaKindFromUrl(media) === "video") {
    const data = await graphPost(`/${pageId}/videos`, {
      file_url: media,
      description: caption,
      published: "true",
    });
    return { ok: true, surface: "POST", kind: "video", id: data.id, raw: data };
  }
  const data = await graphPost(`/${pageId}/feed`, {
    message: caption,
    link: href,
  });
  return { ok: true, surface: "POST", kind: "link", id: data.id, raw: data };
}

/** Page Story — photo or short video from CDN URL. */
export async function publishFacebookStory({ mediaUrl = "", text = "" } = {}) {
  const { pageId } = pageAuth();
  if (!facebookPageConfigured()) {
    return { dryRun: true, surface: "STORY", mediaUrl: mediaUrl || null, text: text || null };
  }
  const media = String(mediaUrl || "").trim();
  if (!media) {
    throw new Error("Story needs media_url (Cloudinary or sokonimall.com).");
  }
  const kind = mediaKindFromUrl(media);
  if (kind === "image") {
    const uploaded = await graphPost(`/${pageId}/photos`, { url: media, published: "false", caption: String(text || "").slice(0, 200) });
    const photoId = uploaded.id;
    const story = await graphPost(`/${pageId}/photo_stories`, {
      photo_id: photoId,
      upload_phase: "FINISH",
    });
    return { ok: true, surface: "STORY", kind: "photo", photoId, raw: story };
  }
  const vid = await graphPost(`/${pageId}/videos`, { file_url: media, description: String(text || "").slice(0, 200), published: "false" });
  const videoId = vid.id;
  let story;
  let lastErr;
  for (let i = 0; i < 6; i++) {
    try {
      story = await graphPost(`/${pageId}/video_stories`, { video_id: videoId, upload_phase: "FINISH" });
      break;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 2000 + i * 1000));
    }
  }
  if (!story) throw lastErr || new Error("Story publish timed out");
  return { ok: true, surface: "STORY", kind: "video", videoId, raw: story };
}

/**
 * Page Reel — requires a public MP4 (listing showcase reel on Cloudinary).
 * Graph resumable upload (no Evolution / no local promo pipeline).
 */
export async function publishFacebookReel({ mediaUrl = "", text = "" } = {}, deps = {}) {
  const { pageId, token } = pageAuth();
  const caption = String(text || "").trim().slice(0, 2000);
  const media = String(mediaUrl || "").trim();
  if (!facebookPageConfigured()) {
    return { dryRun: true, surface: "REEL", mediaUrl: media || null, text: caption };
  }
  if (!media || mediaKindFromUrl(media) !== "video") {
    return {
      ok: false,
      error: "reel_requires_video",
      surface: "REEL",
      message: "Reels need media_url to be an HTTPS video (e.g. Cloudinary showcase MP4).",
    };
  }
  const fetchImpl = deps.fetchImpl || fetch;
  const head = await fetchImpl(media, { method: "HEAD", signal: AbortSignal.timeout(30_000) });
  const len = Number(head.headers.get("content-length") || 0);
  if (!head.ok || !len) {
    throw new Error("Could not read video Content-Length for reel upload");
  }
  const start = await graphPost(`/${pageId}/video_reels`, {
    upload_phase: "start",
    file_size: String(len),
  });
  const uploadUrl = start.upload_url;
  const videoId = start.video_id;
  if (!uploadUrl || !videoId) throw new Error("Reel start missing upload_url or video_id");

  const videoRes = await fetchImpl(media, { signal: AbortSignal.timeout(300_000) });
  if (!videoRes.ok) throw new Error(`Reel source download HTTP ${videoRes.status}`);
  const buf = Buffer.from(await videoRes.arrayBuffer());
  const up = await fetchImpl(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${token}`,
      offset: "0",
      file_size: String(len),
      "Content-Type": "application/octet-stream",
    },
    body: buf,
    signal: AbortSignal.timeout(300_000),
  });
  if (!up.ok) throw new Error(`Reel bytes upload HTTP ${up.status}`);

  const finish = await graphPost(`/${pageId}/video_reels`, {
    upload_phase: "finish",
    video_id: videoId,
    video_state: "PUBLISHED",
    description: caption,
  });
  return { ok: true, surface: "REEL", videoId, raw: finish };
}
