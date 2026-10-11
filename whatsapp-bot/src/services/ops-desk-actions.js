/**
 * Ops-agent mutations that wrap existing Sokoni services.
 * Money movement (release / refund / payout) stays on Command Center.
 * Interactive WhatsApp is numbered menus — WAHA buttons are unreliable.
 */
import { normalizeKenyaPhone } from "../lib/phone-normalize.js";
import { normalizeOrderId } from "../lib/order-id.js";
import { getOrder, updateOrderMeta, getOrdersForCustomer } from "./orders.js";
import { sendText, toChatId } from "./whatsapp.js";
import { setMenuState } from "./session.js";
import { config } from "../config.js";

function deskOnly(tool) {
  return {
    ok: false,
    error: "desk_only",
    tool,
    message:
      "The ops agent cannot release escrow, refund, or pay out. Use Command Center on the admin desk.",
  };
}

function cleanText(value, max = 800) {
  return String(value || "").trim().slice(0, max);
}

export function releaseEscrowPayout() {
  return deskOnly("release_escrow_payout");
}

export function trigger12hDispatchRefund() {
  return deskOnly("trigger_12h_dispatch_refund");
}

export async function addRestockAlert({ customer_phone, product_id } = {}) {
  const phone = normalizeKenyaPhone(customer_phone);
  const raw = String(product_id || "").trim();
  if (!phone || !raw) {
    return { ok: false, error: "missing_lookup", tool: "add_restock_alert", message: "Need customer_phone and product_id." };
  }
  const { getProductById, searchProducts } = await import("./catalog.js");
  let product = await getProductById(raw);
  if (!product) {
    const hits = await searchProducts({ keywords: raw, limit: 1 });
    product = hits?.[0] || null;
  }
  if (!product?.id) {
    return { ok: false, error: "product_not_found", tool: "add_restock_alert", message: `No catalog match for ${raw}.` };
  }
  const { joinWaitlist } = await import("./product-waitlist.js");
  const joined = await joinWaitlist({
    phone,
    productId: product.id,
    productName: product.name,
  });
  return { ...joined, tool: "add_restock_alert", productId: product.id, productName: product.name };
}

export async function createMpesaStkPush(args = {}, extras = {}) {
  const id = normalizeOrderId(args.order_reference || args.order_id || args.orderId);
  const phone = normalizeKenyaPhone(args.phone_number || args.phone);
  if (!id) {
    return {
      ok: false,
      error: "missing_order",
      tool: "create_mpesa_stk_push",
      message: "Need an existing SKN order reference. Do not invent IDs or charge an arbitrary amount.",
    };
  }
  const order = getOrder(id);
  if (!order) {
    return {
      ok: false,
      error: "order_not_found",
      tool: "create_mpesa_stk_push",
      message: `Order ${id} was not found. Create the cart order first, then collect county + town + name.`,
    };
  }
  const amountKes = Number(order.totalKes ?? order.buyerTotalKes ?? order.priceKes) || 0;
  if (extras.dryRun === true) {
    return {
      ok: true,
      dryRun: true,
      tool: "create_mpesa_stk_push",
      orderId: order.id,
      phone: phone || normalizeKenyaPhone(order.phone || order.mpesaPhone) || null,
      amountKes,
      note: "STK uses the order total after the shipping gate — not the model’s amount.",
    };
  }
  const { initiateMpesaCheckout } = await import("./prepaid-checkout.js");
  const result = await initiateMpesaCheckout(order, { phone: phone || order.phone || order.mpesaPhone });
  return { ...result, tool: "create_mpesa_stk_push", orderId: order.id, amountKes };
}

export async function confirmItemDispatch({ order_id, courier_name, tracking_reference } = {}) {
  const id = normalizeOrderId(order_id);
  const courier = cleanText(courier_name, 80);
  const tracking = cleanText(tracking_reference, 80);
  if (!id || !courier) {
    return { ok: false, error: "missing_args", tool: "confirm_item_dispatch", message: "Need order_id and courier_name." };
  }
  const order = getOrder(id);
  if (!order) {
    return { ok: false, error: "not_found", tool: "confirm_item_dispatch", message: `Order ${id} was not found.` };
  }
  const { advanceShipmentStatus } = await import("./shipments.js");
  const result = advanceShipmentStatus(id, "in_transit", {
    actor: "ops_agent",
    courierName: courier,
    riderName: courier,
    trackingRef: tracking || undefined,
    note: "Ops agent confirm_item_dispatch",
  });
  if (result?.error) {
    return { ok: false, error: result.error, tool: "confirm_item_dispatch", message: `Could not dispatch (${result.error}).` };
  }
  updateOrderMeta(id, {
    sellerDispatchedAt: Date.now(),
    riderName: courier,
    ...(tracking ? { courierTrackingRef: tracking } : {}),
  });
  return {
    ok: true,
    tool: "confirm_item_dispatch",
    orderId: id,
    courierName: courier,
    trackingReference: tracking || null,
    shipmentStatus: "in_transit",
  };
}

export async function submitInspectionPhotos({ order_id, photo_urls, buyer_note } = {}) {
  const id = normalizeOrderId(order_id);
  const photos = Array.isArray(photo_urls)
    ? photo_urls.map((u) => String(u || "").trim()).filter((u) => /^https?:\/\//i.test(u)).slice(0, 8)
    : [];
  if (!id || !photos.length) {
    return {
      ok: false,
      error: "missing_args",
      tool: "submit_inspection_photos",
      message: "Need order_id and at least one http(s) photo URL.",
    };
  }
  const order = getOrder(id);
  if (!order) {
    return { ok: false, error: "not_found", tool: "submit_inspection_photos", message: `Order ${id} was not found.` };
  }
  const prev = Array.isArray(order.inspectionPhotos) ? order.inspectionPhotos : [];
  updateOrderMeta(id, {
    inspectionPhotos: [...prev, ...photos].slice(-12),
    inspectionBuyerNote: cleanText(buyer_note, 400) || order.inspectionBuyerNote || null,
    inspectionOpenedAt: order.inspectionOpenedAt || Date.now(),
    inspectionPhotoAt: Date.now(),
  });
  return {
    ok: true,
    tool: "submit_inspection_photos",
    orderId: id,
    photoCount: photos.length,
    inspectionOpen: true,
  };
}

export const MEDIATION_MIN_KES = 10_000;

function mediationPhonesForOrder(order) {
  return [
    order?.phone,
    order?.mpesaPhone,
    order?.sellerPhone,
    order?.supplierPhone,
    ...(Array.isArray(config.admin?.phones) ? config.admin.phones : []),
  ]
    .map((p) => normalizeKenyaPhone(p))
    .filter(Boolean);
}

export async function raiseOrderDispute({ order_id, dispute_reason, disputed_by } = {}, extras = {}) {
  const id = normalizeOrderId(order_id);
  const reason = cleanText(dispute_reason, 500);
  const who = String(disputed_by || "BUYER").trim().toUpperCase();
  if (!id || !reason) {
    return { ok: false, error: "missing_args", tool: "raise_order_dispute", message: "Need order_id and dispute_reason." };
  }
  if (!["BUYER", "SELLER"].includes(who)) {
    return { ok: false, error: "invalid_party", tool: "raise_order_dispute", message: "disputed_by must be BUYER or SELLER." };
  }
  const order = getOrder(id);
  if (!order) {
    return { ok: false, error: "not_found", tool: "raise_order_dispute", message: `Order ${id} was not found.` };
  }
  const { freezeOrderEscrow } = await import("./disputes.js");
  const frozen = await freezeOrderEscrow(id);
  updateOrderMeta(id, {
    disputeReason: reason,
    disputedBy: who,
  });
  const result = {
    ok: Boolean(frozen?.frozen),
    tool: "raise_order_dispute",
    orderId: id,
    frozen: Boolean(frozen?.frozen),
    disputedBy: who,
    reason,
    message: frozen?.frozen
      ? "Escrow frozen. Resolve on Command Center — the agent cannot pay out or refund."
      : frozen?.reason || "Could not freeze escrow.",
  };

  const total = Number(order.totalKes ?? order.buyerTotalKes ?? order.priceKes) || 0;
  if (frozen?.frozen && total >= MEDIATION_MIN_KES && extras.skipMediation !== true) {
    try {
      const group = await createMediationGroup(
        {
          group_name: `Dispute: ${id}`,
          participant_phones: mediationPhonesForOrder(order),
          initial_message:
            `Escrow hold on *${id}* (KES ${total}). ${who} opened a dispute: ${reason}\n\n` +
            `Photos and tracking stay on this order. Staff will mediate here — no payout or refund from this chat.`,
          order_id: id,
        },
        extras
      );
      result.mediation = {
        ok: group.ok,
        groupId: group.groupId || null,
        dryRun: Boolean(group.dryRun),
        error: group.error || null,
      };
    } catch (err) {
      result.mediation = { ok: false, error: String(err?.message || err).slice(0, 160) };
    }
  }
  return result;
}

export async function scheduleReorderReminderTool({ customer_phone, product_id, days_delay } = {}) {
  const { scheduleReorderReminder } = await import("./reorder-reminders.js");
  return scheduleReorderReminder({
    customerPhone: customer_phone,
    productId: product_id,
    daysDelay: days_delay,
  });
}

export function isAllowedOpsMediaUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") return true;
    if (host === "sokonimall.com" || host.endsWith(".sokonimall.com")) return true;
    const waha = String(config.waha?.apiUrl || "").trim();
    if (waha && host === new URL(waha).hostname.toLowerCase()) return true;
    const site = String(config.publicSiteUrl || "").trim();
    if (site && host === new URL(site).hostname.toLowerCase()) return true;
    const bot = String(config.botPublicUrl || "").trim();
    if (bot && host === new URL(bot).hostname.toLowerCase()) return true;
    return false;
  } catch {
    return false;
  }
}

function allowedMediaUrl(url) {
  return isAllowedOpsMediaUrl(url);
}

export async function processIncomingVoicenote({ media_url, sender_phone } = {}, extras = {}) {
  const phone = normalizeKenyaPhone(sender_phone);
  const url = String(media_url || "").trim();
  if (!url || !phone) {
    return { ok: false, error: "missing_args", tool: "process_incoming_voicenote", message: "Need media_url and sender_phone." };
  }
  if (extras.dryRun === true) {
    return { ok: true, dryRun: true, tool: "process_incoming_voicenote", phone, mediaUrl: url, transcript: "" };
  }
  if (!allowedMediaUrl(url)) {
    return {
      ok: false,
      error: "url_not_allowed",
      tool: "process_incoming_voicenote",
      message: "Only WAHA media URLs can be transcribed.",
    };
  }
  const res = await fetch(url);
  if (!res.ok) {
    return { ok: false, error: "download_failed", tool: "process_incoming_voicenote", message: `WAHA media ${res.status}.` };
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const { transcribeWhatsAppAudio } = await import("./commerce-ops.js");
  const stt = await transcribeWhatsAppAudio({
    buffer,
    mimetype: res.headers.get("content-type") || "audio/ogg",
  });
  return {
    ...stt,
    tool: "process_incoming_voicenote",
    phone,
  };
}

export async function escalateToHumanAgent({ customer_phone, summary_reason } = {}, extras = {}) {
  const phone = normalizeKenyaPhone(customer_phone);
  const reason = cleanText(summary_reason, 240);
  if (!phone || !reason) {
    return { ok: false, error: "missing_args", tool: "escalate_to_human_agent", message: "Need customer_phone and summary_reason." };
  }
  if (extras.dryRun === true) {
    return { ok: true, dryRun: true, tool: "escalate_to_human_agent", phone, reason };
  }
  const { assignAgent } = await import("./whatsapp-crm.js");
  const assigned = await assignAgent(
    {
      customerKey: toChatId(phone),
      phone,
      lastMessage: reason,
      reason: "support",
      priority: "high",
    },
    { silentAck: extras.silentAck === true }
  );
  return { ...assigned, tool: "escalate_to_human_agent", phone, reason };
}

export async function notifyAdminOps({ alert_level, message_body } = {}, extras = {}) {
  const level = String(alert_level || "INFO").trim().toUpperCase();
  const body = cleanText(message_body, 600);
  if (!["INFO", "WARNING", "CRITICAL"].includes(level) || !body) {
    return {
      ok: false,
      error: "missing_args",
      tool: "notify_admin_ops",
      message: "Need alert_level (INFO|WARNING|CRITICAL) and message_body.",
    };
  }
  const phones = Array.isArray(config.admin?.phones) ? config.admin.phones.filter(Boolean) : [];
  const text = `*[${level}]* ${body}`;
  if (!phones.length) {
    return { ok: false, error: "no_admin_phones", tool: "notify_admin_ops", message: "ADMIN_PHONES is not set." };
  }
  if (extras.dryRun === true) {
    return { ok: true, dryRun: true, tool: "notify_admin_ops", level, phones, text };
  }
  const send = extras.sender || sendText;
  for (const p of phones) {
    await send(toChatId(p), text);
  }
  return { ok: true, tool: "notify_admin_ops", level, sent: phones.length, phones };
}

function formatNumberedMenu(intro, items) {
  const lines = items.map((item, i) => {
    const title = cleanText(item.title || item.id, 40);
    const desc = cleanText(item.description, 60);
    return desc ? `${i + 1}. ${title} — ${desc}` : `${i + 1}. ${title}`;
  });
  return `${intro}\n\n${lines.join("\n")}\n\n_Reply with the number._`;
}

export async function sendWhatsAppButtons({ phone_number, message_text, buttons } = {}, extras = {}) {
  const phone = normalizeKenyaPhone(phone_number);
  const intro = cleanText(message_text, 400);
  const items = Array.isArray(buttons)
    ? buttons
        .filter((b) => b && (b.id || b.title))
        .slice(0, 3)
        .map((b) => ({ id: cleanText(b.id, 40), title: cleanText(b.title, 20) }))
    : [];
  if (!phone || !intro || !items.length) {
    return { ok: false, error: "missing_args", tool: "send_whatsapp_buttons", message: "Need phone_number, message_text, and 1–3 buttons." };
  }
  const body = formatNumberedMenu(intro, items);
  setMenuState(toChatId(phone), { type: "ops_buttons", options: items });
  if (extras.dryRun === true) {
    return { ok: true, dryRun: true, tool: "send_whatsapp_buttons", channel: "numbered_menu", phone, body, items };
  }
  const send = extras.sender || sendText;
  await send(toChatId(phone), body);
  return { ok: true, tool: "send_whatsapp_buttons", channel: "numbered_menu", phone, itemCount: items.length };
}

export async function sendWhatsAppList({ phone_number, menu_title, message_text, list_items } = {}, extras = {}) {
  const phone = normalizeKenyaPhone(phone_number);
  const intro = cleanText(message_text, 400);
  const title = cleanText(menu_title, 30) || "Options";
  const items = Array.isArray(list_items)
    ? list_items
        .filter((b) => b && (b.id || b.title))
        .slice(0, 10)
        .map((b) => ({
          id: cleanText(b.id, 40),
          title: cleanText(b.title, 40),
          description: cleanText(b.description, 60),
        }))
    : [];
  if (!phone || !intro || !items.length) {
    return { ok: false, error: "missing_args", tool: "send_whatsapp_list", message: "Need phone_number, message_text, and list_items." };
  }
  const body = formatNumberedMenu(`*${title}*\n${intro}`, items);
  setMenuState(toChatId(phone), { type: "ops_list", options: items });
  if (extras.dryRun === true) {
    return { ok: true, dryRun: true, tool: "send_whatsapp_list", channel: "numbered_menu", phone, body, items };
  }
  const send = extras.sender || sendText;
  await send(toChatId(phone), body);
  return { ok: true, tool: "send_whatsapp_list", channel: "numbered_menu", phone, itemCount: items.length };
}

function hasTillLeak(text) {
  return /\b(till|paybill|business\s*number)\b/i.test(String(text || ""));
}

export async function publishWhatsAppStatusOrChannel(
  { destination_type, channel_id, text, media_url } = {},
  extras = {}
) {
  const dest = String(destination_type || "BOTH").trim().toUpperCase();
  const wantStatus = dest === "STATUS" || dest === "BOTH" || dest === "ALL";
  const wantChannel = dest === "CHANNEL" || dest === "BOTH" || dest === "ALL";
  const body = cleanText(text, 700);
  if ((!wantStatus && !wantChannel) || !body) {
    return {
      ok: false,
      error: "missing_args",
      tool: "publish_whatsapp_status_or_channel",
      message: "Need destination_type (BOTH|STATUS|CHANNEL) and text.",
    };
  }
  if (hasTillLeak(body)) {
    return {
      ok: false,
      error: "no_till",
      tool: "publish_whatsapp_status_or_channel",
      message: "Do not publish till or paybill numbers. Prepaid checkout links only.",
    };
  }
  const media = String(media_url || "").trim();
  if (media && !allowedMediaUrl(media)) {
    return {
      ok: false,
      error: "url_not_allowed",
      tool: "publish_whatsapp_status_or_channel",
      message: "Media must be on WAHA or sokonimall.com.",
    };
  }

  const destinations = [];
  if (wantStatus) destinations.push("STATUS");
  if (wantChannel) destinations.push("CHANNEL");

  if (extras.dryRun === true || !config.waha?.apiUrl) {
    let channelId = channel_id || config.waha?.channelId || null;
    if (wantChannel && !channelId) {
      const { resolveWhatsAppChannelId } = await import("./whatsapp.js");
      const resolved = await resolveWhatsAppChannelId(channel_id);
      channelId = resolved.channelId || null;
    }
    return {
      ok: true,
      dryRun: true,
      tool: "publish_whatsapp_status_or_channel",
      destination: dest === "STATUS" || dest === "CHANNEL" ? dest : "BOTH",
      destinations,
      channelId: wantChannel ? channelId : null,
      text: body,
      mediaUrl: media || null,
    };
  }

  const posted = {};
  if (wantStatus) {
    const { publishWhatsAppStatus } = await import("./whatsapp.js");
    try {
      posted.status = { ok: true, ...(await publishWhatsAppStatus({ text: body, mediaUrl: media })) };
    } catch (err) {
      posted.status = { ok: false, error: String(err?.message || err).slice(0, 160) };
    }
  }
  if (wantChannel) {
    const { publishWhatsAppChannel } = await import("./whatsapp.js");
    posted.channel = await publishWhatsAppChannel({
      channelId: channel_id || config.waha?.channelId,
      text: body,
      mediaUrl: media,
    });
    if (posted.channel && posted.channel.ok === undefined) posted.channel.ok = !posted.channel.error;
  }

  const statusOk = !wantStatus || posted.status?.ok !== false;
  const channelOk = !wantChannel || posted.channel?.ok !== false;
  return {
    ok: statusOk || channelOk,
    tool: "publish_whatsapp_status_or_channel",
    destination: dest === "STATUS" || dest === "CHANNEL" ? dest : "BOTH",
    destinations,
    posted,
    partial: Boolean(wantStatus && wantChannel && !(statusOk && channelOk)),
  };
}

export async function listWhatsAppChannelsTool({ role = "OWNER" } = {}, extras = {}) {
  const { listWhatsAppChannels } = await import("./whatsapp.js");
  if (extras.dryRun === true || !config.waha?.apiUrl) {
    return {
      ok: true,
      dryRun: true,
      tool: "list_whatsapp_channels",
      role: role || "OWNER",
      channels: [],
      message: "WAHA GET /api/{session}/channels?role=OWNER — ids look like 111…@newsletter.",
    };
  }
  const listed = await listWhatsAppChannels({ role });
  return { ...listed, tool: "list_whatsapp_channels" };
}

export async function sendVideoNoteTool({ phone_number, video_url, order_id } = {}, extras = {}) {
  const phone = normalizeKenyaPhone(phone_number);
  const url = String(video_url || "").trim();
  if (!phone || !url) {
    return { ok: false, error: "missing_args", tool: "send_video_note", message: "Need phone_number and video_url." };
  }
  if (!allowedMediaUrl(url)) {
    return { ok: false, error: "url_not_allowed", tool: "send_video_note", message: "Video must be a WAHA or sokonimall.com URL." };
  }
  const known =
    extras.allowUnknown === true ||
    getOrdersForCustomer("", phone).length > 0 ||
    (Array.isArray(config.admin?.phones) && config.admin.phones.includes(phone));
  if (!known) {
    return {
      ok: false,
      error: "unknown_recipient",
      tool: "send_video_note",
      message: "Can only send a video note to a known buyer, seller, or admin.",
    };
  }
  const orderId = normalizeOrderId(order_id);
  if (orderId && getOrder(orderId)) {
    const order = getOrder(orderId);
    const prev = Array.isArray(order.inspectionVideos) ? order.inspectionVideos : [];
    updateOrderMeta(orderId, { inspectionVideos: [...prev, url].slice(-8), inspectionVideoAt: Date.now() });
  }
  if (extras.dryRun === true || !config.waha?.apiUrl) {
    return { ok: true, dryRun: true, tool: "send_video_note", phone, videoUrl: url, orderId: orderId || null };
  }
  const { sendVideoNote } = await import("./whatsapp.js");
  await sendVideoNote(phone, { url });
  return { ok: true, tool: "send_video_note", phone, videoUrl: url, orderId: orderId || null };
}

export async function createMediationGroup(
  { group_name, participant_phones, initial_message, order_id } = {},
  extras = {}
) {
  const name = cleanText(group_name, 80);
  const intro = cleanText(initial_message, 700);
  const fromArgs = (Array.isArray(participant_phones) ? participant_phones : [])
    .map((p) => normalizeKenyaPhone(p))
    .filter(Boolean);
  const orderRef = normalizeOrderId(order_id) || (name.match(/SKN-\d+(?:-\d+)?/i) || [])[0] || "";
  const order = orderRef ? getOrder(orderRef) : null;
  const phones = [...new Set([...fromArgs, ...(order ? mediationPhonesForOrder(order) : []), ...(config.admin?.phones || [])])];

  if (!name || !intro || phones.length < 2) {
    return {
      ok: false,
      error: "missing_args",
      tool: "create_mediation_group",
      message: "Need a group name, an initial message, and at least two Kenya numbers (buyer + seller or admin).",
    };
  }
  if (!order && fromArgs.length < 2) {
    return {
      ok: false,
      error: "unknown_parties",
      tool: "create_mediation_group",
      message: "Pass an SKN in the group name or two known party phones. Do not invent a group.",
    };
  }
  if (hasTillLeak(intro)) {
    return { ok: false, error: "no_till", tool: "create_mediation_group", message: "Do not put till numbers in the group intro." };
  }
  if (order?.mediationGroupId && extras.force !== true) {
    return {
      ok: true,
      already: true,
      tool: "create_mediation_group",
      groupId: order.mediationGroupId,
      orderId: order.id,
      message: "A mediation group already exists for this order.",
    };
  }

  if (extras.dryRun === true || !config.waha?.apiUrl) {
    return {
      ok: true,
      dryRun: true,
      tool: "create_mediation_group",
      groupId: "dryrun@g.us",
      name,
      phones,
      orderId: order?.id || null,
      text: intro,
    };
  }

  const { createWhatsAppGroup } = await import("./whatsapp.js");
  const created = await createWhatsAppGroup({ name, participants: phones });
  if (!created?.ok && !created?.groupId) {
    return { ok: false, error: created?.error || "group_failed", tool: "create_mediation_group", message: created?.message };
  }
  const groupId = created.groupId;
  if (order?.id) {
    updateOrderMeta(order.id, { mediationGroupId: groupId, mediationOpenedAt: Date.now() });
  }
  try {
    await sendText(groupId, intro);
  } catch (err) {
    console.warn("[mediation] intro send skipped:", err.message);
  }
  return {
    ok: true,
    tool: "create_mediation_group",
    groupId,
    name,
    phones,
    orderId: order?.id || null,
  };
}
