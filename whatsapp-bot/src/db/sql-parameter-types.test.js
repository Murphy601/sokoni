/**
 * Every parameterised statement is handed to Postgres to parse.
 *
 * Postgres infers a parameter's type from where it is used. Use the same $n in
 * two places that imply nothing, or imply different things, and the whole
 * statement fails to parse -- 42P08 "could not determine data type" or 42P18
 * "inconsistent types deduced". It fails every time, on any input, before a
 * single row is touched.
 *
 * Nothing catches it short of executing the statement. It is valid JavaScript,
 * the columns all exist, the parameter count is right, and the test suite
 * never ran the query. Rider registration was dead this way for days, and it
 * had already happened once before in setRiderVerificationStatus.
 *
 * So: build the real schema from db/*.sql in migration order, PREPARE every
 * statement in src/, and fail on any parameter-type fault.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOT = path.join(HERE, "..", "..");
const DB_DIR = path.join(BOT, "db");
const SRC_DIR = path.join(BOT, "src");

/** Migration order, read from migrate.js so the two cannot drift apart. */
function schemaFilesInOrder() {
  const src = fs.readFileSync(path.join(HERE, "migrate.js"), "utf8");
  const consts = {};
  for (const m of src.matchAll(/const (SCHEMA[A-Z0-9_]*PATH)\s*=[^;]*?["']([^"']+\.sql)["']/g)) {
    consts[m[1]] = m[2];
  }
  const files = [];
  const base = src.match(/applySchemaFile\("phase1 base schema",\s*(\w+)/);
  if (base && consts[base[1]]) files.push(consts[base[1]]);
  for (const m of src.matchAll(/\["[^"]+",\s*(SCHEMA[A-Z0-9_]*PATH)\]/g)) {
    if (consts[m[1]]) files.push(consts[m[1]]);
  }
  return files;
}

/** Statements with a ${} in them are assembled at runtime; skip those. */
function parameterisedStatements() {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) {
        const src = fs.readFileSync(p, "utf8");
        for (const m of src.matchAll(/`([^`]*\$\d+[^`]*)`/g)) {
          const sql = m[1];
          if (!/^\s*(INSERT|UPDATE|DELETE|SELECT|WITH)\b/i.test(sql.trim())) continue;
          if (sql.includes("${")) continue;
          out.push({ file: path.relative(BOT, p), sql });
        }
      }
    }
  })(SRC_DIR);
  return out;
}

const TYPE_FAULT = /could not determine data type|inconsistent types deduced/i;

let db = null;
let unavailable = "";

before(async () => {
  try {
    const { PGlite } = await import("@electric-sql/pglite");
    db = await PGlite.create();
    for (const f of schemaFilesInOrder()) {
      await db.exec(fs.readFileSync(path.join(DB_DIR, f), "utf8"));
    }
  } catch (err) {
    // Production installs with --omit=dev. Never fail the suite for a missing
    // test-only dependency; say so instead.
    unavailable = err.message;
  }
});

describe("parameter types resolve against the real schema", () => {
  it("has a schema to check against", () => {
    if (unavailable) {
      assert.match(unavailable, /Cannot find package|ERR_MODULE_NOT_FOUND/, unavailable);
      return;
    }
    assert.ok(db, "pglite did not start");
    assert.ok(schemaFilesInOrder().length > 25, "migration order looks wrong");
  });

  it("finds statements worth checking", () => {
    assert.ok(parameterisedStatements().length > 200);
  });

  it("parses every one of them without a parameter-type fault", async () => {
    if (unavailable) return;
    const statements = parameterisedStatements();
    const faults = [];
    let i = 0;
    for (const { file, sql } of statements) {
      try {
        await db.exec(`PREPARE chk${i} AS ${sql}`);
        await db.exec(`DEALLOCATE chk${i}`);
      } catch (err) {
        // Only parameter-type faults. Anything else here is this harness
        // meeting a statement it cannot prepare, not a bug in the statement.
        if (err.code === "42P08" || err.code === "42P18" || TYPE_FAULT.test(err.message)) {
          faults.push(`${file}: ${err.message}\n      ${sql.trim().split("\n")[0].slice(0, 100)}`);
        }
      }
      i += 1;
    }
    assert.deepEqual(faults, [], `\n  ${faults.join("\n  ")}\n`);
  });
});

describe("the statements this was found through", () => {
  const fleet = fs.readFileSync(path.join(SRC_DIR, "services", "boda-fleet.js"), "utf8");
  const social = fs.readFileSync(path.join(SRC_DIR, "db", "repositories", "social.js"), "utf8");

  it("casts the rider stage pin", () => {
    // $18 also feeds `CASE WHEN $18 IS NULL`, which tells Postgres nothing.
    // Uncast, no rider could ever register.
    assert.match(fleet, /\$18::double precision, \$19::double precision/);
    assert.match(fleet, /CASE WHEN \$18::double precision IS NULL/);
  });

  it("casts the rider payout amounts", () => {
    // $3 lands in two numeric columns through a SELECT, so no column type is
    // available to infer from.
    assert.doesNotMatch(fleet, /SELECT \$1, \$2, \$3, \$3, 'PENDING_CLEAR'/);
    assert.match(fleet, /UPPER\(\$2::varchar\)/);
  });

  it("casts the mpesa name status", () => {
    assert.match(fleet, /mpesa_name_match_status = \$3::varchar/);
  });

  it("casts the shop pin rank", () => {
    assert.match(social, /pin_rank = \$3::smallint/);
  });
});
