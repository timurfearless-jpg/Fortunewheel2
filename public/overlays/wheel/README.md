# Timur Fearless IRL Fortune Wheel

Cyber OBS Browser Source overlay for Timur Fearless electric unicycle IRL streams.

## OBS Browser Source URL

After Netlify deploy:

```text
https://fortunewheel2.netlify.app/overlays/wheel/
```

Recommended OBS source size:

```text
Width: 1920
Height: 1080
```

Keep the OBS Browser Source background transparent. The page has no body margin and no visible scrollbars.

## Edit Wheel Tasks

Edit:

```text
config.json
```

Each wheel item supports:

```json
{
  "label": "Touch Grass",
  "icon": "assets/icons/grass.svg",
  "color": "#7dff6a",
  "weight": 1,
  "detail": "Find some green nearby and touch it on camera."
}
```

Keep the item order in this file aligned with the root project `config.json` challenges so server-triggered results match the wheel.

## Sound Effects

Included original sound files:

```text
assets/sounds/spin.wav
assets/sounds/tick.wav
assets/sounds/result.wav
```

Sound is enabled in `config.json`. In OBS, enable Browser Source audio capture if you want the wheel sounds on stream. If autoplay blocks audio in your browser, the overlay keeps working visually.

Mute sounds with:

```text
/overlays/wheel/?sound=0
```

Force sound during local testing with:

```text
/overlays/wheel/?sound=1&demo=1
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
- YouTube Super Sticker / Super Chat: `5 EUR` or more.
- Paid Twitch sub / resub / gift sub.
- Paid Kick sub, YouTube member, or membership event through `stream-event`.

Secrets belong in Netlify environment variables, never in frontend code.

## Local Test

From the repository root:

```powershell
python -m http.server 8080 -d public
```

Then open:

```text
http://localhost:8080/overlays/wheel/?demo=1
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
