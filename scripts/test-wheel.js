const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const config = require("../config.json");
const shared = require("../netlify/functions/_shared");

const root = path.resolve(__dirname, "..");
const filesToCheck = [
  "server.js",
  "scripts/prepare-public.js",
  "public/overlays/wheel/overlay.js",
  "public/overlays/wheel/control.js",
  "static/overlays/wheel/overlay.js",
  "static/overlays/wheel/control.js",
  "netlify/functions/_shared.js",
  "netlify/functions/config.js",
  "netlify/functions/state.js",
  "netlify/functions/trigger.js",
  "netlify/functions/donation.js",
  "netlify/functions/stream-event.js",
  "netlify/functions/twitch-eventsub.js"
];

for (const file of filesToCheck) {
  execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "pipe" });
}

assert(Array.isArray(config.challenges), "config.challenges must be an array");
assert(config.challenges.length >= 8, "wheel should have enough sectors for stream variety");
assert.strictEqual(config.wheel.sound, true, "wheel sound should be enabled by default");
assert(config.wheel.soundVolume > 0 && config.wheel.soundVolume <= 1, "wheel sound volume should be normalized");
assert.strictEqual(config.donations.minAmountEur, 5, "donation trigger should start from 5 EUR");
assert.strictEqual(config.twitch.minRewardCost, 50000, "channel-points trigger should cost 50000 points");
assert.strictEqual(config.twitch.minBits, 500, "bits trigger should start from 500 bits");
assert.strictEqual(config.twitch.triggerOnSubs, true, "subs should trigger the wheel");
assert.strictEqual(config.streamEvents.minAmountEur, 5, "generic stream event trigger should start from 5 EUR");
assert.strictEqual(config.streamEvents.minBits, 500, "generic stream event bits trigger should start from 500 bits");

for (const challenge of config.challenges) {
  assert(/^[A-Za-z0-9-]+$/.test(challenge.label), `sector label must be one English word: ${challenge.label}`);
  assert(challenge.title && /^[\x00-\x7F]+$/.test(challenge.title), `title must be English/ASCII: ${challenge.label}`);
  assert(challenge.description && /^[\x00-\x7F]+$/.test(challenge.description), `description must be English/ASCII: ${challenge.label}`);
}

const normalized = shared.normalizedChallenges(config);
assert.strictEqual(normalized.length, config.challenges.length, "normalization should keep all challenges");
assert.strictEqual(normalized.find((challenge) => challenge.label === "Mystery").weight, 1, "Mystery chance should be 1%");
assert.strictEqual(normalized.find((challenge) => challenge.label === "Hydrate").weight, 8.25, "Hydrate should use the normal chance");
assert.strictEqual(
  normalized.reduce((sum, challenge) => sum + challenge.weight, 0),
  100,
  "challenge weights should total 100%"
);

const originalRandom = Math.random;
try {
  const totalWeight = normalized.reduce((sum, challenge) => sum + challenge.weight, 0);
  let cumulativeWeight = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    Math.random = () => (cumulativeWeight + normalized[index].weight / 2) / totalWeight;
    const picked = shared.pickChallenge(config);
    assert.strictEqual(picked.index, index, `weighted random bucket should map to sector ${index}`);
    cumulativeWeight += normalized[index].weight;
  }
} finally {
  Math.random = originalRandom;
}

const sampleChallenge = normalized[0];
const chatMessage = shared.buildChatMessage(config, sampleChallenge);
assert(chatMessage.includes(sampleChallenge.title), "chat message should include the full title");
assert(chatMessage.includes(sampleChallenge.description), "chat message should include the full description");
assert(chatMessage.includes(sampleChallenge.duration), "chat message should include the duration");

const rootIndex = fs.readFileSync(path.join(root, "static/index.html"), "utf8");
const rootDemo = fs.readFileSync(path.join(root, "static/demo.html"), "utf8");
const rootControl = fs.readFileSync(path.join(root, "static/control.html"), "utf8");
const redirects = fs.readFileSync(path.join(root, "static/_redirects"), "utf8");
assert(rootIndex.includes("/overlays/wheel/control.html"), "root page should open the current control page");
assert(rootDemo.includes("/overlays/wheel/control.html"), "legacy demo page should open the current control page");
assert(rootControl.includes("/overlays/wheel/control.html"), "legacy control page should open the current control page");
assert(redirects.includes("/demo.html"), "Netlify redirects should replace the legacy demo URL");
assert(!fs.existsSync(path.join(root, "static/demo.js")), "legacy demo JavaScript should be removed from publish output");
assert(!fs.existsSync(path.join(root, "static/styles.css")), "legacy root styles should be removed from publish output");

const overlayJs = fs.readFileSync(path.join(root, "static/overlays/wheel/overlay.js"), "utf8");
const overlayHtml = fs.readFileSync(path.join(root, "static/overlays/wheel/index.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "static/overlays/wheel/styles.css"), "utf8");
const controlJs = fs.readFileSync(path.join(root, "static/overlays/wheel/control.js"), "utf8");
const controlHtml = fs.readFileSync(path.join(root, "static/overlays/wheel/control.html"), "utf8");
const overlayConfig = JSON.parse(fs.readFileSync(path.join(root, "static/overlays/wheel/config.json"), "utf8"));
assert(overlayJs.includes("playTickIfNeeded"), "overlay should play sector tick sounds");
assert(overlayJs.includes("scheduleAutoHide"), "overlay should hide after the result");
assert(overlayJs.includes("drawSectorChance"), "overlay should show configured chance percentages");
assert(overlayHtml.includes("<span>GO</span>"), "wheel hub should show GO");
assert(overlayHtml.includes("challenge-card"), "overlay should keep the current challenge result");
assert(!overlayHtml.includes("masthead"), "overlay should not include the stream title header");
assert(!overlayHtml.includes("about-panel"), "overlay should not include the About Timur panel");
assert(!overlayHtml.includes("trigger-card"), "overlay should not include the trigger information panel");
assert(!overlayHtml.includes("bottom-strip"), "overlay should not include the bottom information strip");
assert(!overlayHtml.includes("map-chip"), "overlay should not include the Finland badge");
assert(styles.includes("background: transparent"), "OBS overlay should use a transparent browser background");
assert(styles.includes(".overlay-root.is-hidden"), "OBS overlay should support hidden idle state");
assert(controlJs.includes("balanceOdds"), "control page should rebalance challenge percentages");
assert(controlHtml.includes("wheelPreview"), "control page should embed the current wheel preview");
assert.strictEqual(overlayConfig.hideWhenIdle, true, "normal OBS URL should be hidden while idle");
assert.strictEqual(overlayConfig.hideAfterResultMs, 15000, "OBS overlay should hide 15 seconds after result");
assert.strictEqual(overlayConfig.challenges.length, 13, "overlay should include all current challenges");

const headers = fs.readFileSync(path.join(root, "static/_headers"), "utf8");
assert(headers.includes("Content-Security-Policy"), "Netlify headers should include CSP");
assert(headers.includes("X-Frame-Options: SAMEORIGIN"), "Netlify headers should restrict framing");
assert(headers.includes("X-Content-Type-Options: nosniff"), "Netlify headers should prevent MIME sniffing");
assert(headers.includes("Permissions-Policy"), "Netlify headers should disable unused browser permissions");

console.log("Fortune wheel tests passed.");
