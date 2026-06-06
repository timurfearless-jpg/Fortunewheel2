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
  "static/overlay.js",
  "static/control.js",
  "static/demo.js",
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

const demoHtml = fs.readFileSync(path.join(root, "static/demo.html"), "utf8");
assert(demoHtml.includes("/overlay.html?demo=1&layout=center"), "demo page should embed centered overlay demo mode");
assert(demoHtml.includes("data-demo-source=\"twitch-points\""), "demo page should preview channel-points spins");
assert(demoHtml.includes("data-demo-source=\"donation\""), "demo page should preview donation spins");
assert(demoHtml.includes("data-demo-source=\"twitch-sub\""), "demo page should preview sub spins");
assert(demoHtml.includes("allow=\"autoplay\""), "demo iframe should allow overlay audio preview");
assert(!demoHtml.includes("stream-scene"), "demo page should not use a fake stream screenshot scene");

const overlayJs = fs.readFileSync(path.join(root, "static/overlay.js"), "utf8");
assert(!overlayJs.includes("drawMapTexture"), "wheel canvas should not render map-style texture");
assert(overlayJs.includes("drawWheelRims"), "wheel canvas should render game HUD rims");
assert(overlayJs.includes("drawSectorIcon"), "wheel sectors should render icons instead of text labels");
assert(overlayJs.includes("resultIconSvg"), "result panel should render the selected challenge icon");
assert(overlayJs.includes("iconPalette"), "wheel icons should use colored palettes");
assert(overlayJs.includes("hexToRgba"), "wheel canvas should render neon rgba glows from palette colors");
assert(overlayJs.includes("fortuneGlow"), "READY icon should use a colorful fortune graphic");
assert(!overlayJs.includes("strokeText"), "wheel sectors should not render text labels");
assert(!overlayJs.includes("fillText"), "wheel sectors should not render text labels");
assert(overlayJs.includes("playTickSound"), "overlay should play sector tick sounds");
assert(overlayJs.includes("playResultSound"), "overlay should play result sound");

const overlayHtml = fs.readFileSync(path.join(root, "static/overlay.html"), "utf8");
assert(!overlayHtml.includes("OBS Browser Source"), "overlay should not show OBS Browser Source text");
assert(!overlayHtml.includes("light IRL challenges"), "overlay should use shorter idle copy");
assert(!overlayHtml.includes("no-cringe"), "overlay idle copy should not mention cringe");
assert(!overlayHtml.includes("TIMUR IRL"), "overlay title should be shorter");
assert(!overlayHtml.includes("MAP WHEEL"), "overlay subtitle should be shorter");
assert(overlayHtml.includes("5+ EUR donation"), "overlay should show donation trigger condition");
assert(overlayHtml.includes(">Sub<"), "overlay should show sub trigger condition");
assert(overlayHtml.includes("50,000 channel points"), "overlay should show channel-points trigger condition");
assert(overlayHtml.includes("Fortune wheel challenge"), "overlay idle copy should say Fortune wheel challenge");
assert(overlayHtml.includes(">SPIN<"), "wheel hub should keep a compact spin label");

const styles = fs.readFileSync(path.join(root, "static/styles.css"), "utf8");
assert(styles.includes("@media (max-width: 700px)"), "styles should include mobile layout rules");
assert(styles.includes("@media (max-width: 380px)"), "styles should include narrow-phone layout rules");
assert(styles.includes("width: 1920px"), "demo overlay should render at stream width before scaling");
assert(styles.includes("height: 1080px"), "demo overlay should render at stream height before scaling");
assert(!styles.includes(".stream-scene"), "demo styles should not include fake stream scene styling");
assert(styles.includes(".layout-hud .wheel-stage"), "overlay should include compact HUD layout");
assert(styles.includes(".layout-center .wheel-stage"), "overlay should include centered high-quality layout");
assert(styles.includes("@keyframes scanSweep"), "overlay should include wheel sweep animation");
assert(styles.includes("@keyframes pointerTick"), "overlay should include pointer tick animation");
assert(styles.includes("@keyframes iconDrop"), "overlay should animate the result icon drop");
assert(styles.includes("@keyframes iconReadyPulse"), "READY icon should have idle animation");
assert(styles.includes(".overlay-page .brand-lockup"), "overlay should hide extra top labels");
assert(!styles.includes(".overlay-page .result-meta"), "overlay should not hide trigger conditions");
assert(styles.includes("clip-path: polygon(22px 0"), "result panel should use an angular cyber frame");
assert(styles.includes("rgba(24, 216, 255"), "overlay should use cyan neon HUD styling");

const demoJs = fs.readFileSync(path.join(root, "static/demo.js"), "utf8");
assert(demoJs.includes("STREAM_WIDTH = 1920"), "demo script should use fixed stream preview width");
assert(demoJs.includes("STREAM_HEIGHT = 1080"), "demo script should use fixed stream preview height");

const controlJs = fs.readFileSync(path.join(root, "static/control.js"), "utf8");
assert(controlJs.includes("/overlay.html?layout=center"), "control panel should copy the centered overlay URL by default");

const headers = fs.readFileSync(path.join(root, "static/_headers"), "utf8");
assert(headers.includes("Content-Security-Policy"), "Netlify headers should include CSP");
assert(headers.includes("X-Frame-Options: SAMEORIGIN"), "Netlify headers should restrict framing");
assert(headers.includes("X-Content-Type-Options: nosniff"), "Netlify headers should prevent MIME sniffing");
assert(headers.includes("Permissions-Policy"), "Netlify headers should disable unused browser permissions");

console.log("Fortune wheel tests passed.");
