// Storefront — discovery layer; WhatsApp is the conversion layer.

const WHATSAPP_NUMBER = "254117422428";
const WHATSAPP_DISPLAY = "+254 117 422 428";
const SUPPORT_EMAIL = "support@sokonimall.com";
const MPESA_TILL = "4775847";
const MPESA_TILL_NAME = "David Thuku Muiruri";
const OFFER_PERCENT = 3;
const PROMO_CODE = "SOKONI3";
const USD_TO_KES = 130; // Approximate display rate for international items
const REVIEWS_API =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001/api/reviews"
    : "https://bot.sokonimall.com/api/reviews";

function catalogCacheBust() {
  const meta = document.querySelector('meta[name="sokoni-catalog-version"]');
  return meta?.getAttribute("content") || String(Date.now());
}

function dataUrl(file) {
  return `${file}?v=${catalogCacheBust()}`;
}

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

const SUBCATEGORY_LABELS = {
  smartphones: "Smartphones",
  tablets: "Tablets",
  "power-banks": "Power Banks",
  "phone-accessories": "Phone Accessories",
  televisions: "TVs",
  headphones: "Headphones",
  speakers: "Speakers",
  "home-theatre": "Home Theatre",
  wearables: "Wearables",
  "kitchen-appliances": "Kitchen",
  kettles: "Kettles",
  irons: "Irons",
  blenders: "Blenders",
  "washing-machines": "Washing Machines",
  "personal-care": "Personal Care",
  skincare: "Skincare",
  makeup: "Makeup",
  haircare: "Haircare",
  fragrances: "Fragrances",
  "perfume-oils": "Perfume Oils",
  "kitchen-dining": "Kitchen & Dining",
  bedding: "Bedding",
  cleaning: "Cleaning",
  "home-decor": "Home Decor",
  stationery: "Stationery",
  "mens-fashion": "Men's Fashion",
  "womens-fashion": "Women's Fashion",
  shoes: "Shoes",
  bags: "Bags",
  watches: "Watches",
  laptops: "Laptops",
  printers: "Printers",
  storage: "Storage",
  "computer-accessories": "Accessories",
  consoles: "Consoles",
  controllers: "Controllers",
  "gaming-accessories": "Gaming Accessories",
  "food-cupboard": "Food Cupboard",
  drinks: "Drinks",
  "household-supplies": "Household Supplies",
  diapering: "Diapering",
  feeding: "Feeding",
  toys: "Toys",
  "baby-gear": "Baby Gear",
};

/** Viral / TikTok deals posted by backend automation (see data/tiktok-posts.json). */
const VIRAL_IDS = new Set();
let tiktokFeaturedLoaded = false;

async function loadTiktokFeaturedIds() {
  if (tiktokFeaturedLoaded) return;
  tiktokFeaturedLoaded = true;
  try {
    const res = await fetch(dataUrl("data/tiktok-featured.json"));
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
let activeSubcategory = null;
let activeProductId = null;
let searchQuery = "";
let showKes = true;
const STORE_INITIAL_LIMIT = 48;
const STORE_SEARCH_LIMIT = 120;
let storeDisplayLimit = STORE_INITIAL_LIMIT;

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

const SEARCH_STOP_WORDS = new Set([
  "a", "an", "the", "i", "me", "my", "we", "you", "can", "could", "would", "please",
  "get", "give", "show", "find", "want", "need", "looking", "for", "about", "what",
  "how", "is", "are", "do", "does", "this", "that", "these", "those", "more", "info",
  "on", "in", "at", "to", "of", "and", "or", "best", "recommend", "tell", "some", "any",
  "good", "nice", "under", "below", "less", "than", "around", "about", "chini", "ya",
  "kwa", "na", "au", "bei", "kiasi", "kama", "poa", "nataka", "nipe", "simu",
]);

const QUERY_EXPANSIONS = {
  tv: ["tv", "television", "tvs", "smart"],
  laundry: ["laundry", "washing", "washer", "washing-machines"],
  phone: ["phone", "smartphone", "mobile", "phones-tablets", "smartphones"],
  laptop: ["laptop", "laptops", "computing"],
  fridge: ["fridge", "refrigerator", "kitchen-appliances"],
  game: ["game", "gaming", "console", "consoles"],
  perfume: ["perfume", "perfume-oil", "perfume-oils", "fragrance", "fragrances", "cologne", "scent"],
  lotion: ["lotion", "skincare", "body", "health-beauty"],
  soundbar: ["soundbar", "speaker", "speakers", "audio", "tvs-audio"],
};

function expandKeywordTokens(raw) {
  if (!raw) return [];
  const base = String(raw)
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(
      (t) =>
        t &&
        !SEARCH_STOP_WORDS.has(t) &&
        !isPriceToken(t) &&
        (t.length >= 2 || t === "tv" || /^\d+ml$/.test(t))
    );

  const expanded = new Set(base);
  for (const token of base) {
    for (const [key, aliases] of Object.entries(QUERY_EXPANSIONS)) {
      if (token.includes(key) || aliases.some((a) => token.includes(a.replace(/-/g, "")))) {
        aliases.forEach((a) => expanded.add(a));
      }
    }
    if (token === "tvs" || token === "tv") {
      expanded.add("tv");
      expanded.add("television");
      expanded.add("televisions");
    }
  }
  return [...expanded];
}

function parseMaxPriceKes(query) {
  const q = String(query || "").toLowerCase();
  const budget = q.match(/(?:chini\s+ya|under|below|less\s+than|max)\s*(?:kes\s*)?(\d[\d,]*)(k)?/i);
  if (budget) {
    let n = Number(budget[1].replace(/,/g, ""));
    if (budget[2] || (n > 0 && n < 1000)) n *= 1000;
    return n;
  }
  const inline = q.match(/\b(\d{1,3})k\b/);
  if (inline) return Number(inline[1]) * 1000;
  return null;
}

const PRICE_TOKEN_RE = /^\d+(?:\.\d+)?k?$/i;

function isPriceToken(token) {
  return PRICE_TOKEN_RE.test(String(token || ""));
}

function meaningfulSearchTokens(tokens) {
  return (tokens || []).filter((t) => !isPriceToken(t));
}

function hasActiveSearch(query = searchQuery) {
  const tokens = tokenize(query);
  return meaningfulSearchTokens(tokens).length > 0 || parseMaxPriceKes(query) != null;
}

function tokenize(q) {
  return expandKeywordTokens(q);
}

function productHaystack(product) {
  const cat = CATEGORY_META[product.category]?.label || product.category || "";
  const sub = SUBCATEGORY_LABELS[product.subcategory] || product.subcategory || "";
  return [product.name, product.category, cat, sub, product.source, product.emoji, ...(product.tags || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function scoreProduct(product, tokens) {
  const hay = productHaystack(product);
  let score = 0;
  for (const token of tokens) {
    if (/^\d+ml$/.test(token)) continue;
    if (token.length < 2) continue;
    if (hay.includes(token)) score += token.length >= 4 ? 2 : 1;
  }
  return score;
}

function matchesSearch(product, tokens, maxPriceKes) {
  if (maxPriceKes != null && product.priceKes != null && product.priceKes > maxPriceKes) return false;
  const meaningful = meaningfulSearchTokens(tokens);
  if (!meaningful.length) return true;
  return scoreProduct(product, meaningful) > 0;
}

function filteredStoreProducts() {
  const tokens = tokenize(searchQuery);
  const maxPriceKes = parseMaxPriceKes(searchQuery);
  let items = storeProducts;
  if (activeCategory === "viral") {
    items = items.filter((p) => p.viral || VIRAL_IDS.has(p.id));
  } else if (activeCategory !== "all") {
    items = items.filter((p) => p.category === activeCategory);
  }
  if (activeSubcategory) {
    items = items.filter((p) => p.subcategory === activeSubcategory);
  }
  if (activeProductId) {
    items = items.filter((p) => p.id === activeProductId);
  }
  if (meaningfulSearchTokens(tokens).length || maxPriceKes != null) {
    items = items.filter((p) => matchesSearch(p, tokens, maxPriceKes));
    if (meaningfulSearchTokens(tokens).length) {
      items.sort((a, b) => scoreProduct(b, tokens) - scoreProduct(a, tokens));
    } else if (maxPriceKes != null) {
      items.sort((a, b) => (a.priceKes || 0) - (b.priceKes || 0));
    }
  }
  return items;
}

function visibleStoreProducts() {
  const all = filteredStoreProducts();
  const filtered =
    hasActiveSearch() ||
    activeCategory !== "all" ||
    activeSubcategory ||
    activeProductId;
  const limit = filtered ? STORE_SEARCH_LIMIT : storeDisplayLimit;
  return { all, visible: all.slice(0, limit) };
}

function setCatalogFilter({ category = "all", subcategory = null, productId = null, scroll = false } = {}) {
  searchQuery = "";
  activeCategory = category || "all";
  activeSubcategory = subcategory || null;
  activeProductId = productId || null;
  storeDisplayLimit = STORE_SEARCH_LIMIT;

  const input = document.getElementById("hero-search");
  if (input) input.value = "";
  document.getElementById("search-status")?.classList.add("hidden");
  document.getElementById("search-wa-cta")?.classList.add("hidden");

  renderCategoryChips();
  renderStoreGrid();
  syncCatalogNavUi();

  if (scroll) {
    document.getElementById("deals")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function syncCatalogNavUi() {
  if (window.SokoniCatalogNav) {
    window.SokoniCatalogNav.sync({
      category: activeCategory,
      subcategory: activeSubcategory,
      productId: activeProductId,
    });
  }
}

function updateDealsFilterLabel() {
  const el = document.getElementById("catalog-filter-label");
  if (!el) return;
  if (activeProductId) {
    const p = storeProducts.find((x) => x.id === activeProductId);
    el.textContent = p ? `Showing: ${p.name}` : "Showing selected item";
    el.classList.remove("hidden");
    return;
  }
  if (activeSubcategory && activeCategory !== "all" && activeCategory !== "viral") {
    const cat = CATEGORY_META[activeCategory]?.label || activeCategory;
    const sub = SUBCATEGORY_LABELS[activeSubcategory] || activeSubcategory;
    el.textContent = `Showing: ${cat} → ${sub}`;
    el.classList.remove("hidden");
    return;
  }
  if (activeCategory === "viral") {
    el.textContent = "Showing: Viral Bargains";
    el.classList.remove("hidden");
    return;
  }
  if (activeCategory !== "all") {
    el.textContent = `Showing: ${CATEGORY_META[activeCategory]?.label || activeCategory}`;
    el.classList.remove("hidden");
    return;
  }
  el.classList.add("hidden");
}

function runSearch(query) {
  searchQuery = query.trim();
  storeDisplayLimit = STORE_INITIAL_LIMIT;
  activeSubcategory = null;
  activeProductId = null;
  const input = document.getElementById("hero-search");
  if (input && input.value !== searchQuery) input.value = searchQuery;

  const status = document.getElementById("search-status");
  const waCta = document.getElementById("search-wa-cta");
  const waLabel = document.getElementById("search-wa-label");
  const waLinkEl = document.getElementById("search-wa-link");
  const searching = hasActiveSearch();

  if (searching) {
    activeCategory = "all";
    activeSubcategory = null;
    activeProductId = null;
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
  syncCatalogNavUi();
}

// ---------- Render helpers ----------

function resolveProductImage(product) {
  if (product?.imageUrl) return product.imageUrl;
  if (product?.id) return `assets/images/products/${product.id}.jpg`;
  return null;
}

function productImageBlock(product) {
  const src = resolveProductImage(product);
  if (src) {
    const name = escapeHtml(product.name || "Product");
    const id = escapeHtml(product.id || "");
    return `
      <div class="product-image-wrap mb-4 mt-4 rounded-xl overflow-hidden bg-brand-cream aspect-square flex items-center justify-center p-2">
        <img src="${src}" alt="${name}"
             class="product-image w-full h-full object-contain" loading="lazy" decoding="async"
             data-product-id="${id}" />
      </div>`;
  }
  return `<div class="product-image-wrap mb-4 mt-4 rounded-xl overflow-hidden bg-brand-cream aspect-square flex items-center justify-center p-4 text-xs text-brand-purple/40">Photo coming soon</div>`;
}

function renderStoreCard(product) {
  const name = escapeHtml(product.name || "Product");
  const rating = Number(product.rating) || 0;
  const reviews = Number(product.reviews) || 0;
  return `
    <div class="product-card relative bg-white rounded-2xl border border-black/5 shadow-sm p-5 flex flex-col">
      <span class="absolute top-3 left-3 z-10 bg-brand-green text-brand-purple text-[10px] font-bold px-2 py-1 rounded-full">💵 Pay on Delivery</span>
      <span class="absolute top-3 right-3 z-10 bg-brand-purple/8 text-brand-purple/70 text-[10px] font-mono font-semibold px-2 py-1 rounded-full border border-brand-purple/15">${escapeHtml(product.id || "")}</span>
      ${productImageBlock(product)}
      <h3 class="font-bold text-sm mb-1 line-clamp-2">${name}</h3>
      <p class="text-xs text-brand-purple/50 mb-2">${[
        CATEGORY_META[product.category]?.label || product.category,
        SUBCATEGORY_LABELS[product.subcategory] || product.subcategory,
      ]
        .filter(Boolean)
        .join(" · ")}</p>
      <div class="flex items-baseline gap-2 mb-1">
        <span class="font-extrabold text-lg">${formatPrice(product)}</span>
        ${
          product.originalPriceKes && product.priceKes && product.originalPriceKes > product.priceKes
            ? `<span class="text-xs text-brand-purple/40 line-through">KES ${product.originalPriceKes.toLocaleString()}</span>`
            : ""
        }
      </div>
      <p class="text-xs text-brand-purple/50 mb-4">⭐ ${rating} (${reviews.toLocaleString()} reviews)</p>
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
      class="cat-chip group bg-white rounded-2xl border ${activeCategory === id && !activeProductId ? "border-brand-green ring-2 ring-brand-green/30" : "border-black/5"} shadow-sm p-6 text-center hover:shadow-lg hover:-translate-y-1 transition">
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
      setCatalogFilter({ category: btn.dataset.cat, subcategory: null, productId: null });
    });
  });
}

function renderStoreMoreButton(allCount, visibleCount) {
  let wrap = document.getElementById("local-deals-more");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "local-deals-more";
    wrap.className = "text-center mt-8";
    document.getElementById("local-deals-grid")?.insertAdjacentElement("afterend", wrap);
  }
  const canLoadMore =
    !hasActiveSearch() &&
    activeCategory === "all" &&
    !activeSubcategory &&
    !activeProductId &&
    visibleCount < allCount;
  if (!canLoadMore) {
    wrap.classList.add("hidden");
    wrap.innerHTML = "";
    return;
  }
  wrap.classList.remove("hidden");
  wrap.innerHTML = `
    <button type="button" id="local-deals-more-btn"
      class="inline-flex items-center gap-2 border-2 border-brand-purple/15 font-bold px-6 py-3 rounded-full hover:bg-brand-purple hover:text-white transition">
      Show more deals (${visibleCount} of ${allCount})
    </button>`;
  document.getElementById("local-deals-more-btn")?.addEventListener("click", () => {
    storeDisplayLimit += STORE_INITIAL_LIMIT;
    renderStoreGrid();
  });
}

function revealCatalogSections() {
  for (const id of ["categories", "deals", "international"]) {
    document.getElementById(id)?.classList.add("is-visible");
  }
}

function renderStoreGrid() {
  const grid = document.getElementById("local-deals-grid");
  const empty = document.getElementById("local-deals-empty");
  const emptyWa = document.getElementById("search-empty-wa");
  const viralEmpty = document.getElementById("viral-empty");
  if (!grid) return;

  const { all: allItems, visible: items } = visibleStoreProducts();
  grid.innerHTML = items.map(renderStoreCard).join("");
  if (window.SokoniComponents) SokoniComponents.upgradeIn(grid);

  const searching = hasActiveSearch();
  const showEmpty = allItems.length === 0 && searching;
  const isViralTab = activeCategory === "viral" && !searching;

  grid.classList.toggle("hidden", showEmpty || (isViralTab && allItems.length === 0));
  if (empty) {
    empty.classList.toggle("hidden", !showEmpty);
    if (emptyWa && showEmpty) emptyWa.href = searchWaLink(searchQuery);
  }
  if (viralEmpty) {
    viralEmpty.classList.toggle("hidden", !isViralTab || allItems.length > 0);
  }

  renderStoreMoreButton(allItems.length, items.length);
  updateDealsFilterLabel();
  revealCatalogSections();
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
  const response = await fetch(dataUrl("data/products.json"));
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
      '<p class="text-brand-purple/50 dark:text-white/50 text-sm">We\'re onboarding our first customers — real reviews from real orders will appear here as we grow. Order on WhatsApp and we\'ll ask you to rate us after delivery.</p>';
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
    storeProducts = products.filter((p) => p.fulfillment === "store" || (p.scope === "local" && p.fulfillment !== "supplier"));
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
    revealCatalogSections();

    if (window.SokoniCatalogNav) {
      await window.SokoniCatalogNav.init({
        products: storeProducts,
        navigate: (sel) => setCatalogFilter({ ...sel, scroll: sel.scroll }),
      });
    }
  } catch (err) {
    console.error("Failed to load product catalog:", err);
    const grid = document.getElementById("local-deals-grid");
    if (grid) {
      grid.innerHTML =
        '<p class="text-sm text-brand-purple/60 col-span-full">Could not load products right now. Please refresh, or browse on <a class="text-brand-green font-semibold underline" href="https://wa.me/254117422428">WhatsApp</a>.</p>';
      grid.classList.remove("hidden");
    }
    revealCatalogSections();
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
