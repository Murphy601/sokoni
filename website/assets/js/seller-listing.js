const API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001"
    : "https://bot.sokonimall.com";
const LISTINGS_API = `${API_BASE}/api/seller/listings`;
const ONBOARD_API = `${API_BASE}/api/seller/onboard`;

const PHONE_KEY = "sokoni-seller-phone";
const DRAFT_KEY = "sokoni-seller-draft";
const VERIFY_TOKEN_KEY = "sokoni-seller-verify-token";
const PLATFORM_FEE_RATE = 0.1;
const MIN_SHIPPING_KES = 150;

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
  sellerProfile = profile;
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
    loadEscrowLedger();
    loadMyListings();
  } else if (view === "withdraw") {
    loadWithdrawPanel();
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
  updateStepUi();

  el("tab-dashboard")?.addEventListener("click", () => showSellerView("dashboard"));
  el("tab-withdraw")?.addEventListener("click", () => showSellerView("withdraw"));
  el("tab-listing")?.addEventListener("click", () => showSellerView("listing"));
  el("load-withdraw-btn")?.addEventListener("click", loadWithdrawPanel);
  el("withdraw-request-btn")?.addEventListener("click", requestWithdrawal);
  el("load-orders-btn")?.addEventListener("click", loadSellerOrders);

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
