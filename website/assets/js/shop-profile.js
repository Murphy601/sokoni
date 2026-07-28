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
  currentShop: null,
  reviewsRequestToken: 0,
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
  const list = el("shop-reviews-list");
  const count = el("shop-reviews-count");
  const empty = el("shop-reviews-empty");
  if (list) list.innerHTML = "";
  if (count) count.textContent = "No ratings yet";
  if (empty) {
    empty.textContent = "No reviews yet. Buyers can rate this shop after delivered orders.";
    empty.classList.add("hidden");
  }
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
  state.currentShop = shop;

  el("shop-name").textContent = shop.shopName || "Shop";
  el("shop-handle").textContent = shop.handle || "";

  const verified = el("shop-verified");
  if (verified) verified.classList.toggle("hidden", !shop.isSellerVerified);

  const bio = el("shop-bio");
  if (bio) {
    if (shop.bio) {
      bio.textContent = shop.bio;
      bio.classList.remove("hidden");
    } else {
      bio.classList.add("hidden");
    }
  }

  const location = el("shop-location");
  if (location) {
    if (shop.location) {
      location.textContent = `Kenya: ${shop.location}`;
      location.classList.remove("hidden");
    } else {
      location.classList.add("hidden");
    }
  }

  const avg = Number(stats.avgRating || 0);
  const totalReviews = Number(stats.totalReviews || 0);
  el("shop-rating").textContent =
    totalReviews > 0 ? `★ ${avg.toFixed(1)} (${totalReviews.toLocaleString()} reviews)` : "New seller";

  el("shop-listings-count").textContent = String(Number(stats.listingsCount || 0));
  el("shop-followers-count").textContent = String(Number(stats.followersCount || 0));
  el("shop-following-count").textContent = String(Number(stats.followingCount || 0));
  el("shop-likes-count").textContent = String(Number(stats.likesReceivedCount || 0));

  const avatarWrap = el("shop-avatar");
  if (avatarWrap) {
    const initial = (shop.shopName || "S").trim().charAt(0).toUpperCase();
    if (shop.avatarUrl) {
      avatarWrap.innerHTML = `<img src="${escapeHtml(shop.avatarUrl)}" alt="${escapeHtml(
        shop.shopName || "Shop avatar"
      )}" class="w-full h-full object-cover" />`;
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
  state.following = false;
  followBtn.textContent = "Follow shop";
  followBtn.disabled = false;
  followBtn.onclick = async () => {
    followBtn.disabled = true;
    try {
      const res = await fetch(`${SHOP_API_BASE}/follow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          followerUserId: state.viewerUserId,
          followingUserId: shopUserId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
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

function productCard(product, shop) {
  const title = escapeHtml(product.title || "Item");
  const image = product.imageUrl
    ? `<img src="${escapeHtml(product.imageUrl)}" alt="${title}" class="product-image w-full h-full object-cover" loading="lazy" decoding="async" />`
    : `<div class="w-full h-full flex items-center justify-center text-xs text-brand-purple/45 dark:text-white/55">Photo soon</div>`;
  const condition = product.condition ? escapeHtml(product.condition.replace(/_/g, " ")) : "—";
  const size = product.size ? escapeHtml(product.size) : "—";
  const likes = Number(product.likesCount || 0);

  return `
    <article class="product-card bg-white dark:bg-brand-purpleLight/45 rounded-2xl border border-black/5 dark:border-white/10 p-4 flex flex-col">
      <div class="relative mb-3 rounded-xl overflow-hidden bg-brand-cream dark:bg-brand-purple/20 aspect-square">
        <span class="absolute top-2 left-2 z-10 bg-brand-green text-brand-purple text-[10px] font-bold px-2 py-1 rounded-full">Prepaid</span>
        ${image}
      </div>
      <h3 class="font-semibold text-sm line-clamp-2">${title}</h3>
      <p class="text-xs text-brand-purple/55 dark:text-white/65 mt-1">${condition} · Size ${size}</p>
      <p class="text-base font-bold mt-2">${escapeHtml(formatKes(product.priceKsh ?? product.priceKes))}</p>
      <div class="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          data-like-product="${escapeHtml(product.id)}"
          class="min-h-[44px] px-3 rounded-full border border-brand-purple/20 dark:border-white/20 text-xs font-semibold"
          aria-label="Like ${title}">
          ♡ Like · <span data-like-count="${escapeHtml(product.id)}">${likes.toLocaleString()}</span>
        </button>
        <a
          href="${buildOrderLink(product, shop)}"
          target="_blank"
          rel="noopener"
          class="min-h-[44px] px-4 rounded-full bg-brand-green text-brand-purple text-xs font-bold inline-flex items-center">
          Order on WhatsApp
        </a>
      </div>
    </article>`;
}

function bindLikeButtons() {
  const buttons = document.querySelectorAll("[data-like-product]");
  buttons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const productId = btn.getAttribute("data-like-product");
      if (!productId) return;
      if (!state.viewerUserId) {
        statusMessage("Set ?viewer=USER_ID in URL to test likes.", true);
        return;
      }
      btn.disabled = true;
      try {
        const res = await fetch(`${PRODUCT_API_BASE}/like`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: state.viewerUserId,
            productId,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          statusMessage(data?.message || data?.error || "Could not update like.", true);
          return;
        }
        btn.firstChild.textContent = data.liked ? "♥ Liked · " : "♡ Like · ";
        const counter = document.querySelector(`[data-like-count="${CSS.escape(productId)}"]`);
        if (counter) counter.textContent = Number(data.likesCount || 0).toLocaleString();
      } catch {
        statusMessage("Network error while liking product.", true);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function renderProducts(payload) {
  const grid = el("shop-products-grid");
  const empty = el("shop-products-empty");
  const countNode = el("shop-products-count");
  if (!grid || !empty || !countNode) return;

  const products = Array.isArray(payload.products) ? payload.products : [];
  const total = Number(payload?.pagination?.total ?? products.length);
  countNode.textContent = `${total.toLocaleString()} live item${total === 1 ? "" : "s"}`;

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
  bindLikeButtons();
}

async function loadShop(handle) {
  const clean = normalizeHandle(handle);
  if (!clean) {
    statusMessage("Enter a valid handle like @nairobi_thrifts.", true);
    return;
  }

  state.activeHandle = clean;
  setHandleInUrl(clean);
  statusMessage("Loading shop...");
  el("shop-products-grid").innerHTML = "";
  el("shop-products-empty")?.classList.add("hidden");
  resetReviewsUi();

  try {
    const res = await fetch(`${SHOP_API_BASE}/shop/${encodeURIComponent(clean)}?limit=24`);
    const data = await res.json();
    if (!res.ok) {
      statusMessage(data?.message || "Could not load that shop handle.", true);
      return;
    }

    statusMessage("");
    renderShopHeader(data);
    renderProducts(data);
  } catch {
    statusMessage("Could not reach Sokoni right now. Please try again.", true);
  }
}

function init() {
  state.viewerUserId = parseViewerUserId();
  const input = el("shop-handle-input");
  const form = el("shop-handle-form");

  if (form) {
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      loadShop(input?.value || "");
    });
  }

  const initialHandle = readHandleFromUrl();
  if (input && initialHandle) input.value = formatHandle(initialHandle);
  if (initialHandle) loadShop(initialHandle);
  else statusMessage("Enter a shop handle to view listings.");
}

document.addEventListener("DOMContentLoaded", init);
