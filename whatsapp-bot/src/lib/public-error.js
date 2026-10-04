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
  if (verbose) body.detail = message;
  return body;
}
