/**
 * Category / subcategory thumbnail URLs.
 * Cloudinary: insert f_auto,q_auto,w_150 after /upload/.
 * Unsplash: auto=format + w=150 (already on a CDN; never pull full 600px into icon slots).
 */
(function (global) {
  var WIDTH = 150;
  var TRANSFORM = "f_auto,q_auto,w_";
  var FALLBACK =
    "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=150&h=150&q=80";

  function clampWidth(width) {
    var n = Number(width);
    if (!Number.isFinite(n) || n < 16) return WIDTH;
    return Math.min(1200, Math.round(n));
  }

  function isHttpUrl(raw) {
    return /^https?:\/\//i.test(raw);
  }

  function cloudinaryThumb(raw, width) {
    var marker = TRANSFORM + width;
    if (!/res\.cloudinary\.com/i.test(raw) || !/\/(?:image|video)\/upload\//i.test(raw)) {
      return raw;
    }
    if (raw.indexOf("/upload/" + marker) !== -1 || raw.indexOf("/upload/" + marker + ",") !== -1) {
      return raw;
    }
    var stripped = raw.replace(/\/upload\/f_auto,q_auto,w_\d+(?:,[a-z0-9_,:]+)?\//i, "/upload/");
    return stripped.replace(/\/(image|video)\/upload\//i, function (m) {
      return m + marker + "/";
    });
  }

  function unsplashThumb(raw, width) {
    var u = new URL(raw);
    var auto = u.searchParams.get("auto") || "format";
    if (auto.indexOf("format") === -1) auto = auto ? auto + ",format" : "format";
    u.searchParams.set("auto", auto);
    if (!u.searchParams.get("fit")) u.searchParams.set("fit", "crop");
    u.searchParams.set("w", String(width));
    u.searchParams.set("h", String(width));
    if (!u.searchParams.get("q")) u.searchParams.set("q", "80");
    return u.toString();
  }

  function thumbUrl(src, width) {
    var raw = String(src == null ? "" : src).trim();
    if (!raw) return "";
    var w = clampWidth(width);
    if (!isHttpUrl(raw)) return raw;
    try {
      if (/res\.cloudinary\.com/i.test(raw)) return cloudinaryThumb(raw, w);
      var host = new URL(raw).hostname;
      if (host === "images.unsplash.com" || host === "plus.unsplash.com" || host === "source.unsplash.com") {
        return unsplashThumb(raw, w);
      }
    } catch (_e) {
      return raw;
    }
    return raw;
  }

  global.SokoniBrowseThumb = {
    WIDTH: WIDTH,
    FALLBACK: FALLBACK,
    thumbUrl: thumbUrl,
  };
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
