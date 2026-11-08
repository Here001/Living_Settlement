# CLAUDE.md — Resurgence

Read this first, then `README.md` (every feature, in plain words) and `ARCHITECTURE.md` (how it scales and why).

## What this is

**Resurgence** (codebase and repo name: *Living Settlement*) is an always-on live city game on the planet Gliese 12 b, played at playresurgence.com. Instagram followers comment "spawn" and become colonists; website visitors can also sign up. The server owns the world and runs the clock 24/7, so everyone who opens the page sees the same city, live. Only the owner builds (`#builder` + `ADMIN_TOKEN`); everyone else plays as a colonist: jobs, coins, casino, races, crime, chat, Town Square, elections, and more.

The owner works mostly from a phone and is not a full-time developer. Explain changes in plain language.

## Ground rules (from the owner)

- **Never push to the main branch or deploy without asking first.** Work on a branch, explain what changed, and wait for a yes.
- **Never run destructive actions on the live database** (resets, deletes, migrations that drop data) without explicit approval. Use a throwaway database for tests.
- Look before changing: read the relevant code and README section first.
- Keep `README.md` up to date when a feature changes. It's written in plain, friendly language for the owner, not developer jargon; match that style.

## Stack

- **Node.js ≥ 22**, ES modules (`"type": "module"`), no build step, no framework on the front end.
- **Server:** Express + `ws` WebSockets (`server/`). Postgres via `pg` is the single source of truth. Optional Redis (`REDIS_URL`) when running several servers.
- **Client:** `public/index.html` is the whole game client (~7,000 lines, canvas isometric map, one big `<script type="module">`). Extra client modules: `world3d.js` (Three.js), `arena.js`, `crimegames.js`, `music.js`, `sw.js` (service worker).
- **Shared:** `shared/` holds rules used by both server and browser, so they must stay in sync: `catalog.js` (building, road and vehicle types), `rules.js` (wages, tax, shifts, what makes the Colony Log), plus game logic for casino, races, fights, minigames, elections, etc.
- **Streamer:** `streamer/` is a separate service that livestreams the city.
- **Hosting:** Docker. `render.yaml` sets up Render with a Neon Postgres database. `docker-compose.yml` for running locally.

## Key ideas (details in ARCHITECTURE.md)

- Time: 30 real minutes = 1 game day. Citizens' days, traffic, trains and weather are computed **in each browser from the clock**, deterministically, so every viewer sees the same thing and the server does no work for motion.
- The map is split into 32×32 chunks; viewers load and subscribe only to nearby chunks.
- Balances are stored as a formula (amount, day, change per day), not written daily.
- One **leader** server runs the clock and the Instagram comment queue (Postgres advisory lock); others take over if it dies.
- The housing queue bounds the map: only colonists with homes are simulated; others wait aboard the ark.
- Performance matters a lot (target: smooth on cheap phones with thousands of people on screen). Don't add per-frame work or per-citizen database writes casually.

## Commands

- `npm start`: run the server. `npm run dev`: run with auto-restart.
- `npm test`: end-to-end smoke test of a running server. **Throwaway database only**: it founds a settlement. It also checks that the page script in `index.html` parses, so run it after editing the client.
- `npm run check`: read-only recount of every total; safe on the live database.
- `npm run loadtest`: load test, throwaway database only.
- Config comes from `.env` (see `.env.example`): `DATABASE_URL`, `PGSSL`, `ADMIN_TOKEN`, `CRON_KEY`, Instagram keys, optional Google sign-in and Turnstile keys.

## Where things live

- `server/index.js`: entry point, routes, WebSocket setup.
- `server/world.js`: the map, buildings, assigning homes and jobs.
- `server/db.js`: schema and numbered migrations.
- `server/economy.js`, `earn.js`, `housing.js`, `players.js`, `chat.js`, `instagram.js`, `stats.js`, …: one file per feature, named for what it does.
- Client feature code is in `public/index.html`, found by searching for the feature name (e.g. "railways", "trains", `VIEW`, `toView`).

## Recent work

The latest commits were visual polish on the night look (softer, thinner moonlit outlines on buildings). Ask the owner what they want next.
