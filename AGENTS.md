# AGENTS.md

## Project

This project belongs to Timur Fearless.

Main goals:

- Build premium stream and website experiences.
- Build unique OBS Browser Source overlays.
- Host overlays through Netlify.
- Keep production stable.
- Avoid unnecessary Netlify builds and wasted credits.

## Main rules

- Never push directly to `main`.
- Always work on a task branch and open a Pull Request.
- Do not deploy to production unless Timur explicitly approves.
- Do not change hosting, domain, DNS, production branch, build command, publish directory, or environment settings unless Timur explicitly asks.

## Stack rules

Use the existing project shape and scripts from `package.json`.

Do not add backend, database, auth, mobile app, Bun, Hono, Prisma, PostgreSQL, DigitalOcean, Yandex Cloud, or paid services unless Timur explicitly requests that architecture.

## Work process

1. Read `README.md`, `package.json`, this file, and the files related to the task.
2. Make the smallest useful change.
3. Preserve unrelated changes.
4. Avoid unrelated refactors.
5. Use existing dependencies before adding new ones.
6. Run the smallest meaningful validation.
7. Open a Pull Request and wait for review.

## Deployment safety

- Do not change DNS unless explicitly requested.
- Do not move custom domain unless explicitly requested.
- Do not rename existing overlay URLs unless explicitly requested.
- Keep OBS Browser Source URLs stable.
- Prefer preview deploys for experiments.
- Keep production branch clean.
- Never expose private API keys in frontend code.

## OBS overlay rules

- Transparent background by default.
- Lightweight HTML/CSS/JS.
- No manual interaction required for normal overlay use.
- No console errors.
- Config-first approach for editable labels, icons, sounds, and timings.
- Do not invent chat, sub, donation, winner, or platform data.

## Validation

Prefer project scripts when available:

```bash
npm test
```

If validation cannot be run, report that clearly.

## Completion report

Report what changed, what was validated, what was not validated, files touched, and manual steps remaining.
