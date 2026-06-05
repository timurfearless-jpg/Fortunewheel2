---
name: netlify-github-deploy-guard
description: Use this skill when changing Netlify configuration, GitHub deployment workflow, netlify.toml, build settings, preview deploys, production deploys, branch deploys, domains, DNS, environment variables, or anything that could affect Netlify credits or deployment stability.
---

# Netlify GitHub Deploy Guard

Use this skill to protect Timur Fearless projects from broken deploys, wasted Netlify credits, accidental production changes, DNS mistakes, and unstable GitHub workflows.

## Project Context

This project is deployed through:

- GitHub.
- Netlify.
- A custom domain.
- A static frontend.
- OBS overlays hosted as browser-source pages.

## Main Rule

Do not make deployment, DNS, domain, or production workflow changes casually.

If a change can affect production, first explain:

- What will change.
- Why it is needed.
- What risk exists.
- How to roll back.

## Netlify Priorities

Prefer:

- Stable production branch.
- Preview deploys for testing.
- Branch or PR workflow for experiments.
- Static deploys.
- Simple build commands.
- Minimal dependencies.
- No unnecessary backend.
- No exposed secrets.

Avoid:

- Unnecessary production deploys.
- Changing DNS without explicit request.
- Moving a custom domain without explicit request.
- Adding paid services without explicit request.
- Adding serverless functions unless truly needed.
- Adding environment variables to frontend code.
- Hardcoding API keys.
- Breaking OBS overlay URLs.

## Netlify Credits Protection

Before changing anything that may trigger builds, check whether the change is necessary.

Prefer:

- Batch related changes into one commit.
- Test locally before pushing.
- Use preview deploys for experiments.
- Avoid repeated tiny production pushes.
- Keep builds fast.
- Avoid heavy build pipelines.
- Avoid unnecessary image or video processing during build.

If the user asks to experiment, prefer a branch or preview workflow.

## Build Configuration

Check `netlify.toml` before changing Netlify settings.

Preferred simple Vite-style setup:

```toml
[build]
command = "npm run build"
publish = "dist"
```

Only modify this if the project structure requires it. For plain static projects, preserve the existing publish directory when it is already correct.

## OBS Overlay Deployment

Keep OBS overlay URLs stable.

Prefer hosting overlays under:

```text
/overlays/
```

Examples:

```text
/overlays/irl/
/overlays/wheel/
/overlays/alerts/
```

Do not rename overlay paths unless explicitly requested, because OBS Browser Sources may already use those URLs.

## Environment Variables And Secrets

- Never put private API keys in frontend JavaScript.
- Never commit `.env` files with secrets.
- Use Netlify environment variables for private values.
- If frontend needs public values, clearly label them as public.
- If a secret is required, consider a Netlify Function only when necessary.

## GitHub Workflow Rules

Prefer:

- `main` as stable production branch.
- Feature branches for experiments.
- Clear commit messages.
- README updates when deployment behavior changes.

Avoid:

- Force-pushing production branches.
- Deleting existing working files without reason.
- Large unrelated rewrites.
- Changing repository settings blindly.

## Domain And DNS Protection

Never change these unless the user explicitly asks:

- Custom domain.
- DNS records.
- CNAME.
- ALIAS / A records.
- HTTPS settings.
- Production site connection.

If asked to change DNS or domain:

1. Explain the current intended change.
2. List the exact records.
3. Warn about propagation delay.
4. Provide rollback instructions.

## Deployment Checklist

Before finishing any Netlify or GitHub change:

- Check `package.json`.
- Check `netlify.toml`.
- Check build command.
- Check publish directory.
- Run the build locally if possible.
- Make sure public overlay paths remain stable.
- Make sure no secrets are exposed.
- Document any changed URLs.

## Recommended Final Response Style

When this skill is used, include:

- What changed.
- What files changed.
- Whether production is affected.
- How to test preview.
- How to roll back if something breaks.
