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
const MIN_SHIPPING_KES = 300;

/** Mirror of bot mpesa-transaction-fees.js — fees vary by amount band (not flat). */
const MPESA_TRANSACTION_FEE_BANDS = [
  { min: 1, max: 100, feeKes: 0 },
  { min: 101, max: 500, feeKes: 5 },
  { min: 501, max: 1000, feeKes: 10 },
  { min: 1001, max: 1500, feeKes: 15 },
  { min: 1501, max: 2500, feeKes: 20 },
  { min: 2501, max: 3500, feeKes: 25 },
  { min: 3501, max: 5000, feeKes: 34 },
  { min: 5001, max: 7500, feeKes: 42 },
  { min: 7501, max: 10000, feeKes: 48 },
  { min: 10001, max: 15000, feeKes: 57 },
  { min: 15001, max: 20000, feeKes: 62 },
  { min: 20001, max: 25000, feeKes: 67 },
  { min: 25001, max: 30000, feeKes: 72 },
  { min: 30001, max: 35000, feeKes: 83 },
  { min: 35001, max: 40000, feeKes: 99 },
  { min: 40001, max: 45000, feeKes: 103 },
  { min: 45001, max: 250000, feeKes: 108 },
];

function mpesaTransactionFeeKes(amountKes) {
  const amount = Math.round(Number(amountKes) || 0);
  if (!Number.isFinite(amount) || amount < 1) return 0;
  for (const band of MPESA_TRANSACTION_FEE_BANDS) {
    if (amount >= band.min && amount <= band.max) return band.feeKes;
  }
  return MPESA_TRANSACTION_FEE_BANDS[MPESA_TRANSACTION_FEE_BANDS.length - 1].feeKes;
}
const SELLER_OFFERS_POLL_MS = 45000;
const OFFER_EXPIRING_SOON_MS = 2 * 60 * 60 * 1000;
const SELLER_OFFER_FILTERS = new Set([
  "pending",
  "all",
  "accepted",
  "expiring-soon",
  "reminded",
  "cooling-down",
  "ready-reminder",
  "chat-blocked",
  "not-reminded",
  "handled",
  "declined",
]);
const HANDLED_ACCEPTED_OFFERS_KEY = "sokoni-seller-handled-accepted-offers";
const HANDLED_HISTORY_LIMIT = 40;
const OFFER_REMINDER_COOLDOWN_MS = 90000;
const REMINDER_COOLDOWN_TICK_MS = 1000;
const OFFER_REMINDER_COOLDOWN_KEY = "sokoni-seller-offer-reminder-cooldowns";
const OFFER_REMINDER_SENT_AT_KEY = "sokoni-seller-offer-reminder-sent-at";
const OFFER_FILTER_PREFERENCE_KEY = "sokoni-seller-offer-filter";

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
const DEFAULT_MAX_PHOTOS = 8;
let meta = { conditions: Object.keys(CONDITION_LABELS), maxPhotos: DEFAULT_MAX_PHOTOS, browseTaxonomy: [] };
let draft = {};
let photoFiles = Array.from({ length: DEFAULT_MAX_PHOTOS }, () => null);
let photoPreviews = Array.from({ length: DEFAULT_MAX_PHOTOS }, () => null);
/** Cleaned cover preview (data URL or CDN URL). */
let coverCleanBase64 = null;
/** Studio cleaned cover CDN URL — prefer this on publish (avoids nginx 413). */
let coverCleanUrl = null;
/** Prefer cleaned cover for preview + publish when available. */
let preferCleanCover = true;
/** Studio clip preview (data URL or CDN URL). */
let studioClipBase64 = null;
/** Studio clip CDN URL — prefer this on publish (avoids nginx 413). */
let studioClipUrl = null;
/** Prefer studio clip as listing video when no manual upload. */
let preferStudioClip = true;
let studioUiEnabled = false;
let studioClipUiEnabled = false;
let videoFile = null;
/** HTTPS URL from POST /upload-video — publish uses this instead of raw videoBase64. */
let stagedSellerVideoUrl = null;
let videoPreview = null;
let sellerInfo = null;
/** Server draft id (DR-YYYY-####) when editing a saved draft. */
let activeDraftId = null;

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
  clearActiveOfferFilterPreference();
  clearHandledAcceptedOffersStorage();
  stopReminderCooldownTicker();
  clearReminderCooldownsStorage();
  clearReminderLastSentAtStorage();
  updateReminderCooldownHint({ count: 0, nextMs: 0 });
  updateAcceptedTriageHint([]);
  sellerOffersCache = [];
  acceptedQuickCursor = 0;
  stopSellerOffersPolling();
  currentSellerView = "dashboard";
  setDashboardOfferBadge(0);
  syncOfferFilterButtons();
  updateHandledResetButton();
  updateQuickModeHint();
  sessionStorage.removeItem(VERIFY_TOKEN_KEY);
  try {
    localStorage.removeItem(VERIFY_TOKEN_KEY);
  } catch {}
}

function handleSessionExpired(data) {
  clearSession();
  showVerifyPanel();
  setOnboardStatus(data?.message || "Session expired — verify WhatsApp again.", true);
}

function showVerifyPanel() {
  el("listing-wizard")?.classList.add("hidden");
  el("onboard-panel")?.classList.remove("hidden");
  el("sell-intro")?.classList.remove("hidden");
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
  node.classList.toggle("text-emerald-400", !isError && Boolean(msg));
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

function selectedDeliveryMethod() {
  // Platform no longer offers hub shipping calc — sellers arrange dispatch themselves.
  return "seller_express";
}

function isSellerHandledDelivery() {
  return true;
}

function computeFeeBreakdown(sellerNetKes) {
  const sellerNet = Math.max(0, Math.round(Number(sellerNetKes) || 0));
  // No platform shipping — buyer pays item + Sokoni 10% + M-Pesa only.
  const shipping = 0;
  const subtotal = sellerNet;
  const platformFee = Math.round(subtotal * PLATFORM_FEE_RATE);
  const chargeBeforeTxn = subtotal + platformFee;
  const transactionFeeKes = mpesaTransactionFeeKes(chargeBeforeTxn);
  const buyerTotal = chargeBeforeTxn + transactionFeeKes;

  return {
    sellerNetKes: sellerNet,
    itemKes: sellerNet,
    shippingKes: shipping,
    subtotalKes: subtotal,
    buyerTotalKes: buyerTotal,
    platformFeeKes: platformFee,
    platformFeeRate: PLATFORM_FEE_RATE,
    transactionFeeKes,
    chargeBeforeTxnKes: chargeBeforeTxn,
    freeShipping: true,
    deliveryMethod: "seller_express",
    shippingRecipient: "seller",
    sellerPayoutKes: sellerNet,
  };
}

function syncShippingFromWeightClass() {
  if (el("draft-shipping")) el("draft-shipping").value = "0";
  if (el("draft-free-shipping")) el("draft-free-shipping").checked = true;
}

function updateAiWeightNote() {
  el("ai-weight-note")?.classList.add("hidden");
}

function updateShippingFieldState() {
  if (el("draft-shipping")) el("draft-shipping").value = "0";
  if (el("draft-free-shipping")) el("draft-free-shipping").checked = true;
  const priceHint = el("draft-price-hint");
  if (priceHint) {
    priceHint.textContent =
      "What you receive for the item. Buyer pays item + 10% Sokoni + M-Pesa fee. You arrange delivery with the buyer after payment.";
  }
}

function setFeeLabel(id, text) {
  const node = el(id);
  if (node) node.textContent = text;
}

function renderFeeBreakdown(fees, prefix = "fee") {
  const set = (id, val) => {
    const node = el(`${prefix}-${id}`);
    if (node) node.textContent = formatKes(val);
  };
  const txn = fees.transactionFeeKes ?? 0;

  if (prefix === "fee") {
    setFeeLabel("fee-item-label", "You receive (item)");
    setFeeLabel("fee-platform-label", "Sokoni fee (10%)");
    setFeeLabel("fee-txn-label", "M-Pesa fee (varies by amount)");
    setFeeLabel("fee-net-label", "Your total payout");
  } else if (prefix === "review-fee") {
    setFeeLabel("review-fee-item-label", "You receive (item)");
    setFeeLabel("review-fee-platform-label", "Sokoni fee (10%)");
    setFeeLabel("review-fee-txn-label", "M-Pesa fee (varies by amount)");
    setFeeLabel("review-fee-net-label", "Your total payout");
  }

  set("item", fees.sellerNetKes);
  set("buyer", fees.buyerTotalKes);
  const platformNode = el(`${prefix}-platform`);
  if (platformNode) platformNode.textContent = formatKes(fees.platformFeeKes);
  const txnNode = el(`${prefix}-txn`);
  if (txnNode) txnNode.textContent = formatKes(txn);
  set("net", fees.sellerPayoutKes ?? fees.sellerNetKes);
}

function updateFeeBreakdown() {
  updateShippingFieldState();
  const fees = computeFeeBreakdown(el("draft-price")?.value);
  renderFeeBreakdown(fees, "fee");
  renderFeeBreakdown(fees, "review-fee");
  updateAiWeightNote();
}

function retailFromSupply(supply) {
  const cost = Math.max(0, Number(supply) || 0);
  return Math.ceil((cost + 100 + Math.round(cost * 0.08)) / 50) * 50;
}

let sellerProfile = null;
let ledgerData = null;
/** Cached dashboard slices for Selling Hub metrics / carousels. */
let hubCache = {
  orders: [],
  drafts: [],
  listings: [],
  liveCount: 0,
  draftCount: 0,
};

const HUB_DEFAULT_HUB_KEY = "sokoni-seller-default-hub";
const HUB_STOCK_NOTES_KEY = "sokoni-seller-stock-notes";
const HUB_PROMO_CODE_KEY = "sokoni-seller-promo-code";
const SOKONI_SUPPORT_WA = "254117422428";

const HUB_TRENDING_SEARCHES = [
  { tag: "Vintage Nike", growth: "High demand" },
  { tag: "Baggy Denim", growth: "Rising" },
  { tag: "Leather Jackets", growth: "Steady" },
  { tag: "Adidas Samba", growth: "Hot" },
  { tag: "Y2K Baby Tees", growth: "Rising" },
  { tag: "Thrift Dresses", growth: "Weekend spike" },
];

const HUB_SELLER_GUIDES = [
  {
    title: "Photograph fits on your phone",
    blurb: "Daylight, plain wall, fill the frame — buyers swipe past dark blurry shots.",
    action: "list",
  },
  {
    title: "Price pre-loved for fast sales",
    blurb: "Set what you want to receive (seller-net). Buyers pay that + Sokoni fee — you arrange delivery yourself.",
    action: "list",
  },
  {
    title: "Bulk Draft Studio",
    blurb: "Import up to 50 rows from CSV, then add photos before you post.",
    action: "bulk",
  },
  {
    title: "Dispatch within 48 hours",
    blurb: "After payment, contact the buyer and send the item — escrow releases after delivery.",
    action: "orders",
  },
];
let activeLedgerTab = "available";
let verificationToken = null;
let phoneVerified = false;
let resendCooldownTimer = null;
let sellerSocialUserIdPromise = null;
let sellerOffersPollTimer = null;
let sellerOffersRequestInFlight = false;
let sellerBalancePollTimer = null;
let currentSellerView = "dashboard";
let activeSellerOffersFilter = "pending";
let sellerOffersCache = [];
let acceptedQuickCursor = 0;
let handledAcceptedOfferIds = new Set();
let handledOffersStorageKey = null;
let handledOfferHistory = [];
let reminderCooldownByOfferId = new Map();
let reminderCooldownTickTimer = null;
let reminderCooldownStorageKey = null;
let reminderLastSentAtByOfferId = new Map();
let reminderLastSentStorageKey = null;
let offerFilterStorageKey = null;

function maxPhotoSlots() {
  return Math.min(Math.max(Number(meta.maxPhotos) || DEFAULT_MAX_PHOTOS, 1), 8);
}

function ensurePhotoArrays() {
  const n = maxPhotoSlots();
  while (photoFiles.length < n) photoFiles.push(null);
  while (photoPreviews.length < n) photoPreviews.push(null);
  if (photoFiles.length > n) photoFiles.length = n;
  if (photoPreviews.length > n) photoPreviews.length = n;
}

function parseOptionalInches(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n * 10) / 10;
}

function bindMediaSlots() {
  ensurePhotoArrays();
  for (let i = 0; i < maxPhotoSlots(); i += 1) {
    const input = el(`photo-slot-${i}`);
    if (!input || input.dataset.bound) continue;
    input.dataset.bound = "1";
    input.addEventListener("change", async (ev) => {
      const file = ev.target.files?.[0];
      if (!file) return;
      photoFiles[i] = file;
      if (photoPreviews[i]) URL.revokeObjectURL(photoPreviews[i]);
      photoPreviews[i] = URL.createObjectURL(file);
      if (i === 0) {
        coverCleanBase64 = null;
        coverCleanUrl = null;
        studioClipBase64 = null;
        studioClipUrl = null;
        window.__sokoniCleanImageUrls = [];
        preferCleanCover = true;
        const prefer = el("studio-prefer-clean");
        if (prefer) prefer.checked = true;
        try {
          sessionStorage.removeItem(STUDIO_MEDIA_KEY);
        } catch {
          /* ignore */
        }
        updateCoverStudioUi();
      }
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
      slot?.classList.remove("has-studio");
      if (i === 0 && sellerProfile) maybeAutoGenerate();
    });
  }

  el("video-input")?.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const maxBytes = Number(meta.maxVideoBytes) || 15 * 1024 * 1024;
    const maxSeconds = Number(meta.maxVideoSeconds) || 30;
    if (file.size > maxBytes) {
      setStatus(`Video must be ${Math.round(maxBytes / (1024 * 1024))}MB or smaller.`, true);
      ev.target.value = "";
      return;
    }
    // Soft guidance — heavy clips still fail on Kenya mobile even under the hard 15MB cap.
    if (file.size > 8 * 1024 * 1024) {
      setStatus(
        `Video is ${Math.round(file.size / (1024 * 1024))}MB — trim to under 8MB (~15s) so Post can finish on mobile.`,
        true
      );
      ev.target.value = "";
      return;
    }
    const durationOk = await assertVideoDuration(file, maxSeconds);
    if (!durationOk) {
      setStatus(`Keep seller videos to ${maxSeconds} seconds or less (15–30s is ideal).`, true);
      ev.target.value = "";
      return;
    }
    videoFile = file;
    stagedSellerVideoUrl = null;
    preferStudioClip = false;
    const preferClip = el("studio-prefer-clip");
    if (preferClip) preferClip.checked = false;
    if (videoPreview && String(videoPreview).startsWith("blob:")) URL.revokeObjectURL(videoPreview);
    videoPreview = URL.createObjectURL(file);
    refreshStudioClipPreview();
    setStatus(`Video ready (${Math.round(file.size / 1024)}KB) — shows on the product page.`);
  });

  el("studio-preview-btn")?.addEventListener("click", () => previewStudioClean());
  el("studio-prefer-clean")?.addEventListener("change", (ev) => {
    preferCleanCover = Boolean(ev.target.checked);
    refreshCoverPreview();
  });
  el("studio-prefer-clip")?.addEventListener("change", (ev) => {
    preferStudioClip = Boolean(ev.target.checked);
    refreshStudioClipPreview();
  });
}

function refreshStudioClipPreview() {
  const wrap = el("video-preview-wrap");
  const vid = el("video-preview");
  if (!wrap || !vid) return;
  if (videoFile && videoPreview) {
    wrap.classList.remove("hidden");
    vid.src = videoPreview;
    return;
  }
  const clipSrc =
    (preferStudioClip && studioClipUrl) ||
    (preferStudioClip && studioClipBase64) ||
    null;
  if (clipSrc) {
    wrap.classList.remove("hidden");
    vid.src = clipSrc;
    return;
  }
  if (!videoFile && !studioClipBase64 && !studioClipUrl) {
    wrap.classList.add("hidden");
    vid.removeAttribute("src");
  }
}

function updateCoverStudioUi() {
  const controls = el("studio-controls");
  const badge = el("media-slot-0")?.querySelector(".sell-studio-badge");
  const status = el("studio-status");
  const previewBtn = el("studio-preview-btn");
  const clipToggle = el("studio-prefer-clip")?.closest("label");
  if (controls) {
    const show = studioUiEnabled;
    controls.hidden = !show;
    controls.classList.toggle("hidden", !show);
  }
  const photoCount = photoFiles.filter(Boolean).length;
  if (previewBtn) {
    previewBtn.disabled = !photoFiles[0];
    if (!studioClipUiEnabled) {
      previewBtn.textContent = "Preview clean background";
    } else if (photoCount > 1) {
      previewBtn.textContent = `Preview clean + ${photoCount}-photo reel`;
    } else {
      previewBtn.textContent = "Preview clean + product clip";
    }
  }
  if (clipToggle) clipToggle.hidden = !studioClipUiEnabled;
  const showingClean = Boolean((coverCleanBase64 || coverCleanUrl) && preferCleanCover);
  el("media-slot-0")?.classList.toggle("has-studio", showingClean);
  if (badge) badge.hidden = !showingClean;
  if (status && !coverCleanBase64 && !coverCleanUrl && studioUiEnabled) {
    status.textContent = photoFiles[0]
      ? studioClipUiEnabled
        ? photoCount > 1
          ? `Preview cleans all ${photoCount} photos and builds one showcase reel.`
          : "Preview cleans the cover and builds a short product clip — AI draft waits for your price."
        : "Preview cleans the cover only — AI draft waits until you add your price."
      : "Add a cover photo to try background cleanup.";
  }
}

function refreshCoverPreview() {
  const slot = el("media-slot-0");
  if (!slot || !photoFiles[0]) return;
  let img = slot.querySelector("img.preview");
  if (!img) {
    img = document.createElement("img");
    img.className = "preview";
    img.alt = "";
    slot.insertBefore(img, slot.firstChild);
  }
  const src =
    preferCleanCover && coverCleanBase64
      ? coverCleanBase64
      : preferCleanCover && coverCleanUrl
        ? coverCleanUrl
        : photoPreviews[0];
  if (src) img.src = src;
  slot.classList.add("has-media");
  updateCoverStudioUi();
  const status = el("studio-status");
  if (status && coverCleanBase64) {
    status.textContent = preferCleanCover
      ? "Using cleaned cover for preview and when you post."
      : "Using your original cover — cleaned version kept if you switch back.";
  }
}

/** Cache a CDN asset as a data URL in the browser (keeps multi‑MB off the bot). */
async function cacheRemoteAsDataUrl(url) {
  if (!url || String(url).startsWith("data:")) return url || null;
  const res = await fetch(url);
  if (!res.ok) return url;
  const blob = await res.blob();
  if (!blob || blob.size < 32) return url;
  return readFileAsDataUrl(blob);
}

const STUDIO_MEDIA_KEY = "sokoni_studio_media";

function persistStudioMedia() {
  try {
    const urls = Array.isArray(window.__sokoniCleanImageUrls)
      ? window.__sokoniCleanImageUrls.filter((u) => /^https?:\/\//i.test(String(u)))
      : [];
    sessionStorage.setItem(
      STUDIO_MEDIA_KEY,
      JSON.stringify({
        imageUrls: urls,
        coverCleanUrl: coverCleanUrl || null,
        studioClipUrl: studioClipUrl || null,
        preferCleanCover,
        preferStudioClip,
      })
    );
  } catch {
    /* ignore quota */
  }
}

function restoreStudioMedia() {
  try {
    const raw = sessionStorage.getItem(STUDIO_MEDIA_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.imageUrls) && data.imageUrls.length) {
      window.__sokoniCleanImageUrls = data.imageUrls.slice();
    }
    if (data.coverCleanUrl && /^https?:\/\//i.test(data.coverCleanUrl)) {
      coverCleanUrl = data.coverCleanUrl;
      coverCleanBase64 = coverCleanBase64 || data.coverCleanUrl;
    }
    if (data.studioClipUrl && /^https?:\/\//i.test(data.studioClipUrl)) {
      studioClipUrl = data.studioClipUrl;
      studioClipBase64 = studioClipBase64 || data.studioClipUrl;
    }
    if (typeof data.preferCleanCover === "boolean") preferCleanCover = data.preferCleanCover;
    if (typeof data.preferStudioClip === "boolean") preferStudioClip = data.preferStudioClip;
  } catch {
    /* ignore */
  }
}

/**
 * Accept studio clip as CDN URL and/or data URL. Preview uses URL immediately;
 * we cache a data URL in the browser so publish doesn't re-hit Cloudinary / the bot.
 */
async function ingestStudioClip(clipVideoUrl, clipVideoBase64 = null) {
  const src = clipVideoBase64 || clipVideoUrl;
  if (!src) return false;
  if (clipVideoUrl && /^https?:\/\//i.test(clipVideoUrl)) studioClipUrl = clipVideoUrl;
  else if (/^https?:\/\//i.test(String(src))) studioClipUrl = String(src);
  studioClipBase64 = src;
  if (!videoFile) {
    preferStudioClip = true;
    const preferClip = el("studio-prefer-clip");
    if (preferClip) preferClip.checked = true;
  }
  persistStudioMedia();
  refreshStudioClipPreview();
  // Preview can use the CDN URL directly in <video src> — no need to base64-cache for publish.
  return true;
}

async function ingestCleanCover(cleanImageUrl, cleanImageBase64 = null) {
  const src = cleanImageBase64 || cleanImageUrl;
  if (!src) return false;
  if (cleanImageUrl && /^https?:\/\//i.test(cleanImageUrl)) coverCleanUrl = cleanImageUrl;
  coverCleanBase64 = src;
  preferCleanCover = true;
  const prefer = el("studio-prefer-clean");
  if (prefer) prefer.checked = true;
  persistStudioMedia();
  refreshCoverPreview();
  return true;
}

/** Build a small publish payload — CDN URLs for studio media, compressed JPEGs for extras. */
async function collectPublishPayload() {
  restoreStudioMedia();
  const imageUrls = [];
  const images = [];
  const studioUrls = Array.isArray(window.__sokoniCleanImageUrls)
    ? window.__sokoniCleanImageUrls.filter((u) => /^https?:\/\//i.test(String(u)))
    : [];

  if (preferCleanCover && studioUrls.length) {
    imageUrls.push(...studioUrls);
  } else if (preferCleanCover && coverCleanUrl) {
    imageUrls.push(coverCleanUrl);
  }

  for (let i = 0; i < photoFiles.length; i += 1) {
    const file = photoFiles[i];
    if (!file) continue;
    // Photos already sent as CDN URLs from studio reel/clean
    if (imageUrls.length && i < imageUrls.length) continue;
    if (i === 0 && imageUrls.length) continue;
    if (i === 0 && preferCleanCover && coverCleanBase64 && String(coverCleanBase64).startsWith("data:")) {
      images.push(coverCleanBase64);
      continue;
    }
    const compressed = await compressImageFile(file);
    images.push(await readFileAsDataUrl(compressed));
  }

  let videoUrl = null;
  let videoBase64 = null;
  let videoKind = null;
  if (videoFile) {
    videoKind = "seller";
    // Prefer already-staged bot URL (retry-safe). Never put multi‑MB base64 in /publish.
    if (stagedSellerVideoUrl && /^https?:\/\//i.test(stagedSellerVideoUrl)) {
      videoUrl = stagedSellerVideoUrl;
    } else {
      videoBase64 = await readFileAsDataUrl(videoFile);
    }
  } else {
    // Always attach Preview reel when we have it (don't depend on a toggle that can reset).
    const clipHttps =
      (studioClipUrl && /^https?:\/\//i.test(studioClipUrl) && studioClipUrl) ||
      (studioClipBase64 && /^https?:\/\//i.test(String(studioClipBase64)) && String(studioClipBase64)) ||
      null;
    if (clipHttps) {
      videoUrl = clipHttps;
      videoKind = "preview";
    } else if (preferStudioClip && studioClipBase64 && String(studioClipBase64).startsWith("data:")) {
      videoBase64 = studioClipBase64;
      videoKind = "preview";
    }
  }

  return { imageUrls, images, videoUrl, videoBase64, videoKind };
}

function applyCoverStudioResult(
  cleanImageBase64,
  message,
  clipVideoBase64 = null,
  clipVideoUrl = null,
  cleanImageUrl = null
) {
  if (!cleanImageBase64 && !cleanImageUrl) return;
  void ingestCleanCover(cleanImageUrl, cleanImageBase64);
  void ingestStudioClip(clipVideoUrl, clipVideoBase64);
  const status = el("studio-status");
  if (status) status.textContent = message || "Background cleaned.";
}

async function assertVideoDuration(file, maxSeconds) {
  const url = URL.createObjectURL(file);
  try {
    const dur = await new Promise((resolve) => {
      const vid = document.createElement("video");
      vid.preload = "metadata";
      vid.onloadedmetadata = () => resolve(Number(vid.duration) || 0);
      vid.onerror = () => resolve(0);
      vid.src = url;
    });
    if (!dur || !Number.isFinite(dur)) return true; // can't read — let server size check handle it
    return dur <= maxSeconds + 0.35;
  } finally {
    URL.revokeObjectURL(url);
  }
}

  /** @returns {"seller"|"preview"|null} */
function resolveListingVideoKind() {
  if (videoFile) return "seller";
  if (preferStudioClip && (studioClipUrl || studioClipBase64)) return "preview";
  return null;
}

async function resolveListingVideoBase64() {
  if (videoFile) return readFileAsDataUrl(videoFile);
  if (preferStudioClip && studioClipBase64) {
    if (String(studioClipBase64).startsWith("data:")) return studioClipBase64;
    // CDN URL still in memory — fetch once for publish payload.
    try {
      const res = await fetch(studioClipBase64);
      if (!res.ok) return null;
      const blob = await res.blob();
      if (!blob?.size) return null;
      studioClipBase64 = await readFileAsDataUrl(blob);
      return studioClipBase64;
    } catch {
      return null;
    }
  }
  return null;
}

async function previewStudioClean() {
  if (!photoFiles[0]) {
    setStatus("Add a cover photo first.", true);
    return;
  }
  if (!sellerProfile) {
    setStatus("Finish seller setup first, then try background cleanup.", true);
    return;
  }
  const phone = apiPhone();
  if (!phone) return;

  const btn = el("studio-preview-btn");
  if (btn) btn.disabled = true;
  const filled = photoFiles.filter(Boolean);
  setStatus(
    studioClipUiEnabled
      ? filled.length > 1
        ? `Cleaning ${filled.length} photos + building one reel…`
        : "Cleaning cover + building clip…"
      : "Cleaning cover background…"
  );
  const status = el("studio-status");
  if (status) status.textContent = "Working…";

  try {
    const imagesBase64 = [];
    for (const file of filled.slice(0, 8)) {
      const compressed = await compressImageFile(file);
      imagesBase64.push(await readFileAsDataUrl(compressed));
    }
    const res = await fetch(`${LISTINGS_API}/studio`, {
      method: "POST",
      headers: sellerAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(
        jsonAuthBody({
          phone,
          imageBase64: imagesBase64[0],
          imagesBase64,
          mimeType: "image/jpeg",
        })
      ),
    });
    const parsed = await parseApiResponse(res);
    if (parsed.status === 401) {
      handleSessionExpired(parsed.data);
      return;
    }
    if (!parsed.ok) {
      const msg = parsed.data?.message || parsed.message || "Background cleanup failed.";
      setStatus(msg, true);
      if (status) status.textContent = msg;
      return;
    }
    const data = parsed.data;
    if (data.studioApplied && (data.cleanImageBase64 || data.cleanImageUrl)) {
      applyCoverStudioResult(
        data.cleanImageBase64,
        data.message,
        data.clipApplied ? data.clipVideoBase64 : null,
        data.clipApplied ? data.clipVideoUrl : null,
        data.cleanImageUrl
      );
      // Cache all cleaned CDN URLs so publish can send the full reel set.
      if (Array.isArray(data.imageUrls) && data.imageUrls.length) {
        coverCleanUrl = data.imageUrls[0];
        window.__sokoniCleanImageUrls = data.imageUrls.slice();
      }
      persistStudioMedia();
      setStatus(data.message || "Background cleaned — review before posting.");
    } else {
      const msg = data.message || "Could not clean background — keep your original photo.";
      setStatus(msg, true);
      if (status) status.textContent = msg;
    }
  } catch {
    setStatus("Could not reach Sokoni — check your connection and try again.", true);
    checkApiHealth();
  } finally {
    if (btn) btn.disabled = !photoFiles[0];
  }
}

async function maybeAutoGenerate() {
  if (!photoFiles[0] || draft.name) return;
  if (!sellerProfile) {
    setStatus("Finish seller setup first, then add photos.", true);
    return;
  }
  const phone = apiPhone();
  if (!phone) return;

  const priceKes = listingPriceHintKes();
  if (!priceKes) {
    setStatus("Cover saved. Add your price (what you receive) — then AI will draft from the photo.");
    return;
  }

  setStatus("AI reading your first photo…");
  try {
    const compressed = await compressImageFile(photoFiles[0]);
    const imageBase64 = await readFileAsDataUrl(compressed);
    // Studio cleanup is Preview-only — never clean again during AI draft (avoids double work).
    const caption = el("photo-caption")?.value.trim() || "";
    const res = await fetch(`${LISTINGS_API}/generate`, {
      method: "POST",
      headers: sellerAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(
        jsonAuthBody({
          phone,
          imageBase64,
          mimeType: compressed.type || "image/jpeg",
          caption,
          sellerNetKes: priceKes,
          skipStudio: true,
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
          "AI skipped — check your price or fill details manually.",
        true
      );
      return;
    }
    const data = parsed.data;
    draft = { ...draft, ...data.draft };
    // Keep the seller’s entered net price if AI somehow drifted.
    if (priceKes > 0) {
      draft.sellerNetKes = priceKes;
      draft.priceKes = priceKes;
      draft.sourcePriceKes = priceKes;
    }
    sellerInfo = data.seller;
    fillFormFromDraft();
    // Stay on the current step — no auto-advance / no scroll jump while the seller is working.
    if (sellerInfo?.businessName) showSellerProfile(sellerInfo, { preserveView: true });
    updateCoverStudioUi();
    setStatus(
      data.message ||
        (studioUiEnabled
          ? "AI filled a draft — use Preview for clean photos/reel, then review before posting."
          : "AI filled a draft — review each step before posting.")
    );
  } catch {
    setStatus("Could not reach Sokoni — check your connection and try again.", true);
    checkApiHealth();
  }
}

/** Seller-net price from media step, pricing step, or caption (KES). */
function listingPriceHintKes() {
  syncMediaPriceFields();
  const fromForm = Math.round(Number(el("media-price")?.value || el("draft-price")?.value || 0));
  if (fromForm > 0) return fromForm;
  const cap = String(el("photo-caption")?.value || "");
  const patterns = [
    /\b(\d{2,7})\s*(?:ksh|kes)\b/i,
    /\b(?:ksh|kes)\s*(\d{2,7})\b/i,
    /(?:cost|price|@)\s*[:=]?\s*(?:ksh|kes)?\s*(\d{2,7})/i,
  ];
  for (const re of patterns) {
    const m = cap.match(re);
    if (m) {
      const n = Math.round(Number(m[1]));
      if (n > 0) return n;
    }
  }
  return 0;
}

function syncMediaPriceFields(sourceId) {
  const media = el("media-price");
  const draftPrice = el("draft-price");
  if (!media || !draftPrice) return;
  if (sourceId === "draft-price" && draftPrice.value !== "") {
    media.value = draftPrice.value;
  } else if (sourceId === "media-price" && media.value !== "") {
    draftPrice.value = media.value;
  } else if (media.value && !draftPrice.value) {
    draftPrice.value = media.value;
  } else if (draftPrice.value && !media.value) {
    media.value = draftPrice.value;
  }
}

function onListingPriceInput(ev) {
  const sourceId = ev?.target?.id || "media-price";
  syncMediaPriceFields(sourceId);
  updateFeeBreakdown();
  if (photoFiles[0] && !draft.name && listingPriceHintKes() > 0) {
    void maybeAutoGenerate();
  }
}

function isPlaceholderLabel(value) {
  return /^(unknown|n\/?a|none|null|undefined|not visible|unreadable|no brand|blank|item)$/i.test(
    String(value || "").trim()
  );
}

function fillFormFromDraft() {
  const name = draft.name && !isPlaceholderLabel(draft.name) ? draft.name : "";
  el("draft-name").value = name;
  el("draft-description").value =
    draft.description && String(draft.description).trim().length > 12 ? draft.description : "";
  const tags = (draft.tags || []).map((t) => String(t).replace(/^#/, "").trim()).filter(Boolean);
  el("draft-tags").value = tags.map((t) => `#${t}`).join(" ");
  el("draft-brand").value = draft.brand && !isPlaceholderLabel(draft.brand) ? draft.brand : "";
  el("draft-brand2").value = draft.secondaryBrand || "";
  el("draft-price").value = draft.sellerNetKes ?? draft.priceKes ?? draft.sourcePriceKes ?? "";
  if (el("media-price")) el("media-price").value = el("draft-price").value;
  document.querySelectorAll('input[name="draft-delivery-method"]').forEach((input) => {
    input.checked = input.value === "seller_express";
  });
  populateWeightClassSelect("small");
  if (el("draft-shipping")) el("draft-shipping").value = "0";
  if (el("draft-free-shipping")) el("draft-free-shipping").checked = true;
  el("draft-color").value = draft.color && !isPlaceholderLabel(draft.color) ? draft.color : "";
  el("draft-size").value = draft.size && !isPlaceholderLabel(draft.size) ? draft.size : "";
  if (el("draft-pit-to-pit")) {
    el("draft-pit-to-pit").value = Number(draft.pitToPitIn) > 0 ? draft.pitToPitIn : "";
  }
  if (el("draft-length-in")) {
    el("draft-length-in").value = Number(draft.lengthIn) > 0 ? draft.lengthIn : "";
  }
  if (el("draft-waist-in")) {
    el("draft-waist-in").value = Number(draft.waistIn) > 0 ? draft.waistIn : "";
  }
  el("draft-location").value = draft.location || "";
  el("draft-era").value = draft.era || "";
  el("draft-secondhand").checked = Boolean(draft.isSecondhand);

  populateSelect(el("draft-category"), Object.keys(CATEGORY_LABELS), CATEGORY_LABELS, draft.category);
  const conditionOk = draft.condition && CONDITION_LABELS[draft.condition];
  populateSelect(
    el("draft-condition"),
    meta.conditions,
    CONDITION_LABELS,
    conditionOk ? draft.condition : "gently_used"
  );
  populateBrowseSelects(draft.browseCategory, draft.browseSubCategory);
  updateFeeBreakdown();
}

function browsePathInMeta(browseCat, browseSub) {
  const tax = meta.browseTaxonomy || [];
  const cat = tax.find((c) => c.id === browseCat);
  if (!cat) return false;
  if (!browseSub) return true;
  return (cat.subcategories || []).some((s) => s.id === browseSub);
}

function populateBrowseSelects(browseCat, browseSub) {
  const catSelect = el("draft-browse-cat");
  const subSelect = el("draft-browse-sub");
  if (!catSelect || !subSelect) return;

  const tax = meta.browseTaxonomy || [];
  catSelect.innerHTML = tax.map((c) => `<option value="${c.id}">${c.label}</option>`).join("");
  const validPath = browsePathInMeta(browseCat, browseSub);
  if (validPath && browseCat) catSelect.value = browseCat;

  const cat = tax.find((c) => c.id === catSelect.value) || tax[0];
  subSelect.innerHTML = (cat?.subcategories || [])
    .map((s) => `<option value="${s.id}">${s.label}</option>`)
    .join("");
  if (validPath && browseSub) subSelect.value = browseSub;

  catSelect.onchange = () => {
    const selected = tax.find((c) => c.id === catSelect.value);
    subSelect.innerHTML = (selected?.subcategories || [])
      .map((s) => `<option value="${s.id}">${s.label}</option>`)
      .join("");
  };
}

function collectDraft() {
  syncMediaPriceFields();
  const tagsRaw = el("draft-tags")?.value || "";
  const tags = tagsRaw
    .split(/[\s,#]+/)
    .map((t) => t.replace(/^#/, "").trim())
    .filter(Boolean)
    .slice(0, meta.maxTags || 5);

  const net = Math.round(Number(el("draft-price")?.value || el("media-price")?.value || 0));
  const fees = computeFeeBreakdown(net);
  return {
    ...draft,
    name: el("draft-name").value.trim(),
    description: el("draft-description").value.trim(),
    tags,
    brand: el("draft-brand").value.trim(),
    secondaryBrand: el("draft-brand2").value.trim(),
    sellerNetKes: net,
    priceKes: net,
    sourcePriceKes: net,
    deliveryMethod: "seller_express",
    shippingRecipient: "seller",
    sellerPayoutKes: fees.sellerPayoutKes,
    estimatedWeightClass: "small",
    freeShipping: true,
    shippingKes: 0,
    category: el("draft-category").value,
    browseCategory: el("draft-browse-cat")?.value,
    browseSubCategory: el("draft-browse-sub")?.value,
    condition: el("draft-condition").value,
    color: el("draft-color").value.trim(),
    size: el("draft-size").value.trim(),
    pitToPitIn: parseOptionalInches(el("draft-pit-to-pit")?.value),
    lengthIn: parseOptionalInches(el("draft-length-in")?.value),
    waistIn: parseOptionalInches(el("draft-waist-in")?.value),
    era: el("draft-era").value,
    location: el("draft-location").value.trim(),
    isSecondhand: el("draft-secondhand").checked,
  };
}

function fillReview() {
  const d = collectDraft();
  const fees = computeFeeBreakdown(d.sellerNetKes ?? d.priceKes);
  el("review-summary").innerHTML = `
    <p class="font-semibold text-lg">${d.name || "—"}</p>
    <p class="text-sm text-brand-purple/70 dark:text-white/70 mt-2">${d.description || "—"}</p>
    <p class="text-sm mt-3">${d.browseCategory || ""} → ${d.browseSubCategory || ""} · ${CONDITION_LABELS[d.condition] || d.condition}${d.size ? ` · Size ${d.size}` : ""}</p>
    <p class="text-xs mt-2 text-brand-purple/60 dark:text-white/60">Delivery: you arrange dispatch with the buyer after payment</p>
    ${
      d.pitToPitIn || d.lengthIn || d.waistIn
        ? `<p class="text-xs mt-2 text-brand-purple/60 dark:text-white/60">Flat: ${[
            d.pitToPitIn != null ? `P2P ${d.pitToPitIn}"` : null,
            d.lengthIn != null ? `L ${d.lengthIn}"` : null,
            d.waistIn != null ? `W ${d.waistIn}"` : null,
          ]
            .filter(Boolean)
            .join(" · ")}</p>`
        : ""
    }
    <p class="text-xs mt-2 text-brand-purple/50">${(d.tags || []).map((t) => `#${t}`).join(" ")}</p>`;
  renderFeeBreakdown(fees, "review-fee");
}

async function collectImagesBase64() {
  const images = [];
  for (let i = 0; i < photoFiles.length; i += 1) {
    const file = photoFiles[i];
    if (!file) continue;
    if (i === 0 && preferCleanCover && coverCleanBase64) {
      if (String(coverCleanBase64).startsWith("data:")) {
        images.push(coverCleanBase64);
      } else {
        try {
          images.push(await cacheRemoteAsDataUrl(coverCleanBase64));
        } catch {
          images.push(await readFileAsDataUrl(await compressImageFile(photoFiles[0])));
        }
      }
      continue;
    }
    const compressed = await compressImageFile(file);
    images.push(await readFileAsDataUrl(compressed));
  }
  return images;
}

function listingMediaUrl(relOrUrl) {
  const raw = String(relOrUrl || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const file = raw.replace(/^\//, "").split("/").pop();
  if (!file) return "";
  return `${API_BASE}/catalog-images/${encodeURIComponent(file)}`;
}

function clearPhotoSlots() {
  ensurePhotoArrays();
  for (let i = 0; i < maxPhotoSlots(); i += 1) {
    if (photoPreviews[i]) URL.revokeObjectURL(photoPreviews[i]);
    photoFiles[i] = null;
    photoPreviews[i] = null;
    const slot = el(`media-slot-${i}`);
    slot?.querySelector("img.preview")?.remove();
    slot?.classList.remove("has-media", "has-studio");
    const input = el(`photo-slot-${i}`);
    if (input) input.value = "";
  }
  coverCleanBase64 = null;
  coverCleanUrl = null;
  studioClipBase64 = null;
  studioClipUrl = null;
  preferCleanCover = true;
  const prefer = el("studio-prefer-clean");
  if (prefer) prefer.checked = true;
  updateCoverStudioUi();
}

function setPhotoSlotPreview(index, file, previewUrl) {
  photoFiles[index] = file;
  if (photoPreviews[index]) URL.revokeObjectURL(photoPreviews[index]);
  photoPreviews[index] = previewUrl;
  const slot = el(`media-slot-${index}`);
  let img = slot?.querySelector("img.preview");
  if (!img && slot) {
    img = document.createElement("img");
    img.className = "preview";
    img.alt = "";
    slot.insertBefore(img, slot.firstChild);
  }
  if (img) img.src = previewUrl;
  slot?.classList.add("has-media");
  slot?.classList.remove("has-studio");
}

async function hydratePhotosFromListing(item) {
  clearPhotoSlots();
  const paths = [];
  if (Array.isArray(item?.images) && item.images.length) paths.push(...item.images);
  else if (item?.imageUrl) paths.push(item.imageUrl);
  const limited = paths.filter(Boolean).slice(0, 4);
  for (let i = 0; i < limited.length; i += 1) {
    const url = listingMediaUrl(limited[i]);
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const blob = await res.blob();
      if (!blob.size) continue;
      const file = new File([blob], `draft-${i + 1}.jpg`, { type: blob.type || "image/jpeg" });
      setPhotoSlotPreview(i, file, URL.createObjectURL(file));
    } catch {
      /* keep going — seller can re-upload if fetch fails */
    }
  }
  updateCoverStudioUi();
}

async function openDraftForEdit(item) {
  if (!item || (item.status && item.status !== "draft")) return;
  activeDraftId = item.id || item.draftId || null;
  draft = { ...(item.draft || {}) };
  el("success-box")?.classList.add("hidden");
  el("wizard-root")?.classList.remove("hidden");
  fillFormFromDraft();
  setStatus(activeDraftId ? `Editing draft ${activeDraftId}…` : "Opening draft…");
  showSellerView("listing");
  stepIndex = 0;
  updateStepUi();
  await hydratePhotosFromListing(item);
  if (!photoFiles[0]) {
    setStatus("Draft opened — add at least one photo before posting.", true);
  } else {
    setStatus(`Draft ${activeDraftId || ""} loaded. Edit and post when ready.`);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteDraft(draftId) {
  const phone = apiPhone();
  const id = String(draftId || "").trim();
  if (!phone || !id) return;
  if (!window.confirm(`Delete draft ${id}? This cannot be undone.`)) return;
  setStatus("Deleting draft…");
  try {
    const params = new URLSearchParams({ phone: normalizePhoneInput(phone) });
    const token = getSessionToken();
    if (token) params.set("sessionToken", token);
    const res = await fetch(`${LISTINGS_API}/draft/${encodeURIComponent(id)}?${params}`, {
      method: "DELETE",
      headers: sellerAuthHeaders(),
    });
    const parsed = await parseApiResponse(res);
    if (parsed.status === 401) {
      handleSessionExpired(parsed.data);
      return;
    }
    if (!parsed.ok) {
      setStatus(parsed.data?.message || parsed.data?.error || "Could not delete draft.", true);
      return;
    }
    if (activeDraftId === id) activeDraftId = null;
    setStatus(`Draft ${id} deleted.`);
    await loadMyListings();
  } catch {
    setStatus("Network error while deleting draft.", true);
  }
}

let publishInFlight = false;

function showPublishSuccess(data) {
  el("success-box")?.classList.remove("hidden");
  el("success-ref").textContent = data.productId || "";
  el("success-status").textContent =
    data.message ||
    (data.status === "hidden_pending_review"
      ? "Posted but hidden pending review — check My listings for the reason, or wait for WhatsApp."
      : "Your listing is live on Sokoni now.");
  el("wizard-root")?.classList.add("hidden");
  localStorage.removeItem(DRAFT_KEY);
  activeDraftId = null;
}

/** After a dropped proxy socket, check My listings for a matching fresh post. */
async function recoverPublishFromListings(draft) {
  const phone = apiPhone();
  if (!phone || !draft?.name) return null;
  try {
    const res = await fetch(
      `${LISTINGS_API}?phone=${encodeURIComponent(phone)}`,
      { headers: sellerAuthHeaders() }
    );
    const parsed = await parseApiResponse(res);
    if (!parsed.ok) return null;
    const items = parsed.data?.listings || [];
    const list = Array.isArray(items) ? items : [];
    const name = String(draft.name || "").trim().toLowerCase();
    const net = Math.round(Number(draft.sellerNetKes || draft.priceKes) || 0);
    const cutoff = Date.now() - 10 * 60_000;
    for (const item of list) {
      const pName = String(item.draft?.name || item.name || "").trim().toLowerCase();
      const pNet = Math.round(
        Number(item.draft?.sellerNetKes || item.draft?.priceKes || item.sellerNetKes || 0) || 0
      );
      const createdRaw = item.createdAt || item.postedAt || 0;
      const created = Number(createdRaw) || Date.parse(createdRaw) || 0;
      if (
        pName === name &&
        (!net || !pNet || Math.abs(pNet - net) < 1) &&
        (!created || created >= cutoff)
      ) {
        return {
          productId: item.productId || item.id,
          status: item.status === "hidden" ? "hidden_pending_review" : "live",
          message: "Your listing is live on Sokoni now.",
          duplicate: true,
          videoUrl: item.videoUrl || null,
          videoKind: item.videoKind || null,
        };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postListingRequest(media, clientPublishId, draft) {
  const res = await fetch(`${LISTINGS_API}/publish`, {
    method: "POST",
    headers: sellerAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(
      jsonAuthBody({
        phone: apiPhone(),
        draft,
        images: media.images,
        imageUrls: media.imageUrls,
        videoBase64: media.videoBase64,
        videoUrl: media.videoUrl,
        videoKind: media.videoKind,
        draftId: activeDraftId || undefined,
        clientPublishId,
      })
    ),
  });
  return parseApiResponse(res);
}

/**
 * Upload seller phone video as raw bytes (not JSON base64) so mobile posts survive.
 * Falls back to legacy JSON /upload-video only if binary fails hard.
 */
async function stageSellerVideoUpload(file) {
  if (!file) return { ok: false, message: "Choose a video first." };
  const maxBytes = Number(meta.maxVideoBytes) || 15 * 1024 * 1024;
  // Soft cap for Kenya mobile — 15MB base64 (~20MB JSON) routinely times out.
  const softCap = Math.min(maxBytes, 8 * 1024 * 1024);
  if (file.size > maxBytes) {
    return {
      ok: false,
      status: 413,
      message: `Video must be ${Math.round(maxBytes / (1024 * 1024))}MB or smaller.`,
    };
  }
  if (file.size > softCap) {
    return {
      ok: false,
      status: 413,
      message:
        "That clip is too heavy for mobile upload — trim to about 15 seconds or under 8MB, then try again.",
    };
  }

  const phone = apiPhone();
  const params = new URLSearchParams({ phone: normalizePhoneInput(phone) });
  const token = getSessionToken();
  if (token) params.set("sessionToken", token);
  const url = `${LISTINGS_API}/upload-video-bin?${params}`;

  try {
    const staged = await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.timeout = 180_000;
      xhr.responseType = "text";
      xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
      xhr.upload.onprogress = (ev) => {
        if (!ev.lengthComputable || ev.total <= 0) return;
        const pct = Math.min(99, Math.round((ev.loaded / ev.total) * 100));
        setStatus(`Uploading your video… ${pct}%`);
      };
      xhr.onload = () => {
        let data = null;
        try {
          data = JSON.parse(xhr.responseText || "{}");
        } catch {
          data = null;
        }
        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          data,
          message:
            data?.message ||
            (xhr.status === 413
              ? "Video is too large — trim it and try again."
              : "Could not upload your video."),
        });
      };
      xhr.onerror = () =>
        resolve({
          ok: false,
          status: 0,
          data: null,
          message: "Video upload dropped — check your connection and try again.",
        });
      xhr.ontimeout = () =>
        resolve({
          ok: false,
          status: 0,
          data: null,
          message: "Video upload timed out — trim to under 8MB / ~15s and try again.",
        });
      xhr.send(file);
    });
    if (staged.ok || staged.status === 401 || staged.status === 413) return staged;
  } catch (err) {
    console.warn("[sell] binary video upload failed:", err);
  }

  // Legacy JSON base64 path (desktop / small clips only).
  try {
    setStatus("Uploading your video…");
    const videoBase64 = await readFileAsDataUrl(file);
    const res = await fetch(`${LISTINGS_API}/upload-video`, {
      method: "POST",
      headers: sellerAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(jsonAuthBody({ phone, videoBase64 })),
    });
    return parseApiResponse(res);
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      message: err?.message || "Could not upload your video — try a shorter clip.",
    };
  }
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
  if (publishInFlight) {
    setStatus("Still posting — hang tight…");
    return;
  }
  if (!photoFiles[0] && !activeDraftId) {
    setStatus("Add at least one photo.", true);
    goStep(-(stepIndex));
    return;
  }
  const d = collectDraft();
  if (!d.sellerNetKes || d.sellerNetKes < 10) {
    setStatus("Enter a valid item price (KES).", true);
    goStep(-(stepIndex - STEPS.indexOf("pricing")));
    return;
  }

  savePhone();
  setStatus("Posting listing…");
  publishInFlight = true;
  el("post-btn").disabled = true;
  const clientPublishId =
    sessionStorage.getItem("sokoni_publish_id") ||
    `pub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  sessionStorage.setItem("sokoni_publish_id", clientPublishId);

  const finishOk = async (data) => {
    sessionStorage.removeItem("sokoni_publish_id");
    stagedSellerVideoUrl = null;
    try {
      sessionStorage.removeItem(STUDIO_MEDIA_KEY);
    } catch {
      /* ignore */
    }
    showPublishSuccess(data);
    await loadMyListings();
    setStatus(data.message || "Your listing is live on Sokoni now.");
  };

  const usedOwnVideo = Boolean(videoFile);
  try {
    const media = await collectPublishPayload();
    if (!media.imageUrls.length && !media.images.length && !activeDraftId) {
      setStatus("Add at least one photo.", true);
      return;
    }
    if (!media.videoUrl && !media.videoBase64 && !videoFile && studioClipUiEnabled) {
      console.warn("[sell] posting without studio reel URL — Preview may not have finished");
    }

    // Own phone video: stage alone first (large base64). Publish then sends only the short URL.
    if (videoFile && media.videoBase64 && !media.videoUrl) {
      setStatus("Uploading your video…");
      const staged = await stageSellerVideoUpload(videoFile);
      if (staged.status === 401) {
        handleSessionExpired(staged.data);
        return;
      }
      if (staged.status === 413) {
        setStatus(
          staged.data?.message ||
            staged.message ||
            "Video is too large — trim to under 15MB or about 15 seconds, then try again.",
          true
        );
        return;
      }
      if (!staged.ok || !staged.data?.videoUrl) {
        setStatus(
          staged.data?.message ||
            staged.message ||
            "Could not upload your video — check your connection and try again.",
          true
        );
        return;
      }
      stagedSellerVideoUrl = staged.data.videoUrl;
      media.videoUrl = stagedSellerVideoUrl;
      media.videoBase64 = null;
      media.videoKind = "seller";
      setStatus("Posting listing…");
    }

    let parsed = await postListingRequest(media, clientPublishId, collectDraft());
    if (parsed.status === 401) {
      handleSessionExpired(parsed.data);
      return;
    }
    if (parsed.status === 413) {
      setStatus("Photos/video are too large for upload — try fewer photos or a shorter video.", true);
      return;
    }
    if (!parsed.ok) {
      setStatus(parsed.data?.message || parsed.data?.error || parsed.message || "Post failed.", true);
      return;
    }
    await finishOk(parsed.data);
  } catch (err) {
    console.warn("[sell] publish socket dropped:", err);
    // Same clientPublishId → server returns the existing listing if it already saved.
    setStatus("Confirming your listing…");
    try {
      await sleepMs(1500);
      const media = await collectPublishPayload();
      // Never re-send raw videoBase64 on retry — it is what usually drops the socket.
      if (videoFile) {
        media.videoBase64 = null;
        if (!media.videoUrl) {
          setStatus("Uploading your video…");
          const staged = await stageSellerVideoUpload(videoFile);
          if (staged.ok && staged.data?.videoUrl) {
            media.videoUrl = staged.data.videoUrl;
            media.videoKind = "seller";
          }
        }
      }
      const retry = await postListingRequest(media, clientPublishId, d);
      if (retry.ok && retry.data?.productId) {
        await finishOk(retry.data);
        return;
      }
    } catch {
      /* keep polling listings */
    }
    for (let i = 0; i < 4; i += 1) {
      await sleepMs(1200 + i * 400);
      const recovered = await recoverPublishFromListings(d);
      if (recovered?.productId) {
        await finishOk(recovered);
        return;
      }
    }
    // Honest failure — do not claim “Post sent” when My listings has nothing.
    if (usedOwnVideo) {
      setStatus(
        "Post didn’t finish — your video upload may have timed out. Trim to ~15s / under 10MB, or post with the Preview reel instead.",
        true
      );
    } else {
      setStatus(
        "Couldn’t confirm the listing. Open My listings — if it’s not there, tap Post again.",
        true
      );
    }
  } finally {
    publishInFlight = false;
    setTimeout(() => {
      if (!publishInFlight) el("post-btn").disabled = false;
    }, 5000);
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
  setStatus(activeDraftId ? "Updating draft…" : "Saving draft…");
  try {
    const media = await collectPublishPayload();
    const res = await fetch(`${LISTINGS_API}/draft`, {
      method: "POST",
      headers: sellerAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(
        jsonAuthBody({
          phone,
          draft: d,
          images: media.images,
          imageUrls: media.imageUrls,
          videoBase64: media.videoBase64,
          videoUrl: media.videoUrl,
          videoKind: media.videoKind,
          draftId: activeDraftId || undefined,
        })
      ),
    });
    const parsed = await parseApiResponse(res);
    if (parsed.status === 401) {
      handleSessionExpired(parsed.data);
      return;
    }
    if (parsed.status === 413) {
      setStatus("Photos/video are too large to save — try fewer photos or a shorter clip.", true);
      return;
    }
    if (!parsed.ok) {
      setStatus(parsed.data?.message || parsed.data?.error || parsed.message || "Save failed.", true);
      return;
    }
    activeDraftId = parsed.data.draftId || activeDraftId;
    setStatus(`Draft saved (${activeDraftId}). Continue editing or post when ready.`);
    await loadMyListings();
  } catch {
    setStatus("Could not reach Sokoni — check your connection.", true);
    checkApiHealth();
  }
}

async function loadMeta() {
  try {
    const res = await fetch(`${LISTINGS_API}/meta`);
    if (!res.ok) {
      renderListingAiStatus(null);
      return;
    }
    meta = await res.json();
    ensurePhotoArrays();
    bindMediaSlots();
    populateBrowseSelects();
    populateSelect(el("draft-condition"), meta.conditions || Object.keys(CONDITION_LABELS), CONDITION_LABELS);
    populateSelect(el("draft-category"), Object.keys(CATEGORY_LABELS), CATEGORY_LABELS);
    if (Array.isArray(meta.eras)) {
      el("draft-era").innerHTML =
        `<option value="">—</option>` + meta.eras.map((e) => `<option value="${e}">${e}</option>`).join("");
    }
    populateWeightClassSelect(draft.estimatedWeightClass);
    renderListingAiStatus(meta);
  } catch {
    populateBrowseSelects();
    populateWeightClassSelect();
    renderListingAiStatus(null);
  }
}

function renderListingAiStatus(metaData) {
  const node = el("listing-ai-status");
  if (!node) return;
  if (!metaData) {
    studioUiEnabled = false;
    studioClipUiEnabled = false;
    node.textContent =
      "Could not check AI status. You can still list manually — add a caption like “130 ksh women sandals” or fill the form yourself.";
    updateCoverStudioUi();
    return;
  }
  const visionOn = Boolean(metaData.visionModel || metaData.visionProvider);
  const nvidiaOn = Boolean(metaData.nvidiaVisionEnabled);
  const geminiOn = Boolean(metaData.geminiVisionEnabled);
  studioUiEnabled = Boolean(metaData.studioEnabled);
  studioClipUiEnabled = Boolean(metaData.studioClipEnabled);
  const parts = [];
  if (visionOn) {
    parts.push("AI can draft from your cover photo");
    if (nvidiaOn) parts.push("NVIDIA fallback on");
    if (geminiOn) parts.push("Gemini fallback on");
  } else {
    parts.push("Photo AI offline — use a caption or fill details manually");
  }
  if (studioUiEnabled) {
    parts.push(
      studioClipUiEnabled
        ? "Cloudinary cleanup + short product clip — preview below"
        : "background cleanup available — preview below"
    );
  }
  parts.push("price = what you receive; buyers pay price + Sokoni fee; you arrange delivery");
  node.textContent = parts.join(" · ") + ".";
  updateCoverStudioUi();
}

function setBulkCsvStatus(message, isError = false) {
  const node = el("bulk-csv-status");
  if (!node) return;
  node.textContent = message || "";
  node.classList.toggle("text-red-600", isError);
  node.classList.toggle("dark:text-red-400", isError);
  node.classList.toggle("text-emerald-400", !isError && Boolean(message));
}

/** In-browser draft preview rows before POST (data-only CSV — no # instruction rows). */
let bulkPreviewRows = [];
let bulkPreviewHeaders = [
  "title",
  "price_kes",
  "category",
  "subcategory",
  "size",
  "condition",
  "color",
  "brand",
  "shipping_kes",
  "vibe_tags",
  "description",
  "pit_to_pit_in",
  "length_in",
  "waist_in",
];

function csvEscapeCell(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseCsvClient(text) {
  const src = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n" || (ch === "\r" && next === "\n")) {
      if (ch === "\r") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((c) => String(c).trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    if (ch === "\r") {
      row.push(cell);
      cell = "";
      if (row.some((c) => String(c).trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some((c) => String(c).trim() !== "")) rows.push(row);
  return rows;
}

function normalizeBulkHeader(raw) {
  const key = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[()]/g, "")
    .trim()
    .replace(/\s+/g, "_");
  const aliases = {
    title: "title",
    name: "title",
    price_kes: "price_kes",
    price: "price_kes",
    seller_net: "price_kes",
    category: "category",
    subcategory: "subcategory",
    sub_category: "subcategory",
    size: "size",
    condition: "condition",
    color: "color",
    colour: "color",
    brand: "brand",
    shipping_kes: "shipping_kes",
    shipping: "shipping_kes",
    vibe_tags: "vibe_tags",
    tags: "vibe_tags",
    description: "description",
    pit_to_pit_in: "pit_to_pit_in",
    length_in: "length_in",
    waist_in: "waist_in",
  };
  return aliases[key] || null;
}

function buildBulkPreviewFromCsv(csvText) {
  const table = parseCsvClient(csvText).filter((r) => !String(r[0] || "").trim().startsWith("#"));
  if (!table.length) return { rows: [], error: "CSV is empty." };
  const headerMap = table[0].map((h) => normalizeBulkHeader(h));
  if (!headerMap.includes("title") || !headerMap.includes("price_kes")) {
    return { rows: [], error: "CSV needs title and price_kes columns — download the latest template." };
  }
  const known = bulkPreviewHeaders.filter((h) => headerMap.includes(h));
  if (known.length) bulkPreviewHeaders = [...new Set([...known, ...bulkPreviewHeaders])];

  const body = table.slice(1).filter((cells) => {
    const first = String(cells[0] || "").trim();
    return first && !first.startsWith("#") && cells.some((c) => String(c || "").trim() !== "");
  });
  if (!body.length) return { rows: [], error: "No data rows found (comment lines are ignored)." };
  if (body.length > 50) {
    return { rows: [], error: `Too many rows (${body.length}). Max 50 per upload — split the file.` };
  }

  const rows = body.map((cells, idx) => {
    const obj = { _id: idx + 1 };
    for (let c = 0; c < headerMap.length; c += 1) {
      const key = headerMap[c];
      if (!key) continue;
      obj[key] = cells[c] != null ? String(cells[c]).trim() : "";
    }
    if (obj.tags && !obj.vibe_tags) obj.vibe_tags = obj.tags;
    return obj;
  });
  return { rows, error: null };
}

function serializeBulkPreviewToCsv() {
  const headers = bulkPreviewHeaders;
  const lines = [headers.join(",")];
  for (const row of bulkPreviewRows) {
    lines.push(headers.map((h) => csvEscapeCell(row[h] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function updateBulkImportButton() {
  const btn = el("bulk-csv-import-btn");
  const count = el("bulk-preview-count");
  if (count) count.textContent = String(bulkPreviewRows.length);
  if (btn) btn.disabled = bulkPreviewRows.length === 0;
}

function conditionChipLabel(raw) {
  const key = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return CONDITION_LABELS[key] || raw || "—";
}

function renderBulkPreview() {
  const panel = el("bulk-preview-panel");
  const tbody = el("bulk-preview-tbody");
  if (!panel || !tbody) return;
  if (!bulkPreviewRows.length) {
    panel.classList.add("hidden");
    tbody.innerHTML = "";
    updateBulkImportButton();
    return;
  }
  panel.classList.remove("hidden");
  tbody.innerHTML = bulkPreviewRows
    .map((row, index) => {
      const vibes = String(row.vibe_tags || "")
        .split(/[,;#]+/)
        .map((t) => t.replace(/^#/, "").trim())
        .filter(Boolean)
        .slice(0, 5);
      const catBits = [row.category, row.subcategory].filter(Boolean).join(" › ") || "—";
      return `<tr data-bulk-idx="${index}">
        <td class="font-mono text-brand-purple/40 dark:text-white/40">${index + 1}</td>
        <td><input class="bulk-studio-input" data-field="title" value="${escapeHtml(row.title || "")}" aria-label="Title" /></td>
        <td><input class="bulk-studio-input bulk-studio-input--price" data-field="price_kes" type="number" min="1" step="1" value="${escapeHtml(row.price_kes || "")}" aria-label="Price KES" /></td>
        <td class="text-brand-purple/60 dark:text-white/60 whitespace-nowrap">${escapeHtml(catBits)}</td>
        <td><input class="bulk-studio-input bulk-studio-input--size" data-field="size" value="${escapeHtml(row.size || "")}" aria-label="Size" /></td>
        <td><span class="bulk-studio-condition">${escapeHtml(conditionChipLabel(row.condition))}</span></td>
        <td class="text-brand-purple/60 dark:text-white/60">${escapeHtml(row.brand || "—")}</td>
        <td>${
          vibes.length
            ? vibes.map((t) => `<span class="bulk-studio-vibe">#${escapeHtml(t)}</span>`).join("")
            : `<span class="text-brand-purple/35 dark:text-white/35">—</span>`
        }</td>
        <td class="text-right">
          <button type="button" class="bulk-studio-remove" data-bulk-remove="${index}" aria-label="Remove row">Remove</button>
        </td>
      </tr>`;
    })
    .join("");
  updateBulkImportButton();
}

function loadBulkPreviewFromText(csvText, sourceLabel) {
  const parsed = buildBulkPreviewFromCsv(csvText);
  if (parsed.error) {
    bulkPreviewRows = [];
    renderBulkPreview();
    setBulkCsvStatus(parsed.error, true);
    return false;
  }
  bulkPreviewRows = parsed.rows;
  renderBulkPreview();
  setBulkCsvStatus(
    `${bulkPreviewRows.length} item${bulkPreviewRows.length === 1 ? "" : "s"} ready to review${
      sourceLabel ? ` from ${sourceLabel}` : ""
    }. Edit the grid, then Create drafts.`
  );
  return true;
}

function clearBulkPreview() {
  bulkPreviewRows = [];
  renderBulkPreview();
  if (el("bulk-csv-paste")) el("bulk-csv-paste").value = "";
  if (el("bulk-csv-file")) el("bulk-csv-file").value = "";
  setBulkCsvStatus("Preview cleared.");
}

async function downloadBulkCsvTemplate(ev) {
  ev?.preventDefault?.();
  try {
    const res = await fetch(`${LISTINGS_API}/bulk/template`, { headers: sellerAuthHeaders() });
    if (!res.ok) {
      setBulkCsvStatus("Could not download template.", true);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sokoni-bulk-listings-template.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setBulkCsvStatus("Template downloaded — data rows only. Tips stay in this panel, not the CSV.");
  } catch {
    setBulkCsvStatus("Network error downloading template.", true);
  }
}

async function loadBulkCsvHelp() {
  const list = el("bulk-csv-help-list");
  if (!list) return;
  try {
    const res = await fetch(`${LISTINGS_API}/bulk/template?format=json`, { headers: sellerAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const tips = data?.help?.tips;
    if (Array.isArray(tips) && tips.length) {
      list.innerHTML = tips.map((t) => `<li>${escapeHtml(t)}</li>`).join("");
    }
    if (Array.isArray(data?.headers) && data.headers.length) {
      bulkPreviewHeaders = data.headers;
    }
  } catch {
    /* keep static fallback tips */
  }
}

async function importBulkCsvText(csvText) {
  const phone = apiPhone();
  if (!phone) {
    setBulkCsvStatus("Enter your WhatsApp number first.", true);
    return;
  }
  if (!sellerProfile) {
    setBulkCsvStatus("Finish seller setup before bulk upload.", true);
    return;
  }
  const text = String(csvText || "").trim();
  if (!text) {
    setBulkCsvStatus("Paste CSV or choose a .csv file.", true);
    return;
  }

  const btn = el("bulk-csv-import-btn");
  if (btn) btn.disabled = true;
  setBulkCsvStatus("Creating drafts…");
  try {
    const res = await fetch(`${LISTINGS_API}/bulk/drafts`, {
      method: "POST",
      headers: sellerAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(jsonAuthBody({ phone, csvText: text })),
    });
    const parsed = await parseApiResponse(res);
    if (parsed.status === 401) {
      handleSessionExpired(parsed.data);
      return;
    }
    if (!parsed.ok) {
      const errLines = Array.isArray(parsed.data?.errors)
        ? parsed.data.errors
            .slice(0, 5)
            .map((e) => (e.row ? `Row ${e.row}: ${e.message}` : e.message))
            .join(" · ")
        : "";
      setBulkCsvStatus(
        [parsed.data?.message || parsed.data?.error || "Import failed.", errLines].filter(Boolean).join(" "),
        true
      );
      return;
    }
    const count = Number(parsed.data?.count) || 0;
    const errCount = Array.isArray(parsed.data?.errors) ? parsed.data.errors.length : 0;
    setBulkCsvStatus(
      count
        ? `${count} draft${count === 1 ? "" : "s"} created${errCount ? ` (${errCount} row warning${errCount === 1 ? "" : "s"})` : ""}. Add photos via Continue editing, then Post.`
        : parsed.data?.message || "No drafts imported."
    );
    bulkPreviewRows = [];
    renderBulkPreview();
    if (el("bulk-csv-paste")) el("bulk-csv-paste").value = "";
    if (el("bulk-csv-file")) el("bulk-csv-file").value = "";
    await loadMyListings();
    showSellerView("dashboard");
  } catch {
    setBulkCsvStatus("Network error during import.", true);
  } finally {
    updateBulkImportButton();
  }
}

function bindBulkDropzone() {
  const zone = el("bulk-csv-dropzone");
  if (!zone) return;

  const onDrag = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    zone.classList.add("is-dragover");
  };
  const onLeave = (ev) => {
    ev.preventDefault();
    zone.classList.remove("is-dragover");
  };
  zone.addEventListener("dragenter", onDrag);
  zone.addEventListener("dragover", onDrag);
  zone.addEventListener("dragleave", onLeave);
  zone.addEventListener("drop", async (ev) => {
    ev.preventDefault();
    zone.classList.remove("is-dragover");
    const file = ev.dataTransfer?.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (el("bulk-csv-paste")) el("bulk-csv-paste").value = text;
      loadBulkPreviewFromText(text, file.name);
    } catch {
      setBulkCsvStatus("Could not read that file.", true);
    }
  });
  zone.addEventListener("click", () => el("bulk-csv-file")?.click());
  zone.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      el("bulk-csv-file")?.click();
    }
  });
}

function bindBulkCsvUi() {
  el("bulk-csv-template-btn")?.addEventListener("click", (ev) => {
    void downloadBulkCsvTemplate(ev);
  });
  el("bulk-csv-preview-btn")?.addEventListener("click", () => {
    loadBulkPreviewFromText(el("bulk-csv-paste")?.value || "", "paste");
  });
  el("bulk-csv-clear-btn")?.addEventListener("click", () => {
    clearBulkPreview();
  });
  el("bulk-csv-import-btn")?.addEventListener("click", () => {
    if (!bulkPreviewRows.length) {
      setBulkCsvStatus("Preview a CSV first — nothing to create yet.", true);
      return;
    }
    void importBulkCsvText(serializeBulkPreviewToCsv());
  });
  el("bulk-csv-file")?.addEventListener("change", async (ev) => {
    const file = ev.target?.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (el("bulk-csv-paste")) el("bulk-csv-paste").value = text;
      loadBulkPreviewFromText(text, file.name);
    } catch {
      setBulkCsvStatus("Could not read that file.", true);
    }
  });
  el("bulk-preview-tbody")?.addEventListener("input", (ev) => {
    const input = ev.target?.closest?.("[data-field]");
    const tr = ev.target?.closest?.("tr[data-bulk-idx]");
    if (!input || !tr) return;
    const idx = Number(tr.getAttribute("data-bulk-idx"));
    const field = input.getAttribute("data-field");
    if (!Number.isFinite(idx) || !bulkPreviewRows[idx] || !field) return;
    bulkPreviewRows[idx][field] = input.value;
  });
  el("bulk-preview-tbody")?.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("[data-bulk-remove]");
    if (!btn) return;
    const idx = Number(btn.getAttribute("data-bulk-remove"));
    if (!Number.isFinite(idx)) return;
    bulkPreviewRows.splice(idx, 1);
    renderBulkPreview();
    setBulkCsvStatus(
      bulkPreviewRows.length
        ? `${bulkPreviewRows.length} item${bulkPreviewRows.length === 1 ? "" : "s"} left in preview.`
        : "Preview empty — import another CSV."
    );
  });
  bindBulkDropzone();
  void loadBulkCsvHelp();
  updateBulkImportButton();
}

async function loadMyListings() {
  const phone = apiPhone();
  const wrap = el("my-listings");
  if (!phone || !wrap) return;

  wrap.innerHTML = `<p class="text-sm text-zinc-500">Loading…</p>`;
  const hint = el("bulk-drafts-hint");
  if (hint) hint.classList.add("hidden");
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
    const items = [...(data.drafts || []), ...(data.listings || [])];
    hubCache.drafts = data.drafts || [];
    hubCache.listings = data.listings || [];
    hubCache.draftCount = hubCache.drafts.length;
    hubCache.liveCount = (data.listings || []).filter((l) => (l.status || "live") === "live").length;
    renderSellerHubOverview();
    renderHubStockAlerts();
    renderHubMarketing();
    if (!items.length) {
      wrap.innerHTML = `<p class="text-sm text-zinc-500">No listings yet — add your first item above, or import a CSV.</p>`;
      return;
    }
    const draftById = new Map();
    const draftsNeedingPhotos = (data.drafts || []).filter(
      (d) => !(d.imageUrl || (Array.isArray(d.images) && d.images.length))
    );
    if (hint && draftsNeedingPhotos.length) {
      hint.textContent = `${draftsNeedingPhotos.length} draft${draftsNeedingPhotos.length === 1 ? "" : "s"} need photos — Continue editing → add pics → Post.`;
      hint.classList.remove("hidden");
    }
    wrap.innerHTML = items
      .map((item) => {
        const status = item.status || "draft";
        const summary = item.moderationSummary || {};
        const badge =
          status === "live"
            ? "bg-emerald-500/15 text-emerald-400"
            : status === "hidden"
              ? "bg-red-500/15 text-red-400"
              : "bg-zinc-800 text-zinc-300";
        const title = escapeHtml(item.draft?.name || item.id);
        const img = item.imageUrl || item.images?.[0];
        const imgSrc = listingMediaUrl(img);
        const pid = item.productId || item.id;
        const price = item.draft?.buyerTotalKes ?? item.draft?.priceKes ?? item.draft?.sourcePriceKes ?? item.draft?.sellerNetKes;
        const shareUrl = `https://sokonimall.com/?q=${encodeURIComponent(pid)}`;
        const reason = summary.reason || (Array.isArray(summary.labels) ? summary.labels.join(" · ") : "");
        const sellerHint = summary.sellerHint || "";
        const needsPhoto = status === "draft" && !img;
        if (status === "draft") draftById.set(String(pid), item);
        return `
          <div class="sell-hub-rail-card ${status === "hidden" ? "sell-listing-card--hidden" : ""}" role="listitem" data-product-id="${escapeHtml(pid)}" data-status="${escapeHtml(status)}">
            ${imgSrc ? `<img src="${escapeHtml(imgSrc)}" alt="" class="sell-hub-rail-card__thumb" />` : `<div class="sell-hub-rail-card__thumb sell-hub-rail-card__thumb--empty">No photo</div>`}
            <div class="sell-hub-rail-card__body">
              <p class="font-semibold truncate text-sm">${title}</p>
              <p class="text-xs text-zinc-400 mt-1">${escapeHtml(pid)}${price ? ` · ${formatKes(price)}` : ""}${item.source === "bulk_csv" ? " · CSV" : ""}</p>
              <span class="inline-block mt-2 text-xs font-semibold px-2 py-0.5 rounded-full ${badge}">${escapeHtml(status)}</span>
              ${needsPhoto ? `<p class="text-xs text-zinc-400 mt-2">Add photos before posting.</p>` : ""}
              ${status === "hidden" && reason ? `<p class="sell-moderation-reason mt-2 text-xs font-medium text-red-700 dark:text-red-300">${escapeHtml(reason)}</p>` : ""}
              ${status === "hidden" && sellerHint ? `<p class="sell-moderation-hint mt-1 text-xs text-zinc-400">${escapeHtml(sellerHint)}</p>` : ""}
              ${status === "draft" ? `
              <div class="flex flex-wrap gap-2 mt-3">
                <button type="button" class="text-xs font-semibold text-[#FF2300] hover:underline continue-draft-btn" data-id="${escapeHtml(pid)}">${needsPhoto ? "Add photos & edit" : "Continue editing"}</button>
                <button type="button" class="text-xs font-semibold text-brand-purple/70 dark:text-white/70 hover:underline delete-draft-btn" data-id="${escapeHtml(pid)}">Delete draft</button>
              </div>` : ""}
              ${status === "live" ? `
              <div class="flex flex-wrap gap-2 mt-3">
                <button type="button" class="text-xs font-semibold text-[#FF2300] hover:underline refresh-listing-btn" data-id="${escapeHtml(pid)}">↻ Refresh listing</button>
                <button type="button" class="text-xs font-semibold text-[#FF2300] hover:underline drop-price-btn" data-id="${escapeHtml(pid)}" data-seller-net="${escapeHtml(String(item.draft?.sellerNetKes ?? item.draft?.sourcePriceKes ?? ""))}" data-buyer-total="${escapeHtml(String(price ?? ""))}">↓ Drop price</button>
                <button type="button" class="text-xs font-semibold text-emerald-400 hover:underline raise-price-btn" data-id="${escapeHtml(pid)}" data-seller-net="${escapeHtml(String(item.draft?.sellerNetKes ?? item.draft?.sourcePriceKes ?? ""))}" data-buyer-total="${escapeHtml(String(price ?? ""))}">↑ Raise price</button>
                ${
                  item.promoActive || item.draft?.promo?.active
                    ? `<button type="button" class="text-xs font-semibold text-amber-300 hover:underline end-promo-btn" data-id="${escapeHtml(pid)}">End promo</button>
                       <span class="text-[10px] text-emerald-400 font-semibold self-center">Promo live${item.originalPriceKes || item.draft?.originalPriceKes ? ` · was ${formatKes(item.originalPriceKes || item.draft.originalPriceKes)}` : ""}</span>`
                    : `<button type="button" class="text-xs font-semibold text-emerald-300 hover:underline set-promo-btn" data-id="${escapeHtml(pid)}" data-seller-net="${escapeHtml(String(item.draft?.sellerNetKes ?? item.draft?.sourcePriceKes ?? ""))}" data-buyer-total="${escapeHtml(String(price ?? ""))}">% Set promo</button>`
                }
                <a href="https://wa.me/?text=${encodeURIComponent(`🛍️ ${item.draft?.name || pid} — ${formatKes(price)}\n${shareUrl}`)}" target="_blank" rel="noopener" class="text-xs font-semibold text-[#FF2300] hover:underline">Share to WhatsApp</a>
              </div>` : ""}
            </div>
          </div>`;
      })
      .join("");

    wrap.querySelectorAll(".refresh-listing-btn").forEach((btn) => {
      btn.addEventListener("click", () => refreshListing(btn.dataset.id));
    });
    wrap.querySelectorAll(".drop-price-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        void updateListingPrice(btn.dataset.id, btn.dataset.sellerNet, btn.dataset.buyerTotal, "drop");
      });
    });
    wrap.querySelectorAll(".raise-price-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        void updateListingPrice(btn.dataset.id, btn.dataset.sellerNet, btn.dataset.buyerTotal, "raise");
      });
    });
    wrap.querySelectorAll(".set-promo-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        void setListingPromo(btn.dataset.id, btn.dataset.sellerNet, btn.dataset.buyerTotal);
      });
    });
    wrap.querySelectorAll(".end-promo-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        void endListingPromo(btn.dataset.id);
      });
    });
    wrap.querySelectorAll(".continue-draft-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = draftById.get(String(btn.dataset.id || ""));
        if (item) void openDraftForEdit(item);
      });
    });
    wrap.querySelectorAll(".delete-draft-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        void deleteDraft(btn.dataset.id);
      });
    });
  } catch {
    wrap.innerHTML = `<p class="text-sm text-red-600 dark:text-red-400">Network error.</p>`;
  }
}

function showSellerProfile(profile, opts = {}) {
  sellerProfile = { ...(profile || {}) };
  const knownUserId = Number(sellerProfile.userId || sellerProfile.socialUserId);
  if (Number.isInteger(knownUserId) && knownUserId > 0) {
    sellerProfile.socialUserId = knownUserId;
  }
  loadActiveOfferFilterPreference();
  syncOfferFilterButtons();
  sellerSocialUserIdPromise = null;
  stopReminderCooldownTicker();
  loadReminderCooldowns();
  loadReminderLastSentAt();
  updateReminderCooldownHint(reminderCooldownStats());
  updateAcceptedTriageHint(sellerOffersCache);
  loadHandledAcceptedOffers();
  updateHandledResetButton();
  updateUndoLastDoneButton();
  el("seller-badge").textContent = profile.businessName || profile.shopName || "Your shop";
  if (profile.shopHandle) el("seller-handle").textContent = profile.shopHandle;
  const trustLine = el("seller-trust-line");
  if (trustLine) {
    const verified = Boolean(profile.isVerified || profile.isSellerVerified || profile.verified);
    trustLine.classList.toggle("hidden", !verified);
  }
  el("seller-profile-bar")?.classList.remove("hidden");
  el("listing-wizard")?.classList.remove("hidden");
  el("onboard-panel")?.classList.add("hidden");
  el("sell-intro")?.classList.add("hidden");
  fillShopEditFormFromSeller(profile);
  void hydrateShopEditFormFromSocial();
  void loadSellerActivity();
  // Login / onboard land on Overview; listing AI must not yank sellers off the wizard.
  if (!opts.preserveView) {
    showSellerView("overview");
  }
}

function setEditShopStatus(message, isError = false) {
  const node = el("edit-shop-status");
  if (!node) return;
  node.textContent = message || "";
  node.classList.toggle("text-red-600", isError);
  node.classList.toggle("dark:text-red-400", isError);
  node.classList.toggle("text-emerald-400", !isError && Boolean(message));
}

function fillShopEditFormFromSeller(profile = {}) {
  const name = profile.businessName || profile.shopName || "";
  const handle = String(profile.shopHandle || profile.handle || "").replace(/^@+/, "");
  if (el("edit-shop-name") && !el("edit-shop-name").value) el("edit-shop-name").value = name;
  else if (el("edit-shop-name")) el("edit-shop-name").value = name;
  if (el("edit-shop-handle")) el("edit-shop-handle").value = handle;
  if (el("edit-shop-location") && profile.city != null) el("edit-shop-location").value = profile.city || "";
  const publicLink = el("seller-public-shop-link");
  if (publicLink && handle) {
    publicLink.href = `../shop.html?handle=${encodeURIComponent(handle)}`;
    publicLink.classList.remove("hidden");
  }
}

async function hydrateShopEditFormFromSocial() {
  const handle = normalizeHandleForLookup(sellerProfile?.shopHandle || el("edit-shop-handle")?.value || "");
  if (!handle) return;
  try {
    const res = await fetch(`${SOCIAL_API}/shop/${encodeURIComponent(handle)}?limit=1`);
    const parsed = await parseApiResponse(res);
    if (!parsed.ok) return;
    const shop = parsed.data?.shop || {};
    const userId = Number(shop.userId);
    if (Number.isInteger(userId) && userId > 0) sellerProfile.socialUserId = userId;
    if (el("edit-shop-name") && shop.shopName) el("edit-shop-name").value = shop.shopName;
    if (el("edit-shop-handle") && shop.handle) {
      el("edit-shop-handle").value = String(shop.handle).replace(/^@+/, "");
    }
    if (el("edit-shop-bio")) el("edit-shop-bio").value = shop.bio || "";
    if (el("edit-shop-location")) el("edit-shop-location").value = shop.location || sellerProfile.city || "";
    if (el("edit-shop-avatar")) el("edit-shop-avatar").value = shop.avatarUrl || "";
    updateShopAvatarPreview(shop.avatarUrl || "");
    if (el("edit-shop-instagram")) el("edit-shop-instagram").value = shop.instagramUrl || "";
    if (el("edit-shop-tiktok")) el("edit-shop-tiktok").value = shop.tiktokUrl || "";
    if (el("edit-shop-wa-notify")) {
      // Pref comes from notify-prefs endpoint; default on until loaded.
      el("edit-shop-wa-notify").checked = true;
    }
    const publicLink = el("seller-public-shop-link");
    const cleanHandle = normalizeHandleForLookup(shop.handle || handle);
    if (publicLink && cleanHandle) {
      publicLink.href = `../shop.html?handle=${encodeURIComponent(cleanHandle)}`;
      publicLink.classList.remove("hidden");
    }
    await loadSellerNotifyPrefs();
  } catch {
    /* keep onboard defaults */
  }
}

function applySellerNotifyPrefs(data = {}) {
  if (el("edit-shop-wa-notify")) {
    el("edit-shop-wa-notify").checked = data.socialWaNotify !== false;
  }
  if (el("edit-shop-wa-notify-follows")) {
    el("edit-shop-wa-notify-follows").checked = data.socialWaNotifyFollows !== false;
  }
  if (el("edit-shop-wa-notify-likes")) {
    el("edit-shop-wa-notify-likes").checked = data.socialWaNotifyLikes !== false;
  }
}

async function loadSellerNotifyPrefs() {
  const phone = apiPhone();
  const token = getSessionToken();
  if (!el("edit-shop-wa-notify") || !phone || !token) return;
  try {
    const params = new URLSearchParams({
      phone: normalizePhoneInput(phone),
      sessionToken: token,
    });
    const res = await fetch(`${SOCIAL_API}/notify-prefs?${params.toString()}`);
    const parsed = await parseApiResponse(res);
    if (!parsed.ok) return;
    applySellerNotifyPrefs(parsed.data || {});
  } catch {
    /* leave default */
  }
}

async function saveShopProfile(event) {
  event?.preventDefault?.();
  const phone = apiPhone();
  if (!phone || !getSessionToken()) {
    setEditShopStatus("Sign in again to edit your shop profile.", true);
    return;
  }

  // Optional file upload first — sets avatar_url, then profile PATCH can keep or clear URL field.
  const fileInput = el("edit-shop-avatar-file");
  const pendingFile = fileInput?.files?.[0] || shopAvatarPendingFile;
  if (pendingFile) {
    const uploaded = await uploadShopAvatarFile(pendingFile);
    if (!uploaded) {
      return;
    }
  }

  const avatarUrlValue = String(el("edit-shop-avatar")?.value || "").trim();
  const payload = jsonAuthBody({
    phone,
    shopName: el("edit-shop-name")?.value || "",
    handle: el("edit-shop-handle")?.value || "",
    bio: el("edit-shop-bio")?.value || "",
    location: el("edit-shop-location")?.value || "",
    // Only send when set — empty string would otherwise null out users.avatar_url on PATCH.
    ...(avatarUrlValue ? { avatarUrl: avatarUrlValue } : {}),
    instagramUrl: el("edit-shop-instagram")?.value || "",
    tiktokUrl: el("edit-shop-tiktok")?.value || "",
    socialWaNotify: el("edit-shop-wa-notify") ? el("edit-shop-wa-notify").checked : true,
    socialWaNotifyFollows: el("edit-shop-wa-notify-follows")
      ? el("edit-shop-wa-notify-follows").checked
      : true,
    socialWaNotifyLikes: el("edit-shop-wa-notify-likes")
      ? el("edit-shop-wa-notify-likes").checked
      : true,
  });
  const btn = el("edit-shop-save-btn");
  if (btn) btn.disabled = true;
  setEditShopStatus("Saving…");
  try {
    const res = await fetch(`${SOCIAL_API}/shop/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...sellerAuthHeaders() },
      body: JSON.stringify(payload),
    });
    const parsed = await parseApiResponse(res);
    if (parsed.status === 401) {
      handleSessionExpired(parsed.data);
      return;
    }
    if (!parsed.ok) {
      setEditShopStatus(parsed.data?.message || "Could not save shop profile.", true);
      return;
    }
    const shop = parsed.data?.shop || {};
    sellerProfile = {
      ...sellerProfile,
      businessName: shop.shopName || sellerProfile.businessName,
      shopName: shop.shopName || sellerProfile.shopName,
      shopHandle: shop.handle || sellerProfile.shopHandle,
      city: shop.location || sellerProfile.city,
      socialUserId: shop.userId || sellerProfile.socialUserId,
    };
    el("seller-badge").textContent = sellerProfile.businessName || "Your shop";
    if (sellerProfile.shopHandle) el("seller-handle").textContent = sellerProfile.shopHandle;
    fillShopEditFormFromSeller(sellerProfile);
    if (el("edit-shop-bio")) el("edit-shop-bio").value = shop.bio || "";
    if (el("edit-shop-avatar")) el("edit-shop-avatar").value = shop.avatarUrl || "";
    updateShopAvatarPreview(shop.avatarUrl || "");
    applySellerNotifyPrefs(shop);
    shopAvatarPendingFile = null;
    if (fileInput) fileInput.value = "";
    setEditShopStatus(parsed.data?.message || "Shop profile updated.");
  } catch {
    setEditShopStatus("Network error while saving shop profile.", true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** Pending avatar file chosen before Save (uploaded on save). */
let shopAvatarPendingFile = null;

function updateShopAvatarPreview(urlOrObjectUrl) {
  const wrap = el("edit-shop-avatar-preview");
  if (!wrap) return;
  const src = String(urlOrObjectUrl || "").trim();
  if (!src) {
    wrap.innerHTML = `<span class="text-xs text-brand-purple/40">—</span>`;
    return;
  }
  wrap.innerHTML = `<img src="${escapeHtml(src)}" alt="" class="h-full w-full object-cover" />`;
}

async function uploadShopAvatarFile(file) {
  const phone = apiPhone();
  if (!phone || !getSessionToken()) {
    setEditShopStatus("Sign in again to upload a profile photo.", true);
    return false;
  }
  setEditShopStatus("Uploading profile photo…");
  try {
    const compressed = await compressImageFile(file, 800, 0.85);
    const imageBase64 = await readFileAsDataUrl(compressed);
    const res = await fetch(`${SOCIAL_API}/shop/avatar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sellerAuthHeaders() },
      body: JSON.stringify(
        jsonAuthBody({
          phone,
          imageBase64,
          mimeType: compressed.type || "image/jpeg",
        })
      ),
    });
    const parsed = await parseApiResponse(res);
    if (parsed.status === 401) {
      handleSessionExpired(parsed.data);
      return false;
    }
    if (!parsed.ok) {
      setEditShopStatus(parsed.data?.message || "Could not upload profile photo.", true);
      return false;
    }
    const avatarUrl = parsed.data?.avatarUrl || parsed.data?.shop?.avatarUrl || "";
    if (el("edit-shop-avatar")) el("edit-shop-avatar").value = avatarUrl;
    updateShopAvatarPreview(avatarUrl);
    shopAvatarPendingFile = null;
    if (el("edit-shop-avatar-file")) el("edit-shop-avatar-file").value = "";
    return true;
  } catch {
    setEditShopStatus("Network error uploading profile photo.", true);
    return false;
  }
}

function bindShopAvatarUi() {
  el("edit-shop-avatar-file")?.addEventListener("change", (ev) => {
    const file = ev.target?.files?.[0];
    if (!file) return;
    shopAvatarPendingFile = file;
    const url = URL.createObjectURL(file);
    updateShopAvatarPreview(url);
    setEditShopStatus("Photo ready — tap Save shop profile to upload.");
  });
  el("edit-shop-avatar")?.addEventListener("change", () => {
    updateShopAvatarPreview(el("edit-shop-avatar")?.value || "");
  });
}

function formatActivityTime(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("en-KE", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function activityEventRow(event) {
  const actorName = escapeHtml(event?.actor?.shopName || "Someone");
  const handle = normalizeHandleForLookup(event?.actor?.handle || "");
  const handleLabel = handle ? `@${escapeHtml(handle)}` : "";
  const when = escapeHtml(formatActivityTime(event?.createdAt));
  const kind = event?.type === "like" ? "like" : event?.type === "follow" ? "follow" : "other";
  let text = "";
  if (kind === "follow") {
    text = `<strong class="text-white">${actorName}</strong> <span class="text-zinc-400">${handleLabel}</span> followed your shop`;
  } else if (kind === "like") {
    const title = escapeHtml(event?.product?.title || "your item");
    text = `<strong class="text-white">${actorName}</strong> <span class="text-zinc-400">${handleLabel}</span> liked <em class="text-zinc-200 not-italic font-semibold">${title}</em>`;
  } else {
    text = `<strong class="text-white">${actorName}</strong> interacted with your shop`;
  }
  const pill =
    kind === "like"
      ? `<span class="sell-activity-pill sell-activity-pill--like">Like</span>`
      : kind === "follow"
        ? `<span class="sell-activity-pill sell-activity-pill--follow">Follow</span>`
        : `<span class="sell-activity-pill">Activity</span>`;
  return `
    <article class="sell-activity-row" data-activity-type="${kind}">
      <div class="flex items-start justify-between gap-3">
        <p class="text-sm text-zinc-300 leading-snug">${text}</p>
        ${pill}
      </div>
      <p class="text-[11px] text-zinc-500 mt-1.5 font-mono">${when}</p>
    </article>`;
}

async function loadSellerActivity() {
  const wrap = el("seller-activity");
  if (!wrap) return;
  const phone = apiPhone();
  if (!phone || !getSessionToken()) {
    wrap.innerHTML = `<p class="text-sm text-zinc-500">Sign in to see shop activity.</p>`;
    return;
  }

  wrap.innerHTML = `<p class="text-sm text-zinc-500">Loading activity…</p>`;
  try {
    const params = new URLSearchParams({
      phone: normalizePhoneInput(phone),
      sessionToken: getSessionToken(),
      limit: "30",
    });
    const res = await fetch(`${SOCIAL_API}/activity?${params.toString()}`);
    const parsed = await parseApiResponse(res);
    if (parsed.status === 401) {
      handleSessionExpired(parsed.data);
      return;
    }
    if (!parsed.ok) {
      wrap.innerHTML = `<p class="text-sm text-zinc-500">${escapeHtml(
        parsed.data?.message || "Activity unavailable right now."
      )}</p>`;
      return;
    }
    const events = Array.isArray(parsed.data?.events) ? parsed.data.events : [];
    if (!events.length) {
      wrap.innerHTML = `<p class="text-sm text-zinc-500">No follows or likes yet. Share your shop handle to get started.</p>`;
      return;
    }
    wrap.innerHTML = events.map((event) => activityEventRow(event)).join("");
  } catch {
    wrap.innerHTML = `<p class="text-sm text-red-400">Network error while loading activity.</p>`;
  }
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

function isSellerSessionAuthError(payload) {
  const code = String(payload?.error || "")
    .trim()
    .toLowerCase();
  return code === "session_required" || code === "session_invalid" || code === "session_expired";
}

async function parseApiResponse(res) {
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    if (res.status === 413) {
      return {
        ok: false,
        status: 413,
        data: null,
        message: "Upload too large — use the cleaned CDN preview (re-run clean) or fewer/smaller photos.",
      };
    }
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
  node.classList.toggle("text-emerald-400", !isError && Boolean(msg));
}

function loadSessionFromStorage() {
  try {
    const raw =
      sessionStorage.getItem(VERIFY_TOKEN_KEY) || localStorage.getItem(VERIFY_TOKEN_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    const phone = normalizePhoneInput(getPhone() || parsed.phone || "");
    if (
      parsed.token &&
      Number(parsed.expiresAt) > Date.now() &&
      (!phone || parsed.phone === phone || !parsed.phone)
    ) {
      verificationToken = parsed.token;
      phoneVerified = true;
      if (parsed.phone && !localStorage.getItem(PHONE_KEY)) {
        localStorage.setItem(PHONE_KEY, parsed.phone);
      }
      // Rehydrate both stores so a new inbox tab can read the session.
      const payload = JSON.stringify({
        phone: parsed.phone || phone,
        token: parsed.token,
        expiresAt: parsed.expiresAt,
      });
      sessionStorage.setItem(VERIFY_TOKEN_KEY, payload);
      try {
        localStorage.setItem(VERIFY_TOKEN_KEY, payload);
      } catch {}
      return true;
    }
    sessionStorage.removeItem(VERIFY_TOKEN_KEY);
    try {
      localStorage.removeItem(VERIFY_TOKEN_KEY);
    } catch {}
  } catch {}
  return false;
}

function saveVerificationToken(token, expiresInSec = 1800) {
  verificationToken = token;
  phoneVerified = true;
  const payload = JSON.stringify({
    phone: normalizePhoneInput(getPhone()),
    token,
    expiresAt: Date.now() + expiresInSec * 1000,
  });
  sessionStorage.setItem(VERIFY_TOKEN_KEY, payload);
  try {
    localStorage.setItem(VERIFY_TOKEN_KEY, payload);
  } catch {}
}

function showSignupStep() {
  el("onboard-verify-step")?.classList.add("hidden");
  el("onboard-details-step")?.classList.remove("hidden");
  el("onboard-btn")?.classList.remove("hidden");
  el("onboard-panel")?.classList.remove("hidden");
  el("sell-intro")?.classList.remove("hidden");
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
    const waToken = parsed.data.sessionToken || parsed.data.verificationToken;
    saveVerificationToken(waToken, parsed.data.expiresInSec);
    const digits = normalizePhoneInput(phone);
    if (window.SokoniAccountAuth?.isSignedIn?.() && waToken) {
      try {
        const linked = await window.SokoniAccountAuth.linkWhatsApp({
          phone: digits,
          whatsappSessionToken: waToken,
          role: "seller",
        });
        if (linked.ok) {
          setOnboardStatus(linked.data?.message || "WhatsApp linked to your Sokoni account.");
        }
      } catch {
        /* seller hub still works without email link */
      }
    }
    await routeAfterVerify(digits, parsed.data);
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

async function updateListingPrice(productId, currentSellerNet, currentBuyerTotal, mode = "drop") {
  const phone = apiPhone();
  if (!phone || !productId) return;
  const currentNet = Math.round(Number(currentSellerNet) || 0);
  const currentBuyer = Math.round(Number(currentBuyerTotal) || 0);
  const raising = mode === "raise";
  const actionLabel = raising ? "raise" : "drop";
  const hint =
    currentNet > 0
      ? `Current: you receive KES ${currentNet.toLocaleString()}${
          currentBuyer > 0 ? ` (buyer pays KES ${currentBuyer.toLocaleString()})` : ""
        }.\n\nNew amount you want to receive (KES) — ${actionLabel} price:`
      : `New amount you want to receive (KES) — ${actionLabel} price:`;
  const defaultVal =
    currentNet > 0 ? String(raising ? currentNet + 100 : Math.max(50, currentNet - 100)) : "";
  const raw = window.prompt(hint, defaultVal);
  if (raw == null) return;
  const nextNet = Math.round(Number(String(raw).replace(/[^\d.]/g, "")));
  if (!Number.isFinite(nextNet) || nextNet < 50) {
    setStatus("Enter a valid price you receive (minimum KES 50).", true);
    return;
  }
  if (currentNet > 0 && nextNet === currentNet) {
    setStatus("Price unchanged.");
    return;
  }
  if (raising && currentNet > 0 && nextNet < currentNet) {
    setStatus("Raise price needs a higher amount than the current price. Use Drop price to go lower.", true);
    return;
  }
  if (!raising && currentNet > 0 && nextNet > currentNet) {
    setStatus("Drop price needs a lower amount than the current price. Use Raise price to go higher.", true);
    return;
  }
  setStatus(raising ? "Raising price…" : "Dropping price…");
  try {
    const res = await fetch(`${ONBOARD_API}/price`, {
      method: "POST",
      headers: sellerAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(jsonAuthBody({ phone, productId, sellerNetKes: nextNet })),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      handleSessionExpired(data);
      return;
    }
    if (!res.ok) {
      setStatus(data.message || data.error || "Price update failed.", true);
      return;
    }
    setStatus(data.message || (raising ? "Price raised." : "Price dropped."));
    await loadMyListings();
  } catch {
    setStatus("Network error.", true);
  }
}

/** @deprecated use updateListingPrice(..., "drop") */
async function dropListingPrice(productId, currentSellerNet, currentBuyerTotal) {
  return updateListingPrice(productId, currentSellerNet, currentBuyerTotal, "drop");
}

async function setListingPromo(productId, currentSellerNet, currentBuyerTotal) {
  const phone = apiPhone();
  if (!phone || !productId) return;
  const currentNet = Math.round(Number(currentSellerNet) || 0);
  const currentBuyer = Math.round(Number(currentBuyerTotal) || 0);
  const typeRaw = window.prompt(
    `Promo type for this item only:\n` +
      `• percent — e.g. 15 for 15% off your receive amount\n` +
      `• kes_off — e.g. 100 to take KES 100 off what you receive\n` +
      `• sale_net — e.g. 800 as the promo amount you receive\n\n` +
      `Current: you receive KES ${currentNet.toLocaleString()}${
        currentBuyer ? ` (buyer pays ${formatKes(currentBuyer)})` : ""
      }`,
    "percent"
  );
  if (typeRaw == null) return;
  const type = String(typeRaw).trim().toLowerCase() || "percent";
  const valueRaw = window.prompt(
    type.startsWith("sale")
      ? "Promo amount you receive (KES):"
      : type.includes("kes") || type === "off"
        ? "KES to take off what you receive:"
        : "Percent off (e.g. 15):",
    type.startsWith("sale") ? String(Math.max(50, currentNet - 100)) : type.includes("kes") ? "100" : "15"
  );
  if (valueRaw == null) return;
  const value = Number(String(valueRaw).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(value) || value <= 0) {
    setStatus("Enter a valid promo value.", true);
    return;
  }
  setStatus("Starting promo…");
  try {
    const res = await fetch(`${ONBOARD_API}/promo`, {
      method: "POST",
      headers: sellerAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(jsonAuthBody({ phone, productId, type, value })),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      handleSessionExpired(data);
      return;
    }
    if (!res.ok) {
      setStatus(data.message || data.error || "Could not start promo.", true);
      return;
    }
    setStatus(data.message || "Promo live — site + STK use the promo price.");
    await loadMyListings();
  } catch {
    setStatus("Network error.", true);
  }
}

async function endListingPromo(productId) {
  const phone = apiPhone();
  if (!phone || !productId) return;
  if (!window.confirm("End promo and restore list price on the site?")) return;
  setStatus("Ending promo…");
  try {
    const res = await fetch(`${ONBOARD_API}/promo/end`, {
      method: "POST",
      headers: sellerAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(jsonAuthBody({ phone, productId })),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      handleSessionExpired(data);
      return;
    }
    if (!res.ok) {
      setStatus(data.message || data.error || "Could not end promo.", true);
      return;
    }
    setStatus(data.message || "Promo ended.");
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
    const empty =
      tab === "available"
        ? "No Ready for M-Pesa funds yet. After escrow Release, seller net appears here for withdraw."
        : tab === "pending"
          ? "No pending escrow. Paid orders still held show here until Release."
          : "No parcels in transit right now.";
    node.innerHTML = `<p class="text-brand-purple/50 dark:text-white/50">${empty}</p>`;
    return;
  }

  node.innerHTML = items
    .map((item) => {
      const readyLine = item.readyLabel
        ? `<span class="text-xs text-emerald-400">${escapeHtml(item.readyLabel)}</span>`
        : "";
      const statusLine = item.shipmentStatusLabel
        ? `<span class="text-xs text-zinc-500">${escapeHtml(item.shipmentStatusLabel)}</span>`
        : "";
      const trackLink = item.trackUrl
        ? `<a href="${escapeHtml(item.trackUrl)}" class="text-xs font-semibold text-[#FF2300] hover:underline shrink-0">Track</a>`
        : "";
      return `<div class="flex flex-wrap justify-between gap-2 py-2 border-b border-brand-purple/5 dark:border-white/5">
          <div class="min-w-0">
            <span class="block truncate">${escapeHtml(item.productName || item.orderId)}</span>
            ${item.orderId ? `<span class="text-xs text-zinc-500">${escapeHtml(item.orderId)}</span>` : ""}
            ${readyLine || statusLine}
          </div>
          <div class="text-right shrink-0">
            <span class="font-semibold block">${formatKes(item.amountKes)}</span>
            ${trackLink}
          </div>
        </div>`;
    })
    .join("");
}

function orderPhase(o) {
  if (o?.phase) return o.phase;
  if (o?.received || o?.shipmentStatus === "delivered" || o?.status === "delivered" || o?.buyerConfirmedAt) {
    return "received";
  }
  if (o?.dispatched || o?.sellerDispatchedAt) return "shipped";
  if (o?.paid) return "awaiting_ship";
  return "unpaid";
}

function shipmentBadgeClass(orderOrStatus) {
  const phase =
    typeof orderOrStatus === "string"
      ? orderOrStatus === "delivered"
        ? "received"
        : orderOrStatus === "label_ready" || orderOrStatus === "pending"
          ? "awaiting_ship"
          : "shipped"
      : orderPhase(orderOrStatus);
  if (phase === "awaiting_ship") return "sell-order-badge--action";
  if (phase === "received") return "sell-order-badge--done";
  return "sell-order-badge--transit";
}

function orderPhaseLabel(o) {
  if (o?.phaseLabel) return o.phaseLabel;
  if (o?.shipmentStatusLabel) return o.shipmentStatusLabel;
  const phase = orderPhase(o);
  if (phase === "received") return "Received";
  if (phase === "shipped") return "Shipped";
  if (phase === "awaiting_ship") return "Awaiting ship";
  return "Order";
}

/** Needs seller action (print / drop-off / DISPATCH). */
function hubOrdersAwaitingShip(orders = hubCache.orders) {
  return (orders || []).filter((o) => o?.paid && orderPhase(o) === "awaiting_ship");
}

/** Active fulfillment: awaiting ship + shipped (not yet buyer-confirmed). */
function hubOrdersToShip(orders = hubCache.orders) {
  return (orders || []).filter((o) => {
    if (!o?.paid) return false;
    const phase = orderPhase(o);
    return phase === "awaiting_ship" || phase === "shipped";
  });
}

function hubOrdersReceived(orders = hubCache.orders) {
  return (orders || [])
    .filter((o) => o?.paid && orderPhase(o) === "received")
    .slice(0, 20);
}

function hubGrossSalesKes(orders = hubCache.orders) {
  return (orders || [])
    .filter((o) => o.paid)
    .reduce((sum, o) => sum + Math.round(Number(o.sellerNetKes) || 0), 0);
}

function refreshSellerAnalytics() {
  if (typeof window.SokoniSellerAnalytics?.render !== "function") return;
  window.SokoniSellerAnalytics.render({
    orders: hubCache.orders || [],
    ledger: ledgerData,
  });
}

function renderHubTrendingCarousel() {
  const wrap = el("hub-trending-carousel");
  if (!wrap || wrap.dataset.bound === "1") return;
  wrap.innerHTML = HUB_TRENDING_SEARCHES.map(
    (item) => `
      <button type="button" role="listitem" class="seller-hub-card text-left" data-hub-trend="${escapeHtml(item.tag)}">
        <div class="flex items-center justify-between gap-2 mb-2">
          <span class="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Signal</span>
          <span class="seller-hub-growth">${escapeHtml(item.growth)}</span>
        </div>
        <p class="text-sm font-bold text-zinc-200">#${escapeHtml(item.tag.replace(/\s+/g, ""))}</p>
        <p class="text-[10px] text-zinc-500 mt-1">Tap to create drop with tag</p>
      </button>`
  ).join("");
  wrap.querySelectorAll("[data-hub-trend]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tag = btn.getAttribute("data-hub-trend") || "";
      startDropWithTrendTag(tag);
    });
  });
  wrap.dataset.bound = "1";
}

function renderHubGuidesCarousel() {
  const wrap = el("hub-guides-carousel");
  if (!wrap || wrap.dataset.bound === "1") return;
  wrap.innerHTML = HUB_SELLER_GUIDES.map(
    (g, i) => `
      <button type="button" role="listitem" class="seller-hub-card seller-hub-card--guide text-left" data-hub-guide="${i}">
        <p class="text-sm font-bold text-white">${escapeHtml(g.title)}</p>
        <p class="text-[11px] text-zinc-400 mt-2 leading-snug">${escapeHtml(g.blurb)}</p>
        <p class="text-[10px] font-bold text-[#FF2300] mt-3">Open →</p>
      </button>`
  ).join("");
  wrap.querySelectorAll("[data-hub-guide]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const guide = HUB_SELLER_GUIDES[Number(btn.getAttribute("data-hub-guide"))];
      if (!guide) return;
      if (guide.action === "bulk") {
        showSellerView("tools");
      } else if (guide.action === "orders") {
        el("seller-orders")?.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        showSellerView("listing");
      }
    });
  });
  wrap.dataset.bound = "1";
}

function startDropWithTrendTag(tag) {
  showSellerView("listing");
  const tagsEl = el("draft-tags");
  if (tagsEl && tag) {
    const slug = String(tag)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 24);
    const existing = String(tagsEl.value || "");
    if (slug && !existing.toLowerCase().includes(slug)) {
      tagsEl.value = existing ? `${existing} #${slug}` : `#${slug}`;
    }
  }
  setStatus(tag ? `Started a drop — tagged #${tag.replace(/\s+/g, "")}. Add a cover photo next.` : "");
}

function renderHubDraftsCarousel() {
  const wrap = el("hub-drafts-carousel");
  if (!wrap) return;
  const drafts = hubCache.drafts || [];
  if (!drafts.length) {
    wrap.innerHTML = `
      <button type="button" role="listitem" class="seller-hub-card seller-hub-card--draft text-left" id="hub-empty-draft-cta">
        <p class="text-sm font-bold text-white">No drafts yet</p>
        <p class="text-[11px] text-zinc-400 mt-1">Import a CSV or create a drop — photos come after.</p>
        <p class="text-[10px] font-bold text-[#FF2300] mt-3">+ Create new drop</p>
      </button>`;
    el("hub-empty-draft-cta")?.addEventListener("click", () => showSellerView("listing"));
    return;
  }

  const draftById = new Map();
  wrap.innerHTML = drafts
    .map((item) => {
      const pid = item.productId || item.id;
      draftById.set(String(pid), item);
      const title = escapeHtml(item.draft?.name || pid);
      const img = item.imageUrl || item.images?.[0];
      const imgSrc = listingMediaUrl(img);
      const needsPhoto = !img;
      const price = item.draft?.sellerNetKes ?? item.draft?.sourcePriceKes ?? item.draft?.priceKes;
      return `
        <div role="listitem" class="seller-hub-card seller-hub-card--draft">
          <div class="flex items-start gap-3">
            ${
              imgSrc
                ? `<img src="${escapeHtml(imgSrc)}" alt="" class="seller-hub-thumb" />`
                : `<div class="seller-hub-thumb flex items-center justify-center text-[9px] text-center px-1 text-zinc-500">No photo</div>`
            }
            <div class="min-w-0 flex-1">
              <p class="text-xs font-bold truncate text-zinc-200">${title}</p>
              <p class="text-[10px] font-mono text-zinc-500 mt-0.5">${escapeHtml(pid)}${price ? ` · ${formatKes(price)}` : ""}</p>
              <p class="text-[10px] mt-1 ${needsPhoto ? "text-zinc-400" : "text-emerald-400"}">${needsPhoto ? "Add photos" : "Ready to review"}</p>
            </div>
          </div>
          <button type="button" class="mt-1 text-[11px] font-bold text-[#FF2300] hover:underline hub-continue-draft" data-id="${escapeHtml(pid)}">
            ${needsPhoto ? "+ Add photos" : "Continue editing"}
          </button>
        </div>`;
    })
    .join("");

  wrap.querySelectorAll(".hub-continue-draft").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = draftById.get(String(btn.dataset.id || ""));
      if (item) void openDraftForEdit(item);
    });
  });
}

function updateSellerHubNavIdentity() {
  const handle = String(sellerProfile?.shopHandle || sellerProfile?.handle || "").replace(/^@+/, "");
  const name =
    sellerProfile?.businessName ||
    sellerProfile?.shopName ||
    (handle ? `@${handle}` : "Your shop");
  const initials = String(name)
    .replace(/^@/, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("") || "S";

  if (el("hub-nav-shop-name")) el("hub-nav-shop-name").textContent = name;
  if (el("hub-nav-avatar")) el("hub-nav-avatar").textContent = initials;
  if (el("hub-nav-shop-url")) {
    el("hub-nav-shop-url").textContent = handle
      ? `sokonimall.com/shop/${handle}`
      : "sokonimall.com/shop/…";
  }
  const storefront = el("hub-nav-storefront");
  if (storefront) {
    if (handle) {
      storefront.href = `../shop.html?handle=${encodeURIComponent(handle)}`;
      storefront.classList.remove("hidden");
    } else {
      storefront.classList.add("hidden");
    }
  }
  const verified = el("hub-nav-verified");
  if (verified) {
    const ok = sellerProfile?.isSellerVerified !== false && Boolean(sellerProfile);
    verified.classList.toggle("hidden", !ok);
  }
}

function isSellerHubDrawerOpen() {
  const root = el("seller-hub-drawer-root");
  return Boolean(root && !root.hasAttribute("hidden"));
}

function setSellerHubDrawerOpen(open) {
  const root = el("seller-hub-drawer-root");
  const btn = el("seller-hub-menu-btn");
  if (!root) return;
  if (open) {
    root.hidden = false;
    // Next frame so CSS can animate from closed → open.
    requestAnimationFrame(() => root.classList.add("is-open"));
    btn?.setAttribute("aria-expanded", "true");
    btn?.setAttribute("aria-label", "Close seller menu");
    document.body.classList.add("seller-hub-drawer-open");
    el("seller-hub-drawer-close")?.focus({ preventScroll: true });
  } else {
    root.classList.remove("is-open");
    btn?.setAttribute("aria-expanded", "false");
    btn?.setAttribute("aria-label", "Open seller menu");
    document.body.classList.remove("seller-hub-drawer-open");
    window.setTimeout(() => {
      if (!root.classList.contains("is-open")) root.hidden = true;
    }, 220);
  }
}

function toggleSellerHubDrawer() {
  setSellerHubDrawerOpen(!isSellerHubDrawerOpen());
}

function renderSellerHubOverview() {
  const handle = String(sellerProfile?.shopHandle || sellerProfile?.handle || "").replace(/^@+/, "");
  if (el("hub-shop-handle")) {
    el("hub-shop-handle").textContent = handle ? `@${handle}` : "@yourshop";
  }
  updateSellerHubNavIdentity();

  const awaitingShip = hubOrdersAwaitingShip();
  const activeFulfillment = hubOrdersToShip();
  const gross = hubGrossSalesKes();
  const live = hubCache.liveCount || 0;
  const drafts = hubCache.draftCount || 0;
  const escrow = ledgerData?.available?.totalKes || 0;

  if (el("hub-stat-gross")) el("hub-stat-gross").textContent = formatKes(gross);
  if (el("hub-stat-orders")) el("hub-stat-orders").textContent = String(awaitingShip.length);
  if (el("hub-stat-live")) el("hub-stat-live").textContent = String(live);
  if (el("hub-stat-drafts-meta")) {
    el("hub-stat-drafts-meta").textContent = `Drafts pending: ${drafts}`;
  }
  if (el("hub-stat-escrow")) el("hub-stat-escrow").textContent = formatKes(escrow);

  const goal = 20;
  const progress = Math.min(goal, live);
  const pct = Math.round((progress / goal) * 100);
  if (el("hub-level-label")) el("hub-level-label").textContent = `${progress} / ${goal} live`;
  if (el("hub-level-bar")) el("hub-level-bar").style.width = `${pct}%`;
  if (el("hub-level-bar-wrap")) el("hub-level-bar-wrap").setAttribute("aria-valuenow", String(progress));

  const checklist = el("hub-level-checklist");
  if (checklist) {
    const items = checklist.querySelectorAll("li");
    items[0]?.classList.toggle("seller-hub-level-done", live >= goal);
    items[1]?.classList.toggle(
      "seller-hub-level-done",
      activeFulfillment.length === 0 && hubCache.orders.some((o) => o.paid)
    );
    // Ratings: soft milestone when they have live listings (full ratings API later)
    items[2]?.classList.toggle("seller-hub-level-done", live >= 5);
  }

  renderHubTrendingCarousel();
  renderHubGuidesCarousel();
  renderHubDraftsCarousel();
}

function bindSellerHubUi() {
  el("hub-bulk-studio-btn")?.addEventListener("click", () => showSellerView("tools"));
  el("hub-create-drop-btn")?.addEventListener("click", () => showSellerView("listing"));
  el("hub-view-all-drafts-btn")?.addEventListener("click", () => {
    showSellerView("listings");
    el("section-my-listings")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  el("seller-hub-menu-btn")?.addEventListener("click", () => toggleSellerHubDrawer());
  el("seller-hub-drawer-close")?.addEventListener("click", () => setSellerHubDrawerOpen(false));
  el("seller-hub-drawer-backdrop")?.addEventListener("click", () => setSellerHubDrawerOpen(false));
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && isSellerHubDrawerOpen()) {
      setSellerHubDrawerOpen(false);
    }
  });
  document.querySelectorAll("[data-hub-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showSellerView(btn.dataset.hubNav || "overview", {
        anchor: btn.dataset.hubAnchor || "",
      });
      setSellerHubDrawerOpen(false);
    });
  });
  document.querySelectorAll("[data-hub-jump]").forEach((btn) => {
    btn.addEventListener("click", () =>
      showSellerView(btn.dataset.hubJump || "overview", {
        anchor: btn.dataset.hubAnchor || "",
      })
    );
  });
  renderHubTrendingCarousel();
  renderHubGuidesCarousel();
  renderSellerHubOverview();
}

function renderSellerOrderCard(o, { allowPrintLabel = true } = {}) {
  const phase = orderPhase(o);
  const actions = [];
  if (allowPrintLabel && phase === "awaiting_ship" && o.needsDropOff && o.labelUrl) {
    actions.push(
      `<a href="${o.labelUrl}" target="_blank" rel="noopener" class="sell-order-action sell-order-action--primary">Print label</a>`
    );
  }
  if (phase === "shipped" && o.trackUrl) {
    actions.push(`<a href="${o.trackUrl}" class="sell-order-action">Track shipment</a>`);
  }
  if (phase === "received" && o.trackUrl) {
    actions.push(`<a href="${o.trackUrl}" class="sell-order-action">View tracking</a>`);
  }
  const hint =
    phase === "shipped"
      ? "Waiting for buyer to reply YES on WhatsApp"
      : phase === "received"
        ? "Buyer confirmed — marked received"
        : "Print label, drop off, then DISPATCH on WhatsApp";
  return `
    <div class="sell-order-card sell-order-card--static" role="listitem" data-order-phase="${escapeHtml(phase)}">
      <div class="sell-order-card-head">
        <p class="font-semibold text-sm sell-order-card__title">${escapeHtml(o.productName || "Order")}</p>
        <span class="sell-order-badge ${shipmentBadgeClass(o)}">${escapeHtml(orderPhaseLabel(o))}</span>
      </div>
      <p class="text-xs text-zinc-500 mt-1 sell-order-card__meta"><span class="font-mono">${escapeHtml(o.orderId || "")}</span> · You receive ${formatKes(o.sellerNetKes)}</p>
      <p class="text-xs text-zinc-500 mt-1">${escapeHtml(hint)}</p>
      ${actions.length ? `<div class="sell-order-actions">${actions.join("")}</div>` : ""}
    </div>`;
}

function renderSellerOrders(orders) {
  const wrap = el("seller-orders");
  const receivedWrap = el("seller-orders-received");
  if (!wrap) return;
  hubCache.orders = Array.isArray(orders) ? orders : [];
  renderSellerHubOverview();
  refreshSellerAnalytics();
  renderHubLogistics();
  renderHubMarketing();

  const active = hubOrdersToShip(hubCache.orders);
  const received = hubOrdersReceived(hubCache.orders);

  if (!active.length) {
    wrap.innerHTML = `<p class="text-sm text-zinc-500">No orders waiting to ship — paid sales show here until the buyer confirms receipt.</p>`;
  } else {
    wrap.innerHTML = active.map((o) => renderSellerOrderCard(o)).join("");
  }

  if (receivedWrap) {
    if (!received.length) {
      receivedWrap.innerHTML = `<p class="text-sm text-zinc-500">When a buyer confirms with YES on WhatsApp, the order moves here as Received.</p>`;
    } else {
      receivedWrap.innerHTML = received
        .map((o) => renderSellerOrderCard(o, { allowPrintLabel: false }))
        .join("");
    }
  }
}

function setBuyerReviewStatus(message, isError = false) {
  const node = el("seller-buyer-reviews-status");
  if (!node) return;
  node.textContent = message || "";
  node.classList.toggle("text-red-600", isError);
  node.classList.toggle("dark:text-red-400", isError);
  node.classList.toggle("text-emerald-400", !isError && Boolean(message));
}

function setSellerDisputesStatus(message, isError = false) {
  const node = el("seller-disputes-status");
  if (!node) return;
  node.textContent = message || "";
  node.classList.toggle("text-red-600", isError);
  node.classList.toggle("dark:text-red-400", isError);
  node.classList.toggle("text-emerald-400", !isError && Boolean(message));
}

async function loadSellerBuyerReviews() {
  const wrap = el("seller-buyer-reviews");
  if (!wrap) return;
  const phone = apiPhone();
  if (!phone || !getSessionToken()) {
    wrap.innerHTML = `<p class="text-sm text-zinc-500">Sign in to rate buyers after delivery.</p>`;
    return;
  }
  wrap.innerHTML = `<p class="text-sm text-zinc-500">Loading…</p>`;
  try {
    const params = new URLSearchParams({ phone, sessionToken: getSessionToken() });
    const res = await fetch(`${SOCIAL_API}/reviews/reviewable-buyers?${params.toString()}`, {
      headers: { ...sellerAuthHeaders() },
    });
    const parsed = await parseApiResponse(res);
    if (parsed.status === 401) {
      handleSessionExpired(parsed.data);
      return;
    }
    if (!parsed.ok) {
      wrap.innerHTML = `<p class="text-sm text-zinc-500">${escapeHtml(parsed.data?.message || "Could not load buyers.")}</p>`;
      return;
    }
    const orders = Array.isArray(parsed.data?.orders) ? parsed.data.orders : [];
    if (!orders.length) {
      wrap.innerHTML = `<p class="text-sm text-zinc-500">No delivered orders waiting for a buyer rating.</p>`;
      return;
    }
    wrap.innerHTML = orders
      .map(
        (o) => `
      <form class="sell-order-card space-y-2" data-rate-buyer="${escapeHtml(o.orderId)}" data-buyer-id="${escapeHtml(String(o.buyerUserId))}">
        <p class="font-semibold text-sm">${escapeHtml(o.productName || o.orderId)}</p>
        <p class="text-xs text-zinc-500">${escapeHtml(o.orderId)} · buyer #${escapeHtml(String(o.buyerUserId))}</p>
        <label class="block text-xs font-medium">Stars
          <select name="rating" class="sell-form-input mt-1">
            <option value="5">5 — Great</option>
            <option value="4">4</option>
            <option value="3">3</option>
            <option value="2">2</option>
            <option value="1">1</option>
          </select>
        </label>
        <label class="block text-xs font-medium">Note (optional)
          <input name="comment" maxlength="500" class="sell-form-input mt-1" placeholder="Paid fast, clear chat…" />
        </label>
        <button type="submit" class="depop-btn-accent text-xs">Submit rating</button>
      </form>`
      )
      .join("");
    wrap.querySelectorAll("form[data-rate-buyer]").forEach((form) => {
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const orderId = form.getAttribute("data-rate-buyer");
        const buyerUserId = Number(form.getAttribute("data-buyer-id"));
        const fd = new FormData(form);
        setBuyerReviewStatus("Saving…");
        try {
          const res = await fetch(`${SOCIAL_API}/reviews/create`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...sellerAuthHeaders() },
            body: JSON.stringify(
              jsonAuthBody({
                phone,
                direction: "seller_to_buyer",
                orderId,
                buyerUserId,
                rating: Number(fd.get("rating") || 5),
                comment: String(fd.get("comment") || ""),
              })
            ),
          });
          const parsed = await parseApiResponse(res);
          if (!parsed.ok) {
            setBuyerReviewStatus(parsed.data?.message || "Could not save rating.", true);
            return;
          }
          setBuyerReviewStatus("Buyer rated — thanks.");
          void loadSellerBuyerReviews();
        } catch {
          setBuyerReviewStatus("Network error.", true);
        }
      });
    });
  } catch {
    wrap.innerHTML = `<p class="text-sm text-red-600">Network error.</p>`;
  }
}

async function loadSellerDisputes() {
  const wrap = el("seller-disputes");
  if (!wrap) return;
  const phone = apiPhone();
  if (!phone || !getSessionToken()) {
    wrap.innerHTML = `<p class="text-sm text-zinc-500">Sign in to see disputes.</p>`;
    return;
  }
  wrap.innerHTML = `<p class="text-sm text-zinc-500">Loading…</p>`;
  const DISPUTES_API = `${API_BASE}/api/disputes`;
  try {
    const params = new URLSearchParams({ phone, sessionToken: getSessionToken() });
    const res = await fetch(`${DISPUTES_API}/seller?${params.toString()}`, {
      headers: { ...sellerAuthHeaders() },
    });
    const parsed = await parseApiResponse(res);
    if (parsed.status === 401) {
      handleSessionExpired(parsed.data);
      return;
    }
    if (!parsed.ok) {
      wrap.innerHTML = `<p class="text-sm text-zinc-500">${escapeHtml(parsed.data?.message || "Could not load disputes.")}</p>`;
      return;
    }
    const disputes = Array.isArray(parsed.data?.disputes) ? parsed.data.disputes : [];
    if (!disputes.length) {
      wrap.innerHTML = `<p class="text-sm text-zinc-500">No open disputes. If a buyer opens one, it shows here.</p>`;
      return;
    }
    wrap.innerHTML = disputes
      .map((d) => {
        const open = d.status === "open" || d.status === "under_review";
        const badgeClass =
          d.status === "under_review" || d.status === "open"
            ? "dispute-badge dispute-badge--review"
            : String(d.status || "").startsWith("resolved")
              ? "dispute-badge dispute-badge--resolved"
              : "dispute-badge dispute-badge--action";
        return `
        <div class="sell-order-card space-y-2" data-dispute-id="${escapeHtml(String(d.id))}">
          <div class="flex justify-between gap-2 items-start">
            <div>
              <p class="font-semibold text-sm font-mono">${escapeHtml(d.orderRef)}</p>
              <p class="text-[10px] text-zinc-500 mt-0.5">Ticket #TK-${escapeHtml(String(d.id))}</p>
            </div>
            <span class="${badgeClass}">${escapeHtml(d.status)}</span>
          </div>
          <p class="text-xs text-zinc-400">${escapeHtml(d.reason)}${d.buyerStatement ? ` — ${escapeHtml(d.buyerStatement)}` : ""}</p>
          ${
            open
              ? `<label class="block text-xs font-medium">Your response
                  <textarea data-dispute-response rows="2" maxlength="2000" class="sell-form-input mt-1" placeholder="Facts + photos help admin decide.">${escapeHtml(d.sellerResponse || "")}</textarea>
                </label>
                <button type="button" data-dispute-respond class="min-h-[44px] px-4 rounded-full border border-brand-purple/20 text-xs font-semibold">Send response</button>`
              : d.sellerResponse
                ? `<p class="text-xs">Your response: ${escapeHtml(d.sellerResponse)}</p>`
                : ""
          }
        </div>`;
      })
      .join("");
    wrap.querySelectorAll("[data-dispute-respond]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest("[data-dispute-id]");
        const id = card?.getAttribute("data-dispute-id");
        const response = card?.querySelector("[data-dispute-response]")?.value || "";
        setSellerDisputesStatus("Sending…");
        try {
          const res = await fetch(`${DISPUTES_API}/${encodeURIComponent(id)}/seller-response`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...sellerAuthHeaders() },
            body: JSON.stringify(jsonAuthBody({ phone, response })),
          });
          const parsed = await parseApiResponse(res);
          if (!parsed.ok) {
            setSellerDisputesStatus(parsed.data?.message || "Could not send response.", true);
            return;
          }
          setSellerDisputesStatus("Response saved for admin review.");
          void loadSellerDisputes();
        } catch {
          setSellerDisputesStatus("Network error.", true);
        }
      });
    });
  } catch {
    wrap.innerHTML = `<p class="text-sm text-red-600">Network error.</p>`;
  }
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
  node.classList.toggle("text-emerald-400", !isError && Boolean(message));
}

function setNavBadge(node, count, labelSingular, labelPlural) {
  if (!node) return;
  const n = Math.max(0, Number(count) || 0);
  if (!n) {
    node.textContent = "";
    node.classList.add("hidden");
    node.removeAttribute("aria-label");
    return;
  }
  node.textContent = n > 99 ? "99+" : String(n);
  node.classList.remove("hidden");
  node.setAttribute("aria-label", `${n} ${n === 1 ? labelSingular : labelPlural}`);
}

function setDashboardOfferBadge(pendingCount = 0) {
  const offerCount = Math.max(0, Number(pendingCount) || 0);
  const awaitingShip = hubOrdersAwaitingShip().length;

  // Top Menu button + Orders drawer row: orders awaiting ship
  setNavBadge(el("nav-badge-orders"), awaitingShip, "order to ship", "orders to ship");
  setNavBadge(el("nav-badge-orders-menu"), awaitingShip, "order to ship", "orders to ship");
  // Offers drawer row: pending offers only
  setNavBadge(el("tab-dashboard-offers-badge"), offerCount, "pending offer", "pending offers");
}

function normalizeOfferFilter(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return SELLER_OFFER_FILTERS.has(normalized) ? normalized : "pending";
}

function offerFilterStorageKeyForCurrentSeller() {
  const sellerPhone = normalizePhoneInput(sellerProfile?.phone || apiPhone() || "");
  return sellerPhone ? `${OFFER_FILTER_PREFERENCE_KEY}:${sellerPhone}` : `${OFFER_FILTER_PREFERENCE_KEY}:default`;
}

function loadActiveOfferFilterPreference() {
  offerFilterStorageKey = offerFilterStorageKeyForCurrentSeller();
  activeSellerOffersFilter = "pending";
  try {
    const saved = sessionStorage.getItem(offerFilterStorageKey);
    if (!saved) return;
    activeSellerOffersFilter = normalizeOfferFilter(saved);
  } catch {}
}

function saveActiveOfferFilterPreference() {
  if (!offerFilterStorageKey) {
    offerFilterStorageKey = offerFilterStorageKeyForCurrentSeller();
  }
  if (!offerFilterStorageKey) return;
  const normalized = normalizeOfferFilter(activeSellerOffersFilter);
  try {
    if (normalized === "pending") {
      sessionStorage.removeItem(offerFilterStorageKey);
      return;
    }
    sessionStorage.setItem(offerFilterStorageKey, normalized);
  } catch {}
}

function clearActiveOfferFilterPreference() {
  const key = offerFilterStorageKey || offerFilterStorageKeyForCurrentSeller();
  try {
    if (key) sessionStorage.removeItem(key);
  } catch {}
  offerFilterStorageKey = null;
  activeSellerOffersFilter = "pending";
}

function syncOfferFilterButtons() {
  const buttons = document.querySelectorAll("[data-offer-filter]");
  buttons.forEach((button) => {
    const filter = normalizeOfferFilter(button.dataset.offerFilter);
    const label = String(button.dataset.filterLabel || "")
      .trim()
      .replace(/\s+/g, " ");
    const safeLabel = label || offerFilterLabel(filter);
    const count = filteredOffers(sellerOffersCache, filter).length;
    const countLabel = count.toLocaleString();
    const labelNode = button.querySelector(".sell-offer-filter-label");
    const countNode = button.querySelector(".sell-offer-filter-count");
    if (labelNode) labelNode.textContent = safeLabel;
    if (countNode) {
      countNode.textContent = countLabel;
    } else {
      button.textContent = `${safeLabel} (${countLabel})`;
    }
    const active = filter === activeSellerOffersFilter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.setAttribute("aria-label", `${safeLabel} ${offerCountLabel(count, "offer")}`);
  });
}

function filteredOffers(offers = [], filter = activeSellerOffersFilter) {
  const normalized = normalizeOfferFilter(filter);
  if (normalized === "all") return offers;
  if (normalized === "expiring-soon") {
    const nowMs = Date.now();
    return offers.filter((offer) => isAcceptedOfferExpiringSoon(offer, nowMs));
  }
  if (normalized === "cooling-down") {
    return offers.filter((offer) => {
      const status = String(offer?.status || "")
        .trim()
        .toLowerCase();
      const id = Number(offer?.id);
      return status === "accepted" && Number.isInteger(id) && id > 0 && reminderCooldownMsLeftForOffer(id) > 0;
    });
  }
  if (normalized === "ready-reminder") {
    const sellerUserId = currentSellerSocialUserId();
    return offers.filter((offer) => {
      const status = String(offer?.status || "")
        .trim()
        .toLowerCase();
      const id = Number(offer?.id);
      const buyerUserId = offerBuyerUserId(offer);
      const canChat =
        Number.isInteger(sellerUserId) &&
        sellerUserId > 0 &&
        Number.isInteger(buyerUserId) &&
        buyerUserId > 0 &&
        sellerUserId !== buyerUserId;
      return status === "accepted" && Number.isInteger(id) && id > 0 && canChat && reminderCooldownMsLeftForOffer(id) <= 0;
    });
  }
  if (normalized === "chat-blocked") {
    const chatReadyIds = new Set(
      acceptedOffersEligibleForChat(offers)
        .map((offer) => Number(offer?.id))
        .filter((id) => Number.isInteger(id) && id > 0)
    );
    return offers.filter((offer) => {
      const status = String(offer?.status || "")
        .trim()
        .toLowerCase();
      const id = Number(offer?.id);
      return status === "accepted" && Number.isInteger(id) && id > 0 && !chatReadyIds.has(id);
    });
  }
  if (normalized === "reminded") {
    return offers.filter((offer) => {
      const status = String(offer?.status || "")
        .trim()
        .toLowerCase();
      const id = Number(offer?.id);
      return status === "accepted" && Number.isInteger(id) && id > 0 && Boolean(reminderLastSentAtForOffer(id));
    });
  }
  if (normalized === "not-reminded") {
    return offers.filter((offer) => {
      const status = String(offer?.status || "")
        .trim()
        .toLowerCase();
      const id = Number(offer?.id);
      return status === "accepted" && Number.isInteger(id) && id > 0 && !reminderLastSentAtForOffer(id);
    });
  }
  if (normalized === "handled") {
    return offers.filter((offer) => {
      const status = String(offer?.status || "")
        .trim()
        .toLowerCase();
      const id = Number(offer?.id);
      return status === "accepted" && Number.isInteger(id) && id > 0 && isAcceptedOfferHandled(id);
    });
  }
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
  handledOfferHistory = [];
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
  handledOfferHistory = [];
  handledOffersStorageKey = null;
}

function reminderCooldownStorageKeyForCurrentSeller() {
  const sellerPhone = normalizePhoneInput(sellerProfile?.phone || apiPhone() || "");
  return sellerPhone ? `${OFFER_REMINDER_COOLDOWN_KEY}:${sellerPhone}` : `${OFFER_REMINDER_COOLDOWN_KEY}:default`;
}

function loadReminderCooldowns() {
  reminderCooldownStorageKey = reminderCooldownStorageKeyForCurrentSeller();
  reminderCooldownByOfferId = new Map();
  const nowMs = Date.now();
  try {
    const raw = sessionStorage.getItem(reminderCooldownStorageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    parsed.forEach((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) return;
      const offerId = Number(entry[0]);
      const expiresAt = Number(entry[1]);
      if (!Number.isInteger(offerId) || offerId < 1) return;
      if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return;
      reminderCooldownByOfferId.set(offerId, expiresAt);
    });
  } catch {}
}

function saveReminderCooldowns() {
  if (!reminderCooldownStorageKey) {
    reminderCooldownStorageKey = reminderCooldownStorageKeyForCurrentSeller();
  }
  if (!reminderCooldownStorageKey) return;
  try {
    const nowMs = Date.now();
    const entries = Array.from(reminderCooldownByOfferId.entries())
      .map(([offerId, expiresAt]) => [Number(offerId), Number(expiresAt)])
      .filter(([offerId, expiresAt]) => Number.isInteger(offerId) && offerId > 0 && Number.isFinite(expiresAt) && expiresAt > nowMs)
      .sort((a, b) => a[0] - b[0]);
    if (!entries.length) {
      sessionStorage.removeItem(reminderCooldownStorageKey);
      return;
    }
    sessionStorage.setItem(reminderCooldownStorageKey, JSON.stringify(entries));
  } catch {}
}

function clearReminderCooldownsStorage() {
  try {
    if (reminderCooldownStorageKey) sessionStorage.removeItem(reminderCooldownStorageKey);
  } catch {}
  reminderCooldownByOfferId = new Map();
  reminderCooldownStorageKey = null;
}

function reminderLastSentStorageKeyForCurrentSeller() {
  const sellerPhone = normalizePhoneInput(sellerProfile?.phone || apiPhone() || "");
  return sellerPhone ? `${OFFER_REMINDER_SENT_AT_KEY}:${sellerPhone}` : `${OFFER_REMINDER_SENT_AT_KEY}:default`;
}

function loadReminderLastSentAt() {
  reminderLastSentStorageKey = reminderLastSentStorageKeyForCurrentSeller();
  reminderLastSentAtByOfferId = new Map();
  try {
    const raw = sessionStorage.getItem(reminderLastSentStorageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    parsed.forEach((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) return;
      const offerId = Number(entry[0]);
      const sentAt = Number(entry[1]);
      if (!Number.isInteger(offerId) || offerId < 1) return;
      if (!Number.isFinite(sentAt) || sentAt < 1) return;
      reminderLastSentAtByOfferId.set(offerId, sentAt);
    });
  } catch {}
}

function saveReminderLastSentAt() {
  if (!reminderLastSentStorageKey) {
    reminderLastSentStorageKey = reminderLastSentStorageKeyForCurrentSeller();
  }
  if (!reminderLastSentStorageKey) return;
  try {
    const entries = Array.from(reminderLastSentAtByOfferId.entries())
      .map(([offerId, sentAt]) => [Number(offerId), Number(sentAt)])
      .filter(([offerId, sentAt]) => Number.isInteger(offerId) && offerId > 0 && Number.isFinite(sentAt) && sentAt > 0)
      .sort((a, b) => a[0] - b[0]);
    if (!entries.length) {
      sessionStorage.removeItem(reminderLastSentStorageKey);
      return;
    }
    sessionStorage.setItem(reminderLastSentStorageKey, JSON.stringify(entries));
  } catch {}
}

function clearReminderLastSentAtStorage() {
  try {
    if (reminderLastSentStorageKey) sessionStorage.removeItem(reminderLastSentStorageKey);
  } catch {}
  reminderLastSentAtByOfferId = new Map();
  reminderLastSentStorageKey = null;
}

function updateHandledResetButton() {
  const button = el("offers-reset-handled-btn");
  if (!button) return;
  const hasHandled = handledAcceptedOfferIds.size > 0;
  button.classList.toggle("hidden", !hasHandled);
  button.disabled = !hasHandled;
}

function rememberHandledOfferHistory(offerId) {
  const id = Number(offerId);
  if (!Number.isInteger(id) || id < 1) return;
  handledOfferHistory = handledOfferHistory.filter((entry) => entry !== id);
  handledOfferHistory.push(id);
  if (handledOfferHistory.length > HANDLED_HISTORY_LIMIT) {
    handledOfferHistory = handledOfferHistory.slice(-HANDLED_HISTORY_LIMIT);
  }
}

function removeHandledOfferFromHistory(offerId) {
  const id = Number(offerId);
  if (!Number.isInteger(id) || id < 1) return;
  handledOfferHistory = handledOfferHistory.filter((entry) => entry !== id);
}

function popUndoableHandledOfferId() {
  while (handledOfferHistory.length) {
    const id = Number(handledOfferHistory.pop());
    if (Number.isInteger(id) && id > 0 && handledAcceptedOfferIds.has(id)) {
      return id;
    }
  }
  return null;
}

function latestUndoableHandledOfferId() {
  for (let index = handledOfferHistory.length - 1; index >= 0; index -= 1) {
    const id = Number(handledOfferHistory[index]);
    if (Number.isInteger(id) && id > 0 && handledAcceptedOfferIds.has(id)) {
      return id;
    }
  }
  return null;
}

function updateUndoLastDoneButton() {
  const undoButton = el("offers-undo-handled-btn");
  const reopenButton = el("offers-undo-open-btn");
  const hasUndoable = Number.isInteger(latestUndoableHandledOfferId());
  [undoButton, reopenButton].forEach((button) => {
    if (!button) return;
    button.classList.toggle("hidden", !hasUndoable);
    button.disabled = !hasUndoable;
  });
}

function reminderLastSentAtForOffer(offerId) {
  const id = Number(offerId);
  if (!Number.isInteger(id) || id < 1) return null;
  const sentAt = Number(reminderLastSentAtByOfferId.get(id) || 0);
  return Number.isFinite(sentAt) && sentAt > 0 ? sentAt : null;
}

function setReminderLastSentAtForOffer(offerId, sentAtMs = Date.now()) {
  const id = Number(offerId);
  const sentAt = Number(sentAtMs);
  if (!Number.isInteger(id) || id < 1 || !Number.isFinite(sentAt) || sentAt < 1) return false;
  reminderLastSentAtByOfferId.set(id, sentAt);
  saveReminderLastSentAt();
  return true;
}

function formatReminderLastSentLabel(offerId) {
  const sentAt = reminderLastSentAtForOffer(offerId);
  if (!sentAt) return "";
  const date = new Date(sentAt);
  if (Number.isNaN(date.getTime())) return "";
  const formatted = new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
  return `Last reminder sent ${formatted}.`;
}

function formatReminderCooldown(msLeft) {
  const totalSeconds = Math.max(1, Math.ceil((Number(msLeft) || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (!minutes) return `${totalSeconds}s`;
  if (!seconds) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

function parseApiTimestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const ms = new Date(String(value || "")).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

function reminderCooldownMsLeftForOffer(offerId, nowMs = Date.now()) {
  const id = Number(offerId);
  if (!Number.isInteger(id) || id < 1) return 0;
  const expiresAt = Number(reminderCooldownByOfferId.get(id) || 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
    reminderCooldownByOfferId.delete(id);
    return 0;
  }
  return expiresAt - nowMs;
}

function setReminderCooldownForOffer(offerId, durationMs = OFFER_REMINDER_COOLDOWN_MS) {
  const id = Number(offerId);
  if (!Number.isInteger(id) || id < 1) return 0;
  const cooldownMs = Math.max(1000, Number(durationMs) || OFFER_REMINDER_COOLDOWN_MS);
  const expiresAt = Date.now() + cooldownMs;
  reminderCooldownByOfferId.set(id, expiresAt);
  saveReminderCooldowns();
  return expiresAt;
}

function reconcileReminderCooldowns(offers = sellerOffersCache) {
  const nowMs = Date.now();
  const offerIds = new Set(
    (offers || [])
      .map((offer) => Number(offer?.id))
      .filter((id) => Number.isInteger(id) && id > 0)
  );
  let changed = false;
  Array.from(reminderCooldownByOfferId.entries()).forEach(([rawId, rawExpiresAt]) => {
    const id = Number(rawId);
    const expiresAt = Number(rawExpiresAt);
    if (!offerIds.has(id) || !Number.isFinite(expiresAt) || expiresAt <= nowMs) {
      reminderCooldownByOfferId.delete(id);
      changed = true;
    }
  });
  if (changed) saveReminderCooldowns();
}

function reconcileReminderLastSentAt(offers = sellerOffersCache) {
  const offerIds = new Set(
    (offers || [])
      .map((offer) => Number(offer?.id))
      .filter((id) => Number.isInteger(id) && id > 0)
  );
  let changed = false;
  Array.from(reminderLastSentAtByOfferId.entries()).forEach(([rawId, rawSentAt]) => {
    const id = Number(rawId);
    const sentAt = Number(rawSentAt);
    if (!offerIds.has(id) || !Number.isFinite(sentAt) || sentAt < 1) {
      reminderLastSentAtByOfferId.delete(id);
      changed = true;
    }
  });
  if (changed) saveReminderLastSentAt();
}

function defaultReminderButtonLabel(button) {
  if (button?.classList?.contains("offer-remind-next-btn")) return "Remind + next";
  return "Send reminder";
}

function syncReminderCooldownButton(button, nowMs = Date.now()) {
  if (!button || button.dataset.reminderBusy === "1") return;
  const offerId = Number(button.dataset.offerId);
  const cooldownMsLeft = reminderCooldownMsLeftForOffer(offerId, nowMs);
  if (cooldownMsLeft > 0) {
    button.textContent = `Wait ${formatReminderCooldown(cooldownMsLeft)}`;
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
    return;
  }
  button.textContent = defaultReminderButtonLabel(button);
  button.disabled = false;
  button.removeAttribute("aria-disabled");
}

function syncReminderCooldownButtonsUi(nowMs = Date.now()) {
  const wrap = el("seller-offers");
  if (!wrap) return;
  wrap.querySelectorAll(".offer-reminder-btn, .offer-remind-next-btn").forEach((button) => {
    syncReminderCooldownButton(button, nowMs);
  });
}

function reminderCooldownStats(nowMs = Date.now()) {
  let count = 0;
  let nextMs = 0;
  Array.from(reminderCooldownByOfferId.entries()).forEach(([rawId, rawExpiresAt]) => {
    const id = Number(rawId);
    const expiresAt = Number(rawExpiresAt);
    if (!Number.isInteger(id) || id < 1 || !Number.isFinite(expiresAt) || expiresAt <= nowMs) {
      reminderCooldownByOfferId.delete(id);
      return;
    }
    const msLeft = expiresAt - nowMs;
    count += 1;
    if (!nextMs || msLeft < nextMs) nextMs = msLeft;
  });
  return { count, nextMs };
}

function updateReminderCooldownHint(stats = reminderCooldownStats()) {
  const hint = el("seller-offers-cooldown-hint");
  if (!hint) return;
  const count = Number(stats?.count) || 0;
  const nextMs = Number(stats?.nextMs) || 0;
  if (!count || nextMs <= 0) {
    hint.textContent = "";
    hint.classList.add("hidden");
    return;
  }
  hint.classList.remove("hidden");
  hint.textContent = `${offerCountLabel(count, "reminder")} cooling down · next unlock in ${formatReminderCooldown(nextMs)}.`;
}

function acceptedTriageStats(offers = sellerOffersCache) {
  const sellerUserId = currentSellerSocialUserId();
  let accepted = 0;
  let ready = 0;
  let cooling = 0;
  let blocked = 0;
  let handled = 0;

  (offers || []).forEach((offer) => {
    const status = String(offer?.status || "")
      .trim()
      .toLowerCase();
    if (status !== "accepted") return;

    accepted += 1;
    const id = Number(offer?.id);
    const buyerUserId = offerBuyerUserId(offer);
    const canChat =
      Number.isInteger(id) &&
      id > 0 &&
      Number.isInteger(sellerUserId) &&
      sellerUserId > 0 &&
      Number.isInteger(buyerUserId) &&
      buyerUserId > 0 &&
      sellerUserId !== buyerUserId;

    if (!canChat) {
      blocked += 1;
      return;
    }

    if (isAcceptedOfferHandled(id)) {
      handled += 1;
      return;
    }

    const cooldownMs = reminderCooldownMsLeftForOffer(id);
    if (cooldownMs > 0) {
      cooling += 1;
      return;
    }

    ready += 1;
  });

  return { accepted, ready, cooling, blocked, handled };
}

function updateAcceptedTriageHint(offers = sellerOffersCache) {
  const hint = el("seller-offers-accepted-summary");
  if (!hint) return;
  const stats = acceptedTriageStats(offers);
  if (!stats.accepted) {
    hint.textContent = "";
    hint.classList.add("hidden");
    return;
  }

  hint.classList.remove("hidden");
  hint.textContent = `Accepted triage · ${offerCountLabel(stats.ready, "ready chat")} · ${offerCountLabel(
    stats.cooling,
    "cooling reminder"
  )} · ${offerCountLabel(stats.blocked, "chat blocked")} · ${offerCountLabel(stats.handled, "handled queue")}.`;
}

function offerFilterUsesReminderCooldown(filter = activeSellerOffersFilter) {
  const normalized = normalizeOfferFilter(filter);
  return normalized === "cooling-down" || normalized === "ready-reminder";
}

function stopReminderCooldownTicker() {
  if (reminderCooldownTickTimer) {
    window.clearInterval(reminderCooldownTickTimer);
    reminderCooldownTickTimer = null;
  }
}

function ensureReminderCooldownTicker() {
  const nowMs = Date.now();
  const stats = reminderCooldownStats(nowMs);
  const shouldRun = isSellerDashView(currentSellerView) && stats.count > 0;
  syncReminderCooldownButtonsUi(nowMs);
  updateReminderCooldownHint(stats);
  updateAcceptedTriageHint(sellerOffersCache);
  if (!shouldRun) {
    stopReminderCooldownTicker();
    return;
  }
  if (reminderCooldownTickTimer) return;
  reminderCooldownTickTimer = window.setInterval(() => {
    if (!isSellerDashView(currentSellerView)) {
      stopReminderCooldownTicker();
      return;
    }
    const tickStats = reminderCooldownStats(Date.now());
    syncReminderCooldownButtonsUi();
    updateReminderCooldownHint(tickStats);
    updateAcceptedTriageHint(sellerOffersCache);
    if (offerFilterUsesReminderCooldown(activeSellerOffersFilter)) {
      renderOfferCacheView();
      return;
    }
    syncOfferFilterButtons();
    if (!tickStats.count) stopReminderCooldownTicker();
  }, REMINDER_COOLDOWN_TICK_MS);
}

function isAcceptedOfferHandled(offerOrId) {
  const id = Number(typeof offerOrId === "object" ? offerOrId?.id : offerOrId);
  return Number.isInteger(id) && id > 0 ? handledAcceptedOfferIds.has(id) : false;
}

function setAcceptedOfferHandled(offerId, handled = true, { trackHistory = false } = {}) {
  const id = Number(offerId);
  if (!Number.isInteger(id) || id < 1) return false;
  if (handled) {
    handledAcceptedOfferIds.add(id);
    if (trackHistory) rememberHandledOfferHistory(id);
  } else {
    handledAcceptedOfferIds.delete(id);
    removeHandledOfferFromHistory(id);
  }
  saveHandledAcceptedOffers();
  return true;
}

function parseBooleanFlag(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return null;
}

function normalizedOfferIdList(values = []) {
  const ids = [];
  const seen = new Set();
  (Array.isArray(values) ? values : [values]).forEach((value) => {
    const id = Number(value);
    if (!Number.isInteger(id) || id < 1 || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });
  return ids;
}

async function loadServerHandledOfferState(offerIds = [], sellerUserId = currentSellerSocialUserId()) {
  if (!sellerUserId) {
    return { ok: false, message: "Link your shop handle to your social profile first.", isError: false };
  }
  const ids = normalizedOfferIdList(offerIds);
  const params = new URLSearchParams({
    userId: String(sellerUserId),
  });
  if (ids.length) params.set("offerIds", ids.join(","));
  const phone = apiPhone();
  if (phone) params.set("phone", phone);
  const sessionToken = getSessionToken();
  if (sessionToken) params.set("sessionToken", sessionToken);

  try {
    const res = await fetch(`${SOCIAL_API}/offers/handled?${params.toString()}`);
    const parsed = await parseApiResponse(res);
    if (!parsed.ok) {
      return {
        ok: false,
        message: parsed.data?.message || parsed.message || "Could not sync handled queue.",
        isError: true,
        sessionExpired: parsed.status === 401 && isSellerSessionAuthError(parsed.data),
      };
    }
    const states = Array.isArray(parsed.data?.states) ? parsed.data.states : [];
    const handledIds = new Set();
    states.forEach((state) => {
      const id = Number(state?.offerId);
      const handled = parseBooleanFlag(state?.handled);
      if (Number.isInteger(id) && id > 0 && handled) handledIds.add(id);
    });
    return { ok: true, handledIds };
  } catch {
    return { ok: false, message: "Network error while syncing handled queue.", isError: true };
  }
}

async function syncHandledAcceptedOffersFromServer(offers = sellerOffersCache, sellerUserId = currentSellerSocialUserId()) {
  const eligibleOfferIds = normalizedOfferIdList(
    acceptedOffersEligibleForChat(offers).map((offer) => Number(offer?.id))
  );
  if (!eligibleOfferIds.length) {
    handledAcceptedOfferIds = new Set();
    handledOfferHistory = [];
    saveHandledAcceptedOffers();
    return { ok: true };
  }

  const remote = await loadServerHandledOfferState(eligibleOfferIds, sellerUserId);
  if (!remote.ok) return remote;

  const nextHandled = new Set();
  eligibleOfferIds.forEach((id) => {
    if (remote.handledIds.has(id)) nextHandled.add(id);
  });
  handledAcceptedOfferIds = nextHandled;
  handledOfferHistory = handledOfferHistory.filter((id) => handledAcceptedOfferIds.has(id));
  saveHandledAcceptedOffers();
  return { ok: true };
}

async function setHandledOfferStateOnServer(offerId, handled = true) {
  const id = Number(offerId);
  const sellerUserId = currentSellerSocialUserId();
  if (!Number.isInteger(id) || id < 1 || !sellerUserId) {
    return { ok: false, message: "Could not resolve this handled-offer action.", isError: true };
  }

  try {
    const res = await fetch(`${SOCIAL_API}/offers/${id}/handled`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        jsonAuthBody({
          phone: apiPhone(),
          sellerUserId,
          handled: Boolean(handled),
        })
      ),
    });
    const parsed = await parseApiResponse(res);
    if (!parsed.ok) {
      return {
        ok: false,
        message: parsed.data?.message || parsed.message || "Could not update handled queue right now.",
        isError: true,
        sessionExpired: parsed.status === 401 && isSellerSessionAuthError(parsed.data),
      };
    }

    const handledFromApi = parseBooleanFlag(parsed.data?.state?.handled);
    return { ok: true, handled: handledFromApi == null ? Boolean(handled) : handledFromApi };
  } catch {
    return { ok: false, message: "Network error while updating handled queue.", isError: true };
  }
}

async function resetHandledQueueOnServer() {
  const sellerUserId = currentSellerSocialUserId();
  if (!sellerUserId) {
    return { ok: false, message: "Link your shop handle to your social profile first.", isError: false };
  }
  try {
    const res = await fetch(`${SOCIAL_API}/offers/handled/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        jsonAuthBody({
          phone: apiPhone(),
          sellerUserId,
        })
      ),
    });
    const parsed = await parseApiResponse(res);
    if (!parsed.ok) {
      return {
        ok: false,
        message: parsed.data?.message || parsed.message || "Could not reset handled queue right now.",
        isError: true,
        sessionExpired: parsed.status === 401 && isSellerSessionAuthError(parsed.data),
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "Network error while resetting handled queue.", isError: true };
  }
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
      removeHandledOfferFromHistory(id);
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
  updateUndoLastDoneButton();

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
  if (filter === "expiring-soon") return "expiring-soon offer";
  if (filter === "reminded") return "reminded offer";
  if (filter === "cooling-down") return "cooling-down offer";
  if (filter === "ready-reminder") return "ready-to-remind offer";
  if (filter === "chat-blocked") return "chat-blocked offer";
  if (filter === "not-reminded") return "not-reminded offer";
  if (filter === "handled") return "handled offer";
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

function offerExpiryMsLeft(offer, nowMs = Date.now()) {
  const rawExpiry = offer?.expiresAt;
  if (!rawExpiry) return 0;
  const expiryMs = new Date(rawExpiry).getTime();
  if (!Number.isFinite(expiryMs) || Number.isNaN(expiryMs)) return 0;
  return Math.max(0, expiryMs - nowMs);
}

function isAcceptedOfferExpiringSoon(offer, nowMs = Date.now()) {
  const status = String(offer?.status || "")
    .trim()
    .toLowerCase();
  if (status !== "accepted") return false;
  const msLeft = offerExpiryMsLeft(offer, nowMs);
  return msLeft > 0 && msLeft <= OFFER_EXPIRING_SOON_MS;
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

function chatBlockedReasonForOffer(offer, sellerUserId = currentSellerSocialUserId(), buyerUserId = offerBuyerUserId(offer)) {
  const status = String(offer?.status || "")
    .trim()
    .toLowerCase();
  if (status !== "accepted") return "";
  if (!Number.isInteger(sellerUserId) || sellerUserId < 1) {
    return sellerProfile?.shopHandle
      ? "Seller chat profile is still syncing. Tap Refresh and try again shortly."
      : "Add your shop handle to link seller chat, then tap Refresh.";
  }
  if (!Number.isInteger(buyerUserId) || buyerUserId < 1) {
    return "Buyer chat profile is still syncing. Tap Refresh in a moment.";
  }
  if (buyerUserId === sellerUserId) {
    return "Chat is blocked because buyer and seller profile matched. Tap Refresh and try again.";
  }
  return "";
}

function inboxLinkForOffer(offer, sellerUserId, buyerUserId) {
  if (!sellerUserId || !buyerUserId || sellerUserId === buyerUserId) {
    return "../inbox.html";
  }
  const params = new URLSearchParams({
    viewer: String(sellerUserId),
    with: String(buyerUserId),
    sellerAuth: "1",
  });
  const buyerHandle = normalizeHandleForLookup(offer?.buyer?.handle || "");
  if (buyerHandle) params.set("handle", buyerHandle);
  // Pass session into the inbox URL so a new tab (empty sessionStorage) can still auth.
  const phone = apiPhone();
  const sessionToken = getSessionToken();
  if (phone && sessionToken) {
    params.set("phone", phone);
    params.set("sessionToken", sessionToken);
  }
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
    wrap.innerHTML = `<p class="text-sm text-zinc-500">${escapeHtml(emptyMessage)}</p>`;
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
      const breakdown = offer?.breakdown;
      const escrowLine =
        breakdown?.sellerNetKes != null
          ? `<p class="text-xs text-zinc-400 mt-1">Buyer pays ${escapeHtml(formatKes(breakdown.totalKes))} into escrow → you receive <strong>${escapeHtml(formatKes(breakdown.sellerNetKes))}</strong> after delivery (Sokoni fee ${escapeHtml(formatKes(breakdown.platformFeeKes))}). You arrange dispatch.</p>`
          : offer?.breakdownError?.message
            ? `<p class="text-xs text-amber-700 dark:text-amber-300 mt-1">${escapeHtml(offer.breakdownError.message)}</p>`
            : `<p class="text-xs text-zinc-400 dark:text-white/55 mt-1">Offer is buyer all-in (Sokoni fee comes out before your payout). You arrange delivery.</p>`;
      const canRespond = Number.isInteger(id) && id > 0 && status === "pending";
      const sellerUserId = currentSellerSocialUserId();
      const buyerUserId = offerBuyerUserId(offer);
      const canChat =
        Number.isInteger(sellerUserId) &&
        sellerUserId > 0 &&
        Number.isInteger(buyerUserId) &&
        buyerUserId > 0 &&
        sellerUserId !== buyerUserId;
      const chatBlockedReason = status === "accepted" && !canChat ? chatBlockedReasonForOffer(offer, sellerUserId, buyerUserId) : "";
      const canManageQuickQueue = Number.isInteger(id) && id > 0 && status === "accepted" && canChat;
      const handledInQuickQueue = canManageQuickQueue && isAcceptedOfferHandled(id);
      const reminderCooldownMsLeft = canManageQuickQueue ? reminderCooldownMsLeftForOffer(id) : 0;
      const reminderCoolingDown = reminderCooldownMsLeft > 0;
      const reminderDisabledAttr = reminderCoolingDown ? ` disabled aria-disabled="true"` : "";
      const reminderButtonLabel = reminderCoolingDown ? `Wait ${formatReminderCooldown(reminderCooldownMsLeft)}` : "Send reminder";
      const remindNextButtonLabel = reminderCoolingDown ? `Wait ${formatReminderCooldown(reminderCooldownMsLeft)}` : "Remind + next";
      const remindNextButton = canManageQuickQueue && !handledInQuickQueue
        ? `<button type="button" class="sell-offer-action sell-offer-action--remind-next offer-remind-next-btn" data-offer-id="${id}"${reminderDisabledAttr}>
              ${remindNextButtonLabel}
            </button>`
        : "";
      const doneNextButton = canManageQuickQueue && !handledInQuickQueue
        ? `<button type="button" class="sell-offer-action sell-offer-action--done-next offer-done-next-btn" data-offer-id="${id}">
              Done + next chat
            </button>`
        : "";
      const actionBlock = canRespond
        ? `<div class="sell-offer-actions">
            <button type="button" class="sell-offer-action sell-offer-action--accept offer-action-btn" data-offer-id="${id}" data-action="accepted">
              Accept
            </button>
            <button type="button" class="sell-offer-action sell-offer-action--counter offer-action-btn" data-offer-id="${id}" data-action="countered" data-offer-amount="${escapeHtml(String(offer?.amountKsh || ""))}" data-list-price="${escapeHtml(String(Number.isFinite(listed) ? listed : ""))}">
              Counter
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
              <button type="button" class="sell-offer-action sell-offer-action--remind offer-reminder-btn" data-offer-id="${id}"${reminderDisabledAttr}>
                ${reminderButtonLabel}
              </button>
              ${remindNextButton}
              ${doneNextButton}
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
      const reminderSentNote = status === "accepted" ? formatReminderLastSentLabel(id) : "";
      const remindedBadge = reminderSentNote
        ? `<span class="sell-order-badge sell-order-badge--reminded">Reminded</span>`
        : "";
      const handledNote = handledInQuickQueue
        ? `<p class="text-xs text-emerald-400 mt-2">Handled in quick mode queue.</p>`
        : "";
      const chatBlockedNote = chatBlockedReason
        ? `<p class="text-xs text-amber-700 dark:text-amber-300 mt-2">${escapeHtml(chatBlockedReason)}</p>`
        : "";
      return `
        <article class="sell-offer-card sell-order-card" data-offer-row="${Number.isInteger(id) ? id : ""}">
          <div class="sell-order-card-head">
            <p class="font-semibold">${escapeHtml(productTitle)}</p>
            <div class="sell-offer-card-badges">
              <span class="sell-order-badge ${offerStatusBadgeClass(status)}">${escapeHtml(offerStatusLabel(status))}</span>
              ${remindedBadge}
            </div>
          </div>
          <p class="text-xs text-zinc-500 dark:text-white/55 mt-1">${escapeHtml(offerBuyerLabel(offer))}</p>
          <p class="text-sm mt-2"><strong>Buyer total offered:</strong> ${escapeHtml(amount)}${escapeHtml(listedLine)}</p>
          ${escrowLine}
          <p class="text-xs text-zinc-500 dark:text-white/55 mt-1">${escapeHtml(
            formatOfferExpiry(offer?.expiresAt, status)
          )}</p>
          ${reminderSentNote ? `<p class="text-xs text-zinc-500 dark:text-white/55 mt-1">${escapeHtml(reminderSentNote)}</p>` : ""}
          ${chatBlockedNote}
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
  if (filter === "expiring-soon") return "No accepted offers expiring in the next 2 hours.";
  if (filter === "reminded") return "No reminded offers yet.";
  if (filter === "cooling-down") return "No reminder cooldowns running right now.";
  if (filter === "ready-reminder") return "No accepted chats ready for a reminder yet.";
  if (filter === "chat-blocked") return "No accepted offers are blocked from chat right now.";
  if (filter === "not-reminded") return "No accepted offers waiting for a first reminder.";
  if (filter === "handled") return "No handled accepted offers in queue right now.";
  if (filter === "declined") return "No declined offers yet.";
  return "No offers in this view right now.";
}

function renderOfferCacheView() {
  reconcileReminderCooldowns(sellerOffersCache);
  reconcileReminderLastSentAt(sellerOffersCache);
  syncOfferFilterButtons();
  updateAcceptedTriageHint(sellerOffersCache);
  const total = sellerOffersCache.length;
  const pending = pendingOffersCount(sellerOffersCache);
  const visible = filteredOffers(sellerOffersCache, activeSellerOffersFilter);
  renderSellerOffers(visible, emptyOfferMessage(total, activeSellerOffersFilter));
  bindOfferActionButtons();
  updateQuickModeHint();
  ensureReminderCooldownTicker();

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
  saveActiveOfferFilterPreference();
  renderOfferCacheView();
}

async function respondToSellerOffer(button) {
  const offerId = Number(button?.dataset?.offerId);
  const action = String(button?.dataset?.action || "")
    .trim()
    .toLowerCase();
  if (!Number.isInteger(offerId) || offerId < 1) return;
  if (!["accepted", "declined", "countered"].includes(action)) return;

  const sellerUserId = await resolveSellerSocialUserId();
  if (!sellerUserId) {
    setOffersStatus("Link your shop handle to your social profile before responding to offers.", true);
    return;
  }

  let counterAmountKsh = null;
  if (action === "countered") {
    const offer = sellerOffersCache.find((o) => Number(o?.id) === offerId);
    const buyerOffer = Math.round(Number(button?.dataset?.offerAmount || offer?.amountKsh) || 0);
    const listPrice = Math.round(Number(button?.dataset?.listPrice || offer?.product?.priceKsh) || 0);
    const suggested =
      listPrice > buyerOffer + 1
        ? Math.round((buyerOffer + listPrice) / 2)
        : buyerOffer + 100;
    const raw = window.prompt(
      `Counter offer (buyer all-in KES).\nBuyer offered ${buyerOffer > 0 ? formatKes(buyerOffer) : "—"}${
        listPrice > 0 ? ` · Listed ${formatKes(listPrice)}` : ""
      }\nMust be above their offer.`,
      String(suggested)
    );
    if (raw == null) return;
    counterAmountKsh = Math.round(Number(String(raw).replace(/[^\d.]/g, "")));
    if (!Number.isFinite(counterAmountKsh) || counterAmountKsh < 1) {
      setOffersStatus("Enter a valid counter amount in KES.", true);
      return;
    }
    if (buyerOffer > 0 && counterAmountKsh <= buyerOffer) {
      setOffersStatus("Counter must be higher than the buyer's offer. Accept instead if you agree.", true);
      return;
    }
    const ok = window.confirm(
      `Lock counter at ${formatKes(counterAmountKsh)} (buyer total)?\nBuyer can checkout at this price for 24 hours.`
    );
    if (!ok) return;
  } else if (action === "accepted") {
    const offer = sellerOffersCache.find((o) => Number(o?.id) === offerId);
    const b = offer?.breakdown;
    if (b?.sellerNetKes != null) {
      const ok = window.confirm(
        `Buyer pays ${formatKes(b.totalKes)} into escrow.\n` +
          `You receive ${formatKes(b.sellerNetKes)} after delivery` +
          ` (Sokoni fee ${formatKes(b.platformFeeKes)}; you arrange dispatch).\n\nAccept this offer?`
      );
      if (!ok) return;
    } else if (offer?.breakdownError?.message) {
      setOffersStatus(offer.breakdownError.message, true);
      return;
    }
  }

  const row = button.closest("[data-offer-row]");
  row?.querySelectorAll(".offer-action-btn").forEach((node) => {
    node.disabled = true;
  });
  setOffersStatus(
    action === "accepted"
      ? "Accepting offer..."
      : action === "countered"
        ? "Sending counter..."
        : "Declining offer..."
  );

  try {
    const body = {
      phone: apiPhone(),
      sellerUserId,
      action,
    };
    if (action === "countered") body.amountKsh = counterAmountKsh;
    const res = await fetch(`${SOCIAL_API}/offers/${offerId}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jsonAuthBody(body)),
    });
    const parsed = await parseApiResponse(res);
    if (!parsed.ok) {
      if (parsed.status === 401 && isSellerSessionAuthError(parsed.data)) {
        handleSessionExpired(parsed.data);
        return;
      }
      setOffersStatus(parsed.data?.message || parsed.message || "Could not update offer right now.", true);
      row?.querySelectorAll(".offer-action-btn").forEach((node) => {
        node.disabled = false;
      });
      return;
    }
    const net = parsed.data?.breakdown?.sellerNetKes ?? parsed.data?.offer?.breakdown?.sellerNetKes;
    const counterAmt = parsed.data?.offer?.amountKsh;
    setOffersStatus(
      action === "accepted"
        ? net != null
          ? `Offer accepted — you receive ${formatKes(net)} after delivery.`
          : "Offer accepted."
        : action === "countered"
          ? net != null
            ? `Counter locked at ${formatKes(counterAmt)} — you receive ${formatKes(net)} after delivery.`
            : `Counter sent${counterAmt != null ? ` at ${formatKes(counterAmt)}` : ""}.`
          : "Offer declined."
    );
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

async function sendReminderForOffer(offer) {
  const sellerUserId = currentSellerSocialUserId();
  const offerId = Number(offer?.id);
  if (!sellerUserId || !Number.isInteger(offerId) || offerId < 1) {
    return { ok: false, message: "Could not resolve this offer reminder action.", isError: true };
  }
  try {
    const res = await fetch(`${SOCIAL_API}/offers/${offerId}/remind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        jsonAuthBody({
          phone: apiPhone(),
          sellerUserId,
        })
      ),
    });
    const parsed = await parseApiResponse(res);
    if (!parsed.ok) {
      const cooldownActive = parsed.data?.error === "reminder_cooldown_active";
      return {
        ok: false,
        message: parsed.data?.message || parsed.message || "Could not send reminder right now.",
        isError: !cooldownActive,
        sessionExpired: parsed.status === 401 && isSellerSessionAuthError(parsed.data),
        cooldownActive,
        cooldownMs: Number(parsed.data?.cooldownMsRemaining || 0),
        sentAtMs: parseApiTimestampMs(parsed.data?.lastReminderAt),
      };
    }
    const cooldownMs = Math.max(1000, Number(parsed.data?.reminder?.cooldownMs) || OFFER_REMINDER_COOLDOWN_MS);
    const sentAtMs = parseApiTimestampMs(parsed.data?.reminder?.sentAt) || Date.now();
    return { ok: true, cooldownMs, sentAtMs };
  } catch {
    return { ok: false, message: "Network error while sending reminder.", isError: true };
  }
}

async function sendAcceptedOfferReminder(button) {
  const offerId = Number(button?.dataset?.offerId);
  if (!Number.isInteger(offerId) || offerId < 1) return;
  const offer = offerByIdFromCache(offerId);
  if (!offer) {
    setOffersStatus("Offer not found. Refresh and try again.", true);
    return;
  }
  const cooldownMsLeft = reminderCooldownMsLeftForOffer(offerId);
  if (cooldownMsLeft > 0) {
    renderOfferCacheView();
    setOffersStatus(`Reminder already sent. Try again in ${formatReminderCooldown(cooldownMsLeft)}.`);
    return;
  }

  const previousLabel = button.textContent;
  button.dataset.reminderBusy = "1";
  button.disabled = true;
  button.textContent = "Sending...";
  setOffersStatus("Sending reminder...");
  const reminder = await sendReminderForOffer(offer);
  if (!reminder.ok) {
    if (reminder.sessionExpired) {
      handleSessionExpired({ message: reminder.message });
      return;
    }
    if (reminder.cooldownActive) {
      if (Number(reminder.cooldownMs) > 0) {
        setReminderCooldownForOffer(offerId, reminder.cooldownMs);
      }
      if (Number(reminder.sentAtMs) > 0) {
        setReminderLastSentAtForOffer(offerId, reminder.sentAtMs);
      }
      renderOfferCacheView();
    }
    delete button.dataset.reminderBusy;
    setOffersStatus(reminder.message || "Could not send reminder right now.", reminder.isError !== false);
    button.disabled = false;
    button.textContent = previousLabel;
    return;
  }
  delete button.dataset.reminderBusy;
  setReminderCooldownForOffer(offerId, reminder.cooldownMs || OFFER_REMINDER_COOLDOWN_MS);
  setReminderLastSentAtForOffer(offerId, reminder.sentAtMs || Date.now());
  renderOfferCacheView();
  setOffersStatus(
    `Reminder sent in inbox. Next reminder in ${formatReminderCooldown(reminder.cooldownMs || OFFER_REMINDER_COOLDOWN_MS)}.`
  );
}

async function toggleAcceptedOfferHandled(button) {
  const offerId = Number(button?.dataset?.offerId);
  if (!Number.isInteger(offerId) || offerId < 1) return;
  const currentlyHandled = button.dataset.handled === "1" || isAcceptedOfferHandled(offerId);
  const nextHandledState = !currentlyHandled;
  button.disabled = true;
  const remote = await setHandledOfferStateOnServer(offerId, nextHandledState);
  if (remote.sessionExpired) {
    handleSessionExpired({ message: remote.message });
    return;
  }
  if (!remote.ok) {
    button.disabled = false;
    setOffersStatus(remote.message || "Could not update quick queue right now.", remote.isError !== false);
    return;
  }
  if (!setAcceptedOfferHandled(offerId, remote.handled, { trackHistory: Boolean(remote.handled) })) {
    button.disabled = false;
    setOffersStatus("Could not update quick queue right now.", true);
    return;
  }
  acceptedQuickCursor = 0;
  renderOfferCacheView();
  setOffersStatus(remote.handled ? "Offer marked handled in quick queue." : "Offer moved back into quick queue.");
}

async function resetHandledAcceptedOffersQueue() {
  if (!handledAcceptedOfferIds.size) return;
  const remote = await resetHandledQueueOnServer();
  if (remote.sessionExpired) {
    handleSessionExpired({ message: remote.message });
    return;
  }
  if (!remote.ok) {
    setOffersStatus(remote.message || "Could not reset handled queue right now.", remote.isError !== false);
    return;
  }
  handledAcceptedOfferIds = new Set();
  handledOfferHistory = [];
  saveHandledAcceptedOffers();
  acceptedQuickCursor = 0;
  renderOfferCacheView();
  setOffersStatus("Quick queue reset - all accepted chats are active again.");
}

async function restoreLastHandledAcceptedOffer() {
  const offerId = latestUndoableHandledOfferId();
  if (!offerId) return { offerId: null, offer: null };
  const offer = offerByIdFromCache(offerId);
  const remote = await setHandledOfferStateOnServer(offerId, false);
  if (remote.sessionExpired) {
    return {
      offerId: null,
      offer: null,
      sessionExpired: true,
      message: remote.message,
      isError: remote.isError !== false,
    };
  }
  if (!remote.ok) {
    return {
      offerId: null,
      offer: null,
      message: remote.message,
      isError: remote.isError !== false,
    };
  }
  if (!setAcceptedOfferHandled(offerId, false)) return { offerId: null, offer: null };
  acceptedQuickCursor = 0;
  renderOfferCacheView();
  return { offerId, offer };
}

async function undoLastHandledAcceptedOffer() {
  const restored = await restoreLastHandledAcceptedOffer();
  if (restored.sessionExpired) {
    handleSessionExpired({ message: restored.message });
    return;
  }
  if (!restored.offerId && restored.message) {
    setOffersStatus(restored.message, restored.isError !== false);
    return;
  }
  if (!restored.offerId) {
    renderOfferCacheView();
    setOffersStatus("Nothing to undo yet. Mark an accepted chat done first.");
    return;
  }
  setOffersStatus(
    restored.offer
      ? `${offerBuyerLabel(restored.offer)} moved back to active quick queue.`
      : "Last handled chat moved back to active quick queue."
  );
}

async function undoLastHandledAndReopenChat() {
  const restored = await restoreLastHandledAcceptedOffer();
  if (restored.sessionExpired) {
    handleSessionExpired({ message: restored.message });
    return;
  }
  if (!restored.offerId && restored.message) {
    setOffersStatus(restored.message, restored.isError !== false);
    return;
  }
  if (!restored.offerId) {
    renderOfferCacheView();
    setOffersStatus("Nothing to reopen yet. Mark an accepted chat done first.");
    return;
  }
  if (!restored.offer) {
    setOffersStatus("Last handled chat restored to queue. Refresh offers to reopen it.", true);
    return;
  }
  if (!openOfferChatFromOffer(restored.offer, "Restored and opening chat with")) {
    setOffersStatus(`${offerBuyerLabel(restored.offer)} moved back to active quick queue. Chat link is not ready yet.`, true);
  }
}

async function moveAcceptedOfferToNextChat(offerId, offer) {
  const id = Number(offerId);
  if (!Number.isInteger(id) || id < 1) {
    return { ok: false, message: "Offer not found. Refresh and try again.", isError: true };
  }
  const cachedOffer = offer || offerByIdFromCache(id);
  if (!cachedOffer) {
    return { ok: false, message: "Offer not found. Refresh and try again.", isError: true };
  }
  if (isAcceptedOfferHandled(id)) {
    return { ok: false, message: "This offer is already marked handled. Tap Mark active to return it to queue." };
  }

  const readyBefore = acceptedOffersReadyForChat();
  const currentIndex = readyBefore.findIndex((candidate) => Number(candidate?.id) === id);
  const remote = await setHandledOfferStateOnServer(id, true);
  if (remote.sessionExpired) {
    return {
      ok: false,
      message: remote.message || "Session expired. Verify again and retry.",
      isError: true,
      sessionExpired: true,
    };
  }
  if (!remote.ok) {
    return {
      ok: false,
      message: remote.message || "Could not update quick queue right now.",
      isError: remote.isError !== false,
    };
  }
  if (!setAcceptedOfferHandled(id, true, { trackHistory: true })) {
    return { ok: false, message: "Could not update quick queue right now.", isError: true };
  }

  const readyAfter = acceptedOffersReadyForChat();
  if (!readyAfter.length) {
    acceptedQuickCursor = 0;
    renderOfferCacheView();
    return { ok: true, opened: false, offer: cachedOffer };
  }

  const nextIndex = currentIndex < 0 ? 0 : currentIndex % readyAfter.length;
  acceptedQuickCursor = nextIndex;
  renderOfferCacheView();
  openNextAcceptedOfferChat();
  return { ok: true, opened: true, offer: cachedOffer };
}

async function remindAndMoveToNextAcceptedChat(button) {
  const offerId = Number(button?.dataset?.offerId);
  if (!Number.isInteger(offerId) || offerId < 1) return;
  if (isAcceptedOfferHandled(offerId)) {
    setOffersStatus("This offer is already marked handled. Tap Mark active to return it to queue.");
    return;
  }
  const offer = offerByIdFromCache(offerId);
  if (!offer) {
    setOffersStatus("Offer not found. Refresh and try again.", true);
    return;
  }
  const cooldownMsLeft = reminderCooldownMsLeftForOffer(offerId);
  if (cooldownMsLeft > 0) {
    renderOfferCacheView();
    setOffersStatus(`Reminder already sent. Try again in ${formatReminderCooldown(cooldownMsLeft)}.`);
    return;
  }

  const previousLabel = button.textContent;
  button.dataset.reminderBusy = "1";
  button.disabled = true;
  button.textContent = "Sending...";
  setOffersStatus("Sending reminder then moving to next chat...");
  const reminder = await sendReminderForOffer(offer);
  if (!reminder.ok) {
    if (reminder.sessionExpired) {
      handleSessionExpired({ message: reminder.message });
      return;
    }
    if (reminder.cooldownActive) {
      if (Number(reminder.cooldownMs) > 0) {
        setReminderCooldownForOffer(offerId, reminder.cooldownMs);
      }
      if (Number(reminder.sentAtMs) > 0) {
        setReminderLastSentAtForOffer(offerId, reminder.sentAtMs);
      }
      renderOfferCacheView();
    }
    delete button.dataset.reminderBusy;
    button.disabled = false;
    button.textContent = previousLabel;
    setOffersStatus(reminder.message || "Could not send reminder right now.", reminder.isError !== false);
    return;
  }
  delete button.dataset.reminderBusy;
  setReminderCooldownForOffer(offerId, reminder.cooldownMs || OFFER_REMINDER_COOLDOWN_MS);
  setReminderLastSentAtForOffer(offerId, reminder.sentAtMs || Date.now());

  const moved = await moveAcceptedOfferToNextChat(offerId, offer);
  if (moved.sessionExpired) {
    handleSessionExpired({ message: moved.message });
    return;
  }
  if (!moved.ok) {
    renderOfferCacheView();
    setOffersStatus(
      `Reminder sent in inbox, but quick queue did not move: ${String(moved.message || "try again in a moment.")}`,
      moved.isError !== false
    );
    return;
  }
  if (!moved.opened) {
    setOffersStatus(
      `Reminder sent. Marked ${offerBuyerLabel(moved.offer || offer)} done. No more accepted chats in queue.`
    );
  }
}

async function markDoneAndOpenNextAcceptedChat(button) {
  const offerId = Number(button?.dataset?.offerId);
  if (!Number.isInteger(offerId) || offerId < 1) return;
  const offer = offerByIdFromCache(offerId);
  const moved = await moveAcceptedOfferToNextChat(offerId, offer);
  if (moved.sessionExpired) {
    handleSessionExpired({ message: moved.message });
    return;
  }
  if (!moved.ok) {
    setOffersStatus(moved.message || "Could not update quick queue right now.", moved.isError !== false);
    return;
  }
  if (!moved.opened) {
    setOffersStatus(`Marked ${offerBuyerLabel(moved.offer || offer)} done. No more accepted chats in queue.`);
  }
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
  wrap.querySelectorAll(".offer-remind-next-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      void remindAndMoveToNextAcceptedChat(btn);
    });
  });
  wrap.querySelectorAll(".offer-handled-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      void toggleAcceptedOfferHandled(btn);
    });
  });
  wrap.querySelectorAll(".offer-done-next-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      void markDoneAndOpenNextAcceptedChat(btn);
    });
  });
  syncReminderCooldownButtonsUi();
}

function bindOfferFilterButtons() {
  document.querySelectorAll("[data-offer-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      setActiveOfferFilter(button.dataset.offerFilter);
    });
  });
  syncOfferFilterButtons();
}

function openOfferChatFromOffer(offer, statusPrefix = "Opening chat with") {
  const sellerUserId = currentSellerSocialUserId();
  const buyerUserId = offerBuyerUserId(offer);
  if (!sellerUserId || !buyerUserId || sellerUserId === buyerUserId) return false;
  const url = inboxLinkForOffer(offer, sellerUserId, buyerUserId);
  setOffersStatus(`${statusPrefix} ${offerBuyerLabel(offer)}...`);
  // Prefer same-tab so sessionStorage still works; fall back to new tab with token in URL.
  try {
    window.location.href = url;
  } catch {
    const popup = window.open(url, "_blank", "noopener");
    if (!popup) window.location.href = url;
  }
  return true;
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

  if (!openOfferChatFromOffer(offer)) {
    setOffersStatus("Could not resolve buyer chat profile for this offer.", true);
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
    if (!isSellerDashView(currentSellerView)) return;
    void loadSellerOffers({ silent: true });
  }, SELLER_OFFERS_POLL_MS);
}

function stopSellerBalancePolling() {
  if (sellerBalancePollTimer) {
    window.clearInterval(sellerBalancePollTimer);
    sellerBalancePollTimer = null;
  }
}

/** Keep payout ledger + orders in sync when admin releases escrow (no websocket). */
function startSellerBalancePolling() {
  stopSellerBalancePolling();
  if (!sellerProfile) return;
  const tick = () => {
    if (document.hidden) return;
    if (!isSellerDashView(currentSellerView) && currentSellerView !== "payouts") return;
    void loadEscrowLedger();
    if (isSellerDashView(currentSellerView)) void loadSellerOrders();
    if (currentSellerView === "payouts") void loadWithdrawPanel();
  };
  sellerBalancePollTimer = window.setInterval(tick, 45000);
}

async function loadSellerOffers({ silent = false } = {}) {
  const wrap = el("seller-offers");
  if (!wrap) return;
  if (sellerOffersRequestInFlight && silent) return;

  sellerOffersRequestInFlight = true;
  if (!silent) {
    setOffersStatus("Loading offers...");
    wrap.innerHTML = `<p class="text-sm text-zinc-500">Loading buyer offers…</p>`;
  }

  try {
    const sellerUserId = await resolveSellerSocialUserId();
    if (!sellerUserId) {
      setDashboardOfferBadge(0);
      sellerOffersCache = [];
      stopReminderCooldownTicker();
      clearReminderCooldownsStorage();
      clearReminderLastSentAtStorage();
      updateReminderCooldownHint({ count: 0, nextMs: 0 });
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
    const phone = apiPhone();
    if (phone) params.set("phone", phone);
    const sessionToken = getSessionToken();
    if (sessionToken) params.set("sessionToken", sessionToken);
    const res = await fetch(`${SOCIAL_API}/offers?${params}`);
    const parsed = await parseApiResponse(res);
    if (!parsed.ok) {
      if (parsed.status === 401 && isSellerSessionAuthError(parsed.data)) {
        handleSessionExpired(parsed.data);
        return;
      }
      if (!silent) {
        wrap.innerHTML = `<p class="text-sm text-red-600 dark:text-red-400">Could not load offers right now.</p>`;
        setOffersStatus(parsed.data?.message || parsed.message || "Could not load offers.", true);
      }
      return;
    }

    const offers = Array.isArray(parsed.data?.offers) ? parsed.data.offers : [];
    const pending = pendingOffersCount(offers);
    sellerOffersCache = offers;
    const handledSync = await syncHandledAcceptedOffersFromServer(sellerOffersCache, sellerUserId);
    if (!handledSync.ok) {
      if (handledSync.sessionExpired) {
        handleSessionExpired({ message: handledSync.message });
        return;
      }
      if (!silent) {
        setOffersStatus(handledSync.message || "Could not sync handled queue right now.", handledSync.isError !== false);
      }
    }
    reconcileReminderCooldowns(sellerOffersCache);
    reconcileReminderLastSentAt(sellerOffersCache);
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

  const available = Number(data.availableKes || ledgerData?.available?.totalKes || 0);
  const pending = Number(ledgerData?.pendingEscrow?.totalKes || 0);
  const transit = Number(ledgerData?.inTransit?.totalKes || 0);
  if (el("payout-pipeline-available")) el("payout-pipeline-available").textContent = formatKes(available);
  if (el("payout-pipeline-pending")) el("payout-pipeline-pending").textContent = formatKes(pending);
  if (el("payout-pipeline-transit")) el("payout-pipeline-transit").textContent = formatKes(transit);

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
    : `<p class="text-brand-purple/50 dark:text-white/50">Nothing in Ready for M-Pesa yet. Released escrow shows here — pending escrow does not.</p>`;

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

  window.__sokoniWithdrawExport = {
    breakdown: items,
    history,
    availableKes: data.availableKes || 0,
    pendingEscrowKes: Number(ledgerData?.pendingEscrow?.totalKes || 0),
    inTransitKes: Number(ledgerData?.inTransit?.totalKes || 0),
    mpesa: data.maskedMpesa || data.mpesaNumber || "",
    pendingRequest: data.pendingRequest || null,
    shopName: sellerProfile?.shopName || sellerProfile?.name || "",
    shopHandle: sellerShopHandle(),
    sellerPhone: apiPhone() || "",
    exportedAt: Date.now(),
  };
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
    statusEl.classList.add("text-emerald-400");
    await loadWithdrawPanel();
    await loadEscrowLedger();
  } catch {
    statusEl.textContent = "Network error — try again.";
    statusEl.classList.add("text-red-600", "dark:text-red-400");
  } finally {
    btn.disabled = false;
  }
}

/* -------------------------------------------------------------------------- */
/* Command center: logistics / stock / marketing                              */
/* -------------------------------------------------------------------------- */

function sellerStorageKey(base) {
  const phone = apiPhone() || "anon";
  return `${base}:${phone}`;
}

function readJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function getSellerDefaultHub() {
  return (
    localStorage.getItem(sellerStorageKey(HUB_DEFAULT_HUB_KEY)) ||
    "Countrywide delivery — Sokoni Mashinani hub network"
  );
}

function setSellerDefaultHub(hub) {
  localStorage.setItem(sellerStorageKey(HUB_DEFAULT_HUB_KEY), String(hub || ""));
}

function getStockNotes() {
  return readJsonStorage(sellerStorageKey(HUB_STOCK_NOTES_KEY), {});
}

function setStockNote(productId, qty) {
  const notes = getStockNotes();
  const n = Math.max(0, Math.round(Number(qty) || 0));
  notes[productId] = n;
  writeJsonStorage(sellerStorageKey(HUB_STOCK_NOTES_KEY), notes);
}

function getSellerPromoCode() {
  return (
    localStorage.getItem(sellerStorageKey(HUB_PROMO_CODE_KEY)) ||
    "SOKONI10"
  ).toUpperCase();
}

function setSellerPromoCode(code) {
  localStorage.setItem(
    sellerStorageKey(HUB_PROMO_CODE_KEY),
    String(code || "SOKONI10")
      .trim()
      .toUpperCase()
      .slice(0, 24)
  );
}

function sellerShopHandle() {
  return String(sellerProfile?.shopHandle || sellerProfile?.handle || "")
    .replace(/^@+/, "")
    .trim();
}

function sellerPublicShopUrl() {
  const handle = sellerShopHandle();
  const origin =
    window.location.origin && window.location.origin !== "null"
      ? window.location.origin
      : "https://sokonimall.com";
  if (handle) return `${origin}/shop.html?handle=${encodeURIComponent(handle)}`;
  return `${origin}/shop.html`;
}

/** Always the public mall home — promoter share keeps handle separate. */
function sellerMallHomeUrl() {
  return "https://sokonimall.com";
}

function waDigits(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9) d = `254${d}`;
  return d;
}

/** Deep-link chat to a number when known; otherwise draft-only (no recipient). */
function waChatUrl(phone, text) {
  const digits = waDigits(phone);
  const q = encodeURIComponent(String(text || ""));
  if (digits && digits.length >= 10) return `https://wa.me/${digits}?text=${q}`;
  return `https://wa.me/?text=${q}`;
}

function listingStockQty(item, notes = getStockNotes()) {
  const pid = item?.id || item?.productId;
  if (item?.stockQuantity != null && Number.isFinite(Number(item.stockQuantity))) {
    return Math.max(0, Math.round(Number(item.stockQuantity)));
  }
  if (pid && notes[pid] != null) return Math.max(0, Math.round(Number(notes[pid]) || 0));
  if (item?.isSold || item?.inStock === false) return 0;
  return 1;
}

function hubDropOffOrders(orders = hubCache.orders) {
  return hubOrdersAwaitingShip(orders).filter(
    (o) => o.needsDropOff || orderPhase(o) === "awaiting_ship"
  );
}

function renderHubLogistics() {
  const wrap = el("logistics-dropoffs");
  const status = el("logistics-status");
  const select = el("logistics-hub-select");
  if (select && !select.dataset.bound) {
    select.value = getSellerDefaultHub();
    select.addEventListener("change", () => {
      setSellerDefaultHub(select.value);
      if (el("logistics-hub-status")) {
        el("logistics-hub-status").textContent = `Saved — ${select.value}`;
      }
      updateLogisticsBodaLink();
    });
    select.dataset.bound = "1";
  } else if (select) {
    select.value = getSellerDefaultHub();
  }
  updateLogisticsBodaLink();

  if (!wrap) return;
  const rows = hubDropOffOrders();
  if (!rows.length) {
    wrap.innerHTML = `<p class="text-sm text-zinc-500">No parcels waiting for drop-off. Paid sales needing a label show here.</p>`;
    if (status) status.textContent = "";
    return;
  }
  const hub = getSellerDefaultHub();
  wrap.innerHTML = rows
    .map((o) => {
      const actions = [];
      if (o.labelUrl) {
        actions.push(
          `<a href="${escapeHtml(o.labelUrl)}" target="_blank" rel="noopener" class="sell-order-action sell-order-action--primary">Print label</a>`
        );
      }
      if (o.trackUrl) {
        actions.push(`<a href="${escapeHtml(o.trackUrl)}" class="sell-order-action">Track</a>`);
      }
      return `
        <div class="sell-order-card sell-order-card--static" role="listitem">
          <div class="sell-order-card-head">
            <p class="font-semibold text-sm sell-order-card__title">${escapeHtml(o.productName || "Order")}</p>
            <span class="sell-order-badge sell-order-badge--action">${o.needsDropOff ? "Ready for drop" : "Awaiting ship"}</span>
          </div>
          <p class="text-xs text-zinc-500 mt-1 sell-order-card__meta"><span class="font-mono">${escapeHtml(o.orderId || "")}</span> · Hub: ${escapeHtml(hub)}</p>
          ${actions.length ? `<div class="sell-order-actions">${actions.join("")}</div>` : ""}
        </div>`;
    })
    .join("");
  if (status) status.textContent = `${rows.length} parcel${rows.length === 1 ? "" : "s"} for hub drop-off`;
}

function updateLogisticsBodaLink() {
  const a = el("logistics-boda-btn");
  if (!a) return;
  const hub = getSellerDefaultHub();
  const handle = sellerShopHandle();
  const pending = hubDropOffOrders().length;
  const msg =
    `Habari Sokoni — ninaomba boda rider pickup.\n` +
    (handle ? `Shop: @${handle}\n` : "") +
    `Hub preference: ${hub}\n` +
    (pending ? `I have ${pending} parcel${pending === 1 ? "" : "s"} ready for drop-off.\n` : "") +
    `Please confirm which order + my exact pickup location — I'll reply with details.`;
  a.href = waChatUrl(SOKONI_SUPPORT_WA, msg);
}

function generateHubManifest() {
  const hub = getSellerDefaultHub();
  const rows = hubDropOffOrders();
  if (!rows.length) {
    if (el("logistics-status")) el("logistics-status").textContent = "Nothing to put on a manifest yet.";
    return;
  }
  const lines = [
    "SOKONI MASHINANI — HUB DROP-OFF MANIFEST",
    `Hub: ${hub}`,
    `Seller: ${sellerProfile?.shopName || sellerProfile?.name || apiPhone() || "—"}`,
    sellerShopHandle() ? `Handle: @${sellerShopHandle()}` : "",
    `Date: ${new Date().toLocaleString()}`,
    "",
    ...rows.map(
      (o, i) =>
        `${i + 1}. ${o.orderId} — ${o.productName || "Item"} — ${formatKes(o.sellerNetKes)}`
    ),
    "",
    `Scan / track: ${rows.map((o) => o.trackUrl || o.orderId).join(" | ")}`,
  ].filter((l) => l !== "");
  const safe = lines
    .map((l) =>
      String(l)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
    )
    .join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Sokoni Hub Manifest</title>
    <style>body{font-family:ui-monospace,Menlo,monospace;padding:24px;color:#111;background:#fff}h1{font-size:16px;margin:0 0 12px}pre{white-space:pre-wrap;font-size:12px;line-height:1.45;margin:0}</style></head>
    <body><h1>Sokoni hub drop-off manifest</h1><pre>${safe}</pre>
    <script>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print()},120)});<\/script></body></html>`;

  // Blob URL avoids blank tabs from window.open(..., "noopener") + document.write.
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (!w) {
    // Popup blocked — same-tab iframe print fallback
    let frame = document.getElementById("hub-manifest-print-frame");
    if (!frame) {
      frame = document.createElement("iframe");
      frame.id = "hub-manifest-print-frame";
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText =
        "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
      document.body.appendChild(frame);
    }
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {}
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };
    frame.src = url;
    if (el("logistics-status")) {
      el("logistics-status").textContent = "Popup blocked — printing via hidden frame.";
    }
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  if (el("logistics-status")) {
    el("logistics-status").textContent = `Manifest ready — ${rows.length} parcel${rows.length === 1 ? "" : "s"}.`;
  }
}

function renderHubStockAlerts() {
  const wrap = el("stock-alerts");
  if (!wrap) return;
  const live = hubCache.listings || [];
  const drafts = hubCache.drafts || [];
  const notes = getStockNotes();
  const cards = [];

  const draftsNeedPhotos = drafts.filter(
    (d) => !(d.imageUrl || (Array.isArray(d.images) && d.images.length))
  );
  if (draftsNeedPhotos.length) {
    cards.push(`
      <div class="sell-order-card sell-order-card--static">
        <p class="font-semibold text-sm text-white">${draftsNeedPhotos.length} draft${draftsNeedPhotos.length === 1 ? "" : "s"} need photos</p>
        <p class="text-xs text-zinc-500 mt-1">Finish photos before posting — buyers skip empty cards.</p>
        <div class="sell-order-actions"><button type="button" class="sell-order-action sell-order-action--primary" data-hub-jump="listings">Open drafts</button></div>
      </div>`);
  }

  live.forEach((item) => {
    const pid = item.id || item.productId;
    if (!pid) return;
    const qty = listingStockQty(item, notes);
    const low = qty > 0 && qty <= 2;
    const soldOut = qty <= 0;
    cards.push(`
      <div class="sell-order-card sell-order-card--static" data-stock-id="${escapeHtml(pid)}">
        <div class="sell-order-card-head">
          <p class="font-semibold text-sm sell-order-card__title">${escapeHtml(item.name || item.title || item.draft?.name || pid)}</p>
          <span class="sell-order-badge ${soldOut ? "sell-order-badge--transit" : low ? "sell-order-badge--action" : "sell-order-badge--done"}">${
            soldOut ? "Out of stock" : low ? "Low stock" : "In stock"
          }</span>
        </div>
        <p class="text-xs text-zinc-500 mt-1 font-mono">${escapeHtml(pid)}</p>
        <div class="flex items-end gap-2 mt-2 flex-wrap">
          <label class="block text-xs text-zinc-400">Units on hand
            <input type="number" min="0" max="9999" value="${qty}" data-stock-qty="${escapeHtml(pid)}" class="sell-form-input mt-1 max-w-[8rem]" />
          </label>
          <div class="flex gap-1 pb-0.5">
            <button type="button" class="sell-order-action" data-stock-step="${escapeHtml(pid)}" data-delta="-1" aria-label="Decrease units">−</button>
            <button type="button" class="sell-order-action" data-stock-step="${escapeHtml(pid)}" data-delta="1" aria-label="Increase units">+</button>
            <button type="button" class="sell-order-action sell-order-action--primary" data-stock-save="${escapeHtml(pid)}">Save</button>
          </div>
        </div>
        <p class="text-xs text-zinc-500 mt-1" data-stock-hint="${escapeHtml(pid)}">${
          soldOut
            ? "Add units and Save — listing returns to the main menu."
            : low
              ? "Only a few left — bump units before the next order."
              : "Sales only remove the listing when units hit zero."
        }</p>
      </div>`);
  });

  if (!cards.length) {
    wrap.innerHTML = `<p class="text-sm text-zinc-500">No live listings yet. List an item, then track units here.</p>`;
  } else {
    wrap.innerHTML = cards.join("");
    wrap.querySelectorAll("[data-stock-step]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest("[data-stock-id]");
        const input = card?.querySelector("[data-stock-qty]");
        if (!input) return;
        const delta = Number(btn.getAttribute("data-delta") || 0);
        const next = Math.max(0, Math.min(9999, (Number(input.value) || 0) + delta));
        input.value = String(next);
      });
    });
    wrap.querySelectorAll("[data-stock-save]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest("[data-stock-id]");
        const pid = card?.getAttribute("data-stock-id") || btn.getAttribute("data-stock-save");
        const input = card?.querySelector("[data-stock-qty]");
        void saveListingStock(pid, input?.value, btn, card);
      });
    });
    wrap.querySelectorAll("[data-hub-jump]").forEach((btn) => {
      btn.addEventListener("click", () => showSellerView(btn.dataset.hubJump || "listings"));
    });
  }
  if (el("stock-status")) {
    const lowCount = live.filter((item) => listingStockQty(item, notes) <= 2).length;
    el("stock-status").textContent = lowCount
      ? `${lowCount} listing${lowCount === 1 ? "" : "s"} at low or zero stock`
      : "";
  }
}

async function saveListingStock(productId, rawQty, btn, card = null) {
  const phone = apiPhone();
  const qty = Math.max(0, Math.min(9999, Math.round(Number(rawQty) || 0)));
  const hint =
    card?.querySelector("[data-stock-hint]") ||
    document.querySelector(`[data-stock-hint="${String(productId || "").replace(/"/g, "")}"]`);
  if (!phone || !productId) {
    if (hint) hint.textContent = "Sign in again, then Save units.";
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saving…";
  }
  setStockNote(productId, qty);

  const applyLocalQty = (nextQty, inStock = nextQty > 0) => {
    const listing = (hubCache.listings || []).find((l) => (l.id || l.productId) === productId);
    if (listing) {
      listing.stockQuantity = nextQty;
      listing.inStock = inStock;
      listing.isSold = !inStock && nextQty <= 0 ? listing.isSold : false;
    }
  };

  const payload = jsonAuthBody({
    phone,
    productId,
    stockQuantity: qty,
  });

  try {
    let res = await fetch(`${ONBOARD_API}/stock`, {
      method: "POST",
      headers: sellerAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });

    // Older bot builds lack /stock — piggyback units on /price (same auth) once that build supports it.
    if (res.status === 404) {
      const listing = (hubCache.listings || []).find((l) => (l.id || l.productId) === productId);
      const net = Math.round(
        Number(listing?.draft?.sellerNetKes ?? listing?.draft?.sourcePriceKes ?? listing?.draft?.priceKes) || 0
      );
      if (net >= 50) {
        res = await fetch(`${ONBOARD_API}/price`, {
          method: "POST",
          headers: sellerAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(
            jsonAuthBody({
              phone,
              productId,
              sellerNetKes: net,
              stockQuantity: qty,
            })
          ),
        });
        // Live bot before this fix ignores stockQuantity — detect missing stock echo.
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.stockQuantity == null && data.stockMessage == null) {
            applyLocalQty(qty);
            if (hint) {
              hint.textContent =
                "Saved on this phone only — WhatsApp bot needs a redeploy for catalog stock.";
            }
            if (el("stock-status")) {
              el("stock-status").textContent =
                "Bot is on an old build. Redeploy bot.sokonimall.com so Save updates the live menu.";
            }
            renderHubStockAlerts();
            return;
          }
          applyLocalQty(data.stockQuantity ?? qty, data.inStock !== false);
          if (hint) hint.textContent = data.stockMessage || data.message || `Saved — ${qty} on hand.`;
          if (el("stock-status")) el("stock-status").textContent = data.stockMessage || data.message || "";
          renderHubStockAlerts();
          return;
        }
      } else {
        applyLocalQty(qty);
        if (hint) {
          hint.textContent =
            "Saved on this phone only — WhatsApp bot needs a redeploy for catalog stock.";
        }
        if (el("stock-status")) {
          el("stock-status").textContent =
            "Stock API missing on bot (404). Redeploy the bot, then Save again.";
        }
        renderHubStockAlerts();
        return;
      }
    }

    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      handleSessionExpired(data);
      return;
    }
    if (!res.ok) {
      const msg =
        data.message ||
        data.error ||
        (res.status === 404
          ? "Stock API missing — redeploy the WhatsApp bot."
          : `Could not save stock (${res.status}).`);
      if (hint) hint.textContent = msg;
      if (el("stock-status")) el("stock-status").textContent = msg;
      return;
    }
    applyLocalQty(data.stockQuantity ?? qty, data.inStock !== false);
    if (hint) hint.textContent = data.message || `Saved — ${qty} unit${qty === 1 ? "" : "s"} on hand.`;
    if (el("stock-status")) el("stock-status").textContent = data.message || "";
    renderHubStockAlerts();
  } catch {
    applyLocalQty(qty);
    if (hint) hint.textContent = "Network error — units kept on this phone. Try Save again.";
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Save";
    }
  }
}

function buildMarketingShareMessage() {
  const code = getSellerPromoCode();
  const handle = sellerShopHandle();
  return (
    `✨ *NEW ON SOKONI*\n\n` +
    `Check my verified shop — pay safe with M-Pesa escrow:\n\n` +
    `👉 ${sellerMallHomeUrl()}\n` +
    (handle ? `Shop: @${handle}\n` : "") +
    `\nPromo code: *${code}* (mention it in chat)`
  );
}

function renderHubMarketing() {
  const preview = el("marketing-share-preview");
  const codeInput = el("marketing-promo-code");
  const waBtn = el("marketing-wa-btn");
  if (codeInput && !codeInput.dataset.bound) {
    codeInput.value = getSellerPromoCode();
    codeInput.addEventListener("input", () => {
      setSellerPromoCode(codeInput.value);
      renderHubMarketing();
    });
    codeInput.dataset.bound = "1";
  } else if (codeInput) {
    codeInput.value = getSellerPromoCode();
  }

  const msg = buildMarketingShareMessage();
  if (preview) preview.textContent = msg;
  if (waBtn) waBtn.href = waChatUrl("", msg);

  const buyersWrap = el("marketing-buyers");
  if (!buyersWrap) return;
  const seen = new Map();
  (hubCache.orders || [])
    .filter((o) => o.paid)
    .forEach((o) => {
      const key =
        waDigits(o.buyerPhone) ||
        String(o.customerName || "").trim() ||
        String(o.productId || o.orderId || "");
      if (!key || seen.has(key)) return;
      seen.set(key, o);
    });
  const buyers = [...seen.values()].slice(0, 12);
  if (!buyers.length) {
    buyersWrap.innerHTML = `<p class="text-sm text-zinc-500">Paid buyers appear here after your first sales.</p>`;
    return;
  }
  const handle = sellerShopHandle();
  const code = getSellerPromoCode();
  buyersWrap.innerHTML = buyers
    .map((o, idx) => {
      const name = o.customerName || o.buyerName || "Buyer";
      const productId = o.productId || "";
      const productName = o.productName || "your item";
      const productRef = productId || productName;
      const thank =
        `Asante ${name}! Thanks for buying *${productName}* (${productRef}) from my Sokoni shop 🙏\n\n` +
        `${sellerMallHomeUrl()}\n` +
        (handle ? `Shop: @${handle}` : "");
      const restock =
        `Habari ${name} — *${productName}* (${productRef}) has fresh stock on Sokoni:\n\n` +
        `${sellerMallHomeUrl()}\n` +
        (handle ? `Shop: @${handle}\n` : "") +
        `\nPromo: *${code}* — mention it in chat`;
      const phone = waDigits(o.buyerPhone);
      // Always clickable: deep-link to buyer when known, otherwise open WhatsApp with the draft ready.
      const thankHref = waChatUrl(phone, thank);
      const restockHref = waChatUrl(phone, restock);
      const phoneHint = phone
        ? `+${phone}`
        : "Opens WhatsApp with draft — pick the buyer chat";
      return `
        <div class="sell-order-card sell-order-card--static" data-repeat-buyer="${idx}">
          <p class="font-semibold text-sm text-white">${escapeHtml(name)}</p>
          <p class="text-xs text-zinc-500 mt-1">${escapeHtml(productName)}${
            productId ? ` · <span class="font-mono">${escapeHtml(productId)}</span>` : ""
          }</p>
          <p class="text-[11px] text-zinc-500 mt-1">${escapeHtml(phoneHint)}</p>
          <div class="sell-order-actions">
            <a class="sell-order-action sell-order-action--primary" target="_blank" rel="noopener" href="${thankHref}">Thank you</a>
            <a class="sell-order-action sell-order-action--primary" target="_blank" rel="noopener" href="${restockHref}">Restock notice</a>
          </div>
        </div>`;
    })
    .join("");
}

/** Minimal multi-page text PDF (Helvetica) — no external libs. */
function buildSimplePdf(lines, { title = "Sokoni statement" } = {}) {
  const pageWidth = 595.28; // A4
  const pageHeight = 841.89;
  const marginX = 48;
  const marginTop = 56;
  const lineHeight = 14;
  const fontSize = 10;
  const maxLines = Math.floor((pageHeight - marginTop - 48) / lineHeight);

  const escapePdf = (text) =>
    String(text ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)")
      .replace(/[^\x20-\x7E]/g, (ch) => {
        // Keep statement readable: drop non-latin1 control chars, map common kes symbols.
        if (ch === "—") return "-";
        if (ch === "•") return "*";
        if (ch === "→") return "->";
        return "?";
      });

  const pages = [];
  for (let i = 0; i < lines.length; i += maxLines) {
    pages.push(lines.slice(i, i + maxLines));
  }
  if (!pages.length) pages.push([title]);

  const objects = [];
  const addObj = (body) => {
    objects.push(body);
    return objects.length;
  };

  const fontId = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds = [];

  pages.forEach((pageLines) => {
    let y = pageHeight - marginTop;
    const ops = ["BT", `/F1 ${fontSize} Tf`, `${marginX} ${y} Td`];
    pageLines.forEach((line, idx) => {
      if (idx === 0) {
        ops.push(`(${escapePdf(line)}) Tj`);
      } else {
        ops.push(`0 -${lineHeight} Td (${escapePdf(line)}) Tj`);
      }
    });
    ops.push("ET");
    const stream = ops.join("\n");
    const contentId = addObj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = addObj(
      `<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
        `/Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`
    );
    pageIds.push(pageId);
  });

  const kids = pageIds.map((id) => `${id} 0 R`).join(" ");
  const pagesId = addObj(`<< /Type /Pages /Kids [${kids}] /Count ${pageIds.length} >>`);
  // Patch page Parent refs to real pages object id
  pageIds.forEach((id) => {
    objects[id - 1] = objects[id - 1].replace("/Parent 0 0 R", `/Parent ${pagesId} 0 R`);
  });
  const catalogId = addObj(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n`;
  pdf += `startxref\n${xrefStart}\n%%EOF`;
  return pdf;
}

function exportPayoutPdf() {
  const payload = window.__sokoniWithdrawExport || {};
  const shop =
    payload.shopName ||
    (payload.shopHandle ? `@${payload.shopHandle}` : "") ||
    payload.sellerPhone ||
    "Seller";
  const handle = payload.shopHandle ? `@${payload.shopHandle}` : "";
  const dateStr = new Date(payload.exportedAt || Date.now()).toLocaleString();
  const lines = [
    "SOKONI MALL — M-PESA PAYOUT STATEMENT",
    "sokonimall.com",
    "",
    `Shop: ${shop}${handle && shop !== handle ? ` (${handle})` : ""}`,
    `Seller WhatsApp: ${payload.sellerPhone || "—"}`,
    `Payout M-Pesa: ${payload.mpesa || "—"}`,
    `Generated: ${dateStr}`,
    "",
    `Available for payout: ${formatKes(payload.availableKes || 0)}`,
    `Pending escrow: ${formatKes(payload.pendingEscrowKes || 0)}`,
    `In transit: ${formatKes(payload.inTransitKes || 0)}`,
  ];

  if (payload.pendingRequest) {
    lines.push(
      "",
      `Pending withdrawal: ${payload.pendingRequest.id} — ${formatKes(payload.pendingRequest.amountKes || 0)}`
    );
  }

  lines.push("", "AVAILABLE ORDERS (ready for M-Pesa)", "-".repeat(52));
  const orders = payload.breakdown || [];
  if (!orders.length) {
    lines.push("(none yet)");
  } else {
    orders.forEach((item, i) => {
      const name = String(item.productName || "Order").slice(0, 36);
      lines.push(
        `${String(i + 1).padStart(2, " ")}. ${item.orderId || "—"}  ${name}  ${formatKes(item.amountKes || 0)}`
      );
    });
  }

  lines.push("", "WITHDRAWAL HISTORY", "-".repeat(52));
  const history = payload.history || [];
  if (!history.length) {
    lines.push("(none yet)");
  } else {
    history.forEach((h, i) => {
      lines.push(
        `${String(i + 1).padStart(2, " ")}. ${h.id || "—"}  ${h.status || "—"}  ${formatKes(h.amountKes || 0)}`
      );
    });
  }

  lines.push(
    "",
    "Notes",
    "- Funds pay out after delivery is confirmed and escrow releases.",
    "- Manual M-Pesa transfer usually within 1-2 business days of request.",
    "- This statement is for your records — not a bank advice slip."
  );

  const pdf = buildSimplePdf(lines, { title: "Sokoni M-Pesa statement" });
  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sokoni-mpesa-statement-${new Date().toISOString().slice(0, 10)}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

function bindSellerCommandCenterUi() {
  el("logistics-manifest-btn")?.addEventListener("click", generateHubManifest);
  el("logistics-refresh-btn")?.addEventListener("click", () => {
    loadSellerOrders();
    renderHubLogistics();
  });
  el("marketing-copy-btn")?.addEventListener("click", async () => {
    const msg = buildMarketingShareMessage();
    try {
      await navigator.clipboard.writeText(msg);
      if (el("marketing-status")) el("marketing-status").textContent = "Copied — paste into WhatsApp Status or Groups.";
    } catch {
      if (el("marketing-status")) el("marketing-status").textContent = "Could not copy — select the preview text manually.";
    }
  });
  el("payout-export-pdf-btn")?.addEventListener("click", exportPayoutPdf);
  // Back-compat if an older cached HTML still has the CSV button id.
  el("payout-export-csv-btn")?.addEventListener("click", exportPayoutPdf);
}

function isSellerDashView(view) {
  return [
    "overview",
    "orders",
    "logistics",
    "offers",
    "disputes",
    "stock",
    "listings",
    "tools",
    "analytics",
    "marketing",
    "grow",
    "settings",
  ].includes(view);
}

function normalizeSellerHubView(view) {
  const raw = String(view || "overview").trim().toLowerCase();
  if (raw === "dashboard" || raw === "home") return "overview";
  if (raw === "withdraw" || raw === "mpesa-ledger" || raw === "ledger") return "payouts";
  if (raw === "list" || raw === "list-item" || raw === "create") return "listing";
  if (raw === "offer" || raw === "price-offers") return "offers";
  if (raw === "hub" || raw === "hub-drop-offs" || raw === "drop-off" || raw === "mashinani") return "logistics";
  if (raw === "inventory" || raw === "shop-stock" || raw === "stock-alerts") return "stock";
  if (raw === "promo" || raw === "whatsapp-promo" || raw === "wa-promo") return "marketing";
  if (
    raw === "grow-your-shop" ||
    raw === "grow_shop" ||
    raw === "trending" ||
    raw === "guides" ||
    raw === "seller-level" ||
    raw === "shop-activity" ||
    raw === "rate-buyers"
  ) {
    return "grow";
  }
  return raw;
}

function syncSellerHubNavActive(view, anchor = "") {
  document.querySelectorAll("[data-hub-nav]").forEach((btn) => {
    const key = btn.dataset.hubNav;
    const btnAnchor = btn.dataset.hubAnchor || "";
    const isSub = Boolean(btnAnchor);
    const active = isSub
      ? key === view && btnAnchor === anchor
      : key === view && !btn.hasAttribute("data-hub-anchor");
    btn.classList.toggle("is-active", active);
  });
  document.querySelectorAll("[data-hub-group]").forEach((group) => {
    const key = group.getAttribute("data-hub-group");
    group.classList.toggle("is-open", key === view);
  });
}

function scrollSellerHubAnchor(anchor) {
  if (!anchor) return;
  const node = document.getElementById(anchor);
  if (!node) return;
  window.requestAnimationFrame(() => {
    node.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function showSellerView(view, opts = {}) {
  view = normalizeSellerHubView(view);
  currentSellerView = view;
  const anchor = String(opts.anchor || "").trim();

  const dashboard = el("view-dashboard");
  const withdraw = el("view-withdraw");
  const listing = el("view-listing");

  const showDash = isSellerDashView(view);
  const showWithdraw = view === "payouts";
  const showListing = view === "listing";

  dashboard?.classList.toggle("hidden", !showDash);
  withdraw?.classList.toggle("hidden", !showWithdraw);
  listing?.classList.toggle("hidden", !showListing);

  document.querySelectorAll("[data-hub-panel]").forEach((panel) => {
    const key = panel.getAttribute("data-hub-panel");
    const visible = showDash && key === view;
    panel.classList.toggle("hidden", !visible);
  });

  syncSellerHubNavActive(view, anchor);

  if (showDash) {
    loadSellerOrders();
    loadSellerOffers();
    loadEscrowLedger();
    loadMyListings();
    void loadSellerBuyerReviews();
    void loadSellerDisputes();
    if (view === "grow" || view === "overview") {
      void loadSellerActivity();
      renderHubTrendingCarousel();
      renderHubGuidesCarousel();
      renderSellerHubOverview();
    }
    if (view === "logistics") renderHubLogistics();
    if (view === "stock") renderHubStockAlerts();
    if (view === "marketing") renderHubMarketing();
    startSellerOffersPolling();
    startSellerBalancePolling();
    ensureReminderCooldownTicker();
    refreshSellerAnalytics();
  } else if (showWithdraw) {
    stopSellerOffersPolling();
    stopReminderCooldownTicker();
    loadWithdrawPanel();
    loadEscrowLedger();
    startSellerBalancePolling();
  } else {
    stopSellerOffersPolling();
    stopSellerBalancePolling();
    stopReminderCooldownTicker();
  }

  if (anchor) {
    window.setTimeout(() => scrollSellerHubAnchor(anchor), 40);
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
    if (el("payout-pipeline-available")) {
      el("payout-pipeline-available").textContent = formatKes(ledgerData.available?.totalKes || 0);
    }
    if (el("payout-pipeline-pending")) {
      el("payout-pipeline-pending").textContent = formatKes(ledgerData.pendingEscrow?.totalKes || 0);
    }
    if (el("payout-pipeline-transit")) {
      el("payout-pipeline-transit").textContent = formatKes(ledgerData.inTransit?.totalKes || 0);
    }
    renderLedgerDetail();
    renderSellerHubOverview();
    refreshSellerAnalytics();
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

  restoreStudioMedia();
  bindMediaSlots();
  bindLedgerTabs();
  bindOfferFilterButtons();
  updateStepUi();
  if (studioClipUrl || coverCleanUrl) {
    refreshStudioClipPreview();
    refreshCoverPreview();
    updateCoverStudioUi();
  }

  // Pillar nav is bound in bindSellerHubUi via [data-hub-nav].
  el("load-withdraw-btn")?.addEventListener("click", loadWithdrawPanel);
  el("withdraw-request-btn")?.addEventListener("click", requestWithdrawal);
  el("load-orders-btn")?.addEventListener("click", loadSellerOrders);
  el("load-buyer-reviews-btn")?.addEventListener("click", loadSellerBuyerReviews);
  el("load-seller-disputes-btn")?.addEventListener("click", loadSellerDisputes);
  el("load-activity-btn")?.addEventListener("click", loadSellerActivity);
  el("load-offers-btn")?.addEventListener("click", () => loadSellerOffers());
  el("offers-quick-chat-btn")?.addEventListener("click", openNextAcceptedOfferChat);
  el("offers-reset-handled-btn")?.addEventListener("click", () => {
    void resetHandledAcceptedOffersQueue();
  });
  el("offers-undo-handled-btn")?.addEventListener("click", () => {
    void undoLastHandledAcceptedOffer();
  });
  el("offers-undo-open-btn")?.addEventListener("click", () => {
    void undoLastHandledAndReopenChat();
  });

  el("btn-next")?.addEventListener("click", () => goStep(1));
  el("btn-back")?.addEventListener("click", () => goStep(-1));
  el("post-btn")?.addEventListener("click", onPublish);
  el("save-draft-btn")?.addEventListener("click", onSaveDraft);
  el("load-listings-btn")?.addEventListener("click", loadMyListings);
  bindBulkCsvUi();
  bindSellerHubUi();
  bindSellerCommandCenterUi();
  el("load-ledger-btn")?.addEventListener("click", loadEscrowLedger);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !sellerProfile) return;
    if (!isSellerDashView(currentSellerView) && currentSellerView !== "payouts") return;
    void loadEscrowLedger();
    if (isSellerDashView(currentSellerView)) void loadSellerOrders();
    if (currentSellerView === "payouts") void loadWithdrawPanel();
  });
  el("onboard-btn")?.addEventListener("click", onOnboard);
  el("send-code-btn")?.addEventListener("click", onSendCode);
  el("verify-code-btn")?.addEventListener("click", onVerifyCode);
  el("resend-code-btn")?.addEventListener("click", onSendCode);
  el("verify-code-input")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") onVerifyCode();
  });
  el("sign-out-btn")?.addEventListener("click", onSignOut);
  el("seller-shop-edit-form")?.addEventListener("submit", saveShopProfile);
  bindShopAvatarUi();
  el("seller-phone")?.addEventListener("change", () => {
    savePhone();
    clearSession();
    showVerifyPanel();
  });
  el("draft-price")?.addEventListener("input", onListingPriceInput);
  el("media-price")?.addEventListener("input", onListingPriceInput);
  el("photo-caption")?.addEventListener("change", () => {
    if (photoFiles[0] && !draft.name && listingPriceHintKes() > 0) {
      void maybeAutoGenerate();
    }
  });
  loadMeta().then(async () => {
    checkApiHealth();
    const hadSession = loadSessionFromStorage();
    if (hadSession && (await tryRestoreSession())) return;
    showVerifyPanel();
    if (apiPhone()) await onSendCode();
  });
}

document.addEventListener("DOMContentLoaded", init);
