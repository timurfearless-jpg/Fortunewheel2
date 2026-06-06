const fs = require("fs");
const http = require("http");
const path = require("path");
const tls = require("tls");
const crypto = require("crypto");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "static");
const CONFIG_PATH = path.join(ROOT, "config.json");
const HISTORY_LIMIT = 30;

let config = loadConfig();
let twitchState = {
  enabled: Boolean(config.twitch && config.twitch.enabled),
  connected: false,
  lastMessage: "Not connected",
  lastRewardId: "",
  reconnectTimer: null,
  socket: null
};

const clients = new Set();
const history = [];

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Could not read config.json: ${error.message}`);
    process.exit(1);
  }
}

function saveConfig(nextConfig) {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  config = nextConfig;
}

function publicConfig() {
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
      requireChannelPointsReward: Boolean(config.twitch && config.twitch.requireChannelPointsReward),
      rewardIdConfigured: Boolean(config.twitch && config.twitch.rewardId),
      triggerOnSubs: Boolean(config.twitch && config.twitch.triggerOnSubs),
      triggerOnResubs: Boolean(config.twitch && config.twitch.triggerOnResubs),
      triggerOnSubGifts: Boolean(config.twitch && config.twitch.triggerOnSubGifts)
    },
    donations: {
      enabled: Boolean(config.donations && config.donations.enabled),
      minAmountEur: config.donations && config.donations.minAmountEur,
      acceptedCurrencies: config.donations && config.donations.acceptedCurrencies
    },
    challenges: normalizedChallenges()
  };
}

function normalizedChallenges() {
  const list = Array.isArray(config.challenges) ? config.challenges : [];
  return list
    .filter((item) => item && typeof item.label === "string" && item.label.trim())
    .map((item) => ({
      label: oneWordLabel(item.label || item.title || "Challenge"),
      title: cleanText(item.title || item.label || "Challenge", "Challenge"),
      description: typeof item.description === "string" ? item.description.trim() : "",
      duration: typeof item.duration === "string" ? item.duration.trim() : "",
      weight: Number.isFinite(Number(item.weight)) && Number(item.weight) > 0 ? Number(item.weight) : 1
    }));
}

function oneWordLabel(value) {
  const raw = cleanText(String(value || ""), "Challenge");
  const first = raw.split(/\s+/)[0] || "Challenge";
  const safe = first.replace(/[^a-z0-9-]/gi, "");
  return (safe || "Challenge").slice(0, 12);
}

function pickChallenge() {
  const challenges = normalizedChallenges();
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

function triggerSpin(input) {
  const picked = pickChallenge();
  const event = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    source: input.source || "manual",
    name: cleanText(input.name, "Viewer"),
    reason: cleanText(input.reason, "Spin"),
    amount: input.amount || null,
    currency: input.currency || null,
    challenge: picked.challenge,
    chatMessage: buildChatMessage(picked.challenge),
    wheel: {
      index: picked.index,
      total: picked.total,
      spinSeed: crypto.randomInt(100000, 999999)
    }
  };

  history.unshift(event);
  history.splice(HISTORY_LIMIT);
  broadcast("spin", event);
  if (!config.chat || config.chat.enabled !== false) {
    dispatchChatWebhook(event);
  }
  console.log(`[spin] ${event.source}: ${event.name} -> ${event.challenge.label}`);
  return event;
}

function buildChatMessage(challenge) {
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
  if (!process.env.CHAT_WEBHOOK_URL || typeof fetch !== "function") return;
  const headers = { "Content-Type": "application/json" };
  if (process.env.CHAT_WEBHOOK_SECRET) {
    headers.Authorization = `Bearer ${process.env.CHAT_WEBHOOK_SECRET}`;
  }
  try {
    await fetch(process.env.CHAT_WEBHOOK_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: event.chatMessage, event })
    });
  } catch (error) {
    // Keep the wheel responsive even if the external chat bot webhook is offline.
  }
}

function cleanText(value, fallback) {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 80) : fallback;
}

function broadcast(type, payload) {
  const text = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    client.write(text);
  }
}

function isLocalRequest(req) {
  const remote = req.socket.remoteAddress || "";
  return remote === "::1" || remote === "127.0.0.1" || remote === "::ffff:127.0.0.1";
}

function isAuthorized(req, url, body) {
  if (isLocalRequest(req)) return true;
  const configured = config.security && config.security.triggerSecret;
  if (!configured || configured === "change-me") return false;
  const provided = url.searchParams.get("secret") || (body && body.secret);
  return provided === configured;
}

function donationAuthorized(req, url, body) {
  if (isLocalRequest(req)) return true;
  const configured = config.donations && config.donations.webhookSecret;
  if (!configured || configured === "change-me") return false;
  const provided = url.searchParams.get("secret") || (body && body.secret);
  return provided === configured;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        const params = new URLSearchParams(raw);
        const body = {};
        for (const [key, value] of params.entries()) {
          body[key] = value;
        }
        resolve(body);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  const text = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(text)
  });
  res.end(text);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(text)
  });
  res.end(text);
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/control.html";
  const fullPath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(fullPath, (error, file) => {
    if (error) {
      sendText(res, 404, "Not found");
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml; charset=utf-8"
    }[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    });
    res.end(file);
  });
}

function parseDonation(body) {
  const source = body.source || body.provider || body.service || "donation";
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

  return { source, amount: finalAmount, currency, name };
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, at: new Date().toISOString() })}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, publicConfig());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    sendJson(res, 200, {
      twitch: {
        enabled: Boolean(config.twitch && config.twitch.enabled),
        connected: twitchState.connected,
        lastMessage: twitchState.lastMessage,
        lastRewardId: twitchState.lastRewardId
      },
      history,
      clients: clients.size,
      configPath: CONFIG_PATH
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/local-info") {
    if (!isLocalRequest(req)) {
      sendJson(res, 403, { ok: false, error: "Local access only" });
      return;
    }
    const port = config.server && config.server.port ? config.server.port : 8732;
    const triggerSecret = config.security && config.security.triggerSecret;
    const donationSecret = config.donations && config.donations.webhookSecret;
    sendJson(res, 200, {
      overlayUrl: `http://localhost:${port}/overlay.html?layout=hud`,
      controlUrl: `http://localhost:${port}/control.html`,
      triggerUrl: `http://localhost:${port}/trigger?secret=${encodeURIComponent(triggerSecret || "")}&name=Viewer&reason=Manual`,
      donationWebhookUrl: `http://localhost:${port}/webhook/donation?secret=${encodeURIComponent(donationSecret || "")}`,
      configPath: CONFIG_PATH
    });
    return;
  }

  if ((req.method === "POST" || req.method === "GET") && (url.pathname === "/api/spin" || url.pathname === "/trigger")) {
    const body = req.method === "POST" ? await readBody(req) : {};
    if (!isAuthorized(req, url, body)) {
      sendJson(res, 401, { ok: false, error: "Wrong or missing secret" });
      return;
    }
    const event = triggerSpin({
      source: body.source || url.searchParams.get("source") || "manual",
      name: body.name || url.searchParams.get("name") || "Viewer",
      reason: body.reason || url.searchParams.get("reason") || "Manual spin"
    });
    sendJson(res, 200, { ok: true, event });
    return;
  }

  if (req.method === "POST" && url.pathname === "/webhook/donation") {
    const body = await readBody(req);
    if (!donationAuthorized(req, url, body)) {
      sendJson(res, 401, { ok: false, error: "Wrong or missing donation secret" });
      return;
    }
    if (!config.donations || !config.donations.enabled) {
      sendJson(res, 200, { ok: false, skipped: "Donations are disabled" });
      return;
    }

    const donation = parseDonation(body);
    const accepted = (config.donations.acceptedCurrencies || ["EUR"]).map((item) => String(item).toUpperCase());
    const threshold = Number(config.donations.minAmountEur || 5);

    if (!Number.isFinite(donation.amount)) {
      sendJson(res, 400, { ok: false, error: "Could not read donation amount" });
      return;
    }

    if (!accepted.includes(donation.currency) || donation.amount < threshold) {
      sendJson(res, 200, {
        ok: true,
        skipped: "Donation below threshold or unsupported currency",
        donation
      });
      return;
    }

    const event = triggerSpin({
      source: donation.source,
      name: donation.name,
      reason: `Donation ${donation.amount} ${donation.currency}`,
      amount: donation.amount,
      currency: donation.currency
    });
    sendJson(res, 200, { ok: true, event });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reload") {
    if (!isLocalRequest(req)) {
      sendJson(res, 403, { ok: false, error: "Local access only" });
      return;
    }
    config = loadConfig();
    restartTwitch();
    broadcast("config", publicConfig());
    sendJson(res, 200, { ok: true, config: publicConfig() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/config") {
    if (!isLocalRequest(req)) {
      sendJson(res, 403, { ok: false, error: "Local access only" });
      return;
    }
    const body = await readBody(req);
    const nextConfig = structuredClone(config);
    if (body.brand) {
      nextConfig.brand = { ...nextConfig.brand, ...body.brand };
    }
    if (Array.isArray(body.challenges)) {
      nextConfig.challenges = body.challenges
        .filter((item) => item && String(item.label || "").trim())
        .map((item) => ({
          label: String(item.label || "").trim().slice(0, 80),
          title: String(item.title || item.label || "").trim().slice(0, 100),
          description: String(item.description || "").trim().slice(0, 240),
          duration: String(item.duration || "").trim().slice(0, 32),
          weight: Number.isFinite(Number(item.weight)) && Number(item.weight) > 0 ? Number(item.weight) : 1
        }));
    }
    saveConfig(nextConfig);
    broadcast("config", publicConfig());
    sendJson(res, 200, { ok: true, config: publicConfig() });
    return;
  }

  serveStatic(req, res, url);
}

function parseTags(rawTags) {
  const tags = {};
  if (!rawTags) return tags;
  for (const part of rawTags.split(";")) {
    const [key, rawValue = ""] = part.split("=");
    tags[key] = rawValue
      .replace(/\\s/g, " ")
      .replace(/\\:/g, ";")
      .replace(/\\\\/g, "\\")
      .replace(/\\r/g, "\r")
      .replace(/\\n/g, "\n");
  }
  return tags;
}

function parseIrcLine(line) {
  let rest = line;
  let tags = {};
  let prefix = "";
  let trailing = "";

  if (rest.startsWith("@")) {
    const index = rest.indexOf(" ");
    tags = parseTags(rest.slice(1, index));
    rest = rest.slice(index + 1);
  }

  if (rest.startsWith(":")) {
    const index = rest.indexOf(" ");
    prefix = rest.slice(1, index);
    rest = rest.slice(index + 1);
  }

  const trailingIndex = rest.indexOf(" :");
  if (trailingIndex >= 0) {
    trailing = rest.slice(trailingIndex + 2);
    rest = rest.slice(0, trailingIndex);
  }

  const parts = rest.split(" ").filter(Boolean);
  return {
    tags,
    prefix,
    command: parts[0],
    params: parts.slice(1),
    trailing
  };
}

function connectTwitch() {
  const twitch = config.twitch || {};
  if (!twitch.enabled) {
    twitchState.enabled = false;
    twitchState.connected = false;
    twitchState.lastMessage = "Twitch disabled in config.json";
    return;
  }

  const channel = String(twitch.channel || "").replace(/^#/, "").trim().toLowerCase();
  const username = String(twitch.botUsername || "").trim().toLowerCase();
  const token = String(twitch.oauthToken || "").trim();

  if (!channel || !username || !token || token.includes("your_")) {
    twitchState.enabled = true;
    twitchState.connected = false;
    twitchState.lastMessage = "Fill twitch.channel, botUsername and oauthToken in config.json";
    return;
  }

  twitchState.enabled = true;
  twitchState.lastMessage = "Connecting to Twitch chat...";
  const socket = tls.connect(6697, "irc.chat.twitch.tv", () => {
    socket.write(`PASS ${token}\r\n`);
    socket.write(`NICK ${username}\r\n`);
    socket.write("CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership\r\n");
    socket.write(`JOIN #${channel}\r\n`);
  });

  twitchState.socket = socket;
  socket.setEncoding("utf8");
  let buffer = "";

  socket.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("PING ")) {
        socket.write(`PONG ${line.slice(5)}\r\n`);
        continue;
      }
      handleTwitchLine(line);
    }
  });

  socket.on("connect", () => {
    twitchState.connected = true;
    twitchState.lastMessage = `Connected to #${channel}`;
    console.log(`[twitch] connected to #${channel}`);
  });

  socket.on("error", (error) => {
    twitchState.connected = false;
    twitchState.lastMessage = `Twitch error: ${error.message}`;
    console.error(`[twitch] ${error.message}`);
  });

  socket.on("close", () => {
    twitchState.connected = false;
    twitchState.socket = null;
    if (config.twitch && config.twitch.enabled) {
      twitchState.lastMessage = "Twitch disconnected. Reconnecting in 10 seconds...";
      twitchState.reconnectTimer = setTimeout(connectTwitch, 10000);
    }
  });
}

function restartTwitch() {
  if (twitchState.reconnectTimer) {
    clearTimeout(twitchState.reconnectTimer);
    twitchState.reconnectTimer = null;
  }
  if (twitchState.socket) {
    twitchState.socket.destroy();
    twitchState.socket = null;
  }
  connectTwitch();
}

function handleTwitchLine(line) {
  const message = parseIrcLine(line);
  if (message.command === "001" || message.command === "JOIN") {
    twitchState.connected = true;
    return;
  }

  if (message.command === "NOTICE") {
    twitchState.lastMessage = message.trailing || "Twitch notice";
    return;
  }

  if (message.command === "PRIVMSG") {
    const twitch = config.twitch || {};
    const text = message.trailing.trim();
    const command = String(twitch.spinCommand || "!spin").toLowerCase();
    const firstWord = text.split(/\s+/)[0].toLowerCase();
    if (firstWord !== command) return;

    const rewardId = message.tags["custom-reward-id"] || "";
    if (rewardId) {
      twitchState.lastRewardId = rewardId;
    }

    const requiresReward = twitch.requireChannelPointsReward !== false;
    const configuredReward = String(twitch.rewardId || "").trim();
    if (requiresReward && !rewardId) {
      twitchState.lastMessage = `Ignored plain ${command}: no channel-points reward tag`;
      return;
    }
    if (configuredReward && rewardId !== configuredReward) {
      twitchState.lastMessage = `Ignored ${command}: reward id ${rewardId || "none"} does not match config`;
      return;
    }

    triggerSpin({
      source: "twitch-points",
      name: message.tags["display-name"] || message.prefix.split("!")[0] || "Viewer",
      reason: rewardId ? "Channel Points" : "Chat command"
    });
    return;
  }

  if (message.command === "USERNOTICE") {
    const twitch = config.twitch || {};
    const msgId = message.tags["msg-id"] || "";
    const subIds = new Set(["sub"]);
    const resubIds = new Set(["resub"]);
    const giftIds = new Set(["subgift", "anonsubgift", "submysterygift", "giftpaidupgrade", "anongiftpaidupgrade"]);

    const shouldTrigger =
      (twitch.triggerOnSubs && subIds.has(msgId)) ||
      (twitch.triggerOnResubs && resubIds.has(msgId)) ||
      (twitch.triggerOnSubGifts && giftIds.has(msgId));

    if (!shouldTrigger) return;

    triggerSpin({
      source: "twitch-sub",
      name: message.tags["display-name"] || "Subscriber",
      reason: msgId === "resub" ? "Resub" : giftIds.has(msgId) ? "Sub gift" : "Sub"
    });
  }
}

const keepAlive = setInterval(() => {
  for (const client of clients) {
    client.write(`: keep-alive ${Date.now()}\n\n`);
  }
}, 15000);
keepAlive.unref();

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error(error);
    sendJson(res, 500, { ok: false, error: error.message });
  });
});

const port = Number(config.server && config.server.port) || 8732;
server.listen(port, () => {
  console.log(`Fortune Wheel control: http://localhost:${port}/control.html`);
  console.log(`OBS Browser Source:     http://localhost:${port}/overlay.html`);
  connectTwitch();
});
