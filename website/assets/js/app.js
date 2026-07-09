// Storefront — discovery layer; WhatsApp is the conversion layer.

const WHATSAPP_NUMBER = "254117422428";
const USD_TO_KES = 130; // Approximate display rate for international items
const REVIEWS_API =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001/api/reviews"
    : "https://bot.sokonimall.com/api/reviews";

const CATEGORY_META = {
  "phones-tablets": { label: "Phones & Tablets", emoji: "📱" },
  "tvs-audio": { label: "TVs & Audio", emoji: "📺" },
  appliances: { label: "Appliances", emoji: "🔌" },
  "health-beauty": { label: "Health & Beauty", emoji: "💄" },
  "home-office": { label: "Home & Office", emoji: "🏠" },
  fashion: { label: "Fashion", emoji: "👗" },
  computing: { label: "Computing", emoji: "💻" },
  gaming: { label: "Gaming", emoji: "🎮" },
  supermarket: { label: "Supermarket", emoji: "🛒" },
  "baby-products": { label: "Baby Products", emoji: "🍼" },
};

/** Viral / TikTok deals posted by backend automation (see data/tiktok-posts.json). */
const VIRAL_IDS = new Set();
let tiktokFeaturedLoaded = false;

async function loadTiktokFeaturedIds() {
  if (tiktokFeaturedLoaded) return;
  tiktokFeaturedLoaded = true;
  try {
    const res = await fetch("data/tiktok-featured.json");
    if (!res.ok) return;
    const data = await res.json();
    for (const id of data.productIds || []) VIRAL_IDS.add(id);
  } catch {
    /* no featured file yet */
  }
}

const NUDGE_COPY = {
  "phones-tablets": {
    text: "Need a phone under KES 15,000? Order on WhatsApp — pay when it arrives 💵",
    wa: "Hi Sokoni, nataka simu poa chini ya 15k — pay on delivery. What do you recommend?",
  },
  deals: {
    text: "Browse 1,200+ store deals. Reply on WhatsApp — no upfront payment.",
    wa: "Hi Sokoni, I was browsing your store and need help picking the best deal (pay on delivery).",
  },
  default: {
    text: "Tell Sokoni AI what you need — English, Kiswahili or Sheng — order pay on delivery.",
    wa: "Hi Sokoni, I was browsing sokonimall.com and need help finding the right product.",
  },
};

let storeProducts = [];
let intlProducts = [];
let activeCategory = "all";
let searchQuery = "";
let showKes = true;

// ---------- WhatsApp deep links ----------

function waLink(message) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

function orderLinkFor(product) {
  return waLink(
    `Hi Sokoni, I'd like to order "${product.name}" (${formatPrice(product)}) — Pay on Delivery. ` +
      `My name, delivery location and phone are:`
  );
}

function askLinkFor(product) {
  return waLink(`Hi Sokoni, tell me more about "${product.name}" (${formatPrice(product)}).`);
}

function searchWaLink(query) {
  const q = (query || "").trim();
  return waLink(
    q
      ? `Hi Sokoni, I'm looking for "${q}" in your store — pay on delivery. What do you have?`
      : "Hi Sokoni, I want to shop from your store 🛒 (pay on delivery)"
  );
}

function categoryWaLink(categoryId) {
  const label = CATEGORY_META[categoryId]?.label || categoryId;
  return waLink(`Hi Sokoni, I want to browse ${label} — pay on delivery.`);
}

// ---------- Currency ----------

function loadCurrencyPref() {
  try {
    showKes = localStorage.getItem("sokoni-currency") !== "usd";
  } catch {
    showKes = true;
  }
}

function saveCurrencyPref() {
  try {
    localStorage.setItem("sokoni-currency", showKes ? "kes" : "usd");
  } catch {}
}

function formatPrice(product) {
  if (product.priceKes != null) {
    if (!showKes && product.priceUsd == null) {
      return `≈ $${Math.round(product.priceKes / USD_TO_KES)}`;
    }
    return `KES ${product.priceKes.toLocaleString()}`;
  }
  if (product.priceUsd != null) {
    if (showKes) {
      return `≈ KES ${Math.round(product.priceUsd * USD_TO_KES).toLocaleString()}`;
    }
    return `$${product.priceUsd}`;
  }
  return "";
}

function syncCurrencyUi() {
  const label = document.getElementById("currency-label");
  const note = document.getElementById("currency-note");
  if (label) label.textContent = showKes ? "KES" : "USD";
  if (note) {
    note.textContent = showKes
      ? `International prices shown as approx. KES (1 USD ≈ ${USD_TO_KES} KES). Final price at supplier checkout.`
      : "International prices in USD. Tap KES in the header for approximate shilling conversion.";
  }
}

function toggleCurrency() {
  showKes = !showKes;
  saveCurrencyPref();
  syncCurrencyUi();
  renderStoreGrid();
  renderIntlGrid();
}

// ---------- Search ----------

function tokenize(q) {
  return q
    .toLowerCase()
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function productSearchText(product) {
  const cat = CATEGORY_META[product.category]?.label || product.category || "";
  return [product.name, product.category, cat, product.source, product.emoji]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesSearch(product, tokens) {
  if (!tokens.length) return true;
  const hay = productSearchText(product);
  return tokens.every((t) => hay.includes(t));
}

function filteredStoreProducts() {
  const tokens = tokenize(searchQuery);
  let items = storeProducts;
  if (activeCategory === "viral") {
    items = items.filter((p) => p.viral || VIRAL_IDS.has(p.id));
  } else if (activeCategory !== "all") {
    items = items.filter((p) => p.category === activeCategory);
  }
  if (tokens.length) {
    items = items.filter((p) => matchesSearch(p, tokens));
  }
  return items;
}

function runSearch(query) {
  searchQuery = query.trim();
  const input = document.getElementById("hero-search");
  if (input && input.value !== searchQuery) input.value = searchQuery;

  const status = document.getElementById("search-status");
  const waCta = document.getElementById("search-wa-cta");
  const waLabel = document.getElementById("search-wa-label");
  const waLinkEl = document.getElementById("search-wa-link");
  const tokens = tokenize(searchQuery);

  if (tokens.length) {
    const count = filteredStoreProducts().length;
    if (status) {
      status.classList.remove("hidden");
      status.textContent =
        count > 0
          ? `Showing ${count} match${count === 1 ? "" : "es"} for “${searchQuery}” in Sokoni Store.`
          : `No on-site matches for “${searchQuery}”.`;
    }
    if (waCta && waLabel && waLinkEl) {
      waCta.classList.remove("hidden");
      waLabel.textContent =
        count > 0
          ? `Want more options for “${searchQuery}”? Chat Sokoni on WhatsApp.`
          : `No on-site match for “${searchQuery}” — Sokoni AI can search our full store catalog.`;
      waLinkEl.href = searchWaLink(searchQuery);
    }
    document.getElementById("deals")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    status?.classList.add("hidden");
    waCta?.classList.add("hidden");
  }

  renderCategoryChips();
  renderStoreGrid();
}

// ---------- Render helpers ----------

function productImageBlock(product) {
  if (product.imageUrl) {
    return `
      <div class="product-image-wrap mb-4 mt-4 rounded-xl overflow-hidden bg-brand-cream aspect-square flex items-center justify-center p-2">
        <img src="${product.imageUrl}" alt="${product.name.replace(/"/g, "&quot;")}"
             class="product-image w-full h-full object-contain" loading="lazy" decoding="async" />
      </div>`;
  }
  return `<div class="text-5xl mb-4 text-center mt-4">${product.emoji || "🛍️"}</div>`;
}

function renderStoreCard(product) {
  return `
    <div class="product-card relative bg-white rounded-2xl border border-black/5 shadow-sm p-5 flex flex-col">
      <span class="absolute top-3 left-3 z-10 bg-brand-green text-brand-purple text-[10px] font-bold px-2 py-1 rounded-full">💵 Pay on Delivery</span>
      ${productImageBlock(product)}
      <h3 class="font-bold text-sm mb-1 line-clamp-2">${product.name}</h3>
      <p class="text-xs text-brand-purple/50 mb-2">${CATEGORY_META[product.category]?.label || product.category}</p>
      <div class="flex items-baseline gap-2 mb-1">
        <span class="font-extrabold text-lg">${formatPrice(product)}</span>
        ${
          product.originalPriceKes && product.priceKes && product.originalPriceKes > product.priceKes
            ? `<span class="text-xs text-brand-purple/40 line-through">KES ${product.originalPriceKes.toLocaleString()}</span>`
            : ""
        }
      </div>
      <p class="text-xs text-brand-purple/50 mb-4">⭐ ${product.rating} (${product.reviews.toLocaleString()} reviews)</p>
      <div class="mt-auto flex flex-col gap-2">
        <a href="${orderLinkFor(product)}" target="_blank" rel="noopener"
           class="text-center bg-brand-green text-brand-purple text-sm font-bold px-4 py-2 rounded-full hover:scale-105 transition">
          🛒 Order — Pay on Delivery
        </a>
        <a href="${askLinkFor(product)}" target="_blank" rel="noopener"
           class="text-center text-xs text-brand-purple/60 underline hover:text-brand-purple">
          💬 Ask about it on WhatsApp
        </a>
      </div>
    </div>
  `;
}

function renderCategoryChips() {
  const grid = document.getElementById("category-grid");
  if (!grid) return;
  const cats = [...new Set(storeProducts.map((p) => p.category))];
  const chip = (id, label, emoji) => `
    <button type="button" data-cat="${id}"
      class="cat-chip group bg-white rounded-2xl border ${activeCategory === id ? "border-brand-green ring-2 ring-brand-green/30" : "border-black/5"} shadow-sm p-6 text-center hover:shadow-lg hover:-translate-y-1 transition">
      <div class="text-4xl mb-3">${emoji}</div>
      <p class="font-semibold text-sm group-hover:text-brand-green">${label}</p>
    </button>
  `;
  grid.innerHTML =
    chip("all", "All Products", "🛍️") +
    chip("viral", "Viral Bargains", "🔥") +
    cats.map((c) => chip(c, CATEGORY_META[c]?.label || c, CATEGORY_META[c]?.emoji || "🛍️")).join("");
  if (window.SokoniComponents) SokoniComponents.upgradeIn(grid);
  grid.querySelectorAll(".cat-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.cat;
      renderCategoryChips();
      renderStoreGrid();
    });
  });
}

function renderStoreGrid() {
  const grid = document.getElementById("local-deals-grid");
  const empty = document.getElementById("local-deals-empty");
  const emptyWa = document.getElementById("search-empty-wa");
  const viralEmpty = document.getElementById("viral-empty");
  if (!grid) return;

  const items = filteredStoreProducts();
  grid.innerHTML = items.map(renderStoreCard).join("");
  if (window.SokoniComponents) SokoniComponents.upgradeIn(grid);
  grid.classList.toggle("hidden", items.length === 0 && tokenize(searchQuery).length > 0);

  const isViralTab = activeCategory === "viral" && !tokenize(searchQuery).length;
  if (viralEmpty) {
    viralEmpty.classList.toggle("hidden", !isViralTab || items.length > 0);
  }
  if (grid && isViralTab && items.length === 0) {
    grid.classList.add("hidden");
  } else if (grid && !(items.length === 0 && tokenize(searchQuery).length > 0)) {
    grid.classList.remove("hidden");
  }

  if (empty) {
    const showEmpty = items.length === 0 && tokenize(searchQuery).length > 0;
    empty.classList.toggle("hidden", !showEmpty);
    if (emptyWa && showEmpty) emptyWa.href = searchWaLink(searchQuery);
  }
}

function discountBadge(product) {
  if (!product.originalPriceKes) return "";
  const pct = Math.round((1 - product.priceKes / product.originalPriceKes) * 100);
  return `<span class="absolute top-3 left-3 bg-brand-green text-brand-purple text-xs font-bold px-2 py-1 rounded-full">-${pct}%</span>`;
}

function renderAffiliateCard(product) {
  const askUrl = askLinkFor(product);
  return `
    <div class="product-card relative bg-white rounded-2xl border border-black/5 shadow-sm p-5 flex flex-col">
      ${discountBadge(product)}
      ${productImageBlock(product)}
      <h3 class="font-bold text-sm mb-1 line-clamp-2">${product.name}</h3>
      <p class="text-xs text-brand-purple/50 mb-2">${product.source}${product.estDelivery ? ` · ${product.estDelivery}` : ""}</p>
      <div class="flex items-baseline gap-2 mb-1">
        <span class="font-extrabold text-lg">${formatPrice(product)}</span>
        ${
          product.originalPriceKes && product.priceKes && product.originalPriceKes > product.priceKes
            ? `<span class="text-xs text-brand-purple/40 line-through">KES ${product.originalPriceKes.toLocaleString()}</span>`
            : ""
        }
      </div>
      <p class="text-xs text-brand-purple/50 mb-4">⭐ ${product.rating} (${product.reviews.toLocaleString()} reviews)</p>
      <div class="mt-auto flex flex-col gap-2">
        <a href="${askUrl}" target="_blank" rel="noopener"
           class="text-center bg-brand-green text-brand-purple text-sm font-bold px-4 py-2 rounded-full hover:scale-105 transition">
          💬 Ask on WhatsApp
        </a>
      </div>
    </div>
  `;
}

function renderIntlGrid() {
  const intlGrid = document.getElementById("intl-grid");
  if (!intlGrid) return;
  intlGrid.innerHTML = intlProducts.map(renderAffiliateCard).join("");
  if (window.SokoniComponents) SokoniComponents.upgradeIn(intlGrid);
}

// ---------- AI browse nudge ----------

function setupBrowseNudge() {
  const nudge = document.getElementById("ai-nudge");
  const dismiss = document.getElementById("ai-nudge-dismiss");
  if (!nudge) return;

  try {
    if (sessionStorage.getItem("sokoni-nudge-dismissed")) return;
  } catch {}

  let shown = false;
  let timer = null;

  function showNudge(kind) {
    if (shown) return;
    shown = true;
    const copy = NUDGE_COPY[kind] || NUDGE_COPY.default;
    const textEl = document.getElementById("ai-nudge-text");
    const linkEl = document.getElementById("ai-nudge-link");
    if (textEl) textEl.textContent = copy.text;
    if (linkEl) linkEl.href = waLink(copy.wa);
    nudge.classList.remove("hidden");
  }

  dismiss?.addEventListener("click", () => {
    nudge.classList.add("hidden");
    try {
      sessionStorage.setItem("sokoni-nudge-dismissed", "1");
    } catch {}
  });

  const targets = [
    { el: document.getElementById("categories"), kind: "phones-tablets" },
    { el: document.getElementById("deals"), kind: "deals" },
  ];

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const kind = entry.target.id === "categories" ? "phones-tablets" : "deals";
        clearTimeout(timer);
        timer = setTimeout(() => showNudge(kind), 5000);
      }
    },
    { threshold: 0.35 }
  );

  for (const { el } of targets) {
    if (el) observer.observe(el);
  }
}

// ---------- Init ----------

function bindSearch() {
  const form = document.getElementById("hero-search-form");
  const input = document.getElementById("hero-search");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    runSearch(input?.value || "");
  });
  input?.addEventListener("input", () => {
    if (!(input.value || "").trim()) runSearch("");
  });
  document.getElementById("search-hint-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("hero-search")?.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

async function loadProducts() {
  const response = await fetch("data/products.json");
  return response.json();
}

function starsHtml(n) {
  const count = Math.min(5, Math.max(1, Number(n) || 5));
  return "⭐".repeat(count);
}

function formatReviewDate(ts) {
  if (!ts) return "";
  try {
    return new Intl.DateTimeFormat("en-KE", { dateStyle: "medium" }).format(new Date(ts));
  } catch {
    return "";
  }
}

function renderReviewCard(review) {
  const name = escapeHtml(review.customerName || "Sokoni customer");
  const product = review.productName ? `<span class="text-brand-purple/50 dark:text-white/50"> · ${escapeHtml(review.productName)}</span>` : "";
  const comment = review.comment
    ? `<p class="text-sm text-brand-purple/70 dark:text-white/70 mt-2">${escapeHtml(review.comment)}</p>`
    : "";
  const date = formatReviewDate(review.createdAt);
  const source = review.source === "whatsapp" ? "WhatsApp" : "Website";
  return `
    <article class="rounded-2xl border border-black/5 dark:border-white/10 bg-brand-cream/50 dark:bg-white/5 p-5">
      <div class="flex items-center justify-between gap-2 mb-1">
        <span class="font-semibold text-sm">${name}${product}</span>
        <span class="text-xs text-brand-purple/40 dark:text-white/40">${date}</span>
      </div>
      <div class="text-sm">${starsHtml(review.stars)} <span class="text-xs text-brand-purple/40 dark:text-white/40 ml-1">via ${source}</span></div>
      ${comment}
    </article>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadReviewsFromApi() {
  try {
    const res = await fetch(REVIEWS_API);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.reviews)) return data.reviews;
    }
  } catch {
    /* fall back to static file */
  }
  try {
    const res = await fetch("data/reviews.json");
    if (!res.ok) return [];
    const data = await res.json();
    return data.reviews || [];
  } catch {
    return [];
  }
}

async function renderReviews() {
  const list = document.getElementById("reviews-list");
  if (!list) return;
  const reviews = await loadReviewsFromApi();
  if (!reviews.length) {
    list.innerHTML =
      '<p class="text-brand-purple/50 dark:text-white/50 text-sm">No reviews yet — be the first after your delivery! Order on WhatsApp and we\'ll ask you to rate us.</p>';
    return;
  }
  list.innerHTML = reviews.slice(0, 12).map(renderReviewCard).join("");
}

function bindReviewForm() {
  const form = document.getElementById("review-form");
  const msg = document.getElementById("review-form-msg");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (msg) {
      msg.classList.add("hidden");
      msg.classList.remove("text-brand-green", "text-red-600");
    }

    const payload = {
      customerName: document.getElementById("review-name")?.value?.trim(),
      productName: document.getElementById("review-product")?.value?.trim(),
      stars: Number(document.getElementById("review-stars")?.value),
      comment: document.getElementById("review-comment")?.value?.trim(),
    };

    try {
      const res = await fetch(REVIEWS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not submit review");

      form.reset();
      if (msg) {
        msg.textContent = "Thank you! Your review is live.";
        msg.classList.remove("hidden");
        msg.classList.add("text-brand-green");
      }
      await renderReviews();
    } catch (err) {
      if (msg) {
        msg.textContent = "Could not submit right now. Try again or rate us on WhatsApp after delivery.";
        msg.classList.remove("hidden");
        msg.classList.add("text-red-600");
      }
    }
  });
}

async function renderProducts() {
  try {
    await loadTiktokFeaturedIds();
    const products = (await loadProducts()).filter((p) => p.inStock !== false);
    storeProducts = products.filter((p) => p.fulfillment === "store");
    intlProducts = products.filter((p) => p.scope === "international").slice(0, 8);

    loadCurrencyPref();
    syncCurrencyUi();
    bindSearch();
    setupBrowseNudge();
    applyDeepLinkFromUrl();

    document.getElementById("currency-toggle")?.addEventListener("click", toggleCurrency);

    renderCategoryChips();
    renderStoreGrid();
    renderIntlGrid();
  } catch (err) {
    console.error("Failed to load product catalog:", err);
  }
}

/** ?text= or ?q= in URL pre-fills search and scrolls to store (e.g. ?text=phone under 15k). */
function applyDeepLinkFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const text = params.get("text") || params.get("q");
  if (!text?.trim()) return;
  runSearch(text.trim());
}

renderProducts();
renderReviews();
bindReviewForm();
