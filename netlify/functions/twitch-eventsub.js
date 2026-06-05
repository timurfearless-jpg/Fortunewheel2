const crypto = require("crypto");
const {
  cleanText,
  constantEqual,
  eventSubSecret,
  getRawBody,
  json,
  options,
  rateLimited,
  runtimeConfig,
  safeSecret,
  text,
  triggerSpin
} = require("./_shared");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options(event, "POST, OPTIONS");
  const limited = rateLimited(event, "twitch-eventsub", 120, 60 * 1000);
  if (limited) return limited;

  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  const secret = eventSubSecret();
  if (!safeSecret(secret)) {
    return json(500, { ok: false, error: "TWITCH_EVENTSUB_SECRET is not configured" });
  }

  const rawBody = getRawBody(event);
  if (!validSignature(event.headers || {}, rawBody, secret)) {
    return json(403, { ok: false, error: "Invalid Twitch EventSub signature" });
  }

  let payload = {};
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch (error) {
    return json(400, { ok: false, error: "Invalid JSON" });
  }
  const messageType = header(event.headers, "twitch-eventsub-message-type");

  if (messageType === "webhook_callback_verification") {
    return text(200, payload.challenge || "", event);
  }

  if (messageType === "revocation") {
    return json(200, { ok: true, revoked: payload.subscription || null });
  }

  if (messageType !== "notification") {
    return json(200, { ok: true, ignored: messageType || "unknown message type" });
  }

  const { config } = await runtimeConfig();
  const result = await handleNotification(config, payload);
  return json(200, result);
};

function validSignature(headers, rawBody, secret) {
  const id = header(headers, "twitch-eventsub-message-id");
  const timestamp = header(headers, "twitch-eventsub-message-timestamp");
  const signature = header(headers, "twitch-eventsub-message-signature");
  if (!id || !timestamp || !signature) return false;

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", secret)
      .update(id + timestamp + rawBody)
      .digest("hex");

  return constantEqual(signature, expected);
}

function header(headers, name) {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === wanted) return value;
  }
  return "";
}

async function handleNotification(config, payload) {
  const type = payload.subscription && payload.subscription.type;
  const event = payload.event || {};
  const twitch = config.twitch || {};

  if (type === "channel.channel_points_custom_reward_redemption.add") {
    const command = String(twitch.spinCommand || "!spin").toLowerCase();
    const input = String(event.user_input || "").trim();
    const firstWord = input.split(/\s+/)[0].toLowerCase();
    const rewardId = event.reward && event.reward.id;
    const configuredRewardId = String(twitch.rewardId || "").trim();
    const cost = Number((event.reward && event.reward.cost) || 0);
    const minCost = Number(twitch.minRewardCost || 50000);

    if (configuredRewardId && rewardId !== configuredRewardId) {
      return { ok: true, skipped: "Different channel-points reward", rewardId };
    }
    if (firstWord && firstWord !== command) {
      return { ok: true, skipped: "Reward message is not the spin command", input };
    }
    if (Number.isFinite(cost) && cost > 0 && cost < minCost) {
      return { ok: true, skipped: "Reward cost is below minRewardCost", cost, minCost };
    }

    const spin = await triggerSpin({
      source: "twitch-points",
      name: event.user_name || event.user_login || "Viewer",
      reason: "Channel Points"
    });
    return { ok: true, event: spin };
  }

  if (type === "channel.cheer" && twitch.triggerOnBits !== false) {
    const bits = Number(event.bits || 0);
    const minBits = Number(twitch.minBits || 500);
    if (!Number.isFinite(bits) || bits < minBits) {
      return { ok: true, skipped: "Bits below minBits", bits, minBits };
    }
    const spin = await triggerSpin({
      source: "twitch-bits",
      name: event.user_name || event.user_login || "Cheerer",
      reason: cleanText(`${bits} bits`, "Bits")
    });
    return { ok: true, event: spin };
  }

  if (type === "channel.subscribe" && twitch.triggerOnSubs) {
    if (event.is_gift) {
      return { ok: true, skipped: "Gift sub handled by channel.subscription.gift" };
    }
    const spin = await triggerSpin({
      source: "twitch-sub",
      name: event.user_name || event.user_login || "Subscriber",
      reason: "Sub"
    });
    return { ok: true, event: spin };
  }

  if (type === "channel.subscription.message" && twitch.triggerOnResubs) {
    const months = event.cumulative_months ? ` (${event.cumulative_months}m)` : "";
    const spin = await triggerSpin({
      source: "twitch-resub",
      name: event.user_name || event.user_login || "Subscriber",
      reason: cleanText(`Resub${months}`, "Resub")
    });
    return { ok: true, event: spin };
  }

  if (type === "channel.subscription.gift" && twitch.triggerOnSubGifts) {
    const count = event.total ? ` x${event.total}` : "";
    const spin = await triggerSpin({
      source: "twitch-subgift",
      name: event.user_name || event.user_login || "Gifter",
      reason: cleanText(`Sub gift${count}`, "Sub gift")
    });
    return { ok: true, event: spin };
  }

  return { ok: true, skipped: `Unhandled EventSub type: ${type}` };
}
