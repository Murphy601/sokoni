#!/usr/bin/env node
/** Wrapper — runs whatsapp-bot/scripts/clear-all-catalog.mjs (needs pg from whatsapp-bot). */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const script = path.join(ROOT, "whatsapp-bot", "scripts", "clear-all-catalog.mjs");

const child = spawn(process.execPath, [script, ...process.argv.slice(2)], {
  cwd: path.join(ROOT, "whatsapp-bot"),
  stdio: "inherit",
});

child.on("exit", (code) => process.exit(code ?? 1));
