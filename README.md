# The Living Settlement

An always-on city where every follower becomes a citizen. The server owns the world and keeps its clock running 24/7, and everyone who opens the page sees the same city, live. It's built to take millions of followers: see [ARCHITECTURE.md](ARCHITECTURE.md) for how, and for measured numbers.

## How it works

```
Instagram comment "spawn" ─▶ webhook saves it ─▶ queue ─▶ leader turns 1,000 at a time into citizens
                                                              │
   Followers with a home live on the map; everyone else waits in the Outskirts with a queue number.
   New homes (voted by your audience) move the front of the queue in automatically.
                                                              │
Postgres (the truth) ◀─▶ web server(s) ─▶ WebSocket, per district ─▶ phones, laptops, the livestream
```

- **Time:** 1 game minute = 15 real seconds, so 4 game days pass per real day. Every citizen's day is worked out from the clock, so the city keeps living with nobody watching.
- **Money:** jobs pay daily wages. Rent and 20% tax come out of wages and fund the treasury, along with a daily grant of 200. Unemployed residents live rent-free. Building costs coins from the treasury.
- **Only you build.** Open the site with `#builder` and enter your `ADMIN_TOKEN`. Everyone else gets a view-only city.

## Developer controls

Open the site with `#builder` and enter your `ADMIN_TOKEN`. As the developer you can:

- **Build anything for free.** Turn **Build instantly** off to give buildings a construction period. They appear as building sites with scaffolding and a crane, and their homes and jobs open when they're finished. Fast-forward one with **Finish now** on its card, or all of them with **Finish all construction**.
- **Remove anything.** Use **Bulldoze → Clear an area** and drag a box over buildings, roads, trees, anything. It asks before clearing. The other bulldoze modes remove one thing at a time.
- **Add people.** Open **Citizens** and add one name, or paste a list into **Add many at once**.
- **Change careers and homes.** Tap a person, then **Change job** or **Change home**. If a place is full, the newest automatically placed person makes room. People you placed by hand are never bumped, and automatic hiring leaves them alone.
- **Find yourself.** **Find me** flies to your character. If you're indoors, a pointer shows which building you're in.
- **Go full screen.** Use the buttons above the toolbar for full screen (F) and to hide the interface for streaming (H). On iPhone, use Share → Add to Home Screen to open the city full screen.

## Run it on your computer

With Docker: `docker compose up --build`, then open http://localhost:3000/#builder (token `local-dev-token-please-change`).

Without Docker: install Node 20+ and Postgres, copy `.env.example` to `.env`, fill it in, then `npm install` and `npm run dev`.

| Command | What it does |
|---|---|
| `npm test` | 62 end-to-end checks against a running server. **Throwaway database only:** it founds a test town. |
| `npm run check` | Recounts every total from scratch and compares it with the running totals. Read-only, safe on the live database. |
| `npm run loadtest` | Floods a running server with 200,000 followers, webhooks, towers and viewers. **Throwaway database only.** |

## Put it online for free (Render + Neon)

1. **Database:** sign up at neon.com, create a project, and copy the connection string (`postgresql://…`).
2. **Server:** sign up at render.com with GitHub. Click **New → Blueprint** and pick this repo. Paste the Neon string when asked for `DATABASE_URL`. Render generates your `ADMIN_TOKEN` and `CRON_KEY`; copy them from the service's **Environment** tab.
3. **Keep it awake:** on cron-job.org, call `https://YOUR-APP.onrender.com/api/cron/tick?key=YOUR_CRON_KEY` every 10 minutes. Render's free plan sleeps after 15 idle minutes, and this ping prevents that. If it does sleep, the city catches up the moment it wakes.
4. Open `https://YOUR-APP.onrender.com/#builder`, enter your `ADMIN_TOKEN`, and found your settlement.

When the audience grows, follow the growth stages in [ARCHITECTURE.md](ARCHITECTURE.md): an always-on plan first, then more instances with `REDIS_URL`.

## Connect Instagram (comment "spawn" to move in)

You need an Instagram **Business or Creator** account.

1. developers.facebook.com → **Create app** → add the **Instagram** product (API setup with Instagram login).
2. Permissions: `instagram_business_basic`, `instagram_business_manage_comments`.
3. **Webhooks** → Callback URL `https://YOUR-APP/webhooks/instagram`, Verify token = your `IG_VERIFY_TOKEN`. Subscribe to the **comments** field.
4. Put the app's **App secret** in `IG_APP_SECRET` and redeploy.
5. Generate a token for your account in the dashboard so the app is subscribed to it.

In Development mode, Meta only sends comments from accounts with a role on the app, which is fine for testing. Public comments need **App Review** with Advanced Access for `instagram_business_manage_comments`.

**Build votes:** mark your "what should we build tomorrow?" post, then read its comments:
`curl -X PUT https://YOUR-APP/api/admin/build-post -H "authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" -d '{"mediaId":"1789..."}'` and `GET /api/admin/requests`.

## Settings

| Variable | Needed | What it's for |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `ADMIN_TOKEN` | yes | Your builder password (16+ characters) |
| `CRON_KEY` | for the ping | Secret for `/api/cron/tick` |
| `PGSSL` | on most clouds | `1` to connect to Postgres over SSL |
| `IG_VERIFY_TOKEN`, `IG_APP_SECRET` | for Instagram | Webhook handshake and signature check |
| `SPAWN_KEYWORD` | no | The comment word that moves people in (default `spawn`) |
| `REDIS_URL` | when running 2+ servers | Shares live updates between servers |
| `PG_POOL_SIZE` | no | Database connections per server (default 8) |
| `RATE_PER_MIN` | no | Requests per minute per visitor (default 240) |

## API

Public: `GET /api/meta` · `GET /api/chunks?keys=0_0,1_0` · `GET /api/citizens?q=prefix` · `GET /api/citizens/:handle` · `GET /health` · WebSocket `/ws` (send `{"type":"sub","chunks":["0_0"]}`)

Builder (header `Authorization: Bearer ADMIN_TOKEN`): `POST /api/admin/found` · `POST /api/admin/buildings` · `PATCH|DELETE /api/admin/buildings/:id` · `POST /api/admin/buildings/restore` · `POST /api/admin/roads` · `POST /api/admin/citizens` · `DELETE /api/admin/citizens/:id` · `PUT /api/admin/build-post` · `GET /api/admin/requests`

## Adding to the city

- **A building:** one line in `shared/catalog.js`. Give it homes, jobs or visitors and the queue, jobs and hangouts use it automatically.
- **A road type:** one entry in `ROAD_TYPES` in the same file.
- **A database change:** add a new entry at the end of `MIGRATIONS` in `server/db.js`. Never edit an old one.
