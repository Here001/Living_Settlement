# RESURGENCE

A living colony on Gliese 12 b, built by your followers. (Codebase: The Living Settlement.)

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

- **Time:** 30 real minutes = 1 game day (1 game minute = 1.25 real seconds), so 48 game days pass per real day. Every citizen's day (commute, work, lunch, evenings out, sleep) is worked out from the clock, so the city keeps living with nobody watching. A town started on the old slower clock switches over smoothly on its next start, without skipping time.
- **Day, night and weather:** the sky follows the clock. Street lamps, windows and headlights come on at dusk. Weather (sun, cloud, rain, fog, storm) changes every 6 game hours, and the same for every viewer.
- **Traffic:** about half of citizens own a car and drive longer trips along roads. Buses, taxis and delivery vans fill the streets by time of day, busier at rush hour. Fire trucks, police and ambulances drive out to disasters.
- **Money:** jobs pay daily wages. Rent and 20% tax come out of wages and fund the treasury, along with a daily grant of 200. Unemployed residents live rent-free. Building costs coins from the treasury.
- **Only you build.** Open the site with `#builder` and enter your `ADMIN_TOKEN`. Everyone else gets a view-only city.

## Developer controls

Open the site with `#builder` and enter your `ADMIN_TOKEN`. As the developer you can:

- **Drag to build.** Pick something from a menu, then press on the map and drag. The tiles it would cover show green, or red with a no-entry sign where a road, building or water is in the way. Let go to build. Drag to the screen edge to carry it further. Use two fingers (or the right mouse button) to move the map while a tool is on.
- **Lay straight roads.** In **Roads**, *Point to point* is on by default: tap where the road starts (a green flag), then tap where it ends. A preview shows the route and its length, and turns red where a building is in the way. Roads run straight along the grid and bend once if the two points don't line up. Each end becomes the next start, so you can keep tapping to draw a whole street. *Freehand* still lets you drag-paint. New roads clear trees, bushes, rocks and small street furniture in their way (shown in amber in the preview); parks, farms and buildings stop the road instead. Undo puts cleared things back.
- **Undo.** The round ↶ button (and **Undo** on the tool bar, or Ctrl+Z) reverses your last building, move, demolition, road, water or vehicle, one step at a time.
- **Turn buildings.** While placing or moving something, tap **⟲ Turn** on the tool bar (or press R) to make it face the other way; its width and depth swap and the footprint preview follows. Tap **⟲ Turn** on a building's card to turn one that's already built. Buildings can face either of the two directions the camera sees.
- **Move anything.** Press and hold a building, then drag it to a new spot. Moves can be undone from the message that appears.
- **Hide the menus, keep the tool.** **Hide menu** on the black tool bar (or the M key) clears the screen so you can build on the whole map; **Show menu** brings them back. **Done** (or Esc) puts the tool away.
- **Draft first, then update live.** Tap **✎ Draft** in the top bar. While drafting, everything you build, move, demolish, and every road, water tile or vehicle you add, shows only on your screen: blue for new or moved, faded red for things that will go. Players see nothing. Your draft is saved on the server, so you can leave and come back. **Update live** puts the whole draft into the city at once, with one Gazette headline; anything that no longer fits (say, a spot that got taken) is skipped and listed. **Discard** throws the draft away. Undo works inside a draft. People, weather and disasters always act live.
- **Build anything for free.** Turn **Build instantly** off to give buildings a construction period. They appear as building sites with scaffolding and a crane, and their homes and jobs open when they're finished. Fast-forward one with **Finish now** on its card, or all of them with **Finish all construction**.
- **Remove anything.** Use **Bulldoze → Clear an area** and drag a box over buildings, roads, trees, anything. It asks before clearing. The other bulldoze modes remove one thing at a time.
- **Add people.** Open **Citizens** and add one name, or paste a list into **Add many at once**. Choose Random, Man or Woman first. Followers can comment "spawn male" or "spawn female" to choose; otherwise it's a coin flip. Change anyone with **Make a man / Make a woman** on their card.
- **Change careers and homes.** Tap a person, then **Change job** or **Change home**. If a place is full, the newest automatically placed person makes room. People you placed by hand are never bumped, and automatic hiring leaves them alone.
- **Find yourself.** **Find me** flies to your character. If you're indoors, a pointer shows which building you're in.
- **Paint water.** **Terrain** paints rivers, lakes and sea with a 1–5 tile brush, or turns water back into land. Shores are drawn with rounded corners and a sand beach. Roads painted over water become bridges.
- **Add vehicles.** **Vehicles** places cars, taxis, buses, vans, trucks and emergency vehicles on any road; they drive around on their own. Tap one to remove it.
- **Set the weather.** **Weather** pins a weather type, or leave it on Automatic.
- **Trigger disasters.** **Disasters** (fire, tornado, earthquake, flood, meteor) hit where you tap. Damaged buildings become ruins and their people lose that home or job until you **Rebuild** them. **Clear ruins** removes all rubble.
- **Go full screen.** Use the buttons above the toolbar for full screen (F) and to hide the interface for streaming (H). On iPhone, use Share → Add to Home Screen to open the city full screen.

## Removing people and starting over

In developer view, **Colonists** (at the bottom) has:
- **Remove these**: paste usernames to remove several colonists at once. Their homes and jobs open up for others.
- **Remove everyone except me**: clears all colonists but keeps the buildings.
- **Reset colony**: type `RESET` to wipe the whole colony (map, colonists, news, Town Square messages, drafts) and return to "Found your colony". The Instagram connection is kept. Everyone watching is reloaded automatically.

## Town Square

Colonists who have claimed their avatar (proved it's them and set a password) can post short messages (up to 280 characters) in **Town Square → Posts**; everyone sees them live with a blue ✓. One message per 15 seconds per colonist, no links. Colonists can delete their own; the developer can delete any.

Colonists can set a **name** (first and last, or just one) on their own card; it shows on their avatar, card and posts, while the @username stays for search. The developer can change anyone's name from their card.

In developer view, the Town Square box posts **official updates as Man Landing Updates** (logo picture, gold Official badge, up to 1000 characters). Tick **Pin to top** to keep it above everything; **Pin / Unpin** works on any post, up to 3 at a time.

New colonists start with **0 coins** and earn from their job. Coins are private: a colonist sees only their own, and only the developer sees the colony treasury.

## The story and the intro

New visitors see an opening when they first arrive. Put a narrated video at `public/intro.mp4` (H.264 MP4, ideally under 40 MB) and it plays full screen with a **Begin** button (so sound is allowed) and **Skip**; until then, the story plays as title cards. Anyone can replay it from **Town Square → The story**, which also holds the full story text.

The colony is themed around the story: new followers **arrive aboard the ark and wait in cryosleep** until there's a home, colonists land at the **landing station** (it replaced the old campfire automatically), and the news is the **Colony Log**.

## Players: prove it's you, then set a password

A follower opens the city, finds their citizen and taps **This is me**. The site gives them a one-time code like `CLAIM 482913`.
They comment it on any of your Instagram posts **from their own account**. After setting a password, they choose their colonist's gender, once (the developer can still change it later). The webhook sees the comment, checks it came from that exact username, and the page moves on by itself to "Choose a password". From then on they log in with that password, and it's what will unlock special actions like the casino or crime.

- The code is public, but useless to anyone else: it only counts when the avatar's own account posts it, and only the browser that asked for it can then set the password.
- **Forgot password:** the same steps reset it, and old logins are signed out.
- **Before Instagram is connected, or to settle a dispute:** on a citizen's card, developer view has **Copy setup link**, a one-time link (valid 24 hours) that lets that person set a password directly. **Clear password** locks an avatar until its owner proves it again.
- Passwords are stored hashed (scrypt). After 8 wrong guesses, a username is locked for 15 minutes.

## Jobs

- **Automatic jobs.** Colonists start with 0 coins. When they move into a home, the game gives them the nearest free job. Each game day they earn their salary minus their rent.
- **The Work box.** A signed-in colonist's own card has a Work box. It shows their job and take-home pay, a **Quit** button, and **Find a job**: a list of open jobs nearest their home, each with take-home pay and distance.
- **Taking a job.** Colonists can take a new job once per game day. Quitting is always allowed, but doesn't reset that limit.
- **After quitting.** Automatic hiring leaves them alone until they choose another job. If their workplace is demolished, automatic hiring takes over again.
- **Claimed colonists get priority.** A full workplace still counts as open if a place in it is held by an automatically placed colonist who hasn't claimed their avatar. That colonist goes back to looking for work. Claimed colonists and anyone the developer placed by hand are never pushed out.

## Casino

- **Opening.** Once the colony has a finished **Casino**, signed-in colonists with a home see a Casino box on their own card. The Casino's card also has **Play here**.
- **The games:**
  - **Coin flip:** pick heads or tails, win 1.9×.
  - **Dice:** pick 1 to 6, win 5.7×.
  - **Slots:** three in a row pays 5× (🍒) up to 100× (🚀🚀🚀); two 🍒 pays 1.5×.
- **Odds and fairness.**
  - Every game pays back about 95% over time.
  - The house edge goes into the colony treasury, and wins are paid from it.
  - The server rolls the dice, so nobody can cheat from their browser.
- **Limits.** One bet every ~1 second, and at most 100,000 coins per bet. There is no daily limit.
- **Visits.** While playing, and for 10 minutes after their last bet, the colonist is inside the Casino for everyone to see.
- **Announcements.** Big wins (200+ coins of profit, or 20×+ on a small bet) go in the Colony Log.

## Your own card: Work · Go out · Casino · Crime · Pet

A signed-in colonist with a home sees these on their own card. They see one at a time.

- **Go out.** Send your colonist to a park, shop, café, landmark or a friend's home for 4 game hours (about 5 real minutes). Everyone sees them there. Other colonists' cards have **Visit their home** too.
- **Getting there.** Colonists travel to wherever they're going, whether that's going out, the Casino or the Jail, and come back the same way afterwards.
  - Short trips (under 14 tiles) are walked.
  - Longer ones are driven by colonists who own a car; everyone else takes a cab.
  - Anyone caught for a crime is driven to the Jail in a police car with its lights on.
- **Crime.** Crimes can be tried once every 10 minutes.
  - **Pickpocket:** steal 10–25% of a colonist's coins, up to 300. Other colonists' cards have **Pick their pocket**.
  - **Rob the nearest shop:** 60–400 coins from the till, which the treasury pays.
  - **Chances:** 55% for a pickpocket and 40% for a robbery. Each Police station within 40 tiles cuts that by 12 points, to no lower than 15%.
  - **Getting caught:** a fine of twice the amount they tried to take, at least 25, which goes to the treasury.
  - **Jail:** if the colony has a Jail, 10 minutes in it, seen inside. A jailed colonist can't gamble, bet, go out, adopt or commit crimes.
  - **News:** successes are reported anonymously in the Colony Log; arrests name the culprit.
- **Pet.** Adopt one of the six native creatures for 200 coins, name it, and it walks beside you on the map. You can rename it or let it go.

## Money: the Bank, cars, homes and buildings

These live on a signed-in colonist's own card, under **Home**, **Bank** and **Cars**.

- **Bank.**
  - Deposits need a Bank in the colony ("Colonnaded bank", under Offices). Withdrawals always work.
  - Money in the bank can't be pickpocketed.
  - Savings grow 0.1% each game day, up to 20 coins a day. The treasury pays interest only when it can afford to, so the bank never creates coins.
- **Cars.**
  - The dealer sells five models (Hatchback 1,500, Sedan 3,000, Pickup 5,000, SUV 6,500, Sports car 14,000), each in a choice of colours.
  - Colonists keep up to 3 in their garage, pick which one they drive, and can sell for 60% back.
  - Signed-in colonists drive their own car on longer trips and commutes; without one they take a cab. Everyone else keeps the old rule, where about half own a car.
- **Moving home.** Rent any home with free space and move there, once per game day. Rent comes out of wages as before. You can always move into a home you own, and if it's full, the newest tenant who hasn't claimed their avatar moves out.
- **Owning buildings.**
  - A home or business (housing, shops, offices, industry) can be bought from its card on the map, up to 5 per colonist. Public buildings, parks, landmarks and utilities stay the colony's.
  - Every game day owners are paid automatically: 80% of the rent their residents pay, or 80% of a business's profit (25% of its wage bill). The treasury keeps 20%.
  - Buildings sell back to the colony for 70%. If the developer knocks one down, the owner gets back what they paid.
- **Gifts.** Signed-in colonists can send coins to each other, with **Send a gift** on another colonist's card or **Gift coins** in the Bank section.
  - Gifts come from the coins you carry, up to 2,000 a game day, so nobody can funnel a stack of accounts into one.
  - The Colony Log says who gifted whom, but not the amount.
- **New buildings.** A **Gym** and an outdoor **Fitness park**, under Parks → Sports.

## Creature races

- **The creatures.** Six native creatures race: Starcrest, Dustrunner, Skyskimmer, Mudgulper, Ironshell and Glimmerhop (`shared/creatures.js`). Each has a speed, a level of unpredictability, and likes and dislikes for the weather.
- **When.** While the colony has a finished **Racetrack** (Parks → Sports), a race runs every 30 real minutes, on the hour and half hour.
- **Announcement.** The Colony Log announces each race **2½ minutes before it starts**, and everyone watching gets a pop-up.
- **Betting.** Signed-in colonists open the **Races** tab and place one bet per race until the gates close. The odds come from form and the weather at race time, and the house keeps about 10%.
- **The race.** The server decides the result when the gates open. Everyone watches the same ~45 s race, in the tab and on the track itself. Winners are paid at the finish, and the Colony Log names the winner.
- **Cups.** In developer mode, **Make the next race a Cup** adds a bonus from the treasury, shared by everyone who backs the winner. If nobody does, it goes back to the treasury.

## Lottery

- **Starting one.** In developer mode, open the Races tab and use **Start a lottery**: choose when it's drawn (5 minutes to 24 hours), the ticket price, and an optional bonus from the treasury.
- **Tickets.** Colonists buy up to 10 tickets each.
- **The draw.** It's announced 2½ minutes before it happens. One ticket wins the whole pot: every ticket's price plus the bonus.

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

You need a **public** Instagram **Business or Creator** account. In developer view, **Citizens → Instagram connection** shows everything below and whether comments are arriving.

1. developers.facebook.com → **Create app** (Business type) → add **Instagram** → *API setup with Instagram business login*.
2. **Webhooks:** paste the Callback URL and Verify token from the game's Instagram panel, verify, and subscribe to **comments**.
3. Copy the **Instagram app secret** into Render → Environment as `IG_APP_SECRET` (you can put both the Meta and Instagram app secrets, separated by a comma).
4. **Generate token** for your account in the Meta dashboard, paste it into the game's panel, and tap **Connect**. That subscribes your account to comment webhooks; the token isn't stored.
5. Meta needs these pages for your app: `/privacy`, `/data-deletion`, `/terms` (set `CONTACT_EMAIL` to show an email on them).

In Development mode, Meta only sends comments from accounts with a role on the app (add a second account as an Instagram tester to try it). Comments from the public need **App Review** with Advanced Access for `instagram_business_manage_comments`, **Business Verification**, and the app switched to **Live**.

**Build votes:** mark your "what should we build tomorrow?" post, then read its comments:
`curl -X PUT https://YOUR-APP/api/admin/build-post -H "authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" -d '{"mediaId":"1789..."}'` and `GET /api/admin/requests` · `POST /api/admin/buildings/:id/finish|repair` · `POST /api/admin/construction/finish-all` · `POST /api/admin/bulldoze` · `POST /api/admin/citizens/bulk` · `PATCH /api/admin/citizens/:id` · `POST /api/admin/water` · `POST|DELETE /api/admin/vehicles` · `POST /api/admin/disasters` · `POST /api/admin/ruins/clear` · `PUT /api/admin/weather`.

## Settings

| Variable | Needed | What it's for |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `ADMIN_TOKEN` | yes | Your builder password (16+ characters) |
| `CRON_KEY` | for the ping | Secret for `/api/cron/tick` |
| `PGSSL` | on most clouds | `1` to connect to Postgres over SSL |
| `IG_VERIFY_TOKEN`, `IG_APP_SECRET` | for Instagram | Webhook handshake and signature check (`IG_APP_SECRET` may list two secrets, comma-separated) |
| `CONTACT_EMAIL` | no | Shown on the privacy and data deletion pages |
| `SPAWN_KEYWORD` | no | The comment word that moves people in (default `spawn`) |
| `REDIS_URL` | when running 2+ servers | Shares live updates between servers |
| `PG_POOL_SIZE` | no | Database connections per server (default 8) |
| `RATE_PER_MIN` | no | Requests per minute per visitor (default 240) |

## API

Public: `GET /api/meta` · `GET /api/chunks?keys=0_0,1_0` · `GET /api/citizens?q=prefix` · `GET /api/citizens/:handle` · `GET /health` · WebSocket `/ws` (send `{"type":"sub","chunks":["0_0"]}`)

Builder (header `Authorization: Bearer ADMIN_TOKEN`): `POST /api/admin/found` · `POST /api/admin/buildings` · `PATCH|DELETE /api/admin/buildings/:id` · `POST /api/admin/buildings/restore` · `POST /api/admin/roads` · `POST /api/admin/citizens` · `DELETE /api/admin/citizens/:id` · `PUT /api/admin/build-post` · `GET /api/admin/requests` · `POST /api/admin/buildings/:id/finish|repair` · `POST /api/admin/construction/finish-all` · `POST /api/admin/bulldoze` · `POST /api/admin/citizens/bulk` · `PATCH /api/admin/citizens/:id` · `POST /api/admin/water` · `POST|DELETE /api/admin/vehicles` · `POST /api/admin/disasters` · `POST /api/admin/ruins/clear` · `PUT /api/admin/weather`

## Adding to the city

- **A building:** one line in `shared/catalog.js` (about 190 buildings and 20 road types are there now, grouped into tabs). Give it homes, jobs or visitors and the queue, jobs and hangouts use it automatically.
- **A road, vehicle, disaster or water type:** one entry in `ROAD_TYPES`, `VEHICLE_TYPES`, `DISASTER_TYPES` or `WATER_TYPES` in the same file.
- **A database change:** add a new entry at the end of `MIGRATIONS` in `server/db.js`. Never edit an old one.
