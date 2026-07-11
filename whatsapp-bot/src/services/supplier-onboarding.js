import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { sendText, downloadWahaMedia } from "./whatsapp.js";
import { getCustomerMeta, setCustomerMeta, clearMenuState } from "./session.js";
import { createApplication, SUPPLIER_CATEGORIES, getApplication } from "./suppliers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = path.join(__dirname, "..", "..", "data", "supplier-application-media");

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

const STEPS = {
  BUSINESS_NAME: "business_name",
  CONTACT_NAME: "contact_name",
  EMAIL: "email",
  CITY: "city",
  DELIVERS: "delivers",
  DELIVERY_AREAS: "delivery_areas",
  DELIVERY_NOTE: "delivery_note",
  PRODUCT_NAME: "product_name",
  PRODUCT_CATEGORY: "product_category",
  PRODUCT_PRICE: "product_price",
  PRODUCT_DESC: "product_desc",
  PRODUCT_PHOTO: "product_photo",
  MORE_PRODUCTS: "more_products",
  DOCUMENTS: "documents",
  CONFIRM: "confirm",
};

function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

function freshDraft(phone = "") {
  return {
    business: {
      name: "",
      contactName: "",
      phone: digitsOnly(phone),
      email: "",
      city: "",
      delivers: false,
      deliveryAreas: "Countrywide",
      deliveryNote: "",
    },
    products: [],
    documents: [],
    currentProduct: {},
  };
}

function getOnboarding(customerKey) {
  return getCustomerMeta(customerKey)?.supplierOnboarding || null;
}

function setOnboarding(customerKey, onboarding) {
  setCustomerMeta(customerKey, { supplierOnboarding: onboarding });
}

function clearOnboarding(customerKey) {
  setCustomerMeta(customerKey, { supplierOnboarding: null });
  clearMenuState(customerKey);
}

function categoryMenuText() {
  const lines = SUPPLIER_CATEGORIES.map((c, i) => `${i + 1}. ${CATEGORY_LABELS[c] || c}`);
  return lines.join("\n");
}

function parseCategoryChoice(text) {
  const t = String(text || "").trim();
  const n = Number(t);
  if (Number.isFinite(n) && n >= 1 && n <= SUPPLIER_CATEGORIES.length) {
    return SUPPLIER_CATEGORIES[n - 1];
  }
  const lower = t.toLowerCase();
  return SUPPLIER_CATEGORIES.find((c) => c === lower || (CATEGORY_LABELS[c] || "").toLowerCase() === lower) || null;
}

function parsePrice(text) {
  const m = String(text || "").replace(/,/g, "").match(/(\d[\d\s]*\d|\d+)/);
  return m ? Number(m[1].replace(/\s/g, "")) : null;
}

function isYes(text) {
  return /^(yes|y|ndio|sawa|ok|keep)$/i.test(String(text || "").trim());
}

function prefillHint(value, label) {
  if (!value) return "";
  return `\n_From site:_ *${value}*\nReply *yes* to keep or send a new ${label}.`;
}

function draftFromApplication(app) {
  const b = app?.business || {};
  const products = (app?.products || []).map((p) => ({
    sku: p.sku,
    name: p.name,
    category: p.category,
    supplierPriceKes: p.supplierPriceKes,
    description: p.description || "",
    inStock: p.inStock !== false,
    hasPhoto: p.hasPhoto === true,
  }));
  return {
    business: {
      name: b.name || "",
      contactName: b.contactName || "",
      phone: b.phone || "",
      email: b.email || "",
      city: b.city || "",
      delivers: b.delivers === true,
      deliveryAreas: b.deliveryAreas || "Countrywide",
      deliveryNote: b.deliveryNote || "",
    },
    products,
    documents: [],
    currentProduct: {},
    sourceApplicationId: app?.id || null,
  };
}

async function promptStep(customerKey, step, draft, { prefill = false } = {}) {
  switch (step) {
    case STEPS.BUSINESS_NAME:
      return sendText(
        customerKey,
        `🏪 *Supplier application* (step 1/10)\n\n` +
          `What is your *business name*?${prefillHint(draft.business.name, "name")}\n` +
          `_Same details as sokonimall.com/suppliers — one question at a time._\n\n` +
          `Reply *cancel* anytime to stop.`
      );
    case STEPS.CONTACT_NAME:
      return sendText(
        customerKey,
        `Step 2 — *Contact person* name?${prefillHint(draft.business.contactName, "name")}\n\n_Reply *skip* if not applicable._`
      );
    case STEPS.EMAIL:
      return sendText(customerKey, `Step 3 — *Email* for invoices?${prefillHint(draft.business.email, "email")} _(skip ok)_`);
    case STEPS.CITY:
      return sendText(customerKey, `Step 4 — *City / town* you operate from?${prefillHint(draft.business.city, "city")}`);
    case STEPS.DELIVERS:
      return sendText(
        customerKey,
        `Step 5 — Can you *deliver* to buyers in some areas?${prefill ? `\n_From site:_ *${draft.business.delivers ? "yes" : "no"}*` : ""}\n\nReply *yes* or *no*.\n_(No = hub / pickup coordination only.)_`
      );
    case STEPS.DELIVERY_AREAS:
      return sendText(
        customerKey,
        `Step 6 — Which *areas* do you deliver?${prefillHint(draft.business.deliveryAreas, "areas")}\n\n_e.g. Kisumu town, Milimani, highway corridor_`
      );
    case STEPS.DELIVERY_NOTE:
      return sendText(
        customerKey,
        `Step 7 — Any *delivery notes*?${prefillHint(draft.business.deliveryNote, "note")} _(minimum order, same-day, etc. — or reply skip)_`
      );
    case STEPS.PRODUCT_NAME:
      return sendText(
        customerKey,
        `Step 8 — *Product ${draft.products.length + 1}*\n\nWhat is the *product name*?${prefillHint(draft.currentProduct.name, "name")}`
      );
    case STEPS.PRODUCT_CATEGORY:
      return sendText(
        customerKey,
        `Pick a *category* for *${draft.currentProduct.name}*:\n\n${categoryMenuText()}\n\n_Reply with the number._`
      );
    case STEPS.PRODUCT_PRICE:
      return sendText(
        customerKey,
        `Your *supply price* (KES) for *${draft.currentProduct.name}*?\n\n_Sokoni sets retail = cost + KES 100 + 8%._`
      );
    case STEPS.PRODUCT_DESC:
      return sendText(
        customerKey,
        `Short *description*? _(colour, size, specs — or reply skip)_`
      );
    case STEPS.PRODUCT_PHOTO:
      return sendText(
        customerKey,
        `Send a *product photo* now _(optional)_ — or reply *skip* to continue.`
      );
    case STEPS.MORE_PRODUCTS:
      return sendText(
        customerKey,
        `✅ Product saved: *${draft.products[draft.products.length - 1]?.name}*\n\n` +
          `Add *another product*?\n\nReply *yes* or *no* to continue.`
      );
    case STEPS.DOCUMENTS:
      return sendText(
        customerKey,
        `Step 9 — *Documents* _(optional)_\n\n` +
          `Send photos or PDFs (business permit, ID, shop photo).\n` +
          `You can send several files, then reply *done*.\n\n` +
          `Reply *skip* if you have none right now.`
      );
    case STEPS.CONFIRM: {
      const lines = draft.products.map(
        (p, i) =>
          `${i + 1}. ${p.name} — ${CATEGORY_LABELS[p.category] || p.category} — supply KES ${p.supplierPriceKes?.toLocaleString()}`
      );
      return sendText(
        customerKey,
        `Step 10 — *Review & submit*\n\n` +
          `🏢 *${draft.business.name}*\n` +
          `📍 ${draft.business.city} · Delivers: ${draft.business.delivers ? "yes" : "no"}\n` +
          `📞 ${draft.business.phone}\n\n` +
          `*Products (${draft.products.length}):*\n${lines.join("\n")}\n\n` +
          `Documents: ${draft.documents.length || "none"}\n\n` +
          `Reply *submit* to send to Sokoni, or *cancel* to discard.`
      );
    }
    default:
      return false;
  }
}

export function isInSupplierOnboarding(customerKey) {
  return Boolean(getOnboarding(customerKey)?.step);
}

export async function startSupplierOnboarding(customerKey, { phone = "", prefill = null } = {}) {
  const draft = prefill ? { ...freshDraft(phone), ...prefill, business: { ...freshDraft(phone).business, ...(prefill.business || {}) } } : freshDraft(phone);
  if (prefill?.products?.length && !draft.currentProduct?.name) {
    draft.currentProduct = { ...prefill.products[0] };
    draft.products = [];
  }
  const onboarding = {
    step: STEPS.BUSINESS_NAME,
    draft,
    startedAt: Date.now(),
    prefillMode: Boolean(prefill && (prefill.business?.name || prefill.products?.length)),
  };
  setOnboarding(customerKey, onboarding);
  await promptStep(customerKey, STEPS.BUSINESS_NAME, onboarding.draft, { prefill: onboarding.prefillMode });
  return true;
}

export async function trySupplierContinueFromRef(customerKey, text, { phone = "" } = {}) {
  if (!/\b(SUP-\d{4}-\d{4})\b/i.test(String(text || "")) && !/supplier application|supplier on sokonimall/i.test(String(text || ""))) {
    return false;
  }
  const m = String(text || "").match(/\b(SUP-\d{4}-\d{4})\b/i);
  if (!m) return false;
  const app = getApplication(m[1].toUpperCase());
  if (!app) {
    await sendText(customerKey, `No supplier application found for *${m[1]}*. Reply *vendor menu* to start fresh.`);
    return true;
  }
  await startSupplierOnboarding(customerKey, { phone, prefill: draftFromApplication(app) });
  return true;
}

async function saveDocument(customerKey, buffer, { mimetype = "", filename = "doc" } = {}) {
  if (!existsSync(MEDIA_DIR)) await mkdir(MEDIA_DIR, { recursive: true });
  const safe = digitsOnly(customerKey) || "unknown";
  const ext = String(mimetype).includes("pdf") ? "pdf" : "jpg";
  const name = `${safe}-${Date.now()}-${filename.replace(/\W/g, "_")}.${ext}`;
  const filePath = path.join(MEDIA_DIR, name);
  await writeFile(filePath, buffer);
  return { filename: name, path: filePath, mimetype };
}

async function submitApplication(customerKey, draft) {
  const payload = {
    businessName: draft.business.name,
    contactName: draft.business.contactName,
    phone: draft.business.phone,
    email: draft.business.email,
    city: draft.business.city,
    delivers: draft.business.delivers,
    deliveryAreas: draft.business.deliveryAreas,
    deliveryNote: draft.business.deliveryNote,
    products: draft.products.map((p) => ({
      sku: p.sku || `wa-${Date.now().toString(36)}`,
      name: p.name,
      category: p.category,
      supplierPriceKes: p.supplierPriceKes,
      description: p.description || "",
      inStock: true,
      hasPhoto: p.hasPhoto === true,
    })),
  };

  const result = createApplication(payload);
  if (result.error) {
    await sendText(customerKey, `⚠️ Could not submit: ${result.error}. Reply *vendor menu* to try again.`);
    return false;
  }

  const app = result.application;
  if (config.admin.primary) {
    try {
      await sendText(
        config.admin.primary,
        `🏪 *WhatsApp supplier application* ${app.id}\n` +
          `${app.business.name} · +${app.business.phone}\n` +
          `${app.business.city} · ${app.products.length} product(s)\n` +
          `Docs on server: ${draft.documents.length}\n\n` +
          `Approve via admin API when ready.`
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
      `We'll WhatsApp you within 48 hours.\n\n` +
      `Type *vendor menu* after approval to manage listings.`
  );
  return true;
}

/**
 * Step-by-step supplier onboarding. Returns true if the message was consumed.
 */
export async function handleSupplierOnboarding(
  customerKey,
  text,
  { phone = "", hasMedia = false, mediaUrl, mediaMimetype, messageId, chatId, session } = {}
) {
  const onboarding = getOnboarding(customerKey);
  if (!onboarding?.step) return false;

  const t = String(text || "").trim();
  const lower = t.toLowerCase();

  if (/^cancel$/i.test(lower)) {
    clearOnboarding(customerKey);
    await sendText(customerKey, "Supplier application cancelled. Type *menu* to shop or *vendor menu* to apply later.");
    return true;
  }

  const { draft } = onboarding;
  const prefill = onboarding.prefillMode;

  if (hasMedia && onboarding.step === STEPS.DOCUMENTS) {
    try {
      const buffer = await downloadWahaMedia(mediaUrl, { messageId, chatId, session, mimetype: mediaMimetype });
      const saved = await saveDocument(customerKey, buffer, { mimetype: mediaMimetype });
      draft.documents.push(saved);
      await sendText(customerKey, `📎 Saved (${draft.documents.length} file${draft.documents.length === 1 ? "" : "s"}). Send more or reply *done*.`);
    } catch (err) {
      await sendText(customerKey, `⚠️ Could not save file: ${err.message}. Try again or reply *skip*.`);
    }
    return true;
  }

  if (hasMedia && onboarding.step === STEPS.PRODUCT_PHOTO) {
    try {
      const buffer = await downloadWahaMedia(mediaUrl, { messageId, chatId, session, mimetype: mediaMimetype });
      const saved = await saveDocument(customerKey, buffer, { mimetype: mediaMimetype, filename: "product" });
      draft.currentProduct.hasPhoto = true;
      draft.currentProduct.photoFile = saved.filename;
      draft.products.push({ ...draft.currentProduct });
      draft.currentProduct = {};
      onboarding.step = STEPS.MORE_PRODUCTS;
      setOnboarding(customerKey, onboarding);
      await promptStep(customerKey, STEPS.MORE_PRODUCTS, draft);
    } catch (err) {
      await sendText(customerKey, `⚠️ Photo not saved — reply *skip* to continue without it.`);
    }
    return true;
  }

  if (!t && !hasMedia) return false;

  switch (onboarding.step) {
    case STEPS.BUSINESS_NAME:
      if (isYes(t) && draft.business.name) {
        /* keep */
      } else if (t.length < 2) {
        await sendText(customerKey, "Please send your business name (at least 2 characters) or *yes* to keep the site value.");
        return true;
      } else {
        draft.business.name = t;
      }
      if (!draft.business.phone && phone) draft.business.phone = digitsOnly(phone);
      onboarding.step = STEPS.CONTACT_NAME;
      break;
    case STEPS.CONTACT_NAME:
      draft.business.contactName = lower === "skip" ? "" : isYes(t) ? draft.business.contactName : t;
      onboarding.step = STEPS.EMAIL;
      break;
    case STEPS.EMAIL:
      draft.business.email = lower === "skip" ? "" : isYes(t) ? draft.business.email : t;
      onboarding.step = STEPS.CITY;
      break;
    case STEPS.CITY:
      if (isYes(t) && draft.business.city) {
        /* keep */
      } else if (t.length < 2) {
        await sendText(customerKey, "Please send your city or town, or *yes* to keep the site value.");
        return true;
      } else {
        draft.business.city = t;
      }
      onboarding.step = STEPS.DELIVERS;
      break;
    case STEPS.DELIVERS:
      if (/^yes|y|ndio$/i.test(lower)) draft.business.delivers = true;
      else if (/^no|n|hapana$/i.test(lower)) draft.business.delivers = false;
      else {
        await sendText(customerKey, "Reply *yes* or *no*.");
        return true;
      }
      onboarding.step = draft.business.delivers ? STEPS.DELIVERY_AREAS : STEPS.DELIVERY_NOTE;
      if (!draft.business.delivers) {
        draft.business.deliveryAreas = "Pickup / hub only";
      }
      break;
    case STEPS.DELIVERY_AREAS:
      draft.business.deliveryAreas = isYes(t) ? draft.business.deliveryAreas : t;
      onboarding.step = STEPS.DELIVERY_NOTE;
      break;
    case STEPS.DELIVERY_NOTE:
      draft.business.deliveryNote = lower === "skip" ? "" : isYes(t) ? draft.business.deliveryNote : t;
      onboarding.step = STEPS.PRODUCT_NAME;
      break;
    case STEPS.PRODUCT_NAME:
      if (isYes(t) && draft.currentProduct.name) {
        /* keep */
      } else {
        draft.currentProduct = { name: t };
      }
      onboarding.step = STEPS.PRODUCT_CATEGORY;
      break;
    case STEPS.PRODUCT_CATEGORY: {
      if (isYes(t) && draft.currentProduct.category) {
        onboarding.step = STEPS.PRODUCT_PRICE;
        break;
      }
      const cat = parseCategoryChoice(t);
      if (!cat) {
        await sendText(customerKey, `Reply with a number 1–${SUPPLIER_CATEGORIES.length}, or the category slug.`);
        return true;
      }
      draft.currentProduct.category = cat;
      onboarding.step = STEPS.PRODUCT_PRICE;
      break;
    }
    case STEPS.PRODUCT_PRICE: {
      if (isYes(t) && draft.currentProduct.supplierPriceKes) {
        onboarding.step = STEPS.PRODUCT_DESC;
        break;
      }
      const price = parsePrice(t);
      if (!price || price <= 0) {
        await sendText(customerKey, "Send a valid supply price in KES (e.g. 3500).");
        return true;
      }
      draft.currentProduct.supplierPriceKes = price;
      onboarding.step = STEPS.PRODUCT_DESC;
      break;
    }
    case STEPS.PRODUCT_DESC:
      draft.currentProduct.description = lower === "skip" ? "" : isYes(t) ? draft.currentProduct.description || "" : t;
      onboarding.step = STEPS.PRODUCT_PHOTO;
      setOnboarding(customerKey, onboarding);
      await promptStep(customerKey, STEPS.PRODUCT_PHOTO, draft, { prefill });
      return true;
    case STEPS.PRODUCT_PHOTO:
      if (lower === "skip") {
        draft.products.push({ ...draft.currentProduct });
        draft.currentProduct = {};
        onboarding.step = STEPS.MORE_PRODUCTS;
      } else {
        await sendText(customerKey, "Send a photo now, or reply *skip*.");
        return true;
      }
      break;
    case STEPS.MORE_PRODUCTS:
      if (/^yes|y|ndio|another|add$/i.test(lower)) {
        onboarding.step = STEPS.PRODUCT_NAME;
      } else if (/^no|n|hapana|done$/i.test(lower)) {
        onboarding.step = STEPS.DOCUMENTS;
      } else {
        await sendText(customerKey, "Reply *yes* to add another product, or *no* to continue.");
        return true;
      }
      break;
    case STEPS.DOCUMENTS:
      if (lower === "skip") {
        onboarding.step = STEPS.CONFIRM;
      } else if (lower === "done") {
        onboarding.step = STEPS.CONFIRM;
      } else {
        await sendText(customerKey, "Send a document photo/PDF, reply *done* when finished, or *skip*.");
        return true;
      }
      break;
    case STEPS.CONFIRM:
      if (/^submit$/i.test(lower)) {
        return submitApplication(customerKey, draft);
      }
      await sendText(customerKey, "Reply *submit* to send your application, or *cancel* to discard.");
      return true;
    default:
      return false;
  }

  setOnboarding(customerKey, onboarding);
  await promptStep(customerKey, onboarding.step, draft, { prefill });
  return true;
}
