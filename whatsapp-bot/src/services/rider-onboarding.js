/**
 * Rider application, completed entirely on WhatsApp.
 *
 * Same destination as website/boda/apply.html: both end at
 * registerRiderApplication and write the same rider row with the same PENDING
 * status, so ops vets one queue regardless of where the applicant started.
 * Docs land in data/boda-docs and are served from /assets/boda-docs, exactly
 * as multer does for the web form.
 *
 * Riders often do not have data for a web form but always have WhatsApp, so
 * the chat path has to collect everything the form does -- not hand over a
 * link and hope.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { sendText, downloadWahaMedia } from "./whatsapp.js";
import { getCustomerMeta, setCustomerMeta, clearMenuState } from "./session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Same directory the web form's multer writes to. */
const BODA_DOCS_DIR = path.join(__dirname, "..", "..", "data", "boda-docs");

export const RIDER_STEPS = {
  PHONE: "phone",
  FULL_NAME: "full_name",
  NATIONAL_ID: "national_id",
  TOWN: "town",
  STAGE: "stage",
  PLATE: "plate",
  GUARANTOR_NAME: "guarantor_name",
  GUARANTOR_PHONE: "guarantor_phone",
  DOC_ID_FRONT: "doc_id_front",
  DOC_ID_BACK: "doc_id_back",
  DOC_LICENCE: "doc_licence",
  DOC_STAGE_LETTER: "doc_stage_letter",
  DOC_EXTRAS: "doc_extras",
  CONFIRM: "confirm",
};

/** Ordered so "back" and progress counting need no separate table. */
const STEP_ORDER = [
  RIDER_STEPS.PHONE,
  RIDER_STEPS.FULL_NAME,
  RIDER_STEPS.NATIONAL_ID,
  RIDER_STEPS.TOWN,
  RIDER_STEPS.STAGE,
  RIDER_STEPS.PLATE,
  RIDER_STEPS.GUARANTOR_NAME,
  RIDER_STEPS.GUARANTOR_PHONE,
  RIDER_STEPS.DOC_ID_FRONT,
  RIDER_STEPS.DOC_ID_BACK,
  RIDER_STEPS.DOC_LICENCE,
  RIDER_STEPS.DOC_STAGE_LETTER,
  RIDER_STEPS.DOC_EXTRAS,
  RIDER_STEPS.CONFIRM,
];

/** Extra documents the applicant may add at the end, in order of usefulness. */
const EXTRA_DOCS = [
  { key: "logbookUrl", label: "Logbook / power of attorney" },
  { key: "goodConductUrl", label: "Good Conduct certificate (DCI)" },
  { key: "ntsaBadgeUrl", label: "NTSA badge / registration" },
];

function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

export function stepNumber(step) {
  const i = STEP_ORDER.indexOf(step);
  return i < 0 ? 0 : i + 1;
}

export const RIDER_STEP_COUNT = STEP_ORDER.length;

function freshDraft(phone = "") {
  return {
    phone: phone || "",
    fullName: "",
    nationalId: "",
    operatingTown: "",
    stageLocation: "",
    motorbikePlate: "",
    guarantorName: "",
    guarantorPhone: "",
    nationalIdFrontUrl: "",
    nationalIdBackUrl: "",
    licenseUrl: "",
    stageLetterUrl: "",
    logbookUrl: "",
    goodConductUrl: "",
    ntsaBadgeUrl: "",
    extraIndex: 0,
  };
}

function getFlow(customerKey) {
  return getCustomerMeta(customerKey)?.riderOnboarding || null;
}

function setFlow(customerKey, flow) {
  setCustomerMeta(customerKey, { riderOnboarding: flow });
}

function clearFlow(customerKey) {
  setCustomerMeta(customerKey, { riderOnboarding: null });
  clearMenuState(customerKey);
}

export function isInRiderOnboarding(customerKey) {
  return Boolean(getFlow(customerKey)?.step);
}

/**
 * Text that starts the chat flow rather than sending someone to the website.
 * Kept as wide as the seller trigger: a bare "ride"/"rider"/"boda" has to work,
 * because that is the word on the site's Buy/Sell/Ride toggle and it is what
 * applicants actually type. Anchored, so "where is my rider" still reaches the
 * order-tracking path.
 */
export function isRiderApplyCommand(text) {
  return /^\s*(ride|rider|boda|bodaboda|boda\s*boda|(rider|boda)\s*(apply|application|signup|sign\s*up|menu)|apply\s*(as\s*(a\s*)?)?(rider|boda)|become\s*a\s*(rider|boda)|start\s*riding|ride\s*for\s*sokoni|deliver\s*for\s*sokoni|rider\s*application\s*here)\s*$/i.test(
    String(text || "")
  );
}

export function normalizeTownChoice(text) {
  const t = String(text || "").trim().toLowerCase();
  if (t === "1" || /\b(nairobi|nbi|nrb)\b/.test(t)) return "NAIROBI";
  if (t === "2" || /\bthika\b/.test(t)) return "THIKA";
  return null;
}

function isSkip(text) {
  return /^\s*(skip|none|hakuna|no)\s*$/i.test(String(text || ""));
}

function isDone(text) {
  return /^\s*(done|finish|hiyo ni yote|that'?s all)\s*$/i.test(String(text || ""));
}

/** Kenyan plates are loose in practice; keep it permissive but non-empty. */
export function normalizePlate(text) {
  return String(text || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .slice(0, 32);
}

async function saveRiderDoc(customerKey, buffer, { mimetype = "", field = "doc" } = {}) {
  if (!existsSync(BODA_DOCS_DIR)) await mkdir(BODA_DOCS_DIR, { recursive: true });
  const safeField = String(field).replace(/[^a-zA-Z0-9_-]/g, "");
  const ext = String(mimetype).includes("pdf")
    ? "pdf"
    : String(mimetype).includes("png")
      ? "png"
      : "jpg";
  const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const name = `${safeField}-wa-${digitsOnly(customerKey) || "x"}-${unique}.${ext}`;
  await writeFile(path.join(BODA_DOCS_DIR, name), buffer);
  const base = (config.botPublicUrl || "https://bot.sokonimall.com").replace(/\/$/, "");
  return `${base}/assets/boda-docs/${encodeURIComponent(name)}`;
}

/** Prompt for a step. Kept as data so tests can assert every step speaks. */
export function promptFor(step, draft = {}) {
  const n = stepNumber(step);
  const head = `*Rider application — step ${n}/${RIDER_STEP_COUNT}*\n\n`;
  switch (step) {
    case RIDER_STEPS.PHONE:
      return (
        head +
        `Which number should Sokoni use for job offers and M-Pesa payouts?\n\n` +
        (draft.phone ? `Reply *yes* to use *${draft.phone}*, or send a different number.` : `Send the number.`)
      );
    case RIDER_STEPS.FULL_NAME:
      return head + `Your *full name*, exactly as it appears on your National ID.`;
    case RIDER_STEPS.NATIONAL_ID:
      return head + `Your *National ID number*.`;
    case RIDER_STEPS.TOWN:
      return head + `Where will you ride?\n\n*1* Nairobi\n*2* Thika\n\n_Reply 1 or 2._`;
    case RIDER_STEPS.STAGE:
      return head + `Your *base stage* or area — for example: Kenyatta Market stage, Nairobi.`;
    case RIDER_STEPS.PLATE:
      return head + `Your *motorbike registration plate* — for example: KMGB 123X.`;
    case RIDER_STEPS.GUARANTOR_NAME:
      return head + `Name of a *guarantor* (stage chairman or someone who vouches for you).\n\n_Reply *skip* if you do not have one yet._`;
    case RIDER_STEPS.GUARANTOR_PHONE:
      return head + `Guarantor's *phone number*.\n\n_Reply *skip* to leave it out._`;
    case RIDER_STEPS.DOC_ID_FRONT:
      return head + `📷 Send a photo of your *National ID — front*.\n\n_Required._`;
    case RIDER_STEPS.DOC_ID_BACK:
      return head + `📷 Send a photo of your *National ID — back*.\n\n_Reply *skip* to leave it out._`;
    case RIDER_STEPS.DOC_LICENCE:
      return head + `📷 Send a photo of your *driving licence (Class A)*.\n\n_Required._`;
    case RIDER_STEPS.DOC_STAGE_LETTER:
      return head + `📷 Send a photo of your *stage chairman recommendation letter*.\n\n_Required._`;
    case RIDER_STEPS.DOC_EXTRAS: {
      const extra = EXTRA_DOCS[draft.extraIndex || 0];
      if (!extra) return head + `Reply *done* to review your application.`;
      return head + `📷 Optional: *${extra.label}*.\n\n_Send the photo, or reply *skip*._`;
    }
    case RIDER_STEPS.CONFIRM:
      return summaryText(draft);
    default:
      return head;
  }
}

export function summaryText(draft = {}) {
  const line = (label, value) => `• *${label}:* ${value || "—"}`;
  const docs = [
    draft.nationalIdFrontUrl ? "ID front ✅" : "ID front ❌",
    draft.nationalIdBackUrl ? "ID back ✅" : "ID back —",
    draft.licenseUrl ? "Licence ✅" : "Licence ❌",
    draft.stageLetterUrl ? "Stage letter ✅" : "Stage letter ❌",
    draft.logbookUrl ? "Logbook ✅" : null,
    draft.goodConductUrl ? "Good conduct ✅" : null,
    draft.ntsaBadgeUrl ? "NTSA ✅" : null,
  ].filter(Boolean);

  return (
    `*Check your application*\n\n` +
    [
      line("Name", draft.fullName),
      line("Phone", draft.phone),
      line("National ID", draft.nationalId),
      line("Town", draft.operatingTown),
      line("Stage", draft.stageLocation),
      line("Plate", draft.motorbikePlate),
      line("Guarantor", draft.guarantorName),
    ].join("\n") +
    `\n\n📎 ${docs.join(" · ")}\n\n` +
    `Reply *submit* to send it to Sokoni ops, *restart* to start again, or *cancel* to stop.`
  );
}

/** Advance, skipping nothing — order is fixed so progress is honest. */
function nextStep(step) {
  const i = STEP_ORDER.indexOf(step);
  return STEP_ORDER[i + 1] || RIDER_STEPS.CONFIRM;
}

/**
 * Status reply for someone who already has a rider row, so a verified rider
 * typing "ride" gets their standing instead of 14 steps ending in a rejection.
 * Returns null when the phone is new, or on any lookup failure -- a database
 * hiccup must not block a genuine applicant.
 */
async function existingRiderReply(phone) {
  if (!phone) return null;
  try {
    const { isDbEnabled, query } = await import("../db/pool.js");
    if (!isDbEnabled()) return null;
    const r = await query(
      `SELECT verification_status FROM riders WHERE phone = $1 LIMIT 1`,
      [phone]
    );
    const status = r.rows[0]?.verification_status;
    if (!status) return null;
    if (status === "VERIFIED")
      return (
        `✅ You're already a verified Sokoni rider.

` +
        `Reply *AVAILABLE* to go online, *OFFLINE* to stop receiving jobs.`
      );
    if (status === "PENDING")
      return (
        `⏳ Your rider application is already in and under review.

` +
        `Ops usually decide within 24 hours — you'll get a message here either way.`
      );
    if (status === "SUSPENDED")
      return `⛔ This rider profile is suspended. Contact Sokoni support before re-applying.`;
    return null; // REJECTED and anything else: let them apply again
  } catch (err) {
    console.warn("[rider-onboarding] status lookup skipped:", err.message);
    return null;
  }
}

export async function startRiderOnboarding(customerKey, { phone = "" } = {}) {
  const already = await existingRiderReply(phone);
  if (already) {
    await sendText(customerKey, already);
    return true;
  }
  const draft = freshDraft(phone);
  setFlow(customerKey, { step: RIDER_STEPS.PHONE, draft });
  await sendText(
    customerKey,
    `🛵 *Become a Sokoni rider*\n\n` +
      `I'll take your application right here — about 2 minutes.\n` +
      `You'll need your *National ID*, *Class A licence* and a *stage chairman letter* as photos.\n\n` +
      `Reply *cancel* anytime to stop.\n\n` +
      promptFor(RIDER_STEPS.PHONE, draft)
  );
  return true;
}

/**
 * Handle one inbound message while a rider application is open.
 * @returns {Promise<boolean>} true when the message was consumed
 */
export async function handleRiderOnboarding(
  customerKey,
  text,
  { phone = "", hasMedia = false, mediaUrl, mediaMimetype, messageId, chatId, session } = {}
) {
  const flow = getFlow(customerKey);
  if (!flow?.step) return false;

  const t = String(text || "").trim();
  const { draft, step } = flow;

  if (/^\s*cancel\s*$/i.test(t)) {
    clearFlow(customerKey);
    await sendText(
      customerKey,
      `Application cancelled. Reply *RIDER APPLY* to start again, or apply online:\n${config.publicSiteUrl || "https://sokonimall.com"}/boda/apply.html`
    );
    return true;
  }

  if (/^\s*restart\s*$/i.test(t)) {
    await startRiderOnboarding(customerKey, { phone: phone || draft.phone });
    return true;
  }

  const save = (patch, next) => {
    Object.assign(draft, patch);
    flow.step = next;
    setFlow(customerKey, flow);
  };

  const ask = async (next) => {
    await sendText(customerKey, promptFor(next, draft));
  };

  // ---- document steps -----------------------------------------------------
  const DOC_STEPS = {
    [RIDER_STEPS.DOC_ID_FRONT]: { field: "idDocument", key: "nationalIdFrontUrl", required: true },
    [RIDER_STEPS.DOC_ID_BACK]: { field: "idDocumentBack", key: "nationalIdBackUrl", required: false },
    [RIDER_STEPS.DOC_LICENCE]: { field: "dlDocument", key: "licenseUrl", required: true },
    [RIDER_STEPS.DOC_STAGE_LETTER]: { field: "stageLetter", key: "stageLetterUrl", required: true },
  };

  if (DOC_STEPS[step]) {
    const spec = DOC_STEPS[step];
    if (hasMedia) {
      try {
        const buffer = await downloadWahaMedia(mediaUrl, {
          messageId,
          chatId,
          session,
          mimetype: mediaMimetype,
        });
        const url = await saveRiderDoc(customerKey, buffer, {
          mimetype: mediaMimetype,
          field: spec.field,
        });
        save({ [spec.key]: url }, nextStep(step));
        await sendText(customerKey, `✅ Saved.`);
        await ask(flow.step);
      } catch (err) {
        await sendText(customerKey, `⚠️ Could not save that photo (${err.message}). Please send it again.`);
      }
      return true;
    }
    if (!spec.required && isSkip(t)) {
      save({}, nextStep(step));
      await ask(flow.step);
      return true;
    }
    await sendText(
      customerKey,
      spec.required
        ? `📷 This one is required — please send a photo.`
        : `📷 Send a photo, or reply *skip*.`
    );
    return true;
  }

  if (step === RIDER_STEPS.DOC_EXTRAS) {
    const idx = draft.extraIndex || 0;
    const extra = EXTRA_DOCS[idx];
    if (!extra || isDone(t)) {
      save({}, RIDER_STEPS.CONFIRM);
      await ask(RIDER_STEPS.CONFIRM);
      return true;
    }
    if (hasMedia) {
      try {
        const buffer = await downloadWahaMedia(mediaUrl, {
          messageId,
          chatId,
          session,
          mimetype: mediaMimetype,
        });
        const url = await saveRiderDoc(customerKey, buffer, {
          mimetype: mediaMimetype,
          field: extra.key,
        });
        draft[extra.key] = url;
        await sendText(customerKey, `✅ Saved.`);
      } catch (err) {
        await sendText(customerKey, `⚠️ Could not save that (${err.message}).`);
        return true;
      }
    } else if (!isSkip(t)) {
      await sendText(customerKey, `Send the photo, or reply *skip* / *done*.`);
      return true;
    }
    draft.extraIndex = idx + 1;
    if (draft.extraIndex >= EXTRA_DOCS.length) {
      save({}, RIDER_STEPS.CONFIRM);
      await ask(RIDER_STEPS.CONFIRM);
    } else {
      setFlow(customerKey, flow);
      await ask(RIDER_STEPS.DOC_EXTRAS);
    }
    return true;
  }

  // ---- text steps ---------------------------------------------------------
  switch (step) {
    case RIDER_STEPS.PHONE: {
      const useSender = /^\s*(yes|y|ndio|sawa)\s*$/i.test(t) && draft.phone;
      const entered = useSender ? draft.phone : digitsOnly(t);
      if (!entered || entered.length < 9) {
        await sendText(customerKey, `That does not look like a phone number. Send it like *0712345678*.`);
        return true;
      }
      save({ phone: entered }, RIDER_STEPS.FULL_NAME);
      await ask(RIDER_STEPS.FULL_NAME);
      return true;
    }
    case RIDER_STEPS.FULL_NAME: {
      if (t.length < 3) {
        await sendText(customerKey, `Send your full name as it appears on your ID.`);
        return true;
      }
      save({ fullName: t.slice(0, 120) }, RIDER_STEPS.NATIONAL_ID);
      await ask(RIDER_STEPS.NATIONAL_ID);
      return true;
    }
    case RIDER_STEPS.NATIONAL_ID: {
      const id = digitsOnly(t);
      if (id.length < 5) {
        await sendText(customerKey, `Send your National ID number (digits only).`);
        return true;
      }
      save({ nationalId: id.slice(0, 32) }, RIDER_STEPS.TOWN);
      await ask(RIDER_STEPS.TOWN);
      return true;
    }
    case RIDER_STEPS.TOWN: {
      const town = normalizeTownChoice(t);
      if (!town) {
        await sendText(customerKey, `Reply *1* for Nairobi or *2* for Thika. Those are the only zones live today.`);
        return true;
      }
      save({ operatingTown: town }, RIDER_STEPS.STAGE);
      await ask(RIDER_STEPS.STAGE);
      return true;
    }
    case RIDER_STEPS.STAGE: {
      if (t.length < 3) {
        await sendText(customerKey, `Send your stage or area, for example: Kenyatta Market stage.`);
        return true;
      }
      save({ stageLocation: t.slice(0, 120) }, RIDER_STEPS.PLATE);
      await ask(RIDER_STEPS.PLATE);
      return true;
    }
    case RIDER_STEPS.PLATE: {
      const plate = normalizePlate(t);
      if (plate.length < 4) {
        await sendText(customerKey, `Send your plate, for example *KMGB 123X*.`);
        return true;
      }
      save({ motorbikePlate: plate }, RIDER_STEPS.GUARANTOR_NAME);
      await ask(RIDER_STEPS.GUARANTOR_NAME);
      return true;
    }
    case RIDER_STEPS.GUARANTOR_NAME: {
      save({ guarantorName: isSkip(t) ? "" : t.slice(0, 120) }, RIDER_STEPS.GUARANTOR_PHONE);
      await ask(RIDER_STEPS.GUARANTOR_PHONE);
      return true;
    }
    case RIDER_STEPS.GUARANTOR_PHONE: {
      save(
        { guarantorPhone: isSkip(t) ? "" : digitsOnly(t) },
        RIDER_STEPS.DOC_ID_FRONT
      );
      await ask(RIDER_STEPS.DOC_ID_FRONT);
      return true;
    }
    case RIDER_STEPS.CONFIRM: {
      if (!/^\s*submit\s*$/i.test(t)) {
        await sendText(customerKey, summaryText(draft));
        return true;
      }
      const { registerRiderApplication } = await import("./boda-fleet.js");
      const result = await registerRiderApplication({ ...draft });
      if (result?.error) {
        await sendText(
          customerKey,
          `⚠️ ${result.message || "Could not submit."}\n\nReply *restart* to redo it, or apply online:\n${config.publicSiteUrl || "https://sokonimall.com"}/boda/apply.html`
        );
        return true;
      }
      clearFlow(customerKey);
      await sendText(
        customerKey,
        `✅ *Application received*\n\n` +
          `Sokoni ops will check your documents and reply here, usually within 24 hours.\n\n` +
          `Once approved you'll be auto-assigned jobs — you don't pick from a list. ` +
          `Keep this chat open; offers arrive here.`
      );
      return true;
    }
    default:
      return false;
  }
}
