# Larp City server

Node/Express backend that holds every third-party secret (Persona, Nessie, ElevenLabs, Gemini,
Backboard, Tiger Data/Postgres) and exposes `/api/*` to the browser game in `../game`. See
`docs/superpowers/specs/2026-09-12-backend-design.md` for the design and `../SETUP.md` for how to
obtain each provider's keys.

## Local development

1. Fill in the repo-root `.env` (copy `.env.example`; see `SETUP.md` for where each key comes from).
2. `npm install`
3. `npm run dev` — starts on `PORT` (default 3000), applies additive migrations on boot, and
   serves `/api/health`.

## Tests

`npm test` runs `node --import tsx --test` over every `*.test.ts` file. These are adapter-level
unit tests with mocked `fetch`/injected fake clients — no live database or external API calls are
made during `npm test`.

## Deploy

See `deploy/Caddyfile` and `deploy/larp-server.service`, and the Vultr section of `../SETUP.md`
for the full VPS provisioning steps (Node 22, Caddy, systemd, `/etc/larp-city/server.env` at
mode 600).
