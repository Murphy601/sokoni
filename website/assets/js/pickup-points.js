const PICKUP_API =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001/api/pickup-points"
    : "https://bot.sokonimall.com/api/pickup-points";

const DEFAULT_SHOP_TYPES = [
  "Phone & electronics shop",
  "General store / Duka",
  "Cyber café",
  "Pharmacy",
  "Supermarket",
  "Other retail",
];

const DEFAULT_COUNTIES = [
  "Nairobi",
  "Mombasa",
  "Kiambu",
  "Nakuru",
  "Kisumu",
  "Uasin Gishu",
  "Machakos",
  "Kajiado",
  "Meru",
  "Embu",
  "Nyeri",
  "Kakamega",
  "Kilifi",
  "Kwale",
  "Other",
];

function el(id) {
  return document.getElementById(id);
}

function fillSelect(selectId, options, placeholder) {
  const select = el(selectId);
  if (!select) return;
  select.innerHTML = options.map((o) => `<option value="${o}">${o}</option>`).join("");
  if (placeholder && !options.includes(placeholder)) {
    select.insertAdjacentHTML("afterbegin", `<option value="" disabled selected>${placeholder}</option>`);
  }
}

async function loadInfo() {
  try {
    const res = await fetch(`${PICKUP_API}/info`);
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data.shopTypes) && data.shopTypes.length) {
      fillSelect("shopType", data.shopTypes);
    } else {
      fillSelect("shopType", DEFAULT_SHOP_TYPES);
    }
    if (Array.isArray(data.counties) && data.counties.length) {
      fillSelect("county", data.counties, "Select county");
    } else {
      fillSelect("county", DEFAULT_COUNTIES, "Select county");
    }
    const commission = data.commissionPerParcelKes ?? 50;
    const note = el("program-note");
    if (note) {
      note.textContent = `Earn KES ${commission}+ commission for every parcel you receive and hand to customers.`;
    }
    const commissionLine = el("commission-line");
    if (commissionLine) {
      commissionLine.textContent = `KES ${commission}+`;
    }
  } catch {
    fillSelect("shopType", DEFAULT_SHOP_TYPES);
    fillSelect("county", DEFAULT_COUNTIES, "Select county");
  }
}

async function loadActivePoints() {
  const section = el("active-points");
  const list = el("points-list");
  if (!section || !list) return;

  let points = [];
  try {
    const res = await fetch(`${PICKUP_API}/`);
    if (res.ok) {
      const data = await res.json();
      points = data.pickupPoints || [];
    }
  } catch {
    try {
      const res = await fetch("data/pickup-points.json");
      if (res.ok) {
        const data = await res.json();
        points = data.pickupPoints || [];
      }
    } catch {
      /* offline */
    }
  }

  if (!points.length) return;

  section.classList.remove("hidden");
  list.innerHTML = points
    .map(
      (p) => `
    <div class="rounded-2xl border border-brand-purple/10 dark:border-white/10 bg-white/60 dark:bg-brand-purpleLight/40 p-4">
      <p class="font-bold">${escapeHtml(p.shopName)}</p>
      <p class="text-sm text-brand-purple/70 dark:text-white/70 mt-1">${escapeHtml(p.city)}, ${escapeHtml(p.county)}</p>
      ${p.openingHours ? `<p class="text-xs text-brand-purple/50 dark:text-white/50 mt-2">🕐 ${escapeHtml(p.openingHours)}</p>` : ""}
    </div>`
    )
    .join("");
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function submitApplication(event) {
  event.preventDefault();
  const status = el("form-status");
  const btn = el("submit-btn");
  if (status) status.textContent = "";

  const payload = {
    shopName: el("shopName")?.value.trim(),
    contactName: el("contactName")?.value.trim(),
    phone: el("phone")?.value.trim(),
    email: el("email")?.value.trim(),
    shopType: el("shopType")?.value,
    mpesaNumber: el("mpesaNumber")?.value.trim(),
    county: el("county")?.value,
    city: el("city")?.value.trim(),
    address: el("address")?.value.trim(),
    landmark: el("landmark")?.value.trim(),
    openingHours: el("openingHours")?.value.trim(),
    maxParcelsPerDay: el("maxParcelsPerDay")?.value,
    hasSecureStorage: el("hasSecureStorage")?.checked,
    hasCctv: el("hasCctv")?.checked,
    canCollectPayment: el("canCollectPayment")?.checked,
    notes: el("notes")?.value.trim(),
  };

  if (!payload.shopName || !payload.phone) {
    if (status) status.textContent = "Shop name and WhatsApp phone are required.";
    return;
  }
  if (!payload.county || !payload.city || !payload.address || !payload.openingHours) {
    if (status) status.textContent = "County, town, address, and opening hours are required.";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Submitting…";
  try {
    const res = await fetch(`${PICKUP_API}/apply`, {
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
    const box = el("success-box");
    const form = el("apply-form");
    if (box) {
      box.classList.remove("hidden");
      el("application-id").textContent = params.get("submitted");
    }
    if (form) form.classList.add("hidden");
    return;
  }

  el("apply-form")?.addEventListener("submit", submitApplication);
}

document.addEventListener("DOMContentLoaded", () => {
  loadInfo();
  loadActivePoints();
  if (document.body.dataset.page === "apply") initApplyPage();
});
