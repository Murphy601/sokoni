/**
 * Body for an unexpected 500. The real message stays in the server log.
 * Clients receive a stable code, never a stack, SQL fragment, or filesystem path.
 */
export function clientError(err, code = "server_error") {
  const message = err?.message || (err ? String(err) : "error");
  console.error(`[http] ${code}:`, message);
  const verbose =
    process.env.NODE_ENV === "development" || process.env.SOKONI_VERBOSE_ERRORS === "1";
  const body = { error: code };
  if (verbose) {
    body.detail = String(message)
      .replace(/\s+at\s+\S+\s+\([^)]+\)/g, "")
      .replace(/\/[\w./-]+\.(js|mjs|cjs|sql|ts)/gi, "[path]")
      .slice(0, 180);
  }
  return body;
}

/** Express 4-arg handler — production clients never see a stack. */
export function publicErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = Number(err?.status || err?.statusCode) || 500;
  res.status(status).json(clientError(err));
}
