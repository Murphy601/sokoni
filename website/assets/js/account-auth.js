/**
 * Sokoni site account (email + password).
 * Session lives in localStorage so return visits stay signed in.
 */
(() => {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:3001"
      : "https://bot.sokonimall.com";
  const AUTH_API = `${API_BASE}/api/account/auth`;
  const TOKEN_KEY = "sokoni-account-session";
  const NEXT_KEY = "sokoni-account-next";

  function parsePositiveInt(value) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  function readSession() {
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const token = String(parsed?.token || "").trim();
      const expiresAt = Number(parsed?.expiresAt || 0);
      const userId = parsePositiveInt(parsed?.userId || parsed?.user?.id);
      const email = String(parsed?.email || parsed?.user?.email || "").trim().toLowerCase();
      if (!token || !userId || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
      return {
        sessionToken: token,
        userId,
        email,
        user: parsed.user || { id: userId, email },
        expiresAt,
      };
    } catch {
      return null;
    }
  }

  function saveSession({ sessionToken, user, expiresInSec, expiresAt } = {}) {
    const token = String(sessionToken || "").trim();
    const uid = parsePositiveInt(user?.id);
    if (!token || !uid) return null;
    const exp =
      Number(expiresAt) ||
      Date.now() + Math.max(60, Number(expiresInSec) || 7 * 24 * 3600) * 1000;
    const payload = {
      token,
      userId: uid,
      email: user.email || "",
      user,
      expiresAt: exp,
    };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(payload));
    return readSession();
  }

  function clearSession() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {}
  }

  function setNextUrl(url) {
    try {
      if (url) sessionStorage.setItem(NEXT_KEY, String(url));
    } catch {}
  }

  function consumeNextUrl(fallback = "profile.html") {
    try {
      const next = sessionStorage.getItem(NEXT_KEY);
      sessionStorage.removeItem(NEXT_KEY);
      if (next && !/^https?:/i.test(next) && !next.startsWith("//")) return next;
    } catch {}
    return fallback;
  }

  function authHeaders(extra = {}) {
    const session = readSession();
    const headers = { "Content-Type": "application/json", ...extra };
    if (session?.sessionToken) headers["X-Account-Token"] = session.sessionToken;
    return headers;
  }

  async function signup({ email, password, displayName, phone } = {}) {
    const res = await fetch(`${AUTH_API}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, displayName, phone }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, data };
    const saved = saveSession(data);
    return { ok: Boolean(saved), status: res.status, data, session: saved };
  }

  async function login({ email, password, rememberMe } = {}) {
    const res = await fetch(`${AUTH_API}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, rememberMe: Boolean(rememberMe) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, data };
    const saved = saveSession(data);
    return { ok: Boolean(saved), status: res.status, data, session: saved };
  }

  async function fetchSession() {
    const session = readSession();
    if (!session) return { ok: false, status: 401, data: { error: "session_required" } };
    const res = await fetch(`${AUTH_API}/session`, {
      headers: { "X-Account-Token": session.sessionToken },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      clearSession();
      return { ok: false, status: res.status, data };
    }
    saveSession({
      sessionToken: session.sessionToken,
      user: data.user,
      expiresAt: data.expiresAt || session.expiresAt,
    });
    return { ok: true, status: res.status, data, session: readSession() };
  }

  async function signOut() {
    const session = readSession();
    if (session?.sessionToken) {
      try {
        await fetch(`${AUTH_API}/sign-out`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ sessionToken: session.sessionToken }),
        });
      } catch {}
    }
    clearSession();
    return { ok: true };
  }

  async function updateProfile(patch) {
    const session = readSession();
    if (!session) return { ok: false, status: 401, data: { error: "session_required" } };
    const res = await fetch(`${AUTH_API}/profile`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ ...patch, sessionToken: session.sessionToken }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, data };
    saveSession({
      sessionToken: session.sessionToken,
      user: data.user,
      expiresAt: session.expiresAt,
    });
    return { ok: true, status: res.status, data, session: readSession() };
  }

  async function fetchPurchases() {
    const session = readSession();
    if (!session) return { ok: false, status: 401, data: { error: "session_required" } };
    const res = await fetch(`${AUTH_API}/purchases`, {
      headers: { "X-Account-Token": session.sessionToken },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, data };
    return { ok: true, status: res.status, data };
  }

  async function claimOrder(orderId) {
    const session = readSession();
    if (!session) return { ok: false, status: 401, data: { error: "session_required" } };
    const res = await fetch(`${AUTH_API}/claim-order`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ orderId, sessionToken: session.sessionToken }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, data };
    return { ok: true, status: res.status, data };
  }

  async function linkWhatsApp({ phone, whatsappSessionToken, role = "buyer" } = {}) {
    const session = readSession();
    if (!session) return { ok: false, status: 401, data: { error: "session_required" } };
    const body = {
      phone,
      role,
      whatsappSessionToken,
      buyerSessionToken: role === "buyer" ? whatsappSessionToken : undefined,
      sellerSessionToken: role === "seller" ? whatsappSessionToken : undefined,
    };
    const res = await fetch(`${AUTH_API}/link-whatsapp`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, data };
    if (data.sessionToken) {
      saveSession({
        sessionToken: data.sessionToken,
        user: data.user,
        expiresAt: data.expiresAt,
        expiresInSec: data.expiresInSec,
      });
    } else if (data.user) {
      saveSession({
        sessionToken: session.sessionToken,
        user: data.user,
        expiresAt: session.expiresAt,
      });
    }
    return { ok: true, status: res.status, data, session: readSession() };
  }

  function siteHref(file) {
    const path = window.location.pathname || "";
    const prefix = /\/suppliers\//i.test(path) ? "../" : "";
    return `${prefix}${file}`;
  }

  function loginUrl(next) {
    const base = siteHref("login.html");
    if (!next) return base;
    return `${base}?next=${encodeURIComponent(next)}`;
  }

  function signupUrl(next) {
    const base = siteHref("signup.html");
    if (!next) return base;
    return `${base}?next=${encodeURIComponent(next)}`;
  }

  function requireAccount({ next } = {}) {
    const session = readSession();
    if (session) return session;
    const dest = next || `${window.location.pathname}${window.location.search}` || "profile.html";
    setNextUrl(dest.replace(/^\//, ""));
    window.location.href = loginUrl(dest.replace(/^\//, ""));
    return null;
  }

  function paintNavSlots() {
    const session = readSession();
    document.querySelectorAll("[data-account-nav]").forEach((el) => {
      if (session) {
        const label = session.user?.displayName || "Account";
        el.innerHTML = `<a href="profile.html" class="${el.dataset.accountNavClass || ""}" title="${escapeAttr(session.email)}">${escapeHtml(label)}</a>`;
      } else {
        el.innerHTML = `<a href="login.html" class="${el.dataset.accountNavClass || ""}">Log in</a>`;
      }
    });
    document.querySelectorAll("[data-account-nav-label]").forEach((el) => {
      el.textContent = session ? "Account" : "Log in";
      if (el.tagName === "A") el.href = session ? "profile.html" : "login.html";
    });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function bindAuthForm(formId, mode) {
    const form = document.getElementById(formId);
    if (!form) return;
    const status = document.getElementById(`${formId}-status`);
    const submitBtn = form.querySelector('[type="submit"]');

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const email = String(fd.get("email") || "").trim();
      const password = String(fd.get("password") || "");
      const displayName = String(fd.get("displayName") || "").trim();
      const phone = String(fd.get("phone") || "").trim();
      const rememberMe = Boolean(fd.get("rememberMe"));

      if (status) {
        status.textContent = mode === "signup" ? "Creating account…" : "Signing in…";
        status.classList.remove("text-red-400", "text-[#25D366]");
      }
      if (submitBtn) submitBtn.disabled = true;

      const result =
        mode === "signup"
          ? await signup({ email, password, displayName, phone: phone || undefined })
          : await login({ email, password, rememberMe });

      if (submitBtn) submitBtn.disabled = false;

      if (!result.ok) {
        if (status) {
          status.textContent = result.data?.message || "Something went wrong. Try again.";
          status.classList.add("text-red-400");
        }
        return;
      }

      if (status) {
        status.textContent = result.data?.message || "Done.";
        status.classList.add("text-[#25D366]");
      }
      paintNavSlots();
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next") || consumeNextUrl("profile.html");
      window.location.href = next;
    });
  }

  function initPage() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("next")) setNextUrl(params.get("next"));
    bindAuthForm("account-signup-form", "signup");
    bindAuthForm("account-login-form", "login");
    paintNavSlots();

    document.getElementById("account-sign-out-btn")?.addEventListener("click", async () => {
      await signOut();
      paintNavSlots();
      window.location.href = "login.html";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPage);
  } else {
    initPage();
  }

  window.SokoniAccountAuth = {
    API_BASE,
    readSession,
    saveSession,
    clearSession,
    signup,
    login,
    fetchSession,
    signOut,
    updateProfile,
    fetchPurchases,
    claimOrder,
    linkWhatsApp,
    authHeaders,
    loginUrl,
    signupUrl,
    requireAccount,
    setNextUrl,
    consumeNextUrl,
    paintNavSlots,
    isSignedIn: () => Boolean(readSession()),
  };
})();
