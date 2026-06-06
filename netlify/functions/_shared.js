const crypto = require("crypto");
const baseConfig = require("../../config.json");

const HISTORY_LIMIT = 40;
const STORE_NAME = "fortune-wheel";
const STATE_KEY = "state";
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload"
};
const CORS_REQUEST_HEADERS =
  "Content-Type, Twitch-Eventsub-Message-Id, Twitch-Eventsub-Message-Timestamp, Twitch-Eventsub-Message-Signature, Twitch-Eventsub-Message-Type, X-Stream-Event-Signature";

function response(statusCode, body, headers = {}, event = null) {
  return {
    statusCode,
    headers: {
      ...SECURITY_HEADERS,
      ...corsHeaders(event),
      "Cache-Control": "no-store",
      ...headers
    },
    body
  };
}

function json(statusCode, body) {
  return response(statusCode, JSON.stringify(body), {
    "Content-Type": "application/json; charset=utf-8"
  });
}

function text(statusCode, body, event = null) {
  return response(statusCode, body, {
    "Content-Type": "text/plain; charset=utf-8"
  }, event);
}

function options(event, methods = "GET, POST, OPTIONS") {
  return response(204, "", {
    "Access-Control-Allow-Headers": CORS_REQUEST_HEADERS,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Max-Age": "600"
  }, event);
}

function jsonForEvent(event, statusCode, body) {
  return response(statusCode, JSON.stringify(body), {
    "Content-Type": "application/json; charset=utf-8"
  }, event);
}

function corsHeaders(event) {
  if (!event || !event.headers) return {};
  const origin = header(event.headers, "origin");
  if (!origin) return {};

  try {
    const originUrl = new URL(origin);
    const host = header(event.headers, "host");
    if (host && originUrl.host === host) {
      return {
        "Access-Control-Allow-Origin": origin,
        "Vary": "Origin"
      };
    }
  } catch (error) {
    return {};
  }
  return {};
}

function header(headers, name) {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === wanted) return Array.isArray(value) ? value[0] : value;
  }
  return "";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanText(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 120) : fallback;
}

function getRawBody(event) {
  if (!event.body) return "";
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, "base64").toString("utf8");
  }
  return event.body;
}

function parseBody(event) {
  const raw = getRawBody(event);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    const params = new URLSearchParams(raw);
    const body = {};
    for (const [key, value] of params.entries()) {
      body[key] = value;
    }
    return body;
  }
}

function clientIp(event) {
  const forwarded = header(event.headers || {}, "x-forwarded-for");
  return (
    header(event.headers || {}, "x-nf-client-connection-ip") ||
    (forwarded ? forwarded.split(",")[0].trim() : "") ||
    header(event.headers || {}, "client-ip") ||
    "unknown"
  );
}

function rateLimit(event, bucket, limit, windowMs) {
  const now = Date.now();
  const ip = clientIp(event);
  const key = `${bucket}:${ip}`;
  const buckets = globalThis.__fortuneWheelRateLimits || new Map();
  globalThis.__fortuneWheelRateLimits = buckets;
  if (buckets.size > 5000) {
    for (const [bucketKey, value] of buckets.entries()) {
      if (value.resetAt <= now) buckets.delete(bucketKey);
    }
  }

  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }

  current.count += 1;
  if (current.count > limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
    };
  }

  return { ok: true, remaining: limit - current.count, retryAfter: 0 };
}

function rateLimited(event, bucket, limit, windowMs) {
  const result = rateLimit(event, bucket, limit, windowMs);
  if (result.ok) return null;
  return response(429, JSON.stringify({ ok: false, error: "Too many requests" }), {
    "Content-Type": "application/json; charset=utf-8",
    "Retry-After": String(result.retryAfter)
  }, event);
}

function query(event) {
  return event.queryStringParameters || {};
}

function secretValue(name, fallback) {
  if (globalThis.Netlify && globalThis.Netlify.env && typeof globalThis.Netlify.env.get === "function") {
    return globalThis.Netlify.env.get(name) || fallback || "";
  }
  return process.env[name] || fallback || "";
}

function safeSecret(value) {
  return Boolean(value && value !== "change-me" && value !== "your_twitch_chat_token");
}

function constantEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function providedSecret(event, body, key = "secret") {
  const params = query(event);
  return params[key] || body[key] || "";
}

function authorizedTrigger(event, body) {
  const configured = secretValue("TRIGGER_SECRET", baseConfig.security && baseConfig.security.triggerSecret);
  return safeSecret(configured) && constantEqual(providedSecret(event, body), configured);
}

function authorizedDonation(event, body) {
  const configured = secretValue(
    "DONATION_SECRET",
    (baseConfig.donations && baseConfig.donations.webhookSecret) || (baseConfig.security && baseConfig.security.triggerSecret)
  );
  return safeSecret(configured) && constantEqual(providedSecret(event, body), configured);
}

function authorizedAdmin(event, body) {
  const configured = secretValue("ADMIN_SECRET", secretValue("TRIGGER_SECRET", baseConfig.security && baseConfig.security.triggerSecret));
  const params = query(event);
  const candidate = params.admin || body.admin || body.secret || "";
  return safeSecret(configured) && constantEqual(candidate, configured);
}

function authorizedStreamEvent(event, body) {
  const configured = secretValue("STREAM_EVENT_SECRET", baseConfig.streamEvents && baseConfig.streamEvents.secret);
  const params = query(event);
  const candidate = params.secret || body.secret || body.token || "";
  if (safeSecret(configured) && candidate && constantEqual(candidate, configured)) return true;

  const signature = header(event.headers || {}, "x-stream-event-signature");
  if (!safeSecret(configured) || !signature) return false;
  const rawBody = getRawBody(event);
  const expected = "sha256=" + crypto.createHmac("sha256", configured).update(rawBody).digest("hex");
  return constantEqual(signature, expected);
}

function eventSubSecret() {
  return secretValue("TWITCH_EVENTSUB_SECRET", secretValue("TRIGGER_SECRET", baseConfig.security && baseConfig.security.triggerSecret));
}

async function blobStore() {
  try {
    const { getStore } = await import("@netlify/blobs");
    return getStore(STORE_NAME);
  } catch (error) {
    return null;
  }
}

function memoryState() {
  if (!globalThis.__fortuneWheelState) {
    globalThis.__fortuneWheelState = { history: [], overrides: {} };
  }
  return globalThis.__fortuneWheelState;
}

async function readState() {
  const fallback = memoryState();
  const store = await blobStore();
  if (!store) return fallback;

  try {
    const state = (await store.get(STATE_KEY, { type: "json" })) || {};
    return {
      history: Array.isArray(state.history) ? state.history : [],
      overrides: state.overrides && typeof state.overrides === "object" ? state.overrides : {}
    };
  } catch (error) {
    return fallback;
  }
}

async function writeState(state) {
  const normalized = {
    history: Array.isArray(state.history) ? state.history.slice(0, HISTORY_LIMIT) : [],
    overrides: state.overrides && typeof state.overrides === "object" ? state.overrides : {}
  };

  globalThis.__fortuneWheelState = normalized;
  const store = await blobStore();
  if (store) {
    await store.setJSON(STATE_KEY, normalized);
  }
  return normalized;
}

function sanitizeChallenges(challenges) {
  return (Array.isArray(challenges) ? challenges : [])
    .filter((item) => item && String(item.label || "").trim())
    .map((item) => ({
      label: oneWordLabel(item.label || item.title || "Challenge"),
      title: cleanText(String(item.title || item.label || "Challenge"), "Challenge").slice(0, 100),
      description: cleanText(String(item.description || ""), "").slice(0, 260),
      duration: cleanText(String(item.duration || ""), "").slice(0, 32),
      weight: Number.isFinite(Number(item.weight)) && Number(item.weight) > 0 ? Number(item.weight) : 1
    }));
}

function oneWordLabel(value) {
  const raw = cleanText(String(value || ""), "Challenge");
  const first = raw.split(/\s+/)[0] || "Challenge";
  const safe = first.replace(/[^a-z0-9-]/gi, "");
  return (safe || "Challenge").slice(0, 12);
}

async function runtimeConfig() {
  const state = await readState();
  const config = clone(baseConfig);
  if (state.overrides && state.overrides.brand) {
    config.brand = { ...config.brand, ...state.overrides.brand };
  }
  if (state.overrides && Array.isArray(state.overrides.challenges)) {
    config.challenges = sanitizeChallenges(state.overrides.challenges);
  }
  return { config, state };
}

function publicConfig(config) {
  return {
    brand: config.brand,
    wheel: config.wheel,
    chat: {
      enabled: Boolean(config.chat && config.chat.enabled),
      webhookConfigured: Boolean(process.env.CHAT_WEBHOOK_URL)
    },
    twitch: {
      enabled: Boolean(config.twitch && config.twitch.enabled),
      channel: config.twitch && config.twitch.channel,
      spinCommand: config.twitch && config.twitch.spinCommand,
      minRewardCost: (config.twitch && config.twitch.minRewardCost) || 50000,
      requireChannelPointsReward: Boolean(config.twitch && config.twitch.requireChannelPointsReward),
      rewardIdConfigured: Boolean(config.twitch && config.twitch.rewardId),
      triggerOnSubs: Boolean(config.twitch && config.twitch.triggerOnSubs),
      triggerOnResubs: Boolean(config.twitch && config.twitch.triggerOnResubs),
      triggerOnSubGifts: Boolean(config.twitch && config.twitch.triggerOnSubGifts),
      eventSubCallback: "/.netlify/functions/twitch-eventsub"
    },
    donations: {
      enabled: Boolean(config.donations && config.donations.enabled),
      minAmountEur: config.donations && config.donations.minAmountEur,
      acceptedCurrencies: config.donations && config.donations.acceptedCurrencies
    },
    challenges: normalizedChallenges(config)
  };
}

function normalizedChallenges(config) {
  return sanitizeChallenges(config.challenges);
}

function pickChallenge(config) {
  const challenges = normalizedChallenges(config);
  if (!challenges.length) {
    return {
      index: 0,
      challenge: {
        label: "Free",
        title: "Free pick",
        description: "Choose one light and safe IRL challenge on the spot.",
        duration: "1 min",
        weight: 1
      },
      total: 1
    };
  }

  const totalWeight = challenges.reduce((sum, challenge) => sum + challenge.weight, 0);
  let roll = Math.random() * totalWeight;
  for (let index = 0; index < challenges.length; index += 1) {
    roll -= challenges[index].weight;
    if (roll <= 0) {
      return { index, challenge: challenges[index], total: challenges.length };
    }
  }
  const index = challenges.length - 1;
  return { index, challenge: challenges[index], total: challenges.length };
}

async function triggerSpin(input) {
  const { config, state } = await runtimeConfig();
  const picked = pickChallenge(config);
  const event = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    source: cleanText(input.source || "manual", "manual"),
    name: cleanText(input.name || "Viewer", "Viewer"),
    reason: cleanText(input.reason || "Spin", "Spin"),
    amount: input.amount || null,
    currency: input.currency || null,
    challenge: picked.challenge,
    chatMessage: buildChatMessage(config, picked.challenge),
    wheel: {
      index: picked.index,
      total: picked.total,
      spinSeed: crypto.randomInt(100000, 999999)
    }
  };

  state.history = [event, ...(Array.isArray(state.history) ? state.history : [])].slice(0, HISTORY_LIMIT);
  await writeState(state);
  if (!config.chat || config.chat.enabled !== false) {
    await dispatchChatWebhook(event);
  }
  return event;
}

function buildChatMessage(config, challenge) {
  const template =
    (config.chat && config.chat.template) ||
    "Wheel result: {title} - {description} Time: {duration}";
  return template
    .replaceAll("{label}", challenge.label || "Challenge")
    .replaceAll("{title}", challenge.title || challenge.label || "Challenge")
    .replaceAll("{description}", challenge.description || "")
    .replaceAll("{duration}", challenge.duration || "IRL")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 450);
}

async function dispatchChatWebhook(event) {
  const url = process.env.CHAT_WEBHOOK_URL;
  if (!url || typeof fetch !== "function") return;

  const headers = { "Content-Type": "application/json" };
  if (process.env.CHAT_WEBHOOK_SECRET) {
    headers.Authorization = `Bearer ${process.env.CHAT_WEBHOOK_SECRET}`;
  }

  try {
    await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        text: event.chatMessage,
        event
      })
    });
  } catch (error) {
    // The wheel should still spin even if the external chat bot is offline.
  }
}

function parseDonation(body) {
  const candidateAmount =
    body.amount ??
    body.value ??
    body.donationAmount ??
    body.data?.amount ??
    body.event?.amount ??
    body.message?.amount;

  const amount = Number(candidateAmount);
  const cents = Number(body.amount_in_cents ?? body.amountInCents ?? body.data?.amount_in_cents);
  const finalAmount = Number.isFinite(amount) ? amount : Number.isFinite(cents) ? cents / 100 : NaN;
  const currency = cleanText(
    String(body.currency ?? body.currencyCode ?? body.data?.currency ?? body.event?.currency ?? body.message?.currency ?? "EUR"),
    "EUR"
  ).toUpperCase();
  const name = cleanText(
    String(
      body.name ??
        body.username ??
        body.displayName ??
        body.from ??
        body.donator?.name ??
        body.data?.username ??
        body.event?.username ??
        body.message?.from ??
        "Donator"
    ),
    "Donator"
  );
  const source = cleanText(String(body.source || body.provider || body.service || "donation"), "donation");
  return { source, amount: finalAmount, currency, name };
}

function parseStreamEvent(body) {
  const event = body.event || body.data || body.message || body;
  const platform = cleanText(String(body.platform || body.provider || body.source || event.platform || event.provider || "stream"), "stream").toLowerCase();
  const type = cleanText(String(body.type || body.eventType || body.kind || event.type || event.eventType || event.kind || "support"), "support").toLowerCase();
  const source = cleanText(`${platform}-${type}`.replace(/[^a-z0-9-]+/gi, "-"), "stream-event");
  const name = cleanText(
    String(
      body.name ??
        body.username ??
        body.displayName ??
        body.from ??
        event.name ??
        event.username ??
        event.displayName ??
        event.from ??
        event.user?.name ??
        event.user?.displayName ??
        "Supporter"
    ),
    "Supporter"
  );

  const amountCandidate =
    body.amount ??
    body.value ??
    body.total ??
    body.bits ??
    event.amount ??
    event.value ??
    event.total ??
    event.bits ??
    event.amount_in_cents;
  const cents = Number(body.amount_in_cents ?? body.amountInCents ?? event.amount_in_cents ?? event.amountInCents);
  const rawAmount = Number(amountCandidate);
  const amount = Number.isFinite(rawAmount) ? rawAmount : Number.isFinite(cents) ? cents / 100 : NaN;
  const currency = cleanText(String(body.currency ?? body.currencyCode ?? event.currency ?? event.currencyCode ?? "EUR"), "EUR").toUpperCase();
  const bits = Number(body.bits ?? body.cheerBits ?? event.bits ?? event.cheerBits ?? amount);
  const paid =
    Boolean(body.paid ?? event.paid) ||
    /sub|member|membership|sponsor/.test(type) ||
    /sub|member|membership|sponsor/.test(String(body.tier || event.tier || ""));

  return {
    source,
    platform,
    type,
    name,
    amount,
    currency,
    bits,
    paid,
    reason: cleanText(String(body.reason || event.reason || titleCase(type)), titleCase(type))
  };
}

function shouldTriggerStreamEvent(config, parsed) {
  const streamEvents = config.streamEvents || {};
  if (streamEvents.enabled === false) return { ok: false, skipped: "Stream events are disabled" };

  const accepted = (streamEvents.acceptedCurrencies || config.donations?.acceptedCurrencies || ["EUR"]).map((item) =>
    String(item).toUpperCase()
  );
  const minAmount = Number(streamEvents.minAmountEur || config.donations?.minAmountEur || 5);
  const minBits = Number(streamEvents.minBits || config.twitch?.minBits || 500);
  const amountTypes = /donation|donate|tip|superchat|super-sticker|supersticker|sticker|gift|kick|support/;
  const bitTypes = /bit|bits|cheer/;
  const paidTypes = /sub|resub|subscription|member|membership|sponsor/;

  if (bitTypes.test(parsed.type) || bitTypes.test(parsed.platform)) {
    if (Number.isFinite(parsed.bits) && parsed.bits >= minBits) return { ok: true, reason: `${parsed.bits} bits` };
    return { ok: false, skipped: "Bits below threshold", bits: parsed.bits, minBits };
  }

  if (paidTypes.test(parsed.type) || parsed.paid) {
    if (streamEvents.triggerOnPaidSubs !== false || streamEvents.triggerOnMembers !== false) {
      return { ok: true, reason: parsed.reason || "Paid sub/member" };
    }
    return { ok: false, skipped: "Paid sub/member triggers are disabled" };
  }

  if (amountTypes.test(parsed.type) || Number.isFinite(parsed.amount)) {
    if (!accepted.includes(parsed.currency)) {
      return { ok: false, skipped: "Unsupported currency", currency: parsed.currency };
    }
    if (Number.isFinite(parsed.amount) && parsed.amount >= minAmount) {
      return { ok: true, reason: `${parsed.amount} ${parsed.currency}` };
    }
    return { ok: false, skipped: "Amount below threshold", amount: parsed.amount, minAmount };
  }

  return { ok: false, skipped: "Unsupported stream event type", type: parsed.type };
}

function titleCase(value) {
  return String(value || "Support")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

module.exports = {
  baseConfig,
  cleanText,
  constantEqual,
  eventSubSecret,
  getRawBody,
  json,
  jsonForEvent,
  normalizedChallenges,
  options,
  parseBody,
  parseDonation,
  parseStreamEvent,
  pickChallenge,
  publicConfig,
  query,
  response,
  rateLimited,
  runtimeConfig,
  sanitizeChallenges,
  safeSecret,
  text,
  triggerSpin,
  buildChatMessage,
  authorizedAdmin,
  authorizedDonation,
  authorizedStreamEvent,
  authorizedTrigger,
  shouldTriggerStreamEvent,
  writeState
};
