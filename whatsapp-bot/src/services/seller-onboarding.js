/**
 * Seller signup, completed entirely on WhatsApp.
 *
 * Replaces the supplier-programme flow in supplier-onboarding.js, which was
 * built for the affiliate era: it collected a business name, contact person,
 * email, delivery areas and a product catalogue, and produced a supplier
 * *application* for review. The marketplace has been peer-to-peer since the
 * July pivot -- a seller is a person with a shop name and an M-Pesa number,
 * created immediately by onboardSeller, and listings come later in the Hub.
 *
 * Ends at the same onboardSeller() the Seller Hub calls, so a shop created
 * here is indistinguishable from one created on the website.
 *
 * The sender's WhatsApp number is already proven by the fact they are
 * messaging from it, so this flow skips the OTP step the web signup needs.
 */
import { config } from "../config.js";
import { isSubmitWord } from "../lib/confirm-words.js";
import { sendText } from "./whatsapp.js";
import { getCustomerMeta, setCustomerMeta, clearMenuState } from "./session.js";
import { onboardSeller, normalizePhone, isValidMpesaNumber } from "./seller-onboard.js";

export const SELLER_STEPS = {
  SHOP_NAME: "shop_name",
  HANDLE: "handle",
  MPESA: "mpesa",
  NATIONAL_ID: "national_id",
  CONFIRM: "confirm",
};

const STEP_ORDER = [
  SELLER_STEPS.SHOP_NAME,
  SELLER_STEPS.HANDLE,
  SELLER_STEPS.MPESA,
  SELLER_STEPS.NATIONAL_ID,
  SELLER_STEPS.CONFIRM,
];

export const SELLER_STEP_COUNT = STEP_ORDER.length;

export function stepNumber(step) {
  const i = STEP_ORDER.indexOf(step);
  return i < 0 ? 0 : i + 1;
}

function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

function isSkip(text) {
  return /^\s*(skip|none|hakuna|no|later)\s*$/i.test(String(text || ""));
}

/** @handle: lowercase, letters/digits/underscore, no leading @. */
export function normalizeHandle(text) {
  return String(text || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
}

export function handleFromShopName(shopName) {
  return normalizeHandle(shopName) || "shop";
}

function freshDraft(phone = "") {
  return {
    phone: phone || "",
    shopName: "",
    shopHandle: "",
    mpesaNumber: "",
    nationalId: "",
  };
}

function getFlow(customerKey) {
  return getCustomerMeta(customerKey)?.sellerOnboarding || null;
}

function setFlow(customerKey, flow) {
  setCustomerMeta(customerKey, { sellerOnboarding: flow });
}

function clearFlow(customerKey) {
  setCustomerMeta(customerKey, { sellerOnboarding: null });
  clearMenuState(customerKey);
}

export function isInSellerOnboarding(customerKey) {
  return Boolean(getFlow(customerKey)?.step);
}

/** Text that starts the chat signup instead of sending someone to the Hub. */
export function isSellerApplyCommand(text) {
  return /^\s*(sell(er)?\s*apply|apply\s*seller|start\s*selling|become\s*a\s*seller|sell\s*on\s*sokoni|vendor\s*menu|sell)\s*$/i.test(
    String(text || "")
  );
}

export function promptFor(step, draft = {}) {
  const n = stepNumber(step);
  const head = `*Seller signup — step ${n}/${SELLER_STEP_COUNT}*\n\n`;
  switch (step) {
    case SELLER_STEPS.SHOP_NAME:
      return head + `What should your shop be called? Buyers see this name on every listing.`;
    case SELLER_STEPS.HANDLE: {
      const suggested = draft.shopHandle || handleFromShopName(draft.shopName);
      return (
        head +
        `Pick a shop handle — your shop link becomes sokonimall.com/shop.html?handle=${suggested}\n\n` +
        `Reply *yes* to use *@${suggested}*, or send a different one.`
      );
    }
    case SELLER_STEPS.MPESA:
      return (
        head +
        `Which *M-Pesa number* should your payouts go to?\n\n` +
        (draft.phone ? `Reply *yes* to use *${draft.phone}*, or send a different number.` : `Send the number.`)
      );
    case SELLER_STEPS.NATIONAL_ID:
      return (
        head +
        `Optional: your *National ID number*.\n\n` +
        `It earns the 🔷 VERIFIED STORE badge, which buyers trust more. ` +
        `Reply *skip* to add it later.`
      );
    case SELLER_STEPS.CONFIRM:
      return summaryText(draft);
    default:
      return head;
  }
}

export function summaryText(draft = {}) {
  const line = (label, value) => `• *${label}:* ${value || "—"}`;
  return (
    `*Check your shop*\n\n` +
    [
      line("Shop name", draft.shopName),
      line("Handle", draft.shopHandle ? `@${draft.shopHandle}` : ""),
      line("Payout M-Pesa", draft.mpesaNumber),
      line("National ID", draft.nationalId ? "provided" : "skipped"),
    ].join("\n") +
    `\n\nReply *confirm* to create your shop, *restart* to start again, or *cancel* to stop.`
  );
}

function nextStep(step) {
  const i = STEP_ORDER.indexOf(step);
  return STEP_ORDER[i + 1] || SELLER_STEPS.CONFIRM;
}

export async function startSellerOnboarding(customerKey, { phone = "" } = {}) {
  const draft = freshDraft(normalizePhone(phone) || digitsOnly(phone));
  setFlow(customerKey, { step: SELLER_STEPS.SHOP_NAME, draft });
  await sendText(
    customerKey,
    `🛍️ *Start selling on Sokoni*\n\n` +
      `I'll set up your shop here — about a minute. No forms, no app.\n\n` +
      `Buyers pay upfront into M-Pesa escrow; you get paid after delivery is confirmed.\n\n` +
      `Reply *cancel* anytime to stop.\n\n` +
      promptFor(SELLER_STEPS.SHOP_NAME, draft)
  );
  return true;
}

/**
 * Handle one inbound message while a seller signup is open.
 * @returns {Promise<boolean>} true when the message was consumed
 */
export async function handleSellerOnboarding(customerKey, text, { phone = "" } = {}) {
  const flow = getFlow(customerKey);
  if (!flow?.step) return false;

  const t = String(text || "").trim();
  const { draft, step } = flow;

  if (/^\s*cancel\s*$/i.test(t)) {
    clearFlow(customerKey);
    await sendText(
      customerKey,
      `Signup cancelled. Reply *SELL* to start again, or use the Seller Hub:\n${config.publicSiteUrl || "https://sokonimall.com"}/suppliers/list.html`
    );
    return true;
  }

  if (/^\s*restart\s*$/i.test(t)) {
    await startSellerOnboarding(customerKey, { phone: phone || draft.phone });
    return true;
  }

  const save = (patch, next) => {
    Object.assign(draft, patch);
    flow.step = next;
    setFlow(customerKey, flow);
  };
  const ask = async (next) => sendText(customerKey, promptFor(next, draft));

  switch (step) {
    case SELLER_STEPS.SHOP_NAME: {
      if (t.length < 2) {
        await sendText(customerKey, `Send a shop name buyers will recognise — at least 2 characters.`);
        return true;
      }
      save({ shopName: t.slice(0, 80), shopHandle: handleFromShopName(t) }, SELLER_STEPS.HANDLE);
      await ask(SELLER_STEPS.HANDLE);
      return true;
    }
    case SELLER_STEPS.HANDLE: {
      const accept = /^\s*(yes|y|ndio|sawa)\s*$/i.test(t);
      const handle = accept ? draft.shopHandle : normalizeHandle(t);
      if (!handle) {
        await sendText(customerKey, `Handles use letters, numbers and underscores only. Try again.`);
        return true;
      }
      save({ shopHandle: handle }, SELLER_STEPS.MPESA);
      await ask(SELLER_STEPS.MPESA);
      return true;
    }
    case SELLER_STEPS.MPESA: {
      const accept = /^\s*(yes|y|ndio|sawa)\s*$/i.test(t) && draft.phone;
      const candidate = accept ? draft.phone : t;
      if (!isValidMpesaNumber(candidate)) {
        await sendText(customerKey, `That is not a valid M-Pesa number. Send it like *0712345678*.`);
        return true;
      }
      save({ mpesaNumber: normalizePhone(candidate) }, SELLER_STEPS.NATIONAL_ID);
      await ask(SELLER_STEPS.NATIONAL_ID);
      return true;
    }
    case SELLER_STEPS.NATIONAL_ID: {
      if (isSkip(t)) {
        save({ nationalId: "" }, SELLER_STEPS.CONFIRM);
        await ask(SELLER_STEPS.CONFIRM);
        return true;
      }
      const id = digitsOnly(t);
      if (id.length < 5) {
        await sendText(customerKey, `Send your National ID number (digits only), or reply *skip*.`);
        return true;
      }
      save({ nationalId: id.slice(0, 32) }, SELLER_STEPS.CONFIRM);
      await ask(SELLER_STEPS.CONFIRM);
      return true;
    }
    case SELLER_STEPS.CONFIRM: {
      if (!isSubmitWord(t)) {
        await sendText(
          customerKey,
          `Reply *confirm* to create your shop, *restart* to redo it, or *cancel* to stop.\n\n` +
            summaryText(draft)
        );
        return true;
      }
      let result;
      try {
        result = onboardSeller({
          phone: draft.phone,
          shopName: draft.shopName,
          shopHandle: draft.shopHandle,
          mpesaNumber: draft.mpesaNumber,
          nationalId: draft.nationalId || undefined,
        });
      } catch (err) {
        console.error(`[seller-onboarding] submit threw for ${draft.phone || customerKey}:`, err?.message);
        await sendText(
          customerKey,
          `Couldn't create the shop just now - your answers are saved.\n\nReply *confirm* to try again, or use the Hub:\n${config.publicSiteUrl || "https://sokonimall.com"}/suppliers/list.html`
        );
        return true;
      }
      if (result?.error) {
        await sendText(
          customerKey,
          `⚠️ ${result.message || "Could not create the shop."}\n\nReply *restart* to redo it, or use the Hub:\n${config.publicSiteUrl || "https://sokonimall.com"}/suppliers/list.html`
        );
        return true;
      }
      clearFlow(customerKey);
      const site = config.publicSiteUrl || "https://sokonimall.com";
      await sendText(
        customerKey,
        `✅ *Your shop is live*\n\n` +
          `• *Shop:* ${draft.shopName}\n` +
          `• *Link:* ${site}/shop.html?handle=${draft.shopHandle}\n\n` +
          `*Add your first item:* open the Seller Hub and post a photo — pricing, shipping and stock are set there.\n` +
          `${site}/suppliers/list.html\n\n` +
          `Orders and payout alerts arrive in this chat. Reply *menu* anytime.`
      );
      return true;
    }
    default:
      return false;
  }
}
