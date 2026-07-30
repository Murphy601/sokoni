const API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001"
    : "https://bot.sokonimall.com";

const SOCIAL_API = `${API_BASE}/api/social`;

function el(id) {
  return document.getElementById(id);
}

function offerCheckoutHref(offerId) {
  const id = Number(offerId);
  if (!Number.isInteger(id) || id < 1) return "";
  return `checkout.html?offerId=${id}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function formatKes(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return `KES ${Math.round(amount).toLocaleString()}`;
}

function formatWhen(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("en-KE", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function setStatus(message, isError = false) {
  const node = el("activity-status");
  if (!node) return;
  node.textContent = message || "";
  node.classList.toggle("text-red-600", isError);
  node.classList.toggle("dark:text-red-400", isError);
  node.classList.toggle("text-emerald-400", !isError && Boolean(message));
}

function shopHref(handle) {
  const clean = normalizeHandle(handle);
  if (!clean) return "";
  const params = new URLSearchParams({ handle: clean });
  const session = window.SokoniBuyerAuth?.readSession?.();
  if (session?.userId) params.set("viewer", String(session.userId));
  return `shop.html?${params.toString()}`;
}

function inboxHref(peerUserId, handle) {
  const session = window.SokoniBuyerAuth?.readSession?.();
  if (!session?.userId || !peerUserId) return "inbox.html";
  const params = new URLSearchParams({
    viewer: String(session.userId),
    with: String(peerUserId),
  });
  const clean = normalizeHandle(handle);
  if (clean) params.set("handle", clean);
  return `inbox.html?${params.toString()}`;
}

function eventCard(event) {
  const peerName = escapeHtml(event?.peer?.shopName || "a shop");
  const handle = normalizeHandle(event?.peer?.handle || "");
  const handleLabel = handle ? `@${escapeHtml(handle)}` : "";
  const when = escapeHtml(formatWhen(event?.createdAt));
  const shopLink = shopHref(handle);
  const peerHtml = shopLink
    ? `<a href="${shopLink}" class="font-semibold text-white hover:text-[#FF2300] underline">${peerName}</a> <span class="text-zinc-400">${handleLabel}</span>`
    : `<strong class="text-white">${peerName}</strong> <span class="text-zinc-400">${handleLabel}</span>`;

  let body = "";
  let pillClass = "sell-activity-pill";
  let pillLabel = "Activity";
  const type = String(event?.type || "");
  if (type === "offer_accepted") {
    const title = escapeHtml(event?.product?.title || "your offer");
    const amount = formatKes(event?.offer?.amountKsh);
    body = `${peerHtml} accepted your offer on <em class="text-zinc-200 not-italic font-semibold">${title}</em>${
      amount ? ` (${escapeHtml(amount)})` : ""
    }.`;
    pillClass = "sell-activity-pill sell-activity-pill--like";
    pillLabel = "Accepted";
  } else if (type === "offer_declined") {
    const title = escapeHtml(event?.product?.title || "your offer");
    body = `${peerHtml} declined your offer on <em class="text-zinc-200 not-italic font-semibold">${title}</em>.`;
    pillClass = "sell-activity-pill sell-activity-pill--follow";
    pillLabel = "Declined";
  } else if (type === "offer_expired") {
    const title = escapeHtml(event?.product?.title || "your offer");
    body = `Your offer on <em class="text-zinc-200 not-italic font-semibold">${title}</em> expired before ${peerHtml} replied.`;
    pillLabel = "Expired";
  } else if (type === "follow") {
    body = `You followed ${peerHtml}.`;
    pillClass = "sell-activity-pill sell-activity-pill--follow";
    pillLabel = "Follow";
  } else if (type === "like") {
    const title = escapeHtml(event?.product?.title || "an item");
    body = `You liked <em class="text-zinc-200 not-italic font-semibold">${title}</em>${handle ? ` from ${peerHtml}` : ""}.`;
    pillClass = "sell-activity-pill sell-activity-pill--like";
    pillLabel = "Like";
  } else {
    body = `${peerHtml} — activity update.`;
  }

  const actions = [];
  if (type === "offer_accepted") {
    const payHref = offerCheckoutHref(event?.offer?.id);
    if (payHref) {
      const amountLabel = formatKes(event?.offer?.amountKsh);
      actions.push(
        `<a href="${payHref}" class="text-xs font-bold text-[#FF2300] underline hover:opacity-90">${
          amountLabel ? `Pay ${escapeHtml(amountLabel)} on Sokoni` : "Pay agreed price on Sokoni"
        }</a>`
      );
    }
  }
  if (shopLink) {
    actions.push(`<a href="${shopLink}" class="text-xs font-semibold text-zinc-400 underline hover:text-white">View shop</a>`);
  }
  if (
    (type === "offer_accepted" || type === "offer_declined") &&
    event?.peer?.userId
  ) {
    actions.push(
      `<a href="${inboxHref(event.peer.userId, handle)}" class="text-xs font-semibold text-zinc-400 underline hover:text-white">Open chat</a>`
    );
  }

  return `
    <article class="sell-activity-row" data-activity-type="${escapeHtml(type)}">
      <div class="flex items-start justify-between gap-3">
        <p class="text-sm text-zinc-300 leading-snug">${body}</p>
        <span class="${pillClass}">${pillLabel}</span>
      </div>
      <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p class="text-[11px] text-zinc-500 font-mono">${when}</p>
        <div class="flex flex-wrap gap-3">${actions.join("")}</div>
      </div>
    </article>`;
}

async function loadBuyerRatings() {
  const summary = el("buyer-ratings-summary");
  const list = el("buyer-ratings-list");
  if (!summary || !list) return;
  const session = window.SokoniBuyerAuth?.readSession?.();
  if (!session?.userId) {
    summary.textContent = "Sign in to see ratings sellers left for you.";
    list.innerHTML = "";
    return;
  }
  try {
    const res = await fetch(`${SOCIAL_API}/reviews/buyer/${encodeURIComponent(session.userId)}?limit=8`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      summary.textContent = data?.message || "Ratings unavailable right now.";
      list.innerHTML = "";
      return;
    }
    const total = Number(data.totalReviews || 0);
    const avg = Number(data.avgRating || 0);
    summary.textContent =
      total > 0 ? `★ ${avg.toFixed(1)} · ${total.toLocaleString()} seller rating${total === 1 ? "" : "s"}` : "No seller ratings yet.";
    const reviews = Array.isArray(data.reviews) ? data.reviews : [];
    list.innerHTML = reviews
      .map((r) => {
        const stars = "★".repeat(Math.max(1, Math.min(5, Number(r.rating) || 0)));
        return `<article class="sell-activity-row !py-2">
          <p class="text-sm font-semibold text-white">${stars} · ${escapeHtml(r.orderRef || "Order")}</p>
          ${r.comment ? `<p class="text-xs text-zinc-400 mt-1">${escapeHtml(r.comment)}</p>` : ""}
        </article>`;
      })
      .join("");
  } catch {
    summary.textContent = "Could not load ratings.";
    list.innerHTML = "";
  }
}

async function loadActivity() {
  const list = el("activity-list");
  const empty = el("activity-empty");
  if (!list || !empty) return;

  const session = window.SokoniBuyerAuth?.readSession?.();
  void loadBuyerRatings();
  if (!session?.userId) {
    list.innerHTML = "";
    empty.textContent = "Verify WhatsApp above to see your activity.";
    empty.classList.remove("hidden");
    setStatus("Sign in to load offers, follows, and likes.");
    el("activity-notify-row")?.classList.add("hidden");
    return;
  }

  el("activity-notify-row")?.classList.remove("hidden");
  void loadNotifyPrefs();

  setStatus("Loading activity…");
  list.innerHTML = "";
  empty.classList.add("hidden");

  try {
    const params = new URLSearchParams({ limit: "40" });
    if (window.SokoniBuyerAuth?.appendAuthQuery) {
      window.SokoniBuyerAuth.appendAuthQuery(params);
    }
    const res = await fetch(`${SOCIAL_API}/buyer/activity?${params.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data?.message || "Could not load activity right now.", true);
      empty.textContent = data?.message || "Could not load activity right now.";
      empty.classList.remove("hidden");
      return;
    }

    const events = Array.isArray(data?.events) ? data.events : [];
    if (!events.length) {
      setStatus("");
      empty.textContent =
        "Nothing here yet. Like an item, follow a shop, or make an offer — updates show up here.";
      empty.classList.remove("hidden");
      return;
    }

    setStatus(`${events.length} recent update${events.length === 1 ? "" : "s"}`);
    empty.classList.add("hidden");
    list.innerHTML = events.map((event) => eventCard(event)).join("");
  } catch {
    setStatus("Network error while loading activity.", true);
    empty.textContent = "Network error while loading activity.";
    empty.classList.remove("hidden");
  }
}

function setNotifyStatus(message, isError = false) {
  const node = el("activity-notify-status");
  if (!node) return;
  node.textContent = message || "";
  node.classList.toggle("text-red-600", isError);
  node.classList.toggle("dark:text-red-400", isError);
  node.classList.toggle("text-emerald-400", !isError && Boolean(message));
}

function applyNotifyPrefs(data = {}) {
  const master = el("activity-wa-notify");
  const offers = el("activity-wa-notify-offers");
  if (master) master.checked = data.socialWaNotify !== false;
  if (offers) offers.checked = data.socialWaNotifyOffers !== false;
}

async function loadNotifyPrefs() {
  const session = window.SokoniBuyerAuth?.readSession?.();
  if (!el("activity-wa-notify") || !session?.sessionToken) return;
  try {
    const params = new URLSearchParams();
    if (window.SokoniBuyerAuth?.appendAuthQuery) {
      window.SokoniBuyerAuth.appendAuthQuery(params);
    }
    const res = await fetch(`${SOCIAL_API}/notify-prefs?${params.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;
    applyNotifyPrefs(data);
  } catch {
    /* keep default */
  }
}

async function saveNotifyPrefs() {
  const master = el("activity-wa-notify");
  const offers = el("activity-wa-notify-offers");
  const session = window.SokoniBuyerAuth?.readSession?.();
  if (!master || !session?.sessionToken) return;
  setNotifyStatus("Saving…");
  try {
    const fields = {
      socialWaNotify: master.checked,
      socialWaNotifyOffers: offers ? offers.checked : true,
    };
    const payload = window.SokoniBuyerAuth?.authFields
      ? window.SokoniBuyerAuth.authFields(fields)
      : fields;
    const res = await fetch(`${SOCIAL_API}/notify-prefs`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotifyStatus(data?.message || "Could not save preference.", true);
      return;
    }
    applyNotifyPrefs(data);
    setNotifyStatus(data?.message || "Preferences saved.");
  } catch {
    setNotifyStatus("Network error while saving preference.", true);
  }
}

function init() {
  window.SokoniBuyerAuth?.bindPanel?.({
    onVerified: () => {
      setStatus("WhatsApp verified — loading your activity.");
      void loadActivity();
    },
  });
  el("activity-refresh-btn")?.addEventListener("click", () => loadActivity());
  el("activity-wa-notify")?.addEventListener("change", () => saveNotifyPrefs());
  el("activity-wa-notify-offers")?.addEventListener("change", () => saveNotifyPrefs());
  void loadActivity();
}

document.addEventListener("DOMContentLoaded", init);
