// Demo storefront rendering. In production this would call a small API backed
// by the same catalog the WhatsApp bot uses (see ../whatsapp-bot/src/data/products.json)
// instead of fetching a static JSON file directly.

const WHATSAPP_NUMBER = "254700000000"; // TODO: replace with your real WhatsApp Business number

const CATEGORIES = [
  { id: "electronics", label: "Electronics & Phones", emoji: "📱" },
  { id: "fashion", label: "Fashion & Beauty", emoji: "👗" },
  { id: "home", label: "Home & Living", emoji: "🏠" },
  { id: "international", label: "International Deals", emoji: "🌍" },
];

function waLinkFor(product) {
  const text = `Hi Sokoni, I'm interested in "${product.name}" (${formatPrice(product)}). Can you tell me more?`;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

function formatPrice(product) {
  if (product.priceKes) {
    return `KES ${product.priceKes.toLocaleString()}`;
  }
  return `$${product.priceUsd}`;
}

function discountBadge(product) {
  if (!product.originalPriceKes) return "";
  const pct = Math.round((1 - product.priceKes / product.originalPriceKes) * 100);
  return `<span class="absolute top-3 left-3 bg-brand-green text-brand-purple text-xs font-bold px-2 py-1 rounded-full">-${pct}%</span>`;
}

function renderProductCard(product) {
  return `
    <div class="product-card relative bg-white rounded-2xl border border-black/5 shadow-sm p-5 flex flex-col">
      ${discountBadge(product)}
      <div class="text-5xl mb-4 text-center">${product.emoji || "🛍️"}</div>
      <h3 class="font-bold text-sm mb-1 line-clamp-2">${product.name}</h3>
      <p class="text-xs text-brand-purple/50 mb-2">${product.source}${product.estDelivery ? ` · ${product.estDelivery}` : ""}</p>
      <div class="flex items-baseline gap-2 mb-1">
        <span class="font-extrabold text-lg">${formatPrice(product)}</span>
        ${product.originalPriceKes ? `<span class="text-xs text-brand-purple/40 line-through">KES ${product.originalPriceKes.toLocaleString()}</span>` : ""}
      </div>
      <p class="text-xs text-brand-purple/50 mb-4">⭐ ${product.rating} (${product.reviews.toLocaleString()} reviews)</p>
      <div class="mt-auto flex flex-col gap-2">
        <a href="${waLinkFor(product)}" target="_blank" rel="noopener"
           class="text-center bg-brand-green text-brand-purple text-sm font-bold px-4 py-2 rounded-full hover:scale-105 transition">
          💬 Ask on WhatsApp
        </a>
        <a href="${product.sourceUrl}" target="_blank" rel="noopener sponsored"
           class="text-center text-xs text-brand-purple/60 underline hover:text-brand-purple">
          View deal on ${product.source} ↗
        </a>
      </div>
    </div>
  `;
}

function renderCategoryGrid() {
  const grid = document.getElementById("category-grid");
  if (!grid) return;
  grid.innerHTML = CATEGORIES.map(
    (cat) => `
      <a href="#deals" class="group bg-white rounded-2xl border border-black/5 shadow-sm p-6 text-center hover:shadow-lg hover:-translate-y-1 transition">
        <div class="text-4xl mb-3">${cat.emoji}</div>
        <p class="font-semibold text-sm group-hover:text-brand-green">${cat.label}</p>
      </a>
    `
  ).join("");
}

async function loadProducts() {
  const response = await fetch("data/products.json");
  return response.json();
}

async function renderProducts() {
  try {
    const products = (await loadProducts()).filter((p) => p.inStock !== false);
    const local = products.filter((p) => p.scope === "local").slice(0, 4);
    const intl = products.filter((p) => p.scope === "international").slice(0, 4);
    const localGrid = document.getElementById("local-deals-grid");
    const intlGrid = document.getElementById("intl-grid");
    if (localGrid) localGrid.innerHTML = local.map(renderProductCard).join("");
    if (intlGrid) intlGrid.innerHTML = intl.map(renderProductCard).join("");
  } catch (err) {
    console.error("Failed to load product catalog:", err);
  }
}

renderCategoryGrid();
renderProducts();
