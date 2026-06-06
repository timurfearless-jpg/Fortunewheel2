# Timur Fearless IRL Fortune Wheel

Cyber OBS Browser Source overlay for Timur Fearless electric unicycle IRL streams.

## OBS Browser Source URL

After the safe Netlify version is published, use:

```text
https://fortunewheel2.netlify.app/overlays/wheel/
```

Local test URL:

```text
http://127.0.0.1:8080/overlays/wheel/
```

Setup/positioning URL that stays visible:

```text
https://fortunewheel2.netlify.app/overlays/wheel/?visible=1
```

Recommended OBS Browser Source settings:

```text
Width: 1920
Height: 1080
FPS: 60
Shutdown source when not visible: off
Refresh browser when scene becomes active: on
Control audio via OBS: on
Background: transparent
```

The normal URL is transparent and hidden while idle. When a qualifying trigger starts a spin, the wheel appears automatically, spins, reveals the result, then hides after `15` seconds.

## Demo And Control Page

Open:

```text
/overlays/wheel/control.html
```

The control page works on desktop and phone. It can:

- Preview the wheel.
- Trigger demo spins.
- Edit challenge labels, titles, descriptions, icons, and colors.
- Edit and rebalance challenge percentages.
- Save temporary browser-local edits.
- Export a new `config.json`.

Browser-local edits are for demo/control only. Permanent Netlify changes should be committed to the repository and deployed through the normal safe workflow.

## Edit Wheel Tasks

Edit:

```text
config.json
```

The overlay uses a config-first challenge list:

```json
{
  "key": "touch_grass",
  "label": "TOUCH\nGRASS",
  "title": "TOUCH GRASS",
  "desc": "Find some grass or green nature nearby and touch it on stream.",
  "icon": "grass",
  "color": "#1b9f64"
}
```

Icon names map to:

```text
assets/icons/{icon}.svg
```

Keep this overlay challenge order aligned with the root project `config.json` challenges so server-triggered results match the wheel sectors.

## Sound Effects

Included original local WAV files:

```text
assets/sounds/spin.wav
assets/sounds/tick.wav
assets/sounds/result.wav
```

`tick.wav` plays each time the pointer crosses a sector. Because the spin easing slows down near the end, the tick rhythm also slows down like a roulette wheel.

## Chance Distribution

The visible sectors stay equal-sized for stream readability, while the actual result selection uses each challenge's configured chance.

Current distribution:

```text
MYSTERY: 1%
Every other challenge: 8.25%
Total: 100%
```

Use the `Balance Odds` button on `control.html` after adding or removing tasks. It keeps Mystery at `1%` and divides the remaining `99%` evenly.

Mute sounds with:

```text
/overlays/wheel/?sound=0
```

Force sound during local testing:

```text
/overlays/wheel/?sound=1&demo=1&visible=1
```

## Automatic Triggers

The overlay polls Netlify state and spins when Netlify Functions create a support event.

Supported trigger paths:

```text
/.netlify/functions/donation
/.netlify/functions/stream-event
/.netlify/functions/twitch-eventsub
/.netlify/functions/trigger
```

Qualifying events:

- Streamlabs or other donation webhook: `5 EUR` or more.
- Twitch bits: `500` bits or more.
- Kick support event: `5 EUR` or more.
- YouTube Super Sticker or Super Chat: `5 EUR` or more.
- Paid Twitch sub, resub, or gift sub.
- Paid Kick sub, YouTube member, or membership event through `stream-event`.

Secrets belong in Netlify environment variables, never in frontend code.

## Local Test

From the repository root:

```powershell
python -m http.server 8080 -d public
```

Then open:

```text
http://127.0.0.1:8080/overlays/wheel/?demo=1&visible=1&sound=1
```

Trigger another spin in DevTools:

```js
window.fearlessWheel.spin()
```

## Netlify Publish Path

This repo publishes `static`. The build script mirrors `public/` into `static/`, preserving the deployed URL:

```text
/overlays/wheel/
```

Do not rename this path without updating OBS Browser Sources.
