(function () {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:3001"
      : "https://bot.sokonimall.com";
  const CHECKOUT_API = `${API_BASE}/api/checkout`;
  const SOCIAL_API = `${API_BASE}/api/social`;
  const POLL_MS = 3000;
  const POLL_MAX = 20;

  const form = document.getElementById("checkout-lookup");
  const input = document.getElementById("order-id");
  const panel = document.getElementById("checkout-panel");
  const errorEl = document.getElementById("checkout-error");
  const loadingEl = document.getElementById("checkout-loading");
  const payBtn = document.getElementById("checkout-pay-btn");
  const payBlock = document.getElementById("checkout-pay-block");
  const tillBlock = document.getElementById("checkout-till-block");
  const statusEl = document.getElementById("checkout-status");
  const readinessEl = document.getElementById("checkout-readiness");

  let currentOrderId = null;
  let checkoutMetaCache = null;
  let pollTimer = null;
  let pollCount = 0;
  let activeOfferId = null;

  function formatKes(n) {
    return `KES ${Math.round(Number(n) || 0).toLocaleString()}`;
  }

  function setOfferStatus(msg, isError = false) {
    const node = document.getElementById("offer-checkout-status");
    if (!node) return;
    node.textContent = msg || "";
    node.classList.toggle("text-red-600", isError);
  }

  async function loadOfferPreview(offerId) {
    const panel = document.getElementById("offer-checkout-panel");
    if (!panel) return;
    panel.classList.remove("hidden");
    activeOfferId = offerId;
    setOfferStatus("Loading agreed price…");

    const session = window.SokoniBuyerAuth?.readSession?.();
    const params = new URLSearchParams({ offerId: String(offerId) });
    if (session?.userId) params.set("buyerUserId", String(session.userId));
    if (window.SokoniBuyerAuth?.appendAuthQuery) {
      window.SokoniBuyerAuth.appendAuthQuery(params);
    }

    try {
      const res = await fetch(`${SOCIAL_API}/offers/${encodeURIComponent(offerId)}/checkout?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOfferStatus(data.message || data.error || "This offer cannot be checked out.", true);
        return;
      }
      document.getElementById("offer-checkout-product").textContent =
        data.offer?.product?.title || data.productId || "Accepted offer";
      document.getElementById("offer-checkout-amount").textContent = formatKes(
        data.breakdown?.totalKes ?? data.offer?.amountKsh
      );
      const listNode = document.getElementById("offer-checkout-list");
      if (listNode) {
        if (data.listedBuyerTotalKes != null) {
          listNode.textContent = `Listed ${formatKes(data.listedBuyerTotalKes)}`;
          listNode.classList.remove("hidden");
        } else {
          listNode.textContent = "";
        }
      }
      const breakdownNode = document.getElementById("offer-checkout-breakdown");
      if (breakdownNode) {
        const b = data.breakdown || {};
        const rows = [];
        if (b.itemKes != null || b.sellerNetKes != null) {
          rows.push(`<li>Item (seller receives) · ${formatKes(b.itemKes ?? b.sellerNetKes)}</li>`);
        }
        if (b.shippingKes != null && Number(b.shippingKes) > 0 && !b.freeShipping) {
          rows.push(`<li>Shipping · ${formatKes(b.shippingKes)}</li>`);
        } else {
          rows.push(`<li>Delivery · arranged by seller after payment</li>`);
        }
        if (b.platformFeeKes != null) {
          rows.push(`<li>Sokoni fee (10%) · ${formatKes(b.platformFeeKes)}</li>`);
        }
        if (b.totalKes != null) {
          rows.push(`<li><strong>You pay into escrow · ${formatKes(b.totalKes)}</strong></li>`);
        }
        breakdownNode.innerHTML = rows.join("");
      }
      setOfferStatus("Enter your drop-off address, then pay on M-Pesa. Delivery is arranged directly by the seller after payment.");
      const phoneInput = document.getElementById("offer-phone");
      if (phoneInput && session?.phone && !phoneInput.value) {
        phoneInput.value = session.phone;
      }
    } catch {
      setOfferStatus("Could not load offer checkout right now.", true);
    }
  }

  async function placeOfferOrder(ev) {
    ev.preventDefault();
    if (!activeOfferId) return;
    const session = window.SokoniBuyerAuth?.readSession?.();
    if (!session?.userId) {
      setOfferStatus("Verify your WhatsApp above before paying.", true);
      return;
    }

    const name = document.getElementById("offer-name")?.value.trim();
    const location = document.getElementById("offer-location")?.value.trim();
    const phone = document.getElementById("offer-phone")?.value.trim();
    const btn = document.getElementById("offer-place-btn");
    if (btn) btn.disabled = true;
    setOfferStatus("Creating prepaid order…");

    try {
      let payload = {
        buyerUserId: session.userId,
        name,
        location,
        deliveryPhone: phone,
      };
      if (window.SokoniBuyerAuth?.authFields) {
        payload = window.SokoniBuyerAuth.authFields(payload);
      }
      const res = await fetch(`${SOCIAL_API}/offers/${encodeURIComponent(activeOfferId)}/place-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOfferStatus(data.message || data.error || "Could not place order from this offer.", true);
        return;
      }

      document.getElementById("offer-checkout-panel")?.classList.add("hidden");
      if (input) input.value = data.orderId;
      const url = new URL(window.location.href);
      url.searchParams.delete("offerId");
      url.searchParams.set("order", data.orderId);
      window.history.replaceState({}, "", url);
      setOfferStatus("");
      hideError();
      await loadOrder(data.orderId);
      const checkoutPhone = document.getElementById("checkout-phone");
      if (checkoutPhone && phone) checkoutPhone.value = phone;
    } catch {
      setOfferStatus("Network error while placing offer order.", true);
    } finally {
      if (btn) btn.disabled = false;
    }
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

  function stopPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    pollCount = 0;
  }

  function renderReadiness(meta) {
    if (!readinessEl || !meta) return;
    if (meta.darajaConfigured) {
      readinessEl.textContent =
        "M-Pesa STK is live — tap Pay, enter PIN on your phone. Payment confirms automatically.";
    } else {
      readinessEl.textContent =
        "STK not live yet — pay Buy Goods till with your SK number as reference, then reply paid on WhatsApp.";
    }
  }

  function renderTillBlock(meta, orderId) {
    if (!tillBlock) return;
    const useTill = meta && !meta.darajaConfigured;
    tillBlock.classList.toggle("hidden", !useTill);
    if (!useTill) return;
    const till = meta.till || "—";
    const tillName = meta.tillName || "Sokoni Mall";
    document.getElementById("checkout-till").textContent = till;
    document.getElementById("checkout-till-name").textContent = tillName;
    document.getElementById("checkout-till-ref").textContent = orderId || "SK-####";
  }

  function renderCheckout(data) {
    currentOrderId = data.orderId;
    const meta = data.meta || checkoutMetaCache || {};
    checkoutMetaCache = meta;
    document.getElementById("checkout-order-id").textContent = data.orderId;
    document.getElementById("checkout-product").textContent = data.productName || "Sokoni order";
    document.getElementById("checkout-total").textContent = formatKes(data.totalKes ?? data.amountKes);

    const trackLink = document.getElementById("checkout-track-link");
    if (trackLink) trackLink.href = `track.html?order=${encodeURIComponent(data.orderId)}`;

    renderReadiness(meta);
    renderTillBlock(meta, data.orderId);

    const paid = data.paymentStatus === "confirmed";
    const processing = data.paymentStatusDetail === "processing";

    if (paid) {
      stopPolling();
      statusEl.textContent = "✅ Already paid — escrow held. Your order is being processed.";
      payBlock.classList.add("hidden");
      tillBlock?.classList.add("hidden");
    } else if (processing && meta.darajaConfigured) {
      statusEl.textContent = "📱 STK sent — enter your M-Pesa PIN. Waiting for confirmation…";
      payBlock.classList.remove("hidden");
      if (payBtn) payBtn.textContent = "Resend STK";
    } else if (meta.darajaConfigured) {
      statusEl.textContent = "💳 Payment required before dispatch. Tap Pay to get an M-Pesa prompt.";
      payBlock.classList.remove("hidden");
      if (payBtn) payBtn.textContent = "Pay with M-Pesa";
    } else {
      statusEl.textContent =
        "💳 Payment required before dispatch. Use the till details below, then reply paid on WhatsApp.";
      payBlock.classList.add("hidden");
    }

    panel.classList.remove("hidden");
  }

  async function loadMeta() {
    try {
      const res = await fetch(`${CHECKOUT_API}/meta`);
      if (!res.ok) return;
      checkoutMetaCache = await res.json();
      renderReadiness(checkoutMetaCache);
    } catch {
      /* page still works without meta */
    }
  }

  async function loadOrder(orderId, { quiet } = {}) {
    hideError();
    if (!quiet) {
      panel.classList.add("hidden");
      loadingEl.classList.remove("hidden");
    }

    try {
      const res = await fetch(`${CHECKOUT_API}/${encodeURIComponent(orderId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data.error === "order_not_found"
            ? "Order not found. Check your SK-#### from WhatsApp."
            : "Could not load order."
        );
      }
      renderCheckout(data);
      return data;
    } catch (err) {
      if (!quiet) showError(err.message);
      return null;
    } finally {
      if (!quiet) loadingEl.classList.add("hidden");
    }
  }

  function schedulePoll(orderId) {
    stopPolling();
    pollCount = 0;
    const tick = async () => {
      pollCount += 1;
      const data = await loadOrder(orderId, { quiet: true });
      if (data?.paymentStatus === "confirmed") {
        statusEl.textContent = "✅ Payment confirmed — escrow held. Track your order anytime.";
        return;
      }
      if (pollCount >= POLL_MAX) {
        statusEl.textContent =
          "Still waiting for M-Pesa… If you paid, refresh or open Track. Or reply paid on WhatsApp.";
        if (payBtn) {
          payBtn.disabled = false;
          payBtn.textContent = "Resend STK";
        }
        return;
      }
      pollTimer = setTimeout(tick, POLL_MS);
    };
    pollTimer = setTimeout(tick, POLL_MS);
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

      if (data.meta) checkoutMetaCache = data.meta;

      if (data.alreadyPaid || data.method === "already_paid") {
        statusEl.textContent = "✅ Already paid.";
        payBlock.classList.add("hidden");
        tillBlock?.classList.add("hidden");
        return;
      }

      if (data.method === "manual_till" || data.stkAvailable === false) {
        renderTillBlock(data.meta || checkoutMetaCache, currentOrderId);
        statusEl.textContent =
          data.message ||
          "STK is not live yet — pay the till below with your SK number, then reply paid on WhatsApp.";
        payBlock.classList.add("hidden");
        return;
      }

      statusEl.textContent =
        data.customerMessage || "📱 STK sent — check your phone and enter M-Pesa PIN. Waiting…";
      schedulePoll(currentOrderId);
    } catch (err) {
      showError(err.message);
      payBtn.disabled = false;
      payBtn.textContent = "Pay with M-Pesa";
    }
  }

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    stopPolling();
    const id = normalizeOrderId(input.value);
    if (!id) return;
    input.value = id;
    const url = new URL(window.location.href);
    url.searchParams.set("order", id);
    window.history.replaceState({}, "", url);
    loadOrder(id);
  });

  payBtn?.addEventListener("click", payOrder);
  document.getElementById("offer-checkout-form")?.addEventListener("submit", placeOfferOrder);

  loadMeta().then(() => {
    const params = new URLSearchParams(window.location.search);
    const offerId = params.get("offerId");
    const preset = params.get("order");
    if (offerId) {
      window.SokoniBuyerAuth?.bindPanel?.({
        onVerified: () => {
          loadOfferPreview(offerId);
        },
      });
      loadOfferPreview(offerId);
      return;
    }
    if (preset) {
      input.value = normalizeOrderId(preset);
      loadOrder(input.value);
    }
  });
})();
