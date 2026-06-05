const {
  authorizedStreamEvent,
  json,
  options,
  parseBody,
  parseStreamEvent,
  rateLimited,
  runtimeConfig,
  shouldTriggerStreamEvent,
  triggerSpin
} = require("./_shared");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options(event, "POST, OPTIONS");
  const limited = rateLimited(event, "stream-event", 80, 60 * 1000);
  if (limited) return limited;

  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  const body = parseBody(event);
  if (!authorizedStreamEvent(event, body)) {
    return json(401, { ok: false, error: "Wrong or missing STREAM_EVENT_SECRET" });
  }

  const { config } = await runtimeConfig();
  const parsed = parseStreamEvent(body);
  const decision = shouldTriggerStreamEvent(config, parsed);
  if (!decision.ok) {
    return json(200, { ok: true, skipped: decision.skipped, event: parsed, decision });
  }

  const spin = await triggerSpin({
    source: parsed.source,
    name: parsed.name,
    reason: decision.reason || parsed.reason,
    amount: Number.isFinite(parsed.amount) ? parsed.amount : null,
    currency: parsed.currency || null
  });

  return json(200, { ok: true, event: spin, sourceEvent: parsed });
};
