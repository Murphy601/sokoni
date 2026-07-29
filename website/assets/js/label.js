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

  async function drawQr(payload) {
    const canvas = document.getElementById("label-qr");
    if (!canvas) return;
    const text = String(payload || "");
    if (typeof QRCode !== "undefined" && QRCode.toCanvas) {
      await QRCode.toCanvas(canvas, text, {
        width: 200,
        margin: 1,
        color: { dark: "#1B1035", light: "#FFFFFF" },
      });
      return;
    }
    // Fallback: clear canvas and show caption only
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#1B1035";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("QR unavailable", canvas.width / 2, canvas.height / 2);
  }

  async function renderLabel(data) {
    const sheet = document.getElementById("label-sheet");
    const unpaid = !data.paid;
    sheet?.classList.toggle("is-unpaid", unpaid);

    document.getElementById("label-order-id").textContent = data.orderId || "—";
    document.getElementById("label-product").textContent = data.productName || "Sokoni order";
    const loc = document.getElementById("label-location");
    if (loc) {
      loc.textContent = data.buyerLocation ? `Deliver to: ${data.buyerLocation}` : "";
      loc.hidden = !data.buyerLocation;
    }
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
