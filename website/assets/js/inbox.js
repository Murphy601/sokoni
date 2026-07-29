const API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001"
    : "https://bot.sokonimall.com";

const SOCIAL_API = `${API_BASE}/api/social`;
const SELLER_PHONE_KEY = "sokoni-seller-phone";
const SELLER_VERIFY_TOKEN_KEY = "sokoni-seller-verify-token";

const state = {
  viewerId: null,
  peerId: null,
  peerHandle: "",
  pollTimer: null,
  sellerAuthRequired: false,
  sellerSession: null,
};

function el(id) {
  return document.getElementById(id);
}

function normalizeHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function formatHandle(value) {
  const clean = normalizeHandle(value);
  return clean ? `@${clean}` : "";
}

function parsePositiveInt(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function normalizePhoneInput(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9) d = `254${d}`;
  return d;
}

function isSellerSessionAuthError(payload) {
  const code = String(payload?.error || "")
    .trim()
    .toLowerCase();
  return code === "session_required" || code === "session_invalid" || code === "session_expired";
}

function isSellerAuthQueryFlag(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "seller";
}

function readSellerSessionFromStorage() {
  try {
    const raw = sessionStorage.getItem(SELLER_VERIFY_TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const token = String(parsed?.token || "").trim();
    const expiresAt = Number(parsed?.expiresAt || 0);
    if (!token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    const phone = normalizePhoneInput(parsed?.phone || localStorage.getItem(SELLER_PHONE_KEY) || "");
    if (!phone) return null;
    return { phone, sessionToken: token };
  } catch {
    return null;
  }
}

function disableChatComposer() {
  el("chat-form")?.classList.add("opacity-60");
  const input = el("chat-input");
  const sendBtn = el("chat-send-btn");
  if (input) input.disabled = true;
  if (sendBtn) sendBtn.disabled = true;
}

function setStatus(msg, isError = false) {
  const node = el("inbox-status");
  if (!node) return;
  node.textContent = msg || "";
  node.classList.toggle("text-red-600", isError);
  node.classList.toggle("dark:text-red-400", isError);
  node.classList.toggle("text-brand-green", !isError && Boolean(msg));
}

function setPeerLabel() {
  const label = el("chat-peer-label");
  if (!label) return;
  const handle = formatHandle(state.peerHandle);
  label.textContent = handle || `User #${state.peerId || "?"}`;
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function messageBubble(msg) {
  const mine = Number(msg.senderUserId) === state.viewerId;
  const wrapper = mine ? "items-end" : "items-start";
  const bubble = mine
    ? "bg-brand-green text-brand-purple rounded-2xl rounded-br-sm"
    : "bg-white dark:bg-brand-purpleLight/55 text-brand-purple dark:text-white rounded-2xl rounded-bl-sm border border-black/5 dark:border-white/10";
  const who = mine ? "You" : (formatHandle(state.peerHandle) || `User #${state.peerId}`);

  return `
    <div class="flex flex-col ${wrapper} gap-1">
      <p class="text-[11px] text-brand-purple/50 dark:text-white/55">${who}</p>
      <div class="max-w-[85%] px-3 py-2 text-sm leading-relaxed ${bubble}">
        ${String(msg.content || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")}
      </div>
      <p class="text-[10px] text-brand-purple/45 dark:text-white/45">${formatTime(msg.createdAt)}</p>
    </div>`;
}

function renderMessages(messages) {
  const wrap = el("chat-thread");
  const empty = el("chat-empty");
  if (!wrap || !empty) return;

  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) {
    wrap.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");
  wrap.innerHTML = list.map(messageBubble).join("");
  wrap.scrollTop = wrap.scrollHeight;
}

function isBuyerSessionAuthError(payload) {
  const code = String(payload?.error || "")
    .trim()
    .toLowerCase();
  return (
    code === "session_required" ||
    code === "session_invalid" ||
    code === "session_expired" ||
    code === "buyer_session_mismatch"
  );
}

function resolveViewerId() {
  if (state.sellerAuthRequired) {
    return parsePositiveInt(
      new URLSearchParams(window.location.search).get("viewer") ||
        new URLSearchParams(window.location.search).get("viewerUserId")
    );
  }
  const sessionUserId = window.SokoniBuyerAuth?.readSession?.()?.userId;
  if (Number.isInteger(sessionUserId) && sessionUserId > 0) return sessionUserId;
  return parsePositiveInt(
    new URLSearchParams(window.location.search).get("viewer") ||
      new URLSearchParams(window.location.search).get("viewerUserId")
  );
}

async function loadThread() {
  if (!state.viewerId || !state.peerId) return;
  try {
    const params = new URLSearchParams({
      userAId: String(state.viewerId),
      userBId: String(state.peerId),
      limit: "80",
    });
    if (state.sellerAuthRequired && state.sellerSession?.phone && state.sellerSession?.sessionToken) {
      params.set("phone", state.sellerSession.phone);
      params.set("sessionToken", state.sellerSession.sessionToken);
    } else if (window.SokoniBuyerAuth?.appendAuthQuery) {
      window.SokoniBuyerAuth.appendAuthQuery(params);
    }
    const url = `${SOCIAL_API}/chat/thread?${params.toString()}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401 && isSellerSessionAuthError(data)) {
        setStatus(data?.message || "Seller session imeexpire - rudi dashboard uverify tena.", true);
        return;
      }
      if (isBuyerSessionAuthError(data)) {
        setStatus(data?.message || "Verify your WhatsApp above to open this chat.", true);
        return;
      }
      setStatus(data?.message || data?.error || "Could not load inbox thread.", true);
      return;
    }
    renderMessages(data.messages || []);
  } catch {
    setStatus("Could not load chat right now. Check your connection.", true);
  }
}

async function sendMessage(text) {
  const body = String(text || "").trim();
  if (!body || !state.viewerId || !state.peerId) return;

  const btn = el("chat-send-btn");
  if (btn) btn.disabled = true;
  try {
    let payload = {
      senderUserId: state.viewerId,
      receiverUserId: state.peerId,
      content: body,
    };
    if (state.sellerAuthRequired && state.sellerSession?.phone && state.sellerSession?.sessionToken) {
      payload.phone = state.sellerSession.phone;
      payload.sessionToken = state.sellerSession.sessionToken;
    } else if (window.SokoniBuyerAuth?.authFields) {
      payload = window.SokoniBuyerAuth.authFields(payload);
    }
    const res = await fetch(`${SOCIAL_API}/chat/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401 && isSellerSessionAuthError(data)) {
        setStatus(data?.message || "Seller session imeexpire - rudi dashboard uverify tena.", true);
        return;
      }
      if (isBuyerSessionAuthError(data)) {
        setStatus(data?.message || "Verify your WhatsApp above to send messages.", true);
        return;
      }
      setStatus(data?.message || data?.error || "Message not sent.", true);
      return;
    }
    setStatus("");
    await loadThread();
  } catch {
    setStatus("Could not send message right now.", true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function parseQuery() {
  const params = new URLSearchParams(window.location.search);
  state.peerId = parsePositiveInt(params.get("with") || params.get("peer") || params.get("receiver"));
  state.peerHandle = normalizeHandle(params.get("handle") || "");
  state.sellerAuthRequired = isSellerAuthQueryFlag(params.get("sellerAuth"));
  state.sellerSession = state.sellerAuthRequired ? readSellerSessionFromStorage() : null;
  state.viewerId = resolveViewerId();
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(loadThread, 7000);
}

function hideBuyerAuthPanel() {
  el("buyer-auth-panel")?.classList.add("hidden");
}

function init() {
  parseQuery();
  setPeerLabel();

  if (state.sellerAuthRequired) {
    hideBuyerAuthPanel();
  } else {
    window.SokoniBuyerAuth?.bindPanel?.({
      onVerified: () => {
        state.viewerId = resolveViewerId();
        setPeerLabel();
        if (state.viewerId && state.peerId && state.viewerId !== state.peerId) {
          setStatus("WhatsApp verified — you can chat now.");
          loadThread();
          startPolling();
        }
      },
    });
  }

  if (!state.viewerId || !state.peerId || state.viewerId === state.peerId) {
    setStatus(
      state.sellerAuthRequired
        ? "Open this page from a shop profile with valid viewer and seller IDs."
        : "Verify your WhatsApp above, or open this page from a shop with a valid seller ID.",
      true
    );
    disableChatComposer();
    return;
  }

  if (state.sellerAuthRequired && (!state.sellerSession?.phone || !state.sellerSession?.sessionToken)) {
    setStatus("Seller session missing - rudi seller dashboard uverify WhatsApp tena.", true);
    disableChatComposer();
    return;
  }

  const form = el("chat-form");
  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const input = el("chat-input");
    const text = input?.value || "";
    if (!text.trim()) return;
    input.value = "";
    await sendMessage(text);
  });

  loadThread();
  startPolling();
}

document.addEventListener("DOMContentLoaded", init);
