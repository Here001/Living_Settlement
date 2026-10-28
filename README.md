# The Living Settlement

An always-on city where every follower becomes a citizen. The server owns the world and keeps the clock running 24/7. Every browser that opens the page sees the same city, live.

## How it stays alive with nobody watching

```
            ┌──────────── Server (always on) ────────────┐
Instagram ─▶│ /webhooks/instagram   comment "spawn" → new citizen
            │ Clock: every 15 s = 1 game minute          │
            │   • pays salaries, collects taxes & rent   │
            │   • writes the day's news                  │
            │ API: builder actions (build, roads, move)  │
            │ Postgres: buildings, roads, citizens, news │
            └───────────────┬────────────────────────────┘
                            │ WebSocket: live changes
             ┌──────────────┼──────────────┐
          Phone          Laptop        Livestream (OBS)
```

Citizens' movement is a pure function of the clock (see `getPlan` / `citizenAt` in `public/index.html`).
The server doesn't push positions. It pushes the truth (who lives where, who works where), and every
screen computes the same walk from the same clock. That's why the city looks identical everywhere
and costs almost nothing to run, even with thousands of citizens.

## Run it on your computer

1. Install Docker Desktop.
2. In this folder: `docker compose up --build`
3. Open http://localhost:3000/#builder and enter the token `local-dev-token-please-change`.
4. Found your settlement. Build. Open the same URL on your phone (without `#builder`) to see the viewer version.

Without Docker: install Node 20+ and Postgres, copy `.env.example` to `.env`, fill it in, then `npm install` and `npm run dev`.

**Check everything works:** with the server running on an empty database, run `npm test`. It founds a settlement and runs 52 checks: building, roads, moving, undo, citizens, a signed fake Instagram "spawn" comment, build-vote collection, the cron ping, and live updates over the WebSocket. Run it against a throwaway database, never your real city.

## Put it online (Railway, about 10 minutes)

Vercel won't work for this. Its functions shut down between requests, so nothing can keep the clock or the live connections running. Use an always-on host:

1. Push this folder to a GitHub repo.
2. On railway.app: **New project → Deploy from GitHub repo**. Then **+ New → Database → PostgreSQL**.
3. In your app service → **Variables**, add:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `ADMIN_TOKEN` = a long random string (`openssl rand -hex 24`)
   - `CRON_KEY` = another random string
4. **Settings → Networking → Generate domain.** Visit `https://your-domain/#builder`.

Render and Fly.io work the same way. On a free tier that sleeps, point **cron-job.org** at
`https://your-domain/api/cron/tick?key=YOUR_CRON_KEY` every 5 minutes. That keeps it awake, and any days missed while it slept are paid out the moment it wakes.

## Connect Instagram (comment "spawn" to move in)

You need an Instagram **Business or Creator** account.

1. developers.facebook.com → **Create app** → add the **Instagram** product (API setup with Instagram login).
2. Permissions: `instagram_business_basic`, `instagram_business_manage_comments`.
3. **Webhooks** → Callback URL `https://your-domain/webhooks/instagram`, Verify token = your `IG_VERIFY_TOKEN`. Subscribe to the **comments** field.
4. Copy the **App secret** into `IG_APP_SECRET` and redeploy.
5. Generate a token for your account in the dashboard so the app is subscribed to it.

While the app is in Development mode, Meta only sends comments from accounts that have a role on the app (you and your testers), which is perfect for testing. To receive comments from the public you need to pass **App Review** and get Advanced Access for `instagram_business_manage_comments`.

**Build votes:** post your "what should we build tomorrow?" question, grab its media ID, then:
`curl -X PUT https://your-domain/api/admin/build-post -H "authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" -d '{"mediaId":"1789..."}'`
Every comment on that post is saved. Read them at `GET /api/admin/requests`.

TikTok has no official API for reading comments on your videos, so send TikTok viewers to Instagram to move in.

## API

Public: `GET /api/world` · `GET /api/citizens/:handle` · `GET /health` · WebSocket `/ws`
Builder (header `Authorization: Bearer ADMIN_TOKEN`): `POST /api/admin/found`, `POST /api/admin/buildings`,
`PATCH|DELETE /api/admin/buildings/:id`, `POST /api/admin/buildings/restore`, `POST /api/admin/roads`,
`POST /api/admin/citizens`, `DELETE /api/admin/citizens/:id`, `PUT /api/admin/build-post`, `GET /api/admin/requests`.

## Where things live

- `shared/catalog.js`: every building and road. Add one line to add a structure. The server and browser both read it.
- `shared/rules.js`: the economy (homes, jobs, salaries, taxes, placement rules).
- `server/world.js`: the authoritative world and its clock (`settle`).
- `server/instagram.js`: the comment webhook.
- `public/index.html`: the city you see.

## What's next

- Citizen accounts: followers claim their character (prove it with a DM code) and choose jobs and homes.
- Crime, police and jail: crimes become server events, so chases happen even when no one is watching.
- Casino games on the claimed-citizen page, using in-game coins only.
- A `/live` view for OBS streaming with chat commands.
