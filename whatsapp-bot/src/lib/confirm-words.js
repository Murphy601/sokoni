/**
 * Words people actually send to confirm a chat flow.
 *
 * The seller signup prompts for "confirm" and the rider application for
 * "submit". Matching only the exact prompted word meant the other one fell
 * through to "here is your summary again", which reads as nothing happening.
 * Both flows accept the whole set.
 */
export function isSubmitWord(text) {
  return /^\s*(submit|confirm|send|yes|ndio|sawa|ok(ay)?)\s*$/i.test(String(text || ""));
}
