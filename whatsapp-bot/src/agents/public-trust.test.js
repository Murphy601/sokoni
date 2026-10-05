/**
 * Public trust: a review ask waits a day, and a missing inspection photo
 * does not page support.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  reviewAskDue,
  reviewAskText,
  reviewUrlAllowed,
  processReviewAsks,
  REVIEW_AFTER_MS,
} from "./review-nudge.js";
import { isWhereIsMyOrder } from "../services/order-status-question.js";
import {
  askBuyerForInspectionPhoto,
  inspectionPhotoAskText,
} from "../services/inspection-photo-request.js";

const src = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const day = 1_700_000_000_000;

describe("a review ask", () => {
  const done = {
    id: "SKN-1002",
    escrowStatus: "released",
    buyerConfirmedAt: day,
  };

  it("waits 24 hours after a clean release", () => {
    assert.equal(reviewAskDue(done, day + REVIEW_AFTER_MS - 1), false);
    assert.equal(reviewAskDue(done, day + REVIEW_AFTER_MS), true);
  });

  it("stays quiet for a dispute, a refund, or a second ask", () => {
    assert.equal(reviewAskDue({ ...done, disputeHold: true }, day + REVIEW_AFTER_MS), false);
    assert.equal(reviewAskDue({ ...done, escrowStatus: "refunded" }, day + REVIEW_AFTER_MS), false);
    assert.equal(reviewAskDue({ ...done, reviewRequestedAt: day }, day + REVIEW_AFTER_MS), false);
    assert.equal(reviewAskDue({ ...done, kind: "cart_parent" }, day + REVIEW_AFTER_MS), false);
  });

  it("only accepts an https Trustpilot link", () => {
    assert.equal(reviewUrlAllowed("https://www.trustpilot.com/review/sokonimall.com"), true);
    assert.equal(reviewUrlAllowed("http://www.trustpilot.com/review/sokonimall.com"), false);
    assert.equal(reviewUrlAllowed("https://example.com/review"), false);
    assert.equal(reviewUrlAllowed(""), false);
  });

  it("does not message anyone until the review page exists", async () => {
    let sent = 0;
    const quiet = await processReviewAsks({
      orders: [done],
      now: day + REVIEW_AFTER_MS,
      reviewUrl: "",
      send: async () => {
        sent += 1;
      },
    });
    assert.equal(quiet.reason, "no_review_url");
    assert.equal(sent, 0);
  });

  it("sends once, to a real chat, and clears the stamp if the send fails", async () => {
    const stamped = [];
    const cleared = [];
    const messages = [];
    const url = "https://www.trustpilot.com/review/sokonimall.com";
    const result = await processReviewAsks({
      orders: [{ ...done, customerKey: "web:buyer:4" }, { ...done, id: "SKN-1003", customerKey: "web:buyer:9" }],
      now: day + REVIEW_AFTER_MS,
      reviewUrl: url,
      destination: async (order) => (order.id === "SKN-1003" ? "web:buyer:9" : "254711111111@c.us"),
      markRequested: (id) => stamped.push(id),
      clearRequested: (id) => cleared.push(id),
      send: async (to, text) => {
        messages.push({ to, text });
        if (to.includes("254711111111")) throw new Error("waha down");
      },
    });
    assert.equal(result.sent, 0);
    assert.deepEqual(stamped, ["SKN-1002"]);
    assert.deepEqual(cleared, ["SKN-1002"]);
    assert.equal(messages.length, 1);
    assert.match(messages[0].text, /SKN-1002/);
    assert.match(reviewAskText(done, url), /trustpilot\.com/);
    assert.doesNotMatch(messages[0].to, /web:buyer/);
  });
});

describe("where is my order", () => {
  it("answers from the order record and leaves a shop message alone", () => {
    assert.equal(isWhereIsMyOrder("Where is my order?"), true);
    assert.equal(isWhereIsMyOrder("order yangu iko wapi"), true);
    assert.equal(isWhereIsMyOrder("I want a red dress under 2000"), false);
    const webhook = src("../handlers/webhookHandler.js");
    const track = webhook.slice(webhook.indexOf("Track always works"));
    assert.match(track, /isWhereIsMyOrder/);
    assert.doesNotMatch(track.slice(0, track.indexOf("sendTrackOrderMenu")), /notifyAdmin/);
  });
});

describe("an inspection photo", () => {
  it("asks the buyer and does not open a dispute or page support", async () => {
    const file = src("../services/inspection-photo-request.js");
    assert.doesNotMatch(file, /notifyAdmin|createDispute|proposeAgentAction/);
    const marks = [];
    const waiting = [];
    const sent = [];
    const result = await askBuyerForInspectionPhoto(
      { id: "SKN-1002" },
      {
        destination: async () => "254711111111@c.us",
        markOrder: (id, patch) => marks.push({ id, patch }),
        markAwaiting: async (chatId, orderId) => waiting.push({ chatId, orderId }),
        send: async (to, text) => sent.push({ to, text }),
      }
    );
    assert.equal(result.asked, true);
    assert.equal(marks[0].id, "SKN-1002");
    assert.ok(marks[0].patch.inspectionPhotoRequestedAt > 0);
    assert.equal(waiting[0].orderId, "SKN-1002");
    assert.match(sent[0].text, /photo/);
    assert.match(inspectionPhotoAskText({ id: "SKN-1002" }), /not paged before the photo/);
    const route = src("../routes/disputesApi.js");
    const claim = route.slice(route.indexOf('router.post("/inspection-claim"'));
    const ask = claim.indexOf("askBuyerForInspectionPhoto");
    const open = claim.indexOf("openInspectionClaim");
    assert.ok(ask !== -1 && open !== -1 && ask < open);
  });
});
