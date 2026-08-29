import {
  sendWelcome,
  handleMenuAction,
  tryHandlePendingOrder,
  sendNumberedProductList,
  cancelOrder,
  changeOrder,
  handleCart,
  startCartFromHandoff,
  startCodOrder,
  startPrepaidOrderFromOffer,
  sendHumanHandoff,
  tryNumberedMenuReply,
} from "../services/menu.js";
import { sendText, customerKeyFromChatId, isBotEcho, phoneDigitsFromChatId, wasRecentBotSend } from "../services/whatsapp.js";
import { runAiAgent } from "../services/ai.js";
import {
  getMenuState,
  getSession,
  isHumanHandoff,
  clearHumanHandoff,
  setCustomerMeta,
  hydrateSessionFromDb,
} from "../services/session.js";
import { findProductFromMessage, findProductFromWebsiteMessage } from "../services/catalog.js";
import { handleCustomerWhileHandoff } from "../services/handoff.js";
import { handleAdminOutgoing, handleAdminIncoming, isAdminSender, containsAdminCommand, shouldRouteIncomingAsAdmin, requireAdminSender, canRunAdminCommands, extractCustomerMeta, isAdminQuickStatusText, isBusinessOwnerSender } from "../services/admin.js";
import { extractWahaProductMessage } from "../services/whatsapp.js";
import { config } from "../config.js";
import { registerContact } from "../services/orders.js";
import { sendOrderStatus } from "../services/menu.js";
import { handleReviewReply, siteUrlLine } from "../services/reviews.js";
import { handleProductRouter, handleCatalogPagination } from "../services/product-router.js";
import { looksLikeDeliveryDetails } from "../services/delivery-details.js";
import { getPendingOrder, getPendingCart, clearPendingOrder, clearPendingCart } from "../services/session.js";
import { tryCustomerAutomation, maybeSendOutOfOffice } from "../services/customer-automations.js";
import { tryRoleMenu, handleVendorMenuAction, handlePickupMenuAction } from "../services/role-menus.js";
import { handleSellerWalletMessage } from "../services/seller-wallet.js";
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

/** Buyer product photo for stock match (not ID docs / non-images). */
function looksLikeBuyerProductPhoto(mediaMimetype, text = "") {
  const mime = String(mediaMimetype || "").toLowerCase();
  if (mime && !mime.startsWith("image/")) return false;
  const caption = String(text || "").toLowerCase();
  if (/\b(id|passport|kra|license|national id)\b/.test(caption)) return false;
  return true;
}

function looksLikeVoiceNote(mediaMimetype) {
  const mime = String(mediaMimetype || "").toLowerCase();
  return mime.startsWith("audio/") || mime.includes("ogg") || mime.includes("ptt");
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

/**
 * After Sokoni Plug replies, attach a numbered picker so *1* / *2* still orders.
 * Hydrates full catalog rows from product ids returned by tools.
 */
async function sendPlugProductPicker(customerKey, products) {
  if (!products?.length) return;
  const { getProductById } = await import("../services/catalog.js");
  const full = [];
  for (const p of products.slice(0, 4)) {
    const row = p?.id ? await getProductById(p.id) : null;
    if (row) full.push(row);
  }
  if (!full.length) return;
  await sendNumberedProductList(customerKey, full, {
    title: "Pick a number to view & order:",
  });
}

function isProductMenuChoice(text) {
  return /^[123]$/.test(String(text || "").trim());
}

async function handleActiveProductMenu(customerKey, text) {
  const menuState = getMenuState(customerKey);
  if (menuState?.type !== "product" || !menuState.productId) return false;

  // Checkout already in progress — never restart "Order" from this menu.
  const pending = getPendingOrder(customerKey);
  if (
    pending &&
    ["location", "confirm_fees", "contact", "awaiting_delivery_location", "awaiting_customer_details"].includes(
      String(pending.step || "")
    )
  ) {
    return tryHandlePendingOrder(customerKey, text);
  }

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
  try {
    await hydrateSessionFromDb(customerKey, phone);
  } catch {
    /* fail-soft */
  }

  // Persist seller phone ↔ chatId early (critical for WhatsApp @lid replies).
  if (phone) {
    try {
      const { attachSellerWhatsAppChat, findSupplierByPhone } = await import(
        "../services/suppliers.js"
      );
      const seller = findSupplierByPhone(phone);
      if (seller?.phone) attachSellerWhatsAppChat(seller.phone, customerKey);
    } catch (err) {
      console.warn("[webhook] seller chat link skipped:", err.message);
    }
  }

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

  // Voice note → Whisper STT (EN/SW hint) → continue as text (phone = thread_id).
  if (
    hasMedia &&
    looksLikeVoiceNote(mediaMimetype) &&
    !String(text || "").trim()
  ) {
    try {
      const { downloadWahaMedia } = await import("../services/whatsapp.js");
      const { transcribeWhatsAppAudio } = await import("../services/commerce-ops.js");
      const { detectSpeechLanguageHint, prefersKiswahiliReply } = await import(
        "../services/shopper-language.js"
      );
      const buffer = await downloadWahaMedia(mediaUrl, {
        messageId,
        chatId,
        session: wahaSession,
        mimetype: mediaMimetype,
      });
      const hist = getSession(customerKey)?.history || [];
      const recentText = hist
        .slice(-4)
        .map((m) => m.content)
        .filter(Boolean)
        .join(" ");
      const languageHint = detectSpeechLanguageHint(recentText) || detectSpeechLanguageHint(quotedText);
      const stt = await transcribeWhatsAppAudio({
        buffer,
        mimetype: mediaMimetype,
        languageHint,
      });
      if (stt.ok && stt.text) {
        const spoken = String(stt.text).trim();
        // Keep original transcript for the LLM; catalog search still normalizes internally.
        if (prefersKiswahiliReply(spoken) || languageHint === "sw") {
          setCustomerMeta(customerKey, { preferKiswahiliReply: true, lastVoiceLang: stt.language || "sw" });
        } else {
          setCustomerMeta(customerKey, { lastVoiceLang: stt.language || "en" });
        }
        return handleIncomingMessage(customerKey, spoken, {
          quotedText,
          combinedText: spoken,
          displayName,
          phone,
          chatId,
          hasMedia: false,
          messageId,
          wahaSession,
        });
      }
      await sendText(
        customerKey,
        "I couldn't hear that voice note clearly — type your request (e.g. *viatu size 42 under 3000*)."
      );
      return;
    } catch (err) {
      console.warn("[webhook] voice stt skipped:", err.message);
    }
  }

  if (await tryRoleMenu(customerKey, text, { phone })) return;

  if (await handleReviewReply(customerKey, text)) return;

  if (/^(pay|retry|stk|lipa)\b/i.test(normalized)) {
    const { findAwaitingPaymentOrderForCustomer, getOrder } = await import("../services/orders.js");
    const {
      initiateMpesaCheckout,
      formatPrepaidCheckoutPrompt,
      isDarajaConfigured,
    } = await import("../services/prepaid-checkout.js");

    const order = findAwaitingPaymentOrderForCustomer(customerKey, phone);
    if (!order) {
      return sendText(customerKey, "No unpaid order found. Type *menu* to browse and order.");
    }
    if (order.customerPaymentStatus === "confirmed") {
      return sendText(customerKey, `✅ *${order.id}* is already paid. Type *track* for status.`);
    }
    if (!isDarajaConfigured()) {
      return sendText(customerKey, formatPrepaidCheckoutPrompt(order));
    }
    const result = await initiateMpesaCheckout(order, { phone: order.phone || phone });
    const prompt = formatPrepaidCheckoutPrompt(getOrder(order.id) || order);
    if (result.ok) return sendText(customerKey, prompt);
    return sendText(
      customerKey,
      `⚠️ STK push failed${result.message ? `: ${result.message}` : ""}.\n\nReply *pay* to try again.\n\n${prompt}`
    );
  }

  if (/^(paid|nimelipa|nimepay|payment done|done paying)\b/i.test(normalized)) {
    const { handleCustomerPaidClaim } = await import("../services/payment.js");
    return handleCustomerPaidClaim(customerKey, text, phone);
  }

  // ADMIN_TAKE_OVER: silent relay to ops (must beat DISPATCH/YES/bot menus).
  {
    const { tryRelayAdminTakeOver } = await import("../services/communication-hub.js");
    if (await tryRelayAdminTakeOver(customerKey, text, { phone })) return;
  }

  // Order-state bus: DISPATCH / YES / HELP (before generic track-by-id).
  {
    const { tryHandleWaDeliveryConfirm } = await import("../services/wa-delivery-confirm.js");
    if (await tryHandleWaDeliveryConfirm(customerKey, text, { phone })) return;
  }

  // Customers must never see admin console
  if (!requireAdminSender(customerKey, phone)) {
    if (/^admin\b/i.test(normalized) || /^#help\b/i.test(text.trim())) {
      return sendText(
        customerKey,
        "Karibu Sokoni! 🛒\n\nType *menu* for customer shopping.\nSuppliers: *vendor menu* · Pickup points: *pickup menu* or *pick up point* · Admins only: configured admin phone."
      );
    }
  }

  // Track always works — even during human handoff (admin may have replied manually)
  if (!containsAdminCommand(text) && !isAdminSender(customerKey, phone)) {
    const { extractOrderIdFromText } = await import("../services/orders.js");
    const trackId = extractOrderIdFromText(text.trim());
    if (trackId) {
      return sendOrderStatus(customerKey, trackId, phone);
    }
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

  // Numbered menu replies (1, 2, 3…) — before handoff silence swallows them.
  if (await tryNumberedMenuReply(customerKey, text, { phone })) return;

  // Human handoff — bot stays silent except menu / track (handled above).
  // Exception: dispute evidence photos must still attach (not silent-drop / not catalog search).
  if (isHumanHandoff(customerKey)) {
    if (normalized === "menu") {
      clearHumanHandoff(customerKey);
      return sendWelcome(customerKey);
    }
    if (hasMedia) {
      try {
        const { tryHandleDisputeEvidencePhoto } = await import("../services/dispute-protocol.js");
        if (
          await tryHandleDisputeEvidencePhoto(customerKey, {
            hasMedia,
            mediaUrl,
            mediaMimetype,
            messageId,
            chatId,
            session: wahaSession,
            text: combinedText || text,
            phone,
          })
        ) {
          return;
        }
      } catch (err) {
        console.warn("[webhook] handoff dispute evidence skipped:", err.message);
      }
    }
    return handleCustomerWhileHandoff(customerKey, combinedText || text);
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

  // Dispute evidence photos BEFORE automations + catalog search (stateful routing).
  if (hasMedia && !isAdminSender(customerKey, phone)) {
    try {
      const { tryHandleDisputeEvidencePhoto } = await import("../services/dispute-protocol.js");
      if (
        await tryHandleDisputeEvidencePhoto(customerKey, {
          hasMedia,
          mediaUrl,
          mediaMimetype,
          messageId,
          chatId,
          session: wahaSession,
          text: combinedText || text,
          phone,
        })
      ) {
        return;
      }
    } catch (err) {
      console.warn("[webhook] dispute evidence skipped:", err.message);
    }
  }

  // Fulfillment disputes BEFORE soft automations + image search + AI.
  if (!isAdminSender(customerKey, phone) && !isHumanHandoff(customerKey)) {
    try {
      const { tryHandleFulfillmentDispute } = await import("../services/dispute-protocol.js");
      if (await tryHandleFulfillmentDispute(customerKey, combinedText || text, { phone })) {
        if (hasMedia) {
          try {
            const { tryHandleDisputeEvidencePhoto } = await import("../services/dispute-protocol.js");
            await tryHandleDisputeEvidencePhoto(customerKey, {
              hasMedia,
              mediaUrl,
              mediaMimetype,
              messageId,
              chatId,
              session: wahaSession,
              text: combinedText || text,
              phone,
            });
          } catch (err) {
            console.warn("[webhook] dispute evidence after open skipped:", err.message);
          }
        }
        return;
      }
    } catch (err) {
      console.warn("[webhook] dispute protocol skipped:", err.message);
    }
  }

  if (await tryCustomerAutomation(customerKey, text, { phone, displayName })) return;

  if (await handleSellerWalletMessage(customerKey, text, { phone })) return;

  if (/^(shop international|international shopping|🌍)$/i.test(normalized) || normalized === "international") {
    const { sendMainMenu } = await import("../services/menu.js");
    await sendText(
      customerKey,
      "Sokoni Mall is *100% local & prepaid* — brand new and pre-loved items from Kenya sellers only."
    );
    return sendMainMenu(customerKey);
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

  // Website bag handoff — BEFORE AI / product pickers (must set pendingCart)
  if (
    /SOKONI_CART/i.test(combinedText) ||
    /NEW SOKONI CART/i.test(combinedText) ||
    /\[SKU:[^\]]+\]/i.test(combinedText)
  ) {
    if (await startCartFromHandoff(customerKey, combinedText)) return;
  }

  // Product photo → stock match must beat stuck checkout.
  // Dispute evidence already handled earlier; image-search also hard-gates disputes.
  if (hasMedia && !isInSupplierOnboarding(customerKey) && looksLikeBuyerProductPhoto(mediaMimetype, combinedText || text)) {
    const hadCheckout = Boolean(getPendingCart(customerKey) || getPendingOrder(customerKey));
    if (hadCheckout) {
      clearPendingCart(customerKey);
      clearPendingOrder(customerKey);
      await sendText(
        customerKey,
        "Paused checkout — matching your photo instead. (*menu* to order again anytime.)"
      );
    }
    try {
      const { tryHandleBuyerImageSearch } = await import("../services/image-search.js");
      const imageHit = await tryHandleBuyerImageSearch(customerKey, {
        hasMedia,
        mediaUrl,
        mediaMimetype,
        messageId,
        chatId,
        session: wahaSession,
        text: combinedText || text,
        phone,
      });
      if (imageHit) {
        if (imageHit === true) return;
        if (imageHit.handled) {
          if (imageHit.reply) await sendText(customerKey, imageHit.reply);
          if (imageHit.products?.length) await sendPlugProductPicker(customerKey, imageHit.products);
          return;
        }
      }
    } catch (err) {
      console.warn("[webhook] image search skipped:", err.message);
    }
  }

  // Cart or single-item checkout awaiting delivery details — before AI
  if (getPendingCart(customerKey) || getPendingOrder(customerKey)) {
    const pendingHandledEarly = await tryHandlePendingOrder(customerKey, combinedText);
    if (pendingHandledEarly) return;
  }

  // Accepted structured offer → prepaid checkout at agreed buyer total
  const payOfferMatch = text.match(/^pay[_\s-]?offer[_\s-]?(\d+)$/i);
  if (payOfferMatch) {
    return startPrepaidOrderFromOffer(customerKey, payOfferMatch[1]);
  }

  if (await handleCatalogPagination(customerKey, text)) return;

  if (isCasualGreeting(text)) {
    return sendText(
      customerKey,
      "Poa! 😊 Niko fit. Unatafuta nini leo?\n\nType *menu* to browse, or tell me what you need (e.g. *sandals*, *Hisense TV*, *perfume*).\n\n" +
        siteUrlLine()
    );
  }

  {
    const pendingCheckout = getPendingOrder(customerKey);
    const checkoutBusy =
      pendingCheckout &&
      ["location", "confirm_fees", "contact", "awaiting_delivery_location", "awaiting_customer_details"].includes(
        String(pendingCheckout.step || "")
      );
    if (!checkoutBusy && (await handleActiveProductMenu(customerKey, text))) return;
  }

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

  if (
    looksLikeDeliveryDetails(combinedText) &&
    !getPendingOrder(customerKey) &&
    !getPendingCart(customerKey)
  ) {
    return sendText(
      customerKey,
      "I have your name and location 👍 To place the order, first pick an item (*menu* → category → reply with the number → *1* to order), then send those details again."
    );
  }

  // Never treat a cart handoff as a single-product website referral
  if (!/SOKONI_CART/i.test(combinedText) && !/\[SKU:/i.test(combinedText)) {
    const websiteProduct = await findProductFromWebsiteMessage(combinedText);
    if (websiteProduct) {
      const { showProductActions } = await import("../services/menu.js");
      return showProductActions(customerKey, websiteProduct.id);
    }
  }

  if (await handleCatalogPagination(customerKey, text)) return;

  if (await handleProductRouter(customerKey, text)) return;

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

  // Never let AI invent till / product-picker replies during cart checkout
  if (getPendingCart(customerKey) || getPendingOrder(customerKey)) {
    const pendingAgain = await tryHandlePendingOrder(customerKey, combinedText);
    if (pendingAgain) return;
  }

  // Free-text shopping / site questions → Sokoni Plug (shared tools with web Ask).
  try {
    const agent = await runAiAgent(customerKey, combinedText, phone);
    if (agent.handoff) {
      return sendHumanHandoff(customerKey, {
        chatId,
        displayName,
        phone,
        lastMessage: combinedText,
      });
    }
    if (!agent.reply) {
      return sendText(
        customerKey,
        "Samahani, sikupata ulichomaanisha. Type *menu* to browse, or tell me what you're looking for."
      );
    }
    await sendText(customerKey, agent.reply);
    if (agent.products?.length) {
      await sendPlugProductPicker(customerKey, agent.products);
    }
    return;
  } catch (err) {
    console.error("Unexpected reply error:", err.message);
    return sendText(customerKey, "Something went wrong. Type *menu* to browse products.");
  }
}

export async function handleWahaWebhook(body) {
  const parsed = parseWahaMessage(body);
  if (!parsed) return;

  if (parsed.direction === "outgoing") {
    if (isBotEcho(parsed.messageId, parsed.toChatId)) return;
    return handleAdminOutgoing({
      fromChatId: parsed.fromChatId,
      toChatId: parsed.toChatId,
      text: parsed.text,
      quotedText: parsed.quotedText,
      messageId: parsed.messageId,
    });
  }

  // Idempotency: WAHA (or proxies) can redeliver the same inbound event.
  {
    const { claimInboundMessageId } = await import("../services/message-dedupe.js");
    if (claimInboundMessageId(parsed.messageId)) {
      console.log(`[webhook] duplicate blocked messageId=${parsed.messageId}`);
      return;
    }
  }

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
