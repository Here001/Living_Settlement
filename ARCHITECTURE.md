# Architecture: built for millions of followers

The city has two very different populations:

- **Followers:** potentially millions. Each one is a single database row.
- **The map:** buildings and roads your audience votes for one at a time. Thousands, not millions.

Everything below follows from keeping those two apart.

## The rules that keep it scalable

1. **The housing queue bounds the map.** Every follower who comments "spawn" becomes a citizen instantly, but only people with a home are simulated on the map. Everyone else waits in the Outskirts with a queue number (their arrival order, `citizens.seq`). Homes are only built by votes, so the number of people walking around grows with the city, not with the follower count.
2. **Viewers load only what's on screen.** The map is split into 32×32-tile chunks. A viewer downloads the chunks near their screen (`GET /api/chunks`) and subscribes to them over the WebSocket. Updates for other districts are never sent to them.
3. **Money is a formula, not a daily write.** Each balance is stored as *amount, day, change per day* and worked out when someone looks. Paydays for a million people cost nothing. The treasury works the same way.
4. **Assignments are permanent.** Home, job and hangout are stored per citizen and only change when something happens to them (a building opens or is demolished). Homes go to the front of the queue, and jobs and hangouts go to the nearest free spot. Every building has a capacity for homes, jobs and visitors, so a single change can only touch a bounded number of people.
5. **Comments are queued, then batched.** The Instagram webhook only saves each comment, which is one fast insert. The leader server turns queued "spawn" comments into citizens 1,000 at a time.
6. **Updates are batched and filtered.** Changes are grouped every 250 ms, and each change is serialized once and sent only to viewers watching that district. A change that touches hundreds of people tells those viewers to reload the district instead of streaming every record.
7. **Any number of web servers, one leader.** Postgres is the single source of truth, and an advisory lock serializes world changes, so two servers can never hand out the same home. Exactly one server, the leader, runs the clock and the comment queue. If it dies, another takes over within seconds. With `REDIS_URL` set, servers share live updates over Redis.

## Measured (one laptop-class server, one CPU core, local Postgres)

| What | Result |
|---|---|
| Viral burst: 200,000 "spawn" comments queued at once | absorbed in 19 s, about **10,000 new followers per second**, with 60 grouped news lines |
| Signed Instagram webhooks, 100 at a time | **1,500 per second**, 0 failed |
| Build an apartment tower and move 30 people in | 22 ms |
| Header and news for a viewer (`/api/meta`) | 1 ms |
| Densest district view (2×2 chunks, 5,700 citizens) | 63 ms server time, 186 KB compressed |
| Find someone by name among 216,000 | 2 to 40 ms |
| Look up the last place in a 197,000-person queue | 12 to 18 ms |
| 5,000 viewers connected, a new building appears | reaches every viewer of that district in **295 ms** |
| Server memory with 220,000 citizens and 5,000 viewers | 180 MB |
| Two servers over Redis | a build on one reaches a viewer on the other in 255 ms |
| Leader killed | the other server took over the clock and queue in **2 s** |
| Dense district in the browser | 60 frames per second (crowd capped at the 1,500 nearest people) |

Run these yourself: `npm run loadtest` (on a throwaway database) and `npm run check` (read-only recount of every total; safe on the live database).

## Growth stages

| Followers | Setup | Rough monthly cost |
|---|---|---|
| 0 to about 50k | One free Render web service, free Neon Postgres, and a cron-job.org ping every 10 minutes to keep it awake | $0 |
| 50k to about 500k | Render Starter (always on) and Neon Launch. Drop the ping. | about $25 to $40 |
| 500k to millions | 2 or more web instances behind Render's load balancer, `REDIS_URL` set (Render Key Value, Upstash), Postgres with more RAM, `PG_POOL_SIZE` tuned | about $100 to $300 |
| Huge live events | Add instances. Viewers are spread across them, and the leader and database work stay the same. | scales with viewers |

What actually limits growth, in order:
1. **Concurrent viewers.** Each server comfortably holds thousands of WebSockets. Add instances with Redis.
2. **Postgres size and IO.** About 0.8 KB per citizen, so a million followers is under 1 GB.
3. **World-change rate.** All changes run one at a time under a lock. Builder actions and batched spawns are far below its limit of hundreds per second.

## Where the code lives

- `server/world.js` is the world engine: the housing queue, assignments, money, chunk reads, and the clock.
- `server/db.js` holds the schema and its numbered migrations. Never edit an old migration; add a new one.
- `server/bus.js` is the in-memory or Redis update bus.
- `server/index.js` holds the HTTP API, WebSocket subscriptions and batching, rate limiting, and leader election.
- `server/instagram.js` is the signed webhook, which saves comments to the queue.
- `shared/catalog.js` and `shared/rules.js` hold the buildings and game rules, used by both server and browser.
- `public/index.html` is the city: it loads chunks, simulates the nearby crowd from the shared clock, and draws.
