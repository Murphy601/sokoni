const API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001"
    : "https://bot.sokonimall.com";

const WHATSAPP_NUMBER = "254117422428";
const SHOP_API_BASE = `${API_BASE}/api/social`;
const PRODUCT_API_BASE = `${API_BASE}/api/products`;

const state = {
  activeHandle: "",
  viewerUserId: null,
  following: false,
  likedProductIds: new Set(),
  currentShop: null,
  listingsTab: "active",
  reviewsRequestToken: 0,
  socialListRequestToken: 0,
  socialListDirection: null,
  reviewRating: 0,
  reviewableOrders: [],
};

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

function formatHandle(value) {
  const clean = normalizeHandle(value);
  return clean ? `@${clean}` : "";
}

function formatKes(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "KES —";
  return `KES ${Math.round(amount).toLocaleString()}`;
}

function formatReviewDate(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("en-KE", { dateStyle: "medium" }).format(new Date(value));
  } catch {
    return "";
  }
}

function reviewStars(value) {
  const score = Math.max(1, Math.min(5, Number(value) || 0));
  return `${"★".repeat(score)}${"☆".repeat(5 - score)}`;
}

function statusMessage(message, isError = false) {
  const node = el("shop-status");
  if (!node) return;
  node.textContent = message || "";
  node.classList.toggle("text-red-600", isError);
  node.classList.toggle("dark:text-red-400", isError);
  node.classList.toggle("text-brand-green", !isError && Boolean(message));
}

function parseViewerUserId() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("viewer") || params.get("viewerUserId");
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 1) return null;
  return num;
}

function resolveViewerUserId() {
  const sessionUserId = window.SokoniBuyerAuth?.readSession?.()?.userId;
  if (Number.isInteger(sessionUserId) && sessionUserId > 0) return sessionUserId;
  return parseViewerUserId();
}

function isBuyerSessionAuthError(payload) {
  const code = String(payload?.error || "")
    .trim()
    .toLowerCase();
  return (
    code === "session_required" ||
    code === "session_invalid" ||
    code === "session_expired" ||
    code === "buyer_session_mismatch"
  );
}

function buyerAuthBody(extra = {}) {
  if (window.SokoniBuyerAuth?.authFields) {
    return window.SokoniBuyerAuth.authFields(extra);
  }
  return { ...extra };
}

function shopFetchQuery(extra = {}) {
  const params = new URLSearchParams();
  Object.entries(extra).forEach(([key, value]) => {
    if (value == null || value === "") return;
    params.set(key, String(value));
  });
  if (window.SokoniBuyerAuth?.appendAuthQuery) {
    window.SokoniBuyerAuth.appendAuthQuery(params);
  }
  const viewerId = resolveViewerUserId();
  if (viewerId && !params.has("viewer") && !params.has("viewerUserId")) {
    params.set("viewer", String(viewerId));
  }
  return params;
}

function applyViewerState(payload = {}) {
  const viewer = payload?.viewer || null;
  if (viewer?.userId) {
    state.viewerUserId = Number(viewer.userId) || state.viewerUserId;
  } else {
    state.viewerUserId = resolveViewerUserId();
  }
  state.following = Boolean(viewer?.isFollowing);
  state.likedProductIds = new Set(
    Array.isArray(viewer?.likedProductIds) ? viewer.likedProductIds.map(String) : []
  );
  (Array.isArray(payload?.products) ? payload.products : []).forEach((product) => {
    if (product?.liked && product?.id) state.likedProductIds.add(String(product.id));
  });
}

function readHandleFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const queryHandle = params.get("handle");
  if (queryHandle) return normalizeHandle(queryHandle);

  const parts = window.location.pathname.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p.toLowerCase() === "shop");
  if (idx >= 0 && parts[idx + 1]) return normalizeHandle(parts[idx + 1]);
  return "";
}

function setHandleInUrl(handle) {
  const params = new URLSearchParams(window.location.search);
  params.set("handle", handle);
  const next = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, "", next);
}

function waLinkForShop(shop) {
  const shopHandle = shop?.handle || "";
  const shopName = shop?.shopName || "your shop";
  const message = `Hi ${shopHandle || shopName}, I found your items on Sokoni and want to order.`;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

function buildOrderLink(product, shop) {
  const id = product.id || "";
  const title = product.title || "item";
  const handle = shop?.handle || "shop";
  const message = `Hi ${handle}, nataka kuorder ${title} (${id}) from Sokoni.`;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

function inboxLinkForShop(shop) {
  const shopUserId = Number(shop?.userId);
  if (!Number.isInteger(state.viewerUserId) || !Number.isInteger(shopUserId)) return "inbox.html";
  const params = new URLSearchParams({
    viewer: String(state.viewerUserId),
    with: String(shopUserId),
  });
  const handle = normalizeHandle(shop?.handle || "");
  if (handle) params.set("handle", handle);
  return `inbox.html?${params.toString()}`;
}

function resetReviewsUi() {
  state.reviewsRequestToken += 1;
  state.reviewRating = 0;
  state.reviewableOrders = [];
  const list = el("shop-reviews-list");
  const count = el("shop-reviews-count");
  const empty = el("shop-reviews-empty");
  if (list) list.innerHTML = "";
  if (count) count.textContent = "No ratings yet";
  if (empty) {
    empty.textContent = "No reviews yet. Be the first to rate after a delivered order.";
    empty.classList.add("hidden");
  }
  syncStarButtons();
  const orderSelect = el("shop-review-order");
  if (orderSelect) {
    orderSelect.innerHTML = `<option value="">Select a delivered order…</option>`;
  }
  const manual = el("shop-review-order-manual");
  if (manual) manual.value = "";
  const comment = el("shop-review-comment");
  if (comment) comment.value = "";
  const rating = el("shop-review-rating");
  if (rating) rating.value = "";
  setReviewStatus("");
}

function setReviewStatus(message, isError = false) {
  const node = el("shop-review-status");
  if (!node) return;
  node.textContent = message || "";
  node.classList.toggle("text-red-600", isError);
  node.classList.toggle("dark:text-red-400", isError);
  node.classList.toggle("text-brand-green", !isError && Boolean(message));
}

function syncStarButtons() {
  const selected = Number(state.reviewRating) || 0;
  document.querySelectorAll(".shop-star-btn").forEach((btn) => {
    const n = Number(btn.dataset.stars) || 0;
    const on = selected > 0 && n <= selected;
    btn.classList.toggle("bg-brand-green", on);
    btn.classList.toggle("text-brand-purple", on);
    btn.classList.toggle("border-brand-green", on);
    btn.setAttribute("aria-checked", on && n === selected ? "true" : "false");
  });
  const hidden = el("shop-review-rating");
  if (hidden) hidden.value = selected ? String(selected) : "";
}

function populateReviewableOrders(orders = []) {
  state.reviewableOrders = Array.isArray(orders) ? orders : [];
  const select = el("shop-review-order");
  if (!select) return;
  const options = [`<option value="">Select a delivered order…</option>`];
  for (const order of state.reviewableOrders) {
    const id = escapeHtml(order.orderRef || order.orderId || "");
    const title = escapeHtml(order.productName || "Order");
    options.push(`<option value="${id}">${id} · ${title}</option>`);
  }
  select.innerHTML = options.join("");
}

async function loadReviewableOrders(shop) {
  const shopUserId = Number(shop?.userId);
  const session = window.SokoniBuyerAuth?.readSession?.();
  if (!Number.isInteger(shopUserId) || shopUserId < 1 || !session?.userId || !session?.sessionToken) {
    populateReviewableOrders([]);
    return;
  }
  if (Number(session.userId) === shopUserId) {
    populateReviewableOrders([]);
    setReviewStatus("This is your shop — buyers rate you after delivery.");
    return;
  }
  try {
    const params = new URLSearchParams({ sellerUserId: String(shopUserId), limit: "20" });
    if (window.SokoniBuyerAuth?.appendAuthQuery) {
      window.SokoniBuyerAuth.appendAuthQuery(params);
    }
    const res = await fetch(`${SHOP_API_BASE}/reviews/reviewable?${params.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      populateReviewableOrders([]);
      return;
    }
    populateReviewableOrders(data.orders || []);
    if (!(data.orders || []).length) {
      setReviewStatus("No delivered orders with this shop yet — enter your SK number after delivery.");
    } else {
      setReviewStatus(`${data.orders.length} delivered order${data.orders.length === 1 ? "" : "s"} ready to rate.`);
    }
  } catch {
    populateReviewableOrders([]);
  }
}

async function submitShopReview(ev) {
  ev?.preventDefault?.();
  const shop = state.currentShop;
  const shopUserId = Number(shop?.userId);
  const session = window.SokoniBuyerAuth?.readSession?.();
  if (!Number.isInteger(shopUserId) || shopUserId < 1) {
    setReviewStatus("Load a shop first.", true);
    return;
  }
  if (!session?.userId || !session?.sessionToken) {
    setReviewStatus("Verify WhatsApp above to leave a review.", true);
    el("buyer-auth-phone")?.focus();
    return;
  }
  if (Number(session.userId) === shopUserId) {
    setReviewStatus("You cannot rate your own shop.", true);
    return;
  }

  const orderRef = String(
    el("shop-review-order")?.value || el("shop-review-order-manual")?.value || ""
  )
    .trim()
    .toUpperCase();
  const rating = Number(el("shop-review-rating")?.value || state.reviewRating);
  const comment = String(el("shop-review-comment")?.value || "").trim();

  if (!orderRef) {
    setReviewStatus("Enter or select your delivered order number (SKN-xxxx).", true);
    return;
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    setReviewStatus("Tap a star rating from 1 to 5.", true);
    return;
  }

  const btn = el("shop-review-submit");
  if (btn) btn.disabled = true;
  setReviewStatus("Sending review…");
  try {
    const fields = {
      orderId: orderRef,
      sellerUserId: shopUserId,
      buyerUserId: session.userId,
      rating,
      comment,
    };
    const payload = window.SokoniBuyerAuth?.authFields
      ? window.SokoniBuyerAuth.authFields(fields)
      : fields;
    const res = await fetch(`${SHOP_API_BASE}/reviews/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setReviewStatus(data?.message || data?.error || "Could not save review.", true);
      return;
    }
    setReviewStatus("Asante! Your review is live.");
    el("shop-review-comment").value = "";
    el("shop-review-order-manual").value = "";
    state.reviewRating = 0;
    syncStarButtons();
    await loadReviewableOrders(shop);
    await loadShopReviews(shop, shop.stats || {});
    // refresh header rating metric
    if (state.activeHandle) void loadShop(state.activeHandle);
  } catch {
    setReviewStatus("Network error while saving review.", true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function bindReviewForm() {
  document.querySelectorAll(".shop-star-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.reviewRating = Number(btn.dataset.stars) || 0;
      syncStarButtons();
    });
  });
  el("shop-review-form")?.addEventListener("submit", (ev) => {
    void submitShopReview(ev);
  });
}

function reviewCard(review) {
  const buyerId = Number(review?.buyerUserId);
  const buyerLabel = Number.isInteger(buyerId) && buyerId > 0 ? `Buyer #${buyerId}` : "Verified buyer";
  const comment = String(review?.comment || "").trim();
  const date = formatReviewDate(review?.createdAt);
  return `
    <article class="rounded-2xl border border-black/5 dark:border-white/10 bg-brand-cream/45 dark:bg-white/5 p-4">
      <div class="flex items-center justify-between gap-2">
        <p class="text-sm font-semibold">${escapeHtml(buyerLabel)}</p>
        <p class="text-[11px] text-brand-purple/55 dark:text-white/60">${escapeHtml(date)}</p>
      </div>
      <p class="text-sm mt-1">${escapeHtml(reviewStars(review?.rating))}</p>
      ${
        comment
          ? `<p class="text-sm text-brand-purple/70 dark:text-white/75 mt-2">${escapeHtml(comment)}</p>`
          : `<p class="text-xs text-brand-purple/55 dark:text-white/65 mt-2">Rated after delivery.</p>`
      }
    </article>`;
}

async function loadShopReviews(shop, stats = {}) {
  const list = el("shop-reviews-list");
  const count = el("shop-reviews-count");
  const empty = el("shop-reviews-empty");
  if (!list || !count || !empty) return;

  const shopUserId = Number(shop?.userId);
  const statsTotal = Number(stats?.totalReviews || 0);
  if (!Number.isInteger(shopUserId) || shopUserId < 1) {
    list.innerHTML = "";
    count.textContent = statsTotal > 0 ? `${statsTotal.toLocaleString()} ratings` : "No ratings yet";
    empty.textContent = "No reviews yet. Buyers can rate this shop after delivered orders.";
    empty.classList.remove("hidden");
    return;
  }

  const token = state.reviewsRequestToken + 1;
  state.reviewsRequestToken = token;
  list.innerHTML = "";
  empty.classList.add("hidden");
  count.textContent = statsTotal > 0 ? `${statsTotal.toLocaleString()} ratings` : "Loading ratings...";

  try {
    const res = await fetch(`${SHOP_API_BASE}/reviews/seller/${shopUserId}?limit=8`);
    const data = await res.json();
    if (token !== state.reviewsRequestToken) return;

    if (!res.ok) {
      count.textContent = "Ratings unavailable right now";
      empty.textContent = "Could not load reviews right now. Please try again in a moment.";
      empty.classList.remove("hidden");
      return;
    }

    const reviews = Array.isArray(data?.reviews) ? data.reviews : [];
    const shownCount = reviews.length;
    const total = statsTotal > 0 ? statsTotal : Number(data?.count || shownCount);
    if (!shownCount) {
      count.textContent = total > 0 ? `${total.toLocaleString()} ratings` : "No ratings yet";
      empty.textContent = "No reviews yet. Buyers can rate this shop after delivered orders.";
      empty.classList.remove("hidden");
      return;
    }

    if (total > shownCount) {
      count.textContent = `Latest ${shownCount.toLocaleString()} of ${total.toLocaleString()} ratings`;
    } else {
      count.textContent = `${total.toLocaleString()} rating${total === 1 ? "" : "s"}`;
    }
    list.innerHTML = reviews.map((review) => reviewCard(review)).join("");
  } catch {
    if (token !== state.reviewsRequestToken) return;
    count.textContent = "Ratings unavailable right now";
    empty.textContent = "Could not load reviews right now. Please try again in a moment.";
    empty.classList.remove("hidden");
  }
}

function renderShopHeader(payload) {
  const shop = payload.shop || {};
  const stats = payload.stats || {};
  state.currentShop = { ...shop, stats };

  el("shop-name").textContent = shop.shopName || "Shop";
  el("shop-handle").textContent = shop.handle || "";

  const trustBadges = window.SokoniSellerTrust?.resolveBadges?.(stats.trust || shop, { max: 4 }) || [];
  const trustIds = new Set(trustBadges.map((b) => b.id));

  const verified = el("shop-verified");
  if (verified) {
    // Prefer trust.badges strip; keep legacy chip only when trust payload absent.
    const showLegacyVerified = Boolean(shop.isSellerVerified) && !trustBadges.length;
    verified.classList.toggle("hidden", !showLegacyVerified);
  }

  const avg = Number(stats.avgRating || 0);
  const totalReviews = Number(stats.totalReviews || 0);
  const trustPayload = stats.trust || shop;
  const unrated =
    trustPayload.unrated === true ||
    (trustPayload.unrated !== false &&
      (trustPayload.displayLabel === "UNRATED" || totalReviews < 5));
  const topSeller = el("shop-top-seller");
  if (topSeller) {
    const qualifies =
      !trustIds.has("top_seller") &&
      !trustIds.has("top_rated") &&
      !unrated &&
      avg >= 4.8 &&
      totalReviews >= 20;
    topSeller.classList.toggle("hidden", !qualifies);
  }

  const trustRow = el("shop-trust-badges");
  if (trustRow) {
    // badgesHtml wraps in a span — inject inner chips only into the host node.
    const wrapped =
      window.SokoniSellerTrust?.badgesHtml?.(trustPayload, {
        max: 4,
        className: "seller-trust-badges-inner",
      }) || "";
    const tmp = document.createElement("div");
    tmp.innerHTML = wrapped;
    trustRow.innerHTML = tmp.firstElementChild?.innerHTML || "";
    trustRow.classList.toggle("hidden", !trustBadges.length);
  }

  const bio = el("shop-bio");
  if (bio) {
    if (shop.bio) {
      bio.textContent = shop.bio;
      bio.classList.remove("hidden");
    } else {
      bio.classList.add("hidden");
    }
  }

  const promoBanner = el("shop-promo-banner");
  if (promoBanner) {
    if (shop.promoBanner) {
      promoBanner.textContent = shop.promoBanner;
      promoBanner.classList.remove("hidden");
    } else {
      promoBanner.classList.add("hidden");
    }
  }
  const offerNote = el("shop-offer-note");
  if (offerNote) {
    if (shop.offerNote) {
      offerNote.textContent = shop.offerNote;
      offerNote.classList.remove("hidden");
    } else {
      offerNote.classList.add("hidden");
    }
  }

  const location = el("shop-location");
  if (location) {
    if (shop.location) {
      location.textContent = shop.location;
      location.classList.remove("hidden");
    } else {
      location.classList.add("hidden");
    }
  }

  const socialLinks = el("shop-social-links");
  if (socialLinks) {
    const parts = [];
    if (shop.instagramUrl) {
      parts.push(
        `<a href="${escapeHtml(shop.instagramUrl)}" target="_blank" rel="noopener" class="underline hover:text-brand-green">Instagram</a>`
      );
    }
    if (shop.tiktokUrl) {
      parts.push(
        `<a href="${escapeHtml(shop.tiktokUrl)}" target="_blank" rel="noopener" class="underline hover:text-brand-green">TikTok</a>`
      );
    }
    if (parts.length) {
      socialLinks.innerHTML = parts.join('<span aria-hidden="true">·</span>');
      socialLinks.classList.remove("hidden");
    } else {
      socialLinks.innerHTML = "";
      socialLinks.classList.add("hidden");
    }
  }

  el("shop-rating").textContent = unrated
    ? totalReviews > 0
      ? `UNRATED · ${totalReviews.toLocaleString()} review${totalReviews === 1 ? "" : "s"}`
      : "New store · UNRATED"
    : `★ ${avg.toFixed(1)} (${totalReviews.toLocaleString()} reviews)`;

  el("shop-listings-count").textContent = String(Number(stats.listingsCount || 0));
  el("shop-followers-count").textContent = String(Number(stats.followersCount || 0));
  el("shop-following-count").textContent = String(Number(stats.followingCount || 0));
  el("shop-likes-count").textContent = String(Number(stats.likesReceivedCount || 0));
  const reviewsMetric = el("shop-reviews-metric");
  if (reviewsMetric) {
    reviewsMetric.textContent = unrated
      ? totalReviews > 0
        ? `UNRATED · ${totalReviews.toLocaleString()}`
        : "No reviews yet"
      : `★ ${avg.toFixed(1)} · ${totalReviews.toLocaleString()}`;
  }
  const salesMetric = el("shop-sales-metric");
  if (salesMetric) {
    const sales = Number(stats.salesCount ?? stats.soldCount ?? 0);
    salesMetric.textContent = sales > 0 ? `${sales.toLocaleString()} sold` : "No sales yet";
  }
  const dispatchMetric = el("shop-dispatch-metric");
  if (dispatchMetric) {
    const hours = Number(stats.avgDispatchHours);
    if (Number.isFinite(hours) && hours > 0) {
      dispatchMetric.textContent =
        hours < 24 ? `~${hours}h` : `~${Math.round((hours / 24) * 10) / 10} days`;
    } else {
      dispatchMetric.textContent = "Building history";
    }
  }
  syncListingsTabs();
  bindSocialListButtons(shop);
  closeSocialList();

  const avatarWrap = el("shop-avatar");
  if (avatarWrap) {
    const initial = (shop.shopName || "S").trim().charAt(0).toUpperCase();
    if (shop.avatarUrl) {
      avatarWrap.innerHTML = `<img src="${escapeHtml(shop.avatarUrl)}" alt="${escapeHtml(
        shop.shopName || "Shop avatar"
      )}" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<span class=\\'text-2xl font-bold text-brand-purple/45 dark:text-white/55\\'>${escapeHtml(
        initial
      )}</span>'" />`;
    } else {
      avatarWrap.innerHTML = `<span class="text-2xl font-bold text-brand-purple/45 dark:text-white/55">${escapeHtml(
        initial
      )}</span>`;
    }
  }

  const waCta = el("shop-wa-cta");
  if (waCta) waCta.href = waLinkForShop(shop);

  renderFollowButton(shop, stats);
  renderMessageButton(shop);
  void loadShopReviews(shop, stats);
}

function socialListUserRow(user) {
  const handle = normalizeHandle(user?.handle || "");
  const name = escapeHtml(user?.shopName || user?.displayName || handle || `User ${user?.userId || ""}`);
  const handleLabel = handle ? `@${escapeHtml(handle)}` : "No handle yet";
  const href = handle
    ? `shop.html?handle=${encodeURIComponent(handle)}${
        state.viewerUserId ? `&viewer=${encodeURIComponent(String(state.viewerUserId))}` : ""
      }`
    : "";
  const verified = user?.isSellerVerified
    ? `<span class="text-[10px] font-semibold text-brand-green">Verified</span>`
    : "";
  const inner = `
    <div class="min-w-0">
      <p class="text-sm font-semibold truncate">${name}</p>
      <p class="text-xs text-brand-purple/55 dark:text-white/65 truncate">${handleLabel}</p>
    </div>
    ${verified}`;
  if (!href) {
    return `<div class="flex items-center justify-between gap-3 py-2 border-b border-black/5 dark:border-white/10 last:border-0">${inner}</div>`;
  }
  return `<a href="${href}" class="flex items-center justify-between gap-3 py-2 border-b border-black/5 dark:border-white/10 last:border-0 hover:text-brand-green focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green rounded-lg">${inner}</a>`;
}

function setSocialListExpanded(direction, expanded) {
  const panel = el("shop-social-list");
  const followersBtn = el("shop-followers-btn");
  const followingBtn = el("shop-following-btn");
  if (followersBtn) followersBtn.setAttribute("aria-expanded", direction === "followers" && expanded ? "true" : "false");
  if (followingBtn) followingBtn.setAttribute("aria-expanded", direction === "following" && expanded ? "true" : "false");
  if (!panel) return;
  if (expanded) {
    panel.classList.remove("hidden");
    panel.removeAttribute("hidden");
  } else {
    panel.classList.add("hidden");
    panel.setAttribute("hidden", "");
  }
}

function closeSocialList() {
  state.socialListDirection = null;
  state.socialListRequestToken += 1;
  setSocialListExpanded(null, false);
  const body = el("shop-social-list-body");
  const empty = el("shop-social-list-empty");
  if (body) body.innerHTML = "";
  if (empty) empty.classList.add("hidden");
}

async function openSocialList(direction) {
  const shopUserId = Number(state.currentShop?.userId);
  const panelTitle = el("shop-social-list-title");
  const body = el("shop-social-list-body");
  const empty = el("shop-social-list-empty");
  if (!panelTitle || !body || !empty) return;

  if (state.socialListDirection === direction) {
    closeSocialList();
    return;
  }

  if (!Number.isInteger(shopUserId) || shopUserId < 1) {
    statusMessage("This shop profile is not linked to a user account yet.", true);
    return;
  }

  state.socialListDirection = direction;
  const token = state.socialListRequestToken + 1;
  state.socialListRequestToken = token;
  setSocialListExpanded(direction, true);
  panelTitle.textContent = direction === "following" ? "Following" : "Followers";
  body.innerHTML = `<p class="text-sm text-brand-purple/60 dark:text-white/65">Loading…</p>`;
  empty.classList.add("hidden");

  try {
    const res = await fetch(
      `${SHOP_API_BASE}/users/${shopUserId}/${direction === "following" ? "following" : "followers"}?limit=40`
    );
    const data = await res.json().catch(() => ({}));
    if (token !== state.socialListRequestToken) return;
    if (!res.ok) {
      body.innerHTML = "";
      empty.textContent = data?.message || "Could not load this list right now.";
      empty.classList.remove("hidden");
      return;
    }
    const users = Array.isArray(data?.users) ? data.users : [];
    if (!users.length) {
      body.innerHTML = "";
      empty.textContent =
        direction === "following" ? "Not following anyone yet." : "No followers yet.";
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");
    body.innerHTML = users.map((user) => socialListUserRow(user)).join("");
  } catch {
    if (token !== state.socialListRequestToken) return;
    body.innerHTML = "";
    empty.textContent = "Could not load this list right now.";
    empty.classList.remove("hidden");
  }
}

function bindSocialListButtons(shop) {
  const shopUserId = Number(shop?.userId);
  const canOpen = Number.isInteger(shopUserId) && shopUserId > 0;
  const followersBtn = el("shop-followers-btn");
  const followingBtn = el("shop-following-btn");
  if (followersBtn) {
    followersBtn.disabled = !canOpen;
    followersBtn.onclick = canOpen ? () => openSocialList("followers") : null;
  }
  if (followingBtn) {
    followingBtn.disabled = !canOpen;
    followingBtn.onclick = canOpen ? () => openSocialList("following") : null;
  }
}

function renderFollowButton(shop, stats) {
  const followBtn = el("shop-follow-btn");
  if (!followBtn) return;

  const shopUserId = Number(shop.userId);
  const canFollow =
    Number.isInteger(state.viewerUserId) &&
    state.viewerUserId > 0 &&
    Number.isInteger(shopUserId) &&
    shopUserId > 0 &&
    state.viewerUserId !== shopUserId;

  if (!canFollow) {
    followBtn.classList.add("hidden");
    return;
  }

  followBtn.classList.remove("hidden");
  followBtn.textContent = state.following ? "Following" : "Follow shop";
  followBtn.disabled = false;
  followBtn.onclick = async () => {
    followBtn.disabled = true;
    try {
      const res = await fetch(`${SHOP_API_BASE}/follow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buyerAuthBody({
            followerUserId: state.viewerUserId,
            followingUserId: shopUserId,
          })
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        if (isBuyerSessionAuthError(data)) {
          statusMessage(data?.message || "Verify your WhatsApp below to follow this shop.", true);
          return;
        }
        statusMessage(data?.message || data?.error || "Could not follow shop right now.", true);
        return;
      }
      state.following = Boolean(data.following);
      followBtn.textContent = state.following ? "Following" : "Follow shop";
      el("shop-followers-count").textContent = String(
        Number(data?.targetStats?.followersCount || stats.followersCount || 0)
      );
    } catch {
      statusMessage("Network error while updating follow.", true);
    } finally {
      followBtn.disabled = false;
    }
  };
}

function renderMessageButton(shop) {
  const btn = el("shop-message-btn");
  if (!btn) return;

  const shopUserId = Number(shop.userId);
  const canMessage =
    Number.isInteger(state.viewerUserId) &&
    state.viewerUserId > 0 &&
    Number.isInteger(shopUserId) &&
    shopUserId > 0 &&
    state.viewerUserId !== shopUserId;

  if (!canMessage) {
    btn.classList.add("hidden");
    return;
  }

  btn.classList.remove("hidden");
  btn.href = inboxLinkForShop(shop);
}

function resolveShopProductImage(product) {
  if (window.SokoniApp?.resolveProductImage) return window.SokoniApp.resolveProductImage(product);
  const botOrigin =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:3001"
      : "https://bot.sokonimall.com";
  const raw = product?.imageUrl;
  if (raw && /^https?:\/\//i.test(String(raw))) return String(raw);
  if (product?.id) return `${botOrigin}/catalog-images/${encodeURIComponent(product.id)}.jpg`;
  return raw || null;
}

function productCard(product, shop) {
  const title = escapeHtml(product.title || "Item");
  const src = resolveShopProductImage(product);
  const image = src
    ? `<img src="${escapeHtml(src)}" alt="${title}" class="product-image w-full h-full object-cover" loading="lazy" decoding="async" onerror="this.parentElement.innerHTML='<div class=\\'w-full h-full flex items-center justify-center text-xs text-brand-purple/45\\'>Photo soon</div>'" />`
    : `<div class="w-full h-full flex items-center justify-center text-xs text-brand-purple/45 dark:text-white/55">Photo soon</div>`;
  const condition = escapeHtml(
    product.conditionLabel ||
      (product.condition ? String(product.condition).replace(/_/g, " ") : "—")
  );
  const size = product.size ? escapeHtml(product.size) : "—";
  const measureBits = [
    product.pitToPitIn != null ? `P2P ${product.pitToPitIn}"` : null,
    product.lengthIn != null ? `L ${product.lengthIn}"` : null,
    product.waistIn != null ? `W ${product.waistIn}"` : null,
  ].filter(Boolean);
  const likes = Number(product.likesCount || 0);
  const liked = Boolean(product.liked) || state.likedProductIds.has(String(product.id));
  const sold = Boolean(product.isSold) || state.listingsTab === "sold";

  return `
    <article class="product-card bg-white dark:bg-brand-purpleLight/45 rounded-2xl border border-black/5 dark:border-white/10 p-4 flex flex-col ${
      sold ? "opacity-90" : ""
    }">
      <div class="relative mb-3 rounded-xl overflow-hidden bg-brand-cream dark:bg-brand-purple/20 aspect-square">
        <span class="absolute top-2 left-2 z-10 bg-brand-green text-brand-purple text-[10px] font-bold px-2 py-1 rounded-full">${
          sold ? "Sold" : "Prepaid"
        }</span>
        ${image}
      </div>
      <h3 class="font-semibold text-sm line-clamp-2">${title}</h3>
      <p class="text-xs text-brand-purple/55 dark:text-white/65 mt-1">${condition} · Size ${size}</p>
      ${
        measureBits.length
          ? `<p class="text-[11px] text-brand-purple/50 dark:text-white/55 mt-1">${escapeHtml(
              measureBits.join(" · ")
            )}</p>`
          : ""
      }
      <p class="text-base font-bold mt-2">${escapeHtml(formatKes(product.priceKsh ?? product.priceKes))}${
        (() => {
          const compareAt = Math.round(
            Number(product.compareAtPrice ?? product.originalPriceKes) || 0
          );
          const current = Math.round(Number(product.priceKes || product.priceKsh || 0));
          const onSale = compareAt > 0 && current > 0 && current < compareAt;
          if (!onSale) return "";
          const pct =
            product.discountPct != null && Number(product.discountPct) > 0
              ? Math.round(Number(product.discountPct))
              : Math.max(1, Math.round(((compareAt - current) / compareAt) * 100));
          return `${
            compareAt
              ? ` <span class="compare-price text-xs font-medium text-brand-purple/40 line-through">was KES ${compareAt.toLocaleString()}</span>`
              : ""
          } <span class="badge-promo text-[10px] font-bold uppercase text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">${
            pct ? `${pct}% OFF` : "SALE"
          }</span>`;
        })()
      }</p>
      <div class="mt-3 flex items-center justify-between gap-2">
        ${
          sold
            ? `<span class="text-xs font-semibold text-brand-purple/55 dark:text-white/60">Past sale</span>`
            : `<button
          type="button"
          data-like-product="${escapeHtml(product.id)}"
          class="min-h-[44px] px-3 rounded-full border border-brand-purple/20 dark:border-white/20 text-xs font-semibold"
          aria-label="${liked ? "Unlike" : "Like"} ${title}"
          aria-pressed="${liked ? "true" : "false"}">
          ${liked ? "♥ Liked · " : "♡ Like · "}<span data-like-count="${escapeHtml(product.id)}">${likes.toLocaleString()}</span>
        </button>
        <a
          href="${buildOrderLink(product, shop)}"
          target="_blank"
          rel="noopener"
          class="min-h-[44px] px-4 rounded-full bg-brand-green text-brand-purple text-xs font-bold inline-flex items-center">
          Order on WhatsApp
        </a>`
        }
      </div>
    </article>`;
}

function setLikeButtonState(btn, liked, likesCount) {
  if (!btn) return;
  const counter = btn.querySelector("[data-like-count]");
  const label = liked ? "♥ Liked · " : "♡ Like · ";
  let textNode = null;
  for (const node of btn.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      textNode = node;
      break;
    }
  }
  if (textNode) textNode.textContent = label;
  else btn.insertBefore(document.createTextNode(label), btn.firstChild);
  if (counter && likesCount != null) {
    counter.textContent = Number(likesCount || 0).toLocaleString();
  }
  btn.setAttribute("aria-pressed", liked ? "true" : "false");
  const productId = btn.getAttribute("data-like-product") || "item";
  btn.setAttribute("aria-label", `${liked ? "Unlike" : "Like"} ${productId}`);
}

function bindLikeButtons() {
  const buttons = document.querySelectorAll("[data-like-product]");
  buttons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const productId = btn.getAttribute("data-like-product");
      if (!productId) return;
      if (!state.viewerUserId) {
        statusMessage("Verify your WhatsApp below to like items.", true);
        return;
      }
      btn.disabled = true;
      try {
        const res = await fetch(`${PRODUCT_API_BASE}/like`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            buyerAuthBody({
              userId: state.viewerUserId,
              productId,
            })
          ),
        });
        const data = await res.json();
        if (!res.ok) {
          if (isBuyerSessionAuthError(data)) {
            statusMessage(data?.message || "Verify your WhatsApp below to like items.", true);
            return;
          }
          statusMessage(data?.message || data?.error || "Could not update like.", true);
          return;
        }
        const liked = Boolean(data.liked);
        if (liked) state.likedProductIds.add(String(productId));
        else state.likedProductIds.delete(String(productId));
        setLikeButtonState(btn, liked, data.likesCount);
      } catch {
        statusMessage("Network error while liking product.", true);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function syncListingsTabs() {
  const activeBtn = el("shop-tab-active");
  const soldBtn = el("shop-tab-sold");
  const isSold = state.listingsTab === "sold";
  if (activeBtn) {
    activeBtn.classList.toggle("is-active", !isSold);
    activeBtn.classList.toggle("bg-brand-green", !isSold);
    activeBtn.classList.toggle("text-brand-purple", !isSold);
    activeBtn.setAttribute("aria-selected", (!isSold).toString());
  }
  if (soldBtn) {
    soldBtn.classList.toggle("is-active", isSold);
    soldBtn.classList.toggle("bg-brand-green", isSold);
    soldBtn.classList.toggle("text-brand-purple", isSold);
    soldBtn.setAttribute("aria-selected", isSold.toString());
    const soldCount = Number(state.currentShop?.stats?.soldCount || 0);
    soldBtn.textContent = soldCount > 0 ? `Sold (${soldCount})` : "Sold";
  }
}

function renderProducts(payload) {
  const grid = el("shop-products-grid");
  const empty = el("shop-products-empty");
  const countNode = el("shop-products-count");
  if (!grid || !empty || !countNode) return;

  const products = Array.isArray(payload.products) ? payload.products : [];
  const total = Number(payload?.pagination?.total ?? products.length);
  const tab = payload.tab === "sold" || state.listingsTab === "sold" ? "sold" : "active";
  state.listingsTab = tab;
  syncListingsTabs();
  countNode.textContent =
    tab === "sold"
      ? `${total.toLocaleString()} sold item${total === 1 ? "" : "s"}`
      : `${total.toLocaleString()} live item${total === 1 ? "" : "s"}`;
  empty.textContent =
    tab === "sold"
      ? "No sold items archived yet. Past sales will show here as social proof."
      : "No active listings yet. Check back soon, or message this seller on WhatsApp.";

  if (!products.length) {
    grid.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");
  grid.innerHTML = products.map((item) => productCard(item, payload.shop || {})).join("");
  if (window.SokoniComponents?.upgradeIn) {
    window.SokoniComponents.upgradeIn(grid);
  }
  if (tab !== "sold") bindLikeButtons();
}

async function loadStaticShopProducts(handle) {
  const clean = normalizeHandle(handle);
  if (!clean) return [];
  try {
    const res = await fetch(`/data/products.json?v=${Date.now()}`);
    if (!res.ok) return [];
    const json = await res.json();
    const list = Array.isArray(json) ? json : json.products || [];
    return list.filter((p) => {
      const h = normalizeHandle(p.shopHandle || p.sellerHandle);
      if (h !== clean) return false;
      if (p.inStock === false || p.isSold === true) return false;
      if (p.stockQuantity != null && Number(p.stockQuantity) <= 0) return false;
      return true;
    });
  } catch {
    return [];
  }
}

async function loadShop(handle, { tab = state.listingsTab || "active", soft = false } = {}) {
  const clean = normalizeHandle(handle);
  if (!clean) {
    statusMessage("Enter a valid handle like @nairobi_thrifts.", true);
    return;
  }

  state.activeHandle = clean;
  state.listingsTab = tab === "sold" ? "sold" : "active";
  setHandleInUrl(clean);
  statusMessage(soft ? "Loading listings..." : "Loading shop...");
  el("shop-products-grid").innerHTML = "";
  el("shop-products-empty")?.classList.add("hidden");
  if (!soft) {
    resetReviewsUi();
    closeSocialList();
  }
  syncListingsTabs();

  try {
    const query = shopFetchQuery({ limit: 24, tab: state.listingsTab });
    const res = await fetch(`${SHOP_API_BASE}/shop/${encodeURIComponent(clean)}?${query.toString()}`);
    const data = await res.json();
    if (!res.ok) {
      state.currentShop = null;
      const st = String(data?.shopStatus || "").toLowerCase();
      const unavailable =
        data?.error === "shop_unavailable" ||
        data?.error === "shop_under_review" ||
        st === "paused" ||
        st === "under_review";
      const gone = res.status === 404 || st === "deactivated" || data?.error === "not_found";
      renderShopUnavailable({
        handle: clean,
        message: data?.message,
        mode: gone ? "gone" : unavailable ? "paused" : "error",
      });
      statusMessage(
        data?.message ||
          (gone ? "This shop is no longer available." : "This store is currently unavailable."),
        true
      );
      return;
    }

    // Fail-soft: if Postgres active listings are empty, show static catalog for this handle.
    // Never do this when the API already marked the shop restricted.
    if (state.listingsTab === "active") {
      const apiProducts = Array.isArray(data.products) ? data.products : [];
      if (!apiProducts.length) {
        const fallback = await loadStaticShopProducts(clean);
        if (fallback.length) {
          data.products = fallback.map((p) => ({
            ...p,
            title: p.title || p.name,
            shopHandle: clean,
            sellerHandle: clean,
          }));
          data.pagination = {
            ...(data.pagination || {}),
            total: fallback.length,
            limit: fallback.length,
            offset: 0,
          };
          data.stats = {
            ...(data.stats || {}),
            listingsCount: fallback.length,
          };
        }
      }
    }

    statusMessage("");
    applyViewerState(data);
    renderShopHeader(data);
    renderProducts(data);
    if (!soft) void loadReviewableOrders(data.shop || {});
  } catch {
    statusMessage("Could not reach Sokoni right now. Please try again.", true);
  }
}

function renderShopUnavailable({ handle, message, mode = "paused" } = {}) {
  const nameEl = el("shop-name");
  const handleEl = el("shop-handle-display");
  const bioEl = el("shop-bio");
  const grid = el("shop-products-grid");
  const empty = el("shop-products-empty");
  if (nameEl) {
    nameEl.textContent =
      mode === "gone" ? "Shop unavailable" : "Store temporarily unavailable";
  }
  if (handleEl) {
    // Deactivated shops should not advertise the handle; paused can show it briefly.
    handleEl.textContent = mode === "gone" ? "" : handle ? `@${handle}` : "";
  }
  if (bioEl) {
    bioEl.textContent =
      message ||
      (mode === "gone"
        ? "This shop is no longer listed on Sokoni."
        : "This store is currently unavailable. Check back later or browse other shops.");
  }
  if (grid) grid.innerHTML = "";
  if (empty) {
    empty.classList.remove("hidden");
    empty.textContent =
      mode === "gone"
        ? "This shop was deactivated by Sokoni."
        : "Listings are hidden while this store is on hold.";
  }
  // Hide order / follow CTAs when present
  el("shop-follow-btn")?.classList.add("hidden");
  el("shop-message-btn")?.classList.add("hidden");
  el("shop-wa-order")?.classList.add("hidden");
}

function refreshViewerAndShopActions() {
  state.viewerUserId = resolveViewerUserId();
  if (state.activeHandle) {
    void loadShop(state.activeHandle);
    return;
  }
  if (state.currentShop) {
    renderFollowButton(state.currentShop, state.currentShop.stats || {});
    renderMessageButton(state.currentShop);
  }
}

function init() {
  state.viewerUserId = resolveViewerUserId();
  const input = el("shop-handle-input");
  const form = el("shop-handle-form");

  window.SokoniBuyerAuth?.bindPanel?.({
    onVerified: () => {
      refreshViewerAndShopActions();
      statusMessage("WhatsApp verified — you can follow, like, and leave a review.");
      if (state.currentShop) void loadReviewableOrders(state.currentShop);
    },
  });

  el("shop-social-list-close")?.addEventListener("click", () => closeSocialList());
  bindReviewForm();
  el("shop-tab-active")?.addEventListener("click", () => {
    if (!state.activeHandle || state.listingsTab === "active") return;
    void loadShop(state.activeHandle, { tab: "active", soft: true });
  });
  el("shop-tab-sold")?.addEventListener("click", () => {
    if (!state.activeHandle || state.listingsTab === "sold") return;
    void loadShop(state.activeHandle, { tab: "sold", soft: true });
  });

  if (form) {
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      loadShop(input?.value || "", { tab: "active" });
    });
  }

  const initialHandle = readHandleFromUrl();
  if (input && initialHandle) input.value = formatHandle(initialHandle);
  if (initialHandle) loadShop(initialHandle, { tab: "active" });
  else statusMessage("Enter a shop handle to view listings.");
}

document.addEventListener("DOMContentLoaded", init);
