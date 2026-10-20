/**
 * Static checks for seller @lid ↔ phone linking used by DISPATCH.
 */
import assert from "node:assert/strict";

const {
  registerSellerChatId,
  getSellerPhoneForChatId,
  listChatIdsForSellerPhone,
  rememberSellerNotifyTarget,
  bindSellerWhatsAppChat,
} = await import("../src/services/seller-chat-ids.js");

const lid = "123456789012345@lid";
const phone = "254712345678";

registerSellerChatId(lid, phone);
assert.equal(getSellerPhoneForChatId(lid), phone);

const primary = rememberSellerNotifyTarget(phone, lid);
assert.equal(primary, `${phone}@c.us`);
assert.equal(getSellerPhoneForChatId(`${phone}@c.us`), phone);

const chats = listChatIdsForSellerPhone(phone);
assert.ok(chats.includes(lid), "linked @lid should be listed");
assert.ok(chats.includes(`${phone}@c.us`), "primary @c.us should be listed");

const onboardLid = "999888777666555@lid";
const onboardPhone = "254700111222";
bindSellerWhatsAppChat(onboardLid, onboardPhone);
assert.equal(getSellerPhoneForChatId(onboardLid), onboardPhone);
assert.equal(getSellerPhoneForChatId(`${onboardPhone}@c.us`), onboardPhone);

const { resolveInboundSellerPhone, sellerNotifyTargets } = await import(
  "../src/services/communication-hub.js"
);

assert.equal(resolveInboundSellerPhone("", lid), phone);
assert.equal(resolveInboundSellerPhone("0712345678", "unknown@lid"), "254712345678");
assert.equal(resolveInboundSellerPhone("", onboardLid), onboardPhone);

const targets = sellerNotifyTargets(phone);
assert.ok(targets.includes(`${phone}@c.us`));
assert.ok(targets.includes(lid));

console.log("ok: seller-chat-ids + onboarding bind + resolveInboundSellerPhone");
