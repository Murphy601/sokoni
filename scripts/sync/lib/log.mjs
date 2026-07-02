const c = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
};

/**
 * Tiny colored console logger that also tallies counts for the run summary.
 */
export function createLogger() {
  const counts = { skipped: 0, warnings: 0, errors: 0 };
  return {
    counts,
    info: (...a) => console.log(...a),
    provider: (n, msg) => console.log(`${c.cyan}[${n}]${c.reset} ${msg}`),
    skip: (n, msg) => {
      counts.skipped++;
      console.log(`${c.gray}[${n}] skipped — ${msg}${c.reset}`);
    },
    warn: (n, msg) => {
      counts.warnings++;
      console.log(`${c.yellow}[${n}] warn — ${msg}${c.reset}`);
    },
    error: (n, msg) => {
      counts.errors++;
      console.log(`${c.red}[${n}] error — ${msg}${c.reset}`);
    },
    ok: (msg) => console.log(`${c.green}${msg}${c.reset}`),
  };
}
