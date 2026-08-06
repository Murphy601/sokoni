/**
 * Seller Hub analytics — SVG charts (no React / Recharts).
 * 1) Sales volume vs avg unit price (bars + line)
 * 2) Escrow & cash-flow donut
 */
(function (global) {
  "use strict";

  const COLORS = {
    units: "#25D366",
    price: "#F59E0B",
    available: "#25D366",
    pending: "#FACC15",
    transit: "#F87171",
    paidOut: "#60A5FA",
    axis: "rgba(255,255,255,0.35)",
    grid: "rgba(255,255,255,0.08)",
    text: "rgba(255,248,240,0.72)",
  };

  function el(id) {
    return document.getElementById(id);
  }

  function formatKes(n) {
    const v = Math.round(Number(n) || 0);
    return `KES ${v.toLocaleString("en-KE")}`;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function startOfWeek(ts) {
    const d = new Date(ts);
    const day = d.getDay(); // 0 Sun
    const diff = (day + 6) % 7; // Monday-start
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - diff);
    return d.getTime();
  }

  function weekLabel(weekStart) {
    const d = new Date(weekStart);
    return d.toLocaleDateString("en-KE", { day: "numeric", month: "short" });
  }

  /** Build last N week buckets from paid orders. */
  function buildSalesVsPriceSeries(orders, weeks = 6) {
    const paid = (orders || []).filter((o) => o.paid);
    const now = Date.now();
    const thisWeek = startOfWeek(now);
    const buckets = [];
    for (let i = weeks - 1; i >= 0; i -= 1) {
      const start = thisWeek - i * 7 * 24 * 60 * 60 * 1000;
      buckets.push({
        start,
        period: weekLabel(start),
        unitsSold: 0,
        revenueKes: 0,
        avgPrice: 0,
      });
    }

    for (const o of paid) {
      const t = Number(o.createdAt) || 0;
      if (!t) continue;
      const ws = startOfWeek(t);
      const bucket = buckets.find((b) => b.start === ws);
      if (!bucket) continue;
      const qty = Math.max(1, Math.round(Number(o.quantity) || 1));
      const net = Math.round(Number(o.sellerNetKes) || 0);
      bucket.unitsSold += qty;
      bucket.revenueKes += net;
    }

    for (const b of buckets) {
      b.avgPrice = b.unitsSold > 0 ? Math.round(b.revenueKes / b.unitsSold) : 0;
    }

    const paidCount = paid.length;
    return { buckets, paidCount };
  }

  function topProductsByRevenue(orders, limit = 3) {
    const map = new Map();
    for (const o of orders || []) {
      if (!o.paid) continue;
      const key = o.productId || o.productName || o.orderId;
      const prev = map.get(key) || {
        productId: o.productId || null,
        productName: o.productName || "Item",
        units: 0,
        revenueKes: 0,
      };
      prev.units += Math.max(1, Math.round(Number(o.quantity) || 1));
      prev.revenueKes += Math.round(Number(o.sellerNetKes) || 0);
      map.set(key, prev);
    }
    return [...map.values()].sort((a, b) => b.revenueKes - a.revenueKes).slice(0, limit);
  }

  function buildEscrowSegments(ledger) {
    if (!ledger) return [];

    // Ledger tabs can overlap the same order (held + label_ready). Donut uses exclusive buckets.
    const transitIds = new Set((ledger.inTransit?.items || []).map((i) => i.orderId).filter(Boolean));
    const pendingExclusive = (ledger.pendingEscrow?.items || []).filter((i) => !transitIds.has(i.orderId));
    const pendingKes = pendingExclusive.reduce((s, i) => s + Math.round(Number(i.amountKes) || 0), 0);

    return [
      {
        key: "available",
        name: "Available",
        hint: "Ready to withdraw",
        value: Math.round(Number(ledger.available?.totalKes) || 0),
        color: COLORS.available,
      },
      {
        key: "pending",
        name: "Pending dispatch",
        hint: "Paid — awaiting your drop-off",
        value: pendingKes,
        color: COLORS.pending,
      },
      {
        key: "transit",
        name: "In transit",
        hint: "Dispatched / buyer inspection",
        value: Math.round(Number(ledger.inTransit?.totalKes) || 0),
        color: COLORS.transit,
      },
      {
        key: "paidOut",
        name: "Paid out",
        hint: "Released to M-Pesa",
        value: Math.round(Number(ledger.paidOut?.totalKes) || 0),
        color: COLORS.paidOut,
      },
    ];
  }

  function volumeChartHtml(buckets) {
    const w = 560;
    const h = 220;
    const pad = { top: 16, right: 44, bottom: 36, left: 36 };
    const innerW = w - pad.left - pad.right;
    const innerH = h - pad.top - pad.bottom;
    const n = buckets.length || 1;
    const maxUnits = Math.max(1, ...buckets.map((b) => b.unitsSold));
    const maxPrice = Math.max(1, ...buckets.map((b) => b.avgPrice));
    const barW = Math.min(36, (innerW / n) * 0.55);
    const gap = innerW / n;

    const yUnits = (v) => pad.top + innerH - (v / maxUnits) * innerH;
    const yPrice = (v) => pad.top + innerH - (v / maxPrice) * innerH;
    const xCenter = (i) => pad.left + gap * i + gap / 2;

    const gridLines = [0, 0.5, 1]
      .map((t) => {
        const y = pad.top + innerH * (1 - t);
        return `<line x1="${pad.left}" y1="${y}" x2="${w - pad.right}" y2="${y}" stroke="${COLORS.grid}" stroke-width="1" />`;
      })
      .join("");

    const bars = buckets
      .map((b, i) => {
        const x = xCenter(i) - barW / 2;
        const y = yUnits(b.unitsSold);
        const bh = Math.max(b.unitsSold > 0 ? 3 : 0, pad.top + innerH - y);
        return `
          <rect class="seller-analytics-bar" x="${x}" y="${y}" width="${barW}" height="${bh}"
            rx="6" fill="${COLORS.units}" opacity="0.92">
            <title>${escapeHtml(b.period)}: ${b.unitsSold} sold · avg ${formatKes(b.avgPrice)}</title>
          </rect>`;
      })
      .join("");

    const points = buckets.map((b, i) => `${xCenter(i)},${yPrice(b.avgPrice)}`).join(" ");
    const dots = buckets
      .map((b, i) => {
        if (!b.unitsSold && !b.avgPrice) return "";
        return `<circle class="seller-analytics-dot" cx="${xCenter(i)}" cy="${yPrice(b.avgPrice)}" r="4.5" fill="${COLORS.price}" stroke="#0b0b0f" stroke-width="1.5" />`;
      })
      .join("");

    const labels = buckets
      .map(
        (b, i) =>
          `<text x="${xCenter(i)}" y="${h - 12}" text-anchor="middle" fill="${COLORS.axis}" font-size="11" font-family="DM Sans, sans-serif">${escapeHtml(b.period)}</text>`
      )
      .join("");

    return `
      <svg viewBox="0 0 ${w} ${h}" class="seller-analytics-svg" role="presentation" aria-hidden="true">
        ${gridLines}
        ${bars}
        <polyline class="seller-analytics-line" fill="none" stroke="${COLORS.price}" stroke-width="3"
          stroke-linecap="round" stroke-linejoin="round" points="${points}" />
        ${dots}
        <text x="${pad.left}" y="12" fill="${COLORS.units}" font-size="10" font-family="DM Sans, sans-serif">Units</text>
        <text x="${w - pad.right}" y="12" text-anchor="end" fill="${COLORS.price}" font-size="10" font-family="DM Sans, sans-serif">KES</text>
        ${labels}
      </svg>
      <div class="seller-analytics-legend">
        <span><i style="background:${COLORS.units}"></i> Units sold</span>
        <span><i class="seller-analytics-legend-line" style="background:${COLORS.price}"></i> Avg unit price</span>
      </div>`;
  }

  function escrowDonutHtml(segments) {
    const total = segments.reduce((s, x) => s + x.value, 0);
    const size = 180;
    const cx = size / 2;
    const cy = size / 2;
    const r = 62;
    const stroke = 18;
    const c = 2 * Math.PI * r;

    let offset = 0;
    const arcs =
      total <= 0
        ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${COLORS.grid}" stroke-width="${stroke}" />`
        : segments
            .filter((s) => s.value > 0)
            .map((s) => {
              const len = (s.value / total) * c;
              const dash = `${len} ${c - len}`;
              const elArc = `<circle class="seller-analytics-arc" cx="${cx}" cy="${cy}" r="${r}" fill="none"
                stroke="${s.color}" stroke-width="${stroke}" stroke-dasharray="${dash}"
                stroke-dashoffset="${-offset}" stroke-linecap="butt"
                transform="rotate(-90 ${cx} ${cy})">
                <title>${escapeHtml(s.name)}: ${formatKes(s.value)}</title>
              </circle>`;
              offset += len;
              return elArc;
            })
            .join("");

    const legend = segments
      .map(
        (s) => `
        <div class="seller-analytics-escrow-row">
          <span class="seller-analytics-escrow-name">
            <span class="seller-analytics-escrow-dot" style="background:${s.color}"></span>
            ${escapeHtml(s.name)}
          </span>
          <span class="seller-analytics-escrow-val font-mono">${formatKes(s.value)}</span>
        </div>
        <p class="seller-analytics-escrow-hint">${escapeHtml(s.hint)}</p>`
      )
      .join("");

    return `
      <div class="seller-analytics-donut">
        <svg viewBox="0 0 ${size} ${size}" class="seller-analytics-svg" role="presentation" aria-hidden="true">
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${COLORS.grid}" stroke-width="${stroke}" />
          ${arcs}
        </svg>
        <div class="seller-analytics-donut-center">
          <p class="text-[10px] uppercase tracking-wider text-zinc-500">Pipeline</p>
          <p class="text-sm font-black font-mono text-white">${total > 0 ? formatKes(total) : "KES 0"}</p>
        </div>
      </div>
      <div class="seller-analytics-escrow-legend">${legend}</div>`;
  }

  function topProductsHtml(products) {
    if (!products.length) return "";
    const total = products.reduce((s, p) => s + p.revenueKes, 0) || 1;
    return `
      <p class="seller-analytics-top-label">Top earners</p>
      <ul class="seller-analytics-top-list">
        ${products
          .map((p) => {
            const pct = Math.round((p.revenueKes / total) * 100);
            return `<li>
              <div class="seller-analytics-top-row">
                <span class="truncate">${escapeHtml(p.productName)}</span>
                <span class="font-mono shrink-0">${formatKes(p.revenueKes)}</span>
              </div>
              <div class="seller-analytics-top-bar"><span style="width:${pct}%"></span></div>
              <p class="seller-analytics-top-meta">${p.units} sold${p.productId ? ` · ${escapeHtml(p.productId)}` : ""} · ${pct}%</p>
            </li>`;
          })
          .join("")}
      </ul>`;
  }

  function paintAll(selector, html) {
    document.querySelectorAll(selector).forEach((node) => {
      node.innerHTML = html;
    });
  }

  function setTextAll(selector, text) {
    document.querySelectorAll(selector).forEach((node) => {
      node.textContent = text;
    });
  }

  /**
   * Paint Overview + Analytics mounts (data-analytics-* attributes).
   * @param {{ orders?: any[], ledger?: any }} data
   */
  function renderSellerAnalytics(data = {}) {
    const mounts = document.querySelectorAll("[data-analytics-volume]");
    if (!mounts.length && !el("seller-analytics-volume")) return;

    const orders = Array.isArray(data.orders) ? data.orders : [];
    const { buckets, paidCount } = buildSalesVsPriceSeries(orders, 6);
    const hasSales = buckets.some((b) => b.unitsSold > 0);

    setTextAll("[data-analytics-period]", "Last 6 weeks");
    setTextAll(
      "[data-analytics-sync]",
      paidCount > 0
        ? `${paidCount} paid order${paidCount === 1 ? "" : "s"} · updated ${new Date().toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}`
        : "Synced from paid orders"
    );

    const emptyMsg =
      "Not enough paid sales yet — this chart unlocks after a few orders so you can see how price changes affect volume.";
    paintAll(
      "[data-analytics-volume]",
      hasSales ? volumeChartHtml(buckets) : `<p class="seller-analytics-empty">${escapeHtml(emptyMsg)}</p>`
    );
    paintAll("[data-analytics-top]", topProductsHtml(topProductsByRevenue(orders, 3)));

    const segments = buildEscrowSegments(data.ledger);
    const pipeline = segments.reduce((s, x) => s + x.value, 0);
    paintAll(
      "[data-analytics-escrow]",
      pipeline <= 0 && !data.ledger
        ? `<p class="seller-analytics-empty">Load earnings to see your escrow breakdown.</p>`
        : escrowDonutHtml(segments)
    );
  }

  global.SokoniSellerAnalytics = {
    render: renderSellerAnalytics,
    buildSalesVsPriceSeries,
    buildEscrowSegments,
    topProductsByRevenue,
  };
})(typeof window !== "undefined" ? window : globalThis);
