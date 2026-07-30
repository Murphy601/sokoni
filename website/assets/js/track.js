(function () {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://127.0.0.1:3001/api/tracking"
      : "https://bot.sokonimall.com/api/tracking";
  const DISPUTES_API =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://127.0.0.1:3001/api/disputes"
      : "https://bot.sokonimall.com/api/disputes";

  const form = document.getElementById("track-form");
  const input = document.getElementById("order-id");
  const statusEl = document.getElementById("track-status");
  const disputeEl = document.getElementById("track-dispute");
  const errorEl = document.getElementById("track-error");
  const loadingEl = document.getElementById("track-loading");

  let currentOrderId = "";

  function normalizeOrderId(raw) {
    const t = String(raw || "").trim().toUpperCase();
    if (!t) return "";
    if (t.startsWith("SK-")) return t;
    const digits = t.replace(/\D/g, "");
    return digits ? `SK-${digits}` : t;
  }

  function formatKes(n) {
    return `KES ${Math.round(Number(n) || 0).toLocaleString()}`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderStepper(steps) {
    if (!steps?.length) return "";
    return `
      <ol class="track-stepper" aria-label="Shipment progress">
        ${steps
          .map((step) => {
            const state = step.done ? "done" : step.active ? "active" : "pending";
            return `
          <li class="track-step track-step--${state}">
            <span class="track-step-dot" aria-hidden="true"></span>
            <div class="track-step-body">
              <p class="track-step-label">${step.label}</p>
              ${step.active ? `<p class="track-step-hint">Current step</p>` : ""}
            </div>
          </li>`;
          })
          .join("")}
      </ol>`;
  }

  function renderHistory(history) {
    if (!history?.length) return "";
    const rows = history
      .slice()
      .reverse()
      .map(
        (h) =>
          `<li><span class="track-history-status">${h.label || h.status}</span>${h.hub ? ` · ${h.hub}` : ""}<time>${h.at ? new Date(h.at).toLocaleString() : ""}</time></li>`
      )
      .join("");
    return `
      <details class="track-history">
        <summary>Recent updates</summary>
        <ul>${rows}</ul>
      </details>`;
  }

  function renderDisputePanel(tracking) {
    if (!disputeEl) return;
    if (!tracking?.paid) {
      disputeEl.classList.add("hidden");
      disputeEl.innerHTML = "";
      return;
    }

    disputeEl.classList.remove("hidden");
    disputeEl.innerHTML = `
      <h2 class="font-display text-xl font-bold">Something wrong?</h2>
      <p class="text-sm text-brand-purple/65 dark:text-white/70">
        Open a dispute if the item never arrived, arrived damaged, or doesn’t match the listing.
        Escrow stays held while Sokoni reviews tracking + your note.
      </p>
      <div id="buyer-auth-panel" class="rounded-2xl border border-black/5 dark:border-white/10 p-4 space-y-3">
        <p class="text-sm font-semibold">Verify WhatsApp to open a dispute</p>
        <div class="flex flex-col sm:flex-row gap-2">
          <label class="flex-1 text-xs font-medium">
            WhatsApp number
            <input id="buyer-auth-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="07XXXXXXXX"
              class="mt-1 w-full min-h-[44px] rounded-2xl border border-black/10 dark:border-white/15 bg-white dark:bg-brand-purple px-3 text-sm" />
          </label>
          <label class="sm:w-36 text-xs font-medium">
            Code
            <input id="buyer-auth-code" type="text" inputmode="numeric" maxlength="6" placeholder="6 digits"
              class="mt-1 w-full min-h-[44px] rounded-2xl border border-black/10 dark:border-white/15 bg-white dark:bg-brand-purple px-3 text-sm" />
          </label>
        </div>
        <div class="flex flex-wrap gap-2">
          <button id="buyer-auth-send-btn" type="button" class="min-h-[44px] px-4 rounded-full border border-brand-purple/20 text-sm font-semibold">Send code</button>
          <button id="buyer-auth-verify-btn" type="button" class="min-h-[44px] px-4 rounded-full bg-brand-green text-brand-purple text-sm font-bold">Verify</button>
        </div>
        <p id="buyer-auth-status" class="text-xs text-brand-purple/60 dark:text-white/65"></p>
      </div>
      <form id="dispute-form" class="space-y-3">
        <label class="block text-sm font-medium">
          Reason
          <select id="dispute-reason" class="mt-1 w-full min-h-[48px] rounded-2xl border border-black/10 dark:border-white/15 bg-white dark:bg-brand-purple px-4 text-sm">
            <option value="not_received">Not delivered</option>
            <option value="damaged">Arrived damaged</option>
            <option value="not_as_described">Not as described</option>
            <option value="wrong_item">Wrong item</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label class="block text-sm font-medium">
          What happened
          <textarea id="dispute-statement" rows="3" maxlength="2000" placeholder="Short facts help — photos/tracking are attached for admin."
            class="mt-1 w-full rounded-2xl border border-black/10 dark:border-white/15 bg-white dark:bg-brand-purple px-4 py-3 text-sm"></textarea>
        </label>
        <button type="submit" id="dispute-submit" class="min-h-[48px] px-5 rounded-full bg-brand-green text-brand-purple text-sm font-bold">
          Open dispute
        </button>
        <p id="dispute-status" class="text-sm text-brand-purple/60 dark:text-white/65"></p>
      </form>`;

    window.SokoniBuyerAuth?.bindPanel?.({});

    document.getElementById("dispute-form")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const status = document.getElementById("dispute-status");
      const btn = document.getElementById("dispute-submit");
      const session = window.SokoniBuyerAuth?.readSession?.();
      if (!session?.userId) {
        if (status) status.textContent = "Verify WhatsApp above first.";
        return;
      }
      if (btn) btn.disabled = true;
      if (status) status.textContent = "Opening dispute…";
      try {
        const body = window.SokoniBuyerAuth?.authFields
          ? window.SokoniBuyerAuth.authFields({
              orderId: currentOrderId,
              buyerUserId: session.userId,
              reason: document.getElementById("dispute-reason")?.value || "other",
              statement: document.getElementById("dispute-statement")?.value || "",
            })
          : {
              orderId: currentOrderId,
              buyerUserId: session.userId,
              reason: document.getElementById("dispute-reason")?.value || "other",
              statement: document.getElementById("dispute-statement")?.value || "",
            };
        const res = await fetch(DISPUTES_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (status) status.textContent = data.message || data.error || "Could not open dispute.";
          return;
        }
        if (status) {
          status.textContent = `Dispute #${data.dispute?.id || ""} open — escrow held while Sokoni reviews.`;
          status.classList.add("text-brand-green");
        }
      } catch {
        if (status) status.textContent = "Network error. Try again or WhatsApp Sokoni.";
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  function renderTracking(data) {
    const t = data.tracking;
    if (!t) return;

    const stepper = renderStepper(t.shipmentTimeline);
    const history = renderHistory(t.history);
    currentOrderId = t.orderId || currentOrderId;

    statusEl.innerHTML = `
      <div class="track-panel space-y-5">
        <div class="track-header">
          <p class="track-kicker">Order</p>
          <p class="track-order-id">${escapeHtml(t.orderId)}</p>
          <p class="track-product">${escapeHtml(t.productName || "Sokoni order")}</p>
          ${t.totalKes != null ? `<p class="track-price">${formatKes(t.totalKes)}</p>` : ""}
          <p class="track-meta">${escapeHtml(t.paymentLine || "")}${t.fulfillment ? ` · ${escapeHtml(t.fulfillment)}` : ""}</p>
        </div>

        ${
          t.courier || t.trackingRef
            ? `<div class="track-courier">
                ${t.courier ? `<p>Courier: <strong>${escapeHtml(t.courier)}</strong></p>` : ""}
                ${t.trackingRef ? `<p>Ref: <strong>${escapeHtml(t.trackingRef)}</strong></p>` : ""}
              </div>`
            : ""
        }

        ${t.riderName ? `<p class="track-rider">Rider: ${escapeHtml(t.riderName)}${t.etaNote ? ` · ETA ${escapeHtml(t.etaNote)}` : ""}</p>` : ""}

        <div class="track-timeline-wrap">
          <p class="track-kicker">Shipment</p>
          ${stepper || `<p class="text-sm">Status: ${escapeHtml(t.shipmentStatusLabel || "Pending")}</p>`}
        </div>

        ${history}

        <p class="track-updated">Updated ${t.updatedAt ? new Date(t.updatedAt).toLocaleString() : "recently"}</p>

        ${
          !t.paid && t.orderId
            ? `<p class="pt-2"><a href="checkout.html?order=${encodeURIComponent(t.orderId)}" class="track-pay-btn">Pay order</a></p>`
            : t.paid
              ? `<p class="pt-2"><a href="checkout.html?order=${encodeURIComponent(t.orderId)}" class="track-pay-btn track-pay-btn--ghost">View receipt</a></p>`
              : ""
        }
      </div>
    `;
    statusEl.classList.remove("hidden");
    renderDisputePanel(t);
  }

  async function fetchTracking(orderId) {
    errorEl.classList.add("hidden");
    statusEl.classList.add("hidden");
    disputeEl?.classList.add("hidden");
    loadingEl.classList.remove("hidden");

    try {
      const res = await fetch(`${API_BASE}/${encodeURIComponent(orderId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error === "order_not_found" ? "Order not found. Check your SK-#### number." : "Could not load tracking.");
      }
      renderTracking(data);
    } catch (err) {
      errorEl.textContent = err.message || "Tracking unavailable. Try WhatsApp instead.";
      errorEl.classList.remove("hidden");
    } finally {
      loadingEl.classList.add("hidden");
    }
  }

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = normalizeOrderId(input.value);
    if (!id) return;
    input.value = id;
    const url = new URL(window.location.href);
    url.searchParams.set("order", id);
    window.history.replaceState({}, "", url);
    fetchTracking(id);
  });

  const params = new URLSearchParams(window.location.search);
  const preset = params.get("order");
  if (preset) {
    input.value = normalizeOrderId(preset);
    fetchTracking(input.value);
  }
})();
