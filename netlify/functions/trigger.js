const { authorizedTrigger, json, options, parseBody, query, rateLimited, triggerSpin } = require("./_shared");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options(event, "GET, POST, OPTIONS");
  const limited = rateLimited(event, "trigger", 30, 60 * 1000);
  if (limited) return limited;

  if (event.httpMethod !== "POST" && event.httpMethod !== "GET") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  const body = event.httpMethod === "POST" ? parseBody(event) : {};
  if (!authorizedTrigger(event, body)) {
    return json(401, { ok: false, error: "Wrong or missing TRIGGER_SECRET" });
  }

  const params = query(event);
  const spin = await triggerSpin({
    source: body.source || params.source || "manual",
    name: body.name || params.name || "Viewer",
    reason: body.reason || params.reason || "Manual spin"
  });

  return json(200, { ok: true, event: spin });
};
