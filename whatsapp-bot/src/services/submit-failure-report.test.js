/**
 * When a submit fails, ops finds out why.
 *
 * Rider registration was broken for days across several deploys. The
 * applicant saw "Couldn't reach Sokoni ops just now", which is true and
 * useless, and the actual reason went to a log file nobody was reading. Every
 * round of diagnosis started with someone SSHing into the VM to grep.
 *
 * The reason now goes where ops already looks.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const RIDER = src("./rider-onboarding.js");
const SELLER = src("./seller-onboarding.js");
const DEPLOY = readFileSync(new URL("../../../scripts/deploy-bot.sh", import.meta.url), "utf8");

describe("a failed submit reports itself", () => {
  it("alerts ops from the rider flow", () => {
    assert.match(RIDER, /async function reportSubmitFailure/);
    assert.match(RIDER, /void reportSubmitFailure\("rider"/);
  });

  it("alerts ops from the seller flow", () => {
    assert.match(SELLER, /async function reportSellerSubmitFailure/);
    assert.match(SELLER, /void reportSellerSubmitFailure\(/);
  });

  it("carries the real error, not a restatement of the apology", () => {
    const fn = RIDER.slice(RIDER.indexOf("async function reportSubmitFailure"));
    const body = fn.slice(0, 1200);
    assert.match(body, /err\?\.message/);
    assert.match(body, /err\?\.code/);
  });

  it("points at the likeliest cause rather than just the message", () => {
    // A missing column is what this episode turned out to be about, and it is
    // not obvious from a bare Postgres error to whoever reads the alert.
    const fn = RIDER.slice(RIDER.indexOf("async function reportSubmitFailure"));
    assert.match(fn.slice(0, 1200), /db:migrate/);
  });

  it("cannot itself break a submit", () => {
    // The alert is a convenience. If WAHA is down, the applicant's answers
    // still have to be saved and the apology still has to send.
    for (const [name, text] of [
      ["reportSubmitFailure", RIDER],
      ["reportSellerSubmitFailure", SELLER],
    ]) {
      const fn = text.slice(text.indexOf(`async function ${name}`));
      const body = fn.slice(0, 1200);
      assert.match(body, /try \{/);
      assert.match(body, /catch \{/);
      assert.ok(text.includes(`void ${name}(`), `${name} must not be awaited`);
    }
  });
});

describe("a failed migration is impossible to miss", () => {
  it("no longer hides behind a single WARN line", () => {
    // `npm run db:migrate || echo WARN` printed one line in the middle of
    // several hundred and the deploy still reported success, so the code
    // shipped ahead of the schema and nobody knew.
    assert.doesNotMatch(DEPLOY, /npm run db:migrate \|\| echo/);
    assert.match(DEPLOY, /if ! npm run db:migrate; then/);
  });

  it("says what broke and what to run", () => {
    const at = DEPLOY.indexOf("if ! npm run db:migrate; then");
    const block = DEPLOY.slice(at, at + 800);
    assert.match(block, /MIGRATE_FAILED=1/);
    assert.match(block, /schema is behind the code/);
    assert.match(block, /npm run db:migrate/);
  });
});
