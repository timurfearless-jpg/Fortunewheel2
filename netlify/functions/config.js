const {
  authorizedAdmin,
  json,
  options,
  parseBody,
  publicConfig,
  rateLimited,
  runtimeConfig,
  sanitizeChallenges,
  writeState
} = require("./_shared");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options(event, "GET, POST, OPTIONS");
  const limited = rateLimited(event, "config", event.httpMethod === "POST" ? 12 : 120, 60 * 1000);
  if (limited) return limited;

  if (event.httpMethod === "GET") {
    const { config } = await runtimeConfig();
    return json(200, { ok: true, config: publicConfig(config) });
  }

  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  const body = parseBody(event);
  if (!authorizedAdmin(event, body)) {
    return json(401, { ok: false, error: "Wrong or missing ADMIN_SECRET" });
  }

  const { config, state } = await runtimeConfig();
  state.overrides = state.overrides || {};

  if (body.brand && typeof body.brand === "object") {
    state.overrides.brand = {
      ...(state.overrides.brand || {}),
      ...body.brand
    };
  }

  if (Array.isArray(body.challenges)) {
    state.overrides.challenges = sanitizeChallenges(body.challenges);
  }

  await writeState(state);
  const next = await runtimeConfig();
  return json(200, { ok: true, config: publicConfig(next.config) });
};
