(function () {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://127.0.0.1:3001"
      : "https://bot.sokonimall.com";
  const SUPPORT_API = `${API_BASE}/admin/support`;
  const TOKEN_KEY = "sokoni-admin-token";
  const POLL_MS = 4000;

  let activeOrderId = null;
  let pollTimer = null;

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function token() {
    return el("admin-token")?.value?.trim() || localStorage.getItem(TOKEN_KEY) || "";
  }

  function adminHeaders(extra = {}) {
    const t = token();
    return {
      ...(t ? { "X-Admin-Token": t } : {}),
      ...extra,
    };
  }

  function setStatus(message, isError = false) {
    const node = el("admin-status");
    if (!node) return;
    node.textContent = message || "";
    node.classList.toggle("text-red-600", isError);
    node.classList.toggle("text-emerald-700", !isError && Boolean(message));
  }

  function stripTokenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("token")) return;
    const t = params.get("token");
    if (t && el("admin-token")) el("admin-token").value = t;
    params.delete("token");
    const q = params.toString();
    try {
      history.replaceState({}, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
    } catch {
      /* ignore */
    }
  }

  function formatTime(ts) {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleString("en-KE", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
    } catch {
      return "";
    }
  }

  async function loadList() {
    const t = token();
    if (!t) {
      setStatus("Enter admin token.", true);
      return;
    }
    localStorage.setItem(TOKEN_KEY, t);
    try {
      const res = await fetch(`${SUPPORT_API}/orders`, { headers: adminHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.message || data.error || "Could not load inbox.", true);
        return;
      }
      const orders = Array.isArray(data.orders) ? data.orders : [];
      setStatus(`${orders.length} open thread${orders.length === 1 ? "" : "s"}`);
      const list = el("support-list");
      if (!list) return;
      if (!orders.length) {
        list.innerHTML = `<p class="text-brand-purple/55">No ADMIN_TAKE_OVER threads right now.</p>`;
        return;
      }
      list.innerHTML = orders
        .map((o) => {
          const active = o.orderId === activeOrderId ? " ring-2 ring-brand-green" : "";
          return `<button type="button" data-order="${escapeHtml(o.orderId)}" class="w-full text-left rounded-2xl border border-black/10 px-3 py-2 hover:border-brand-green${active}">
            <p class="font-bold">${escapeHtml(o.orderId)}</p>
            <p class="text-xs text-brand-purple/55 truncate">${escapeHtml(o.productName || "Order")} · ${escapeHtml(o.lifecycle)}</p>
          </button>`;
        })
        .join("");
      list.querySelectorAll("[data-order]").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeOrderId = btn.getAttribute("data-order");
          void loadThread(activeOrderId);
          void loadList();
        });
      });
    } catch {
      setStatus("Network error loading inbox.", true);
    }
  }

  function renderMessages(messages) {
    const box = el("chat-messages");
    if (!box) return;
    if (!messages?.length) {
      box.innerHTML = `<p class="text-white/50">No messages yet — waiting for buyer/seller WhatsApp.</p>`;
      return;
    }
    box.innerHTML = messages
      .map((m) => {
        const mine = m.role === "ADMIN" || m.direction === "outbound";
        const sys = m.direction === "system";
        const color = sys ? "text-amber-300" : mine ? "text-brand-green" : "text-white";
        return `<p class="${color}"><strong>${escapeHtml(m.role || "?")}</strong>
          <span class="text-white/40 text-xs">${escapeHtml(formatTime(m.at))}</span><br/>
          ${escapeHtml(m.text || "")}</p>`;
      })
      .join("");
    box.scrollTop = box.scrollHeight;
  }

  async function loadThread(orderId) {
    if (!orderId || !token()) return;
    try {
      const res = await fetch(`${SUPPORT_API}/${encodeURIComponent(orderId)}`, { headers: adminHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.message || data.error || "Could not load thread.", true);
        return;
      }
      el("active-order").textContent = data.orderId || orderId;
      el("active-meta").textContent = [
        data.lifecycle,
        data.productName,
        data.dropOff ? `→ ${data.dropOff}` : null,
        data.buyerPhone ? `+${data.buyerPhone}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      el("resolve-btn")?.classList.toggle("hidden", !data.adminTakeOver && !data.disputeHold);
      el("admin-input").disabled = false;
      el("send-btn").disabled = false;
      renderMessages(data.messages);
    } catch {
      setStatus("Network error loading thread.", true);
    }
  }

  async function sendReply(ev) {
    ev?.preventDefault();
    if (!activeOrderId) return;
    const input = el("admin-input");
    const message = input?.value?.trim();
    if (!message) return;
    el("send-btn").disabled = true;
    try {
      const res = await fetch(`${SUPPORT_API}/${encodeURIComponent(activeOrderId)}/reply`, {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.message || data.error || "Send failed.", true);
        return;
      }
      input.value = "";
      setStatus("Sent to WhatsApp.");
      renderMessages(data.thread?.messages || []);
    } catch {
      setStatus("Network error sending reply.", true);
    } finally {
      el("send-btn").disabled = false;
    }
  }

  async function resolveThread() {
    if (!activeOrderId) return;
    try {
      const res = await fetch(`${SUPPORT_API}/${encodeURIComponent(activeOrderId)}/resolve`, {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ note: "resolved via support inbox" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.message || data.error || "Resolve failed.", true);
        return;
      }
      setStatus(`Resolved ${activeOrderId} — bot resumed.`);
      void loadThread(activeOrderId);
      void loadList();
    } catch {
      setStatus("Network error resolving.", true);
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      void loadList();
      if (activeOrderId) void loadThread(activeOrderId);
    }, POLL_MS);
  }

  stripTokenFromUrl();
  if (el("admin-token") && !el("admin-token").value) {
    el("admin-token").value = localStorage.getItem(TOKEN_KEY) || "";
  }
  el("refresh-btn")?.addEventListener("click", () => {
    void loadList();
    if (activeOrderId) void loadThread(activeOrderId);
  });
  el("reply-form")?.addEventListener("submit", sendReply);
  el("resolve-btn")?.addEventListener("click", resolveThread);
  el("admin-token")?.addEventListener("change", () => {
    localStorage.setItem(TOKEN_KEY, token());
    void loadList();
  });

  void loadList();
  startPolling();
})();
