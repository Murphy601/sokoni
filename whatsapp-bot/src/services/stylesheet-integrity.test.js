/**
 * The stylesheets have to parse.
 *
 * A rebase conflict resolution dropped the closing brace of
 * `.inbox-mic.is-recording`. CSS has no error to report here -- the browser
 * simply keeps reading declarations until it finds a `}`, so the next 135
 * lines were swallowed into that one rule and silently stopped applying. The
 * whole seller-tools sheet shipped to production with no styling at all.
 *
 * Nothing caught it because every test asked whether a rule was in the file,
 * and it was. Being in the file and being applied are different things.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CSS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "website",
  "assets",
  "css"
);

const sheets = readdirSync(CSS_DIR)
  .filter((f) => f.endsWith(".css"))
  .map((f) => ({ name: f, text: readFileSync(path.join(CSS_DIR, f), "utf8") }));

/** Strip comments and strings so braces inside them do not count. */
function stripNoise(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

/** Where the brace depth last returned to zero, 1-indexed. */
function lastBalancedLine(css) {
  const lines = stripNoise(css).split("\n");
  let depth = 0;
  let lastZero = 0;
  for (let i = 0; i < lines.length; i += 1) {
    for (const ch of lines[i]) {
      if (ch === "{") depth += 1;
      if (ch === "}") depth -= 1;
    }
    if (depth === 0) lastZero = i + 1;
  }
  return { depth, lastZero, total: lines.length };
}

describe("every stylesheet closes what it opens", () => {
  it("finds at least the main sheet, so this is not passing on an empty list", () => {
    assert.ok(sheets.length > 0);
    assert.ok(sheets.some((s) => s.name === "depop-surfaces.css"));
  });

  for (const sheet of sheets) {
    it(`${sheet.name} is brace-balanced`, () => {
      const { depth, lastZero, total } = lastBalancedLine(sheet.text);
      assert.equal(
        depth,
        0,
        `${sheet.name}: ${depth > 0 ? depth + " rule(s) never closed" : "extra }"}. ` +
          `Depth last returned to zero at line ${lastZero} of ${total}, so everything ` +
          `after that line is swallowed and never applies.`
      );
    });

    it(`${sheet.name} never closes more than it opens`, () => {
      // A stray } ends the rule early and orphans the rest of its declarations.
      const lines = stripNoise(sheet.text).split("\n");
      let depth = 0;
      for (let i = 0; i < lines.length; i += 1) {
        for (const ch of lines[i]) {
          if (ch === "{") depth += 1;
          if (ch === "}") depth -= 1;
        }
        assert.ok(depth >= 0, `${sheet.name}: unmatched } at line ${i + 1}`);
      }
    });
  }
});

describe("the rules that shipped dead are back", () => {
  const main = sheets.find((s) => s.name === "depop-surfaces.css").text;

  it("styles the seller tools sheet", () => {
    // These were all inside the swallowed region.
    for (const sel of [
      "#seller-tools-drawer",
      ".seller-tool-row",
      ".seller-tool-send",
      ".inbox-seller-tools-btn:not(.hidden)",
    ]) {
      assert.ok(main.includes(sel), `${sel} missing`);
    }
  });

  it("closes the mic recording rule that swallowed them", () => {
    const at = main.indexOf(".inbox-mic.is-recording {");
    assert.ok(at !== -1);
    const rule = main.slice(at, at + 200);
    assert.match(rule, /\.inbox-mic\.is-recording \{[^{}]*\}/);
  });
});
