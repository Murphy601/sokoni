import { config } from "../config.js";
import { sendText } from "./whatsapp.js";
import { getOrder, updateOrderMeta, updateOrderStatus } from "./orders.js";
import {
  wrongOrderApologyMessage,
  damagedReturnMessage,
  delayedDeliveryMessage,
  postDeliveryDamageMessage,
  orderCancellationMessage,
  outForDeliveryMessage,
} from "./trust-copy.js";

/** Parse `ordered:sandals received:perfume` style flags from admin command tail. */
export function parseOpsFlags(text) {
  const flags = {};
  const re = /(ordered|received|rider|phone|eta|reason):(\S+)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    flags[m[1].toLowerCase()] = m[2].replace(/_/g, " ");
  }
  return flags;
}

export function parseOrderIdFromArgs(args) {
  const match = String(args || "").trim().match(/\b(SK-\d+)\b/i);
  return match ? match[1].toUpperCase() : null;
}

async function notifyCustomer(order, message, metaPatch = {}) {
  await sendText(order.customerKey, message);
  updateOrderMeta(order.id, {
    ...metaPatch,
    lastOpsMessageAt: Date.now(),
  });
}

/** #apolog / #wrong SK-1042 [ordered:X received:Y] */
export async function handleApologCommand(adminChatId, args) {
  const orderId = parseOrderIdFromArgs(args);
  if (!orderId) {
    return sendText(
      adminChatId,
      "Usage: #apolog SK-1042\nOr: #wrong SK-1042 ordered:sandals received:perfume"
    );
  }
  const order = getOrder(orderId);
  if (!order) return sendText(adminChatId, `⚠️ Order *${orderId}* not found.`);

  const flags = parseOpsFlags(args);
  const msg = wrongOrderApologyMessage({
    orderId: order.id,
    productName: order.productName,
    customerName: order.customerName,
    orderedItem: flags.ordered,
    receivedItem: flags.received,
  });

  try {
    await notifyCustomer(order, msg, {
      issueType: "wrong_order",
      issueOrderedItem: flags.ordered || order.productName,
      issueReceivedItem: flags.received || null,
      awaitingCustomerAction: "replace_or_cancel",
    });
    return sendText(
      adminChatId,
      `✅ Wrong-order apology sent to *${order.customerName}* (${order.id}).\nThey can reply *REPLACE* or *CANCEL*.`
    );
  } catch (err) {
    return sendText(adminChatId, `⚠️ Failed: ${err.message}`);
  }
}

/** #damage SK-1042 — doorstep return / damaged wrong variant */
export async function handleDamageCommand(adminChatId, args) {
  const orderId = parseOrderIdFromArgs(args);
  if (!orderId) return sendText(adminChatId, "Usage: #damage SK-1042 [reason:damaged]");
  const order = getOrder(orderId);
  if (!order) return sendText(adminChatId, `⚠️ Order *${orderId}* not found.`);

  const flags = parseOpsFlags(args);
  const reason = flags.reason || "damaged / wrong variant";
  const msg = damagedReturnMessage({
    orderId: order.id,
    productName: order.productName,
    reason,
  });

  try {
    await notifyCustomer(order, msg, {
      issueType: "damaged_return",
      issueReason: reason,
      awaitingCustomerAction: "replace_or_cancel",
    });
    return sendText(adminChatId, `✅ Damage/return message sent for *${order.id}*.`);
  } catch (err) {
    return sendText(adminChatId, `⚠️ Failed: ${err.message}`);
  }
}

/** #delay SK-1042 later today */
export async function handleDelayCommand(adminChatId, args) {
  const orderId = parseOrderIdFromArgs(args);
  if (!orderId) return sendText(adminChatId, "Usage: #delay SK-1042 later today");
  const order = getOrder(orderId);
  if (!order) return sendText(adminChatId, `⚠️ Order *${orderId}* not found.`);

  const rest = args.replace(/\bSK-\d+\b/i, "").trim();
  const newWindow = rest || "later today";
  const msg = delayedDeliveryMessage({
    orderId: order.id,
    productName: order.productName,
    newWindow,
  });

  try {
    await notifyCustomer(order, msg, { issueType: "delay", delayWindow: newWindow });
    return sendText(adminChatId, `✅ Delay notice sent for *${order.id}* (${newWindow}).`);
  } catch (err) {
    return sendText(adminChatId, `⚠️ Failed: ${err.message}`);
  }
}

/** #oos SK-1042 — supplier out of stock cancellation */
export async function handleOosCommand(adminChatId, args) {
  const orderId = parseOrderIdFromArgs(args);
  if (!orderId) return sendText(adminChatId, "Usage: #oos SK-1042");
  const order = getOrder(orderId);
  if (!order) return sendText(adminChatId, `⚠️ Order *${orderId}* not found.`);

  const result = updateOrderStatus(orderId, "cancelled");
  if (!result || result.error) {
    return sendText(adminChatId, `⚠️ Could not cancel *${orderId}*.`);
  }

  const msg = orderCancellationMessage({
    orderId: order.id,
    productName: order.productName,
  });

  try {
    await notifyCustomer(result.order, msg, { issueType: "out_of_stock" });
    return sendText(adminChatId, `✅ *${orderId}* cancelled + customer notified (out of stock).`);
  } catch (err) {
    return sendText(adminChatId, `⚠️ Cancelled in system but notify failed: ${err.message}`);
  }
}

/** #transit SK-1042 rider:John phone:0712345678 eta:2 hours */
export async function handleTransitCommand(adminChatId, args) {
  const orderId = parseOrderIdFromArgs(args);
  if (!orderId) {
    return sendText(
      adminChatId,
      "Usage: #transit SK-1042 rider:John phone:0712345678 eta:2 hours"
    );
  }
  const order = getOrder(orderId);
  if (!order) return sendText(adminChatId, `⚠️ Order *${orderId}* not found.`);

  const flags = parseOpsFlags(args);
  const msg = outForDeliveryMessage({
    orderId: order.id,
    productName: order.productName,
    customerName: order.customerName,
    riderName: flags.rider,
    riderPhone: flags.phone,
    timeWindow: flags.eta,
  });

  try {
    await notifyCustomer(order, msg, {
      riderName: flags.rider || null,
      riderPhone: flags.phone || null,
      transitEta: flags.eta || null,
    });
    if (order.status !== "out_for_delivery") {
      updateOrderStatus(orderId, "out_for_delivery");
    }
    return sendText(adminChatId, `✅ Transit alert sent for *${order.id}*.`);
  } catch (err) {
    return sendText(adminChatId, `⚠️ Failed: ${err.message}`);
  }
}

/** #recover SK-1042 — post-delivery damage / broken item */
export async function handleRecoverCommand(adminChatId, args) {
  const orderId = parseOrderIdFromArgs(args);
  if (!orderId) return sendText(adminChatId, "Usage: #recover SK-1042");
  const order = getOrder(orderId);
  if (!order) return sendText(adminChatId, `⚠️ Order *${orderId}* not found.`);

  const msg = postDeliveryDamageMessage({
    orderId: order.id,
    productName: order.productName,
    customerName: order.customerName,
  });

  try {
    await notifyCustomer(order, msg, {
      issueType: "post_delivery_damage",
      awaitingDamagePhoto: true,
    });
    return sendText(adminChatId, `✅ Recovery message sent for *${order.id}* (awaiting photo).`);
  } catch (err) {
    return sendText(adminChatId, `⚠️ Failed: ${err.message}`);
  }
}

/** Notify admin when customer chooses REPLACE / CANCEL on a wrong-order thread. */
export async function alertAdminIssueAction({ customerKey, orderId, action, displayName, phone }) {
  const admin = config.admin.primary;
  if (!admin) return;
  try {
    await sendText(
      admin,
      `🔄 *Customer issue action*\n` +
        `Order: *${orderId}*\n` +
        `Action: *${action}*\n` +
        `Customer: ${displayName || "—"} · ${phone || customerKey}\n\n` +
        (action === "REPLACE"
          ? "Dispatch correct item and update order."
          : "Close request — customer owes nothing on COD.")
    );
  } catch {
    /* ignore */
  }
}
