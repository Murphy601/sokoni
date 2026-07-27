const API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001"
    : "https://bot.sokonimall.com";
const LISTINGS_API = `${API_BASE}/api/seller/listings`;
const ONBOARD_API = `${API_BASE}/api/seller/onboard`;

const PHONE_KEY = "sokoni-seller-phone";
const DRAFT_KEY = "sokoni-seller-draft";

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

function savePhone() {
  const phone = getPhone();
  if (phone) localStorage.setItem(PHONE_KEY, phone);
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
  if (STEPS[stepIndex] === "review") fillReview();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function retailFromSupply(supply) {
  const cost = Math.max(0, Number(supply) || 0);
  return Math.ceil((cost + 100 + Math.round(cost * 0.08)) / 50) * 50;
}

function netToSeller(price) {
  return Math.round(Math.max(0, Number(price) || 0) * 0.92);
}

let sellerProfile = null;
let ledgerData = null;
let activeLedgerTab = "available";

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
      if (i === 0 && getPhone()) maybeAutoGenerate();
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
  const phone = getPhone();
  if (!phone) return;

  setStatus("AI reading your first photo…");
  try {
    const imageBase64 = await readFileAsDataUrl(photoFiles[0]);
    const res = await fetch(`${LISTINGS_API}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone,
        imageBase64,
        mimeType: photoFiles[0].type || "image/jpeg",
        caption: el("photo-caption")?.value.trim() || "",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.message || "AI skipped — fill in manually.", true);
      return;
    }
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
      setStatus("AI filled a draft — review each step before posting.");
    }
    fillFormFromDraft();
    if (sellerInfo?.businessName) showSellerProfile(sellerInfo);
  } catch {
    setStatus("AI unavailable — you can fill everything manually.");
  }
}

function fillFormFromDraft() {
  el("draft-name").value = draft.name || "";
  el("draft-description").value = draft.description || "";
  el("draft-tags").value = (draft.tags || []).map((t) => `#${t}`).join(" ");
  el("draft-brand").value = draft.brand || "";
  el("draft-brand2").value = draft.secondaryBrand || "";
  el("draft-price").value = draft.priceKes ?? draft.sourcePriceKes ?? "";
  el("draft-color").value = draft.color || "";
  el("draft-size").value = draft.size || "";
  el("draft-location").value = draft.location || "";
  el("draft-era").value = draft.era || "";
  el("draft-secondhand").checked = Boolean(draft.isSecondhand);

  populateSelect(el("draft-category"), Object.keys(CATEGORY_LABELS), CATEGORY_LABELS, draft.category);
  populateSelect(el("draft-condition"), meta.conditions, CONDITION_LABELS, draft.condition);
  populateBrowseSelects(draft.browseCategory, draft.browseSubCategory);
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
    priceKes: Math.round(Number(el("draft-price").value) || 0),
    sourcePriceKes: netToSeller(el("draft-price").value),
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
  el("review-summary").innerHTML = `
    <p class="font-semibold text-lg">${d.name || "—"}</p>
    <p class="text-sm text-brand-purple/70 dark:text-white/70 mt-2">${d.description || "—"}</p>
    <p class="text-sm mt-3">Price ${formatKes(d.priceKes)} · You receive ~${formatKes(netToSeller(d.priceKes))}</p>
    <p class="text-sm">${d.browseCategory || ""} → ${d.browseSubCategory || ""} · ${CONDITION_LABELS[d.condition] || d.condition}</p>
    <p class="text-xs mt-2 text-brand-purple/50">${(d.tags || []).map((t) => `#${t}`).join(" ")}</p>`;
}

async function collectImagesBase64() {
  const images = [];
  for (const file of photoFiles) {
    if (file) images.push(await readFileAsDataUrl(file));
  }
  return images;
}

async function onPublish() {
  const phone = getPhone();
  if (!phone) {
    setStatus("Enter your WhatsApp number.", true);
    return;
  }
  if (!photoFiles[0]) {
    setStatus("Add at least one photo.", true);
    goStep(-(stepIndex));
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, draft: collectDraft(), images, videoBase64 }),
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.message || data.error || "Post failed.", true);
      return;
    }

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
  const phone = getPhone();
  if (!phone) {
    setStatus("Enter your WhatsApp number.", true);
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, draft: collectDraft(), images, videoBase64 }),
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.message || data.error || "Save failed.", true);
      return;
    }
    setStatus(`Draft saved (${data.draftId}).`);
    await loadMyListings();
  } catch {
    setStatus("Network error.", true);
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
  } catch {
    populateBrowseSelects();
  }
}

async function loadMyListings() {
  const phone = getPhone();
  const wrap = el("my-listings");
  if (!phone || !wrap) return;

  wrap.innerHTML = `<p class="text-sm text-brand-purple/50 dark:text-white/50">Loading…</p>`;
  try {
    const res = await fetch(`${LISTINGS_API}?phone=${encodeURIComponent(phone)}`);
    const data = await res.json();
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
        const price = item.draft?.priceKes || item.draft?.sourcePriceKes;
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
}

async function checkSellerProfile() {
  const phone = getPhone();
  if (!phone) return;
  try {
    const res = await fetch(`${ONBOARD_API}?phone=${encodeURIComponent(phone)}`);
    if (!res.ok) {
      el("listing-wizard")?.classList.add("hidden");
      el("onboard-panel")?.classList.remove("hidden");
      return;
    }
    const data = await res.json();
    if (data.seller) {
      showSellerProfile(data.seller);
      await loadMyListings();
      await loadEscrowLedger();
    }
  } catch {
    /* stay on onboard */
  }
}

function setOnboardStatus(msg, isError = false) {
  const node = el("onboard-status");
  if (!node) return;
  node.textContent = msg || "";
  node.classList.toggle("text-red-600", isError);
  node.classList.toggle("dark:text-red-400", isError);
  node.classList.toggle("text-brand-green", !isError && Boolean(msg));
}

async function onOnboard() {
  const phone = getPhone();
  const shopName = el("onboard-shop-name")?.value.trim();
  const shopHandle = el("onboard-shop-handle")?.value.trim();
  const mpesaNumber = el("onboard-mpesa")?.value.trim();
  const nationalId = el("onboard-national-id")?.value.trim();

  if (!phone) {
    setOnboardStatus("Enter your WhatsApp number.", true);
    return;
  }
  if (!shopName) {
    setOnboardStatus("Shop name is required.", true);
    return;
  }
  if (!mpesaNumber) {
    setOnboardStatus("M-Pesa payout number is required.", true);
    return;
  }

  savePhone();
  setOnboardStatus("Creating your shop…");
  el("onboard-btn").disabled = true;

  try {
    const res = await fetch(ONBOARD_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, shopName, shopHandle, mpesaNumber, nationalId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setOnboardStatus(data.message || data.error || "Setup failed.", true);
      return;
    }
    setOnboardStatus(data.message || "Shop ready — add your first listing.");
    showSellerProfile(data.seller);
    await loadMyListings();
    await loadEscrowLedger();
  } catch {
    setOnboardStatus("Network error — try again.", true);
  } finally {
    el("onboard-btn").disabled = false;
  }
}

async function refreshListing(productId) {
  const phone = getPhone();
  if (!phone || !productId) return;
  setStatus("Refreshing listing…");
  try {
    const res = await fetch(`${ONBOARD_API}/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, productId }),
    });
    const data = await res.json();
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
    .map(
      (item) =>
        `<div class="flex justify-between gap-2 py-2 border-b border-brand-purple/5 dark:border-white/5">
          <span class="truncate">${item.productName || item.orderId}</span>
          <span class="font-semibold shrink-0">${formatKes(item.amountKes)}</span>
        </div>`
    )
    .join("");
}

async function loadEscrowLedger() {
  const phone = getPhone();
  if (!phone) return;

  try {
    const res = await fetch(`${ONBOARD_API}/ledger?phone=${encodeURIComponent(phone)}`);
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

function init() {
  const saved = localStorage.getItem(PHONE_KEY);
  if (saved && el("seller-phone")) el("seller-phone").value = saved;

  bindMediaSlots();
  bindLedgerTabs();
  updateStepUi();

  el("btn-next")?.addEventListener("click", () => goStep(1));
  el("btn-back")?.addEventListener("click", () => goStep(-1));
  el("post-btn")?.addEventListener("click", onPublish);
  el("save-draft-btn")?.addEventListener("click", onSaveDraft);
  el("load-listings-btn")?.addEventListener("click", loadMyListings);
  el("load-ledger-btn")?.addEventListener("click", loadEscrowLedger);
  el("onboard-btn")?.addEventListener("click", onOnboard);
  el("seller-phone")?.addEventListener("change", () => {
    savePhone();
    checkSellerProfile();
  });

  loadMeta().then(() => {
    checkSellerProfile();
  });
}

document.addEventListener("DOMContentLoaded", init);
