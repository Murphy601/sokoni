// Storefront — discovery layer; WhatsApp is the conversion layer.

const WHATSAPP_NUMBER = "254117422428";
const WHATSAPP_DISPLAY = "+254 117 422 428";
const SUPPORT_EMAIL = "support@sokonimall.com";
const MPESA_TILL = "4775847";
const MPESA_TILL_NAME = "David Thuku Muiruri";
const OFFER_PERCENT = 3;
const PROMO_CODE = "SOKONI3";
const REVIEWS_API =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001/api/reviews"
    : "https://bot.sokonimall.com/api/reviews";
const PRODUCTS_API =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001/api/products"
    : "https://bot.sokonimall.com/api/products";

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
    text: "Need a phone under KES 15,000? Ask Sokoni AI — prepaid & SK tracking 📦",
    ask: "phone under 15000",
  },
  deals: {
    text: "Browse hot deals — ask Sokoni AI or order prepaid on WhatsApp.",
    ask: "best deals today under 5000",
  },
  default: {
    text: "Tell Sokoni AI what you need — English, Kiswahili or Sheng.",
    ask: "help me find something",
  },
};

let storeProducts = [];
let activeCategory = "all";
let activeSubcategory = null;
let activeProductId = null;
let activeItemType = "all";
let activePriceTier = null;
let activeAesthetic = null;
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
    `Hi Sokoni, I'd like to order "${product.name}" (${formatPrice(product)}) — prepaid. ` +
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
      ? `Hi Sokoni, I'm looking for "${q}" in your store — prepaid checkout. What do you have?`
      : "Hi Sokoni, I want to shop from your store 🛒 (prepaid)"
  );
}

function categoryWaLink(categoryId) {
  const label = CATEGORY_META[categoryId]?.label || categoryId;
  return waLink(`Hi Sokoni, I want to browse ${label} — prepaid.`);
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

function buyerPriceKes(product) {
  if (product.totalKes != null) return Math.round(Number(product.totalKes) || 0);
  const item = Math.round(Number(product.priceKes) || 0);
  const ship = Math.round(Number(product.shippingKes) || 0);
  return ship > 0 ? item + ship : item;
}

function formatPrice(product) {
  const kes = buyerPriceKes(product);
  if (kes > 0) return `KES ${kes.toLocaleString()}`;
  if (product.priceUsd != null) {
    return `$${product.priceUsd}`;
  }
  return "";
}

function formatShippingLine(_product) {
  return "Seller handles dispatch";
}

function formatBuyerTotal(product) {
  return formatPrice(product);
}

function syncCurrencyUi() {
  const label = document.getElementById("currency-label");
  if (label) label.textContent = "KES";
}

function toggleCurrency() {
  /* legacy hook — local catalog is KES-only */
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

function aestheticMatchTerms(aestheticId) {
  const menu = window.SokoniBrowse?.getMenu?.();
  const vibes = menu?.aesthetics || [];
  const vibe = vibes.find((v) => v.id === aestheticId);
  if (!vibe) return [String(aestheticId || "").toLowerCase()].filter(Boolean);
  const terms = [vibe.id, vibe.label, ...(vibe.match || [])]
    .map((t) => String(t || "").toLowerCase().trim())
    .filter(Boolean);
  return [...new Set(terms)];
}

function productMatchesAesthetic(product, aestheticId) {
  if (!aestheticId) return true;
  const terms = aestheticMatchTerms(aestheticId);
  if (!terms.length) return true;
  const hay = [
    product?.era,
    product?.name,
    product?.title,
    product?.description,
    product?.category,
    product?.browseCategory,
    product?.browseSubCategory,
    ...(Array.isArray(product?.tags) ? product.tags : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return terms.some((term) => hay.includes(term));
}

function filteredStoreProducts() {
  const tokens = tokenize(searchQuery);
  const maxPriceKes = parseMaxPriceKes(searchQuery);
  let items = storeProducts;
  if (activeItemType === "new") {
    items = items.filter((p) => !p.isSecondhand);
  } else if (activeItemType === "secondhand") {
    items = items.filter((p) => p.isSecondhand);
  }
  if (activePriceTier) {
    const tierMax = window.SokoniBrowse?.priceTierMaxKes(activePriceTier);
    if (tierMax != null) {
      items = items.filter((p) => p.priceKes == null || p.priceKes <= tierMax);
    }
  }
  if (activeAesthetic) {
    items = items.filter((p) => productMatchesAesthetic(p, activeAesthetic));
  }
  if (activeCategory === "viral") {
    items = items.filter((p) => p.viral || VIRAL_IDS.has(p.id));
  } else if (activeCategory !== "all") {
    const nav =
      window.SokoniBrowse?.resolveNavFilter?.(activeCategory, activeSubcategory) || {
        browse: activeCategory,
        sub: activeSubcategory,
      };
    items = items.filter((p) => {
      const path = window.SokoniBrowse?.resolveBrowsePath(p) || {};
      if (path.browse !== nav.browse) return false;
      if (nav.sub && path.sub !== nav.sub) return false;
      return true;
    });
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
    activeProductId ||
    activeItemType !== "all" ||
    activePriceTier ||
    activeAesthetic;
  const limit = filtered ? STORE_SEARCH_LIMIT : storeDisplayLimit;
  return { all, visible: all.slice(0, limit) };
}

function setCatalogFilter({
  category = "all",
  subcategory = null,
  productId = null,
  itemType = activeItemType,
  priceTier = activePriceTier,
  aesthetic = activeAesthetic,
  scroll = false,
} = {}) {
  searchQuery = "";
  activeCategory = category || "all";
  activeSubcategory = subcategory || null;
  activeProductId = productId || null;
  activeItemType = itemType || "all";
  activePriceTier = priceTier || null;
  activeAesthetic = aesthetic || null;
  storeDisplayLimit = STORE_SEARCH_LIMIT;

  const input = document.getElementById("hero-search");
  if (input) input.value = "";
  window.SokoniShopShell?.syncSearchInputs?.("");
  document.getElementById("search-status")?.classList.add("hidden");
  document.getElementById("search-wa-cta")?.classList.add("hidden");

  renderCategoryChips();
  renderBrowseFilters();
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
  const parts = [];
  if (activeCategory === "viral") {
    parts.push("Viral Bargains");
  } else if (activeCategory !== "all") {
    const catLabel = window.SokoniBrowse?.labelForBrowse(activeCategory) || activeCategory;
    if (activeSubcategory) {
      const subLabel = window.SokoniBrowse?.labelForBrowse(activeCategory, activeSubcategory) || activeSubcategory;
      parts.push(`${catLabel} → ${subLabel}`);
    } else {
      parts.push(catLabel);
    }
  }
  if (activeItemType === "new") parts.push("Brand New");
  if (activeItemType === "secondhand") parts.push("Pre-Loved");
  if (activePriceTier) {
    const menu = window.SokoniBrowse?.getMenu?.();
    const tier = menu?.priceTiers?.find((t) => t.id === activePriceTier);
    if (tier) parts.push(tier.label);
  }
  if (activeAesthetic) {
    const menu = window.SokoniBrowse?.getMenu?.();
    const vibe = menu?.aesthetics?.find((v) => v.id === activeAesthetic);
    if (vibe) parts.push(`#${vibe.label}`);
  }
  if (parts.length) {
    el.textContent = `Showing: ${parts.join(" · ")}`;
    el.classList.remove("hidden");
    return;
  }
  el.classList.add("hidden");
}

function runSearch(query) {
  searchQuery = query.trim();
  if (searchQuery) window.SokoniFeed?.trackSearch?.(searchQuery);
  storeDisplayLimit = STORE_INITIAL_LIMIT;
  activeSubcategory = null;
  activeProductId = null;
  const input = document.getElementById("hero-search");
  if (input && input.value !== searchQuery) input.value = searchQuery;
  window.SokoniShopShell?.syncSearchInputs?.(searchQuery);

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
  renderBrowseFilters();
  renderStoreGrid();
  syncCatalogNavUi();
}

// ---------- Render helpers ----------

function resolveProductImage(product) {
  const botOrigin =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:3001"
      : "https://bot.sokonimall.com";
  const raw = product?.imageUrl || (Array.isArray(product?.images) ? product.images[0] : null);
  if (raw && /^https?:\/\//i.test(String(raw))) return String(raw);
  if (product?.id) return `${botOrigin}/catalog-images/${encodeURIComponent(product.id)}.jpg`;
  if (raw) {
    const file = String(raw).replace(/^\/?assets\/images\/products\//i, "").replace(/^\/?catalog-images\//i, "");
    if (file) return `${botOrigin}/catalog-images/${encodeURIComponent(file.split("/").pop())}`;
  }
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

function normalizeHandleValue(value) {
  const clean = String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
  return clean.replace(/[^a-z0-9._-]+/g, "").slice(0, 40);
}

function sellerHandle(product) {
  const direct = normalizeHandleValue(
    product?.sellerHandle ||
      product?.shopHandle ||
      product?.seller?.handle ||
      product?.handle
  );
  if (direct) return `@${direct}`;

  const name = product.businessName || product.source || "";
  if (!name) return "";
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 18);
  return slug ? `@${slug}` : "";
}

function viewerQueryValue() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("viewer") || params.get("viewerUserId");
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return "";
  return String(n);
}

function sellerShopLink(product) {
  const handle = normalizeHandleValue(sellerHandle(product));
  if (!handle) return "";
  const params = new URLSearchParams({ handle });
  const viewer = viewerQueryValue();
  if (viewer) params.set("viewer", viewer);
  return `shop.html?${params.toString()}`;
}

function conditionBadgeHtml(product) {
  if (product.isSecondhand) {
    const cond =
      product.conditionLabel ||
      String(product.condition || "Pre-Loved")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    return `<span class="depop-card-condition depop-card-condition--thrift">♻️ ${escapeHtml(cond)}</span>`;
  }
  const newLabel =
    product.conditionLabel && /brand new/i.test(String(product.conditionLabel))
      ? product.conditionLabel
      : "Brand New";
  return `<span class="depop-card-condition depop-card-condition--new">✨ ${escapeHtml(newLabel)}</span>`;
}

function renderDepopCard(product) {
  const name = escapeHtml(product.name || "Product");
  const id = escapeHtml(product.id || "");
  const src = resolveProductImage(product);
  const imageInner = src
    ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'depop-card-placeholder',textContent:'Photo soon'}))" />`
    : `<span class="depop-card-placeholder">Photo soon</span>`;
  const handle = sellerHandle(product);
  const shopLink = sellerShopLink(product);
  const saved = window.SokoniShopShell?.isHearted?.(product.id) ?? window.SokoniShopShell?.isInBag?.(product.id);

  return `
    <article class="depop-card" data-product-id="${id}" tabindex="0" role="button" aria-label="${name}, ${escapeHtml(formatPrice(product))}">
      <div class="depop-card-image-wrap">
        ${imageInner}
        ${conditionBadgeHtml(product)}
        <button type="button" class="depop-card-heart${saved ? " is-saved" : ""}" data-save-id="${id}" aria-label="${saved ? "Remove from saved" : "Save item"}">${saved ? "♥" : "♡"}</button>
        <span class="depop-card-badge">PREPAID</span>
      </div>
      <div class="depop-card-body">
        <p class="depop-card-price">${escapeHtml(formatPrice(product))}</p>
        <p class="depop-card-title">${name}</p>
        ${
          handle
            ? `<p class="depop-card-seller">${
                shopLink
                  ? `<a href="${shopLink}" data-shop-link="1" class="underline hover:text-brand-green">${escapeHtml(handle)}</a>`
                  : escapeHtml(handle)
              }</p>`
            : ""
        }
      </div>
    </article>`;
}

function renderStoreCard(product) {
  const name = escapeHtml(product.name || "Product");
  const rating = Number(product.rating) || 0;
  const reviews = Number(product.reviews) || 0;
  const handle = sellerHandle(product);
  const shopLink = sellerShopLink(product);
  return `
    <div class="product-card relative bg-white rounded-2xl border border-black/5 shadow-sm p-5 flex flex-col">
      <span class="absolute top-3 left-3 z-10 bg-brand-green text-brand-purple text-[10px] font-bold px-2 py-1 rounded-full">🔒 Prepaid</span>
      <span class="absolute top-3 right-3 z-10 bg-brand-purple/8 text-brand-purple/70 text-[10px] font-mono font-semibold px-2 py-1 rounded-full border border-brand-purple/15">${escapeHtml(product.id || "")}</span>
      ${productImageBlock(product)}
      <h3 class="font-bold text-sm mb-1 line-clamp-2">${name}</h3>
      <p class="text-xs text-brand-purple/50 mb-2">${[
        window.SokoniBrowse?.labelForBrowse(
          window.SokoniBrowse?.resolveBrowsePath(product)?.browse,
          window.SokoniBrowse?.resolveBrowsePath(product)?.sub
        ) || CATEGORY_META[product.category]?.label || product.category,
        product.isSecondhand ? "Pre-Loved" : null,
      ]
        .filter(Boolean)
        .join(" · ")}</p>
      <div class="flex items-baseline gap-2 mb-1 flex-wrap">
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
          🛒 Buy — prepaid
        </a>
        <a href="${askLinkFor(product)}" target="_blank" rel="noopener"
           class="text-center text-xs text-brand-purple/60 underline hover:text-brand-purple">
          💬 Ask about it on WhatsApp
        </a>
        ${
          handle && shopLink
            ? `<a href="${shopLink}" data-shop-link="1"
               class="text-center text-xs text-brand-purple/60 underline hover:text-brand-green">
              🏪 View ${escapeHtml(handle)} shop
            </a>`
            : ""
        }
      </div>
    </div>
  `;
}

function renderCategoryChips() {
  const grid = document.getElementById("category-grid");
  if (!grid) return;
  const menu = window.SokoniBrowse?.getMenu?.();
  const browseCats = menu?.categories || [];
  const chip = (id, label, emoji) => {
    const active = activeCategory === id && !activeProductId;
    return `
    <button type="button" data-cat="${id}"
      class="depop-cat-card cat-chip ${active ? "is-active" : ""}">
      <span class="depop-cat-card__icon" aria-hidden="true">${emoji}</span>
      <span class="depop-cat-card__label">${label}</span>
    </button>`;
  };
  grid.innerHTML =
    chip("all", "All Products", "🛍️") +
    chip("viral", "Viral Bargains", "🔥") +
    browseCats
      .slice(0, 8)
      .map((c) => chip(c.id, c.label, c.emoji || "🛍️"))
      .join("");
  if (window.SokoniComponents) SokoniComponents.upgradeIn(grid);
  grid.querySelectorAll(".cat-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      setCatalogFilter({
        category: btn.dataset.cat,
        subcategory: null,
        productId: null,
        priceTier: btn.dataset.cat === "sale" ? activePriceTier : null,
      });
    });
  });
}

function renderBrowseFilters() {
  const bar = document.getElementById("browse-filter-bar");
  const itemWrap = document.getElementById("item-type-chips");
  const priceWrap = document.getElementById("price-tier-chips");
  const vibeWrap = document.getElementById("vibe-filter-chips");
  if (!bar || !itemWrap || !priceWrap) return;

  const menu = window.SokoniBrowse?.getMenu?.();
  const itemTypes = menu?.itemTypes || [
    { id: "all", label: "All Items" },
    { id: "new", label: "Brand New" },
    { id: "secondhand", label: "Pre-Loved / Thrift" },
  ];
  const priceTiers = menu?.priceTiers || [];
  const aesthetics = menu?.aesthetics || [];

  const filterChip = (id, label, active, dataAttr, dataVal) => `
    <button type="button" class="browse-chip ${active ? "is-active" : ""}" ${dataAttr}="${dataVal}">${label}</button>`;

  itemWrap.innerHTML = itemTypes
    .map((t) =>
      filterChip(
        t.id,
        t.label,
        activeItemType === t.id,
        "data-item-type",
        t.id
      )
    )
    .join("");

  if (vibeWrap) {
    vibeWrap.innerHTML = aesthetics
      .map((v) =>
        filterChip(
          v.id,
          `#${v.label}`,
          activeAesthetic === v.id,
          "data-aesthetic",
          v.id
        )
      )
      .join("");
  }

  priceWrap.innerHTML = priceTiers
    .map((t) =>
      filterChip(
        t.id,
        t.label,
        activePriceTier === t.id,
        "data-price-tier",
        t.id
      )
    )
    .join("");

  bar.classList.toggle("hidden", storeProducts.length === 0);

  itemWrap.querySelectorAll("[data-item-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeItemType = btn.dataset.itemType || "all";
      storeDisplayLimit = STORE_SEARCH_LIMIT;
      renderBrowseFilters();
      renderStoreGrid();
      syncCatalogNavUi();
    });
  });

  vibeWrap?.querySelectorAll("[data-aesthetic]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const vibe = btn.dataset.aesthetic;
      activeAesthetic = activeAesthetic === vibe ? null : vibe;
      storeDisplayLimit = STORE_SEARCH_LIMIT;
      renderBrowseFilters();
      renderStoreGrid();
      syncCatalogNavUi();
    });
  });

  priceWrap.querySelectorAll("[data-price-tier]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tier = btn.dataset.priceTier;
      activePriceTier = activePriceTier === tier ? null : tier;
      if (activePriceTier && activeCategory === "all") activeCategory = "sale";
      storeDisplayLimit = STORE_SEARCH_LIMIT;
      renderBrowseFilters();
      renderStoreGrid();
      syncCatalogNavUi();
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
  for (const id of ["categories", "deals"]) {
    document.getElementById(id)?.classList.add("is-visible");
  }
}

let storeGridClickBound = false;
let pendingProductSheetId = null;

function bindStoreGridClicks() {
  if (storeGridClickBound) return;
  const grid = document.getElementById("local-deals-grid");
  if (!grid) return;
  storeGridClickBound = true;
  grid.addEventListener("click", (e) => {
    const heart = e.target.closest(".depop-card-heart[data-save-id]");
    if (heart) {
      e.preventDefault();
      e.stopPropagation();
      const pid = heart.dataset.saveId;
      const saved = window.SokoniShopShell?.toggleBag?.(pid);
      heart.classList.toggle("is-saved", Boolean(saved));
      heart.textContent = saved ? "♥" : "♡";
      heart.setAttribute("aria-label", saved ? "Remove from saved" : "Save item");
      return;
    }
    if (e.target.closest("[data-shop-link]")) return;
    const card = e.target.closest(".depop-card[data-product-id]");
    if (!card) return;
    const p = storeProducts.find((x) => x.id === card.dataset.productId);
    if (p) window.SokoniProductSheet?.open(p);
  });
  grid.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".depop-card[data-product-id]");
    if (!card || e.target.closest(".depop-card-heart") || e.target.closest("[data-shop-link]")) return;
    e.preventDefault();
    const p = storeProducts.find((x) => x.id === card.dataset.productId);
    if (p) window.SokoniProductSheet?.open(p);
  });
}

function openPendingProductSheet() {
  if (!pendingProductSheetId) return;
  const id = pendingProductSheetId;
  pendingProductSheetId = null;
  const p = storeProducts.find((x) => x.id === id);
  if (p) {
    document.getElementById("deals")?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.SokoniProductSheet?.open(p);
  }
}

function renderStoreGrid() {
  const grid = document.getElementById("local-deals-grid");
  const empty = document.getElementById("local-deals-empty");
  const catalogRefresh = document.getElementById("catalog-refresh-empty");
  const emptyWa = document.getElementById("search-empty-wa");
  const viralEmpty = document.getElementById("viral-empty");
  if (!grid) return;

  const { all: allItems, visible: items } = visibleStoreProducts();
  grid.innerHTML = items.map(renderDepopCard).join("");

  const searching = hasActiveSearch();
  const catalogEmpty = storeProducts.length === 0 && !searching;
  const showEmpty = allItems.length === 0 && searching;
  const isViralTab = activeCategory === "viral" && !searching;

  grid.classList.toggle("hidden", showEmpty || catalogEmpty || (isViralTab && allItems.length === 0));
  if (catalogRefresh) catalogRefresh.classList.toggle("hidden", !catalogEmpty);
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
    if (linkEl) {
      const q = copy.ask || "help me find something";
      linkEl.href = `ask.html?q=${encodeURIComponent(q)}`;
      linkEl.removeAttribute("target");
    }
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

async function isCatalogPaused() {
  try {
    const res = await fetch(dataUrl("data/catalog-paused.json"));
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data.paused);
  } catch {
    return false;
  }
}

async function loadProductsFromApi() {
  const all = [];
  let offset = 0;
  const limit = 500;
  while (true) {
    const res = await fetch(`${PRODUCTS_API}?limit=${limit}&offset=${offset}`);
    if (!res.ok) throw new Error(`products API ${res.status}`);
    const data = await res.json();
    const batch = data.products || [];
    all.push(...batch);
    const total = data.total ?? all.length;
    if (!batch.length || batch.length < limit || all.length >= total) break;
    offset += limit;
  }
  return all.map((p) => (window.SokoniBrowse?.enrichProduct(p) || p));
}

async function loadProducts() {
  if (await isCatalogPaused()) {
    return [];
  }
  await window.SokoniBrowse?.loadMenu?.();
  try {
    const fromApi = await loadProductsFromApi();
    if (fromApi.length) return fromApi;
  } catch (err) {
    console.warn("Products API unavailable, falling back to JSON:", err.message);
  }
  const response = await fetch(dataUrl("data/products.json"));
  const json = await response.json();
  const list = Array.isArray(json) ? json : json.products || [];
  return list.map((p) => window.SokoniBrowse?.enrichProduct(p) || p);
}

async function loadStoreMeta() {
  if (await isCatalogPaused()) return;
  try {
    const res = await fetch(PRODUCTS_API.replace(/\/$/, "") + "/meta");
    if (!res.ok) return;
    const meta = await res.json();
    const el = document.getElementById("hero-store-count");
    if (el && meta.productCount) el.textContent = meta.productCount.toLocaleString();
  } catch {
    /* static fallback in HTML */
  }
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
    await loadStoreMeta();
    const products = (await loadProducts()).filter((p) => p.inStock !== false);
    storeProducts = products.filter((p) => p.fulfillment === "store" || (p.scope === "local" && p.fulfillment !== "supplier"));

    loadCurrencyPref();
    syncCurrencyUi();
    bindSearch();
    bindStoreGridClicks();
    setupBrowseNudge();
    applyDeepLinkFromUrl();

    renderCategoryChips();
    renderBrowseFilters();
    renderStoreGrid();
    openPendingProductSheet();
    revealCatalogSections();

    if (window.SokoniShopShell?.hydrateLikesFromServer) {
      await window.SokoniShopShell.hydrateLikesFromServer(storeProducts.map((p) => p.id));
    }

    const navigateBrowse = (sel) =>
      setCatalogFilter({
        category: sel.category,
        subcategory: sel.subcategory,
        productId: sel.productId,
        priceTier: sel.priceTier ?? activePriceTier,
        scroll: sel.scroll,
      });

    if (window.SokoniMegaMenu) {
      await window.SokoniMegaMenu.init({ navigate: navigateBrowse });
    }

    if (window.SokoniCatalogNav) {
      await window.SokoniCatalogNav.init({
        products: storeProducts,
        navigate: navigateBrowse,
      });
    }

    if (window.SokoniFeed?.refresh) window.SokoniFeed.refresh();
    window.SokoniShopShell?.syncHeartButtons?.();
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

/** ?text= / ?q= pre-fill search; ?product= opens detail sheet (e.g. ?product=sk-0042). */
function applyDeepLinkFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const text = params.get("text") || params.get("q");
  if (text?.trim()) {
    runSearch(text.trim());
    return;
  }
  const productId = params.get("product")?.trim();
  if (!productId) return;
  searchQuery = "";
  activeCategory = "all";
  activeSubcategory = null;
  activeProductId = productId;
  pendingProductSheetId = productId;
}

window.SokoniApp = {
  getStoreProducts: () => storeProducts,
  formatPrice,
  buyerPriceKes,
  formatShippingLine,
  formatBuyerTotal,
  resolveProductImage,
  runSearch,
  setCatalogFilter,
  renderDepopCard,
};

renderProducts();
renderReviews();
bindReviewForm();
