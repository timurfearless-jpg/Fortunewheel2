const els = {
  status: document.getElementById("connectionStatus"),
  spinForm: document.getElementById("spinForm"),
  spinName: document.getElementById("spinName"),
  lastResult: document.getElementById("lastResult"),
  overlayUrl: document.getElementById("overlayUrl"),
  donationUrl: document.getElementById("donationUrl"),
  triggerUrl: document.getElementById("triggerUrl"),
  twitchConnected: document.getElementById("twitchConnected"),
  twitchCommand: document.getElementById("twitchCommand"),
  rewardId: document.getElementById("rewardId"),
  twitchMessage: document.getElementById("twitchMessage"),
  reloadButton: document.getElementById("reloadButton"),
  challengeList: document.getElementById("challengeList"),
  addChallenge: document.getElementById("addChallenge"),
  saveChallenges: document.getElementById("saveChallenges"),
  historyList: document.getElementById("historyList")
};

const api = {
  mode: "local",
  config: "/api/config",
  spin: "/api/spin",
  state: "/api/status",
  reload: "/api/reload",
  localInfo: "/api/local-info"
};

let config = null;
let history = [];

init();

async function init() {
  await resolveApi();
  await Promise.all([loadConfig(), loadLocalInfo(), loadStatus()]);
  connectUpdates();
  window.setInterval(loadStatus, api.mode === "netlify" ? 1800 : 3500);
}

async function resolveApi() {
  try {
    const response = await fetch("/.netlify/functions/config", { cache: "no-store" });
    if (response.ok) {
      api.mode = "netlify";
      api.config = "/.netlify/functions/config";
      api.spin = "/.netlify/functions/trigger";
      api.state = "/.netlify/functions/state";
      api.reload = "";
      api.localInfo = "";
    }
  } catch (error) {
    api.mode = "local";
  }
}

async function loadConfig() {
  const response = await fetch(api.config, { cache: "no-store" });
  const payload = await response.json();
  config = payload.config || payload;
  renderChallenges();
}

async function loadLocalInfo() {
  if (api.mode === "netlify") {
    const base = window.location.origin;
    els.overlayUrl.value = `${base}/overlay.html?layout=center`;
    els.donationUrl.value = `${base}/.netlify/functions/donation?secret=YOUR_DONATION_SECRET`;
    els.triggerUrl.value = `${base}/.netlify/functions/trigger?secret=YOUR_TRIGGER_SECRET&name=Viewer&reason=Manual`;
    return;
  }

  const response = await fetch(api.localInfo, { cache: "no-store" });
  const info = await response.json();
  els.overlayUrl.value = info.overlayUrl || "";
  els.donationUrl.value = info.donationWebhookUrl || "";
  els.triggerUrl.value = info.triggerUrl || "";
}

async function loadStatus() {
  const response = await fetch(api.state, { cache: "no-store" });
  const status = await response.json();

  if (api.mode === "netlify") {
    history = status.history || [];
    els.status.textContent = "Netlify live";
    els.status.classList.add("is-live");
    els.twitchConnected.textContent = "EventSub / webhook";
    els.twitchCommand.textContent = config?.twitch?.spinCommand || "!spin";
    els.rewardId.textContent = config?.twitch?.rewardIdConfigured ? "configured" : "optional";
    els.twitchMessage.textContent = config?.chat?.webhookConfigured
      ? "Chat webhook is configured"
      : "Use CHAT_WEBHOOK_URL or the returned chatMessage to echo results in chat";
    renderHistory();
    return;
  }

  history = status.history || [];
  const live = status.clients > 0;
  els.status.textContent = live ? `overlay online: ${status.clients}` : "overlay not open";
  els.status.classList.toggle("is-live", live);
  els.twitchConnected.textContent = status.twitch.enabled
    ? status.twitch.connected
      ? "connected"
      : "not connected"
    : "disabled";
  els.twitchCommand.textContent = config?.twitch?.spinCommand || "-";
  els.rewardId.textContent =
    status.twitch.lastRewardId || (config?.twitch?.rewardIdConfigured ? "configured in config.json" : "appears after redemption");
  els.twitchMessage.textContent = status.twitch.lastMessage || "-";
  renderHistory();
}

function connectUpdates() {
  if (api.mode === "netlify") return;

  const events = new EventSource("/events");
  events.addEventListener("spin", (message) => {
    const event = JSON.parse(message.data);
    history.unshift(event);
    history.splice(30);
    els.lastResult.textContent = `${event.name}: ${event.challenge.label}`;
    renderHistory();
  });
  events.addEventListener("config", async () => {
    await loadConfig();
  });
}

els.spinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = els.spinName.value.trim() || "Test viewer";
  const url = api.mode === "netlify" ? `${api.spin}?secret=${encodeURIComponent(getSecret("trigger"))}` : api.spin;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, reason: "Manual test", source: "control-panel" })
  });
  const result = await response.json();
  els.lastResult.textContent = result.ok
    ? `Started: ${result.event.challenge.label} | Chat: ${result.event.chatMessage}`
    : result.error || "Could not start the wheel";
  await loadStatus();
});

els.reloadButton.addEventListener("click", async () => {
  if (api.mode === "local") {
    await fetch(api.reload, { method: "POST" });
  }
  await loadConfig();
  await loadStatus();
  els.lastResult.textContent = "Settings refreshed.";
});

els.addChallenge.addEventListener("click", () => {
  config.challenges.push({
    label: "New",
    title: "New challenge",
    description: "A short, safe action for an IRL stream.",
    duration: "1 min",
    weight: 1
  });
  renderChallenges();
});

els.saveChallenges.addEventListener("click", async () => {
  const challenges = [...document.querySelectorAll(".challenge-row")].map((row) => ({
    label: row.querySelector("[data-field='label']").value,
    title: row.querySelector("[data-field='title']").value,
    description: row.querySelector("[data-field='description']").value,
    duration: row.querySelector("[data-field='duration']").value,
    weight: 1
  }));

  const url = api.mode === "netlify" ? `${api.config}?admin=${encodeURIComponent(getSecret("admin"))}` : api.config;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challenges })
  });
  const result = await response.json();
  if (result.ok) {
    config = result.config;
    renderChallenges();
    els.lastResult.textContent = "Challenges saved.";
  } else {
    els.lastResult.textContent = result.error || "Could not save challenges.";
  }
});

document.addEventListener("click", async (event) => {
  const copyButton = event.target.closest("[data-copy]");
  if (copyButton) {
    const input = document.getElementById(copyButton.dataset.copy);
    await navigator.clipboard.writeText(input.value);
    copyButton.textContent = "Copied";
    window.setTimeout(() => {
      copyButton.textContent = "Copy";
    }, 900);
    return;
  }

  const removeButton = event.target.closest("[data-remove-index]");
  if (removeButton) {
    const index = Number(removeButton.dataset.removeIndex);
    config.challenges.splice(index, 1);
    renderChallenges();
  }
});

function getSecret(kind) {
  const params = new URLSearchParams(window.location.search);
  const key = kind === "admin" ? "fortune-admin-secret" : "fortune-trigger-secret";
  const queryValue = params.get(kind) || params.get("secret");
  if (queryValue) {
    localStorage.setItem(key, queryValue);
    return queryValue;
  }

  const saved = localStorage.getItem(key);
  if (saved) return saved;

  const label = kind === "admin" ? "ADMIN_SECRET" : "TRIGGER_SECRET";
  const typed = window.prompt(`${label} for Netlify`);
  if (typed) localStorage.setItem(key, typed);
  return typed || "";
}

function renderChallenges() {
  const challenges = config?.challenges || [];
  els.challengeList.innerHTML = "";
  challenges.forEach((challenge, index) => {
    const row = document.createElement("div");
    row.className = "challenge-row";
    row.innerHTML = `
      <input data-field="label" value="${escapeAttr(challenge.label)}" aria-label="Sector word" title="One word shown on the wheel sector" />
      <input data-field="title" value="${escapeAttr(challenge.title || challenge.label)}" aria-label="Chat title" title="Title used in chat output" />
      <textarea data-field="description" aria-label="Full description">${escapeHtml(challenge.description || "")}</textarea>
      <input data-field="duration" value="${escapeAttr(challenge.duration || "")}" aria-label="Duration" />
      <button class="remove-button" type="button" data-remove-index="${index}" title="Remove">x</button>
    `;
    els.challengeList.appendChild(row);
  });
}

function renderHistory() {
  if (!history.length) {
    els.historyList.innerHTML = `<li>Empty for now.</li>`;
    return;
  }
  els.historyList.innerHTML = history
    .slice(0, 12)
    .map((event) => {
      const time = new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `<li><strong>${escapeHtml(event.challenge.label)}</strong> - ${escapeHtml(event.name)} | ${escapeHtml(event.chatMessage || event.reason)} | ${time}</li>`;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#039;");
}
