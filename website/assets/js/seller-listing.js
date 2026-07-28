const API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001"
    : "https://bot.sokonimall.com";
const LISTINGS_API = `${API_BASE}/api/seller/listings`;
const ONBOARD_API = `${API_BASE}/api/seller/onboard`;
const SOCIAL_API = `${API_BASE}/api/social`;

const PHONE_KEY = "sokoni-seller-phone";
const DRAFT_KEY = "sokoni-seller-draft";
const VERIFY_TOKEN_KEY = "sokoni-seller-verify-token";
const PLATFORM_FEE_RATE = 0.1;
const MIN_SHIPPING_KES = 150;
const SELLER_OFFERS_POLL_MS = 45000;
const SELLER_OFFER_FILTERS = new Set(["pending", "all", "accepted", "declined"]);
const HANDLED_ACCEPTED_OFFERS_KEY = "sokoni-seller-handled-accepted-offers";

const CONDITION_LABELS = {
  brand_new_with_tags: "Brand new with tags",
  brand_new_without_tags: "Brand new without tags",
  like_new: "Like new",
  gently_used: "Gently used",
  fair_condition: "Fair condition",
};

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

const STEPS = ["media", "details", "attributes", "pricing", "review"];
let stepIndex = 0;
let meta = { conditions: Object.keys(CONDITION_LABELS), maxPhotos: 4, browseTaxonomy: [] };
let draft = {};
let photoFiles = [null, null, null, null];
let photoPreviews = [null, null, null, null];
let videoFile = null;
let videoPreview = null;
let sellerInfo = null;

function el(id) {
  return document.getElementById(id);
}

function formatKes(n) {
  return `KES ${Math.round(Number(n) || 0).toLocaleString()}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getPhone() {
  return String(el("seller-phone")?.value || localStorage.getItem(PHONE_KEY) || "").trim();
}

function apiPhone() {
  return normalizePhoneInput(getPhone());
}

function savePhone() {
  const phone = getPhone();
  if (phone) localStorage.setItem(PHONE_KEY, phone);
}

function getSessionToken() {
  return verificationToken;
}

function sellerAuthHeaders(extra = {}) {
  // Session token goes in query/body (sessionToken) — avoid custom headers so CORS preflight stays simple.
  return { ...extra };
}

function onboardQuery(phone) {
  const params = new URLSearchParams({ phone: normalizePhoneInput(phone) });
  const token = getSessionToken();
  if (token) params.set("sessionToken", token);
  return `${ONBOARD_API}?${params}`;
}

function listingsQuery(phone) {
  const params = new URLSearchParams({ phone: normalizePhoneInput(phone) });
  const token = getSessionToken();
  if (token) params.set("sessionToken", token);
  return `${LISTINGS_API}?${params}`;
}

function jsonAuthBody(payload) {
  const token = getSessionToken();
  return { ...payload, ...(token ? { sessionToken: token } : {}) };
}

function clearSession() {
  verificationToken = null;
  phoneVerified = false;
  sellerProfile = null;
  sellerSocialUserIdPromise = null;
  clearHandledAcceptedOffersStorage();
  sellerOffersCache = [];
  activeSellerOffersFilter = "pending";
  acceptedQuickCursor = 0;
  stopSellerOffersPolling();
  currentSellerView = "dashboard";
  setDashboardOfferBadge(0);
  syncOfferFilterButtons();
  updateHandledResetButton();
  updateQuickModeHint();
  sessionStorage.removeItem(VERIFY_TOKEN_KEY);
}

function handleSessionExpired(data) {
  clearSession();
  showVerifyPanel();
  setOnboardStatus(data?.message || "Session expired — verify WhatsApp again.", true);
}

function showVerifyPanel() {
  el("listing-wizard")?.classList.add("hidden");
  el("onboard-panel")?.classList.remove("hidden");
  el("onboard-details-step")?.classList.add("hidden");
  el("onboard-btn")?.classList.add("hidden");
  el("onboard-verify-step")?.classList.remove("hidden", "opacity-80");
  el("verify-code-wrap")?.classList.add("hidden");
  const phoneInput = el("seller-phone");
  if (phoneInput) phoneInput.readOnly = false;
}

function setStatus(msg, isError = false) {
  const node = el("form-status");
  if (!node) return;
  node.textContent = msg || "";
  node.classList.toggle("text-red-600", isError);
  node.classList.toggle("dark:text-red-400", isError);
  node.classList.toggle("text-brand-green", !isError && Boolean(msg));
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Shrink phone photos so API payload stays under server limit. */
async function compressImageFile(file, maxDim = 1280, quality = 0.82) {
  if (!file?.type?.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob || blob.size >= file.size * 0.95) return file;
    return new File([blob], (file.name || "photo").replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

function populateSelect(select, options, labels, selected) {
  if (!select) return;
  select.innerHTML = options
    .map((v) => `<option value="${v}"${v === selected ? " selected" : ""}>${labels[v] || v}</option>`)
    .join("");
}

function updateStepUi() {
  STEPS.forEach((name, i) => {
    el(`panel-${name}`)?.classList.toggle("is-active", i === stepIndex);
    const bar = el(`step-bar-${i}`);
    bar?.classList.toggle("is-active", i === stepIndex);
    bar?.classList.toggle("is-done", i < stepIndex);
  });
  el("step-label").textContent = `Step ${stepIndex + 1} of ${STEPS.length}`;
  const onReview = stepIndex === STEPS.length - 1;
  el("btn-next")?.classList.toggle("hidden", onReview);
  el("post-btn")?.classList.toggle("hidden", !onReview);
  el("btn-back")?.classList.toggle("hidden", stepIndex === 0);
}

function goStep(delta) {
  stepIndex = Math.max(0, Math.min(STEPS.length - 1, stepIndex + delta));
  updateStepUi();
  if (STEPS[stepIndex] === "pricing") updateFeeBreakdown();
  if (STEPS[stepIndex] === "review") fillReview();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function getShippingTier(classId) {
  const tiers = meta.shippingTiers || [];
  return tiers.find((t) => t.id === classId) || tiers[0] || null;
}

function getShippingTierLabel(classId) {
  const tier = getShippingTier(classId);
  if (!tier) return "";
  const weight = tier.weightNote ? ` · ${tier.weightNote}` : "";
  return `${tier.label}${weight} — typical ${formatKes(tier.typicalKes)} (KES ${tier.minKes}–${tier.maxKes})`;
}

function populateWeightClassSelect(selected) {
  const select = el("draft-weight-class");
  if (!select) return;
  const tiers = meta.shippingTiers || [];
  select.innerHTML = tiers
    .map(
      (t) =>
        `<option value="${t.id}">${t.label} (${t.weightNote || t.id}) — ${formatKes(t.typicalKes)}</option>`
    )
    .join("");
  if (selected) select.value = selected;
  else if (tiers[0]) select.value = tiers[0].id;
}

function isFreeShipping() {
  return Boolean(el("draft-free-shipping")?.checked);
}

function computeFeeBreakdown(sellerNetKes, shippingKes, freeShipping = isFreeShipping()) {
  const sellerNet = Math.max(0, Math.round(Number(sellerNetKes) || 0));
  const shipRaw = Math.round(Number(shippingKes) || 0);
  const shipping = freeShipping ? 0 : Math.max(MIN_SHIPPING_KES, shipRaw || MIN_SHIPPING_KES);
  const subtotal = sellerNet + shipping;
  const platformFee = Math.round(subtotal * PLATFORM_FEE_RATE);
  const buyerTotal = subtotal + platformFee;
  return {
    sellerNetKes: sellerNet,
    itemKes: sellerNet,
    shippingKes: shipping,
    subtotalKes: subtotal,
    buyerTotalKes: buyerTotal,
    platformFeeKes: platformFee,
    freeShipping,
  };
}

function syncShippingFromWeightClass() {
  if (isFreeShipping()) return;
  const tier = getShippingTier(el("draft-weight-class")?.value);
  if (!tier || !el("draft-shipping")) return;
  el("draft-shipping").value = String(tier.typicalKes);
}

function updateAiWeightNote(classId) {
  const note = el("ai-weight-note");
  const label = el("ai-weight-label");
  if (!note || !label) return;
  if (classId && draft.estimatedWeightClass) {
    label.textContent = getShippingTierLabel(classId);
    note.classList.remove("hidden");
  } else {
    note.classList.add("hidden");
  }
}

function updateShippingFieldState() {
  const free = isFreeShipping();
  const shipInput = el("draft-shipping");
  const weightSelect = el("draft-weight-class");
  if (shipInput) {
    shipInput.disabled = free;
    if (free) shipInput.value = "0";
  }
  if (weightSelect) weightSelect.disabled = free;
}

function renderFeeBreakdown(fees, prefix = "fee") {
  const set = (id, val) => {
    const node = el(`${prefix}-${id}`);
    if (node) node.textContent = formatKes(val);
  };
  set("item", fees.sellerNetKes);
  set("shipping", fees.shippingKes);
  set("buyer", fees.buyerTotalKes);
  const platformNode = el(`${prefix}-platform`);
  if (platformNode) platformNode.textContent = formatKes(fees.platformFeeKes);
  set("net", fees.sellerNetKes);
}

function updateFeeBreakdown() {
  updateShippingFieldState();
  const fees = computeFeeBreakdown(el("draft-price")?.value, el("draft-shipping")?.value);
  renderFeeBreakdown(fees, "fee");
  const classId = el("draft-weight-class")?.value || draft.estimatedWeightClass;
  const hint = el("shipping-tier-hint");
  if (hint && classId) hint.textContent = getShippingTierLabel(classId);
  updateAiWeightNote(classId);
}

function retailFromSupply(supply) {
  const cost = Math.max(0, Number(supply) || 0);
  return Math.ceil((cost + 100 + Math.round(cost * 0.08)) / 50) * 50;
}

let sellerProfile = null;
let ledgerData = null;
let activeLedgerTab = "available";
let verificationToken = null;
let phoneVerified = false;
let resendCooldownTimer = null;
let sellerSocialUserIdPromise = null;
let sellerOffersPollTimer = null;
let sellerOffersRequestInFlight = false;
let currentSellerView = "dashboard";
let activeSellerOffersFilter = "pending";
let sellerOffersCache = [];
let acceptedQuickCursor = 0;
let handledAcceptedOfferIds = new Set();
let handledOffersStorageKey = null;

function bindMediaSlots() {
  for (let i = 0; i < 4; i += 1) {
    const input = el(`photo-slot-${i}`);
    if (!input || input.dataset.bound) continue;
    input.dataset.bound = "1";
    input.addEventListener("change", async (ev) => {
      const file = ev.target.files?.[0];
      if (!file) return;
      photoFiles[i] = file;
      if (photoPreviews[i]) URL.revokeObjectURL(photoPreviews[i]);
      photoPreviews[i] = URL.createObjectURL(file);
      const slot = el(`media-slot-${i}`);
      let img = slot?.querySelector("img.preview");
      if (!img && slot) {
        img = document.createElement("img");
        img.className = "preview";
        img.alt = "";
        slot.insertBefore(img, slot.firstChild);
      }
      if (img) img.src = photoPreviews[i];
      slot?.classList.add("has-media");
      if (i === 0 && sellerProfile) maybeAutoGenerate();
    });
  }

  el("video-input")?.addEventListener("change", (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    videoFile = file;
    if (videoPreview) URL.revokeObjectURL(videoPreview);
    videoPreview = URL.createObjectURL(file);
    const wrap = el("video-preview-wrap");
    wrap?.classList.remove("hidden");
    el("video-preview").src = videoPreview;
  });
}

async function maybeAutoGenerate() {
  if (!photoFiles[0] || draft.name) return;
  if (!sellerProfile) {
    setStatus("Finish seller setup first, then add photos.", true);
    return;
  }
  const phone = apiPhone();
  if (!phone) return;

  setStatus("AI reading your first photo…");
  try {
    const compressed = await compressImageFile(photoFiles[0]);
    const imageBase64 = await readFileAsDataUrl(compressed);
    const res = await fetch(`${LISTINGS_API}/generate`, {
      method: "POST",
      headers: sellerAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(
        jsonAuthBody({
          phone,
          imageBase64,
          mimeType: compressed.type || "image/jpeg",
          caption: el("photo-caption")?.value.trim() || "",
        })
      ),
    });
    const parsed = await parseApiResponse(res);
    if (parsed.status === 401) {
      handleSessionExpired(parsed.data);
      return;
    }
    if (!parsed.ok) {
      setStatus(
        parsed.data?.message ||
          parsed.message ||
          "AI skipped — add a caption like `130 ksh women sandals` or fill in manually.",
        true
      );
      return;
    }
    const data = parsed.data;
    draft = { ...draft, ...data.draft };
    sellerInfo = data.seller;
    if (data.studioApplied && data.cleanImageBase64) {
      photoPreviews[0] = data.cleanImageBase64;
      const slot = el("media-slot-0");
      let img = slot?.querySelector("img.preview");
      if (slot && !img) {
        img = document.createElement("img");
        img.className = "preview";
        img.alt = "";
        slot.insertBefore(img, slot.firstChild);
      }
      if (img) img.src = data.cleanImageBase64;
      slot?.classList.add("has-media", "has-studio");
      setStatus("AI cleaned background + filled draft — review each step.");
    } else {
      setStatus(data.message || "AI filled a draft — review each step before posting.");
    }
    fillFormFromDraft();
    if (sellerInfo?.businessName) showSellerProfile(sellerInfo);
  } catch {
    setStatus("Could not reach Sokoni — check your connection and try again.", true);
    checkApiHealth();
  }
}

function fillFormFromDraft() {
  el("draft-name").value = draft.name || "";
  el("draft-description").value = draft.description || "";
  el("draft-tags").value = (draft.tags || []).map((t) => `#${t}`).join(" ");
  el("draft-brand").value = draft.brand || "";
  el("draft-brand2").value = draft.secondaryBrand || "";
  el("draft-price").value = draft.sellerNetKes ?? draft.priceKes ?? draft.sourcePriceKes ?? "";
  populateWeightClassSelect(draft.estimatedWeightClass || "small");
  el("draft-shipping").value =
    draft.freeShipping ? 0 : draft.shippingKes ?? draft.suggestedShippingFeeKsh ?? getShippingTier(draft.estimatedWeightClass)?.typicalKes ?? MIN_SHIPPING_KES;
  if (el("draft-free-shipping")) el("draft-free-shipping").checked = Boolean(draft.freeShipping);
  el("draft-color").value = draft.color || "";
  el("draft-size").value = draft.size || "";
  el("draft-location").value = draft.location || "";
  el("draft-era").value = draft.era || "";
  el("draft-secondhand").checked = Boolean(draft.isSecondhand);

  populateSelect(el("draft-category"), Object.keys(CATEGORY_LABELS), CATEGORY_LABELS, draft.category);
  populateSelect(el("draft-condition"), meta.conditions, CONDITION_LABELS, draft.condition);
  populateBrowseSelects(draft.browseCategory, draft.browseSubCategory);
  updateFeeBreakdown();
}

function populateBrowseSelects(browseCat, browseSub) {
  const catSelect = el("draft-browse-cat");
  const subSelect = el("draft-browse-sub");
  if (!catSelect || !subSelect) return;

  const tax = meta.browseTaxonomy || [];
  catSelect.innerHTML = tax.map((c) => `<option value="${c.id}">${c.label}</option>`).join("");
  if (browseCat) catSelect.value = browseCat;

  const cat = tax.find((c) => c.id === catSelect.value) || tax[0];
  subSelect.innerHTML = (cat?.subcategories || [])
    .map((s) => `<option value="${s.id}">${s.label}</option>`)
    .join("");
  if (browseSub) subSelect.value = browseSub;

  catSelect.onchange = () => {
    const selected = tax.find((c) => c.id === catSelect.value);
    subSelect.innerHTML = (selected?.subcategories || [])
      .map((s) => `<option value="${s.id}">${s.label}</option>`)
      .join("");
  };
}

function collectDraft() {
  const tagsRaw = el("draft-tags")?.value || "";
  const tags = tagsRaw
    .split(/[\s,#]+/)
    .map((t) => t.replace(/^#/, "").trim())
    .filter(Boolean)
    .slice(0, meta.maxTags || 5);

  return {
    ...draft,
    name: el("draft-name").value.trim(),
    description: el("draft-description").value.trim(),
    tags,
    brand: el("draft-brand").value.trim(),
    secondaryBrand: el("draft-brand2").value.trim(),
    sellerNetKes: Math.round(Number(el("draft-price").value) || 0),
    priceKes: Math.round(Number(el("draft-price").value) || 0),
    sourcePriceKes: Math.round(Number(el("draft-price").value) || 0),
    estimatedWeightClass: el("draft-weight-class")?.value || draft.estimatedWeightClass || "small",
    freeShipping: isFreeShipping(),
    shippingKes: isFreeShipping()
      ? 0
      : Math.max(MIN_SHIPPING_KES, Math.round(Number(el("draft-shipping").value) || MIN_SHIPPING_KES)),
    category: el("draft-category").value,
    browseCategory: el("draft-browse-cat")?.value,
    browseSubCategory: el("draft-browse-sub")?.value,
    condition: el("draft-condition").value,
    color: el("draft-color").value.trim(),
    size: el("draft-size").value.trim(),
    era: el("draft-era").value,
    location: el("draft-location").value.trim(),
    isSecondhand: el("draft-secondhand").checked,
  };
}

function fillReview() {
  const d = collectDraft();
  const fees = computeFeeBreakdown(d.sellerNetKes ?? d.priceKes, d.shippingKes);
  el("review-summary").innerHTML = `
    <p class="font-semibold text-lg">${d.name || "—"}</p>
    <p class="text-sm text-brand-purple/70 dark:text-white/70 mt-2">${d.description || "—"}</p>
    <p class="text-sm mt-3">${d.browseCategory || ""} → ${d.browseSubCategory || ""} · ${CONDITION_LABELS[d.condition] || d.condition}</p>
    <p class="text-xs mt-2 text-brand-purple/50">${(d.tags || []).map((t) => `#${t}`).join(" ")}</p>`;
  renderFeeBreakdown(fees, "review-fee");
}

async function collectImagesBase64() {
  const images = [];
  for (const file of photoFiles) {
    if (file) {
      const compressed = await compressImageFile(file);
      images.push(await readFileAsDataUrl(compressed));
    }
  }
  return images;
}

async function onPublish() {
  const phone = apiPhone();
  if (!phone) {
    setStatus("Enter your WhatsApp number.", true);
    return;
  }
  if (!sellerProfile) {
    setStatus("Finish seller setup first.", true);
    return;
  }
  if (!photoFiles[0]) {
    setStatus("Add at least one photo.", true);
    goStep(-(stepIndex));
    return;
  }
  const d = collectDraft();
  if (!d.freeShipping && d.shippingKes < MIN_SHIPPING_KES) {
    setStatus(`Shipping fee is required (minimum KES ${MIN_SHIPPING_KES}), or tick Offer free shipping.`, true);
    goStep(-(stepIndex - STEPS.indexOf("pricing")));
    return;
  }

  savePhone();
  setStatus("Posting listing…");
  el("post-btn").disabled = true;

  try {
    const images = await collectImagesBase64();
    let videoBase64 = null;
    if (videoFile) videoBase64 = await readFileAsDataUrl(videoFile);

    const res = await fetch(`${LISTINGS_API}/publish`, {
      method: "POST",
      headers: sellerAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(jsonAuthBody({ phone, draft: collectDraft(), images, videoBase64 })),
    });
    const parsed = await parseApiResponse(res);
    if (parsed.status === 401) {
      handleSessionExpired(parsed.data);
      return;
    }
    if (!parsed.ok) {
      setStatus(parsed.data?.message || parsed.data?.error || parsed.message || "Post failed.", true);
      return;
    }
    const data = parsed.data;

    el("success-box")?.classList.remove("hidden");
    el("success-ref").textContent = data.productId || "";
    el("success-status").textContent =
      data.status === "hidden_pending_review"
        ? "Posted but hidden pending review — we'll WhatsApp you."
        : "Your listing is live on Sokoni now.";
    el("wizard-root")?.classList.add("hidden");
    localStorage.removeItem(DRAFT_KEY);
    await loadMyListings();
  } catch {
    setStatus("Network error — try again.", true);
  } finally {
    el("post-btn").disabled = false;
  }
}

async function onSaveDraft() {
  const phone = apiPhone();
  if (!phone) {
    setStatus("Enter your WhatsApp number.", true);
    return;
  }
  if (!sellerProfile) {
    setStatus("Finish seller setup first — verify WhatsApp and tap Start selling.", true);
    return;
  }
  const d = collectDraft();
  if (!d.name) {
    setStatus("Add a title before saving — or use the photo caption field with price e.g. `130 ksh sandals`.", true);
    goStep(1);
    return;
  }
  savePhone();
  setStatus("Saving draft…");
  try {
    const images = await collectImagesBase64();
    let videoBase64 = null;
    if (videoFile) videoBase64 = await readFileAsDataUrl(videoFile);
    const res = await fetch(`${LISTINGS_API}/draft`, {
      method: "POST",
      headers: sellerAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(jsonAuthBody({ phone, draft: d, images, videoBase64 })),
    });
    const parsed = await parseApiResponse(res);
    if (parsed.status === 401) {
      handleSessionExpired(parsed.data);
      return;
    }
    if (!parsed.ok) {
      setStatus(parsed.data?.message || parsed.data?.error || parsed.message || "Save failed.", true);
      return;
    }
    setStatus(`Draft saved (${parsed.data.draftId}).`);
    await loadMyListings();
  } catch {
    setStatus("Could not reach Sokoni — check your connection.", true);
    checkApiHealth();
  }
}

async function loadMeta() {
  try {
    const res = await fetch(`${LISTINGS_API}/meta`);
    if (!res.ok) return;
    meta = await res.json();
    populateBrowseSelects();
    populateSelect(el("draft-condition"), meta.conditions || Object.keys(CONDITION_LABELS), CONDITION_LABELS);
    populateSelect(el("draft-category"), Object.keys(CATEGORY_LABELS), CATEGORY_LABELS);
    if (Array.isArray(meta.eras)) {
      el("draft-era").innerHTML =
        `<option value="">—</option>` + meta.eras.map((e) => `<option value="${e}">${e}</option>`).join("");
    }
    populateWeightClassSelect(draft.estimatedWeightClass);
  } catch {
    populateBrowseSelects();
    populateWeightClassSelect();
  }
}

async function loadMyListings() {
  const phone = apiPhone();
  const wrap = el("my-listings");
  if (!phone || !wrap) return;

  wrap.innerHTML = `<p class="text-sm text-brand-purple/50 dark:text-white/50">Loading…</p>`;
  try {
    const res = await fetch(listingsQuery(phone), { headers: sellerAuthHeaders() });
    const data = await res.json();
    if (res.status === 401) {
      handleSessionExpired(data);
      return;
    }
    if (!res.ok) {
      wrap.innerHTML = `<p class="text-sm text-red-600 dark:text-red-400">${data.message || data.error}</p>`;
      return;
    }
    const items = [...(data.listings || []), ...(data.drafts || [])];
    if (!items.length) {
      wrap.innerHTML = `<p class="text-sm text-brand-purple/50 dark:text-white/50">No listings yet — add your first item above.</p>`;
      return;
    }
    wrap.innerHTML = items
      .map((item) => {
        const status = item.status || "draft";
        const badge =
          status === "live"
            ? "bg-brand-green/20 text-brand-purple dark:text-brand-green"
            : status === "hidden"
              ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
              : "bg-brand-purple/10 text-brand-purple dark:bg-white/10 dark:text-white";
        const title = item.draft?.name || item.id;
        const img = item.imageUrl || item.images?.[0];
        const pid = item.productId || item.id;
        const price = item.draft?.buyerTotalKes ?? item.draft?.priceKes ?? item.draft?.sourcePriceKes;
        const shareUrl = `https://sokonimall.com/?q=${encodeURIComponent(pid)}`;
        return `
          <div class="rounded-2xl border border-brand-purple/10 dark:border-white/10 p-4 flex gap-4 items-start" data-product-id="${pid}">
            ${img ? `<img src="../${img}" alt="" class="w-16 h-16 rounded-xl object-cover shrink-0" />` : ""}
            <div class="min-w-0 flex-1">
              <p class="font-semibold truncate">${title}</p>
              <p class="text-xs text-brand-purple/60 dark:text-white/60 mt-1">${pid}${price ? ` · ${formatKes(price)}` : ""}</p>
              <span class="inline-block mt-2 text-xs font-semibold px-2 py-0.5 rounded-full ${badge}">${status}</span>
              ${status === "live" ? `
              <div class="flex flex-wrap gap-2 mt-3">
                <button type="button" class="text-xs font-semibold text-brand-green hover:underline refresh-listing-btn" data-id="${pid}">↻ Refresh listing</button>
                <a href="https://wa.me/?text=${encodeURIComponent(`🛍️ ${title} — ${formatKes(price)}\n${shareUrl}`)}" target="_blank" rel="noopener" class="text-xs font-semibold text-brand-green hover:underline">Share to WhatsApp</a>
              </div>` : ""}
            </div>
          </div>`;
      })
      .join("");

    wrap.querySelectorAll(".refresh-listing-btn").forEach((btn) => {
      btn.addEventListener("click", () => refreshListing(btn.dataset.id));
    });
  } catch {
    wrap.innerHTML = `<p class="text-sm text-red-600 dark:text-red-400">Network error.</p>`;
  }
}

function showSellerProfile(profile) {
  sellerProfile = { ...(profile || {}) };
  const knownUserId = Number(sellerProfile.userId || sellerProfile.socialUserId);
  if (Number.isInteger(knownUserId) && knownUserId > 0) {
    sellerProfile.socialUserId = knownUserId;
  }
  sellerSocialUserIdPromise = null;
  loadHandledAcceptedOffers();
  updateHandledResetButton();
  el("seller-badge").textContent = profile.businessName || profile.shopName || "Your shop";
  if (profile.shopHandle) el("seller-handle").textContent = profile.shopHandle;
  el("seller-profile-bar")?.classList.remove("hidden");
  el("listing-wizard")?.classList.remove("hidden");
  el("onboard-panel")?.classList.add("hidden");
  showSellerView("dashboard");
}

async function tryRestoreSession() {
  const phone = apiPhone();
  if (!phone || !getSessionToken()) return false;
  try {
    const res = await fetch(onboardQuery(phone), { headers: sellerAuthHeaders() });
    const parsed = await parseApiResponse(res);
    if (parsed.status === 401) {
      handleSessionExpired(parsed.data);
      return false;
    }
    if (parsed.ok && parsed.data?.seller) {
      showSellerProfile(parsed.data.seller);
      return true;
    }
    if (parsed.data?.needsSetup || parsed.status === 404) {
      showSignupStep();
      setOnboardStatus("Finish your seller profile to continue.");
      return true;
    }
  } catch {}
  return false;
}

async function checkSellerProfile() {
  const phone = apiPhone();
  if (!phone || !getSessionToken()) return;
  try {
    const res = await fetch(onboardQuery(phone), { headers: sellerAuthHeaders() });
    const parsed = await parseApiResponse(res);
    if (parsed.status === 401) {
      handleSessionExpired(parsed.data);
      return;
    }
    if (!parsed.ok) {
      el("listing-wizard")?.classList.add("hidden");
      el("onboard-panel")?.classList.remove("hidden");
      showSignupStep();
      return;
    }
    if (parsed.data?.seller) {
      showSellerProfile(parsed.data.seller);
    }
  } catch {
    /* stay on onboard */
  }
}

function normalizePhoneInput(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9) d = `254${d}`;
  return d;
}

async function parseApiResponse(res) {
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    const serverDown = res.status === 502 || res.status === 503 || res.status === 504;
    return {
      ok: false,
      status: res.status,
      data: null,
      message: serverDown
        ? "Sokoni server is restarting — wait a minute and try again."
        : "Could not reach Sokoni — check your connection.",
    };
  }
}

async function checkApiHealth() {
  const banner = el("api-down-banner");
  if (!banner) return;
  try {
    const res = await fetch(`${API_BASE}/health`, { method: "GET" });
    if (res.ok) {
      banner.classList.add("hidden");
      return;
    }
  } catch {}
  banner.classList.remove("hidden");
}

function setOnboardStatus(msg, isError = false) {
  const node = el("onboard-status");
  if (!node) return;
  node.textContent = msg || "";
  node.classList.toggle("text-red-600", isError);
  node.classList.toggle("dark:text-red-400", isError);
  node.classList.toggle("text-brand-green", !isError && Boolean(msg));
}

function loadSessionFromStorage() {
  try {
    const raw = sessionStorage.getItem(VERIFY_TOKEN_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed.phone === normalizePhoneInput(getPhone()) && parsed.token && parsed.expiresAt > Date.now()) {
      verificationToken = parsed.token;
      phoneVerified = true;
      return true;
    }
    sessionStorage.removeItem(VERIFY_TOKEN_KEY);
  } catch {}
  return false;
}

function saveVerificationToken(token, expiresInSec = 1800) {
  verificationToken = token;
  phoneVerified = true;
  sessionStorage.setItem(
    VERIFY_TOKEN_KEY,
    JSON.stringify({
      phone: normalizePhoneInput(getPhone()),
      token,
      expiresAt: Date.now() + expiresInSec * 1000,
    })
  );
}

function showSignupStep() {
  el("onboard-verify-step")?.classList.add("hidden");
  el("onboard-details-step")?.classList.remove("hidden");
  el("onboard-btn")?.classList.remove("hidden");
  el("onboard-panel")?.classList.remove("hidden");
  el("listing-wizard")?.classList.add("hidden");
  const phoneInput = el("seller-phone");
  if (phoneInput) phoneInput.readOnly = true;
}

async function routeAfterVerify(phoneNorm, verifyData) {
  if (verifyData?.needsSetup === false && verifyData?.seller) {
    showSellerProfile(verifyData.seller);
    setOnboardStatus("");
    return;
  }
  if (verifyData?.needsSetup === true) {
    showSignupStep();
    setOnboardStatus(verifyData.message || "Set up your seller profile to continue.");
    return;
  }

  try {
    const profileRes = await fetch(onboardQuery(phoneNorm), { headers: sellerAuthHeaders() });
    const profileParsed = await parseApiResponse(profileRes);
    if (profileParsed.ok && profileParsed.data?.seller) {
      showSellerProfile(profileParsed.data.seller);
      setOnboardStatus("");
      return;
    }
    if (profileParsed.data?.needsSetup || profileParsed.status === 404) {
      showSignupStep();
      setOnboardStatus("Set up your seller profile to continue.");
      return;
    }
    setOnboardStatus(profileParsed.data?.message || "Could not load your profile — try again.", true);
  } catch {
    setOnboardStatus("Signed in but could not load your profile — try again.", true);
  }
}

function startResendCooldown(seconds) {
  const btn = el("resend-code-btn");
  const sendBtn = el("send-code-btn");
  let left = seconds;
  const tick = () => {
    if (btn) {
      btn.disabled = left > 0;
      btn.textContent = left > 0 ? `Resend (${left}s)` : "Resend code";
    }
    if (sendBtn) sendBtn.disabled = left > 0;
    if (left <= 0) {
      clearInterval(resendCooldownTimer);
      resendCooldownTimer = null;
      return;
    }
    left -= 1;
  };
  tick();
  clearInterval(resendCooldownTimer);
  resendCooldownTimer = setInterval(tick, 1000);
}

async function onSendCode() {
  const phone = getPhone();
  if (!phone) {
    setOnboardStatus("Enter your WhatsApp number first.", true);
    return;
  }
  savePhone();
  setOnboardStatus("Sending code on WhatsApp…");
  el("send-code-btn").disabled = true;

  try {
    const res = await fetch(`${ONBOARD_API}/send-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: normalizePhoneInput(phone) }),
    });
    const parsed = await parseApiResponse(res);
    if (!parsed.ok) {
      setOnboardStatus(parsed.data?.message || parsed.message || "Could not send code.", true);
      if (parsed.data?.retryAfterSec) startResendCooldown(parsed.data.retryAfterSec);
      else el("send-code-btn").disabled = false;
      return;
    }
    el("verify-code-wrap")?.classList.remove("hidden");
    el("verify-code-input")?.focus();
    setOnboardStatus(parsed.data.message || "Check WhatsApp for your code from Sokoni Mall.");
    startResendCooldown(60);
  } catch {
    setOnboardStatus("Could not reach Sokoni — check your connection.", true);
    el("send-code-btn").disabled = false;
    checkApiHealth();
  }
}

async function onVerifyCode() {
  const phone = getPhone();
  const code = el("verify-code-input")?.value.trim();
  if (!phone) {
    setOnboardStatus("Enter your WhatsApp number.", true);
    return;
  }
  if (!code || code.replace(/\D/g, "").length !== 6) {
    setOnboardStatus("Enter the 6-digit code from WhatsApp.", true);
    return;
  }

  setOnboardStatus("Checking code…");
  el("verify-code-btn").disabled = true;

  try {
    const res = await fetch(`${ONBOARD_API}/verify-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: normalizePhoneInput(phone), code }),
    });
    const parsed = await parseApiResponse(res);
    if (!parsed.ok) {
      setOnboardStatus(parsed.data?.message || parsed.message || "Wrong code.", true);
      return;
    }
    saveVerificationToken(parsed.data.sessionToken || parsed.data.verificationToken, parsed.data.expiresInSec);
    await routeAfterVerify(normalizePhoneInput(phone), parsed.data);
  } catch {
    setOnboardStatus("Could not reach Sokoni — try again.", true);
  } finally {
    el("verify-code-btn").disabled = false;
  }
}

async function onOnboard() {
  const phone = getPhone();
  const shopName = el("onboard-shop-name")?.value.trim();
  let shopHandle = el("onboard-shop-handle")?.value.trim().replace(/^@/, "");
  const mpesaNumber = el("onboard-mpesa")?.value.trim();
  const nationalId = el("onboard-national-id")?.value.trim();

  if (!phone) {
    setOnboardStatus("Enter your WhatsApp number.", true);
    return;
  }
  if (!shopName) {
    setOnboardStatus("Enter your name or shop name.", true);
    return;
  }
  if (!mpesaNumber) {
    setOnboardStatus("Enter your M-Pesa payout number.", true);
    return;
  }
  if (!phoneVerified || !verificationToken) {
    setOnboardStatus("Verify your WhatsApp number first — tap Send code.", true);
    return;
  }

  savePhone();
  setOnboardStatus("Setting up your profile…");
  el("onboard-btn").disabled = true;

  try {
    const res = await fetch(ONBOARD_API, {
      method: "POST",
      headers: sellerAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(
        jsonAuthBody({
          phone: normalizePhoneInput(phone),
          shopName,
          shopHandle: shopHandle || undefined,
          mpesaNumber: normalizePhoneInput(mpesaNumber),
          nationalId,
        })
      ),
    });
    const parsed = await parseApiResponse(res);
    if (parsed.status === 401) {
      handleSessionExpired(parsed.data);
      return;
    }
    if (!parsed.ok) {
      setOnboardStatus(parsed.data?.message || parsed.message || parsed.data?.error || "Setup failed.", true);
      if (parsed.data?.error === "session_expired" || parsed.data?.error === "session_invalid") {
        handleSessionExpired(parsed.data);
        return;
      }
      if (parsed.data?.error === "not_verified" || parsed.data?.error === "verification_expired") {
        clearSession();
        showVerifyPanel();
        el("onboard-details-step")?.classList.add("hidden");
        el("onboard-btn")?.classList.add("hidden");
      }
      if (parsed.status === 502 || parsed.status === 503) checkApiHealth();
      return;
    }
    setOnboardStatus(parsed.data.message || "You're set up — your dashboard is ready.");
    showSellerProfile(parsed.data.seller);
    el("api-down-banner")?.classList.add("hidden");
  } catch {
    setOnboardStatus("Could not reach Sokoni — check your connection and try again.", true);
    checkApiHealth();
  } finally {
    el("onboard-btn").disabled = false;
  }
}

async function refreshListing(productId) {
  const phone = apiPhone();
  if (!phone || !productId) return;
  setStatus("Refreshing listing…");
  try {
    const res = await fetch(`${ONBOARD_API}/refresh`, {
      method: "POST",
      headers: sellerAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(jsonAuthBody({ phone, productId })),
    });
    const data = await res.json();
    if (res.status === 401) {
      handleSessionExpired(data);
      return;
    }
    if (!res.ok) {
      setStatus(data.message || data.error || "Refresh failed.", true);
      return;
    }
    setStatus(data.message || "Listing refreshed.");
    await loadMyListings();
  } catch {
    setStatus("Network error.", true);
  }
}

function renderLedgerDetail() {
  const node = el("ledger-detail");
  if (!node || !ledgerData) return;

  const tab = activeLedgerTab;
  const section =
    tab === "available"
      ? ledgerData.available
      : tab === "pending"
        ? ledgerData.pendingEscrow
        : ledgerData.inTransit;

  const items = section?.items || [];
  if (!items.length) {
    node.innerHTML = `<p class="text-brand-purple/50 dark:text-white/50">Nothing here yet.</p>`;
    return;
  }

  node.innerHTML = items
    .map((item) => {
      const statusLine = item.shipmentStatusLabel ? `<span class="text-xs text-brand-purple/50">${item.shipmentStatusLabel}</span>` : "";
      const trackLink = item.trackUrl
        ? `<a href="${item.trackUrl}" class="text-xs font-semibold text-brand-green hover:underline shrink-0">Track</a>`
        : "";
      return `<div class="flex flex-wrap justify-between gap-2 py-2 border-b border-brand-purple/5 dark:border-white/5">
          <div class="min-w-0">
            <span class="block truncate">${item.productName || item.orderId}</span>
            ${item.orderId ? `<span class="text-xs text-brand-purple/50">${item.orderId}</span>` : ""}
            ${statusLine}
          </div>
          <div class="text-right shrink-0">
            <span class="font-semibold block">${formatKes(item.amountKes)}</span>
            ${trackLink}
          </div>
        </div>`;
    })
    .join("");
}

function shipmentBadgeClass(status) {
  if (status === "label_ready" || status === "pending") return "sell-order-badge--action";
  if (status === "delivered") return "sell-order-badge--done";
  return "sell-order-badge--transit";
}

function renderSellerOrders(orders) {
  const wrap = el("seller-orders");
  if (!wrap) return;

  const active = (orders || []).filter((o) => o.paid && o.shipmentStatus !== "delivered");
  if (!active.length) {
    wrap.innerHTML = `<p class="text-sm text-brand-purple/50 dark:text-white/50">No active orders — when someone buys, it shows here with your drop-off label.</p>`;
    return;
  }

  wrap.innerHTML = active
    .map((o) => {
      const actions = [];
      if (o.needsDropOff && o.labelUrl) {
        actions.push(
          `<a href="${o.labelUrl}" target="_blank" rel="noopener" class="sell-order-action sell-order-action--primary">Print label</a>`
        );
      }
      if (o.trackUrl) {
        actions.push(`<a href="${o.trackUrl}" class="sell-order-action">Track shipment</a>`);
      }
      return `
        <div class="sell-order-card">
          <div class="sell-order-card-head">
            <p class="font-semibold">${o.productName || "Order"}</p>
            <span class="sell-order-badge ${shipmentBadgeClass(o.shipmentStatus)}">${o.shipmentStatusLabel}</span>
          </div>
          <p class="text-xs text-brand-purple/50 mt-1">${o.orderId} · You receive ${formatKes(o.sellerNetKes)}</p>
          <div class="sell-order-actions">${actions.join("")}</div>
        </div>`;
    })
    .join("");
}

function normalizeHandleForLookup(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function setOffersStatus(message, isError = false) {
  const node = el("seller-offers-status");
  if (!node) return;
  node.textContent = message || "";
  node.classList.toggle("text-red-600", isError);
  node.classList.toggle("dark:text-red-400", isError);
  node.classList.toggle("text-brand-green", !isError && Boolean(message));
}

function setDashboardOfferBadge(pendingCount = 0) {
  const badge = el("tab-dashboard-offers-badge");
  if (!badge) return;
  const count = Math.max(0, Number(pendingCount) || 0);
  if (!count) {
    badge.textContent = "";
    badge.classList.add("hidden");
    badge.removeAttribute("aria-label");
    return;
  }
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.classList.remove("hidden");
  badge.setAttribute("aria-label", `${count} pending offer${count === 1 ? "" : "s"}`);
}

function normalizeOfferFilter(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return SELLER_OFFER_FILTERS.has(normalized) ? normalized : "pending";
}

function syncOfferFilterButtons() {
  const buttons = document.querySelectorAll("[data-offer-filter]");
  buttons.forEach((button) => {
    const filter = normalizeOfferFilter(button.dataset.offerFilter);
    const active = filter === activeSellerOffersFilter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function filteredOffers(offers = [], filter = activeSellerOffersFilter) {
  const normalized = normalizeOfferFilter(filter);
  if (normalized === "all") return offers;
  return offers.filter((offer) => {
    return (
      String(offer?.status || "")
        .trim()
        .toLowerCase() === normalized
    );
  });
}

function handledOffersStorageKeyForCurrentSeller() {
  const sellerPhone = normalizePhoneInput(sellerProfile?.phone || apiPhone() || "");
  return sellerPhone ? `${HANDLED_ACCEPTED_OFFERS_KEY}:${sellerPhone}` : `${HANDLED_ACCEPTED_OFFERS_KEY}:default`;
}

function loadHandledAcceptedOffers() {
  handledOffersStorageKey = handledOffersStorageKeyForCurrentSeller();
  handledAcceptedOfferIds = new Set();
  try {
    const raw = sessionStorage.getItem(handledOffersStorageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    parsed.forEach((value) => {
      const id = Number(value);
      if (Number.isInteger(id) && id > 0) handledAcceptedOfferIds.add(id);
    });
  } catch {}
}

function saveHandledAcceptedOffers() {
  if (!handledOffersStorageKey) {
    handledOffersStorageKey = handledOffersStorageKeyForCurrentSeller();
  }
  if (!handledOffersStorageKey) return;
  try {
    if (!handledAcceptedOfferIds.size) {
      sessionStorage.removeItem(handledOffersStorageKey);
      return;
    }
    const ordered = Array.from(handledAcceptedOfferIds.values()).sort((a, b) => a - b);
    sessionStorage.setItem(handledOffersStorageKey, JSON.stringify(ordered));
  } catch {}
}

function clearHandledAcceptedOffersStorage() {
  try {
    if (handledOffersStorageKey) sessionStorage.removeItem(handledOffersStorageKey);
  } catch {}
  handledAcceptedOfferIds = new Set();
  handledOffersStorageKey = null;
}

function updateHandledResetButton() {
  const button = el("offers-reset-handled-btn");
  if (!button) return;
  const hasHandled = handledAcceptedOfferIds.size > 0;
  button.classList.toggle("hidden", !hasHandled);
  button.disabled = !hasHandled;
}

function isAcceptedOfferHandled(offerOrId) {
  const id = Number(typeof offerOrId === "object" ? offerOrId?.id : offerOrId);
  return Number.isInteger(id) && id > 0 ? handledAcceptedOfferIds.has(id) : false;
}

function setAcceptedOfferHandled(offerId, handled = true) {
  const id = Number(offerId);
  if (!Number.isInteger(id) || id < 1) return false;
  if (handled) handledAcceptedOfferIds.add(id);
  else handledAcceptedOfferIds.delete(id);
  saveHandledAcceptedOffers();
  return true;
}

function reconcileHandledAcceptedOffers(offers = sellerOffersCache) {
  const eligibleIds = new Set(
    acceptedOffersEligibleForChat(offers)
      .map((offer) => Number(offer?.id))
      .filter((id) => Number.isInteger(id) && id > 0)
  );
  let changed = false;
  Array.from(handledAcceptedOfferIds.values()).forEach((id) => {
    if (!eligibleIds.has(id)) {
      handledAcceptedOfferIds.delete(id);
      changed = true;
    }
  });
  if (changed) saveHandledAcceptedOffers();
}

function acceptedOffersEligibleForChat(offers = sellerOffersCache) {
  const sellerUserId = currentSellerSocialUserId();
  if (!sellerUserId) return [];
  return (offers || []).filter((offer) => {
    const status = String(offer?.status || "")
      .trim()
      .toLowerCase();
    const buyerUserId = offerBuyerUserId(offer);
    return (
      status === "accepted" &&
      Number.isInteger(buyerUserId) &&
      buyerUserId > 0 &&
      buyerUserId !== sellerUserId
    );
  });
}

function acceptedOffersReadyForChat(offers = sellerOffersCache) {
  return acceptedOffersEligibleForChat(offers).filter((offer) => !isAcceptedOfferHandled(offer));
}

function updateQuickModeHint() {
  const hint = el("seller-offers-quick-hint");
  const button = el("offers-quick-chat-btn");
  if (!hint || !button) return;
  updateHandledResetButton();

  const chatEligible = acceptedOffersEligibleForChat();
  const ready = acceptedOffersReadyForChat();
  const acceptedTotal = filteredOffers(sellerOffersCache, "accepted").length;
  const handledCount = Math.max(0, chatEligible.length - ready.length);
  if (!ready.length) {
    hint.textContent = chatEligible.length
      ? "All chat-ready accepted offers are marked handled for now. Reset handled to queue them again."
      : acceptedTotal
        ? "Accepted offers are in, but buyer chat links are not ready yet."
        : "No accepted offers ready for chat yet.";
    button.disabled = true;
    return;
  }

  const index = acceptedQuickCursor % ready.length;
  const nextOffer = ready[index];
  hint.textContent = `${offerCountLabel(ready.length, "accepted chat")} ready${
    handledCount ? ` (${offerCountLabel(handledCount, "handled offer")} hidden)` : ""
  }. Next: ${offerBuyerLabel(nextOffer)}.`;
  button.disabled = false;
}

function offerFilterLabel(filter = activeSellerOffersFilter) {
  if (filter === "accepted") return "accepted offer";
  if (filter === "declined") return "declined offer";
  if (filter === "pending") return "pending offer";
  return "offer";
}

function offerCountLabel(count, noun) {
  const safe = Math.max(0, Number(count) || 0);
  return `${safe.toLocaleString()} ${noun}${safe === 1 ? "" : "s"}`;
}

function offerStatusLabel(status) {
  if (status === "pending") return "Pending";
  if (status === "accepted") return "Accepted";
  if (status === "declined") return "Declined";
  if (status === "expired") return "Expired";
  return "Offer";
}

function offerStatusBadgeClass(status) {
  if (status === "pending") return "sell-order-badge--action";
  if (status === "accepted") return "sell-order-badge--done";
  return "sell-order-badge--transit";
}

function formatOfferExpiry(expiresAt, status) {
  if (!expiresAt) {
    return status === "pending" ? "Waiting for your decision." : "No expiry timestamp.";
  }
  const time = new Date(expiresAt);
  if (Number.isNaN(time.getTime())) {
    return status === "pending" ? "Waiting for your decision." : "No expiry timestamp.";
  }
  const formatted = new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(time);
  return status === "pending" ? `Valid until ${formatted}` : `Updated ${formatted}`;
}

function offerBuyerLabel(offer) {
  const rawHandle = String(offer?.buyer?.handle || "").trim();
  if (rawHandle) return rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`;
  if (offer?.buyer?.shopName) return offer.buyer.shopName;
  const buyerId = Number(offer?.buyerUserId || offer?.buyer?.id);
  return Number.isInteger(buyerId) && buyerId > 0 ? `Buyer #${buyerId}` : "Buyer";
}

function pendingOffersCount(offers = []) {
  return (offers || []).filter((offer) => {
    return (
      String(offer?.status || "")
        .trim()
        .toLowerCase() === "pending"
    );
  }).length;
}

function offerBuyerUserId(offer) {
  const buyerId = Number(offer?.buyerUserId ?? offer?.buyer?.id);
  return Number.isInteger(buyerId) && buyerId > 0 ? buyerId : null;
}

function currentSellerSocialUserId() {
  const sellerId = Number(sellerProfile?.socialUserId ?? sellerProfile?.userId);
  return Number.isInteger(sellerId) && sellerId > 0 ? sellerId : null;
}

function inboxLinkForOffer(offer, sellerUserId, buyerUserId) {
  if (!sellerUserId || !buyerUserId || sellerUserId === buyerUserId) {
    return "../inbox.html";
  }
  const params = new URLSearchParams({
    viewer: String(sellerUserId),
    with: String(buyerUserId),
  });
  const buyerHandle = normalizeHandleForLookup(offer?.buyer?.handle || "");
  if (buyerHandle) params.set("handle", buyerHandle);
  return `../inbox.html?${params.toString()}`;
}

async function resolveSellerSocialUserId(force = false) {
  if (!sellerProfile) return null;

  const direct = Number(sellerProfile.userId || sellerProfile.socialUserId);
  if (!force && Number.isInteger(direct) && direct > 0) {
    return direct;
  }

  const handle = normalizeHandleForLookup(sellerProfile.shopHandle);
  if (!handle) return null;
  if (!force && sellerSocialUserIdPromise) return sellerSocialUserIdPromise;

  sellerSocialUserIdPromise = (async () => {
    try {
      const res = await fetch(`${SOCIAL_API}/shop/${encodeURIComponent(handle)}?limit=1`);
      const parsed = await parseApiResponse(res);
      if (!parsed.ok) return null;
      const userId = Number(parsed.data?.shop?.userId);
      if (!Number.isInteger(userId) || userId < 1) return null;
      sellerProfile.socialUserId = userId;
      return userId;
    } catch {
      return null;
    } finally {
      sellerSocialUserIdPromise = null;
    }
  })();

  return sellerSocialUserIdPromise;
}

function renderSellerOffers(offers = [], emptyMessage = "No buyer offers yet. New offers will appear here.") {
  const wrap = el("seller-offers");
  if (!wrap) return;

  if (!offers.length) {
    wrap.innerHTML = `<p class="text-sm text-brand-purple/50 dark:text-white/50">${escapeHtml(emptyMessage)}</p>`;
    return;
  }

  wrap.innerHTML = offers
    .map((offer) => {
      const id = Number(offer?.id);
      const status = String(offer?.status || "pending")
        .trim()
        .toLowerCase();
      const productTitle = offer?.product?.title || offer?.productId || "Listing";
      const amount = formatKes(offer?.amountKsh || 0);
      const listed = Number(offer?.product?.priceKsh ?? offer?.product?.priceKes);
      const listedLine = Number.isFinite(listed) && listed > 0 ? ` · Listed ${formatKes(listed)}` : "";
      const canRespond = Number.isInteger(id) && id > 0 && status === "pending";
      const sellerUserId = currentSellerSocialUserId();
      const buyerUserId = offerBuyerUserId(offer);
      const canChat =
        Number.isInteger(sellerUserId) &&
        sellerUserId > 0 &&
        Number.isInteger(buyerUserId) &&
        buyerUserId > 0 &&
        sellerUserId !== buyerUserId;
      const canManageQuickQueue = Number.isInteger(id) && id > 0 && status === "accepted" && canChat;
      const handledInQuickQueue = canManageQuickQueue && isAcceptedOfferHandled(id);
      const actionBlock = canRespond
        ? `<div class="sell-offer-actions">
            <button type="button" class="sell-offer-action sell-offer-action--accept offer-action-btn" data-offer-id="${id}" data-action="accepted">
              Accept
            </button>
            <button type="button" class="sell-offer-action sell-offer-action--decline offer-action-btn" data-offer-id="${id}" data-action="declined">
              Decline
            </button>
          </div>`
        : status === "accepted" && canChat
          ? `<div class="sell-offer-actions">
              <a href="${inboxLinkForOffer(offer, sellerUserId, buyerUserId)}" class="sell-offer-action sell-offer-action--chat">
                Open chat
              </a>
              <button type="button" class="sell-offer-action sell-offer-action--remind offer-reminder-btn" data-offer-id="${id}">
                Send reminder
              </button>
              <button
                type="button"
                class="sell-offer-action sell-offer-action--handled offer-handled-btn"
                data-offer-id="${id}"
                data-handled="${handledInQuickQueue ? "1" : "0"}"
              >
                ${handledInQuickQueue ? "Mark active" : "Mark handled"}
              </button>
            </div>`
          : "";
      const handledNote = handledInQuickQueue
        ? `<p class="text-xs text-brand-green mt-2">Handled in quick mode queue.</p>`
        : "";
      return `
        <article class="sell-offer-card sell-order-card" data-offer-row="${Number.isInteger(id) ? id : ""}">
          <div class="sell-order-card-head">
            <p class="font-semibold">${escapeHtml(productTitle)}</p>
            <span class="sell-order-badge ${offerStatusBadgeClass(status)}">${escapeHtml(offerStatusLabel(status))}</span>
          </div>
          <p class="text-xs text-brand-purple/50 dark:text-white/55 mt-1">${escapeHtml(offerBuyerLabel(offer))}</p>
          <p class="text-sm mt-2"><strong>Offered:</strong> ${escapeHtml(amount)}${escapeHtml(listedLine)}</p>
          <p class="text-xs text-brand-purple/50 dark:text-white/55 mt-1">${escapeHtml(
            formatOfferExpiry(offer?.expiresAt, status)
          )}</p>
          ${handledNote}
          ${actionBlock}
        </article>`;
    })
    .join("");
}

function emptyOfferMessage(totalOffers, filter = activeSellerOffersFilter) {
  if (!totalOffers) {
    return "No buyer offers yet. New offers will appear here.";
  }
  if (filter === "pending") return "No pending offers right now.";
  if (filter === "accepted") return "No accepted offers yet.";
  if (filter === "declined") return "No declined offers yet.";
  return "No offers in this view right now.";
}

function renderOfferCacheView() {
  const total = sellerOffersCache.length;
  const pending = pendingOffersCount(sellerOffersCache);
  const visible = filteredOffers(sellerOffersCache, activeSellerOffersFilter);
  renderSellerOffers(visible, emptyOfferMessage(total, activeSellerOffersFilter));
  bindOfferActionButtons();
  updateQuickModeHint();

  if (!total) {
    setOffersStatus("No buyer offers yet.");
    return;
  }
  if (activeSellerOffersFilter === "all") {
    setOffersStatus(`${offerCountLabel(total, "offer")} in inbox · ${offerCountLabel(pending, "pending offer")}.`);
    return;
  }
  const label = offerFilterLabel(activeSellerOffersFilter);
  setOffersStatus(
    `${offerCountLabel(visible.length, label)} · ${offerCountLabel(pending, "pending offer")} · ${offerCountLabel(
      total,
      "total offer"
    )}.`
  );
}

function setActiveOfferFilter(filter) {
  activeSellerOffersFilter = normalizeOfferFilter(filter);
  syncOfferFilterButtons();
  renderOfferCacheView();
}

async function respondToSellerOffer(button) {
  const offerId = Number(button?.dataset?.offerId);
  const action = String(button?.dataset?.action || "")
    .trim()
    .toLowerCase();
  if (!Number.isInteger(offerId) || offerId < 1) return;
  if (!["accepted", "declined"].includes(action)) return;

  const sellerUserId = await resolveSellerSocialUserId();
  if (!sellerUserId) {
    setOffersStatus("Link your shop handle to your social profile before responding to offers.", true);
    return;
  }

  const row = button.closest("[data-offer-row]");
  row?.querySelectorAll(".offer-action-btn").forEach((node) => {
    node.disabled = true;
  });
  setOffersStatus(action === "accepted" ? "Accepting offer..." : "Declining offer...");

  try {
    const res = await fetch(`${SOCIAL_API}/offers/${offerId}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sellerUserId, action }),
    });
    const parsed = await parseApiResponse(res);
    if (!parsed.ok) {
      setOffersStatus(parsed.data?.message || parsed.message || "Could not update offer right now.", true);
      row?.querySelectorAll(".offer-action-btn").forEach((node) => {
        node.disabled = false;
      });
      return;
    }
    setOffersStatus(action === "accepted" ? "Offer accepted." : "Offer declined.");
    await loadSellerOffers();
  } catch {
    setOffersStatus("Network error while updating offer.", true);
    row?.querySelectorAll(".offer-action-btn").forEach((node) => {
      node.disabled = false;
    });
  }
}

function offerByIdFromCache(offerId) {
  const id = Number(offerId);
  if (!Number.isInteger(id) || id < 1) return null;
  return sellerOffersCache.find((offer) => Number(offer?.id) === id) || null;
}

function reminderMessageForOffer(offer) {
  const productTitle = offer?.product?.title || "your item";
  const amount = formatKes(offer?.amountKsh || 0);
  return `Hi! I accepted your offer of ${amount} for "${productTitle}". Please complete checkout on Sokoni within 24 hours so I can prepare shipping.`;
}

async function sendAcceptedOfferReminder(button) {
  const offerId = Number(button?.dataset?.offerId);
  if (!Number.isInteger(offerId) || offerId < 1) return;
  const offer = offerByIdFromCache(offerId);
  if (!offer) {
    setOffersStatus("Offer not found. Refresh and try again.", true);
    return;
  }

  const sellerUserId = currentSellerSocialUserId();
  const buyerUserId = offerBuyerUserId(offer);
  if (!sellerUserId || !buyerUserId || sellerUserId === buyerUserId) {
    setOffersStatus("Could not resolve buyer chat profile for this offer.", true);
    return;
  }

  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Sending...";
  setOffersStatus("Sending reminder...");
  try {
    const res = await fetch(`${SOCIAL_API}/chat/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderUserId: sellerUserId,
        receiverUserId: buyerUserId,
        content: reminderMessageForOffer(offer),
      }),
    });
    const parsed = await parseApiResponse(res);
    if (!parsed.ok) {
      setOffersStatus(parsed.data?.message || parsed.message || "Could not send reminder right now.", true);
      button.disabled = false;
      button.textContent = previousLabel;
      return;
    }
    button.textContent = "Reminder sent";
    setOffersStatus("Reminder sent in inbox.");
    window.setTimeout(() => {
      button.disabled = false;
      button.textContent = previousLabel;
    }, 4000);
  } catch {
    setOffersStatus("Network error while sending reminder.", true);
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

function toggleAcceptedOfferHandled(button) {
  const offerId = Number(button?.dataset?.offerId);
  if (!Number.isInteger(offerId) || offerId < 1) return;
  const currentlyHandled = button.dataset.handled === "1" || isAcceptedOfferHandled(offerId);
  if (!setAcceptedOfferHandled(offerId, !currentlyHandled)) return;
  acceptedQuickCursor = 0;
  renderOfferCacheView();
  setOffersStatus(currentlyHandled ? "Offer moved back into quick queue." : "Offer marked handled in quick queue.");
}

function resetHandledAcceptedOffersQueue() {
  if (!handledAcceptedOfferIds.size) return;
  handledAcceptedOfferIds = new Set();
  saveHandledAcceptedOffers();
  acceptedQuickCursor = 0;
  renderOfferCacheView();
  setOffersStatus("Quick queue reset — all accepted chats are active again.");
}

function bindOfferActionButtons() {
  const wrap = el("seller-offers");
  if (!wrap) return;
  wrap.querySelectorAll(".offer-action-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      respondToSellerOffer(btn);
    });
  });
  wrap.querySelectorAll(".offer-reminder-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      sendAcceptedOfferReminder(btn);
    });
  });
  wrap.querySelectorAll(".offer-handled-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      toggleAcceptedOfferHandled(btn);
    });
  });
}

function bindOfferFilterButtons() {
  document.querySelectorAll("[data-offer-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      setActiveOfferFilter(button.dataset.offerFilter);
    });
  });
  syncOfferFilterButtons();
}

function openNextAcceptedOfferChat() {
  const sellerUserId = currentSellerSocialUserId();
  if (!sellerUserId) {
    setOffersStatus("Link your shop handle to your social profile to start accepted-offer chats.", true);
    return;
  }

  setActiveOfferFilter("accepted");
  const ready = acceptedOffersReadyForChat();
  if (!ready.length) {
    acceptedQuickCursor = 0;
    updateQuickModeHint();
    setOffersStatus("No accepted offers ready for chat right now.");
    return;
  }

  const index = acceptedQuickCursor % ready.length;
  const offer = ready[index];
  acceptedQuickCursor = (index + 1) % ready.length;
  updateQuickModeHint();

  const buyerUserId = offerBuyerUserId(offer);
  const url = inboxLinkForOffer(offer, sellerUserId, buyerUserId);
  setOffersStatus(`Opening chat with ${offerBuyerLabel(offer)}...`);

  const popup = window.open(url, "_blank", "noopener");
  if (!popup) {
    window.location.href = url;
  }
}

function stopSellerOffersPolling() {
  if (sellerOffersPollTimer) {
    window.clearInterval(sellerOffersPollTimer);
    sellerOffersPollTimer = null;
  }
}

function startSellerOffersPolling() {
  stopSellerOffersPolling();
  if (!sellerProfile) return;
  sellerOffersPollTimer = window.setInterval(() => {
    if (currentSellerView !== "dashboard") return;
    void loadSellerOffers({ silent: true });
  }, SELLER_OFFERS_POLL_MS);
}

async function loadSellerOffers({ silent = false } = {}) {
  const wrap = el("seller-offers");
  if (!wrap) return;
  if (sellerOffersRequestInFlight && silent) return;

  sellerOffersRequestInFlight = true;
  if (!silent) {
    setOffersStatus("Loading offers...");
    wrap.innerHTML = `<p class="text-sm text-brand-purple/50 dark:text-white/50">Loading buyer offers…</p>`;
  }

  try {
    const sellerUserId = await resolveSellerSocialUserId();
    if (!sellerUserId) {
      setDashboardOfferBadge(0);
      sellerOffersCache = [];
      acceptedQuickCursor = 0;
      renderSellerOffers([], "Offers inbox appears after your shop handle links to your social profile.");
      updateQuickModeHint();
      setOffersStatus("No linked social profile yet.");
      return;
    }

    const params = new URLSearchParams({
      userId: String(sellerUserId),
      role: "seller",
      status: "all",
      limit: "30",
    });
    const res = await fetch(`${SOCIAL_API}/offers?${params}`);
    const parsed = await parseApiResponse(res);
    if (!parsed.ok) {
      if (!silent) {
        wrap.innerHTML = `<p class="text-sm text-red-600 dark:text-red-400">Could not load offers right now.</p>`;
        setOffersStatus(parsed.data?.message || parsed.message || "Could not load offers.", true);
      }
      return;
    }

    const offers = Array.isArray(parsed.data?.offers) ? parsed.data.offers : [];
    const pending = pendingOffersCount(offers);
    sellerOffersCache = offers;
    reconcileHandledAcceptedOffers(sellerOffersCache);
    const readyChats = acceptedOffersReadyForChat(sellerOffersCache);
    if (!readyChats.length || acceptedQuickCursor >= readyChats.length) {
      acceptedQuickCursor = 0;
    }
    setDashboardOfferBadge(pending);
    renderOfferCacheView();
  } catch {
    if (!silent) {
      wrap.innerHTML = `<p class="text-sm text-red-600 dark:text-red-400">Network error while loading offers.</p>`;
      setOffersStatus("Network error while loading offers.", true);
    }
  } finally {
    sellerOffersRequestInFlight = false;
  }
}

async function loadSellerOrders() {
  const phone = apiPhone();
  if (!phone) return;

  try {
    const res = await fetch(`${ONBOARD_API}/orders?phone=${encodeURIComponent(phone)}&sessionToken=${encodeURIComponent(getSessionToken() || "")}`, {
      headers: sellerAuthHeaders(),
    });
    if (res.status === 401) {
      handleSessionExpired(await res.json().catch(() => ({})));
      return;
    }
    if (!res.ok) return;
    const data = await res.json();
    renderSellerOrders(data.orders || []);
  } catch {}
}

function renderWithdrawPanel(data) {
  el("withdraw-available").textContent = formatKes(data.availableKes || 0);
  el("withdraw-mpesa").textContent = data.maskedMpesa || data.mpesaNumber || "—";

  const pendingEl = el("withdraw-pending");
  const reqBtn = el("withdraw-request-btn");
  if (data.pendingRequest) {
    pendingEl.classList.remove("hidden");
    pendingEl.textContent = `Processing ${data.pendingRequest.id} — ${formatKes(data.pendingRequest.amountKes)} requested ${new Date(data.pendingRequest.requestedAt).toLocaleString()}.`;
    reqBtn.disabled = true;
    reqBtn.textContent = "Withdrawal pending";
  } else {
    pendingEl.classList.add("hidden");
    reqBtn.disabled = !(data.availableKes > 0);
    reqBtn.textContent = "Request withdrawal";
  }

  const breakdown = el("withdraw-breakdown");
  const items = data.breakdown || [];
  breakdown.innerHTML = items.length
    ? items
        .map(
          (item) =>
            `<div class="flex justify-between gap-2 py-2 border-b border-brand-purple/5 dark:border-white/5">
              <span class="truncate">${item.productName || item.orderId}</span>
              <span class="font-semibold shrink-0">${formatKes(item.amountKes)}</span>
            </div>`
        )
        .join("")
    : `<p class="text-brand-purple/50 dark:text-white/50">No delivered orders ready for payout yet.</p>`;

  const historyEl = el("withdraw-history");
  const history = data.history || [];
  historyEl.innerHTML = history.length
    ? history
        .map(
          (h) =>
            `<div class="flex justify-between gap-2 py-2 border-b border-brand-purple/5 dark:border-white/5">
              <span>${h.id} · ${h.status}</span>
              <span class="font-semibold">${formatKes(h.amountKes)}</span>
            </div>`
        )
        .join("")
    : `<p class="text-brand-purple/50 dark:text-white/50">No withdrawals yet.</p>`;
}

async function loadWithdrawPanel() {
  const phone = apiPhone();
  if (!phone) return;

  try {
    const res = await fetch(`${ONBOARD_API}/withdraw?phone=${encodeURIComponent(phone)}&sessionToken=${encodeURIComponent(getSessionToken() || "")}`, {
      headers: sellerAuthHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      handleSessionExpired(data);
      return;
    }
    if (!res.ok) return;
    renderWithdrawPanel(data);
  } catch {}
}

async function requestWithdrawal() {
  const phone = apiPhone();
  if (!phone) return;

  const statusEl = el("withdraw-status");
  const btn = el("withdraw-request-btn");
  btn.disabled = true;
  statusEl.textContent = "Submitting withdrawal request…";
  statusEl.classList.remove("text-red-600", "dark:text-red-400");

  try {
    const res = await fetch(`${ONBOARD_API}/withdraw`, {
      method: "POST",
      headers: sellerAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(jsonAuthBody({ phone })),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      handleSessionExpired(data);
      return;
    }
    if (!res.ok) {
      statusEl.textContent = data.message || data.error || "Could not request withdrawal.";
      statusEl.classList.add("text-red-600", "dark:text-red-400");
      await loadWithdrawPanel();
      return;
    }
    statusEl.textContent = data.message || "Withdrawal requested.";
    statusEl.classList.add("text-brand-green");
    await loadWithdrawPanel();
    await loadEscrowLedger();
  } catch {
    statusEl.textContent = "Network error — try again.";
    statusEl.classList.add("text-red-600", "dark:text-red-400");
  } finally {
    btn.disabled = false;
  }
}

function showSellerView(view) {
  currentSellerView = view;
  const dashboard = el("view-dashboard");
  const withdraw = el("view-withdraw");
  const listing = el("view-listing");
  const tabDash = el("tab-dashboard");
  const tabWithdraw = el("tab-withdraw");
  const tabList = el("tab-listing");

  dashboard?.classList.toggle("hidden", view !== "dashboard");
  withdraw?.classList.toggle("hidden", view !== "withdraw");
  listing?.classList.toggle("hidden", view !== "listing");

  tabDash?.classList.toggle("is-active", view === "dashboard");
  tabWithdraw?.classList.toggle("is-active", view === "withdraw");
  tabList?.classList.toggle("is-active", view === "listing");

  tabDash?.setAttribute("aria-selected", view === "dashboard" ? "true" : "false");
  tabWithdraw?.setAttribute("aria-selected", view === "withdraw" ? "true" : "false");
  tabList?.setAttribute("aria-selected", view === "listing" ? "true" : "false");

  if (view === "dashboard") {
    loadSellerOrders();
    loadSellerOffers();
    loadEscrowLedger();
    loadMyListings();
    startSellerOffersPolling();
  } else if (view === "withdraw") {
    stopSellerOffersPolling();
    loadWithdrawPanel();
  } else {
    stopSellerOffersPolling();
  }
}

async function loadEscrowLedger() {
  const phone = apiPhone();
  if (!phone) return;

  try {
    const res = await fetch(`${ONBOARD_API}/ledger?phone=${encodeURIComponent(phone)}&sessionToken=${encodeURIComponent(getSessionToken() || "")}`, {
      headers: sellerAuthHeaders(),
    });
    if (res.status === 401) {
      handleSessionExpired(await res.json().catch(() => ({})));
      return;
    }
    if (!res.ok) return;
    const data = await res.json();
    ledgerData = data.ledger;
    el("ledger-available-total").textContent = formatKes(ledgerData.available?.totalKes || 0);
    el("ledger-pending-total").textContent = formatKes(ledgerData.pendingEscrow?.totalKes || 0);
    el("ledger-transit-total").textContent = formatKes(ledgerData.inTransit?.totalKes || 0);
    renderLedgerDetail();
  } catch {}
}

function bindLedgerTabs() {
  document.querySelectorAll(".sell-ledger-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      activeLedgerTab = tab.dataset.ledger || "available";
      document.querySelectorAll(".sell-ledger-tab").forEach((t) => t.classList.toggle("is-active", t === tab));
      renderLedgerDetail();
    });
  });
}

async function onSignOut() {
  const phone = apiPhone();
  clearSession();
  showVerifyPanel();
  setOnboardStatus("");
  setStatus("");
  setOffersStatus("");
  setDashboardOfferBadge(0);
  if (el("seller-offers")) el("seller-offers").innerHTML = "";
  if (phone) {
    try {
      await fetch(`${ONBOARD_API}/sign-out`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
    } catch {}
    await onSendCode();
  }
}

function init() {
  const saved = localStorage.getItem(PHONE_KEY);
  if (saved && el("seller-phone")) el("seller-phone").value = saved;

  bindMediaSlots();
  bindLedgerTabs();
  bindOfferFilterButtons();
  updateStepUi();

  el("tab-dashboard")?.addEventListener("click", () => showSellerView("dashboard"));
  el("tab-withdraw")?.addEventListener("click", () => showSellerView("withdraw"));
  el("tab-listing")?.addEventListener("click", () => showSellerView("listing"));
  el("load-withdraw-btn")?.addEventListener("click", loadWithdrawPanel);
  el("withdraw-request-btn")?.addEventListener("click", requestWithdrawal);
  el("load-orders-btn")?.addEventListener("click", loadSellerOrders);
  el("load-offers-btn")?.addEventListener("click", () => loadSellerOffers());
  el("offers-quick-chat-btn")?.addEventListener("click", openNextAcceptedOfferChat);
  el("offers-reset-handled-btn")?.addEventListener("click", resetHandledAcceptedOffersQueue);

  el("btn-next")?.addEventListener("click", () => goStep(1));
  el("btn-back")?.addEventListener("click", () => goStep(-1));
  el("post-btn")?.addEventListener("click", onPublish);
  el("save-draft-btn")?.addEventListener("click", onSaveDraft);
  el("load-listings-btn")?.addEventListener("click", loadMyListings);
  el("load-ledger-btn")?.addEventListener("click", loadEscrowLedger);
  el("onboard-btn")?.addEventListener("click", onOnboard);
  el("send-code-btn")?.addEventListener("click", onSendCode);
  el("verify-code-btn")?.addEventListener("click", onVerifyCode);
  el("resend-code-btn")?.addEventListener("click", onSendCode);
  el("verify-code-input")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") onVerifyCode();
  });
  el("sign-out-btn")?.addEventListener("click", onSignOut);
  el("seller-phone")?.addEventListener("change", () => {
    savePhone();
    clearSession();
    showVerifyPanel();
  });
  el("draft-price")?.addEventListener("input", updateFeeBreakdown);
  el("draft-shipping")?.addEventListener("input", updateFeeBreakdown);
  el("draft-weight-class")?.addEventListener("change", () => {
    draft.estimatedWeightClass = el("draft-weight-class")?.value;
    syncShippingFromWeightClass();
    updateFeeBreakdown();
  });
  el("draft-free-shipping")?.addEventListener("change", updateFeeBreakdown);

  loadMeta().then(async () => {
    checkApiHealth();
    const hadSession = loadSessionFromStorage();
    if (hadSession && (await tryRestoreSession())) return;
    showVerifyPanel();
    if (apiPhone()) await onSendCode();
  });
}

document.addEventListener("DOMContentLoaded", init);
