# Timur Fearless IRL Fortune Wheel 2

Netlify-ready OBS Browser Source fortune wheel for Timur Fearless electric unicycle IRL streams.

Live overlay path after deploy:

```text
https://fortunewheel2.netlify.app/overlays/wheel/
```

## Netlify Settings

This repo is configured by `netlify.toml`:

```text
Build command: npm run build
Publish directory: static
Functions directory: netlify/functions
Node version: 20
```

The build copies `public/` into `static/` before running validation, so the stable overlay URL is:

```text
/overlays/wheel/
```

## Required Netlify Environment Variables

Set these in Netlify project settings:

```text
TRIGGER_SECRET=long-secret-for-manual-triggers
DONATION_SECRET=long-secret-for-donation-webhooks
STREAM_EVENT_SECRET=long-secret-for-streamlabs-kick-youtube-events
ADMIN_SECRET=secret-for-saving-challenges-from-the-control-panel
TWITCH_EVENTSUB_SECRET=secret-for-twitch-eventsub-signatures
```

Optional chat echo:

```text
CHAT_WEBHOOK_URL=https://your-bot-or-streamerbot-webhook
CHAT_WEBHOOK_SECRET=optional-bearer-secret
```

Never commit real secrets to this repo.

## OBS

Add this as an OBS Browser Source:

```text
https://fortunewheel2.netlify.app/overlays/wheel/
```

Recommended source size:

```text
1920x1080
```

Use transparent background. Enable Browser Source audio capture if you want the wheel sound effects on stream.

Silent URL:

```text
https://fortunewheel2.netlify.app/overlays/wheel/?sound=0
```

Demo URL:

```text
https://fortunewheel2.netlify.app/overlays/wheel/?demo=1
```

## Wheel Tasks

The current EUC-safe tasks are:

- Touch grass
- Find blue
- Coffee stop
- Chat route
- Say hello
- Mini review
- Find flag
- POV spin
- Rate this spot
- Lucky bonus
- Talk to chat
- Cinematic shot

Edit overlay labels/icons/colors in:

```text
public/overlays/wheel/config.json
```

Edit server-triggered challenge titles/descriptions in:

```text
config.json
```

Keep both files in the same item order.

## Automatic Trigger Endpoints

### Manual secure trigger

```text
https://fortunewheel2.netlify.app/.netlify/functions/trigger?secret=TRIGGER_SECRET&name=Viewer&reason=Manual
```

### Donation webhook

```text
POST https://fortunewheel2.netlify.app/.netlify/functions/donation?secret=DONATION_SECRET
```

Example body:

```json
{
  "name": "Viewer",
  "amount": 5,
  "currency": "EUR",
  "source": "streamlabs"
}
```

### Generic stream event webhook

Use this for Streamlabs, Kick, YouTube Super Stickers, YouTube memberships, Kick subs, or bot/automation bridges:

```text
POST https://fortunewheel2.netlify.app/.netlify/functions/stream-event?secret=STREAM_EVENT_SECRET
```

Donation / Super Sticker:

```json
{
  "platform": "youtube",
  "type": "supersticker",
  "name": "Viewer",
  "amount": 5,
  "currency": "EUR"
}
```

Kick support:

```json
{
  "platform": "kick",
  "type": "donation",
  "name": "Viewer",
  "amount": 5,
  "currency": "EUR"
}
```

Paid member/sub:

```json
{
  "platform": "youtube",
  "type": "member",
  "name": "Viewer",
  "paid": true
}
```

Twitch bits through a bridge:

```json
{
  "platform": "twitch",
  "type": "bits",
  "name": "Viewer",
  "bits": 500
}
```

For stricter server-to-server webhooks, sign the raw JSON body with HMAC SHA-256 using `STREAM_EVENT_SECRET` and send:

```text
X-Stream-Event-Signature: sha256=HEX_DIGEST
```

### Twitch EventSub

Callback URL:

```text
https://fortunewheel2.netlify.app/.netlify/functions/twitch-eventsub
```

Secret:

```text
TWITCH_EVENTSUB_SECRET
```

Supported EventSub notification types:

```text
channel.channel_points_custom_reward_redemption.add
channel.cheer
channel.subscribe
channel.subscription.message
channel.subscription.gift
```

Defaults:

```text
Channel points: 50000+
Bits: 500+
Subs/resubs/gift subs: enabled
```

## Local Preview

Static overlay:

```powershell
python -m http.server 8080 -d public
```

Open:

```text
http://localhost:8080/overlays/wheel/?demo=1
```

Netlify Functions locally:

```powershell
npx netlify dev
```

## Tests

```powershell
npm test
```

If `npm` is unavailable locally, Netlify will still run `npm run build` during deploy.
