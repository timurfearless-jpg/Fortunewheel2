---
name: cyber-alerts-and-wheel-overlay
description: Use this skill when creating, improving, or debugging cyber-style OBS overlays, animated stream alerts, spin wheels, prize wheels, donation wheels, challenge wheels, particle effects, sound effects, streamer UI widgets, or unique visual livestream effects for Timur Fearless.
---

# Cyber Alerts And Wheel Overlay

Use this skill to create unique cyber-style OBS Browser Source overlays for Timur Fearless streams. Make the result feel custom-made for Timur Fearless, not like a generic free overlay template.

## Purpose

Create premium, energetic OBS Browser Source overlays for:

- Animated prize wheels, donation wheels, and challenge wheels.
- Cyber alerts, particle effects, sparks, and streamer UI widgets.
- Sound effects and animated visual livestream effects.
- Unique IRL livestream UI that fits Timur Fearless.

## Visual Style

Aim for a visual direction that is:

- Cyberpunk.
- Neon.
- Electric.
- Fast.
- Arcade.
- IRL streamer.
- Futuristic Helsinki / city energy.
- Premium but energetic.
- Readable on stream.

Avoid:

- Childish casino style.
- Cheap slot-machine visuals.
- Generic Twitch template look.
- Too many unreadable effects.
- Heavy animations that may lag OBS.

## Wheel Overlay Requirements

When building or modifying a wheel overlay, include:

- A downward pointer or arrow.
- A circular wheel.
- Configurable sectors.
- Sector icons.
- Sector labels where readable and appropriate.
- Animated spin.
- Easing animation.
- Result reveal.
- Optional sound effect.
- Optional particle burst.
- Optional sparks around the wheel.
- Transparent background for OBS.
- A config file for labels, icons, colors, sounds, and spin duration.

Make wheel items editable without touching core JavaScript.

Prefer this file structure:

- `index.html` for structure.
- `styles.css` for visuals.
- `overlay.js` for logic.
- `config.json` for labels, icons, colors, sounds, timings, and feature flags.
- `assets/icons/` for icons.
- `assets/sounds/` for sounds when needed.

## OBS Requirements

Design overlays for real OBS Browser Source use:

- Use a transparent background by default.
- Require no manual click for normal stream use.
- Auto-start animations when required.
- Hide scrollbars.
- Remove browser default margins.
- Avoid broken layouts at common OBS sizes such as `1920x1080`, `1280x720`, and compact HUD layouts.
- Avoid heavy libraries unless clearly needed.
- Avoid requiring a backend unless explicitly requested.
- Never put API keys or private secrets in frontend code.

## Performance Rules

Treat OBS stability as more important than visual complexity.

- Use `requestAnimationFrame` for animation loops.
- Cap particle counts.
- Avoid massive blur filters.
- Avoid huge box shadows everywhere.
- Avoid unbounded timers.
- Avoid memory leaks.
- Stop or recycle old particles.
- Preload sounds and images.
- Add a reduced-performance fallback when effects are heavy.

## Sound Rules

Keep sound optional and stream-safe:

- Provide a mute option in config.
- Preload audio.
- Avoid autoplay errors where possible.
- Document how sound is triggered in OBS.
- Do not use copyrighted sounds unless the user provides them.

## Config-First Wheel Pattern

When creating a new wheel overlay, prefer a `config.json` shaped like this:

```json
{
  "title": "Fearless Wheel",
  "spinDurationMs": 7000,
  "muted": false,
  "particles": true,
  "items": [
    {
      "label": "Extra Delivery",
      "icon": "assets/icons/delivery.svg",
      "weight": 1
    },
    {
      "label": "Push-ups",
      "icon": "assets/icons/pushups.svg",
      "weight": 1
    }
  ]
}
```

Do not require the user to edit `overlay.js` for normal item, icon, color, sound, or timing changes.

## New Overlay File Expectations

For a new overlay, create:

- `index.html`.
- `styles.css`.
- `overlay.js`.
- `config.json`.
- `README.md`.
- `assets/icons/`.
- `assets/sounds/` if needed.

## README Requirements

Always document:

- OBS Browser Source URL.
- Recommended width and height.
- Whether the background should be transparent.
- How to edit wheel items.
- How to change sounds.
- How to test locally.
- How to deploy on Netlify.

## Netlify Path Expectation

For this project, overlays should usually live under:

```text
public/overlays/
```

Example final URL:

```text
/overlays/wheel/
```

If deployed to Netlify, this becomes:

```text
https://YOUR-DOMAIN.com/overlays/wheel/
```

If the project publishes a different static directory, map the overlay path so the deployed URL still stays under `/overlays/`.

## Quality Checklist

Before finishing, verify:

- No console errors.
- Transparent background works.
- Wheel spins smoothly.
- Result is readable.
- Icons load correctly.
- Sounds do not crash the overlay.
- Config changes work.
- Overlay works without user clicking.
- Layout works in OBS-like sizes.
