const API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001"
    : "https://bot.sokonimall.com";

const SOCIAL_API = `${API_BASE}/api/social`;

function el(id) {
  return document.getElementById(id);
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
  node.classList.toggle("text-brand-green", !isError && Boolean(message));
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
    ? `<a href="${shopLink}" class="font-semibold hover:text-brand-green underline">${peerName}</a> ${handleLabel}`
    : `<strong>${peerName}</strong> ${handleLabel}`;

  let body = "";
  const type = String(event?.type || "");
  if (type === "offer_accepted") {
    const title = escapeHtml(event?.product?.title || "your offer");
    const amount = formatKes(event?.offer?.amountKsh);
    body = `${peerHtml} accepted your offer on <em>${title}</em>${
      amount ? ` (${escapeHtml(amount)})` : ""
    }.`;
  } else if (type === "offer_declined") {
    const title = escapeHtml(event?.product?.title || "your offer");
    body = `${peerHtml} declined your offer on <em>${title}</em>.`;
  } else if (type === "offer_expired") {
    const title = escapeHtml(event?.product?.title || "your offer");
    body = `Your offer on <em>${title}</em> expired before ${peerHtml} replied.`;
  } else if (type === "follow") {
    body = `You followed ${peerHtml}.`;
  } else if (type === "like") {
    const title = escapeHtml(event?.product?.title || "an item");
    body = `You liked <em>${title}</em>${handle ? ` from ${peerHtml}` : ""}.`;
  } else {
    body = `${peerHtml} — activity update.`;
  }

  const actions = [];
  if (shopLink) {
    actions.push(`<a href="${shopLink}" class="text-xs font-semibold underline hover:text-brand-green">View shop</a>`);
  }
  if (
    (type === "offer_accepted" || type === "offer_declined") &&
    event?.peer?.userId
  ) {
    actions.push(
      `<a href="${inboxHref(event.peer.userId, handle)}" class="text-xs font-semibold underline hover:text-brand-green">Open chat</a>`
    );
  }

  return `
    <article class="rounded-2xl border border-black/5 dark:border-white/10 px-4 py-3">
      <p class="text-sm">${body}</p>
      <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p class="text-[11px] text-brand-purple/55 dark:text-white/60">${when}</p>
        <div class="flex flex-wrap gap-3">${actions.join("")}</div>
      </div>
    </article>`;
}

async function loadActivity() {
  const list = el("activity-list");
  const empty = el("activity-empty");
  if (!list || !empty) return;

  const session = window.SokoniBuyerAuth?.readSession?.();
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
  node.classList.toggle("text-brand-green", !isError && Boolean(message));
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
