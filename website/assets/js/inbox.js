const API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001"
    : "https://bot.sokonimall.com";

const SOCIAL_API = `${API_BASE}/api/social`;

const state = {
  viewerId: null,
  peerId: null,
  peerHandle: "",
  pollTimer: null,
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

async function loadThread() {
  if (!state.viewerId || !state.peerId) return;
  try {
    const url = `${SOCIAL_API}/chat/thread?userAId=${encodeURIComponent(state.viewerId)}&userBId=${encodeURIComponent(
      state.peerId
    )}&limit=80`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) {
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
    const res = await fetch(`${SOCIAL_API}/chat/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderUserId: state.viewerId,
        receiverUserId: state.peerId,
        content: body,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
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
  state.viewerId = parsePositiveInt(params.get("viewer") || params.get("viewerUserId"));
  state.peerId = parsePositiveInt(params.get("with") || params.get("peer") || params.get("receiver"));
  state.peerHandle = normalizeHandle(params.get("handle") || "");
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(loadThread, 7000);
}

function init() {
  parseQuery();
  setPeerLabel();

  if (!state.viewerId || !state.peerId || state.viewerId === state.peerId) {
    setStatus("Open this page from a shop profile with valid viewer and seller IDs.", true);
    el("chat-form")?.classList.add("opacity-60");
    const input = el("chat-input");
    const sendBtn = el("chat-send-btn");
    if (input) input.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
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
