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
import { handleAdminOutgoing, handleAdminIncoming, isAdminSender, containsAdminCommand, shouldRouteIncomingAsAdmin, requireAdminSender, canRunAdminCommands, extractCustomerMeta, isAdminQuickStatusText, isBusinessOwnerSender } from "../services/admin.js";
import { handleCatalogCommand, handleCatalogMedia, isCatalogCommand, isCatalogMedia, extractCatalogCommandLine, handleShareImportMessage } from "../services/catalog-admin.js";
import { extractWahaProductMessage } from "../services/whatsapp.js";
import { config } from "../config.js";
import { registerContact } from "../services/orders.js";
import { sendOrderStatus } from "../services/menu.js";
import { handleReviewReply, siteUrlLine } from "../services/reviews.js";
import { handleProductRouter, resolveProductQuery, handleCatalogPagination } from "../services/product-router.js";
import { looksLikeDeliveryDetails } from "../services/delivery-details.js";
import { getPendingOrder } from "../services/session.js";
import { tryCustomerAutomation, maybeSendOutOfOffice } from "../services/customer-automations.js";
import { tryRoleMenu, handleVendorMenuAction, handlePickupMenuAction } from "../services/role-menus.js";
import { handleSupplierOnboarding, isInSupplierOnboarding, trySupplierContinueFromRef } from "../services/supplier-onboarding.js";
import {
  handlePickupOnboarding,
  isInPickupOnboarding,
  tryPickupContinueFromRef,
} from "../services/pickup-point-onboarding.js";

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

function extractAlbumId(payload) {
  const d = payload?._data || {};
  return (
    payload?.albumId ||
    d.albumId ||
    d.album?.id ||
    d.groupedId ||
    d.mediaData?.albumId ||
    d.message?.albumId ||
    null
  );
}

function extractMedia(payload) {
  const media = payload?.media || payload?._data?.media || null;
  const mediaError = media?.error || payload?._data?.media?.error || null;
  return {
    hasMedia: Boolean(payload?.hasMedia && (media?.url || payload?.id)),
    mediaUrl: media?.url || null,
    mediaMimetype: media?.mimetype || media?.mimeType || "image/jpeg",
    mediaFilename: media?.filename || null,
    mediaError,
  };
}

/** Album container messages have no real file — skip them; individual photos follow separately. */
function isAlbumPlaceholder(payload) {
  const d = payload?._data || {};
  const type = String(d.type || payload?.type || "").toLowerCase();
  if (!/album|multi_vcard|product_catalog/.test(type)) return false;
  const media = payload?.media || d.media;
  return !media?.url;
}

function isSelfOrBusinessChat(chatId) {
  if (!chatId) return false;
  const digits = phoneDigitsFromChatId(chatId);
  const business = String(config.store.businessNumber || "").replace(/\D/g, "");
  if (!digits || !business) return false;
  return digits === business || digits.endsWith(business.slice(-9));
}

export function parseWahaMessage(body) {
  // WAHA delivers incoming via "message" and the bot's OWN outgoing via
  // "message.any". We subscribe to message.any so admin actions are seen too.
  if (body?.event !== "message" && body?.event !== "message.any") return null;
  const payload = body.payload;
  if (!payload) return null;

  const text = String(payload.body || "").trim();
  const mediaInfo = extractMedia(payload);
  const hasProductCard = Boolean(extractWahaProductMessage(payload));
  if (!text && !mediaInfo.hasMedia && !hasProductCard) return null;
  if (isIgnorableChat(payload.from) || isIgnorableChat(payload.to)) return null;

  const quotedText = extractQuotedText(payload);
  const messageId = messageIdFrom(payload);
  const albumId = extractAlbumId(payload);
  const isAlbumPlaceholderMsg = isAlbumPlaceholder(payload);

  if (payload.fromMe) {
    return {
      direction: "outgoing",
      messageId,
      albumId,
      isAlbumPlaceholder: isAlbumPlaceholderMsg,
      fromChatId: customerKeyFromChatId(payload.from),
      toChatId: customerKeyFromChatId(payload.to),
      text,
      quotedText,
      session: body.session || config.waha.session,
      rawPayload: payload,
      ...mediaInfo,
    };
  }

  const meta = extractCustomerMeta(payload);
  const combinedText = quotedText ? `${quotedText}\n${text}` : text;

  return {
    direction: "incoming",
    messageId,
    albumId,
    isAlbumPlaceholder: isAlbumPlaceholderMsg,
    fromChatId: customerKeyFromChatId(payload.from),
    toChatId: customerKeyFromChatId(payload.to),
    customerKey: meta.chatId,
    text,
    quotedText,
    combinedText,
    session: body.session || config.waha.session,
    rawPayload: payload,
    ...mediaInfo,
    ...meta,
  };
}

function shouldRouteAdminCatalog(parsed) {
  if (!parsed.hasMedia || !isCatalogMedia(parsed.mediaMimetype)) return false;
  if (parsed.isAlbumPlaceholder) return false;

  if (parsed.direction === "incoming") {
    return canRunAdminCommands(parsed.customerKey, parsed.phone);
  }

  if (parsed.direction === "outgoing") {
    const fromPhone = phoneDigitsFromChatId(parsed.fromChatId);
    const allowBusinessOwner = isBusinessOwnerSender(parsed.fromChatId);
    if (!canRunAdminCommands(parsed.fromChatId, fromPhone, { allowBusinessOwner })) return false;
    // Only ingest catalog photos in self-chat — never while replying to a customer thread.
    return isSelfOrBusinessChat(parsed.toChatId);
  }

  return false;
}

/** Chat where the admin typed — replies must go here (not only self-chat). */
function adminActionChat(parsed) {
  if (parsed.direction === "incoming") return parsed.customerKey;
  return parsed.toChatId || parsed.fromChatId;
}

async function routeAdminCatalog(parsed) {
  const phone =
    parsed.phone ||
    phoneDigitsFromChatId(parsed.customerKey || parsed.fromChatId) ||
    "";
  const adminChat = adminActionChat(parsed);
  const allowBusinessOwner =
    parsed.direction === "outgoing" && isBusinessOwnerSender(parsed.fromChatId);

  if (await handleShareImportMessage(parsed, adminChat)) return true;

  if (parsed.hasMedia && shouldRouteAdminCatalog(parsed)) {
    return handleCatalogMedia(adminChat, {
      mediaUrl: parsed.mediaUrl,
      mediaMimetype: parsed.mediaMimetype,
      caption: parsed.text,
      messageId: parsed.messageId,
      chatId: parsed.direction === "incoming" ? parsed.customerKey : parsed.toChatId || parsed.fromChatId,
      fromChatId: parsed.fromChatId,
      toChatId: parsed.toChatId,
      session: parsed.session,
      albumId: parsed.albumId,
    });
  }

  if (parsed.text && isCatalogCommand(parsed.text)) {
    if (!canRunAdminCommands(adminChat, phone, { allowBusinessOwner })) return false;
    return handleCatalogCommand(adminChat, extractCatalogCommandLine(parsed.text));
  }

  return false;
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
  {
    quotedText = "",
    combinedText = text,
    displayName = "",
    phone = "",
    chatId = customerKey,
    hasMedia = false,
    mediaUrl = null,
    mediaMimetype = null,
    messageId = null,
    wahaSession = null,
  } = {}
) {
  setCustomerMeta(customerKey, { chatId, displayName, phone });
  registerContact(customerKey, { chatId, displayName, phone });

  const normalized = text.toLowerCase().trim();

  if (isInPickupOnboarding(customerKey)) {
    const handled = await handlePickupOnboarding(customerKey, text, { phone });
    if (handled) return;
  }

  if (isInSupplierOnboarding(customerKey)) {
    const handled = await handleSupplierOnboarding(customerKey, text, {
      phone,
      hasMedia,
      mediaUrl,
      mediaMimetype,
      messageId,
      chatId,
      session: wahaSession,
    });
    if (handled) return;
  }

  if (await tryPickupContinueFromRef(customerKey, combinedText, { phone })) return;
  if (await trySupplierContinueFromRef(customerKey, combinedText, { phone })) return;

  if (await tryRoleMenu(customerKey, text, { phone })) return;

  if (await handleReviewReply(customerKey, text)) return;

  if (/^(paid|nimelipa|nimepay|payment done|done paying)\b/i.test(normalized)) {
    const { handleCustomerPaidClaim } = await import("../services/payment.js");
    return handleCustomerPaidClaim(customerKey, text, phone);
  }

  // Customers must never see admin console
  if (!requireAdminSender(customerKey, phone)) {
    if (/^admin\b/i.test(normalized) || /^#help\b/i.test(text.trim())) {
      return sendText(
        customerKey,
        "Karibu Sokoni! 🛒\n\nType *menu* for customer shopping.\nSuppliers: *vendor menu* · Pickup points: *pickup menu* · Admins only: configured admin phone."
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
    await maybeSendOutOfOffice(customerKey);
    return sendWelcome(customerKey);
  }

  if (CATALOG_ALIASES.has(normalized)) {
    await maybeSendOutOfOffice(customerKey);
    return sendWelcome(customerKey);
  }

  if (await tryCustomerAutomation(customerKey, text, { phone, displayName })) return;

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

  if (looksLikeDeliveryDetails(combinedText) && !getPendingOrder(customerKey)) {
    return sendText(
      customerKey,
      "I have your name and location 👍 To place the order, first pick an item (*menu* → category → reply with the number → *1* to order), then send those details again."
    );
  }

  const websiteProduct = await findProductFromWebsiteMessage(combinedText);
  if (websiteProduct) {
    const { showProductActions } = await import("../services/menu.js");
    return showProductActions(customerKey, websiteProduct.id);
  }

  if (await handleCatalogPagination(customerKey, text)) return;

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

  const choice = parseNumericChoice(text);

  if (choice && menuState?.type === "product_list_paged") {
    const pageCount = menuState.productIds?.length || 0;
    if (choice > pageCount) {
      const pageNum = (menuState.page || 0) + 1;
      const pageSize = menuState.pageSize || 10;
      const totalPages = Math.max(1, Math.ceil((menuState.allProductIds?.length || 0) / pageSize));
      const hasMore = pageNum < totalPages;
      return sendText(
        customerKey,
        `On page ${pageNum}, reply *1–${pageCount}* to pick an item.` +
          (hasMore ? ` Or reply *next* for more.` : "")
      );
    }
  }

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
    if (menuState.type === "vendor_apply_gate" || menuState.type === "role_menu") {
      return handleVendorMenuAction(customerKey, option.id, { phone });
    }
    if (menuState.type === "pickup_apply_gate") {
      return handlePickupMenuAction(customerKey, option.id, { phone });
    }
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

export async function handleWahaWebhook(body) {
  const parsed = parseWahaMessage(body);
  if (!parsed) return;

  if (parsed.direction === "outgoing") {
    // Always ignore the bot's own replies first — help text embeds #catalog / #add
    // examples that would otherwise re-trigger catalog intake.
    if (isBotEcho(parsed.messageId, parsed.toChatId)) return;

    const catalogHandled = await routeAdminCatalog(parsed);
    if (catalogHandled) return catalogHandled;

    return handleAdminOutgoing(parsed);
  }

  const catalogHandled = await routeAdminCatalog(parsed);
  if (catalogHandled) return catalogHandled;

  if (shouldRouteIncomingAsAdmin(body, parsed)) {
    const handled = await handleAdminIncoming({
      ...parsed,
      phone: parsed.phone || undefined,
    });
    if (handled !== false) return handled;
  }

  if (!parsed.text && !parsed.hasMedia) return;

  return handleIncomingMessage(parsed.customerKey, parsed.text || "", {
    quotedText: parsed.quotedText,
    combinedText: parsed.combinedText || parsed.text || "",
    displayName: parsed.displayName,
    phone: parsed.phone,
    chatId: parsed.chatId,
    hasMedia: parsed.hasMedia,
    mediaUrl: parsed.mediaUrl,
    mediaMimetype: parsed.mediaMimetype,
    messageId: parsed.messageId,
    session: parsed.session,
  });
}
