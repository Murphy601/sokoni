/**
 * Seller Hub analytics — SVG charts (no React / Recharts).
 * 1) Sales volume vs avg unit price (bars + smooth line)
 * 2) Escrow & cash-flow donut
 */
(function (global) {
  "use strict";

  const COLORS = {
    units: "#10B981",
    price: "#F59E0B",
    available: "#25D366",
    pending: "#FACC15",
    transit: "#F87171",
    paidOut: "#60A5FA",
    axis: "rgba(255,255,255,0.55)",
    grid: "#262626",
    emptyBand: "rgba(255,255,255,0.03)",
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

  /** Drop long empty leading weeks so real data isn’t squeezed to the right. */
  function focusActiveBuckets(buckets, minWeeks = 3) {
    if (!buckets.length) return buckets;
    const first = buckets.findIndex((b) => b.unitsSold > 0);
    if (first < 0) return buckets.slice(-minWeeks);
    const from = Math.max(0, Math.min(first, buckets.length - minWeeks));
    return buckets.slice(from);
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

  /** Catmull-Rom → cubic Bezier path (smooth “monotone-like” curve). */
  function smoothLinePath(points) {
    if (!points.length) return "";
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    if (points.length === 2) {
      return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
    }
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i += 1) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
    }
    return d;
  }

  function volumeChartHtml(rawBuckets) {
    const buckets = focusActiveBuckets(rawBuckets, 3);
    const w = 560;
    const h = 180;
    const pad = { top: 12, right: 12, left: 22, bottom: 28 };
    const innerW = w - pad.left - pad.right;
    const innerH = h - pad.top - pad.bottom;
    const n = buckets.length || 1;
    const maxUnits = Math.max(1, ...buckets.map((b) => b.unitsSold));
    const maxPrice = Math.max(1, ...buckets.map((b) => b.avgPrice));
    const barW = Math.min(28, (innerW / n) * 0.48);
    const gap = innerW / n;

    const yUnits = (v) => pad.top + innerH - (v / maxUnits) * innerH;
    const yPrice = (v) => pad.top + innerH - (v / maxPrice) * innerH;
    const xCenter = (i) => pad.left + gap * i + gap / 2;

    const gridLines = [0, 0.25, 0.5, 0.75, 1]
      .map((t) => {
        const y = pad.top + innerH * (1 - t);
        return `<line x1="${pad.left}" y1="${y}" x2="${w - pad.right}" y2="${y}" stroke="${COLORS.grid}" stroke-width="1" stroke-dasharray="3 3" />`;
      })
      .join("");

    const emptyBands = buckets
      .map((b, i) => {
        if (b.unitsSold > 0) return "";
        const x = pad.left + gap * i + 2;
        return `<rect x="${x}" y="${pad.top}" width="${Math.max(4, gap - 4)}" height="${innerH}" fill="${COLORS.emptyBand}" stroke="${COLORS.grid}" stroke-width="1" stroke-dasharray="3 4" rx="4" />`;
      })
      .join("");

    const bars = buckets
      .map((b, i) => {
        if (!b.unitsSold) return "";
        const x = xCenter(i) - barW / 2;
        const y = yUnits(b.unitsSold);
        const bh = Math.max(4, pad.top + innerH - y);
        return `
          <rect class="seller-analytics-bar" x="${x}" y="${y}" width="${barW}" height="${bh}"
            rx="6" fill="${COLORS.units}" opacity="0.95">
            <title>${escapeHtml(b.period)}: ${b.unitsSold} sold · avg ${formatKes(b.avgPrice)}</title>
          </rect>`;
      })
      .join("");

    const pricePts = buckets
      .map((b, i) => (b.avgPrice > 0 ? { x: xCenter(i), y: yPrice(b.avgPrice), period: b.period, price: b.avgPrice } : null))
      .filter(Boolean);
    const linePath = smoothLinePath(pricePts);
    const dots = pricePts
      .map(
        (p) =>
          `<circle class="seller-analytics-dot" cx="${p.x}" cy="${p.y}" r="4.5" fill="${COLORS.price}" stroke="#0b0b0f" stroke-width="1.5"><title>${escapeHtml(p.period)}: ${formatKes(p.price)}</title></circle>`
      )
      .join("");

    const labels = buckets
      .map(
        (b, i) =>
          `<text x="${xCenter(i)}" y="${h - 6}" text-anchor="middle" fill="${COLORS.axis}" font-size="12" font-family="DM Sans, sans-serif" font-weight="600">${escapeHtml(b.period)}</text>`
      )
      .join("");

    return `
      <svg viewBox="0 0 ${w} ${h}" class="seller-analytics-svg" role="presentation" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
        ${gridLines}
        ${emptyBands}
        ${bars}
        ${linePath ? `<path class="seller-analytics-line" fill="none" stroke="${COLORS.price}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="${linePath}" />` : ""}
        ${dots}
        ${labels}
      </svg>`;
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
      <div class="seller-analytics-top-head">
        <p class="seller-analytics-top-label">Top earners</p>
      </div>
      <ul class="seller-analytics-top-list">
        ${products
          .map((p, idx) => {
            const pct = Math.round((p.revenueKes / total) * 100);
            return `<li class="seller-analytics-top-card">
              <div class="seller-analytics-top-headrow">
                <span class="seller-analytics-top-rank">#${idx + 1}</span>
                <p class="seller-analytics-top-title">${escapeHtml(p.productName)}</p>
                <span class="seller-analytics-top-kes font-mono">${formatKes(p.revenueKes)}</span>
              </div>
              <div class="seller-analytics-top-bar"><span style="width:${pct}%"></span></div>
              <div class="seller-analytics-top-meta">
                <span>${p.units} sold</span>
                <span>${pct}% revenue</span>
              </div>
            </li>`;
          })
          .join("")}
      </ul>`;
  }

  function syncStatusHtml(paidCount) {
    if (paidCount <= 0) {
      return `<span class="seller-analytics-sync-plain">Synced from paid orders</span>`;
    }
    const time = new Date().toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
    return `<span class="seller-analytics-live">
      <span class="seller-analytics-live__dot" aria-hidden="true"></span>
      <span>${paidCount} paid order${paidCount === 1 ? "" : "s"}</span>
      <span class="seller-analytics-live__sep">·</span>
      <span>Updated ${escapeHtml(time)}</span>
    </span>`;
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
    paintAll("[data-analytics-sync]", syncStatusHtml(paidCount));

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
    focusActiveBuckets,
  };
})(typeof window !== "undefined" ? window : globalThis);
