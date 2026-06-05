const state = {
  config: null,
  challenges: [],
  colors: ["#18d8ff", "#0b74d9", "#14f195", "#1d4fff", "#00a8d8", "#7d6cff", "#00d0b8", "#ffd84d"],
  queue: [],
  spinning: false,
  rotation: 0,
  dpr: Math.max(1, Math.min(2, window.devicePixelRatio || 1)),
  confetti: [],
  audio: {
    context: null,
    master: null,
    nextTickAt: 0
  },
  api: {
    mode: "local",
    config: "/api/config",
    state: "/api/status",
    events: "/events"
  },
  lastSeenAt: new Date(Date.now() - 1500).toISOString(),
  seenIds: new Set(),
  demo: new URLSearchParams(window.location.search).get("demo") === "1",
  layout: new URLSearchParams(window.location.search).get("layout") || "default"
};

const TAU = Math.PI * 2;
const wheelCanvas = document.getElementById("wheelCanvas");
const wheelCtx = wheelCanvas.getContext("2d");
const confettiCanvas = document.getElementById("confetti");
const confettiCtx = confettiCanvas.getContext("2d");
const wheelStage = document.getElementById("wheelStage");
const brandTitle = document.getElementById("brandTitle");
const brandSubtitle = document.getElementById("brandSubtitle");
const challengeTitle = document.getElementById("challengeTitle");
const challengeDescription = document.getElementById("challengeDescription");
const challengeDuration = document.getElementById("challengeDuration");
const triggerLine = document.getElementById("triggerLine");
const accentText = document.getElementById("accentText");
const queueBadge = document.getElementById("queueBadge");
const resultIcon = document.getElementById("resultIcon");

init();

async function init() {
  document.body.classList.toggle("layout-hud", state.layout === "hud" || state.layout === "side");
  document.body.classList.toggle("layout-center", state.layout === "center" || state.layout === "default");
  await resolveApi();
  await loadConfig();
  resize();
  if (state.demo) {
    setupDemoMode();
  } else if (state.api.mode === "netlify") {
    startPolling();
  } else {
    connectEvents();
  }
  requestAnimationFrame(tick);
}

async function resolveApi() {
  try {
    const response = await fetch("/.netlify/functions/config", { cache: "no-store" });
    if (response.ok) {
      state.api = {
        mode: "netlify",
        config: "/.netlify/functions/config",
        state: "/.netlify/functions/state",
        events: ""
      };
    }
  } catch (error) {
    state.api.mode = "local";
  }
}

async function loadConfig() {
  const response = await fetch(state.api.config, { cache: "no-store" });
  const payload = await response.json();
  state.config = payload.config || payload;
  state.challenges = state.config.challenges || [];
  state.colors = state.config.brand?.palette?.length ? state.config.brand.palette : state.colors;

  brandTitle.textContent = state.config.brand?.title || "IRL";
  brandSubtitle.textContent = state.config.brand?.subtitle || "ROLL";
  accentText.textContent = state.config.brand?.accentText || "50k pts / 5 EUR / sub";
  setResultIcon("Fortune");
  wheelStage.classList.toggle("is-idle", Boolean(state.config.wheel?.idlePulse));
  drawWheel(state.rotation);
}

function connectEvents() {
  const events = new EventSource(state.api.events);
  events.addEventListener("spin", (message) => {
    const event = JSON.parse(message.data);
    enqueueSpin(event);
  });
  events.addEventListener("config", async () => {
    await loadConfig();
  });
  events.onerror = () => {
    triggerLine.textContent = "reconnecting to the event server";
  };
}

function setupDemoMode() {
  triggerLine.textContent = "ready";
  window.addEventListener("message", (message) => {
    if (message.origin !== window.location.origin || message.data?.type !== "fortune-wheel-demo-spin") {
      return;
    }
    enqueueSpin(createDemoEvent(message.data));
  });
  window.parent?.postMessage({ type: "fortune-wheel-demo-ready" }, window.location.origin);
}

function createDemoEvent(input = {}) {
  const challenges = state.challenges.length ? state.challenges : [{ label: "Demo", title: "Demo challenge", description: "Preview spin.", duration: "10 sec" }];
  const index = Math.floor(Math.random() * challenges.length);
  const challenge = challenges[index];
  const seed = Math.floor(Math.random() * 900000) + 100000;

  return {
    id: `demo-${Date.now()}-${seed}`,
    at: new Date().toISOString(),
    source: input.source || "demo",
    name: input.name || "Demo viewer",
    reason: input.reason || "Stream preview",
    amount: input.amount || null,
    currency: input.currency || null,
    challenge,
    chatMessage: buildChatMessage(challenge),
    wheel: {
      index,
      total: challenges.length,
      spinSeed: seed
    }
  };
}

function buildChatMessage(challenge) {
  const template = state.config?.chat?.template || "Wheel result: {title} - {description} Time: {duration}";
  return template
    .replaceAll("{label}", challenge.label || "Challenge")
    .replaceAll("{title}", challenge.title || challenge.label || "Challenge")
    .replaceAll("{description}", challenge.description || "")
    .replaceAll("{duration}", challenge.duration || "IRL")
    .replace(/\s+/g, " ")
    .trim();
}

function startPolling() {
  pollEvents();
  window.setInterval(pollEvents, 1200);
}

async function pollEvents() {
  try {
    const response = await fetch(`${state.api.state}?after=${encodeURIComponent(state.lastSeenAt)}`, { cache: "no-store" });
    const payload = await response.json();
    if (payload.config) {
      const oldCount = state.challenges.length;
      state.config = payload.config;
      state.challenges = payload.config.challenges || state.challenges;
      state.colors = payload.config.brand?.palette?.length ? payload.config.brand.palette : state.colors;
      if (oldCount !== state.challenges.length) drawWheel(state.rotation);
    }

    const events = Array.isArray(payload.events) ? payload.events : [];
    for (const event of events) {
      if (state.seenIds.has(event.id)) continue;
      state.seenIds.add(event.id);
      enqueueSpin(event);
      if (Date.parse(event.at) > Date.parse(state.lastSeenAt)) {
        state.lastSeenAt = event.at;
      }
    }
    triggerLine.textContent = state.spinning ? triggerLine.textContent : "ready";
  } catch (error) {
    triggerLine.textContent = "waiting for Netlify events";
  }
}

function enqueueSpin(event) {
  state.queue.push(event);
  updateQueueBadge();
  runNext();
}

function updateQueueBadge() {
  const count = state.queue.length;
  queueBadge.textContent = String(count);
  queueBadge.classList.toggle("is-visible", count > 0 && Boolean(state.config?.wheel?.showQueue));
}

function runNext() {
  if (state.spinning || !state.queue.length) return;
  const event = state.queue.shift();
  updateQueueBadge();
  spin(event);
}

function spin(event) {
  state.spinning = true;
  wheelStage.classList.remove("is-idle", "is-result");
  wheelStage.classList.add("is-spinning");
  playSpinStartSound();

  triggerLine.textContent = `${event.name} - ${event.reason}`;
  challengeTitle.textContent = "ROLLING";
  challengeDescription.textContent = "Fortune wheel challenge";
  challengeDuration.textContent = event.source.replace(/-/g, " ");
  setResultIcon("Fortune");

  const total = Math.max(1, event.wheel?.total || state.challenges.length || 1);
  const index = Math.max(0, Math.min(total - 1, event.wheel?.index || 0));
  const slice = TAU / total;
  const sectorProgress = 0.18 + seededUnit(event.wheel?.spinSeed || 1) * 0.64;
  const selectedOffset = (index + sectorProgress) * slice;
  const fullTurns = 7 + ((event.wheel?.spinSeed || 0) % 4);
  let target = -selectedOffset;
  while (target < state.rotation + fullTurns * TAU) {
    target += TAU;
  }

  const start = state.rotation;
  const delta = target - start;
  const duration = Math.max(3600, Number(state.config?.wheel?.spinSeconds || 7.2) * 1000);
  const started = performance.now();
  let lastTickIndex = sectorAtPointer(start, total);

  function animate(now) {
    const t = Math.min(1, (now - started) / duration);
    const eased = 1 - Math.pow(1 - t, 4);
    const wobble = t > 0.82 ? Math.sin((t - 0.82) * 55) * (1 - t) * 0.05 : 0;
    state.rotation = start + delta * eased + wobble;
    drawWheel(state.rotation);
    const tickIndex = sectorAtPointer(state.rotation, total);
    if (tickIndex !== lastTickIndex) {
      playTickSound(tickIndex, t);
      lastTickIndex = tickIndex;
    }

    if (t < 1) {
      requestAnimationFrame(animate);
      return;
    }

    state.rotation = target % TAU;
    drawWheel(state.rotation);
    finishSpin(event);
  }

  requestAnimationFrame(animate);
}

function finishSpin(event) {
  wheelStage.classList.remove("is-spinning");
  wheelStage.classList.add("is-result");
  playResultSound();

  challengeTitle.textContent = event.challenge.label;
  challengeDescription.textContent = event.challenge.description || "Keep it light, safe, and on camera.";
  challengeDuration.textContent = event.challenge.duration || "IRL";
  triggerLine.textContent = `${event.name} rolled ${event.challenge.title || event.challenge.label}`;
  setResultIcon(event.challenge.label);

  if (state.config?.wheel?.confetti) {
    burstConfetti();
  }

  if (state.demo) {
    window.parent?.postMessage({ type: "fortune-wheel-demo-result", event }, window.location.origin);
  }

  window.setTimeout(() => {
    state.spinning = false;
    if (!state.queue.length) {
      wheelStage.classList.toggle("is-idle", Boolean(state.config?.wheel?.idlePulse));
    }
    runNext();
  }, 2600);
}

function resize() {
  const rect = wheelCanvas.getBoundingClientRect();
  const size = Math.max(260, Math.round(rect.width));
  state.dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  wheelCanvas.width = Math.round(size * state.dpr);
  wheelCanvas.height = Math.round(size * state.dpr);
  wheelCtx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

  confettiCanvas.width = Math.round(window.innerWidth * state.dpr);
  confettiCanvas.height = Math.round(window.innerHeight * state.dpr);
  confettiCtx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  drawWheel(state.rotation);
}

function seededUnit(seed) {
  const value = Math.sin(Number(seed) * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function sectorAtPointer(rotation, total) {
  const slice = TAU / Math.max(1, total);
  return Math.floor(normalizeAngle(-rotation) / slice) % Math.max(1, total);
}

function normalizeAngle(angle) {
  return ((angle % TAU) + TAU) % TAU;
}

function soundEnabled() {
  const params = new URLSearchParams(window.location.search);
  return params.get("sound") !== "0" && state.config?.wheel?.sound !== false;
}

function ensureAudio() {
  if (!soundEnabled()) return null;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;

  if (!state.audio.context) {
    try {
      const context = new AudioContext();
      const master = context.createGain();
      master.gain.value = Number(state.config?.wheel?.soundVolume ?? 0.16);
      master.connect(context.destination);
      state.audio.context = context;
      state.audio.master = master;
    } catch (error) {
      return null;
    }
  }

  if (state.audio.context.state === "suspended") {
    state.audio.context.resume?.().catch(() => {});
  }

  return state.audio.context;
}

function playTone({ frequency, slideTo, duration = 0.08, delay = 0, volume = 0.08, type = "sine" }) {
  const context = ensureAudio();
  if (!context || !state.audio.master) return;

  const now = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  if (slideTo) {
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), now + duration);
  }

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.connect(gain);
  gain.connect(state.audio.master);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.04);
}

function playSpinStartSound() {
  playTone({ frequency: 84, slideTo: 146, duration: 0.24, volume: 0.052, type: "triangle" });
  playTone({ frequency: 160, slideTo: 680, duration: 0.44, volume: 0.058, type: "sawtooth" });
  playTone({ frequency: 920, slideTo: 1480, duration: 0.12, delay: 0.05, volume: 0.025, type: "sine" });
}

function playTickSound(index, progress) {
  const now = performance.now();
  if (now < state.audio.nextTickAt) return;
  state.audio.nextTickAt = now + (progress > 0.78 ? 74 : 34);
  playTone({
    frequency: 520 + (index % 5) * 42,
    duration: progress > 0.82 ? 0.075 : 0.04,
    volume: progress > 0.82 ? 0.07 : 0.045,
    type: "square"
  });
}

function playResultSound() {
  playTone({ frequency: 392, duration: 0.18, volume: 0.06, type: "triangle" });
  playTone({ frequency: 523.25, duration: 0.2, delay: 0.06, volume: 0.06, type: "triangle" });
  playTone({ frequency: 659.25, duration: 0.34, delay: 0.12, volume: 0.075, type: "sine" });
  playTone({ frequency: 1046.5, duration: 0.2, delay: 0.2, volume: 0.04, type: "sine" });
}

function drawWheel(rotation) {
  const size = wheelCanvas.width / state.dpr;
  if (!size || !wheelCtx) return;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.455;
  const innerRadius = radius * 0.24;
  const challenges = state.challenges.length ? state.challenges : [{ label: "Spin" }];
  const slice = TAU / challenges.length;

  wheelCtx.clearRect(0, 0, size, size);
  drawHudShadow(cx, cy, radius);
  wheelCtx.save();
  wheelCtx.translate(cx, cy);
  wheelCtx.rotate(rotation);

  for (let index = 0; index < challenges.length; index += 1) {
    const start = -Math.PI / 2 + index * slice;
    const end = start + slice;
    const color = state.colors[index % state.colors.length];

    drawSectorPath(start, end, innerRadius, radius);
    const gradient = wheelCtx.createRadialGradient(0, 0, innerRadius * 0.35, 0, 0, radius);
    gradient.addColorStop(0, shadeColor(color, -68));
    gradient.addColorStop(0.55, shadeColor(color, -44));
    gradient.addColorStop(0.82, shadeColor(color, -22));
    gradient.addColorStop(1, shadeColor(color, 8));
    wheelCtx.fillStyle = gradient;
    wheelCtx.fill();

    drawSectorPath(start, end, innerRadius, radius);
    const gloss = wheelCtx.createLinearGradient(0, -radius, 0, radius);
    gloss.addColorStop(0, "rgba(255, 255, 255, 0.18)");
    gloss.addColorStop(0.45, "rgba(255, 255, 255, 0.02)");
    gloss.addColorStop(1, "rgba(0, 0, 0, 0.32)");
    wheelCtx.fillStyle = gloss;
    wheelCtx.fill();

    drawSectorPath(start, end, innerRadius, radius);
    wheelCtx.strokeStyle = "rgba(50, 224, 255, 0.52)";
    wheelCtx.lineWidth = Math.max(1.2, radius * 0.007);
    wheelCtx.stroke();

    wheelCtx.save();
    wheelCtx.beginPath();
    wheelCtx.arc(0, 0, radius - 4, start + slice * 0.06, end - slice * 0.06);
    wheelCtx.strokeStyle = hexToRgba(color, 0.76);
    wheelCtx.lineWidth = Math.max(1.4, radius * 0.006);
    wheelCtx.shadowColor = hexToRgba(color, 0.72);
    wheelCtx.shadowBlur = radius * 0.035;
    wheelCtx.stroke();
    wheelCtx.restore();
  }

  drawSoftWheelDetail(radius, innerRadius);

  for (let index = 0; index < challenges.length; index += 1) {
    const angle = -Math.PI / 2 + index * slice + slice / 2;
    drawSectorIcon(challenges[index].label, angle, radius, slice);
  }

  drawWheelRims(radius, innerRadius);
  wheelCtx.restore();
}

function drawSectorPath(start, end, innerRadius, radius) {
  wheelCtx.beginPath();
  wheelCtx.moveTo(Math.cos(start) * innerRadius, Math.sin(start) * innerRadius);
  wheelCtx.arc(0, 0, radius, start, end);
  wheelCtx.lineTo(Math.cos(end) * innerRadius, Math.sin(end) * innerRadius);
  wheelCtx.arc(0, 0, innerRadius, end, start, true);
  wheelCtx.closePath();
}

function drawSoftWheelDetail(radius, innerRadius) {
  wheelCtx.save();
  wheelCtx.beginPath();
  wheelCtx.arc(0, 0, radius - 5, 0, TAU);
  wheelCtx.arc(0, 0, innerRadius + 4, TAU, 0, true);
  wheelCtx.clip();

  for (let ring = innerRadius + radius * 0.17; ring < radius; ring += radius * 0.2) {
    wheelCtx.beginPath();
    wheelCtx.arc(0, 0, ring, 0, TAU);
    wheelCtx.strokeStyle = "rgba(103, 235, 255, 0.18)";
    wheelCtx.lineWidth = Math.max(1, radius * 0.0045);
    wheelCtx.stroke();
  }

  for (let angle = 0; angle < TAU; angle += TAU / 36) {
    wheelCtx.beginPath();
    wheelCtx.moveTo(Math.cos(angle) * (innerRadius + radius * 0.08), Math.sin(angle) * (innerRadius + radius * 0.08));
    wheelCtx.lineTo(Math.cos(angle) * (radius - 12), Math.sin(angle) * (radius - 12));
    wheelCtx.strokeStyle = "rgba(157, 247, 255, 0.055)";
    wheelCtx.lineWidth = Math.max(0.7, radius * 0.0025);
    wheelCtx.stroke();
  }

  wheelCtx.restore();
}

function drawWheelRims(radius, innerRadius) {
  wheelCtx.beginPath();
  wheelCtx.arc(0, 0, radius + 7, 0, TAU);
  wheelCtx.lineWidth = Math.max(14, radius * 0.066);
  wheelCtx.strokeStyle = "rgba(4, 14, 27, 0.9)";
  wheelCtx.shadowColor = "rgba(24, 216, 255, 0.7)";
  wheelCtx.shadowBlur = radius * 0.13;
  wheelCtx.stroke();
  wheelCtx.shadowBlur = 0;

  wheelCtx.beginPath();
  wheelCtx.arc(0, 0, radius + 4, 0, TAU);
  wheelCtx.lineWidth = Math.max(5, radius * 0.024);
  wheelCtx.strokeStyle = "rgba(24, 216, 255, 0.92)";
  wheelCtx.stroke();

  wheelCtx.beginPath();
  wheelCtx.arc(0, 0, radius - 9, 0, TAU);
  wheelCtx.lineWidth = Math.max(4, radius * 0.018);
  wheelCtx.strokeStyle = "rgba(214, 250, 255, 0.92)";
  wheelCtx.stroke();

  wheelCtx.beginPath();
  wheelCtx.arc(0, 0, radius - 18, 0, TAU);
  wheelCtx.lineWidth = Math.max(2, radius * 0.009);
  wheelCtx.strokeStyle = "rgba(24, 216, 255, 0.5)";
  wheelCtx.stroke();

  wheelCtx.beginPath();
  wheelCtx.arc(0, 0, innerRadius + 8, 0, TAU);
  wheelCtx.lineWidth = Math.max(10, radius * 0.047);
  wheelCtx.strokeStyle = "rgba(5, 15, 29, 0.92)";
  wheelCtx.shadowColor = "rgba(24, 216, 255, 0.58)";
  wheelCtx.shadowBlur = radius * 0.07;
  wheelCtx.stroke();
  wheelCtx.shadowBlur = 0;

  wheelCtx.beginPath();
  wheelCtx.arc(0, 0, innerRadius, 0, TAU);
  const hub = wheelCtx.createRadialGradient(-innerRadius * 0.25, -innerRadius * 0.32, 1, 0, 0, innerRadius);
  hub.addColorStop(0, "rgba(64, 229, 255, 0.32)");
  hub.addColorStop(0.52, "rgba(8, 24, 45, 0.98)");
  hub.addColorStop(1, "rgba(1, 6, 14, 0.98)");
  wheelCtx.fillStyle = hub;
  wheelCtx.fill();
  wheelCtx.lineWidth = Math.max(4, radius * 0.018);
  wheelCtx.strokeStyle = "rgba(222, 252, 255, 0.96)";
  wheelCtx.stroke();

  wheelCtx.beginPath();
  wheelCtx.arc(0, 0, innerRadius * 0.68, 0, TAU);
  wheelCtx.strokeStyle = "rgba(24, 216, 255, 0.42)";
  wheelCtx.lineWidth = Math.max(1.2, radius * 0.006);
  wheelCtx.stroke();
}

function drawHudShadow(cx, cy, radius) {
  wheelCtx.save();
  wheelCtx.translate(cx, cy);
  wheelCtx.beginPath();
  wheelCtx.arc(0, 0, radius + 8, 0, TAU);
  wheelCtx.fillStyle = "rgba(1, 8, 18, 0.42)";
  wheelCtx.shadowColor = "rgba(24, 216, 255, 0.62)";
  wheelCtx.shadowBlur = 30;
  wheelCtx.shadowOffsetY = 0;
  wheelCtx.fill();
  wheelCtx.beginPath();
  wheelCtx.arc(0, 0, radius + 10, 0, TAU);
  wheelCtx.strokeStyle = "rgba(24, 216, 255, 0.46)";
  wheelCtx.lineWidth = 2;
  wheelCtx.shadowBlur = 0;
  wheelCtx.stroke();
  wheelCtx.restore();
}

function drawSectorIcon(text, angle, radius, slice) {
  const icon = iconKey(text);
  const x = Math.cos(angle) * radius * 0.66;
  const y = Math.sin(angle) * radius * 0.66;
  const iconSize = Math.max(36, Math.min(radius * 0.3, radius * slice * 0.54));

  wheelCtx.save();
  wheelCtx.translate(x, y);
  drawIconBadge(icon, iconSize, iconPalette(icon));
  wheelCtx.restore();
}

function oneWord(value) {
  return String(value || "Spin").trim().split(/\s+/)[0].replace(/[^a-z0-9-]/gi, "") || "Spin";
}

function iconKey(value) {
  const key = oneWord(value).toLowerCase();
  const icons = {
    fortune: "fortune",
    grass: "grass",
    water: "drop",
    view: "eye",
    praise: "star",
    blue: "dot",
    steps: "steps",
    sound: "sound",
    fact: "info",
    circle: "ring",
    route: "route",
    hydrate: "bottle",
    vote: "check"
  };
  return icons[key] || "spark";
}

function iconPalette(icon) {
  const palettes = {
    fortune: { a: "#9eff36", b: "#19d6ff", c: "#ffd04a" },
    grass: { a: "#9eff36", b: "#2fd16f", c: "#f3f1e8" },
    drop: { a: "#19d6ff", b: "#5799ff", c: "#dfeaff" },
    eye: { a: "#ffd04a", b: "#f6e0b8", c: "#ffffff" },
    star: { a: "#ffd04a", b: "#f45ac6", c: "#ffffff" },
    dot: { a: "#5799ff", b: "#19d6ff", c: "#ffffff" },
    steps: { a: "#f6e0b8", b: "#ffb24a", c: "#ffffff" },
    sound: { a: "#9eff36", b: "#19d6ff", c: "#ffffff" },
    info: { a: "#e5e0f0", b: "#a88cff", c: "#ffffff" },
    ring: { a: "#f3f1e8", b: "#ffd04a", c: "#ffffff" },
    route: { a: "#f45ac6", b: "#19d6ff", c: "#ffffff" },
    bottle: { a: "#19d6ff", b: "#9eff36", c: "#ffffff" },
    check: { a: "#9eff36", b: "#ffd04a", c: "#ffffff" },
    spark: { a: "#ffd04a", b: "#f45ac6", c: "#ffffff" }
  };
  return palettes[icon] || palettes.spark;
}

function setResultIcon(label) {
  if (!resultIcon) return;
  const icon = iconKey(label);
  resultIcon.dataset.icon = icon;
  resultIcon.innerHTML = resultIconSvg(icon);
}

function resultIconSvg(icon) {
  const shapes = {
    fortune: '<defs><linearGradient id="fortuneGlow" x1="8" y1="7" x2="40" y2="42" gradientUnits="userSpaceOnUse"><stop stop-color="#9eff36"/><stop offset="0.52" stop-color="#19d6ff"/><stop offset="1" stop-color="#ffd04a"/></linearGradient></defs><circle cx="24" cy="24" r="16" fill="rgba(255,255,255,0.14)" stroke="url(#fortuneGlow)" stroke-width="5"/><path d="M24 9L28 20L40 24L28 28L24 39L20 28L8 24L20 20Z" fill="url(#fortuneGlow)" stroke="rgba(0,0,0,0.82)" stroke-width="2.4"/><circle cx="24" cy="24" r="5" fill="#ffffff" stroke="rgba(0,0,0,0.82)" stroke-width="2"/>',
    grass: '<path d="M24 44V10M24 35C15 28 13 18 15 10M24 31C33 25 35 16 33 9M17 44C15 35 11 30 7 26M31 44C33 35 37 30 41 26"/>',
    drop: '<path d="M24 6C34 18 39 27 36 35C33 42 28 45 24 45C20 45 15 42 12 35C9 27 14 18 24 6Z"/>',
    eye: '<path d="M5 24C10 15 17 11 24 11C31 11 38 15 43 24C38 33 31 37 24 37C17 37 10 33 5 24Z"/><circle cx="24" cy="24" r="6" fill="currentColor"/>',
    star: '<path d="M24 5L29 18L43 18L32 27L36 42L24 34L12 42L16 27L5 18L19 18Z"/>',
    dot: '<circle cx="24" cy="24" r="15" fill="currentColor"/>',
    steps: '<ellipse cx="17" cy="18" rx="6" ry="11" transform="rotate(-17 17 18)" fill="currentColor"/><ellipse cx="31" cy="31" rx="6" ry="11" transform="rotate(-17 31 31)" fill="currentColor"/>',
    sound: '<path d="M7 18H15L25 10V38L15 30H7Z" fill="currentColor"/><path d="M30 17C33 21 33 27 30 31M35 12C41 19 41 29 35 36"/>',
    info: '<circle cx="24" cy="24" r="18"/><circle cx="24" cy="15" r="2.5" fill="currentColor"/><path d="M24 23V34"/>',
    ring: '<circle cx="24" cy="24" r="17"/>',
    route: '<path d="M8 36C15 13 29 39 40 12"/><circle cx="8" cy="36" r="3" fill="currentColor"/><circle cx="40" cy="12" r="3" fill="currentColor"/>',
    bottle: '<path d="M18 13H30M20 13V9H28V13M18 15H30V42H18Z"/><path d="M20 28H28"/>',
    check: '<rect x="8" y="10" width="32" height="28" rx="5"/><path d="M15 24L22 31L34 18"/>',
    spark: '<path d="M24 5L28 19L43 24L28 29L24 43L20 29L5 24L20 19Z"/>'
  };
  return `<svg viewBox="0 0 48 48" aria-hidden="true">${shapes[icon] || shapes.spark}</svg>`;
}

function drawIconBadge(icon, size, palette) {
  wheelCtx.save();
  wheelCtx.beginPath();
  wheelCtx.arc(0, 0, size * 0.76, 0, TAU);
  const badge = wheelCtx.createRadialGradient(-size * 0.2, -size * 0.25, size * 0.08, 0, 0, size * 0.82);
  badge.addColorStop(0, hexToRgba(palette.c, 0.9));
  badge.addColorStop(0.48, hexToRgba(palette.a, 0.82));
  badge.addColorStop(1, "rgba(2, 10, 22, 0.9)");
  wheelCtx.fillStyle = badge;
  wheelCtx.shadowColor = hexToRgba(palette.b, 0.7);
  wheelCtx.shadowBlur = size * 0.28;
  wheelCtx.shadowOffsetY = 0;
  wheelCtx.fill();
  wheelCtx.shadowBlur = 0;
  wheelCtx.shadowOffsetY = 0;
  wheelCtx.beginPath();
  wheelCtx.arc(0, 0, size * 0.76, 0, TAU);
  wheelCtx.strokeStyle = hexToRgba(palette.b, 0.95);
  wheelCtx.lineWidth = Math.max(2, size * 0.075);
  wheelCtx.stroke();
  wheelCtx.beginPath();
  wheelCtx.arc(0, 0, size * 0.88, 0, TAU);
  wheelCtx.strokeStyle = "rgba(225, 252, 255, 0.78)";
  wheelCtx.lineWidth = Math.max(1.5, size * 0.04);
  wheelCtx.stroke();
  wheelCtx.lineCap = "round";
  wheelCtx.lineJoin = "round";
  drawIconShape(icon, size * 0.92, "rgba(0, 0, 0, 0.92)", size * 0.2, true);
  drawIconShape(icon, size * 0.92, "#ffffff", size * 0.095, false);
  wheelCtx.restore();
}

function drawIconShape(icon, size, color, lineWidth, underlay) {
  wheelCtx.save();
  wheelCtx.strokeStyle = color;
  wheelCtx.fillStyle = color;
  wheelCtx.lineWidth = lineWidth;
  if (underlay) {
    wheelCtx.scale(1.14, 1.14);
  }

  switch (icon) {
    case "grass":
      drawGrassIcon(size);
      break;
    case "drop":
      drawDropIcon(size, underlay);
      break;
    case "eye":
      drawEyeIcon(size, underlay);
      break;
    case "star":
      drawStarIcon(size, underlay);
      break;
    case "dot":
      drawDotIcon(size);
      break;
    case "steps":
      drawStepsIcon(size);
      break;
    case "sound":
      drawSoundIcon(size);
      break;
    case "info":
      drawInfoIcon(size);
      break;
    case "ring":
      drawRingIcon(size);
      break;
    case "route":
      drawRouteIcon(size);
      break;
    case "bottle":
      drawBottleIcon(size);
      break;
    case "check":
      drawCheckIcon(size);
      break;
    default:
      drawSparkIcon(size);
      break;
  }

  wheelCtx.restore();
}

function drawGrassIcon(size) {
  const s = size / 2;
  wheelCtx.beginPath();
  wheelCtx.moveTo(0, s * 0.62);
  wheelCtx.lineTo(0, -s * 0.58);
  wheelCtx.moveTo(0, s * 0.38);
  wheelCtx.quadraticCurveTo(-s * 0.52, -s * 0.08, -s * 0.48, -s * 0.5);
  wheelCtx.moveTo(0, s * 0.26);
  wheelCtx.quadraticCurveTo(s * 0.52, -s * 0.1, s * 0.5, -s * 0.54);
  wheelCtx.moveTo(-s * 0.34, s * 0.62);
  wheelCtx.quadraticCurveTo(-s * 0.18, s * 0.12, -s * 0.55, -s * 0.16);
  wheelCtx.moveTo(s * 0.34, s * 0.62);
  wheelCtx.quadraticCurveTo(s * 0.18, s * 0.12, s * 0.55, -s * 0.16);
  wheelCtx.stroke();
}

function drawDropIcon(size, underlay) {
  const s = size / 2;
  wheelCtx.beginPath();
  wheelCtx.moveTo(0, -s * 0.72);
  wheelCtx.bezierCurveTo(s * 0.58, -s * 0.08, s * 0.68, s * 0.26, s * 0.3, s * 0.58);
  wheelCtx.bezierCurveTo(s * 0.08, s * 0.76, -s * 0.08, s * 0.76, -s * 0.3, s * 0.58);
  wheelCtx.bezierCurveTo(-s * 0.68, s * 0.26, -s * 0.58, -s * 0.08, 0, -s * 0.72);
  if (underlay) {
    wheelCtx.fill();
  } else {
    wheelCtx.stroke();
  }
}

function drawEyeIcon(size, underlay) {
  const s = size / 2;
  wheelCtx.beginPath();
  wheelCtx.ellipse(0, 0, s * 0.74, s * 0.42, 0, 0, TAU);
  wheelCtx.stroke();
  wheelCtx.beginPath();
  wheelCtx.arc(0, 0, s * (underlay ? 0.2 : 0.18), 0, TAU);
  wheelCtx.fill();
}

function drawStarIcon(size, underlay) {
  const s = size / 2;
  wheelCtx.beginPath();
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? s * 0.74 : s * 0.32;
    const angle = -Math.PI / 2 + index * Math.PI / 5;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (index === 0) {
      wheelCtx.moveTo(x, y);
    } else {
      wheelCtx.lineTo(x, y);
    }
  }
  wheelCtx.closePath();
  if (underlay) {
    wheelCtx.fill();
  } else {
    wheelCtx.stroke();
  }
}

function drawDotIcon(size) {
  const s = size / 2;
  wheelCtx.beginPath();
  wheelCtx.arc(0, 0, s * 0.52, 0, TAU);
  wheelCtx.fill();
}

function drawStepsIcon(size) {
  const s = size / 2;
  wheelCtx.save();
  wheelCtx.rotate(-0.25);
  wheelCtx.beginPath();
  wheelCtx.ellipse(-s * 0.25, -s * 0.2, s * 0.22, s * 0.42, -0.2, 0, TAU);
  wheelCtx.ellipse(s * 0.25, s * 0.24, s * 0.22, s * 0.42, -0.2, 0, TAU);
  wheelCtx.fill();
  wheelCtx.restore();
}

function drawSoundIcon(size) {
  const s = size / 2;
  wheelCtx.beginPath();
  wheelCtx.moveTo(-s * 0.7, -s * 0.22);
  wheelCtx.lineTo(-s * 0.36, -s * 0.22);
  wheelCtx.lineTo(-s * 0.02, -s * 0.52);
  wheelCtx.lineTo(-s * 0.02, s * 0.52);
  wheelCtx.lineTo(-s * 0.36, s * 0.22);
  wheelCtx.lineTo(-s * 0.7, s * 0.22);
  wheelCtx.closePath();
  wheelCtx.fill();
  wheelCtx.beginPath();
  wheelCtx.arc(s * 0.05, 0, s * 0.38, -0.78, 0.78);
  wheelCtx.arc(s * 0.1, 0, s * 0.68, -0.72, 0.72);
  wheelCtx.stroke();
}

function drawInfoIcon(size) {
  const s = size / 2;
  wheelCtx.beginPath();
  wheelCtx.arc(0, 0, s * 0.68, 0, TAU);
  wheelCtx.stroke();
  wheelCtx.beginPath();
  wheelCtx.arc(0, -s * 0.36, s * 0.08, 0, TAU);
  wheelCtx.fill();
  wheelCtx.beginPath();
  wheelCtx.moveTo(0, -s * 0.08);
  wheelCtx.lineTo(0, s * 0.42);
  wheelCtx.stroke();
}

function drawRingIcon(size) {
  const s = size / 2;
  wheelCtx.beginPath();
  wheelCtx.arc(0, 0, s * 0.62, 0, TAU);
  wheelCtx.stroke();
}

function drawRouteIcon(size) {
  const s = size / 2;
  wheelCtx.beginPath();
  wheelCtx.moveTo(-s * 0.68, s * 0.42);
  wheelCtx.bezierCurveTo(-s * 0.36, -s * 0.42, s * 0.18, s * 0.42, s * 0.58, -s * 0.44);
  wheelCtx.stroke();
  wheelCtx.beginPath();
  wheelCtx.arc(-s * 0.7, s * 0.46, s * 0.1, 0, TAU);
  wheelCtx.arc(s * 0.62, -s * 0.48, s * 0.1, 0, TAU);
  wheelCtx.fill();
}

function drawBottleIcon(size) {
  const s = size / 2;
  wheelCtx.beginPath();
  roundedRectPath(-s * 0.28, -s * 0.42, s * 0.56, s * 0.92, s * 0.1);
  wheelCtx.stroke();
  wheelCtx.beginPath();
  wheelCtx.moveTo(-s * 0.18, -s * 0.58);
  wheelCtx.lineTo(s * 0.18, -s * 0.58);
  wheelCtx.moveTo(-s * 0.2, s * 0.05);
  wheelCtx.lineTo(s * 0.2, s * 0.05);
  wheelCtx.stroke();
}

function drawCheckIcon(size) {
  const s = size / 2;
  wheelCtx.beginPath();
  roundedRectPath(-s * 0.56, -s * 0.5, s * 1.12, s, s * 0.12);
  wheelCtx.stroke();
  wheelCtx.beginPath();
  wheelCtx.moveTo(-s * 0.34, 0);
  wheelCtx.lineTo(-s * 0.1, s * 0.24);
  wheelCtx.lineTo(s * 0.38, -s * 0.28);
  wheelCtx.stroke();
}

function drawSparkIcon(size) {
  const s = size / 2;
  wheelCtx.beginPath();
  wheelCtx.moveTo(0, -s * 0.72);
  wheelCtx.lineTo(s * 0.16, -s * 0.16);
  wheelCtx.lineTo(s * 0.72, 0);
  wheelCtx.lineTo(s * 0.16, s * 0.16);
  wheelCtx.lineTo(0, s * 0.72);
  wheelCtx.lineTo(-s * 0.16, s * 0.16);
  wheelCtx.lineTo(-s * 0.72, 0);
  wheelCtx.lineTo(-s * 0.16, -s * 0.16);
  wheelCtx.closePath();
  wheelCtx.stroke();
}

function roundedRectPath(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  wheelCtx.moveTo(x + r, y);
  wheelCtx.lineTo(x + width - r, y);
  wheelCtx.quadraticCurveTo(x + width, y, x + width, y + r);
  wheelCtx.lineTo(x + width, y + height - r);
  wheelCtx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  wheelCtx.lineTo(x + r, y + height);
  wheelCtx.quadraticCurveTo(x, y + height, x, y + height - r);
  wheelCtx.lineTo(x, y + r);
  wheelCtx.quadraticCurveTo(x, y, x + r, y);
}

function shadeColor(hex, percent) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((part) => part + part).join("") : value;
  const amount = Math.round(2.55 * percent);
  const r = Math.max(0, Math.min(255, (parseInt(full.slice(0, 2), 16) || 0) + amount));
  const g = Math.max(0, Math.min(255, (parseInt(full.slice(2, 4), 16) || 0) + amount));
  const b = Math.max(0, Math.min(255, (parseInt(full.slice(4, 6), 16) || 0) + amount));
  return `rgb(${r}, ${g}, ${b})`;
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((part) => part + part).join("") : value;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function burstConfetti() {
  const colors = state.colors;
  const rect = wheelCanvas.getBoundingClientRect();
  const originX = rect.left + rect.width * 0.5;
  const originY = rect.top + rect.height * 0.42;
  for (let index = 0; index < 110; index += 1) {
    state.confetti.push({
      x: originX + (Math.random() - 0.5) * 180,
      y: originY + (Math.random() - 0.5) * 80,
      vx: (Math.random() - 0.5) * 12,
      vy: -Math.random() * 9 - 2,
      rot: Math.random() * TAU,
      vr: (Math.random() - 0.5) * 0.28,
      size: Math.random() * 8 + 5,
      color: colors[index % colors.length],
      life: 1
    });
  }
}

function tick() {
  confettiCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  for (let index = state.confetti.length - 1; index >= 0; index -= 1) {
    const piece = state.confetti[index];
    piece.x += piece.vx;
    piece.y += piece.vy;
    piece.vy += 0.23;
    piece.rot += piece.vr;
    piece.life -= 0.012;

    if (piece.life <= 0 || piece.y > window.innerHeight + 40) {
      state.confetti.splice(index, 1);
      continue;
    }

    confettiCtx.save();
    confettiCtx.globalAlpha = Math.max(0, piece.life);
    confettiCtx.translate(piece.x, piece.y);
    confettiCtx.rotate(piece.rot);
    confettiCtx.fillStyle = piece.color;
    confettiCtx.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size * 0.56);
    confettiCtx.restore();
  }

  requestAnimationFrame(tick);
}

window.addEventListener("resize", resize);
