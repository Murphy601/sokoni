/**
 * Unit-style checks for email account password hashing (no DB required).
 */
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/services/account-auth.js";

const hash = await hashPassword("sokoni-test-9");
assert.match(hash, /^scrypt\$/);
assert.equal(await verifyPassword("sokoni-test-9", hash), true);
assert.equal(await verifyPassword("wrong-password", hash), false);

const hash2 = await hashPassword("sokoni-test-9");
assert.notEqual(hash, hash2, "salts should differ");
assert.equal(await verifyPassword("sokoni-test-9", hash2), true);

console.log("test-account-auth: ok");
