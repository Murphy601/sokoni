const SUPPLIERS_API =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001/api/suppliers"
    : "https://bot.sokonimall.com/api/suppliers";

const WHATSAPP_NUMBER = "254117422428";

const CATEGORY_LABELS = {
  "phones-tablets": "Phones & Tablets",
  "tvs-audio": "TVs & Audio",
  appliances: "Appliances",
  "health-beauty": "Health & Beauty",
  "home-office": "Home & Office",
  fashion: "Fashion",
  computing: "Computing",
  gaming: "Gaming",
  supermarket: "Supermarket",
  "baby-products": "Baby Products",
};

let categories = Object.keys(CATEGORY_LABELS);
let productRows = [];

function el(id) {
  return document.getElementById(id);
}

function formatKes(n) {
  return `KES ${Math.round(Number(n) || 0).toLocaleString()}`;
}

async function loadInfo() {
  try {
    const res = await fetch(`${SUPPLIERS_API}/info`);
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data.categories) && data.categories.length) {
      categories = data.categories;
    }
    const flat = data.markup?.flatKes ?? 100;
    const pct = Math.round((data.markup?.percent ?? 0.08) * 100);
    const note = el("pricing-note");
    if (note) {
      note.textContent = `Sokoni retail is estimated at your supply price + KES ${flat} + ${pct}% (rounded to nearest KES 50). Final shelf price is set on approval.`;
    }
  } catch {
    /* offline / preview */
  }
}

function productRowTemplate(index, draft = {}) {
  const opts = categories
    .map(
      (c) =>
        `<option value="${c}"${draft.category === c ? " selected" : ""}>${CATEGORY_LABELS[c] || c}</option>`
    )
    .join("");

  return `
    <div class="product-row rounded-2xl border border-brand-purple/10 dark:border-white/10 bg-white/60 dark:bg-brand-purpleLight/40 p-4 space-y-3" data-index="${index}">
      <div class="flex items-center justify-between gap-2">
        <p class="text-sm font-semibold">Product ${index + 1}</p>
        <button type="button" class="remove-product text-xs text-red-600 hover:underline"${index === 0 ? " hidden" : ""}>Remove</button>
      </div>
      <div class="grid sm:grid-cols-2 gap-3">
        <label class="block text-xs font-medium">SKU / code
          <input name="sku-${index}" type="text" class="mt-1 w-full rounded-xl border border-brand-purple/15 px-3 py-2 text-sm" placeholder="e.g. HP-001" value="${draft.sku || ""}" />
        </label>
        <label class="block text-xs font-medium">Category
          <select name="category-${index}" class="mt-1 w-full rounded-xl border border-brand-purple/15 px-3 py-2 text-sm">${opts}</select>
        </label>
      </div>
      <label class="block text-xs font-medium">Product name
        <input name="name-${index}" type="text" required class="mt-1 w-full rounded-xl border border-brand-purple/15 px-3 py-2 text-sm" placeholder="e.g. Bluetooth speaker" value="${draft.name || ""}" />
      </label>
      <div class="grid sm:grid-cols-2 gap-3">
        <label class="block text-xs font-medium">Your supply price (KES)
          <input name="price-${index}" type="number" min="1" required class="mt-1 w-full rounded-xl border border-brand-purple/15 px-3 py-2 text-sm supplier-price" placeholder="3000" value="${draft.supplierPriceKes || ""}" />
        </label>
        <div class="text-xs">
          <span class="font-medium">Est. Sokoni retail</span>
          <p class="mt-2 rounded-xl bg-brand-green/10 px-3 py-2 font-semibold retail-preview" data-index="${index}">—</p>
        </div>
      </div>
      <label class="block text-xs font-medium">Short description (optional)
        <textarea name="desc-${index}" rows="2" class="mt-1 w-full rounded-xl border border-brand-purple/15 px-3 py-2 text-sm" placeholder="Color, size, key specs">${draft.description || ""}</textarea>
      </label>
      <label class="inline-flex items-center gap-2 text-xs">
        <input name="stock-${index}" type="checkbox" class="rounded"${draft.inStock !== false ? " checked" : ""} />
        In stock now
      </label>
    </div>`;
}

function renderProducts() {
  const wrap = el("products-wrap");
  if (!wrap) return;
  wrap.innerHTML = productRows.map((row, i) => productRowTemplate(i, row)).join("");
  bindProductEvents();
  productRows.forEach((_, i) => updateRetailPreview(i));
}

function bindProductEvents() {
  document.querySelectorAll(".remove-product").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = btn.closest(".product-row");
      const idx = Number(row?.dataset.index);
      if (Number.isFinite(idx)) {
        productRows.splice(idx, 1);
        if (productRows.length === 0) productRows.push({});
        renderProducts();
      }
    });
  });

  document.querySelectorAll(".supplier-price").forEach((input) => {
    input.addEventListener("input", () => {
      const row = input.closest(".product-row");
      updateRetailPreview(Number(row?.dataset.index));
    });
  });
}

async function updateRetailPreview(index) {
  const preview = document.querySelector(`.retail-preview[data-index="${index}"]`);
  const priceInput = document.querySelector(`input[name="price-${index}"]`);
  if (!preview || !priceInput) return;
  const price = Number(priceInput.value);
  if (!Number.isFinite(price) || price <= 0) {
    preview.textContent = "—";
    return;
  }
  try {
    const res = await fetch(`${SUPPLIERS_API}/preview-price?supplierPriceKes=${price}`);
    if (!res.ok) throw new Error("preview failed");
    const data = await res.json();
    preview.textContent = formatKes(data.retailPriceKes);
  } catch {
    const raw = price + 100 + Math.round(price * 0.08);
    const retail = Math.ceil(raw / 50) * 50;
    preview.textContent = formatKes(retail);
  }
}

function collectProducts() {
  const rows = document.querySelectorAll(".product-row");
  const products = [];
  rows.forEach((row) => {
    const i = row.dataset.index;
    const name = document.querySelector(`input[name="name-${i}"]`)?.value.trim();
    const supplierPriceKes = Number(document.querySelector(`input[name="price-${i}"]`)?.value);
    if (!name || !Number.isFinite(supplierPriceKes) || supplierPriceKes <= 0) return;
    products.push({
      sku: document.querySelector(`input[name="sku-${i}"]`)?.value.trim() || `item-${Number(i) + 1}`,
      name,
      category: document.querySelector(`select[name="category-${i}"]`)?.value || "home-office",
      supplierPriceKes,
      description: document.querySelector(`textarea[name="desc-${i}"]`)?.value.trim() || "",
      inStock: document.querySelector(`input[name="stock-${i}"]`)?.checked !== false,
      hasPhoto: false,
    });
  });
  return products;
}

async function submitApplication(event) {
  event.preventDefault();
  const status = el("form-status");
  const btn = el("submit-btn");
  if (status) status.textContent = "";

  const delivers = document.querySelector('input[name="delivers"]:checked')?.value === "yes";
  const payload = {
    businessName: el("businessName")?.value.trim(),
    contactName: el("contactName")?.value.trim(),
    phone: el("phone")?.value.trim(),
    email: el("email")?.value.trim(),
    city: el("city")?.value.trim(),
    delivers,
    deliveryAreas: el("deliveryAreas")?.value.trim() || "Countrywide",
    deliveryNote: el("deliveryNote")?.value.trim(),
    products: collectProducts(),
  };

  if (!payload.businessName || !payload.phone) {
    if (status) status.textContent = "Business name and WhatsApp phone are required.";
    return;
  }
  if (payload.products.length === 0) {
    if (status) status.textContent = "Add at least one product with a valid supply price.";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Submitting…";
  try {
    const res = await fetch(`${SUPPLIERS_API}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Submission failed");
    window.location.href = `apply.html?submitted=${encodeURIComponent(data.applicationId || "1")}`;
  } catch (err) {
    if (status) status.textContent = err.message || "Could not submit. Try again or WhatsApp us.";
    btn.disabled = false;
    btn.textContent = "Submit application";
  }
}

function initApplyPage() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("submitted")) {
    const ref = params.get("submitted");
    const box = el("success-box");
    const form = el("apply-form");
    if (box) {
      box.classList.remove("hidden");
      el("application-id").textContent = ref;
    }
    const wa = el("continue-wa-link");
    if (wa) {
      const msg = `Hi Sokoni, I applied as a supplier on sokonimall.com (ref ${ref}). Continue my application on WhatsApp with prefilled steps.`;
      wa.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
    }
    if (form) form.classList.add("hidden");
    return;
  }

  productRows = [{}];
  renderProducts();
  el("add-product")?.addEventListener("click", () => {
    productRows.push({});
    renderProducts();
  });
  el("apply-form")?.addEventListener("submit", submitApplication);

  document.querySelectorAll('input[name="delivers"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      const areas = el("delivery-fields");
      const yes = document.querySelector('input[name="delivers"][value="yes"]:checked');
      if (areas) areas.classList.toggle("hidden", !yes);
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadInfo();
  if (document.body.dataset.page === "apply") initApplyPage();
});
