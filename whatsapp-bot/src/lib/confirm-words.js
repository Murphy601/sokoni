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

/**
 * Only the words that mean "finish the thing I was filling in".
 *
 * Deliberately narrower than isSubmitWord. That set includes yes, ok, sawa
 * and ndio, which people say to the shopping agent all day -- answering those
 * with "there is nothing to submit" would be worse than the bug this exists
 * to fix. Nobody searches a catalogue for "submit".
 */
export function isOrphanSubmitWord(text) {
  return /^\s*(submit|confirm)\s*$/i.test(String(text || ""));
}
