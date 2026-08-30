import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

describe("setRiderVerificationStatus SQL", () => {
  it("does not reuse $2 in CASE compares (PG inconsistent types)", () => {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "boda-fleet.js");
    const src = fs.readFileSync(file, "utf8");
    const fnStart = src.indexOf("export async function setRiderVerificationStatus");
    assert.ok(fnStart >= 0);
    const fnEnd = src.indexOf("\nexport async function listRiderStatusCounts", fnStart);
    const body = src.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 2500);
    assert.equal(
      /CASE WHEN \$2\s*=/.test(body),
      false,
      "must not use CASE WHEN $2 = … (causes inconsistent types deduced for parameter $2)"
    );
    assert.match(body, /verification_status = \$2::varchar/);
    assert.match(body, /is_available = \$3::boolean/);
  });
});
