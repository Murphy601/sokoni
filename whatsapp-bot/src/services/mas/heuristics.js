/**
 * Local heuristic agents — no external API; safe for shadow + soft moderation.
 */
const INJECTION =
  /\b(ignore (all |previous )?instructions|system prompt|jailbreak|sudo mode|DAN mode|drop\s+table|union\s+select|;\s*delete\s+from|<\s*script)\b/i;
const OFF_TOPIC =
  /\b(weather|forecast|premier league|bitcoin|crypto|homework|essay|politics|trump|biden|girlfriend|boyfriend|horoscope)\b/i;
const UNSAFE =
  /\b(sell\s+(guns?|cocaine|heroin|fentanyl)|underage\s+sex|child\s*porn|hitman|kill\s+for\s+hire)\b/i;

export function runHeuristic(model, payload = {}) {
  const text = String(payload.text || payload.content || "").slice(0, 8000);
  if (model === "jailbreak-rules" || /jailbreak/i.test(model)) {
    const hit = INJECTION.test(text);
    return {
      ok: true,
      blocked: hit,
      labels: hit ? ["possible_injection"] : [],
      provider: "heuristic",
      model,
    };
  }
  if (model === "topic-rules" || /topic/i.test(model)) {
    const hit = OFF_TOPIC.test(text);
    return {
      ok: true,
      offTopic: hit,
      redirect: hit,
      labels: hit ? ["off_topic"] : ["on_topic"],
      provider: "heuristic",
      model,
    };
  }
  if (model === "safety-rules" || /safety/i.test(model)) {
    const hit = UNSAFE.test(text);
    return {
      ok: true,
      blocked: hit,
      labels: hit ? ["unsafe_content"] : ["safe"],
      provider: "heuristic",
      model,
    };
  }
  return { ok: true, provider: "heuristic", model, labels: ["noop"] };
}
