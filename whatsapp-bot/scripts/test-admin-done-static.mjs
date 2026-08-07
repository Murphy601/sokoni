#!/usr/bin/env node
/**
 * Static checks: admin #done / #resolve routing to resume bot after HELP/dispute.
 * Run: node scripts/test-admin-done-static.mjs
 */
import { containsAdminCommand } from "../src/services/admin.js";

let failed = 0;
function assert(label, cond) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

assert("#done SK routed as admin command", containsAdminCommand("#done SK-1042"));
assert("#Done case-insensitive", containsAdminCommand("#Done SK-99"));
assert("#done alone routed", containsAdminCommand("#done"));
assert("#resolve still routed", containsAdminCommand("#resolve SK-1042"));
assert("#SK message still routed", containsAdminCommand("#SK-1042 hello"));
assert("#SKN message routed", containsAdminCommand("#SKN-1002-1 hello"));
assert("#done SKN routed", containsAdminCommand("#done SKN-1002-1"));
assert("plain chat not an admin command", !containsAdminCommand("hello menu"));
assert("DONE without hash is user command (not admin)", !containsAdminCommand("DONE SK-1042"));

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall ok");
