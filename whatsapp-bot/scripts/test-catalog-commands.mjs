import {
  normalizeCatalogCommandLine,
  isCatalogCommand,
  parseAddCommand,
  parsePriceCommand,
} from "../src/services/catalog-admin.js";

const cases = [
  ["#add Tecno Spark | phones-tablets | cost 12000", true, "add"],
  ["add → Women sandals | fashion | 130", true, "add"],
  ["add Women sandals | fashion | 130", true, "add"],
  ["#add", true, "add-fail"],
  ["#catalog", true, "catalog"],
  ["hello", false, null],
];

for (const [input, expectCmd, kind] of cases) {
  const norm = normalizeCatalogCommandLine(input);
  const isCmd = isCatalogCommand(input);
  console.log(input, "→", norm, "| isCmd:", isCmd);
  if (isCmd !== expectCmd) throw new Error(`isCatalogCommand mismatch for ${input}`);
  if (kind === "add") {
    const draft = parseAddCommand(norm);
    if (draft.error) throw new Error(`parseAdd failed: ${input} → ${JSON.stringify(draft)}`);
    console.log("  ok:", draft.name, draft.category, draft.sourcePriceKes);
  }
  if (kind === "add-fail") {
    const draft = parseAddCommand(norm);
    if (!draft.error) throw new Error(`expected add parse error for ${input}`);
  }
}

const price = parsePriceCommand("#price pt-001 cost 11500");
console.log("price:", price);
if (price.error) throw new Error("price parse failed: " + JSON.stringify(price));

console.log("All catalog command tests passed.");
