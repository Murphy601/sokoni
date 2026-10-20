import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const MENU = readFileSync(new URL("./menu.js", import.meta.url), "utf8");
const ORDERS = readFileSync(new URL("./orders.js", import.meta.url), "utf8");
const FLEET = readFileSync(new URL("./boda-fleet.js", import.meta.url), "utf8");

/**
 * The buyer's pin has to survive the whole way to the dispatch row. It is the
 * only thing the rider's CONFIRM geofence can measure against, and dropping it
 * anywhere along the chain produces "Drop-off GPS is not on file" at the door
 * -- after the rider has already ridden there and shared their location.
 */
describe("the buyer pin reaches the rider's geofence", () => {
  it("is captured on the pending order", () => {
    const step = MENU.slice(MENU.indexOf("if (step === ORDER_STEPS.LOCATION) {"));
    assert.match(step.slice(0, 1400), /buyerLat: droppedPin\.lat/);
  });

  it("is handed to createOrder, not just used for the quote", () => {
    const call = MENU.slice(MENU.indexOf("order = createOrder({"), MENU.indexOf("offerId: pending.offerId"));
    assert.match(call, /buyerLat: pending\.buyerLat/);
    assert.match(call, /buyerLng: pending\.buyerLng/);
  });

  it("is stored on the order record", () => {
    assert.match(ORDERS, /buyerLat: normalizePin\(/);
    assert.match(ORDERS, /buyerLng: normalizePin\(/);
  });

  it("is read when the rider is dispatched", () => {
    assert.match(FLEET, /parseCoordPair\(order\.buyerLat, order\.buyerLng\)/);
  });

  it("is validated on the way in, so a bad pin is never stored as real", () => {
    // A stored 0,0 would put the geofence 500km out and lock the rider out
    // of a delivery they are standing at.
    assert.match(ORDERS, /normalizePin\(\{ lat: details\.buyerLat, lng: details\.buyerLng \}\)/);
  });
});
