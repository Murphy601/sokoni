import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NO_SHOW_WAIT_MINUTES,
  NO_SHOW_RETURN_FEE_FRACTION,
  STK_TIMEOUT_MS,
  WAYBILL_REQUIRED_PHOTOS,
} from "./ops-edge-constants.js";

describe("ops-edge-constants", () => {
  it("defines no-show 15-min wait and 50% return fee", () => {
    assert.equal(NO_SHOW_WAIT_MINUTES, 15);
    assert.equal(NO_SHOW_RETURN_FEE_FRACTION, 0.5);
    assert.equal(Math.round(350 * NO_SHOW_RETURN_FEE_FRACTION), 175);
  });

  it("defines 180s STK timeout and 2 waybill photos", () => {
    assert.equal(STK_TIMEOUT_MS, 180_000);
    assert.equal(WAYBILL_REQUIRED_PHOTOS, 2);
  });
});
