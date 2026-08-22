/**
 * Seller wallet / balance replies over WhatsApp (phone-verified, no web session needed).
 */
import { sendText } from "./whatsapp.js";
import { findSupplierByPhone } from "./suppliers.js";
import { getSellerEscrowLedger } from "./seller-onboard.js";
import { getWithdrawableEntries, requestSellerWithdrawalByPhone } from "./seller-withdrawals.js";
import { config } from "../config.js";

export function isSellerWalletIntent(text) {
  const t = String(text || "").trim().toLowerCase();
  return (
    t === "balance" ||
    t === "wallet" ||
    t === "my balance" ||
    t === "my wallet" ||
    t === "payout" ||
    t === "payouts" ||
    t === "earnings" ||
    /^seller\s+(balance|wallet)$/i.test(t)
  );
}

export function isSellerWithdrawIntent(text) {
  const t = String(text || "").trim().toLowerCase();
  return t === "withdraw" || t === "cash out" || t === "cashout" || t === "withdraw all";
}

export function formatSellerWalletReply(supplier) {
  const ledger = getSellerEscrowLedger(supplier.id);
  const owed = getWithdrawableEntries(supplier.id);
  const withdrawable = owed.reduce((s, e) => s + (e.payoutAmountKes || 0), 0);

  return (
    `💼 *SELLER DASHBOARD SUMMARY*\n` +
    `_${supplier.businessName || supplier.shopName || supplier.id}_\n\n` +
    `🟢 Ready for M-Pesa: *KES ${withdrawable.toLocaleString()}*\n` +
    `🟡 Pending escrow (still held): *KES ${ledger.pendingEscrow.totalKes.toLocaleString()}*\n` +
    `🚚 In transit: *KES ${ledger.inTransit.totalKes.toLocaleString()}*\n\n` +
    `Reply *WITHDRAW* to cash out Ready funds only.\n` +
    `Seller Hub: sokonimall.com/suppliers/list.html\n` +
    `· Hub Drop-Offs · Inventory (units) · WhatsApp Promo (@handle)\n` +
    `· Orders · Offers · Grow · M-Pesa Ledger`
  );
}

/** Handle balance / wallet / withdraw for registered sellers. Returns true if handled. */
export async function handleSellerWalletMessage(customerKey, text, { phone = "" } = {}) {
  const supplier = findSupplierByPhone(phone);
  if (!supplier) return false;

  if (isSellerWithdrawIntent(text)) {
    const result = await requestSellerWithdrawalByPhone(phone);
    if (result.error === "not_onboarded") return false;
    if (result.error === "no_balance") {
      await sendText(
        customerKey,
        `💸 Nothing to withdraw yet.\n\nEarnings appear here after delivery and escrow release.\n\nReply *balance* for your summary.`
      );
      return true;
    }
    if (result.error === "withdrawal_pending") {
      await sendText(
        customerKey,
        `${result.request?.queued || result.request?.rail === "admin" ? "🕐" : "⏳"} Withdrawal *${result.request?.id}* is already queued.\n\nWe'll M-Pesa *KES ${result.request?.amountKes?.toLocaleString()}* to your registered number shortly.`
      );
      return true;
    }
    if (result.error) {
      await sendText(customerKey, `⚠️ ${result.message || result.error}`);
      return true;
    }
    await sendText(
      customerKey,
      result.message ||
        `✅ *Withdrawal request ${result.request.id}*\n\n` +
          `Amount: *KES ${result.request.amountKes.toLocaleString()}*\n` +
          `M-Pesa: *${result.request.mpesaNumber}*\n\n` +
          `_Processing usually within 1 business day._`
    );
    return true;
  }

  if (isSellerWalletIntent(text)) {
    await sendText(customerKey, formatSellerWalletReply(supplier));
    return true;
  }

  return false;
}
