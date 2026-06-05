const overlayFrame = document.getElementById("demoOverlay");
const demoPreview = document.getElementById("demoPreview");
const demoStatus = document.getElementById("demoStatus");
const chatEcho = document.getElementById("chatEcho");
const demoHistory = document.getElementById("demoHistory");
const history = [];
const STREAM_WIDTH = 1920;
const STREAM_HEIGHT = 1080;

resizeDemoViewport();
window.addEventListener("resize", resizeDemoViewport);

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-demo-source]");
  if (!button) return;
  const allowedSources = new Set(["twitch-points", "donation", "twitch-sub"]);
  if (!allowedSources.has(button.dataset.demoSource)) return;

  overlayFrame.contentWindow?.postMessage(
    {
      type: "fortune-wheel-demo-spin",
      source: button.dataset.demoSource,
      reason: button.dataset.demoReason,
      name: "Demo viewer",
      amount: button.dataset.demoSource === "donation" ? 5 : null,
      currency: button.dataset.demoSource === "donation" ? "EUR" : null
    },
    window.location.origin
  );
  demoStatus.textContent = "spinning";
});

function resizeDemoViewport() {
  const rect = demoPreview.getBoundingClientRect();
  const scale = Math.min(rect.width / STREAM_WIDTH, rect.height / STREAM_HEIGHT);
  const left = Math.max(0, (rect.width - STREAM_WIDTH * scale) / 2);
  const top = Math.max(0, (rect.height - STREAM_HEIGHT * scale) / 2);
  overlayFrame.style.setProperty("--demo-scale", String(scale));
  overlayFrame.style.setProperty("--demo-left", `${left}px`);
  overlayFrame.style.setProperty("--demo-top", `${top}px`);
}

window.addEventListener("message", (message) => {
  if (message.origin !== window.location.origin) return;

  if (message.data?.type === "fortune-wheel-demo-ready") {
    demoStatus.textContent = "overlay ready";
    return;
  }

  if (message.data?.type === "fortune-wheel-demo-result") {
    const event = message.data.event;
    chatEcho.textContent = event.chatMessage;
    demoStatus.textContent = "result ready";
    history.unshift(event);
    renderHistory();
  }
});

function renderHistory() {
  demoHistory.innerHTML = history
    .slice(0, 5)
    .map((event) => {
      const time = new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `<li><strong>${escapeHtml(event.challenge.label)}</strong> - ${escapeHtml(event.reason)} | ${time}</li>`;
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
