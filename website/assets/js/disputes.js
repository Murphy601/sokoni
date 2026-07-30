const API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001"
    : "https://bot.sokonimall.com";

const DISPUTES_API = `${API_BASE}/api/disputes`;

const GUIDES = [
  {
    title: "How photo evidence works",
    blurb: "Clear daylight shots of the tag, item, and packaging help admin decide faster.",
  },
  {
    title: "What happens in escrow",
    blurb: "When you open a claim, payout freezes. Money stays held until refund or release.",
  },
  {
    title: "SK Station returns",
    blurb: "If a return is approved, drop at a Sokoni hub with your order ref on the parcel.",
  },
  {
    title: "Open a claim from Track",
    blurb: "After you pay, use Track order → Open dispute with a short statement.",
  },
];

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

function setStatus(msg, isError = false) {
  const node = el("disputes-status");
  if (!node) return;
  node.textContent = msg || "";
  node.classList.toggle("text-red-600", isError);
  node.classList.toggle("dark:text-red-400", isError);
  node.classList.toggle("text-brand-green", !isError && Boolean(msg));
}

function reasonLabel(reason) {
  const map = {
    not_as_described: "Item not as described",
    wrong_item: "Wrong item received",
    damaged: "Damaged on arrival",
    not_received: "Not received",
    other: "Other",
  };
  return map[String(reason || "").toLowerCase()] || String(reason || "Dispute").replace(/_/g, " ");
}

function statusBadge(status) {
  const s = String(status || "").toLowerCase();
  if (s === "under_review" || s === "open") {
    return `<span class="dispute-badge dispute-badge--review">${s === "open" ? "Action needed" : "Under admin review"}</span>`;
  }
  if (s.startsWith("resolved") || s === "closed") {
    return `<span class="dispute-badge dispute-badge--resolved">${s.includes("refund") ? "Resolved · refunded" : "Resolved"}</span>`;
  }
  return `<span class="dispute-badge dispute-badge--action">${escapeHtml(s || "open")}</span>`;
}

function formatWhen(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function renderGuides() {
  const wrap = el("dispute-guides");
  if (!wrap) return;
  wrap.innerHTML = GUIDES.map(
    (g) => `
    <article class="dispute-guide-card" role="listitem">
      <p class="text-sm font-bold">${escapeHtml(g.title)}</p>
      <p class="text-[11px] text-brand-purple/55 dark:text-white/55 mt-2 leading-snug">${escapeHtml(g.blurb)}</p>
    </article>`
  ).join("");
}

function disputeCard(d) {
  const open = d.status === "open" || d.status === "under_review";
  const ticket = `TK-${d.id}`;
  return `
    <article class="dispute-card space-y-4">
      <div class="flex justify-between items-start gap-3 border-b border-brand-purple/10 dark:border-white/10 pb-3">
        <div class="min-w-0 space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs font-mono text-brand-purple/50 dark:text-white/50">Ticket #${escapeHtml(ticket)}</span>
            ${statusBadge(d.status)}
          </div>
          <h3 class="text-sm font-bold">${escapeHtml(reasonLabel(d.reason))}</h3>
          <p class="text-[11px] font-mono text-brand-purple/45 dark:text-white/45">${escapeHtml(d.orderRef)} · ${escapeHtml(formatWhen(d.createdAt))}</p>
        </div>
        <span class="text-xs font-bold font-mono text-brand-green shrink-0">${d.escrowFrozenAt ? "Escrow held" : "On file"}</span>
      </div>
      ${
        d.buyerStatement
          ? `<div class="rounded-xl border border-brand-purple/10 dark:border-white/10 bg-brand-cream/60 dark:bg-brand-purple/30 p-3 text-xs">
              <p class="font-bold">Your statement</p>
              <p class="text-brand-purple/65 dark:text-white/65 mt-1">${escapeHtml(d.buyerStatement)}</p>
            </div>`
          : ""
      }
      ${
        d.sellerResponse
          ? `<div class="rounded-xl border border-brand-purple/10 dark:border-white/10 p-3 text-xs">
              <p class="font-bold">Seller response</p>
              <p class="text-brand-purple/65 dark:text-white/65 mt-1">${escapeHtml(d.sellerResponse)}</p>
            </div>`
          : ""
      }
      ${
        d.adminNotes
          ? `<p class="text-xs text-brand-purple/55 dark:text-white/55"><span class="font-semibold">Admin:</span> ${escapeHtml(d.adminNotes)}</p>`
          : ""
      }
      <div class="flex flex-wrap gap-2">
        <a href="track.html?order=${encodeURIComponent(d.orderRef || "")}" class="min-h-[44px] inline-flex items-center px-4 rounded-full bg-brand-green text-brand-purple text-xs font-bold">
          ${open ? "Open track / add detail" : "View order"}
        </a>
        <a href="https://wa.me/254117422428?text=${encodeURIComponent(`Hi Sokoni, dispute ${ticket} / ${d.orderRef}`)}" target="_blank" rel="noopener" class="min-h-[44px] inline-flex items-center px-4 rounded-full border border-brand-purple/15 dark:border-white/15 text-xs font-bold">
          WhatsApp support
        </a>
      </div>
    </article>`;
}

async function loadDisputes() {
  const wrap = el("disputes-list");
  if (!wrap) return;
  const session = window.SokoniBuyerAuth?.readSession?.();
  if (!session?.token) {
    wrap.innerHTML = `<p class="text-sm text-brand-purple/55 dark:text-white/55">Verify WhatsApp above to load your tickets.</p>`;
    return;
  }
  wrap.innerHTML = `<p class="text-sm text-brand-purple/50">Loading…</p>`;
  setStatus("");
  try {
    const params = new URLSearchParams({ limit: "40" });
    window.SokoniBuyerAuth?.appendAuthQuery?.(params);
    const res = await fetch(`${DISPUTES_API}/mine?${params.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      wrap.innerHTML = `<p class="text-sm text-red-600 dark:text-red-400">${escapeHtml(data.message || "Could not load disputes.")}</p>`;
      setStatus(data.message || "Could not load disputes.", true);
      return;
    }
    const disputes = Array.isArray(data.disputes) ? data.disputes : [];
    if (!disputes.length) {
      wrap.innerHTML = `<div class="dispute-card text-sm text-brand-purple/60 dark:text-white/65">
        No open tickets. If something’s wrong with a paid order, open a claim from
        <a href="track.html" class="text-brand-green font-semibold">Track</a>.
      </div>`;
      return;
    }
    wrap.innerHTML = disputes.map(disputeCard).join("");
  } catch {
    wrap.innerHTML = `<p class="text-sm text-red-600 dark:text-red-400">Network error.</p>`;
    setStatus("Network error.", true);
  }
}

function init() {
  renderGuides();
  window.SokoniBuyerAuth?.bindPanel?.({
    onVerified: () => {
      setStatus("WhatsApp verified.");
      void loadDisputes();
    },
  });
  el("disputes-refresh-btn")?.addEventListener("click", () => void loadDisputes());
  if (window.SokoniBuyerAuth?.readSession?.()?.token) {
    el("buyer-auth-panel")?.classList.add("opacity-80");
    void loadDisputes();
  }
}

document.addEventListener("DOMContentLoaded", init);
