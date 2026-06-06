(function () {
  "use strict";

  const TAU = Math.PI * 2;
  const POINTER_ANGLE = -Math.PI / 2;
  const DEFAULT_CONFIG = {
    title: "TIMUR FEARLESS",
    subtitle: "IRL FORTUNE WHEEL",
    tagline: "LIVE CHALLENGE SPIN",
    spinDurationMs: 7600,
    autoSpinOnLoad: false,
    autoSpinDelayMs: 900,
    pollNetlifyState: true,
    pollIntervalMs: 1800,
    hideWhenIdle: true,
    hideAfterResultMs: 15000,
    muted: false,
    particles: true,
    sparks: true,
    maxParticles: 260,
    reducedPerformance: false,
    sound: {
      enabled: true,
      volume: 0.42
    },
    colors: {
      accent: "#18d8ff",
      hot: "#ff2bd6",
      gold: "#ffd166",
      green: "#7dff6a",
      violet: "#7c5cff",
      ink: "#07111f"
    },
    challenges: [
      { key: "touch_grass", label: "TOUCH\nGRASS", title: "TOUCH GRASS", color: "#1b9f64", icon: "grass", desc: "Find some grass or green nature nearby and touch it on stream." },
      { key: "touch_water", label: "TOUCH\nWATER", title: "TOUCH WATER", color: "#1267a8", icon: "water", desc: "Find safe water nearby - sea, lake, fountain, or puddle - and touch it." },
      { key: "timeout", label: "TIMEOUT", title: "TIMEOUT", color: "#3b2b7a", icon: "timeout", desc: "The spinner gets a 10 min timeout in chat. Chat jail activated." },
      { key: "show_euc", label: "SHOW\nEUC", title: "SHOW EUC", color: "#0f4f73", icon: "monowheel", desc: "Stop for a moment and show the electric unicycle to the stream." }
    ]
  };

  const dom = {
    root: document.querySelector(".overlay-root"),
    wheel: document.getElementById("wheelCanvas"),
    particles: document.getElementById("particleCanvas"),
    rig: document.getElementById("wheelRig"),
    title: document.getElementById("overlayTitle"),
    subtitle: document.getElementById("overlaySubtitle"),
    tagline: document.getElementById("overlayTagline"),
    signal: document.getElementById("resultSignal"),
    label: document.getElementById("resultLabel"),
    detail: document.getElementById("resultDetail"),
    resultIcon: document.getElementById("resultIcon"),
    triggerLine: document.getElementById("triggerLine"),
    resultPanel: document.getElementById("resultPanel")
  };

  const wheelCtx = dom.wheel.getContext("2d");
  const particleCtx = dom.particles.getContext("2d");
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  const params = new URLSearchParams(window.location.search);

  const state = {
    config: DEFAULT_CONFIG,
    items: [],
    icons: new Map(),
    width: 1,
    height: 1,
    particleWidth: 1,
    particleHeight: 1,
    dpr: 1,
    rotation: 0,
    targetRotation: 0,
    startRotation: 0,
    spinStartedAt: 0,
    spinDuration: DEFAULT_CONFIG.spinDurationMs,
    selectedIndex: 0,
    spinning: false,
    pendingEvent: null,
    queue: [],
    particles: [],
    lastFrame: 0,
    lastSparkAt: 0,
    lastTickSector: -1,
    lastTickAt: 0,
    animationId: 0,
    hideTimer: 0,
    reduced: media.matches,
    sound: null,
    lastEventAt: new Date().toISOString(),
    pollTimer: 0,
    netlifyMode: false
  };

  class SoundBank {
    constructor(config) {
      this.config = config || {};
      this.enabled = Boolean(this.config.enabled);
      this.muted = Boolean(state.config.muted) || params.get("sound") === "0" || params.get("muted") === "1";
      this.volume = clamp(Number(this.config.volume) || 0.4, 0, 1);
      this.audio = {};
      this.context = null;
      this.tickCounter = 0;
      if (params.get("sound") === "1") {
        this.enabled = true;
        this.muted = false;
      }
      this.preload();
    }

    preload() {
      for (const key of ["spin", "tick", "result"]) {
        const src = this.config[key];
        if (!src) continue;
        const audio = new Audio(src);
        audio.preload = "auto";
        audio.volume = this.volume;
        this.audio[key] = audio;
      }
    }

    play(name) {
      if (!this.enabled || this.muted) return;
      const audio = this.audio[name];
      if (audio) {
        const player = name === "tick" ? audio.cloneNode() : audio;
        player.volume = name === "tick" ? Math.min(1, this.volume * 1.08) : this.volume;
        if (name === "tick") {
          this.tickCounter += 1;
          player.playbackRate = [0.92, 1, 1.07, 0.97][this.tickCounter % 4];
        }
        player.currentTime = 0;
        player.play().catch(() => this.playSynth(name));
        return;
      }
      this.playSynth(name);
    }

    playSynth(name) {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        this.context = this.context || new AudioContext();
        if (this.context.state === "suspended") this.context.resume().catch(() => {});
        const now = this.context.currentTime;
        const osc = this.context.createOscillator();
        const gain = this.context.createGain();
        const frequency = name === "result" ? 760 : name === "tick" ? 1320 : 220;
        const duration = name === "result" ? 0.52 : name === "tick" ? 0.035 : 0.36;
        osc.type = name === "spin" ? "sawtooth" : "triangle";
        osc.frequency.setValueAtTime(frequency, now);
        if (name === "spin") osc.frequency.exponentialRampToValueAtTime(80, now + duration);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(this.volume * 0.2, now + 0.014);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        osc.connect(gain).connect(this.context.destination);
        osc.start(now);
        osc.stop(now + duration + 0.02);
      } catch (error) {
        // Sound must never break the visual overlay.
      }
    }
  }

  init();

  async function init() {
    const config = await loadConfig();
    applyConfig(config);
    resize();
    window.addEventListener("resize", resize);
    media.addEventListener("change", () => {
      state.reduced = media.matches;
    });

    setupTriggers();
    drawWheel();
    revealResult(0, null, false);
    setOverlayVisible(shouldStartVisible(), true);
    startLoop();
    startPolling();

    if (shouldAutoSpin()) {
      window.setTimeout(() => spin(null, demoEvent()), Number(state.config.autoSpinDelayMs) || 700);
    }
  }

  function shouldAutoSpin() {
    if (params.get("spin") === "0") return false;
    if (params.get("demo") === "1" || params.get("spin") === "1") return true;
    return Boolean(state.config.autoSpinOnLoad);
  }

  function shouldStartVisible() {
    if (params.get("visible") === "1" || params.get("setup") === "1") return true;
    if (params.get("demo") === "1" || params.get("spin") === "1") return true;
    return !state.config.hideWhenIdle;
  }

  async function loadConfig() {
    try {
      const response = await fetch("./config.json", { cache: "no-store" });
      if (!response.ok) return DEFAULT_CONFIG;
      const remote = await response.json();
      return deepMerge(DEFAULT_CONFIG, remote);
    } catch (error) {
      return DEFAULT_CONFIG;
    }
  }

  function applyConfig(config) {
    state.config = deepMerge(DEFAULT_CONFIG, config || {});
    state.items = normalizeItems(state.config.challenges || state.config.items);
    state.spinDuration = Math.max(1800, Number(state.config.spinDurationMs) || DEFAULT_CONFIG.spinDurationMs);
    state.sound = new SoundBank(state.config.sound || {});
    dom.title.textContent = state.config.title || DEFAULT_CONFIG.title;
    dom.subtitle.textContent = state.config.subtitle || DEFAULT_CONFIG.subtitle;
    dom.tagline.textContent = state.config.tagline || DEFAULT_CONFIG.tagline;
    document.documentElement.style.setProperty("--accent", state.config.colors.accent || DEFAULT_CONFIG.colors.accent);
    document.documentElement.style.setProperty("--hot", state.config.colors.hot || DEFAULT_CONFIG.colors.hot);
    document.documentElement.style.setProperty("--gold", state.config.colors.gold || DEFAULT_CONFIG.colors.gold);
    document.documentElement.style.setProperty("--green", state.config.colors.green || DEFAULT_CONFIG.colors.green);
    preloadIcons(state.items);
    drawWheel();
  }

  function normalizeItems(items) {
    const list = Array.isArray(items) && items.length ? items : DEFAULT_CONFIG.challenges;
    return list.map((item, index) => ({
      key: cleanText(item.key || `sector-${index + 1}`, 40),
      label: cleanLabel(item.label || `Sector ${index + 1}`, 32),
      detail: cleanText(item.detail || item.desc || item.description || item.result || item.label || "Challenge unlocked", 120),
      title: cleanText(item.title || item.label || `Challenge ${index + 1}`, 48),
      icon: resolveIconPath(item.icon),
      color: isColor(item.color) ? item.color : colorFor(index),
      accent: isColor(item.accent) ? item.accent : isColor(item.color) ? item.color : colorFor(index),
      chance: Math.max(0.01, Number(item.chance ?? item.weight) || 1),
      weight: Math.max(0.01, Number(item.chance ?? item.weight) || 1)
    }));
  }

  function preloadIcons(items) {
    for (const item of items) {
      if (!item.icon || state.icons.has(item.icon)) continue;
      const image = new Image();
      image.decoding = "async";
      image.onload = () => drawWheel();
      image.src = item.icon;
      state.icons.set(item.icon, image);
    }
  }

  function setupTriggers() {
    window.fearlessWheel = {
      spin: (pick) => spin(pick, demoEvent()),
      setConfig: (config) => updateRuntimeConfig(config),
      show: () => setOverlayVisible(true),
      hide: () => setOverlayVisible(false),
      config: () => state.config,
      result: () => state.items[state.selectedIndex]
    };

    window.addEventListener("message", (event) => {
      if (!event.data) return;
      if (event.data.type === "fearless-wheel:spin") {
        spin(event.data.pick, event.data.event || demoEvent());
      }
      if (event.data.type === "fearless-wheel:config") {
        updateRuntimeConfig(event.data.config);
      }
    });

    if ("BroadcastChannel" in window) {
      const channel = new BroadcastChannel("fearless-wheel");
      channel.addEventListener("message", (event) => {
        if (!event.data) return;
        if (event.data.type === "spin") {
          spin(event.data.pick, event.data.event || demoEvent());
        }
        if (event.data.type === "config") {
          updateRuntimeConfig(event.data.config);
        }
      });
    }
  }

  function startPolling() {
    if (!state.config.pollNetlifyState || window.location.protocol === "file:") return;
    const poll = async () => {
      try {
        const response = await fetch(`/.netlify/functions/state?after=${encodeURIComponent(state.lastEventAt)}`, {
          cache: "no-store"
        });
        if (!response.ok) return;
        const payload = await response.json();
        state.netlifyMode = true;
        const events = Array.isArray(payload.events) ? payload.events : [];
        for (const event of events) {
          if (event && event.at) state.lastEventAt = event.at;
          enqueueEvent(event);
        }
      } catch (error) {
        state.netlifyMode = false;
      }
    };
    poll();
    state.pollTimer = window.setInterval(poll, Math.max(900, Number(state.config.pollIntervalMs) || 1800));
  }

  function enqueueEvent(event) {
    if (!event || !event.id) return;
    if (state.pendingEvent && state.pendingEvent.id === event.id) return;
    if (state.queue.some((item) => item.id === event.id)) return;
    const pick = event.wheel && Number.isInteger(event.wheel.index) ? event.wheel.index : event.challenge && event.challenge.title;
    if (state.spinning) {
      state.queue.push({ pick, event });
      return;
    }
    spin(pick, event);
  }

  function resize() {
    const wheelRect = dom.wheel.getBoundingClientRect();
    const particleRect = dom.particles.getBoundingClientRect();
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.width = Math.max(1, Math.round(wheelRect.width * state.dpr));
    state.height = Math.max(1, Math.round(wheelRect.height * state.dpr));
    state.particleWidth = Math.max(1, Math.round(particleRect.width * state.dpr));
    state.particleHeight = Math.max(1, Math.round(particleRect.height * state.dpr));
    dom.wheel.width = state.width;
    dom.wheel.height = state.height;
    dom.particles.width = state.particleWidth;
    dom.particles.height = state.particleHeight;
    drawWheel();
  }

  function startLoop() {
    cancelAnimationFrame(state.animationId);
    state.lastFrame = performance.now();
    state.animationId = requestAnimationFrame(frame);
  }

  function frame(now) {
    const dt = Math.min(48, now - state.lastFrame);
    state.lastFrame = now;

    if (state.spinning) {
      const t = clamp((now - state.spinStartedAt) / state.spinDuration, 0, 1);
      state.rotation = lerp(state.startRotation, state.targetRotation, easeOutQuint(t));
      playTickIfNeeded(now);
      if (!state.reduced && state.config.sparks && now - state.lastSparkAt > 18) {
        state.lastSparkAt = now;
        spawnSpinSpark();
      }
      if (t >= 1) finishSpin();
      drawWheel();
    } else if (!isOverlayHidden() && !state.reduced && state.config.sparks && now - state.lastSparkAt > 140) {
      state.lastSparkAt = now;
      spawnAmbientSpark();
    }

    updateParticles(dt);
    drawParticles();
    state.animationId = requestAnimationFrame(frame);
  }

  function spin(pick, event) {
    if (!state.items.length) return;
    if (state.spinning) {
      state.queue.push({ pick, event });
      return;
    }
    setOverlayVisible(true);
    window.clearTimeout(state.hideTimer);

    const selectedIndex = resolvePick(pick);
    const sector = TAU / state.items.length;
    const center = (selectedIndex + 0.5) * sector;
    const current = normalizeAngle(state.rotation);
    const desired = normalizeAngle(POINTER_ANGLE - center);
    const delta = normalizeAngle(desired - current);
    const fullSpins = state.reduced || state.config.reducedPerformance ? 4 : 8;

    state.selectedIndex = selectedIndex;
    state.pendingEvent = event || null;
    state.startRotation = state.rotation;
    state.targetRotation = state.rotation + delta + fullSpins * TAU;
    state.spinStartedAt = performance.now();
    state.spinning = true;
    state.lastTickSector = -1;
    state.lastTickAt = 0;
    state.spinDuration = Math.max(1800, Number(state.config.spinDurationMs) || DEFAULT_CONFIG.spinDurationMs);
    dom.rig.classList.add("is-spinning");
    dom.signal.textContent = "SPINNING";
    dom.label.textContent = "LOCKING";
    dom.detail.textContent = "Wheel is choosing the next IRL challenge.";
    dom.triggerLine.textContent = triggerText(event);
    state.sound.play("spin");
    spawnStartBurst();
  }

  function finishSpin() {
    state.spinning = false;
    state.rotation = state.targetRotation;
    dom.rig.classList.remove("is-spinning");
    revealResult(state.selectedIndex, state.pendingEvent, true);
    if (!state.reduced && state.config.particles) {
      spawnResultBurst();
    }
    state.sound.play("result");
    drawWheel();
    state.pendingEvent = null;
    if (state.queue.length) {
      const next = state.queue.shift();
      window.setTimeout(() => spin(next.pick, next.event), 950);
    } else {
      scheduleAutoHide();
    }
  }

  function revealResult(index, event, animate) {
    const item = state.items[index] || state.items[0];
    const challenge = event && event.challenge ? event.challenge : null;
    const label = challenge && challenge.title ? challenge.title : item.title || item.label;
    const detail = challenge && challenge.description ? challenge.description : item.detail;
    dom.signal.textContent = event ? "CURRENT CHALLENGE" : "READY";
    dom.label.textContent = label;
    dom.detail.textContent = detail;
    dom.resultIcon.src = item.icon || "";
    dom.resultIcon.hidden = !item.icon;
    dom.triggerLine.textContent = triggerText(event);
    if (animate) {
      dom.resultPanel.classList.remove("is-hot");
      void dom.resultPanel.offsetWidth;
      dom.resultPanel.classList.add("is-hot");
    }
  }

  function triggerText(event) {
    if (!event) {
      return state.netlifyMode
        ? "Waiting for donation, bits, sub, member, super sticker, or manual trigger."
        : "Wheel online. Waiting for the next fearless support trigger.";
    }
    const source = cleanText(event.source || "support", 22).replace(/-/g, " ");
    const name = cleanText(event.name || "Viewer", 24);
    const reason = cleanText(event.reason || "Spin", 40);
    return `Triggered by ${name} via ${source}: ${reason}`;
  }

  function resolvePick(pick) {
    if (Number.isInteger(pick) && pick >= 0 && pick < state.items.length) return pick;
    if (typeof pick === "string") {
      const wanted = pick.toLowerCase();
      const found = state.items.findIndex((item) => {
        return item.key.toLowerCase() === wanted || item.label.toLowerCase() === wanted || item.title.toLowerCase() === wanted;
      });
      if (found >= 0) return found;
    }

    const total = state.items.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * total;
    for (let index = 0; index < state.items.length; index += 1) {
      roll -= state.items[index].weight;
      if (roll <= 0) return index;
    }
    return state.items.length - 1;
  }

  function drawWheel() {
    const ctx = wheelCtx;
    const size = Math.min(state.width, state.height);
    const cx = state.width / 2;
    const cy = state.height / 2;
    const radius = size * 0.43;
    const inner = radius * 0.18;
    const sector = TAU / state.items.length;

    ctx.clearRect(0, 0, state.width, state.height);
    ctx.save();
    ctx.translate(cx, cy);
    drawOuterRings(ctx, radius);

    for (let index = 0; index < state.items.length; index += 1) {
      const item = state.items[index];
      const start = state.rotation + index * sector;
      const end = start + sector;
      drawSector(ctx, item, start, end, radius, inner, index);
    }

    drawInnerRings(ctx, radius, inner);
    ctx.restore();
  }

  function drawOuterRings(ctx, radius) {
    ctx.save();
    const glow = ctx.createRadialGradient(0, 0, radius * 0.28, 0, 0, radius * 1.22);
    glow.addColorStop(0, "rgba(24, 216, 255, 0)");
    glow.addColorStop(0.74, "rgba(24, 216, 255, 0.22)");
    glow.addColorStop(0.92, "rgba(255, 43, 214, 0.12)");
    glow.addColorStop(1, "rgba(255, 43, 214, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.2, 0, TAU);
    ctx.fill();

    for (const ring of [
      { r: 1.025, width: 6, color: "rgba(24, 216, 255, 0.94)" },
      { r: 0.965, width: 2, color: "rgba(255, 255, 255, 0.74)" },
      { r: 0.89, width: 2, color: "rgba(255, 43, 214, 0.52)" }
    ]) {
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = ring.width * state.dpr;
      ctx.beginPath();
      ctx.arc(0, 0, radius * ring.r, 0, TAU);
      ctx.stroke();
    }

    for (let i = 0; i < 96; i += 1) {
      const angle = (i / 96) * TAU + state.rotation * 0.16;
      const long = i % 6 === 0;
      const r1 = radius * (long ? 1.035 : 1.016);
      const r2 = radius * (long ? 1.092 : 1.05);
      ctx.strokeStyle = long ? "rgba(255, 209, 102, 0.78)" : "rgba(24, 216, 255, 0.4)";
      ctx.lineWidth = (long ? 2 : 1) * state.dpr;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * r1, Math.sin(angle) * r1);
      ctx.lineTo(Math.cos(angle) * r2, Math.sin(angle) * r2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSector(ctx, item, start, end, radius, inner, index) {
    const mid = (start + end) / 2;
    const color = item.color;
    const accent = item.accent || color;
    const selected = !state.spinning && index === state.selectedIndex;
    const gradient = ctx.createRadialGradient(0, 0, inner, 0, 0, radius);
    gradient.addColorStop(0, rgba(color, selected ? 0.58 : 0.42));
    gradient.addColorStop(0.62, rgba(color, selected ? 0.34 : 0.22));
    gradient.addColorStop(1, "rgba(5, 14, 28, 0.92)");

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(Math.cos(start) * inner, Math.sin(start) * inner);
    ctx.arc(0, 0, radius, start, end);
    ctx.lineTo(Math.cos(end) * inner, Math.sin(end) * inner);
    ctx.arc(0, 0, inner, end, start, true);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = rgba(accent, 0.82);
    ctx.lineWidth = 2 * state.dpr;
    ctx.stroke();

    drawSectorIcon(ctx, item, mid, radius);
    drawSectorLabel(ctx, item, mid, radius);
    drawSectorChance(ctx, item, mid, radius);
    ctx.restore();
  }

  function drawSectorIcon(ctx, item, angle, radius) {
    const image = item.icon ? state.icons.get(item.icon) : null;
    const iconSize = radius * 0.135;
    const iconRadius = radius * 0.58;
    const x = Math.cos(angle) * iconRadius;
    const y = Math.sin(angle) * iconRadius;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);
    ctx.globalAlpha = 0.98;
    if (image && image.complete && image.naturalWidth) {
      ctx.shadowColor = rgba(item.accent || item.color, 0.76);
      ctx.shadowBlur = 18 * state.dpr;
      ctx.drawImage(image, -iconSize / 2, -iconSize / 2, iconSize, iconSize);
    } else {
      ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
      ctx.font = `${Math.round(iconSize * 0.62)}px Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(item.label.slice(0, 1), 0, 0);
    }
    ctx.restore();
  }

  function drawSectorLabel(ctx, item, angle, radius) {
    const labelRadius = radius * 0.77;
    const x = Math.cos(angle) * labelRadius;
    const y = Math.sin(angle) * labelRadius;
    const fontSize = Math.max(10 * state.dpr, radius * 0.04);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillStyle = "rgba(246, 251, 255, 0.96)";
    ctx.strokeStyle = "rgba(2, 7, 16, 0.9)";
    ctx.lineWidth = 4 * state.dpr;
    ctx.font = `900 ${fontSize}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lines = labelLines(item.label);
    lines.forEach((line, index) => {
      const yOffset = (index - (lines.length - 1) / 2) * fontSize * 1.08;
      ctx.strokeText(line, 0, yOffset);
      ctx.fillText(line, 0, yOffset);
    });
    ctx.restore();
  }

  function drawSectorChance(ctx, item, angle, radius) {
    const chanceRadius = radius * 0.91;
    const x = Math.cos(angle) * chanceRadius;
    const y = Math.sin(angle) * chanceRadius;
    const fontSize = Math.max(8 * state.dpr, radius * 0.026);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillStyle = item.key === "mystery" ? "rgba(244, 199, 72, 0.98)" : "rgba(158, 239, 255, 0.9)";
    ctx.strokeStyle = "rgba(2, 7, 16, 0.9)";
    ctx.lineWidth = 3 * state.dpr;
    ctx.font = `900 ${fontSize}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const text = `${formatChance(item.chance)}%`;
    ctx.strokeText(text, 0, 0);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  function drawInnerRings(ctx, radius, inner) {
    ctx.save();
    ctx.fillStyle = "rgba(5, 14, 28, 0.88)";
    ctx.beginPath();
    ctx.arc(0, 0, inner * 1.45, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.74)";
    ctx.lineWidth = 2 * state.dpr;
    ctx.stroke();
    ctx.strokeStyle = "rgba(24, 216, 255, 0.72)";
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.34, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  function playTickIfNeeded(now) {
    const sector = TAU / state.items.length;
    const pointerLocal = normalizeAngle(POINTER_ANGLE - state.rotation);
    const current = Math.floor(pointerLocal / sector);
    const minimumGap = state.reduced || state.config.reducedPerformance ? 55 : 22;
    if (current !== state.lastTickSector && now - state.lastTickAt > minimumGap) {
      state.lastTickSector = current;
      state.lastTickAt = now;
      state.sound.play("tick");
    }
  }

  function spawnAmbientSpark() {
    if (!state.config.particles || state.particles.length >= particleLimit()) return;
    spawnRingParticle(0.05, 0.14);
  }

  function spawnSpinSpark() {
    if (!state.config.particles || state.particles.length >= particleLimit()) return;
    const burst = state.config.reducedPerformance ? 2 : 5;
    for (let i = 0; i < burst; i += 1) {
      spawnRingParticle(0.26, 0.78, true);
    }
  }

  function spawnRingParticle(minSpeed, maxSpeed, tronTrail) {
    const rect = dom.wheel.getBoundingClientRect();
    const root = dom.particles.getBoundingClientRect();
    const cx = (rect.left - root.left + rect.width / 2) * state.dpr;
    const cy = (rect.top - root.top + rect.height / 2) * state.dpr;
    const radius = Math.min(rect.width, rect.height) * 0.48 * state.dpr;
    const angle = Math.random() * TAU;
    const speed = minSpeed + Math.random() * maxSpeed;
    const tangent = angle + Math.PI / 2 + (Math.random() > 0.5 ? 0.32 : -0.32);
    const outward = 0.09 + Math.random() * 0.16;
    const colorRoll = Math.random();
    const color = colorRoll > 0.72 ? "#f6fbff" : colorRoll > 0.38 ? state.config.colors.accent : state.config.colors.hot;
    addParticle({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      vx: (Math.cos(tangent) * speed + Math.cos(angle) * outward) * state.dpr,
      vy: (Math.sin(tangent) * speed + Math.sin(angle) * outward) * state.dpr,
      life: (tronTrail ? 520 : 340) + Math.random() * 420,
      size: (tronTrail ? 1.2 : 1.4) + Math.random() * (tronTrail ? 2.6 : 3.4),
      color,
      trail: Boolean(tronTrail)
    });
  }

  function spawnStartBurst() {
    if (state.reduced || !state.config.particles) return;
    for (let i = 0; i < 34; i += 1) spawnRingParticle(0.25, 0.72, true);
  }

  function spawnResultBurst() {
    const rect = dom.wheel.getBoundingClientRect();
    const root = dom.particles.getBoundingClientRect();
    const cx = (rect.left - root.left + rect.width / 2) * state.dpr;
    const cy = (rect.top - root.top + rect.height / 2) * state.dpr;
    const color = state.items[state.selectedIndex].color || state.config.colors.accent;
    const count = Math.min(96, particleLimit() - state.particles.length);
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * TAU + Math.random() * 0.14;
      const speed = (0.25 + Math.random() * 0.58) * state.dpr;
      addParticle({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 760 + Math.random() * 480,
        size: 2 + Math.random() * 4.4,
        color: i % 3 === 0 ? state.config.colors.gold : color,
        trail: i % 2 === 0
      });
    }
  }

  function addParticle(particle) {
    if (state.particles.length >= particleLimit()) state.particles.shift();
    state.particles.push({
      ...particle,
      px: particle.x,
      py: particle.y,
      age: 0,
      maxLife: particle.life
    });
  }

  function updateParticles(dt) {
    for (const particle of state.particles) {
      particle.age += dt;
      particle.px = particle.x;
      particle.py = particle.y;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= particle.trail ? 0.988 : 0.992;
      particle.vy *= particle.trail ? 0.988 : 0.992;
    }
    state.particles = state.particles.filter((particle) => particle.age < particle.maxLife);
  }

  function drawParticles() {
    const ctx = particleCtx;
    ctx.clearRect(0, 0, state.particleWidth, state.particleHeight);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const particle of state.particles) {
      const t = 1 - particle.age / particle.maxLife;
      ctx.globalAlpha = clamp(t, 0, 1);
      ctx.fillStyle = particle.color;
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = particle.trail ? 22 * state.dpr : 16 * state.dpr;
      if (particle.trail) {
        ctx.strokeStyle = particle.color;
        ctx.lineWidth = Math.max(1, particle.size * 0.72) * state.dpr;
        ctx.beginPath();
        ctx.moveTo(particle.px, particle.py);
        ctx.lineTo(particle.x, particle.y);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * state.dpr * (0.4 + t), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function particleLimit() {
    const configured = Number(state.config.maxParticles) || DEFAULT_CONFIG.maxParticles;
    return state.reduced || state.config.reducedPerformance ? Math.min(48, configured) : Math.min(320, configured);
  }

  function updateRuntimeConfig(config) {
    if (!config || typeof config !== "object") return;
    const next = deepMerge(state.config, config);
    applyConfig(next);
    state.selectedIndex = Math.min(state.selectedIndex, state.items.length - 1);
    revealResult(Math.max(0, state.selectedIndex), state.pendingEvent, false);
    if (!state.spinning && state.config.hideWhenIdle && !shouldStartVisible()) {
      scheduleAutoHide(250);
    }
  }

  function setOverlayVisible(visible, immediate) {
    if (!dom.root) return;
    window.clearTimeout(state.hideTimer);
    dom.root.classList.toggle("is-hidden", !visible);
    dom.root.classList.toggle("is-live", visible);
    if (immediate) {
      dom.root.classList.toggle("is-instant", true);
      window.setTimeout(() => dom.root.classList.remove("is-instant"), 40);
    }
  }

  function isOverlayHidden() {
    return Boolean(dom.root && dom.root.classList.contains("is-hidden"));
  }

  function scheduleAutoHide(delay) {
    if (!state.config.hideWhenIdle) return;
    if (params.get("visible") === "1" || params.get("setup") === "1" || params.get("demo") === "1") return;
    const hold = Number.isFinite(Number(delay)) ? Number(delay) : Number(state.config.hideAfterResultMs) || 15000;
    window.clearTimeout(state.hideTimer);
    state.hideTimer = window.setTimeout(() => {
      if (!state.spinning && !state.queue.length) setOverlayVisible(false);
    }, Math.max(0, hold));
  }

  function demoEvent() {
    return {
      id: `demo-${Date.now()}`,
      source: "manual-test",
      name: "Timur",
      reason: "Demo spin",
      at: new Date().toISOString()
    };
  }

  function deepMerge(base, extra) {
    if (!extra || typeof extra !== "object") return base;
    const merged = { ...base };
    for (const [key, value] of Object.entries(extra)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        merged[key] = deepMerge(base[key] || {}, value);
      } else {
        merged[key] = value;
      }
    }
    return merged;
  }

  function rgba(hex, alpha) {
    const parsed = parseHex(hex);
    return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${alpha})`;
  }

  function parseHex(hex) {
    const fallback = { r: 24, g: 216, b: 255 };
    if (typeof hex !== "string") return fallback;
    const clean = hex.replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(clean)) return fallback;
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16)
    };
  }

  function colorFor(index) {
    return ["#7dff6a", "#18d8ff", "#ffd166", "#7c5cff", "#00f5d4", "#ff2bd6"][index % 6];
  }

  function formatChance(value) {
    const number = Number(value) || 0;
    return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  }

  function labelLines(label) {
    const manual = String(label || "")
      .split(/\n+/)
      .map((line) => cleanText(line, 14).toUpperCase())
      .filter(Boolean);
    if (manual.length > 1) return manual.slice(0, 2);
    const words = cleanText(label, 22).toUpperCase().split(/\s+/).filter(Boolean);
    if (words.length <= 1) return [words[0] || "SPIN"];
    if (words.length === 2) return words;
    return [words.slice(0, 2).join(" "), words.slice(2).join(" ")].filter(Boolean);
  }

  function cleanLabel(value, limit) {
    return String(value || "")
      .replace(/\\n/g, "\n")
      .replace(/[^\S\n]+/g, " ")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n")
      .slice(0, limit);
  }

  function cleanText(value, limit) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit);
  }

  function resolveIconPath(icon) {
    if (typeof icon !== "string" || !icon.trim()) return "";
    const value = icon.trim();
    if (/^(https?:|data:|\.\/|\/|assets\/)/i.test(value)) return value;
    return `assets/icons/${value}.svg`;
  }

  function isColor(value) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
  }

  function normalizeAngle(angle) {
    return ((angle % TAU) + TAU) % TAU;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
  }

  function easeOutQuint(t) {
    return 1 - Math.pow(1 - t, 5);
  }
})();
