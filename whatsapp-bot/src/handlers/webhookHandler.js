import {
  sendWelcome,
  handleMenuAction,
  tryHandlePendingOrder,
  sendNumberedProductList,
  cancelOrder,
  changeOrder,
  handleCart,
  startCodOrder,
  sendHumanHandoff,
} from "../services/menu.js";
import { sendText, customerKeyFromChatId, isBotEcho, phoneDigitsFromChatId } from "../services/whatsapp.js";
import { runAiAgent } from "../services/ai.js";
import {
  getMenuState,
  getSession,
  isHumanHandoff,
  clearHumanHandoff,
  setCustomerMeta,
} from "../services/session.js";
import { searchProducts, findProductFromMessage, findProductFromWebsiteMessage } from "../services/catalog.js";
import { handleCustomerWhileHandoff } from "../services/handoff.js";
import { handleAdminOutgoing, handleAdminIncoming, isAdminSender, containsAdminCommand, shouldRouteIncomingAsAdmin, requireAdminSender, canRunAdminCommands, extractCustomerMeta, isAdminQuickStatusText } from "../services/admin.js";
import { registerContact } from "../services/orders.js";
import { sendOrderStatus } from "../services/menu.js";
import { handleReviewReply, siteUrlLine } from "../services/reviews.js";
import { handleProductRouter, resolveProductQuery } from "../services/product-router.js";

const RESET_KEYWORDS = new Set(["menu", "start", "habari"]);
const CATALOG_ALIASES = new Set(["catalogue", "catalog", "shop", "browse"]);

function parseNumericChoice(text) {
  const match = text.trim().match(/^(\d{1,2})$/);
  return match ? Number(match[1]) : null;
}

function extractQuotedText(payload) {
  const candidates = [
    payload.replyTo?.body,
    payload.replyTo?.text,
    payload.quotedMsg?.body,
    payload.quotedMessage?.body,
    payload._data?.quotedMessage?.body,
    payload._data?.quotedMsg?.body,
    payload._data?.quotedMsgObj?.caption,
    payload._data?.quotedStanza?.body,
    payload.quoted?.body,
    payload.replyTo?._data?.body,
    payload.replyTo?._data?.quotedMessage?.body,
  ];
  for (const c of candidates) {
    if (c && String(c).trim()) return String(c).trim();
  }
  return "";
}

function isCasualGreeting(text) {
  const t = text.toLowerCase().trim();
  return /^(sasa|mambo|habari yako|habari|uko aje|uze aje|poa|sema|hujambo|shikamoo|good morning|good evening|good afternoon|hello|hi|hey)[\s!?.]*$/i.test(
    t
  );
}

function isPurchaseIntent(text) {
  const t = text.toLowerCase().trim();
  return /^(nipee|nataka|give me|order it|buy it|take it|yes please|confirm|ndio|sawa)[\s!?.]*$/i.test(t);
}

function isIgnorableChat(id) {
  if (!id) return false;
  return /@g\.us$|@newsletter$|status@broadcast/i.test(id);
}

function messageIdFrom(payload) {
  const id = payload?.id;
  if (typeof id === "string") return id;
  if (id && typeof id === "object") return id._serialized || id.id || null;
  return payload?._data?.id?._serialized || payload?._data?.id?.id || null;
}

export function parseWahaMessage(body) {
  // WAHA delivers incoming via "message" and the bot's OWN outgoing via
  // "message.any". We subscribe to message.any so admin actions are seen too.
  if (body?.event !== "message" && body?.event !== "message.any") return null;
  const payload = body.payload;
  if (!payload || !payload.body?.trim()) return null;
  if (payload.hasMedia && !payload.body) return null;
  if (isIgnorableChat(payload.from) || isIgnorableChat(payload.to)) return null;

  const text = payload.body.trim();
  const quotedText = extractQuotedText(payload);
  const messageId = messageIdFrom(payload);

  if (payload.fromMe) {
    return {
      direction: "outgoing",
      messageId,
      fromChatId: customerKeyFromChatId(payload.from),
      toChatId: customerKeyFromChatId(payload.to),
      text,
      quotedText,
    };
  }

  const meta = extractCustomerMeta(payload);
  const combinedText = quotedText ? `${quotedText}\n${text}` : text;

  return {
    direction: "incoming",
    messageId,
    customerKey: meta.chatId,
    text,
    quotedText,
    combinedText,
    ...meta,
  };
}

async function tryProductSearch(customerKey, text) {
  if (isCasualGreeting(text)) return false;

  const routed = await resolveProductQuery(text);
  if (routed.action !== "none") return false;

  const products = await searchProducts({
    keywords: text,
    fulfillment: "store",
    scope: "local",
    limit: 4,
  });
  if (products.length === 0) return false;

  const isProductIntent =
    /want|looking for|need|show me|send|get|buy|order|recommend|product card|card again/i.test(text) ||
    /tv|phone|tablet|laptop|fridge|washing|headphone|smart|hisense|samsung|redmi|infinix/i.test(text);

  if (!isProductIntent && products.length > 1) return false;

  await sendNumberedProductList(customerKey, products, { title: "Here's what I found:" });
  return true;
}

function isProductMenuChoice(text) {
  return /^[123]$/.test(String(text || "").trim());
}

async function handleActiveProductMenu(customerKey, text) {
  const menuState = getMenuState(customerKey);
  if (menuState?.type !== "product" || !menuState.productId) return false;

  const choice = parseNumericChoice(text);
  if (!choice || !menuState.options?.[choice - 1]) return false;

  const option = menuState.options[choice - 1];
  if (option.id === "human_handoff") {
    return sendHumanHandoff(customerKey, { lastMessage: text });
  }
  return handleMenuAction(customerKey, option.id);
}

export async function handleIncomingMessage(
  customerKey,
  text,
  { quotedText = "", combinedText = text, displayName = "", phone = "", chatId = customerKey } = {}
) {
  setCustomerMeta(customerKey, { chatId, displayName, phone });
  registerContact(customerKey, { chatId, displayName, phone });

  const normalized = text.toLowerCase().trim();

  if (await handleReviewReply(customerKey, text)) return;

  if (/^(paid|nimelipa|nimepay|payment done|done paying)\b/i.test(normalized)) {
    const { handleCustomerPaidClaim } = await import("../services/payment.js");
    return handleCustomerPaidClaim(customerKey, text);
  }

  // Customers must never see admin console
  if (!requireAdminSender(customerKey, phone)) {
    if (/^admin\b/i.test(normalized) || /^#help\b/i.test(text.trim())) {
      return sendText(
        customerKey,
        "Karibu Sokoni! 🛒\n\nType *menu* to browse and order (pay on delivery).\nNeed a person? *menu* → *Talk to a Human*."
      );
    }
  }

  // Track always works — even during human handoff (admin may have replied manually)
  const orderIdMatch =
    !containsAdminCommand(text) &&
    !isAdminSender(customerKey, phone) &&
    text.trim().match(/\bSK-?(\d{3,})\b/i);
  if (orderIdMatch) {
    return sendOrderStatus(customerKey, `SK-${orderIdMatch[1]}`, phone);
  }
  if (
    /^track\b/i.test(normalized) ||
    normalized === "track order" ||
    normalized === "my order" ||
    normalized === "my orders"
  ) {
    console.log("[track] request from", customerKey, phone || "(no phone)");
    const { sendTrackOrderMenu } = await import("../services/menu.js");
    return sendTrackOrderMenu(customerKey, phone);
  }

  // Human handoff — bot stays silent except menu / track (handled above)
  if (isHumanHandoff(customerKey)) {
    if (normalized === "menu") {
      clearHumanHandoff(customerKey);
      return sendWelcome(customerKey);
    }
    return handleCustomerWhileHandoff(customerKey);
  }

  if (
    /^(tiktok\s*deals?|viral\s*bargains?|viral\s*deals?|as\s*seen\s*on\s*tiktok)$/i.test(normalized) ||
    /^tiktokdeals$/i.test(normalized.replace(/\s/g, ""))
  ) {
    const { sendViralDealsMenu } = await import("../services/menu.js");
    return sendViralDealsMenu(customerKey);
  }

  if (/tik\s*tok|tiktok|viral bargain|nimeona.*tik\s*tok|saw (?:your|the).*(?:tik\s*tok|viral)/i.test(combinedText)) {
    const { sendViralDealsMenu } = await import("../services/menu.js");
    return sendViralDealsMenu(customerKey);
  }

  if (RESET_KEYWORDS.has(normalized)) {
    return sendWelcome(customerKey);
  }

  if (CATALOG_ALIASES.has(normalized)) {
    return sendWelcome(customerKey);
  }

  if (/^(shop international|international shopping|🌍)$/i.test(normalized) || normalized === "international") {
    const { sendInternationalMenu } = await import("../services/menu.js");
    return sendInternationalMenu(customerKey);
  }

  if (normalized === "cart" || normalized === "my cart" || normalized === "my cart?") {
    return handleCart(customerKey);
  }

  if (/^cancel(\s+order)?$/i.test(normalized) || normalized === "cancel order") {
    return cancelOrder(customerKey);
  }

  if (/^change(\s+order)?$/i.test(normalized) || normalized === "change order") {
    return changeOrder(customerKey);
  }

  if (await handleActiveProductMenu(customerKey, text)) return;

  if (/product card|send (the )?card|card again|show (me )?(the )?(item|product)/i.test(normalized)) {
    const product = await findProductFromMessage(combinedText);
    if (product) {
      const { showProductActions } = await import("../services/menu.js");
      return showProductActions(customerKey, product.id);
    }
  }

  if (quotedText) {
    const menuState = getMenuState(customerKey);
    if (menuState?.type === "product" && menuState.productId && (text === "1" || /^order$/i.test(text))) {
      return startCodOrder(customerKey, menuState.productId);
    }

    const quotedProduct = await findProductFromMessage(quotedText);
    if (quotedProduct) {
      if (text === "1" || /^order$/i.test(text)) {
        return startCodOrder(customerKey, quotedProduct.id);
      }
      if (/^(info|details?|more)$/i.test(text)) {
        const { showProductActions } = await import("../services/menu.js");
        return showProductActions(customerKey, quotedProduct.id);
      }
    }
  }

  const pendingHandled = await tryHandlePendingOrder(customerKey, combinedText);
  if (pendingHandled) return;

  const websiteProduct = await findProductFromWebsiteMessage(combinedText);
  if (websiteProduct) {
    const { showProductActions } = await import("../services/menu.js");
    return showProductActions(customerKey, websiteProduct.id);
  }

  if (await handleProductRouter(customerKey, text)) return;

  const catalogRoute = await resolveProductQuery(text);
  if (catalogRoute.action === "exact" || catalogRoute.action === "confirm") {
    return;
  }

  if (isCasualGreeting(text)) {
    return sendText(
      customerKey,
      "Poa! 😊 Niko fit. Unatafuta nini leo?\n\nType *menu* to browse, or tell me what you need (e.g. *Hisense TV*, *washing machine*).\n\n" +
        siteUrlLine()
    );
  }

  if (isPurchaseIntent(text)) {
    const session = getSession(customerKey);
    if (session.lastProductContext) {
      return startCodOrder(customerKey, session.lastProductContext.id);
    }
    return sendText(customerKey, "Which item do you want? Type *menu* → browse → reply with the item number.");
  }

  const menuState = getMenuState(customerKey);

  if (menuState?.type === "product" && isProductMenuChoice(text)) {
    return handleActiveProductMenu(customerKey, text);
  }

  if (menuState?.type === "product_list_paged" && menuState.rowId) {
    if (/^(next|more|n)$/i.test(normalized)) {
      const totalPages = Math.ceil((menuState.allProductIds?.length || 0) / (menuState.pageSize || 12));
      const nextPage = (menuState.page || 0) + 1;
      if (nextPage < totalPages) {
        const { sendProductsForSubcategory } = await import("../services/menu.js");
        return sendProductsForSubcategory(customerKey, menuState.rowId, nextPage);
      }
      return sendText(customerKey, "You're on the last page. Reply with a number to order, or *menu*.");
    }
    if (/^(prev|previous|back|p)$/i.test(normalized) && (menuState.page || 0) > 0) {
      const { sendProductsForSubcategory } = await import("../services/menu.js");
      return sendProductsForSubcategory(customerKey, menuState.rowId, menuState.page - 1);
    }
  }

  const choice = parseNumericChoice(text);

  if (
    choice &&
    (menuState?.type === "product_list_paged" || menuState?.type === "product_list") &&
    menuState.productIds?.[choice - 1]
  ) {
    const { showProductActions } = await import("../services/menu.js");
    return showProductActions(customerKey, menuState.productIds[choice - 1]);
  }

  if (choice && menuState?.options?.length >= choice && menuState?.type !== "product_list") {
    const option = menuState.options[choice - 1];
    if (option.id === "human_handoff") {
      return sendHumanHandoff(customerKey, {
        chatId,
        displayName,
        phone,
        lastMessage: combinedText,
      });
    }
    try {
      return await handleMenuAction(customerKey, option.id);
    } catch (err) {
      console.error("Menu action failed:", err.message);
      return sendText(customerKey, "Sorry, something went wrong. Type *menu* to try again.");
    }
  }

  if (/human|agent|person|call me|speak to someone|talk to a human|i need human/i.test(normalized)) {
    return sendHumanHandoff(customerKey, { chatId, displayName, phone, lastMessage: combinedText });
  }

  if (await tryProductSearch(customerKey, combinedText)) return;

  const session = getSession(customerKey);
  if (session.lastProductContext && catalogRoute.action !== "none") return;

  try {
    const reply = await runAiAgent(customerKey, combinedText);
    if (!reply) return;
    return sendText(customerKey, reply);
  } catch (err) {
    console.error("Unexpected reply error:", err.message);
    return sendText(customerKey, "Something went wrong. Type *menu* to browse products.");
  }
}

function looksLikeAdminAction(text, fromChatId) {
  const trimmed = (text || "").trim();
  if (!containsAdminCommand(text) && !/^orders?\b/i.test(trimmed) && !/^admin\b/i.test(trimmed)) {
    return false;
  }
  const phone = phoneDigitsFromChatId(fromChatId);
  return canRunAdminCommands(fromChatId, phone, { allowBusinessOwner: true });
}

export async function handleWahaWebhook(body) {
  const parsed = parseWahaMessage(body);
  if (!parsed) return;

  if (parsed.direction === "outgoing") {
    // Ignore the bot's OWN outgoing messages (echoes). Only act on messages
    // the human store owner actually typed (admin commands, quote-replies,
    // or a manual reply inside a customer's chat).
    if (
      !looksLikeAdminAction(parsed.text, parsed.fromChatId) &&
      !isAdminQuickStatusText(parsed.text) &&
      isBotEcho(parsed.messageId, parsed.toChatId)
    ) {
      return;
    }
    return handleAdminOutgoing(parsed);
  }

  if (shouldRouteIncomingAsAdmin(body, parsed)) {
    const handled = await handleAdminIncoming({
      ...parsed,
      phone: parsed.phone || undefined,
    });
    if (handled !== false) return handled;
  }

  return handleIncomingMessage(parsed.customerKey, parsed.text, {
    quotedText: parsed.quotedText,
    combinedText: parsed.combinedText,
    displayName: parsed.displayName,
    phone: parsed.phone,
    chatId: parsed.chatId,
  });
}
