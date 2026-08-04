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
    // Prefer body/query sessionToken — custom X-Account-Token needs CORS allowlist.
    return { "Content-Type": "application/json", ...extra };
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
    try {
      const params = new URLSearchParams({ sessionToken: session.sessionToken });
      const res = await fetch(`${AUTH_API}/session?${params}`, {
        headers: { Accept: "application/json" },
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
    } catch (err) {
      return {
        ok: false,
        status: 0,
        data: { error: "network_error", message: err?.message || "Network error." },
      };
    }
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
    try {
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
    } catch (err) {
      return {
        ok: false,
        status: 0,
        data: { error: "network_error", message: err?.message || "Network error saving profile." },
      };
    }
  }

  async function fetchPurchases() {
    const session = readSession();
    if (!session) return { ok: false, status: 401, data: { error: "session_required" } };
    try {
      const params = new URLSearchParams({ sessionToken: session.sessionToken });
      const res = await fetch(`${AUTH_API}/purchases?${params}`, {
        headers: { Accept: "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, data };
      return { ok: true, status: res.status, data };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        data: { error: "network_error", message: err?.message || "Network error loading purchases." },
      };
    }
  }

  async function claimOrder(orderId) {
    const session = readSession();
    if (!session) return { ok: false, status: 401, data: { error: "session_required" } };
    try {
      const res = await fetch(`${AUTH_API}/claim-order`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ orderId, sessionToken: session.sessionToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, data };
      return { ok: true, status: res.status, data };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        data: { error: "network_error", message: err?.message || "Network error linking order." },
      };
    }
  }

  async function forgotPassword(email) {
    const res = await fetch(`${AUTH_API}/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  async function resetPassword({ token, password } = {}) {
    const res = await fetch(`${AUTH_API}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, data };
    const saved = saveSession(data);
    return { ok: Boolean(saved), status: res.status, data, session: saved };
  }

  async function loginWithWhatsApp({ phone, buyerSessionToken } = {}) {
    const res = await fetch(`${AUTH_API}/whatsapp-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, buyerSessionToken }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, data };
    const saved = saveSession(data);
    return { ok: Boolean(saved), status: res.status, data, session: saved };
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
        el.innerHTML = `<a href="${siteHref("profile.html")}" class="${el.dataset.accountNavClass || ""}" title="${escapeAttr(session.email)}">${escapeHtml(label)}</a>`;
      } else {
        el.innerHTML = `<a href="${siteHref("login.html")}" class="${el.dataset.accountNavClass || ""}">Log in</a>`;
      }
    });
    document.querySelectorAll("[data-account-nav-label]").forEach((el) => {
      el.textContent = session ? "Account" : "Log in";
      if (el.tagName === "A") el.href = session ? siteHref("profile.html") : siteHref("login.html");
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

  function redirectAfterAuth() {
    paintNavSlots();
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next") || consumeNextUrl("profile.html");
    window.location.href = next;
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
      const token = String(fd.get("token") || "").trim();

      if (status) {
        status.textContent =
          mode === "signup"
            ? "Creating account…"
            : mode === "forgot"
              ? "Sending…"
              : mode === "reset"
                ? "Saving…"
                : "Signing in…";
        status.classList.remove("text-red-400", "text-[#25D366]");
      }
      if (submitBtn) submitBtn.disabled = true;

      let result;
      if (mode === "signup") {
        result = await signup({ email, password, displayName, phone: phone || undefined });
      } else if (mode === "forgot") {
        result = await forgotPassword(email);
      } else if (mode === "reset") {
        result = await resetPassword({ token, password });
      } else {
        result = await login({ email, password, rememberMe });
      }

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
      if (mode === "forgot") return;
      redirectAfterAuth();
    });
  }

  function bindWhatsAppContinue() {
    const sendBtn = document.getElementById("account-wa-send-btn");
    const verifyBtn = document.getElementById("account-wa-verify-btn");
    const phoneInput = document.getElementById("account-wa-phone");
    const codeInput = document.getElementById("account-wa-code");
    const status = document.getElementById("account-wa-status");
    if (!sendBtn || !verifyBtn || !window.SokoniBuyerAuth) return;

    sendBtn.addEventListener("click", async () => {
      const phone = window.SokoniBuyerAuth.normalizePhoneInput(phoneInput?.value || "");
      if (status) status.textContent = "Sending WhatsApp code…";
      sendBtn.disabled = true;
      try {
        const result = await window.SokoniBuyerAuth.sendCode(phone);
        if (status) {
          status.textContent = result.ok
            ? result.data?.message || "Code sent."
            : result.data?.message || "Could not send code.";
          status.classList.toggle("text-red-400", !result.ok);
        }
      } finally {
        sendBtn.disabled = false;
      }
    });

    verifyBtn.addEventListener("click", async () => {
      const phone = window.SokoniBuyerAuth.normalizePhoneInput(phoneInput?.value || "");
      const code = String(codeInput?.value || "").trim();
      if (status) status.textContent = "Verifying…";
      verifyBtn.disabled = true;
      try {
        const verified = await window.SokoniBuyerAuth.verifyCode(phone, code);
        if (!verified.ok) {
          if (status) {
            status.textContent = verified.data?.message || "Could not verify.";
            status.classList.add("text-red-400");
          }
          return;
        }
        const result = await loginWithWhatsApp({
          phone: verified.session?.phone || phone,
          buyerSessionToken: verified.session?.sessionToken,
        });
        if (!result.ok) {
          if (result.data?.error === "need_signup") {
            if (status) status.textContent = "No account yet — finishing signup…";
            const phoneQ = encodeURIComponent(result.data.phone || phone);
            window.location.href = `${siteHref("signup.html")}?phone=${phoneQ}`;
            return;
          }
          if (status) {
            status.textContent = result.data?.message || "WhatsApp login failed.";
            status.classList.add("text-red-400");
          }
          return;
        }
        if (status) {
          status.textContent = result.data?.message || "Signed in.";
          status.classList.add("text-[#25D366]");
        }
        redirectAfterAuth();
      } finally {
        verifyBtn.disabled = false;
      }
    });
  }

  function initPage() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("next")) setNextUrl(params.get("next"));
    const phonePrefill = params.get("phone");
    if (phonePrefill) {
      const phoneField = document.querySelector('#account-signup-form [name="phone"]');
      if (phoneField) phoneField.value = phonePrefill.startsWith("254")
        ? `0${phonePrefill.slice(3)}`
        : phonePrefill;
    }
    const resetToken = params.get("token");
    if (resetToken) {
      const tokenInput = document.getElementById("reset-token");
      if (tokenInput) tokenInput.value = resetToken;
    }

    bindAuthForm("account-signup-form", "signup");
    bindAuthForm("account-login-form", "login");
    bindAuthForm("account-forgot-form", "forgot");
    bindAuthForm("account-reset-form", "reset");
    bindWhatsAppContinue();
    paintNavSlots();

    document.getElementById("account-sign-out-btn")?.addEventListener("click", async () => {
      await signOut();
      paintNavSlots();
      window.location.href = siteHref("login.html");
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
    forgotPassword,
    resetPassword,
    loginWithWhatsApp,
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
