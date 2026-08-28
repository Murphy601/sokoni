(function () {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://127.0.0.1:3001"
      : "https://bot.sokonimall.com";
  const SUPPORT_API = `${API_BASE}/admin/support`;
  const TOKEN_KEY = "sokoni-admin-token";
  const POLL_MS = 4000;

  let activeThreadId = null;
  let activeKind = null;
  let pollTimer = null;
  let activeTab = "inbox";

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

  function formatKes(n) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    return `KES ${Number(n).toLocaleString()}`;
  }

  function threadBadge(kind) {
    if (kind === "general") {
      return `<span class="text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">General</span>`;
    }
    return `<span class="text-[10px] font-bold uppercase tracking-wide text-brand-purple/70 bg-brand-purple/10 px-1.5 py-0.5 rounded-full">Order</span>`;
  }

  function showTab(name) {
    activeTab = name;
    document.querySelectorAll(".desk-tab").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-tab") === name);
    });
    document.querySelectorAll("[data-panel]").forEach((panel) => {
      const match = panel.getAttribute("data-panel") === name;
      panel.classList.toggle("hidden", !match);
    });
    if (name === "orders") void loadOrdersDesk();
    if (name === "payments") void loadPaymentsDesk();
    if (name === "payouts") void loadPayoutsDesk();
  }

  function showActionResult(replies) {
    const box = el("action-result");
    if (!box) return;
    const text = (replies || []).join("\n\n---\n\n").trim();
    if (!text) {
      box.classList.add("hidden");
      box.textContent = "";
      return;
    }
    box.classList.remove("hidden");
    box.textContent = text;
  }

  function showCommandOutput(replies, fallback) {
    const box = el("command-output");
    if (!box) return;
    const text = (replies || []).join("\n\n---\n\n").trim() || fallback || "(no reply text)";
    box.textContent = text;
  }

  async function runCommand(command, { confirmBroadcast = true } = {}) {
    const cmd = String(command || "").trim();
    if (!cmd) return null;
    if (!token()) {
      setStatus("Enter admin token.", true);
      return null;
    }
    if (confirmBroadcast && /^#broadcast\b/i.test(cmd)) {
      const ok = window.confirm(
        "Broadcast this message to all customers (with offer footer + STOP opt-out)?"
      );
      if (!ok) return null;
    }
    try {
      const res = await fetch(`${SUPPORT_API}/command`, {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.message || data.error || "Command failed.", true);
        showCommandOutput(data.replies, data.message || data.error);
        showActionResult(data.replies || [data.message || data.error]);
        return data;
      }
      setStatus(`Ran ${cmd.split(/\s+/)[0]}`);
      showCommandOutput(data.replies);
      showActionResult(data.replies);
      return data;
    } catch {
      setStatus("Network error running command.", true);
      return null;
    }
  }

  function buildOrderCommand(action) {
    const id = activeThreadId;
    if (!id || activeKind === "general") return null;
    switch (action) {
      case "status": {
        const st = el("status-select")?.value || "confirmed";
        return `#status ${id} ${st}`;
      }
      case "payconfirm":
        return `#payconfirm ${id}`;
      case "fulfill":
        return `#fulfill ${id}`;
      case "fulfill-share":
        return `#fulfill ${id} share`;
      case "notify-store":
        return `#notify-store ${id}`;
      case "nearby":
        return `#nearby ${id}`;
      case "scan":
        return `#scan ${id}`;
      case "scan-extra": {
        const extra = el("scan-extra")?.value?.trim() || "";
        return `#scan ${id}${extra ? ` ${extra}` : ""}`;
      }
      case "paid":
        return `#paid ${id}`;
      case "payb2c":
        return `#payb2c ${id}`;
      case "apolog":
        return `#apolog ${id}`;
      case "damage":
        return `#damage ${id}`;
      case "recover":
        return `#recover ${id}`;
      case "delay":
        return `#delay ${id} later today`;
      case "oos":
        return `#oos ${id}`;
      case "transit": {
        const extra = el("transit-extra")?.value?.trim() || "";
        return `#transit ${id}${extra ? ` ${extra}` : ""}`;
      }
      case "pickup": {
        const pp = el("pickup-id")?.value?.trim();
        if (!pp) {
          setStatus("Enter pickup point id (pp-xxxx).", true);
          return null;
        }
        return `#pickup ${id} ${pp}`;
      }
      default:
        return null;
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
      const threads = Array.isArray(data.threads)
        ? data.threads
        : (Array.isArray(data.orders) ? data.orders : []).map((o) => ({
            threadId: o.orderId,
            kind: "order",
            ...o,
            label: o.productName || o.orderId,
          }));
      if (activeTab === "inbox") {
        setStatus(`${threads.length} open thread${threads.length === 1 ? "" : "s"}`);
      }
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
      activeKind = kind;
      el("active-order").textContent =
        kind === "general"
          ? data.threadId || data.orderId || threadId
          : data.orderId || threadId;
      el("active-meta").textContent = [
        kind === "general" ? "General handoff" : data.lifecycle,
        data.displayName || data.productName,
        data.dropOff ? `→ ${data.dropOff}` : null,
        data.buyerPhone ? `+${data.buyerPhone}` : null,
        data.order?.statusLabel ? `status ${data.order.statusLabel}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      el("resolve-btn")?.classList.toggle(
        "hidden",
        !(data.adminTakeOver || data.disputeHold || kind === "general")
      );
      el("order-actions")?.classList.toggle("hidden", kind !== "order");
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

  function renderOrdersTable(orders, containerId, { payconfirm = false } = {}) {
    const box = el(containerId);
    if (!box) return;
    if (!orders?.length) {
      box.innerHTML = `<p class="text-brand-purple/55">None right now.</p>`;
      return;
    }
    box.innerHTML = `<table class="w-full text-left">
      <thead><tr class="text-xs uppercase tracking-wide text-brand-purple/45 border-b border-black/5">
        <th class="py-2 pr-2">Order</th><th class="py-2 pr-2">Status</th><th class="py-2 pr-2">Customer</th><th class="py-2 pr-2">Amount</th><th class="py-2">Actions</th>
      </tr></thead>
      <tbody>${orders
        .map((o) => {
          const id = escapeHtml(o.id);
          return `<tr class="border-b border-black/5 align-top">
            <td class="py-2 pr-2 font-bold">${id}<br/><span class="font-normal text-brand-purple/55 text-xs">${escapeHtml(o.productName || "")}</span></td>
            <td class="py-2 pr-2 text-xs">${escapeHtml(o.statusLabel || o.status || "")}</td>
            <td class="py-2 pr-2 text-xs">${escapeHtml(o.customerName || "")}<br/>${escapeHtml(o.phone || "")}</td>
            <td class="py-2 pr-2 text-xs">${escapeHtml(formatKes(o.buyerTotalKes ?? o.priceKes))}</td>
            <td class="py-2">
              <div class="flex flex-wrap gap-1">
                <button type="button" data-open="${id}" class="desk-open min-h-[36px] px-2 rounded-full border border-black/10 text-[11px] font-semibold">Open</button>
                ${
                  payconfirm
                    ? `<button type="button" data-run="#payconfirm ${id}" class="desk-run min-h-[36px] px-2 rounded-full bg-brand-green text-brand-purple text-[11px] font-bold">Payconfirm</button>`
                    : `<button type="button" data-run="#status ${id} confirmed" class="desk-run min-h-[36px] px-2 rounded-full border border-black/10 text-[11px] font-semibold">Confirm</button>
                       <button type="button" data-run="#fulfill ${id}" class="desk-run min-h-[36px] px-2 rounded-full border border-black/10 text-[11px] font-semibold">Fulfill</button>`
                }
              </div>
            </td>
          </tr>`;
        })
        .join("")}</tbody></table>`;
    box.querySelectorAll(".desk-open").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeThreadId = btn.getAttribute("data-open");
        showTab("inbox");
        void loadThread(activeThreadId);
        void loadList();
      });
    });
    box.querySelectorAll(".desk-run").forEach((btn) => {
      btn.addEventListener("click", () => {
        void runCommand(btn.getAttribute("data-run")).then(() => {
          if (activeTab === "orders") void loadOrdersDesk();
          if (activeTab === "payments") void loadPaymentsDesk();
          if (activeTab === "payouts") void loadPayoutsDesk();
        });
      });
    });
  }

  async function loadOrdersDesk() {
    if (!token()) return;
    try {
      const res = await fetch(`${SUPPORT_API}/desk/orders`, { headers: adminHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.message || data.error || "Could not load orders.", true);
        return;
      }
      renderOrdersTable(data.orders || [], "orders-table");
    } catch {
      setStatus("Network error loading orders.", true);
    }
  }

  async function loadPaymentsDesk() {
    if (!token()) return;
    try {
      const res = await fetch(`${SUPPORT_API}/desk/payments`, { headers: adminHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.message || data.error || "Could not load payments.", true);
        return;
      }
      if (el("payments-note")) el("payments-note").textContent = data.message || "";
      renderOrdersTable(data.orders || [], "payments-table", { payconfirm: true });
    } catch {
      setStatus("Network error loading payments.", true);
    }
  }

  async function loadPayoutsDesk() {
    if (!token()) return;
    try {
      const res = await fetch(`${SUPPORT_API}/desk/payouts`, { headers: adminHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.message || data.error || "Could not load payouts.", true);
        return;
      }
      const summary = el("payouts-summary");
      if (summary) {
        summary.innerHTML = `
          <article class="rounded-2xl border border-black/5 p-3"><p class="text-[11px] uppercase text-brand-purple/45">Owed</p><p class="font-display text-xl font-bold">${escapeHtml(formatKes(data.totalOwedKes))} <span class="text-sm font-sans font-normal">(${escapeHtml(String(data.count ?? 0))})</span></p></article>
          <article class="rounded-2xl border border-black/5 p-3"><p class="text-[11px] uppercase text-brand-purple/45">Admin queue</p><p class="font-display text-xl font-bold">${escapeHtml(formatKes(data.totalQueuedKes))} <span class="text-sm font-sans font-normal">(${escapeHtml(String(data.queuedCount ?? 0))})</span></p></article>
          <article class="rounded-2xl border border-black/5 p-3"><p class="text-[11px] uppercase text-brand-purple/45">Failed B2C</p><p class="font-display text-xl font-bold">${escapeHtml(String(data.failedCount ?? 0))}</p></article>`;
      }
      const list = []
        .concat(
          (data.entries || []).map((e) => ({ ...e, _bucket: "owed" })),
          (data.queued || []).map((e) => ({ ...e, _bucket: "queued" })),
          (data.failed || []).map((e) => ({ ...e, _bucket: "failed" })),
          (data.disbursing || []).map((e) => ({ ...e, _bucket: "disbursing" }))
        )
        .slice(0, 40);
      const box = el("payouts-table");
      if (!box) return;
      if (!list.length) {
        box.innerHTML = `<p class="text-brand-purple/55 text-sm">No supplier payouts owed right now. Use Commands → <code>#payouts</code> for the WhatsApp text view.</p>`;
        return;
      }
      box.innerHTML = `<table class="w-full text-left">
        <thead><tr class="text-xs uppercase tracking-wide text-brand-purple/45 border-b border-black/5">
          <th class="py-2 pr-2">Order</th><th class="py-2 pr-2">Seller</th><th class="py-2 pr-2">Amount</th><th class="py-2 pr-2">State</th><th class="py-2">Actions</th>
        </tr></thead>
        <tbody>${list
          .map((row) => {
            const id = escapeHtml(row.orderId || row.id || "");
            const paidTarget = escapeHtml(row.withdrawId || row.orderId || row.id || "");
            const amt = formatKes(row.payoutAmountKes ?? row.netKes ?? row.amountKes);
            return `<tr class="border-b border-black/5">
              <td class="py-2 pr-2 font-bold text-xs">${id}<br/><span class="font-normal text-brand-purple/50">${escapeHtml(row.productName || "")}</span></td>
              <td class="py-2 pr-2 text-xs">${escapeHtml(row.supplierName || row.sellerName || "")}</td>
              <td class="py-2 pr-2 text-xs">${escapeHtml(amt)}</td>
              <td class="py-2 pr-2 text-xs">${escapeHtml(row._bucket || row.status || "")}</td>
              <td class="py-2"><div class="flex flex-wrap gap-1">
                <button type="button" data-run="#paid ${paidTarget}" class="desk-run min-h-[36px] px-2 rounded-full border border-black/10 text-[11px] font-semibold">#paid</button>
                <button type="button" data-run="#payb2c ${id}" class="desk-run min-h-[36px] px-2 rounded-full border border-black/10 text-[11px] font-semibold">#payb2c</button>
              </div></td>
            </tr>`;
          })
          .join("")}</tbody></table>`;
      box.querySelectorAll(".desk-run").forEach((btn) => {
        btn.addEventListener("click", () => {
          void runCommand(btn.getAttribute("data-run")).then(() => void loadPayoutsDesk());
        });
      });
    } catch {
      setStatus("Network error loading payouts.", true);
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (activeTab !== "inbox") return;
      void loadList();
      if (activeThreadId) void loadThread(activeThreadId);
    }, POLL_MS);
  }

  stripTokenFromUrl();
  if (el("admin-token") && !el("admin-token").value) {
    el("admin-token").value = localStorage.getItem(TOKEN_KEY) || "";
  }

  document.querySelectorAll(".desk-tab").forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.getAttribute("data-tab")));
  });

  el("refresh-btn")?.addEventListener("click", () => {
    if (activeTab === "inbox") {
      void loadList();
      if (activeThreadId) void loadThread(activeThreadId);
    } else if (activeTab === "orders") void loadOrdersDesk();
    else if (activeTab === "payments") void loadPaymentsDesk();
    else if (activeTab === "payouts") void loadPayoutsDesk();
  });
  el("orders-refresh")?.addEventListener("click", () => void loadOrdersDesk());
  el("payments-refresh")?.addEventListener("click", () => void loadPaymentsDesk());
  el("payouts-refresh")?.addEventListener("click", () => void loadPayoutsDesk());
  el("reply-form")?.addEventListener("submit", sendReply);
  el("resolve-btn")?.addEventListener("click", resolveThread);
  el("admin-token")?.addEventListener("change", () => {
    localStorage.setItem(TOKEN_KEY, token());
    void loadList();
  });

  document.querySelectorAll(".order-act").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cmd = buildOrderCommand(btn.getAttribute("data-cmd"));
      if (!cmd) return;
      void runCommand(cmd).then(() => {
        if (activeThreadId) void loadThread(activeThreadId);
      });
    });
  });

  el("command-form")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const input = el("command-input");
    const cmd = input?.value?.trim();
    if (!cmd) return;
    void runCommand(cmd).then((data) => {
      if (data?.ok && input) input.value = "";
    });
  });

  document.querySelectorAll(".cmd-quick").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cmd = btn.getAttribute("data-quick");
      if (el("command-input")) el("command-input").value = cmd;
      void runCommand(cmd);
    });
  });

  el("broadcast-form")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const msg = el("broadcast-input")?.value?.trim();
    if (!msg) return;
    void runCommand(`#broadcast ${msg}`).then((data) => {
      if (data?.ok && el("broadcast-input")) el("broadcast-input").value = "";
    });
  });

  void loadList();
  startPolling();
})();
