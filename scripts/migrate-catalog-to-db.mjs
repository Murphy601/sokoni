#!/usr/bin/env node
/** @deprecated Use: cd whatsapp-bot && npm run db:seed */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const botScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "whatsapp-bot", "scripts", "migrate-catalog-to-db.mjs");
const child = spawn(process.execPath, [botScript, ...process.argv.slice(2)], {
  cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "whatsapp-bot"),
  stdio: "inherit",
});
child.on("close", (code) => process.exit(code ?? 1));
