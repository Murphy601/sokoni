import { config } from "../config.js";
import { sendText } from "./whatsapp.js";
import { getCustomerMeta, setCustomerMeta, clearMenuState } from "./session.js";
import {
  createApplication,
  getApplication,
  SHOP_TYPES,
  KENYA_COUNTIES,
  COMMISSION_PER_PARCEL_KES,
} from "./pickupPoints.js";

const STEPS = {
  SHOP_NAME: "shop_name",
  CONTACT_NAME: "contact_name",
  EMAIL: "email",
  SHOP_TYPE: "shop_type",
  MPESA: "mpesa",
  COUNTY: "county",
  CITY: "city",
  ADDRESS: "address",
  LANDMARK: "landmark",
  OPENING_HOURS: "opening_hours",
  MAX_PARCELS: "max_parcels",
  SECURE_STORAGE: "secure_storage",
  CCTV: "cctv",
  COLLECT_PAYMENT: "collect_payment",
  NOTES: "notes",
  CONFIRM: "confirm",
};

function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

function freshDraft(phone = "") {
  return {
    shopName: "",
    contactName: "",
    phone: digitsOnly(phone),
    email: "",
    shopType: SHOP_TYPES[0],
    mpesaNumber: "",
    county: "",
    city: "",
    address: "",
    landmark: "",
    openingHours: "",
    maxParcelsPerDay: null,
    hasSecureStorage: true,
    hasCctv: false,
    canCollectPayment: true,
    notes: "",
  };
}

function draftFromApplication(app) {
  const s = app?.shop || {};
  return {
    shopName: s.name || "",
    contactName: s.contactName || "",
    phone: s.phone || "",
    email: s.email || "",
    shopType: s.shopType || SHOP_TYPES[0],
    mpesaNumber: s.mpesaNumber || "",
    county: s.county || "",
    city: s.city || "",
    address: s.address || "",
    landmark: s.landmark || "",
    openingHours: s.openingHours || "",
    maxParcelsPerDay: s.maxParcelsPerDay || null,
    hasSecureStorage: s.hasSecureStorage !== false,
    hasCctv: s.hasCctv === true,
    canCollectPayment: s.canCollectPayment !== false,
    notes: s.notes || "",
    sourceApplicationId: app?.id || null,
  };
}

function getOnboarding(customerKey) {
  return getCustomerMeta(customerKey)?.pickupOnboarding || null;
}

function setOnboarding(customerKey, onboarding) {
  setCustomerMeta(customerKey, { pickupOnboarding: onboarding });
}

function clearOnboarding(customerKey) {
  setCustomerMeta(customerKey, { pickupOnboarding: null });
  clearMenuState(customerKey);
}

function shopTypeMenu() {
  return SHOP_TYPES.map((t, i) => `${i + 1}. ${t}`).join("\n");
}

function countyMenu() {
  return KENYA_COUNTIES.slice(0, 10).map((c, i) => `${i + 1}. ${c}`).join("\n") + "\n…or type your county name";
}

function parseMenuChoice(text, list) {
  const t = String(text || "").trim();
  const n = Number(t);
  if (Number.isFinite(n) && n >= 1 && n <= list.length) return list[n - 1];
  const lower = t.toLowerCase();
  return list.find((x) => x.toLowerCase() === lower) || null;
}

function isYes(text) {
  return /^(yes|y|ndio|sawa|ok|keep)$/i.test(String(text || "").trim());
}

function prefillHint(value, label) {
  if (!value) return "";
  return `\n_From site:_ *${value}*\nReply *yes* to keep or send a new ${label}.`;
}

async function promptStep(customerKey, step, draft, { prefill = false } = {}) {
  switch (step) {
    case STEPS.SHOP_NAME:
      return sendText(
        customerKey,
        `📦 *Pickup point application* (step 1/10)\n\n` +
          `What is your *shop / business name*?${prefillHint(draft.shopName, "name")}\n\n` +
          `_Same flow as sokonimall.com/pickup-points — reply *cancel* anytime._`
      );
    case STEPS.CONTACT_NAME:
      return sendText(customerKey, `Step 2 — *Contact person*?${prefillHint(draft.contactName, "name")}\n_(Reply *skip* if N/A)_`);
    case STEPS.EMAIL:
      return sendText(customerKey, `Step 3 — *Email*?${prefillHint(draft.email, "email")}\n_(skip ok)_`);
    case STEPS.SHOP_TYPE:
      return sendText(
        customerKey,
        `Step 4 — *Shop type*${prefillHint(draft.shopType, "type")}\n\n${shopTypeMenu()}\n\n_Reply with the number._`
      );
    case STEPS.MPESA:
      return sendText(
        customerKey,
        `Step 5 — *M-Pesa number* for commissions?${prefillHint(draft.mpesaNumber, "number")}\n_(skip ok)_`
      );
    case STEPS.COUNTY:
      return sendText(
        customerKey,
        `Step 6 — *County*?${prefillHint(draft.county, "county")}\n\n${countyMenu()}`
      );
    case STEPS.CITY:
      return sendText(customerKey, `Step 7 — *Town / area*?${prefillHint(draft.city, "town")}`);
    case STEPS.ADDRESS:
      return sendText(customerKey, `Step 8 — *Street address / building*?${prefillHint(draft.address, "address")}`);
    case STEPS.LANDMARK:
      return sendText(customerKey, `Landmark near your shop?${prefillHint(draft.landmark, "landmark")}\n_(skip ok)_`);
    case STEPS.OPENING_HOURS:
      return sendText(
        customerKey,
        `Opening hours?${prefillHint(draft.openingHours, "hours")}\n_e.g. Mon–Sat 8am–7pm_`
      );
    case STEPS.MAX_PARCELS:
      return sendText(
        customerKey,
        `Max parcels per day (estimate)?${draft.maxParcelsPerDay ? `\n_From site:_ *${draft.maxParcelsPerDay}*` : ""}\n_(skip ok)_`
      );
    case STEPS.SECURE_STORAGE:
      return sendText(
        customerKey,
        `Secure locked storage for parcels?${prefill ? `\n_From site:_ *${draft.hasSecureStorage ? "yes" : "no"}*` : ""}\nReply *yes* or *no*.`
      );
    case STEPS.CCTV:
      return sendText(
        customerKey,
        `CCTV or staffed counter during hours?${prefill ? `\n_From site:_ *${draft.hasCctv ? "yes" : "no"}*` : ""}\nReply *yes* or *no*.`
      );
    case STEPS.COLLECT_PAYMENT:
      return sendText(
        customerKey,
        `Can you accept cash / M-Pesa from customers on collection?${prefill ? `\n_From site:_ *${draft.canCollectPayment ? "yes" : "no"}*` : ""}\nReply *yes* or *no*.`
      );
    case STEPS.NOTES:
      return sendText(customerKey, `Anything else we should know?${prefillHint(draft.notes, "note")}\n_(skip ok)_`);
    case STEPS.CONFIRM:
      return sendText(
        customerKey,
        `Step 10 — *Review & submit*\n\n` +
          `🏪 *${draft.shopName}*\n` +
          `📍 ${draft.city}, ${draft.county}\n` +
          `📌 ${draft.address}\n` +
          `🕐 ${draft.openingHours || "—"}\n` +
          `📞 +${draft.phone}\n` +
          `💰 KES ${COMMISSION_PER_PARCEL_KES}+ per parcel\n\n` +
          `Reply *submit* to send, or *cancel* to discard.`
      );
    default:
      return false;
  }
}

export function isInPickupOnboarding(customerKey) {
  return Boolean(getOnboarding(customerKey)?.step);
}

export async function startPickupOnboarding(customerKey, { phone = "", prefill = null } = {}) {
  const draft = prefill ? { ...freshDraft(phone), ...prefill } : freshDraft(phone);
  const onboarding = {
    step: STEPS.SHOP_NAME,
    draft,
    startedAt: Date.now(),
    prefillMode: Boolean(prefill && (prefill.shopName || prefill.county)),
  };
  setOnboarding(customerKey, onboarding);
  await promptStep(customerKey, STEPS.SHOP_NAME, draft, { prefill: onboarding.prefillMode });
  return true;
}

async function submitApplication(customerKey, draft) {
  const payload = {
    shopName: draft.shopName,
    contactName: draft.contactName,
    phone: draft.phone,
    email: draft.email,
    shopType: draft.shopType,
    mpesaNumber: draft.mpesaNumber,
    county: draft.county,
    city: draft.city,
    address: draft.address,
    landmark: draft.landmark,
    openingHours: draft.openingHours,
    maxParcelsPerDay: draft.maxParcelsPerDay,
    hasSecureStorage: draft.hasSecureStorage,
    hasCctv: draft.hasCctv,
    canCollectPayment: draft.canCollectPayment,
    notes: draft.notes,
  };

  const result = createApplication(payload);
  if (result.error) {
    await sendText(customerKey, `⚠️ Could not submit: ${result.error}. Reply *pickup menu* to try again.`);
    return false;
  }

  const app = result.application;
  if (config.admin.primary) {
    try {
      await sendText(
        config.admin.primary,
        `📦 *WhatsApp pickup application* ${app.id}\n` +
          `${app.shop.name} · +${app.shop.phone}\n` +
          `${app.shop.city}, ${app.shop.county}`
      );
    } catch {
      /* ignore */
    }
  }

  clearOnboarding(customerKey);
  await sendText(
    customerKey,
    `✅ *Application submitted!*\n\n` +
      `Reference: *${app.id}*\n` +
      `Earn KES ${COMMISSION_PER_PARCEL_KES}+ per parcel.\n` +
      `We'll WhatsApp you within 48 hours.`
  );
  return true;
}

function applyYesOrValue(text, current, minLen = 0) {
  if (isYes(text)) return current;
  const t = String(text || "").trim();
  if (lowerSkip(t)) return current;
  if (t.length >= minLen) return t;
  return null;
}

function lowerSkip(t) {
  return /^skip$/i.test(t);
}

function parseYesNo(text, fallback) {
  const lower = String(text || "").trim().toLowerCase();
  if (/^yes|y|ndio$/i.test(lower)) return true;
  if (/^no|n|hapana$/i.test(lower)) return false;
  return fallback;
}

/**
 * Continue from site application ref PP-2026-xxxx
 */
export async function tryPickupContinueFromRef(customerKey, text, { phone = "" } = {}) {
  if (!/\b(PP-\d{4}-\d{4})\b/i.test(String(text || "")) && !/pickup point application|pickup point on sokonimall/i.test(String(text || ""))) {
    return false;
  }
  const m = String(text || "").match(/\b(PP-\d{4}-\d{4})\b/i);
  if (!m) return false;
  const app = getApplication(m[1].toUpperCase());
  if (!app) {
    await sendText(customerKey, `No pickup application found for *${m[1]}*. Reply *pickup menu* to start fresh.`);
    return true;
  }
  await startPickupOnboarding(customerKey, { phone, prefill: draftFromApplication(app) });
  return true;
}

export async function handlePickupOnboarding(customerKey, text, { phone = "" } = {}) {
  const onboarding = getOnboarding(customerKey);
  if (!onboarding?.step) return false;

  const t = String(text || "").trim();
  const lower = t.toLowerCase();
  const { draft } = onboarding;
  const prefill = onboarding.prefillMode;

  if (/^cancel$/i.test(lower)) {
    clearOnboarding(customerKey);
    await sendText(customerKey, "Pickup application cancelled. Type *menu* to shop or *pickup menu* to apply later.");
    return true;
  }

  if (!t) return false;

  switch (onboarding.step) {
    case STEPS.SHOP_NAME: {
      const v = applyYesOrValue(t, draft.shopName, 2);
      if (!v) {
        await sendText(customerKey, "Send your shop name (2+ characters) or *yes* to keep the site value.");
        return true;
      }
      draft.shopName = v;
      if (!draft.phone && phone) draft.phone = digitsOnly(phone);
      onboarding.step = STEPS.CONTACT_NAME;
      break;
    }
    case STEPS.CONTACT_NAME:
      draft.contactName = lowerSkip(lower) ? "" : isYes(t) ? draft.contactName : t;
      onboarding.step = STEPS.EMAIL;
      break;
    case STEPS.EMAIL:
      draft.email = lowerSkip(lower) ? "" : isYes(t) ? draft.email : t;
      onboarding.step = STEPS.SHOP_TYPE;
      break;
    case STEPS.SHOP_TYPE: {
      const type = isYes(t) && draft.shopType ? draft.shopType : parseMenuChoice(t, SHOP_TYPES);
      if (!type) {
        await sendText(customerKey, `Reply with a number 1–${SHOP_TYPES.length}, or the shop type name.`);
        return true;
      }
      draft.shopType = type;
      onboarding.step = STEPS.MPESA;
      break;
    }
    case STEPS.MPESA:
      draft.mpesaNumber = lowerSkip(lower) ? "" : isYes(t) ? draft.mpesaNumber : digitsOnly(t);
      onboarding.step = STEPS.COUNTY;
      break;
    case STEPS.COUNTY: {
      const county = isYes(t) && draft.county ? draft.county : parseMenuChoice(t, KENYA_COUNTIES) || (t.length >= 2 ? t : null);
      if (!county) {
        await sendText(customerKey, "Send your county name or pick from the list.");
        return true;
      }
      draft.county = county;
      onboarding.step = STEPS.CITY;
      break;
    }
    case STEPS.CITY: {
      const v = applyYesOrValue(t, draft.city, 2);
      if (!v) {
        await sendText(customerKey, "Send your town/area or *yes* to keep the site value.");
        return true;
      }
      draft.city = v;
      onboarding.step = STEPS.ADDRESS;
      break;
    }
    case STEPS.ADDRESS: {
      const v = applyYesOrValue(t, draft.address, 3);
      if (!v) {
        await sendText(customerKey, "Send your street address or *yes* to keep the site value.");
        return true;
      }
      draft.address = v;
      onboarding.step = STEPS.LANDMARK;
      break;
    }
    case STEPS.LANDMARK:
      draft.landmark = lowerSkip(lower) ? "" : isYes(t) ? draft.landmark : t;
      onboarding.step = STEPS.OPENING_HOURS;
      break;
    case STEPS.OPENING_HOURS: {
      const v = applyYesOrValue(t, draft.openingHours, 3);
      if (!v) {
        await sendText(customerKey, "Send opening hours or *yes* to keep the site value.");
        return true;
      }
      draft.openingHours = v;
      onboarding.step = STEPS.MAX_PARCELS;
      break;
    }
    case STEPS.MAX_PARCELS:
      if (lowerSkip(lower)) draft.maxParcelsPerDay = null;
      else if (isYes(t) && draft.maxParcelsPerDay) {
        /* keep */
      } else {
        const n = Number(t.replace(/\D/g, ""));
        draft.maxParcelsPerDay = Number.isFinite(n) && n > 0 ? n : null;
      }
      onboarding.step = STEPS.SECURE_STORAGE;
      break;
    case STEPS.SECURE_STORAGE:
      draft.hasSecureStorage = parseYesNo(t, draft.hasSecureStorage);
      onboarding.step = STEPS.CCTV;
      break;
    case STEPS.CCTV:
      draft.hasCctv = parseYesNo(t, draft.hasCctv);
      onboarding.step = STEPS.COLLECT_PAYMENT;
      break;
    case STEPS.COLLECT_PAYMENT:
      draft.canCollectPayment = parseYesNo(t, draft.canCollectPayment);
      onboarding.step = STEPS.NOTES;
      break;
    case STEPS.NOTES:
      draft.notes = lowerSkip(lower) ? "" : isYes(t) ? draft.notes : t;
      onboarding.step = STEPS.CONFIRM;
      break;
    case STEPS.CONFIRM:
      if (/^submit$/i.test(lower)) return submitApplication(customerKey, draft);
      await sendText(customerKey, "Reply *submit* to send your application, or *cancel* to discard.");
      return true;
    default:
      return false;
  }

  setOnboarding(customerKey, onboarding);
  await promptStep(customerKey, onboarding.step, draft, { prefill });
  return true;
}
