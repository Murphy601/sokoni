(function () {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:3001"
      : "https://bot.sokonimall.com";
  const CHECKOUT_API = `${API_BASE}/api/checkout`;

  const form = document.getElementById("label-lookup");
  const input = document.getElementById("order-id");
  const panel = document.getElementById("label-panel");
  const errorEl = document.getElementById("label-error");
  const loadingEl = document.getElementById("label-loading");
  const printBtn = document.getElementById("label-print-btn");

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

  function statusLabel(status) {
    const map = {
      pending: "Pending payment",
      label_ready: "Label ready — drop off at hub",
      dropped_off: "Dropped off",
      in_transit: "In transit",
      at_pickup_point: "At pickup point",
      delivered: "Delivered",
    };
    return map[status] || status || "—";
  }

  function resolveQrLib() {
    if (typeof QRCode !== "undefined" && QRCode && typeof QRCode.toCanvas === "function") {
      return QRCode;
    }
    if (typeof SokoniQR !== "undefined" && SokoniQR) {
      if (typeof SokoniQR.toCanvas === "function") return SokoniQR;
      if (SokoniQR.default && typeof SokoniQR.default.toCanvas === "function") return SokoniQR.default;
    }
    return null;
  }

  function paintQrUnavailable(canvas, detail) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#111";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("QR unavailable", canvas.width / 2, canvas.height / 2 - 8);
    if (detail) {
      ctx.font = "10px sans-serif";
      ctx.fillStyle = "#666";
      ctx.fillText(String(detail).slice(0, 40), canvas.width / 2, canvas.height / 2 + 10);
    }
  }

  async function drawQr(payload) {
    const canvas = document.getElementById("label-qr");
    if (!canvas) return;
    const text = String(payload || "").trim();
    if (!text) {
      paintQrUnavailable(canvas, "missing code");
      return;
    }

    const lib = resolveQrLib();
    if (!lib) {
      paintQrUnavailable(canvas, "library missing");
      return;
    }

    try {
      await lib.toCanvas(canvas, text, {
        width: 200,
        margin: 1,
        errorCorrectionLevel: "M",
        color: { dark: "#000000", light: "#FFFFFF" },
      });
    } catch (err) {
      console.warn("[label] QR render failed:", err?.message || err);
      paintQrUnavailable(canvas, "render failed");
    }
  }

  async function renderLabel(data) {
    const sheet = document.getElementById("label-sheet");
    const unpaid = !data.paid;
    sheet?.classList.toggle("is-unpaid", unpaid);

    document.getElementById("label-order-id").textContent = data.orderId || "—";
    document.getElementById("label-product").textContent = data.productName || "Sokoni order";

    const route = document.getElementById("label-route");
    const dest = document.getElementById("label-dest");
    const loc = document.getElementById("label-location");
    const destParts = [];
    if (data.buyerName) destParts.push(data.buyerName);
    if (data.pickupPointName) destParts.push(data.pickupPointName);
    const destLine = destParts.join(" · ") || (data.buyerLocation ? "Buyer delivery" : "");
    if (dest) dest.textContent = destLine || "—";
    if (loc) {
      const bits = [];
      if (data.buyerLocation) bits.push(data.buyerLocation);
      if (data.pickupPointPhone) bits.push(data.pickupPointPhone);
      loc.textContent = bits.length ? bits.join(" · ") : "";
      loc.hidden = !bits.length;
    }
    if (route) route.hidden = !(destLine || data.buyerLocation);

    document.getElementById("label-drop-code").textContent = data.dropOffCode || data.orderId || "—";
    document.getElementById("label-qr-caption").textContent = data.qrPayload || `SOKONI:${data.orderId}`;
    document.getElementById("label-shipment").textContent = `Shipment: ${statusLabel(data.shipmentStatus)}`;

    const unpaidEl = document.getElementById("label-unpaid");
    if (unpaidEl) unpaidEl.hidden = !unpaid;

    const track = document.getElementById("label-track-link");
    if (track) {
      track.href = data.trackUrl || `track.html?order=${encodeURIComponent(data.orderId || "")}`;
    }

    if (printBtn) printBtn.disabled = unpaid;

    await drawQr(data.qrPayload || `SOKONI:${data.orderId}`);
    panel.classList.remove("hidden");
  }

  async function loadLabel(orderId) {
    hideError();
    panel.classList.add("hidden");
    loadingEl.classList.remove("hidden");

    try {
      const res = await fetch(`${CHECKOUT_API}/${encodeURIComponent(orderId)}/label`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data.error === "order_not_found"
            ? "Order not found. Check the SK-#### from WhatsApp."
            : data.message || "Could not load label."
        );
      }
      await renderLabel(data);
    } catch (err) {
      showError(err.message);
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
    loadLabel(id);
  });

  printBtn?.addEventListener("click", () => {
    window.print();
  });

  const params = new URLSearchParams(window.location.search);
  const preset = params.get("order");
  if (preset) {
    input.value = normalizeOrderId(preset);
    loadLabel(input.value);
  }
})();
