const API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001"
    : "https://bot.sokonimall.com";

const DISPUTES_API = `${API_BASE}/api/disputes`;

const GUIDES = [
  {
    id: "photo",
    title: "How photo evidence works",
    blurb: "Clear daylight shots of the tag, item, and packaging help admin decide faster.",
    detail:
      "Take photos in daylight of: (1) the item front and back, (2) tags/labels, (3) packaging and seal if damaged, (4) any stains or flaws. Upload or WhatsApp them with your ticket number once the claim is open.",
  },
  {
    id: "escrow",
    title: "What happens in escrow",
    blurb: "When you open a claim, payout freezes. Money stays held until refund or release.",
    detail:
      "After you pay, Sokoni holds funds until delivery is confirmed. If you open a dispute, seller payout stays frozen while admin reviews tracking, your statement, and any photos. Outcome is refund, partial refund, or release to the seller.",
  },
  {
    id: "returns",
    title: "SK Station returns",
    blurb: "If a return is approved, drop at a Sokoni hub with your order ref on the parcel.",
    detail:
      "Only return after admin approves. Write your SKN-#### on the parcel, drop at an SK Station / Sokoni hub, and keep the drop receipt. Returns without approval may not be refunded.",
  },
  {
    id: "open",
    title: "Open a claim from Track",
    blurb: "After you pay, use Track order → Open dispute with a short statement.",
    detail:
      "Go to Track, enter your SKN-####, verify WhatsApp if asked, then use Open dispute. Or use the form on this page: enter your order number, pick a reason, and submit a short statement.",
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

function buyerSession() {
  return window.SokoniBuyerAuth?.readSession?.() || null;
}

function isSignedIn() {
  const session = buyerSession();
  return Boolean(session?.sessionToken && session?.userId);
}

function setStatus(msg, isError = false) {
  const node = el("disputes-status");
  if (!node) return;
  node.textContent = msg || "";
  node.classList.toggle("text-red-400", isError);
  node.classList.toggle("text-[#FF2300]", isError);
  node.classList.toggle("text-emerald-400", !isError && Boolean(msg));
}

function setOpenStatus(msg, isError = false) {
  const node = el("open-dispute-status");
  if (!node) return;
  node.textContent = msg || "";
  node.classList.toggle("text-red-400", isError);
  node.classList.toggle("text-[#FF2300]", isError);
  node.classList.toggle("text-emerald-400", !isError && Boolean(msg));
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

function normalizeOrderId(raw) {
  return globalThis.SokoniOrderId?.normalizeOrderId(raw) || "";
}

function renderGuides() {
  const wrap = el("dispute-guides");
  if (!wrap) return;
  wrap.innerHTML = GUIDES.map(
    (g) => `
    <button type="button" class="dispute-guide-card text-left" role="listitem" data-guide-id="${escapeHtml(g.id)}" aria-expanded="false">
      <p class="text-sm font-bold text-white">${escapeHtml(g.title)}</p>
      <p class="text-[11px] text-zinc-400 mt-2 leading-snug">${escapeHtml(g.blurb)}</p>
      <p class="dispute-guide-detail hidden text-[11px] text-zinc-300 mt-3 leading-relaxed border-t border-zinc-800 pt-3">${escapeHtml(g.detail)}</p>
      <p class="text-[10px] font-bold text-[#FF2300] mt-3 dispute-guide-cta">Learn →</p>
    </button>`
  ).join("");

  wrap.querySelectorAll("[data-guide-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const detail = btn.querySelector(".dispute-guide-detail");
      const cta = btn.querySelector(".dispute-guide-cta");
      const open = btn.getAttribute("aria-expanded") === "true";
      wrap.querySelectorAll("[data-guide-id]").forEach((other) => {
        if (other === btn) return;
        other.setAttribute("aria-expanded", "false");
        other.querySelector(".dispute-guide-detail")?.classList.add("hidden");
        const otherCta = other.querySelector(".dispute-guide-cta");
        if (otherCta) otherCta.textContent = "Learn →";
      });
      if (open) {
        btn.setAttribute("aria-expanded", "false");
        detail?.classList.add("hidden");
        if (cta) cta.textContent = "Learn →";
      } else {
        btn.setAttribute("aria-expanded", "true");
        detail?.classList.remove("hidden");
        if (cta) cta.textContent = "Close ←";
        if (btn.dataset.guideId === "open") {
          el("open-dispute-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    });
  });
}

function disputeCard(d) {
  const open = d.status === "open" || d.status === "under_review";
  const ticket = `TK-${d.id}`;
  return `
    <article class="dispute-card space-y-4">
      <div class="flex justify-between items-start gap-3 border-b border-zinc-900 pb-3">
        <div class="min-w-0 space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs font-mono text-zinc-500">Ticket #${escapeHtml(ticket)}</span>
            ${statusBadge(d.status)}
          </div>
          <h3 class="text-sm font-bold text-white">${escapeHtml(reasonLabel(d.reason))}</h3>
          <p class="text-[11px] font-mono text-zinc-500">${escapeHtml(d.orderRef)} · ${escapeHtml(formatWhen(d.createdAt))}</p>
        </div>
        <span class="text-xs font-bold font-mono text-emerald-400 shrink-0">${d.escrowFrozenAt ? "Escrow held" : "On file"}</span>
      </div>
      ${
        d.buyerStatement
          ? `<div class="rounded-xl border border-zinc-800 bg-black p-3 text-xs">
              <p class="font-bold text-white">Your statement</p>
              <p class="text-zinc-400 mt-1">${escapeHtml(d.buyerStatement)}</p>
            </div>`
          : ""
      }
      ${
        d.sellerResponse
          ? `<div class="rounded-xl border border-zinc-800 p-3 text-xs">
              <p class="font-bold text-white">Seller response</p>
              <p class="text-zinc-400 mt-1">${escapeHtml(d.sellerResponse)}</p>
            </div>`
          : ""
      }
      ${
        d.adminNotes
          ? `<p class="text-xs text-zinc-400"><span class="font-semibold text-zinc-300">Admin:</span> ${escapeHtml(d.adminNotes)}</p>`
          : ""
      }
      <div class="flex flex-wrap gap-2">
        <a href="track.html?order=${encodeURIComponent(d.orderRef || "")}" class="depop-btn-accent text-xs">
          ${open ? "Open track / add detail" : "View order"}
        </a>
        <a href="https://wa.me/254117422428?text=${encodeURIComponent(`Hi Sokoni, dispute ${ticket} / ${d.orderRef}`)}" target="_blank" rel="noopener" class="depop-btn-ghost text-xs">
          WhatsApp support
        </a>
      </div>
    </article>`;
}

async function loadDisputes() {
  const wrap = el("disputes-list");
  if (!wrap) return;
  const session = buyerSession();
  if (!session?.sessionToken) {
    wrap.innerHTML = `<p class="text-sm text-zinc-400">Verify WhatsApp above to load your tickets.</p>`;
    setStatus("Sign in to see open claims.");
    return;
  }
  wrap.innerHTML = `<p class="text-sm text-zinc-500">Loading…</p>`;
  setStatus("");
  try {
    const params = new URLSearchParams({ limit: "40" });
    window.SokoniBuyerAuth?.appendAuthQuery?.(params);
    const res = await fetch(`${DISPUTES_API}/mine?${params.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      wrap.innerHTML = `<p class="text-sm text-red-400">${escapeHtml(data.message || "Could not load disputes.")}</p>`;
      setStatus(data.message || "Could not load disputes.", true);
      return;
    }
    const disputes = Array.isArray(data.disputes) ? data.disputes : [];
    if (!disputes.length) {
      wrap.innerHTML = `<div class="dispute-card text-sm text-zinc-400">
        No tickets yet. Paid order problem? Use <strong class="text-white">Open a dispute</strong> below, or
        <a href="track.html" class="text-[#FF2300] font-semibold hover:underline">Track</a> your SKN-####.
      </div>`;
      setStatus("Signed in — no open tickets.");
      return;
    }
    wrap.innerHTML = disputes.map(disputeCard).join("");
    setStatus(`${disputes.length} ticket${disputes.length === 1 ? "" : "s"}`);
  } catch {
    wrap.innerHTML = `<p class="text-sm text-red-400">Network error.</p>`;
    setStatus("Network error.", true);
  }
}

async function submitOpenDispute(ev) {
  ev.preventDefault();
  const session = buyerSession();
  if (!session?.sessionToken || !session?.userId) {
    setOpenStatus("Verify WhatsApp above first.", true);
    el("buyer-auth-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const orderId = normalizeOrderId(el("open-dispute-order")?.value);
  const reason = el("open-dispute-reason")?.value || "other";
  const statement = String(el("open-dispute-statement")?.value || "").trim();
  if (!orderId) {
    setOpenStatus("Enter your SKN-#### order number.", true);
    return;
  }
  if (statement.length < 8) {
    setOpenStatus("Add a short statement (what went wrong).", true);
    return;
  }
  const btn = el("open-dispute-submit");
  if (btn) btn.disabled = true;
  setOpenStatus("Opening dispute…");
  try {
    const body = window.SokoniBuyerAuth?.authFields
      ? window.SokoniBuyerAuth.authFields({
          orderId,
          buyerUserId: session.userId,
          reason,
          statement,
        })
      : {
          orderId,
          buyerUserId: session.userId,
          reason,
          statement,
          phone: session.phone,
          sessionToken: session.sessionToken,
        };
    const res = await fetch(DISPUTES_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setOpenStatus(data.message || data.error || "Could not open dispute.", true);
      return;
    }
    const ticket = data.dispute?.id ? `TK-${data.dispute.id}` : "opened";
    setOpenStatus(`${ticket} — escrow held while Sokoni reviews.`);
    if (el("open-dispute-statement")) el("open-dispute-statement").value = "";
    void loadDisputes();
    el("disputes-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {
    setOpenStatus("Network error. Try again or WhatsApp Sokoni.", true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function syncSignedInUi() {
  const signedIn = isSignedIn();
  const hint = el("open-dispute-auth-hint");
  if (hint) {
    hint.textContent = signedIn
      ? "Signed in — enter your paid order number to open a claim."
      : "Verify WhatsApp above first, then submit your claim here.";
  }
}

function init() {
  renderGuides();
  window.SokoniBuyerAuth?.bindPanel?.({
    onVerified: () => {
      setStatus("WhatsApp verified.");
      syncSignedInUi();
      void loadDisputes();
    },
  });
  el("disputes-refresh-btn")?.addEventListener("click", () => void loadDisputes());
  el("open-dispute-form")?.addEventListener("submit", (ev) => void submitOpenDispute(ev));
  el("open-dispute-track-btn")?.addEventListener("click", () => {
    const orderId = normalizeOrderId(el("open-dispute-order")?.value);
    window.location.href = orderId ? `track.html?order=${encodeURIComponent(orderId)}` : "track.html";
  });

  syncSignedInUi();
  if (isSignedIn()) {
    void loadDisputes();
  } else {
    const wrap = el("disputes-list");
    if (wrap) {
      wrap.innerHTML = `<p class="text-sm text-zinc-400">Verify WhatsApp above to load your tickets.</p>`;
    }
  }

  const params = new URLSearchParams(window.location.search);
  const prefill = normalizeOrderId(params.get("order") || params.get("orderId") || "");
  if (prefill && el("open-dispute-order")) {
    el("open-dispute-order").value = prefill;
    el("open-dispute-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

document.addEventListener("DOMContentLoaded", init);
