(() => {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:3001"
      : "https://bot.sokonimall.com";
  const AUTH_API = `${API_BASE}/api/buyer/auth`;
  const PHONE_KEY = "sokoni-buyer-phone";
  const TOKEN_KEY = "sokoni-buyer-verify-token";

  function normalizePhoneInput(phone) {
    let d = String(phone || "").replace(/\D/g, "");
    if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
    if (d.length === 9) d = `254${d}`;
    return d;
  }

  function parsePositiveInt(value) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  function readSession() {
    try {
      const raw = sessionStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const token = String(parsed?.token || "").trim();
      const expiresAt = Number(parsed?.expiresAt || 0);
      const phone = normalizePhoneInput(parsed?.phone || localStorage.getItem(PHONE_KEY) || "");
      const userId = parsePositiveInt(parsed?.userId);
      if (!token || !phone || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
      return { phone, sessionToken: token, userId };
    } catch {
      return null;
    }
  }

  function saveSession({ phone, sessionToken, userId, expiresInSec = 43200 } = {}) {
    const digits = normalizePhoneInput(phone);
    const token = String(sessionToken || "").trim();
    const uid = parsePositiveInt(userId);
    if (!digits || !token || !uid) return null;
    if (digits) localStorage.setItem(PHONE_KEY, digits);
    sessionStorage.setItem(
      TOKEN_KEY,
      JSON.stringify({
        phone: digits,
        token,
        userId: uid,
        expiresAt: Date.now() + Math.max(60, Number(expiresInSec) || 43200) * 1000,
      })
    );
    return readSession();
  }

  function clearSession() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {}
  }

  function authFields(extra = {}) {
    const session = readSession();
    if (!session) return { ...extra };
    return {
      ...extra,
      phone: session.phone,
      sessionToken: session.sessionToken,
    };
  }

  function appendAuthQuery(params) {
    const session = readSession();
    if (!session) return params;
    params.set("phone", session.phone);
    params.set("sessionToken", session.sessionToken);
    return params;
  }

  async function sendCode(phone) {
    const res = await fetch(`${AUTH_API}/send-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: normalizePhoneInput(phone) }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  async function verifyCode(phone, code) {
    const res = await fetch(`${AUTH_API}/verify-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: normalizePhoneInput(phone), code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, data };
    const saved = saveSession({
      phone: data.phone,
      sessionToken: data.sessionToken || data.verificationToken,
      userId: data.userId,
      expiresInSec: data.expiresInSec,
    });
    return { ok: Boolean(saved), status: res.status, data, session: saved };
  }

  function bindPanel({
    phoneInputId = "buyer-auth-phone",
    codeInputId = "buyer-auth-code",
    sendBtnId = "buyer-auth-send-btn",
    verifyBtnId = "buyer-auth-verify-btn",
    statusId = "buyer-auth-status",
    panelId = "buyer-auth-panel",
    onVerified = null,
  } = {}) {
    const phoneInput = document.getElementById(phoneInputId);
    const codeInput = document.getElementById(codeInputId);
    const sendBtn = document.getElementById(sendBtnId);
    const verifyBtn = document.getElementById(verifyBtnId);
    const statusNode = document.getElementById(statusId);
    const panel = document.getElementById(panelId);

    function setStatus(msg, isError = false) {
      if (!statusNode) return;
      statusNode.textContent = msg || "";
      statusNode.classList.toggle("text-red-600", isError);
      statusNode.classList.toggle("dark:text-red-400", isError);
      statusNode.classList.toggle("text-brand-green", !isError && Boolean(msg));
    }

    function syncPanelVisibility() {
      const session = readSession();
      if (!panel) return;
      if (session?.userId) {
        panel.classList.add("hidden");
        setStatus(`Signed in as buyer #${session.userId}.`);
      } else {
        panel.classList.remove("hidden");
      }
    }

    const existing = readSession();
    if (phoneInput && !phoneInput.value) {
      phoneInput.value = existing?.phone || localStorage.getItem(PHONE_KEY) || "";
    }
    syncPanelVisibility();

    sendBtn?.addEventListener("click", async () => {
      const phone = normalizePhoneInput(phoneInput?.value || "");
      if (!phone) {
        setStatus("Enter your WhatsApp number first.", true);
        return;
      }
      sendBtn.disabled = true;
      setStatus("Sending WhatsApp code...");
      try {
        const result = await sendCode(phone);
        if (!result.ok) {
          setStatus(result.data?.message || "Could not send code right now.", true);
          return;
        }
        setStatus(result.data?.message || "Code sent on WhatsApp.");
        codeInput?.focus();
      } catch {
        setStatus("Network error while sending code.", true);
      } finally {
        sendBtn.disabled = false;
      }
    });

    verifyBtn?.addEventListener("click", async () => {
      const phone = normalizePhoneInput(phoneInput?.value || "");
      const code = String(codeInput?.value || "").trim();
      if (!phone || !code) {
        setStatus("Enter phone and the 6-digit WhatsApp code.", true);
        return;
      }
      verifyBtn.disabled = true;
      setStatus("Verifying code...");
      try {
        const result = await verifyCode(phone, code);
        if (!result.ok) {
          setStatus(result.data?.message || "Could not verify code.", true);
          return;
        }
        setStatus(result.data?.message || "WhatsApp verified.");
        syncPanelVisibility();
        if (typeof onVerified === "function") onVerified(result.session, result.data);
      } catch {
        setStatus("Network error while verifying code.", true);
      } finally {
        verifyBtn.disabled = false;
      }
    });

    return { syncPanelVisibility, setStatus, readSession };
  }

  window.SokoniBuyerAuth = {
    readSession,
    saveSession,
    clearSession,
    authFields,
    appendAuthQuery,
    sendCode,
    verifyCode,
    bindPanel,
    normalizePhoneInput,
  };
})();
