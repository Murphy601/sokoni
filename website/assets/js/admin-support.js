(function () {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://127.0.0.1:3001"
      : "https://bot.sokonimall.com";
  const SUPPORT_API = `${API_BASE}/admin/support`;
  const TOKEN_KEY = "sokoni-admin-token";
  const POLL_MS = 4000;

  let activeThreadId = null;
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
      return new Date(ts).toLocaleString("en-KE", {
        hour: "2-digit",
        minute: "2-digit",
        day: "numeric",
        month: "short",
      });
    } catch {
      return "";
    }
  }

  function threadBadge(kind) {
    if (kind === "general") {
      return `<span class="text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">General</span>`;
    }
    return `<span class="text-[10px] font-bold uppercase tracking-wide text-brand-purple/70 bg-brand-purple/10 px-1.5 py-0.5 rounded-full">Order</span>`;
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
      const threads = Array.isArray(data.threads)
        ? data.threads
        : (Array.isArray(data.orders) ? data.orders : []).map((o) => ({
            threadId: o.orderId,
            kind: "order",
            ...o,
            label: o.productName || o.orderId,
          }));
      setStatus(`${threads.length} open thread${threads.length === 1 ? "" : "s"}`);
      const list = el("support-list");
      if (!list) return;
      if (!threads.length) {
        list.innerHTML = `<p class="text-brand-purple/55">No open threads. Order HELP and “Talk to a Human” requests show here.</p>`;
        return;
      }
      list.innerHTML = threads
        .map((o) => {
          const id = o.threadId || o.orderId;
          const active = id === activeThreadId ? " ring-2 ring-brand-green" : "";
          const title = o.kind === "general" ? id : o.orderId || id;
          const sub =
            o.kind === "general"
              ? `${o.label || "Customer"} · ${o.lastMessage || "Human handoff"}`
              : `${o.productName || "Order"} · ${o.lifecycle || ""}`;
          return `<button type="button" data-thread="${escapeHtml(id)}" class="w-full text-left rounded-2xl border border-black/10 px-3 py-2 hover:border-brand-green${active}">
            <div class="flex items-center justify-between gap-2">
              <p class="font-bold truncate">${escapeHtml(title)}</p>
              ${threadBadge(o.kind || "order")}
            </div>
            <p class="text-xs text-brand-purple/55 truncate mt-0.5">${escapeHtml(sub)}</p>
          </button>`;
        })
        .join("");
      list.querySelectorAll("[data-thread]").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeThreadId = btn.getAttribute("data-thread");
          void loadThread(activeThreadId);
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
      box.innerHTML = `<p class="text-white/50">No messages yet — waiting for WhatsApp.</p>`;
      return;
    }
    box.innerHTML = messages
      .map((m) => {
        const mine = m.role === "ADMIN" || m.direction === "outbound";
        const sys = m.direction === "system" || m.role === "SYSTEM";
        const color = sys ? "text-amber-300" : mine ? "text-brand-green" : "text-white";
        return `<p class="${color}"><strong>${escapeHtml(m.role || "?")}</strong>
          <span class="text-white/40 text-xs">${escapeHtml(formatTime(m.at))}</span><br/>
          ${escapeHtml(m.text || "")}</p>`;
      })
      .join("");
    box.scrollTop = box.scrollHeight;
  }

  async function loadThread(threadId) {
    if (!threadId || !token()) return;
    try {
      const res = await fetch(`${SUPPORT_API}/${encodeURIComponent(threadId)}`, {
        headers: adminHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.message || data.error || "Could not load thread.", true);
        return;
      }
      const kind = data.kind || "order";
      el("active-order").textContent =
        kind === "general"
          ? data.threadId || data.orderId || threadId
          : data.orderId || threadId;
      el("active-meta").textContent = [
        kind === "general" ? "General handoff" : data.lifecycle,
        data.displayName || data.productName,
        data.dropOff ? `→ ${data.dropOff}` : null,
        data.buyerPhone ? `+${data.buyerPhone}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      el("resolve-btn")?.classList.toggle(
        "hidden",
        !(data.adminTakeOver || data.disputeHold || kind === "general")
      );
      el("admin-input").disabled = false;
      el("admin-input").placeholder =
        kind === "general" ? "Type reply to their WhatsApp…" : "Type reply to buyer WhatsApp…";
      el("send-btn").disabled = false;
      renderMessages(data.messages);
    } catch {
      setStatus("Network error loading thread.", true);
    }
  }

  async function sendReply(ev) {
    ev?.preventDefault();
    if (!activeThreadId) return;
    const input = el("admin-input");
    const message = input?.value?.trim();
    if (!message) return;
    el("send-btn").disabled = true;
    try {
      const res = await fetch(`${SUPPORT_API}/${encodeURIComponent(activeThreadId)}/reply`, {
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
      const who = [];
      if (data.notified?.buyer) who.push("customer");
      if (data.notified?.seller) who.push("seller");
      setStatus(who.length ? `Sent on WhatsApp → ${who.join(" + ")}.` : "Sent to WhatsApp.");
      renderMessages(data.thread?.messages || []);
    } catch {
      setStatus("Network error sending reply.", true);
    } finally {
      el("send-btn").disabled = false;
    }
  }

  async function resolveThread() {
    if (!activeThreadId) return;
    try {
      const res = await fetch(`${SUPPORT_API}/${encodeURIComponent(activeThreadId)}/resolve`, {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ note: "resolved via support inbox" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.message || data.error || "Resolve failed.", true);
        return;
      }
      setStatus(`Resolved ${activeThreadId} — bot resumed.`);
      void loadThread(activeThreadId);
      void loadList();
    } catch {
      setStatus("Network error resolving.", true);
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      void loadList();
      if (activeThreadId) void loadThread(activeThreadId);
    }, POLL_MS);
  }

  stripTokenFromUrl();
  if (el("admin-token") && !el("admin-token").value) {
    el("admin-token").value = localStorage.getItem(TOKEN_KEY) || "";
  }
  el("refresh-btn")?.addEventListener("click", () => {
    void loadList();
    if (activeThreadId) void loadThread(activeThreadId);
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
