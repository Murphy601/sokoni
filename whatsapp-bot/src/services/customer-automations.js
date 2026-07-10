import { config } from "../config.js";
import { sendText } from "./whatsapp.js";
import { getOrdersForCustomer } from "./orders.js";
import { getCustomerMeta, setCustomerMeta } from "./session.js";
import {
  welcomeBackMessage,
  outOfOfficeMessage,
  broadcastOptOutAck,
  broadcastOptInAck,
  proformaInvoiceMessage,
  priceNegotiationMessage,
  referralProgramMessage,
  giftWrapMessage,
  addressChangeMessage,
  outOfZoneMessage,
  corporateBulkMessage,
  accountDeletionMessage,
  scamWarningMessage,
  offlineTrackingMessage,
  weekendDeliveryMessage,
  sizeExchangeMessage,
  aiSurveyMessage,
  PROMO_CODE,
  OFFER_PERCENT,
} from "./trust-copy.js";

function normalize(text) {
  return String(text || "").trim().toLowerCase();
}

/** East Africa Time hour (0–23). */
function eatHourNow() {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: config.businessHours?.timezone || "Africa/Nairobi",
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date());
    const h = parts.find((p) => p.type === "hour");
    return h ? Number(h.value) : new Date().getUTCHours() + 3;
  } catch {
    return (new Date().getUTCHours() + 3) % 24;
  }
}

export function isAfterHumanHours() {
  const h = eatHourNow();
  const start = parseInt(String(config.businessHours?.humanSupportStart || "07:30").split(":")[0], 10);
  const end = parseInt(String(config.businessHours?.humanSupportEnd || "21:00").split(":")[0], 10);
  return h < start || h >= end;
}

export function customerHasCompletedOrder(customerKey, phone = "") {
  const orders = getOrdersForCustomer(customerKey, phone);
  return orders.some((o) => o.status === "delivered");
}

export function isBroadcastOptedOut(customerKey) {
  return Boolean(getCustomerMeta(customerKey)?.broadcastOptOut);
}

function referralCodeFor(customerKey) {
  const digits = String(customerKey || "").replace(/\D/g, "").slice(-8);
  return digits ? `SK${digits}` : "SOKONI";
}

/**
 * Keyword / lifecycle automations. Returns true if the message was fully handled.
 * Does not intercept menu, track, paid, or active order flows.
 */
export async function tryCustomerAutomation(customerKey, text, { phone = "", displayName = "" } = {}) {
  const t = normalize(text);
  if (!t) return false;

  if (/^(stop|unsubscribe|opt\s*out)$/i.test(t)) {
    setCustomerMeta(customerKey, { broadcastOptOut: true });
    await sendText(customerKey, broadcastOptOutAck());
    return true;
  }

  if (/^(start|subscribe)$/i.test(t) && getCustomerMeta(customerKey)?.broadcastOptOut) {
    setCustomerMeta(customerKey, { broadcastOptOut: false });
    await sendText(customerKey, broadcastOptInAck());
    return true;
  }

  if (/^delete$/i.test(t) && getCustomerMeta(customerKey)?.pendingDeletion) {
    setCustomerMeta(customerKey, { pendingDeletion: false, deletionRequestedAt: Date.now() });
    await sendText(
      customerKey,
      `Your deletion request is logged ✅ Our team will purge your data within 24 hours.\n\nThank you for testing Sokoni Mall.`
    );
    if (config.admin.primary) {
      try {
        await sendText(
          config.admin.primary,
          `🗑️ *Account deletion confirmed*\nChat: \`${customerKey}\`\nPhone: ${phone || "—"}\nName: ${displayName || "—"}`
        );
      } catch {
        /* ignore */
      }
    }
    return true;
  }

  if (/delete\s*(my\s*)?(account|data|profile)/i.test(t) || t === "account deletion") {
    setCustomerMeta(customerKey, { pendingDeletion: true });
    await sendText(customerKey, accountDeletionMessage());
    return true;
  }

  if (
    /^(scam|fraud|fake|nisalimi|mlagha)/i.test(t) ||
    /is\s+(this|sokoni)\s+(a\s+)?scam/i.test(t) ||
    /safe\s+to\s+(buy|shop|order)/i.test(t)
  ) {
    await sendText(customerKey, scamWarningMessage());
    return true;
  }

  if (
    /sell\s+on\s+sokoni|kuweka\s+bidhaa|nataka\s+kuuza|become\s+a\s+(vendor|supplier)|partner\s+with\s+sokoni/i.test(
      t
    )
  ) {
    const { startSupplierOnboarding } = await import("./supplier-onboarding.js");
    return startSupplierOnboarding(customerKey, { phone });
  }

  if (/^#(?:giftwrap|gift-wrap)\b/i.test(String(text || "").trim()) || /\b(gift\s*wrap|zawadi)\b/i.test(t)) {
    setCustomerMeta(customerKey, { awaitingGiftWrap: true });
    await sendText(customerKey, giftWrapMessage());
    return true;
  }

  if (getCustomerMeta(customerKey)?.awaitingGiftWrap) {
    const msg = String(text || "").trim();
    if (msg && !/^#(?:giftwrap|gift-wrap)\b/i.test(msg)) {
      setCustomerMeta(customerKey, { awaitingGiftWrap: false, giftWrapRequest: msg });
      await sendText(
        customerKey,
        `✅ *Gift wrap request saved*\n\n` +
          `Card message: _"${msg}"_\n` +
          `Add-on: KES 250 (confirmed before dispatch).\n\n` +
          `Our team will WhatsApp you to confirm payment if you're sending the surprise.`
      );
      if (config.admin.primary) {
        try {
          await sendText(
            config.admin.primary,
            `🎁 *Gift wrap request*\nFrom: ${displayName || "—"} · ${phone || customerKey}\nMessage: ${msg}`
          );
        } catch {
          /* ignore */
        }
      }
      return true;
    }
  }

  if (/\b(proforma|pro-forma|quotation|quote|invoice)\b/i.test(t)) {
    await sendText(customerKey, proformaInvoiceMessage());
    return true;
  }

  if (getCustomerMeta(customerKey)?.awaitingPromoConfirm && t === "yes") {
    setCustomerMeta(customerKey, { awaitingPromoConfirm: false, promoCode: PROMO_CODE });
    await sendText(
      customerKey,
      `✅ Code *${PROMO_CODE}* noted — *${OFFER_PERCENT}% off* will apply to your next eligible local order.\n\nType *menu* to browse and order.`
    );
    return true;
  }

  if (/punguza\s+bei|iko\s+na\s+discount|discount\??|cheaper|lower\s+price|bei\s+gani/i.test(t)) {
    setCustomerMeta(customerKey, { awaitingPromoConfirm: true });
    await sendText(customerKey, priceNegotiationMessage());
    return true;
  }

  if (/referr|invite\s+a\s+friend|share\s+link|rafiki/i.test(t)) {
    await sendText(customerKey, referralProgramMessage({ referralCode: referralCodeFor(customerKey) }));
    return true;
  }

  // "wrap" alone is handled via awaitingGiftWrap after #giftwrap — avoid re-trigger loop.

  if (/change\s+(location|address)|badilisha\s+address|huku\s+niko\s+tena/i.test(t)) {
    await sendText(customerKey, addressChangeMessage());
    return true;
  }

  if (t === "shipping" || /out\s+of\s+(town|zone)|delivery\s+zone/i.test(t)) {
    await sendText(customerKey, outOfZoneMessage());
    return true;
  }

  if (/corporate|bulk\s+order|wholesale|office\s+gifts/i.test(t)) {
    await sendText(customerKey, corporateBulkMessage());
    return true;
  }

  if (/exchange|replace\s+size|different\s+(size|color)|badilisha\s+size/i.test(t)) {
    await sendText(customerKey, sizeExchangeMessage({ orderId: "your order" }));
    return true;
  }

  if (/survey|rate\s+(the\s+)?ai|feedback\s+survey/i.test(t)) {
    setCustomerMeta(customerKey, { awaitingAiSurvey: true });
    await sendText(customerKey, aiSurveyMessage());
    return true;
  }

  if (getCustomerMeta(customerKey)?.awaitingAiSurvey && /^[123]$/.test(t)) {
    setCustomerMeta(customerKey, { awaitingAiSurvey: false, lastAiSurveyScore: Number(t) });
    if (t === "3" && config.admin.primary) {
      try {
        await sendText(
          config.admin.primary,
          `⚠️ *AI survey score 3 (Poor)*\nCustomer: ${displayName || "—"} · ${phone || customerKey}\nFollow up on WhatsApp.`
        );
      } catch {
        /* ignore */
      }
    }
    await sendText(customerKey, `Asante for rating us *${t}*! Your feedback helps improve Sokoni AI. 🙏`);
    return true;
  }

  if (/ko\s+wapi|tracking\s+(down|offline)|system\s+offline/i.test(t)) {
    await sendText(customerKey, offlineTrackingMessage());
    return true;
  }

  const day = new Date().getDay();
  const isWeekend = day === 0 || day === 6;
  if (isWeekend && /weekend\s+delivery|deliver\s+(today|tomorrow|monday)/i.test(t)) {
    await sendText(customerKey, weekendDeliveryMessage({ orderId: "your order" }));
    return true;
  }

  return false;
}

/** Send OOO notice once per night session when human support is closed. */
export async function maybeSendOutOfOffice(customerKey) {
  if (!isAfterHumanHours()) return false;
  const meta = getCustomerMeta(customerKey) || {};
  const today = new Date().toISOString().slice(0, 10);
  if (meta.lastOooDate === today) return false;
  setCustomerMeta(customerKey, { lastOooDate: today });
  await sendText(customerKey, outOfOfficeMessage());
  return true;
}

export function welcomeMessageForCustomer(customerKey, phone = "", displayName = "") {
  if (customerHasCompletedOrder(customerKey, phone)) {
    return welcomeBackMessage(displayName || "");
  }
  return null;
}
