import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientError } from "./public-error.js";

describe("clientError", () => {
  it("never puts a stack or filesystem path on the JSON body in production", () => {
    const prev = process.env.NODE_ENV;
    const verbose = process.env.SOKONI_VERBOSE_ERRORS;
    process.env.NODE_ENV = "production";
    delete process.env.SOKONI_VERBOSE_ERRORS;
    try {
      const err = new Error("boom at run (/workspace/whatsapp-bot/src/server.js:12)");
      err.stack = "Error: boom\n    at run (/workspace/whatsapp-bot/src/server.js:12:3)";
      const body = clientError(err, "server_error");
      assert.equal(body.error, "server_error");
      assert.equal(body.detail, undefined);
      assert.equal(body.stack, undefined);
      const dumped = JSON.stringify(body);
      assert.equal(dumped.includes("server.js"), false);
      assert.equal(dumped.includes("at run"), false);
    } finally {
      if (prev == null) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
      if (verbose == null) delete process.env.SOKONI_VERBOSE_ERRORS;
      else process.env.SOKONI_VERBOSE_ERRORS = verbose;
    }
  });
});
