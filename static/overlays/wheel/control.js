(function () {
  "use strict";

  const STORAGE_KEY = "timur-fearless-wheel-config-v3";
  const OBS_URL = "https://fortunewheel2.netlify.app/overlays/wheel/";
  const dom = {
    iframe: document.getElementById("wheelPreview"),
    list: document.getElementById("challengeList"),
    template: document.getElementById("challengeTemplate"),
    status: document.getElementById("statusLine"),
    spinDurationMs: document.getElementById("spinDurationMs"),
    hideAfterResultMs: document.getElementById("hideAfterResultMs"),
    soundVolume: document.getElementById("soundVolume"),
    muted: document.getElementById("muted"),
    oddsSummary: document.getElementById("oddsSummary"),
    balanceOdds: document.getElementById("balanceOdds"),
    sendConfig: document.getElementById("sendConfig"),
    demoSpin: document.getElementById("demoSpin"),
    saveLocal: document.getElementById("saveLocal"),
    exportConfig: document.getElementById("exportConfig"),
    resetLocal: document.getElementById("resetLocal"),
    addChallenge: document.getElementById("addChallenge"),
    copyObsUrl: document.getElementById("copyObsUrl")
  };

  const state = {
    baseConfig: null,
    config: null,
    channel: "BroadcastChannel" in window ? new BroadcastChannel("fearless-wheel") : null
  };

  init();

  async function init() {
    try {
      const response = await fetch("./config.json", { cache: "no-store" });
      state.baseConfig = await response.json();
      const saved = readLocalConfig();
      state.config = deepMerge(state.baseConfig, saved || {});
      bindControls();
      render();
      sendConfigToPreview();
      setStatus(saved ? "Loaded local editor config." : "Loaded config.json.");
    } catch (error) {
      setStatus("Could not load config.json.");
    }
  }

  function bindControls() {
    dom.spinDurationMs.addEventListener("input", () => {
      state.config.spinDurationMs = numberValue(dom.spinDurationMs.value, 8200);
      sendConfigToPreview();
    });
    dom.hideAfterResultMs.addEventListener("input", () => {
      state.config.hideAfterResultMs = numberValue(dom.hideAfterResultMs.value, 15000);
      sendConfigToPreview();
    });
    dom.soundVolume.addEventListener("input", () => {
      state.config.sound = state.config.sound || {};
      state.config.sound.volume = numberValue(dom.soundVolume.value, 0.48);
      sendConfigToPreview();
    });
    dom.muted.addEventListener("change", () => {
      state.config.muted = Boolean(dom.muted.checked);
      sendConfigToPreview();
    });
    dom.sendConfig.addEventListener("click", () => {
      sendConfigToPreview();
      setStatus("Preview refreshed.");
    });
    dom.balanceOdds.addEventListener("click", () => {
      balanceOdds();
      renderChallenges();
      renderOdds();
      sendConfigToPreview();
      setStatus("Mystery set to 1%; all other tasks balanced evenly.");
    });
    dom.demoSpin.addEventListener("click", () => {
      sendConfigToPreview();
      sendSpin();
      setStatus("Demo spin sent.");
    });
    dom.saveLocal.addEventListener("click", () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config, null, 2));
      setStatus("Local editor config saved in this browser.");
    });
    dom.exportConfig.addEventListener("click", exportConfig);
    dom.resetLocal.addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEY);
      state.config = structuredClone(state.baseConfig);
      render();
      sendConfigToPreview();
      setStatus("Reset to config.json.");
    });
    dom.addChallenge.addEventListener("click", () => {
      const challenges = ensureChallenges();
      challenges.push({
        key: `task_${challenges.length + 1}`,
        label: "NEW\nTASK",
        title: "NEW TASK",
        desc: "Add a short safe IRL task.",
        icon: "bolt",
        color: "#18d8ff",
        chance: 1
      });
      render();
      sendConfigToPreview();
      setStatus("Task added.");
    });
    dom.copyObsUrl.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(OBS_URL);
        setStatus("OBS URL copied.");
      } catch (error) {
        setStatus(OBS_URL);
      }
    });
    dom.iframe.addEventListener("load", sendConfigToPreview);
  }

  function render() {
    dom.spinDurationMs.value = state.config.spinDurationMs || 8200;
    dom.hideAfterResultMs.value = state.config.hideAfterResultMs || 15000;
    dom.soundVolume.value = state.config.sound && Number.isFinite(Number(state.config.sound.volume)) ? state.config.sound.volume : 0.48;
    dom.muted.checked = Boolean(state.config.muted);
    renderChallenges();
    renderOdds();
  }

  function renderChallenges() {
    dom.list.textContent = "";
    ensureChallenges().forEach((challenge, index) => {
      const node = dom.template.content.firstElementChild.cloneNode(true);
      node.querySelector("[data-title]").textContent =
        `${index + 1}. ${challenge.title || challenge.label || "TASK"} - ${formatChance(challenge.chance)}%`;
      node.querySelectorAll("[data-field]").forEach((input) => {
        const field = input.dataset.field;
        input.value = challenge[field] ?? "";
        input.addEventListener("input", () => {
          challenge[field] = field === "chance" ? numberValue(input.value, 0.01) : input.value;
          node.querySelector("[data-title]").textContent =
            `${index + 1}. ${challenge.title || challenge.label || "TASK"} - ${formatChance(challenge.chance)}%`;
          renderOdds();
          sendConfigToPreview();
        });
      });
      node.querySelector("[data-move-up]").addEventListener("click", () => moveChallenge(index, -1));
      node.querySelector("[data-move-down]").addEventListener("click", () => moveChallenge(index, 1));
      node.querySelector("[data-remove]").addEventListener("click", () => removeChallenge(index));
    dom.list.appendChild(node);
    });
  }

  function renderOdds() {
    const challenges = ensureChallenges();
    const total = challenges.reduce((sum, challenge) => sum + numberValue(challenge.chance, 0), 0);
    dom.oddsSummary.textContent = "";
    challenges.forEach((challenge) => {
      const chip = document.createElement("div");
      chip.className = `odds-chip${challenge.key === "mystery" ? " is-mystery" : ""}`;
      const name = document.createElement("strong");
      const chance = document.createElement("span");
      name.textContent = challenge.title || challenge.label || "Task";
      chance.textContent = `${formatChance(challenge.chance)}%`;
      chip.append(name, chance);
      dom.oddsSummary.appendChild(chip);
    });
    const totalLine = document.createElement("div");
    totalLine.className = `odds-total${Math.abs(total - 100) > 0.001 ? " is-invalid" : ""}`;
    totalLine.textContent = `Total chance: ${formatChance(total)}%${Math.abs(total - 100) > 0.001 ? " - use Balance Odds" : ""}`;
    dom.oddsSummary.appendChild(totalLine);
  }

  function balanceOdds() {
    const challenges = ensureChallenges();
    const mystery = challenges.find((challenge) => challenge.key === "mystery");
    const regular = challenges.filter((challenge) => challenge.key !== "mystery");
    const regularChance = regular.length ? 99 / regular.length : 0;
    regular.forEach((challenge) => {
      challenge.chance = Number(regularChance.toFixed(4));
    });
    if (mystery) mystery.chance = 1;
  }

  function moveChallenge(index, direction) {
    const challenges = ensureChallenges();
    const target = index + direction;
    if (target < 0 || target >= challenges.length) return;
    const [item] = challenges.splice(index, 1);
    challenges.splice(target, 0, item);
    renderChallenges();
    renderOdds();
    sendConfigToPreview();
    setStatus("Task order changed.");
  }

  function removeChallenge(index) {
    const challenges = ensureChallenges();
    if (challenges.length <= 2) {
      setStatus("Keep at least two tasks.");
      return;
    }
    challenges.splice(index, 1);
    renderChallenges();
    renderOdds();
    sendConfigToPreview();
    setStatus("Task removed.");
  }

  function sendConfigToPreview() {
    if (!state.config) return;
    const payload = { type: "fearless-wheel:config", config: cloneConfig() };
    dom.iframe.contentWindow && dom.iframe.contentWindow.postMessage(payload, "*");
    state.channel && state.channel.postMessage({ type: "config", config: cloneConfig() });
  }

  function sendSpin() {
    const payload = {
      type: "fearless-wheel:spin",
      event: {
        id: `control-${Date.now()}`,
        source: "control-demo",
        name: "Timur",
        reason: "Control spin",
        at: new Date().toISOString()
      }
    };
    dom.iframe.contentWindow && dom.iframe.contentWindow.postMessage(payload, "*");
    state.channel && state.channel.postMessage({ type: "spin", event: payload.event });
  }

  function exportConfig() {
    const blob = new Blob([JSON.stringify(state.config, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "config.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("config.json exported.");
  }

  function ensureChallenges() {
    if (!Array.isArray(state.config.challenges)) state.config.challenges = [];
    return state.config.challenges;
  }

  function readLocalConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function cloneConfig() {
    return structuredClone(state.config);
  }

  function deepMerge(base, extra) {
    if (!extra || typeof extra !== "object") return structuredClone(base);
    const merged = Array.isArray(base) ? [...base] : { ...base };
    for (const [key, value] of Object.entries(extra)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        merged[key] = deepMerge(base && base[key] ? base[key] : {}, value);
      } else {
        merged[key] = value;
      }
    }
    return merged;
  }

  function numberValue(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function formatChance(value) {
    const number = numberValue(value, 0);
    return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  }

  function setStatus(message) {
    dom.status.textContent = message;
  }
})();
