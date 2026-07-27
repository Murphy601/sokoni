(function () {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:3001"
      : "https://bot.sokonimall.com";
  const CHECKOUT_API = `${API_BASE}/api/checkout`;

  const form = document.getElementById("checkout-lookup");
  const input = document.getElementById("order-id");
  const panel = document.getElementById("checkout-panel");
  const errorEl = document.getElementById("checkout-error");
  const loadingEl = document.getElementById("checkout-loading");
  const payBtn = document.getElementById("checkout-pay-btn");
  const payBlock = document.getElementById("checkout-pay-block");
  const statusEl = document.getElementById("checkout-status");

  let currentOrderId = null;

  function formatKes(n) {
    return `KES ${Math.round(Number(n) || 0).toLocaleString()}`;
  }

  function normalizeOrderId(raw) {
    const t = String(raw || "").trim().toUpperCase();
    if (!t) return "";
    if (t.startsWith("SK-")) return t;
    const digits = t.replace(/\D/g, "");
    return digits ? `SK-${digits}` : t;
  }

  function showError(msg) {
    errorEl.textContent = msg || "Something went wrong.";
    errorEl.classList.remove("hidden");
    panel.classList.add("hidden");
  }

  function hideError() {
    errorEl.classList.add("hidden");
  }

  function renderCheckout(data) {
    currentOrderId = data.orderId;
    document.getElementById("checkout-order-id").textContent = data.orderId;
    document.getElementById("checkout-product").textContent = data.productName || "Sokoni order";
    document.getElementById("checkout-total").textContent = formatKes(data.totalKes ?? data.amountKes);

    const trackLink = document.getElementById("checkout-track-link");
    if (trackLink) trackLink.href = `track.html?order=${encodeURIComponent(data.orderId)}`;

    const paid = data.paymentStatus === "confirmed";
    if (paid) {
      statusEl.textContent = "✅ Already paid — escrow held. Your order is being processed.";
      payBlock.classList.add("hidden");
    } else {
      statusEl.textContent = "💳 Payment required before dispatch.";
      payBlock.classList.remove("hidden");
    }

    panel.classList.remove("hidden");
  }

  async function loadOrder(orderId) {
    hideError();
    panel.classList.add("hidden");
    loadingEl.classList.remove("hidden");

    try {
      const res = await fetch(`${CHECKOUT_API}/${encodeURIComponent(orderId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error === "order_not_found" ? "Order not found. Check your SK-#### from WhatsApp." : "Could not load order.");
      }
      renderCheckout(data);
    } catch (err) {
      showError(err.message);
    } finally {
      loadingEl.classList.add("hidden");
    }
  }

  async function payOrder() {
    if (!currentOrderId) return;
    const phone = document.getElementById("checkout-phone")?.value.trim();
    if (!phone) {
      showError("Enter the M-Pesa phone number for STK push.");
      return;
    }
    hideError();
    payBtn.disabled = true;
    payBtn.textContent = "Sending STK…";

    try {
      const res = await fetch(`${CHECKOUT_API}/${encodeURIComponent(currentOrderId)}/stk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || "STK push failed. Try WhatsApp or pay till manually.");
      }
      statusEl.textContent = data.alreadyPaid
        ? "✅ Already paid."
        : "📱 STK sent — check your phone and enter M-Pesa PIN.";
      if (data.alreadyPaid) payBlock.classList.add("hidden");
    } catch (err) {
      showError(err.message);
    } finally {
      payBtn.disabled = false;
      payBtn.textContent = "Pay with M-Pesa";
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
    loadOrder(id);
  });

  payBtn?.addEventListener("click", payOrder);

  const params = new URLSearchParams(window.location.search);
  const preset = params.get("order");
  if (preset) {
    input.value = normalizeOrderId(preset);
    loadOrder(input.value);
  }
})();
