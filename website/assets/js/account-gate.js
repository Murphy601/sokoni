/**
 * Site account gate — soft (account for buyer tools) or hard (must log in to browse shop).
 *
 * Mode sources (first wins):
 * 1. ?gate=off|soft|hard query (dev/testing)
 * 2. localStorage sokoni-account-gate
 * 3. <meta name="sokoni-account-gate" content="…">
 * 4. default: soft
 *
 * Always public: login, signup, forgot-password, track, label, legal, about/faq.
 */
(() => {
  const PUBLIC_RE =
    /(login|signup|forgot-password|reset-password|track|label|terms|privacy|about|faq|pickup-points|design-preview|admin-)\.html/i;

  function siteHref(file) {
    const path = window.location.pathname || "";
    const prefix = /\/suppliers\//i.test(path) ? "../" : "";
    return `${prefix}${file}`;
  }

  function currentPageFile() {
    const path = window.location.pathname || "";
    const part = path.split("/").pop() || "index.html";
    return part.includes(".") ? part : "index.html";
  }

  function isPublicPage() {
    const file = currentPageFile();
    if (PUBLIC_RE.test(file)) return true;
    if (/\/suppliers\//i.test(window.location.pathname || "")) return true;
    return false;
  }

  function isSoftProtectedPage() {
    const file = currentPageFile().toLowerCase();
    return ["inbox.html", "activity.html", "disputes.html", "checkout.html", "profile.html"].includes(file);
  }

  function isHardBrowsePage() {
    if (isPublicPage()) return false;
    if (/\/suppliers\//i.test(window.location.pathname || "")) return false;
    // Shop surfaces
    const file = currentPageFile().toLowerCase();
    // Main catalog only — seller shop.html stays shareable without login.
    return file === "index.html" || file === "" || file === "/";
  }

  function getGateMode() {
    try {
      const q = new URLSearchParams(window.location.search).get("gate");
      if (q && /^(off|soft|hard)$/i.test(q)) {
        localStorage.setItem("sokoni-account-gate", q.toLowerCase());
        return q.toLowerCase();
      }
    } catch {
      /* ignore */
    }
    try {
      const ls = localStorage.getItem("sokoni-account-gate");
      if (ls && /^(off|soft|hard)$/i.test(ls)) return ls.toLowerCase();
    } catch {
      /* ignore */
    }
    const meta = document.querySelector('meta[name="sokoni-account-gate"]');
    const fromMeta = String(meta?.getAttribute("content") || "")
      .trim()
      .toLowerCase();
    if (/^(off|soft|hard)$/.test(fromMeta)) return fromMeta;
    return "soft";
  }

  function isSignedIn() {
    return Boolean(window.SokoniAccountAuth?.isSignedIn?.());
  }

  function redirectToLogin() {
    const next = `${currentPageFile()}${window.location.search || ""}`;
    try {
      window.SokoniAccountAuth?.setNextUrl?.(next);
    } catch {
      /* ignore */
    }
    const url = window.SokoniAccountAuth?.loginUrl?.(next) || `${siteHref("login.html")}?next=${encodeURIComponent(next)}`;
    window.location.replace(url);
  }

  function applyGate() {
    const mode = getGateMode();
    document.documentElement.dataset.accountGate = mode;

    if (mode === "off" || isPublicPage()) return { mode, blocked: false };
    if (!window.SokoniAccountAuth) return { mode, blocked: false, defer: true };

    if (mode === "hard" && isHardBrowsePage() && !isSignedIn()) {
      redirectToLogin();
      return { mode, blocked: true };
    }

    if ((mode === "soft" || mode === "hard") && isSoftProtectedPage() && !isSignedIn()) {
      const page = currentPageFile().toLowerCase();
      // These pages have their own WhatsApp / account CTAs — don't bounce before content loads.
      if (page === "profile.html" || page === "inbox.html" || page === "activity.html" || page === "disputes.html") {
        return { mode, blocked: false };
      }
      redirectToLogin();
      return { mode, blocked: true };
    }

    return { mode, blocked: false };
  }

  /** Soft: require account before an action (bag checkout, offer, etc.). */
  function requireForAction(next) {
    if (getGateMode() === "off") return true;
    if (isSignedIn()) return true;
    const dest = next || `${currentPageFile()}${window.location.search || ""}`;
    window.SokoniAccountAuth?.setNextUrl?.(dest);
    window.location.href =
      window.SokoniAccountAuth?.loginUrl?.(dest) || `${siteHref("login.html")}?next=${encodeURIComponent(dest)}`;
    return false;
  }

  function init() {
    const result = applyGate();
    if (result.defer) {
      // account-auth.js may load after us — retry once
      setTimeout(() => applyGate(), 0);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.SokoniAccountGate = {
    getGateMode,
    applyGate,
    requireForAction,
    isPublicPage,
    isSoftProtectedPage,
  };
})();
