const { json, options, publicConfig, query, rateLimited, runtimeConfig } = require("./_shared");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options(event, "GET, OPTIONS");
  const limited = rateLimited(event, "state", 180, 60 * 1000);
  if (limited) return limited;

  if (event.httpMethod !== "GET") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  const params = query(event);
  const after = Date.parse(params.after || "");
  const afterMs = Number.isFinite(after) ? after : 0;
  const { config, state } = await runtimeConfig();
  const history = Array.isArray(state.history) ? state.history : [];
  const events = history
    .filter((item) => Date.parse(item.at) > afterMs)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return json(200, {
    ok: true,
    mode: "netlify",
    now: new Date().toISOString(),
    config: publicConfig(config),
    events,
    history
  });
};
