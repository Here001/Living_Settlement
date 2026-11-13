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
- **Money:** jobs pay daily wages. Rent and 20% tax come out of wages and fund the treasury, along with a daily grant of 200. Unemployed residents live rent-free. Building costs coins from the treasury. The full picture, and the dials for tuning it, is under **The economy** below.
- **Only you build.** Open the site with `#builder` and enter your `ADMIN_TOKEN`. Everyone else gets a view-only city.

## Moving around the map

- **Pan, zoom, turn.**
  - Drag to move around, and pinch (or scroll) to zoom.
  - **Twist two fingers** about 40° to turn the map a quarter turn that way; keep twisting for another.
  - On a computer, the **⟳** button by Full screen turns it, and so do **Q** (left) and **E** (right).
- **How turning works.** The map turns in quarter turns, the way isometric games do. Free rotation would tip every building over sideways, because the buildings are drawn from one angle.
  - The ground, roads, water and people turn exactly.
  - Each building and vehicle is redrawn upright from the new side (`VIEW`, `toView`, `asView` in `public/index.html`).
  - The spot under your fingers stays put, and each device remembers its last turn.

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


### 📊 Stats (developer only)

The **Stats** tab in the developer's toolbar shows how the colony is really being played, so prices and rewards can be tuned from real data (`server/stats.js`, `GET /api/admin/stats?days=7|30|90`). "Players" are colonists who have set a password.

- **Players:** played today, this week, last 30 days, signed up in all, new this week, and a bar chart of daily players (hover a bar for that day's count and new sign-ups).
- **Coins in circulation:** players' cash, savings, average per player, the treasury and townspeople's coins, and players' coins over time (saved every game day).
- **Where coins come from / where coins go / between players:** every coin earned or spent, by kind (extra shifts, deliveries, fishing, daily rewards, casino, robberies, fares, car and building purchases, bills, fines, gifts, pickpocketing…), with coins, times, players and **Came back** (how many who tried it did it again on another day). Wages are shown as what players' jobs pay in a real day right now.
- **Which ways to earn players use:** the share of this week's players who used each way to earn.
- **Where players drop off:** started claiming → proved it → set a password, then the share of players who got a job, collected a daily reward, earned on the side, went somewhere, used the Bank, came back another day, bought a car or a building.
- **When players were last here**, and **Do new players come back?** (by sign-up day: the next day, days 2–3 and days 6–8).
- **Economy health** (at the top): all the coins in the colony (players plus treasury), how fast that grew over the last real day against the 2% aim, the stabiliser's dial, how much the richest 10% of players hold, the treasury (shown in red as a debt if it's below zero), today's wealth tax and how many players hold a status title. A bar chart shows the coins over the last 7 days (hover a bar for the treasury, the dial and the top 10%'s share at that hour). **− 10%**, **Reset to 100%** and **+ 10%** set the dial by hand, and **Measure now** takes a reading straight away. See **The economy** below.
- Data is kept in `activity` (who played each real day), `flows` and `flow_players` (coins by kind and day), `snapshots` (money each day) and `econ_snaps` (the hourly economy readings, kept for 30 days). Tracking starts from this version, so earlier days are empty.

### 💰 Accounts (developer only)

The **Accounts** tab in the developer's toolbar lists every player (anyone who has set a password) with their cash, bank and total, and totals for the whole colony at the top. Search by @handle or name. A 🔒 marks someone in jail, their status badge shows by their name, and 💸 with a number shows how many crimes or heists they've pulled today. A cash figure in red means they owe coins.

Tap a player to see everything about their money: cash, bank, total and daily pay, what came in and went out in the last 24 hours, a table of where their money went by kind (all time), and their full history, newest first and grouped by day (**Show older** loads more). It reads from the same `ledger` as the players' own Cash flow (`GET /api/admin/accounts` and `/api/admin/accounts/:handle`, in `server/index.js`).

## Adjusting a colonist's coins

In developer mode, every colonist's card has a **Coins** box. **Add** gives them coins out of the treasury; **Take away** returns coins to the treasury. The colony's total stays the same.

## Railways and trains

Rail is laid exactly like roads, from **Roads → Rail**, point to point or freehand, in drafts or live. It is undone with undo, removed with the road eraser, and bridges over water.
- **Railway** (80 coins a tile): track that joins up with the rail tiles around it, with curves at corners, junctions where lines meet, and buffer stops at the ends.
- **Station platform** (120): trains stop here. A run of platform tiles is one station; the train stops in its middle.
- **Level crossing** (100): where a road meets the rails. Laying rail across a street (or a street across rail) makes one automatically, so the road isn't cut. Cars drive over it, and its lights flash while a train is near.

Trains start running as soon as there's a line at least 4 tiles long. Nothing needs placing:
- A **closed ring** runs as a loop. Long loops get up to 4 trains.
- A **line with two ends** gets a shuttle that runs end to end and turns back at the buffers.
- Each **branch** off a line gets its own train.
- Trains speed up out of a station, slow into the next, and wait there for a few game minutes.
- Every viewer works out the same timetable from the clock, so everyone sees the same train in the same place.
- Each line has its own colours.

Cars can't use railway or platform tiles, and people cross the tracks only when they have to. The code is in `public/index.html`, under "railways" and "trains"; the rail types are in `ROAD_TYPES` in `shared/catalog.js`.

## The colony treasury

In developer mode, the coin counter at the top shows the treasury. **Tap it** to add coins (with quick +1,000 / +10,000 / +100,000 / +1,000,000 buttons, or any amount up to 10 million at a time) or to take some out. Added coins are new money; they aren't taken from anyone. The treasury pays wages, bank interest, daily rewards, casino and race winnings, crime loot, and everything in the Earn tab. For a player, tapping their own coin counter opens their Earn tab.

The treasury never makes up coins of its own. It can go **into debt** (below zero) instead, and pays it back from the taxes, fees and bills that keep coming in. While it's in debt, anything that pays "up to what the treasury holds" (crime loot, daily rewards, Earn-tab payouts, interest) pays nothing. If it can't cover every owner's rent and profit for the day, each owner gets the same share of what it has. You can still top it up by hand.

## The economy

The economy was rebuilt so coins can't pile up without limit, and so it can be tuned from real numbers. The dials are at the bottom of `shared/rules.js`, under "The economy's dials".

- **Where coins go in and out.** Coins move between players and the treasury; the treasury doesn't create them (see above). It takes in tax, rent's cut, fares, bills, fees, fines, purchases, the casino's edge, wealth tax and status titles, and pays out wages, rewards, loot, rents, profits and interest.
- **Wages.** Take-home pay is salary minus 20% tax minus rent (`taxOf()` and `netOf()` in `shared/rules.js`). Before, the tax was added on top of the salary. When the live server first starts on this version it cuts everyone's existing pay to match, once (`world.taxOutOfWages()`, remembered as `meta.taxOut`); take-home pay drops noticeably (by about 44% on the test town). If pay feels too low, the 20% is `TAX_RATE` in `shared/rules.js`.
- **Crime pays less the more you do it.** The first 8 solo crimes that come off each real day pay in full (`CRIME_FREE`); after that each pays 4% less than the one before (`CRIME_DECAY`), but never less than three quarters (`CRIME_FLOOR`). Heists don't count towards it and are never cut. It's back to full pay the next day (midnight UTC). The Crime tab shows how many you've pulled today and what the next one pays. A hot streak (+15% a job in a row) and criminal rank (+3% a rank) push takings up, but the treasury cap below still applies.
- **Loot is capped by the treasury.** One job can take at most a share of what the treasury holds (`CRIME_SHARE`): robbing a shop 3%, conning a tourist 1%, an ATM 5%, an armoured truck 10%, a jailbreak bounty 4% and a bank heist 20%. Robbing the Mayor is capped by the Mayor's own cash instead. So one crew can't empty the town, and nothing pays while the treasury is in debt.
- **Wealth tax.** 0.5% a real day on cash plus savings above 250,000 (`WEALTH_FREE` and `WEALTH_RATE`), taken a little each game day (`economy.day()` in `server/economy.js`) and paid to the treasury. It shows in Cash flow as wealth tax. Below 250,000 nobody pays anything.
- **Status titles.** Something worth spending on for the richest players: titles bought for cash, each 4 times the price of the last (`STATUS`): 🥉 Bronze 50,000, 🥈 Silver 200,000, 🥇 Gold 800,000, 💠 Platinum 3,200,000, 💎 Diamond 12,800,000, 👑 Legend 51,200,000. They're only for show. Buy the next one from the **👛 Wallet** tab, which shows the whole ladder (`POST /api/me/status`); the Colony Log announces it, and the coins go to the treasury. The badge shows on your card and next to your name everywhere else people see it: Town Square posts, the Colonists list, leaderboards, chats (the chat list, the top of a conversation, names in group chats, group members, Online now) and the developer's Accounts list. Pages that are already open pick up a new title straight away from its Colony Log entry; everyone else gets the list of title holders when they load the page (`GET /api/status`, kept for 15 seconds).
- **The stabiliser.** Every hour (`econTick()` in `server/stats.js`) the server counts all the coins in the colony and works out how fast that's growing over a real day. It aims for about 2% a day (new players and building need some growth), give or take 1% (`ECON`). Growing faster than that, it turns a dial down 4%; slower, it turns it up 4%; at most once an hour, and always between 50% and 150%. The dial scales crime takings, heist loot, daily rewards and bank interest. Wages, prices and bills are never touched. The developer sees it all under **Economy health** in the Stats tab, and can set the dial by hand (`POST /api/admin/economy` with `{f}`, or `{measure:true}` to measure now); the stabiliser carries on nudging from there.
- **Tuning.** Watch Economy health for a day or two, then adjust `CRIME_SHARE`, `CRIME_DECAY`, `CRIME_FREE`, the hot streak (`HOT_STEP`), contract rewards (`CONTRACT_PAY`), the wealth tax (`WEALTH_RATE`, `WEALTH_FREE`), the growth aim (`ECON.target`) or the wage tax (`TAX_RATE`).

## Renaming the colony

In developer mode, the Town Square has **🪧 Colony name**. Renaming changes the name at the top of the screen, in the Colony Log ("Old name is now called New name") and on shared pictures, and official posts then come from "<name> Updates". The colony that was called Man-Landing was renamed **Gliese-12b** automatically (database migration 32).

## Removing people and starting over

In developer view, **Colonists** (at the bottom) has:
- **Remove these**: paste usernames to remove several colonists at once. Their homes and jobs open up for others.
- **Remove everyone except me**: clears all colonists but keeps the buildings.
- **Reset colony**: type `RESET` to wipe the whole colony (map, colonists, everyone's land and offers, land auctions, news, Town Square messages, drafts) and return to "Found your colony". The Instagram connection is kept. Everyone watching is reloaded automatically.

## Town Square

Colonists who have claimed their avatar (proved it's them and set a password) can post short messages (up to 280 characters) in **Town Square → Posts**; everyone sees them live with a blue ✓. One message per 15 seconds per colonist, no links. Colonists can delete their own; the developer can delete any.

Colonists can set a **name** (first and last, or just one) on their own card; it shows on their avatar, card and posts, while the @username stays for search. The developer can change anyone's name from their card.

In developer view, the Town Square box posts **official updates as "<colony name> Updates"** (Gliese-12b Updates) (logo picture, gold Official badge, up to 1000 characters). Tick **Pin to top** to keep it above everything; **Pin / Unpin** works on any post, up to 3 at a time.

New colonists start with **0 coins** and earn from their job. Coins are private: a colonist sees only their own, and only the developer sees the colony treasury.

## The bottom bar

Players see **Town Square · My card · Colonists · Races** (plus **Chats** once signed in).
- **My card** opens your own colonist card straight away, wherever you are on the map, with no need to find your avatar. Tap it again to close the card. It uses the colonist you signed in as (or the one this phone remembers); if there isn't one yet, it opens Colonists so you can find yourself.
- **Top** (the leaderboards) now lives inside Town Square, as a tab: **Posts · News flash · Top · The story**.

## News flash

Town Square has a **News flash** tab between Posts and The story. It shows everything that's happened lately, newest first and grouped by day:
- gifts (who gifted whom, never the amount)
- new pets
- streaks and badges
- casino, lottery and race wins, and weekly champions
- arrests
- colony events and major construction

At the top, **This week's leaders** shows the current leader of each weekly board (Racer, Luckiest, Wanted, Generous). Filters narrow the list to Gifts & pets, Wins, Crime or Colony, and every @name opens that colonist. The list holds the latest 150 entries.

Property and car purchases still aren't announced; tap a building to see its owner.

## The story and the intro

New visitors see an opening when they first arrive. Put a narrated video at `public/intro.mp4` (H.264 MP4, ideally under 40 MB) and it plays full screen with a **Begin** button (so sound is allowed) and **Skip**; until then, the story plays as title cards. Anyone can replay it from **Town Square → The story**, which also holds the full story text.

The colony is themed around the story: new followers **arrive aboard the ark and wait in cryosleep** until there's a home, colonists land at the **landing station** (it replaced the old campfire automatically), and the news is the **Colony Log**.

What makes the Colony Log:
- **Major construction only.** New industry, public services, landmarks, casinos, racetracks, malls and other big venues, plus anything costing 4,000 coins or more, when started, finished, rebuilt or demolished (`majorBuilding()` in `shared/rules.js`). Roads, water, trees, plants, decorations, small homes and small shops never appear, and a developer update is announced only by the major buildings in it.
- **No purchases.** Buying a property or a car isn't announced (new pets are, in the News flash); to see who owns a building, tap it and look for **Owner** on its card. Gifts are still announced (who gifted whom, not the amount). Migration 33 removed the old purchase and small-build entries.

## Joining without Instagram

People who aren't on Instagram can join from the website: **Find me** (or **Find my colonist** / **join here** at the end of the intro) opens **Join the colony**.

- **A username and password.** Pick a username (3+ characters: letters, numbers, dots, underscores; names like admin, mayor or colony are reserved), a password (6+), and Man or Woman. The colonist arrives aboard the ark like a SPAWN (first free home, a job nearby), already claimed, and signed in (`POST /api/signup`).
- **Continue with Google** (shown once it's set up). The first time, Google suggests a username from your email, which you can change; after that the button just signs you in (`POST /api/auth/google`; the token is checked with Google).
- **Against fake accounts:** at most 3 new colonists per network a day (`SIGNUPS_PER_IP`), and an optional Cloudflare "I am human" check.
- **Instagram names come first.** Website players show 🌐 on their card. If an Instagram account with the same username later comments SPAWN, the website player is renamed `name_web` (keeping everything else, and the same password) and gets a notice telling them.
- **Settings** (environment variables on the server):
  - `GOOGLE_CLIENT_ID`: in Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID → Web application, with `https://playresurgence.com` under Authorized JavaScript origins. Copy the Client ID (no secret needed).
  - `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET`: in the Cloudflare dashboard → Turnstile → Add site (free). Without them there's no human check (only the per-network limit).
  - `SIGNUPS_PER_IP` (default 3).

## Players: prove it's you, then set a password

A follower opens the city, finds their citizen and taps **This is me**. The site gives them a one-time code like `CLAIM 482913`.
They comment it on any of your Instagram posts **from their own account**. After setting a password, they choose their colonist's gender, once (the developer can still change it later). The webhook sees the comment, checks it came from that exact username, and the page moves on by itself to "Choose a password". From then on they log in with that password, and it's what will unlock special actions like the casino or crime.

- The code is public, but useless to anyone else: it only counts when the avatar's own account posts it, and only the browser that asked for it can then set the password.
- **Forgot password:** the same steps reset it, and old logins are signed out.
- **Before Instagram is connected, or to settle a dispute:** on a citizen's card, developer view has **Copy setup link**, a one-time link (valid 24 hours) that lets that person set a password directly. **Clear password** locks an avatar until its owner proves it again.
- Passwords are stored hashed (scrypt). After 8 wrong guesses, a username is locked for 15 minutes.

## Jobs

**Shifts and bedtimes.** Not everyone keeps the same hours (`shiftOf()` and `owlOf()` in `shared/rules.js`, used by both the map and the server):

| Shift | Hours (game time) | Who works it |
|---|---|---|
| Day | 07:50–16:15, lunch around noon | everyone at offices, banks, schools, the town hall, courts, libraries, the post office and museums; most others |
| Evening | 14:00–22:00, dinner break around 18:00 | about 3 in 10 at shops, cafés, cinemas, gyms, stadiums and other places to go out; a quarter at places that never close |
| Night | 22:00–06:00, a break around 03:00 | a quarter at places that never close: services (hospital, police, fire…), utilities, industry, hotels, petrol stations, the casino, taverns and diners |

- Which shift someone works is fixed for each job they hold, so taking a different job can change it. A colonist's card shows **Hours** (for example "Night shift, 22:00–06:00"), and the Work tab shows the hours of your job and of every opening.
- Night-shift workers sleep from about 07:00 to 15:00 and run errands in the late afternoon. Evening-shift workers sleep until about 08:00 and go out in the morning.
- **Bedtimes vary** too: early birds head home an hour early, night owls up to an hour and a half late, so the colony doesn't all go to bed at once.
- Pickpocketing follows the same hours: a night-shift worker is safe at home in the morning and out and about in the late afternoon.

- **Automatic jobs.** Colonists start with 0 coins. When they move into a home, the game gives them the nearest free job. Each game day they take home their salary minus 20% tax minus their rent (`netOf()` in `shared/rules.js`). The tax comes out of the salary; it isn't added on top.
- **The Work box.** A signed-in colonist's own card has a Work box. It shows their job and take-home pay, a **Quit** button, and **Find a job**: a list of open jobs nearest their home, each with take-home pay and distance.
- **Taking a job.** Colonists can take a new job once per game day. Quitting is always allowed, but doesn't reset that limit.
- **After quitting.** Automatic hiring leaves them alone until they choose another job. If their workplace is demolished, automatic hiring takes over again.
- **Claimed colonists get priority.** A full workplace still counts as open if a place in it is held by an automatically placed colonist who hasn't claimed their avatar. That colonist goes back to looking for work. Claimed colonists and anyone the developer placed by hand are never pushed out.

## Casino

- **Opening.** The casino is played only at a casino: tap a finished **Casino** on the map and press **🎰 Play here**, and the games open right on the casino's card (there's no casino tab on the player card).
- **The games:**
  - **Coin flip:** pick heads or tails, win 1.9×.
  - **Dice:** pick 1 to 6, win 5.7×.
  - **Slots:** three in a row pays 5× (🍒) up to 100× (🚀🚀🚀); two 🍒 pays 1.5×.
  - **Roulette:** a European wheel (0–36). Red/black, odd/even and 1–18/19–36 pay 2×, a dozen pays 3×, and a single number pays 36×. The house edge is 2.7%.
  - **Blackjack:** deal, then **Hit**, **Stand**, or **Double** on your first two cards. One deck per hand and no splits. The dealer stands on 17. A win pays 2×, blackjack 2.5×, and a push returns the bet.
  - **Rocket:** after a 3-second countdown the multiplier climbs from 1× (2× at about 6 s, 10× at about 19 s, up to 100×). **Cash out** before it blows up, or set an automatic cash-out target.
    - It reaches m× with probability 0.97/m, a 3% house edge on every target.
    - The crash point is decided on the server at launch and only revealed afterwards.
- **Table games.** Blackjack and Rocket each have their own table (`server/tables.js`). A game in progress is kept in `citizens.casino_game`, so it survives a reload. Only one table game can be in progress at a time.
- **Odds and fairness.**
  - Every game pays back about 95% over time.
  - The house edge goes into the colony treasury, and wins are paid from it.
  - The server rolls the dice, so nobody can cheat from their browser.
- **Limits.** One bet every ~1 second, and at most 100,000 coins per bet. There is no daily limit.
- **Visits.** While playing, and for 10 minutes after their last bet, the colonist is inside the Casino for everyone to see.
- **Rocket cash-outs** count from the moment you tap (your phone sends it), not when the request reaches the server, so a slow connection never cashes you out higher than you saw, or after it blew up. A tap more than 1.2 seconds old isn't believed. The button reacts on touch, the multiplier freezes on screen at once, and the flight animates every frame.
- **Announcements.** Big wins (200+ coins of profit, or 20×+ on a small bet) go in the Colony Log.


### Mines, Plinko, Baccarat and Hi-Lo

- **Mines:** pick 1, 3, 5, 10 or 20 mines hidden in 25 tiles, then open tiles one by one. Each gem raises the multiplier (the fair odds less 3%, `minesMultiple()` in `shared/casino.js`). Cash out any time; hit a mine and the bet is lost. The mines are placed on the server and only shown when the game ends.
- **Baccarat:** bet on the Player hand, the Banker hand or a tie; standard drawing rules, cards from an endless shoe. Player pays 2×, Banker 1.95×, Tie 9× (a tie gives Player and Banker bets back), about 99% back on Player or Banker, like the real game.
- **Hi-Lo:** a card is dealt; guess whether the next is higher or lower (the same rank counts as right). Each right guess multiplies your winnings by 0.97 ÷ its chance, so a likely call pays little and a long shot a lot. Cash out any time; one wrong guess loses the bet. At most 20 guesses.
- **Plinko:** pick low, medium or high risk and drop a ball through 12 rows of pegs. The 13 slots pay 0.4×–10× (low), 0.3×–33× (medium) or 0.1×–170× (high), each table returning about 96–97% on average.

## 🎮 Game House

A new building (Shops → Going out, 3×2, 8 game hosts, 9,000 to build) where colonists play games. Tap a Game House on the map and press **🎮 Play here**: the games open full screen on the building's own card, never on the player card. Playing walks your avatar there for 10 minutes. The house is the colony treasury; Game House bets are capped at 20,000 (`server/gamehouse.js`, `shared/games.js`).

| Game | How it works | Pays |
|---|---|---|
| 🎡 Lucky wheel (at the Casino) | One free spin every real day (50 to 5,000 coins, about 650 on average). Paid spins: 24 slices from 0× to 8×. | about 94% back on paid spins |
| 🎟️ Scratch cards (at the Casino) | Cards at 200, 1,000 or 5,000. Scratch 9 boxes; three of a kind wins. | 🍀 1×, ⭐ 2×, 💎 5×, 🚀 20×, 👑 100× (about 88% back) |
| ⚽ Penalty shootout | A floodlit stadium with a crowd, ad boards and a netted goal. Five kicks: pick one of six spots each time; a real goalkeeper (kit number 1, big gloves) bounces on his line, then dives full-length or jumps for the spot he guessed while the ball spins in. Corners are harder to save but easier to miss. The keeper dives in a fixed mix that makes every spot score about 69% of the time, so no way of shooting beats the house. | 5 goals 3.5×, 4 goals your bet back (about 91–93%) |
| 🎯 Darts | Three darts at a tournament board: sisal texture, a metal wire spider and a number ring, with a crosshair while you aim and proper darts (barrel and flights) where they land. Tap where to aim; the server adds a wobble (smaller than before: `DART_WOBBLE` 0.10, was 0.13). | 140+ 12×, 100+ 3×, 85+ 1.6×, 75+ your bet back (about 86–88% for the best aim; retuned for the steadier hand) |

- **The pool and snooker table** (snooker practice, snooker 1 v 1, 8-ball and 9-ball) is drawn on a canvas at the phone's full resolution: grained wood rails with pearl diamonds, leather pocket rims, a felt cloth with cushion shadows, and shaded balls (red snooker balls; numbered pool balls, with stripes on 9–15). Drawing on a canvas also fixed stray lines that appeared on some phones while rotating.
  - **Aim with the stick itself:** press on the cue and swing it round the white ball. Touching anywhere else on the table does nothing. A line and ghost ball show where the cue ball meets the first ball, with lines for where that ball and the cue ball go. In 9-ball (and in 8-ball when you're on the 8) the ball you must hit is ringed.
  - **Fine aim wheel:** the ridged wheel on the right rolls the stick by a tiny amount as you drag it up or down (or scroll): about a degree for a full-length drag.
  - **Power:** drag the cue down in the bar on the left and let go to shoot. The cue in the bar slides down with your finger: fully visible at 0%, gone at 100%.
  - **Ball in hand:** when the rules give you the cue ball (the break, or after the other player fouls), drag the white ball to where you want it: inside the D in snooker, behind the head string for a pool break, anywhere on the table after a pool foul. The allowed area is outlined.
  - **Physics and replays:** balls slow down with a little rolling resistance plus drag that grows with speed (`shared/snooker.js`), so a gentle shot glides for about 3 s and a hard one runs several lengths of the table. The server sends positions 30 times a second and the phone slides the balls between them at its own frame rate. Every shot is replayed in turn, the computer's too, and the screen isn't rebuilt while a replay runs.
  - **Spin:** touch the white ball on the right; above the middle is top spin, below is back spin, left or right is side spin. It goes back to the centre after every shot.
- **🎱 Snooker practice** is free: six reds racked in a triangle, pot 3 in 6 shots. Swing the cue to aim, fine-tune with the wheel, pull the power bar and let go. The server simulates the shot (`shared/snooker.js`, with a tiny wobble) and the phone replays it. The first practice win each real day pays 300 coins. It isn't staked, because a perfect-aim robot wins about 65% of the time; staked snooker is player against player.

### Tables: playing each other

Whot, Ludo, Ayo, Snooker, 8-ball and 9-ball pool (at a Game House) and Texas Hold'em (on the Casino's **Hold'em** tab) are played between colonists at tables (`server/gametables.js`, rules in `shared/boardgames.js`).

- **Open a table** with a stake (0 for a friendly game, up to 50,000) and, for Whot and Ludo, 2 to 4 players (Hold'em 2 to 6); Ludo can be quick (2 tokens each) or classic (4). Others see it in the list and **Join**; the game starts when every seat is taken. Leaving before it starts refunds your stake; an unfilled table closes and refunds after 15 minutes.
- **Stakes are held by the table**, not the treasury. The winner takes the pot less 5% for the house (the treasury); a draw splits it. In Hold'em, bets and calls come out of your pocket as you make them.
- **45 seconds a turn.** If you're slow, a sensible move is made for you (Whot: draw; Ludo: roll, then the best token; Ayo: the pit that captures most; Snooker and pool: a sensible shot at a ball you may hit; Hold'em: check or fold), and your seat shows ⚠️. **Miss two turns in a match and you forfeit it:** in a two-player game your opponent wins; with more players the game carries on without you. Leaving mid-game forfeits too.
- **🤖 Play the computer (free):** a friendly game against computer players starts at once. It never pays coins, so it can't be farmed. The computer doesn't move instantly: its turn falls due a moment after yours (after your shot has rolled to a stop in the cue games), so you watch each of its moves; whoever is looking at the table (or the 10-second sweep) sets it off. If its move ever fails it falls back to a simple move instead of stalling.
- **The games:**
  - **Whot**: the Nigerian deck (circles, triangles, crosses, squares, stars and five Whot cards). Match the shape or number; 1 hold on, 2 pick two, 5 pick three, 8 suspension, 14 general market, 20 Whot (call a shape). First to empty their hand wins; if the cards run out (or after 300 moves) the lowest hand wins. Cards look like the printed deck (cream with maroon shapes and corner numbers; Whot cards in maroon); the market and pile sit on a green table, playable cards in your hand are lifted, and a played card lands on the pile.
  - **Street Whot** (pick it when opening a Whot table): no 2s, 14s or Whot cards, and 5 and 8 are ordinary cards (1 still holds on). The game ends the moment the market runs out: everyone adds up the numbers in their hand and the lowest total wins. At the end of any Whot game both players see each other's cards and totals, e.g. "total = 16".
  - **Ludo**: roll two dice at once and use each one on any token (the same token twice, or two different ones); tap a die to choose it, then a token. A 6 brings a token out. Land on a lone opponent off the star squares to send it home. Double six, a capture or getting a token home earns another roll. All your tokens home wins. The board is drawn with a wooden frame, shaded yards with token wells, arrowed start squares, starred safe squares and glossy pawns; tokens you can move bounce, a moved token walks square by square, and the dice tumble when rolled.
  - **Ayo**: six pits a side, four pebbles each. Sow anticlockwise; capture 2s and 3s on the opponent's side (and the pits before them). Over 24 wins. When a player's side runs empty, they forfeit the pebbles left on the other side, which go to their opponent's score. After 200 moves each player keeps what's on their side. Every move (yours and the other player's) is replayed: the pebbles are lifted, dropped into each pit in turn with one flying across, and any capture flies to the store.
  - **Snooker** (official rules, `shared/cuegames.js`): 15 reds and the six colours on their spots; the cue ball starts in hand in the D. Pot a red (1), then any colour (yellow 2, green 3, brown 4, blue 5, pink 6, black 7), which is re-spotted (on its own spot, else the highest free one); then red again. When the reds are gone the colours are taken in order and stay down. Fouls (missing everything, hitting or potting the wrong ball, going in-off) give the opponent the value of the ball on or the balls involved, at least 4, and pass the turn; after an in-off the cue ball is played from the D. The frame ends when the black goes down (a foul on the last black ends it too); a tie re-spots the black. Not modelled: free balls, the miss rule, and asking the offender to play again.
  - **8-ball pool** (WPA rules): 15 balls racked with the 8 in the middle; break from behind the head string. A legal break pots a ball or drives at least four to the cushions. The table stays open after the break; the first ball potted on a fair shot after it decides solids (1–7) or stripes (9–15). Every shot must hit one of your balls first (on an open table, anything but the 8), then pot a ball or send a ball to a cushion. Fouls (a scratch, the wrong ball first, no cushion) give the opponent ball in hand anywhere. Clear your group, then sink the 8 to win; the 8 down early or on a foul loses. An 8 on the break comes back to the foot spot. Any pocket counts (no called pockets).
  - **9-ball pool** (WPA rules): balls 1–9 in a diamond with the 1 in front and the 9 in the middle; break from behind the head string (pot a ball or drive four to the cushions). Always hit the lowest ball first, then pot a ball or reach a cushion. Pot the 9 on a fair shot (even off another ball, even on the break) to win; a 9 potted on a foul goes back to the foot spot. A foul gives ball in hand anywhere, and three fouls in a row lose the game. No push-out.
  - The cue games end on the score after 400 shots if they ever get that far.
  - **Texas Hold'em**: one hand per table, fixed bets. Everyone antes the stake; a bet or raise is the stake (twice it on the turn and river), three raises a round. Best five of seven cards wins.
- Every table's stakes, winnings and the house's share show in the developer's Stats tab. Every stake and win is recorded in the developer's Stats tab (as "<game> stakes" and "<game> winnings").

## Your own card: Work · Crime · Go here

A signed-in colonist with a home sees these on their own card. The tab buttons (Earn, Work, Home, Wallet, Cars, Crime, Stars) work like switches: they're all closed when the card opens, a tap opens one, and tapping it again closes it.

On a phone only one thing is open at a time: tapping a bottom button (Town Square, Colonists, Races, Chats) closes an open card, and opening a card closes the open panel, so the card never gets pushed up the screen.

Every colonist's card has a full-screen button beside Share and ×, like Town Square, chat and the Casino. It stays full screen as you switch tabs, and closing the card puts it back to normal size.

- **Go here.** Every building's card (except the jail, police stations, trees and street furniture) shows **🚶 Go here** and how far it is from your colonist right now, in miles. Pressing it sends them there for 4 game hours (about 5 real minutes), and the camera locks onto them, walking, driving or in a cab, until they arrive ("📍 You've arrived"). On your own home it says **🏠 Go home**. Everyone sees them there. Other colonists' cards have **Visit their home** too.
- **Getting there.** Colonists travel to wherever they're going, whether that's going out, the Casino or the Jail, and come back the same way afterwards.
  - Short trips (under 14 tiles) are walked.
  - Longer ones are driven by colonists who own a car; everyone else takes a cab.
  - Anyone caught for a crime is driven to the Jail in a police car with its lights on.
  - **They always set off from where they are.** The phone tells the server where your colonist is when you send them somewhere (`from` on `POST /api/me/visit` and `/api/me/earn/*`, kept as `visit_origin`). A second trip starts from the first place, and changing your mind mid-trip carries on from that spot on the road instead of jumping back home.
  - **Fares** (`tripFare()` in `shared/rules.js`), charged in cash when the trip starts, for the way there and back:
    - 🚶 walking (under 14 tiles): free
    - 🚕 cab: 10 coins plus 6 a mile
    - 🚗 your own car: fuel, 2 coins a mile
    - Not enough cash for the fare? You walk, for free. The Go here line shows the fare before you go, and fares go to the treasury.
- **Crime.** After any crime, win or lose, you lie low for 20 seconds before the next one.
  - **Built to keep you coming back** (`shared/rules.js`, "Keeping crime worth coming back to"; `server/crimeprog.js`):
    - **🔥 Hot streak:** each job in a row that comes off makes the next one harder, but it pays 15% more for each (up to +60% at 4 in a row). Getting caught ends the streak. The game's intro screen shows the multiplier.
    - **🔁 Go again:** after every job (unless you're jailed), the result screen's button counts down from 20, filling up as it goes, and starts the next game the moment it reaches 0. The 20 seconds always start when the game ends.
    - **Criminal ranks:** every real job earns XP (40 for a clean getaway, 30 for some of it, 15 for nothing, 10 if caught, plus 5 for each job in your streak; 30 for playing your part in a heist). The ranks: 🧤 Pickpocket, 🃏 Hustler (100 XP), 🐈‍⬛ Prowler (300), 🕶️ Smooth operator (700), 🎩 Ringleader (1,500), 🧠 Mastermind (3,000), ♠️ Kingpin (6,000), 🌒 Legend of Gliese (12,000). Each rank adds 3% to everything you take, for good. The Colony Log announces each new rank, and the result screen shows the XP bar filling.
    - **📋 Daily contracts:** three challenges every day (midnight UTC), one easy, one medium and one hard, different for each player: for example "Try 3 jobs today", "Rob a shop without the staff's eye ever getting past half", "Hack an ATM without a single wrong move", "Make a Clean getaway", "Play your part in a heist". Easy pays 300 coins and 30 XP, medium 600 and 60 XP, hard 1,000 and 100 XP, and all three pay a 1,000-coin, 100-XP bonus on top. The coins come from the treasury, scaled by the stabiliser. Nobody gets a contract the colony can't offer (no shop to rob, no Bank).
    - **🏅 Personal bests:** your best score in each game is kept; the result screen tells you when you beat it.
    - **The Crime tab** keeps its usual layout: your rank in one line with a **📋 Contracts** button, your streak and jobs today, then each game with its odds and 🎮 Play, then the heists. Today's contracts pop up by themselves the first time you open the tab each day. The table of success percentages, the fine explanation and the pickpocket search box are gone from the tab: pickpocketing is done from the other colonist's card (**Pick their pocket**).
  - **Crimes are mini games.** Robbing a shop, conning a tourist and hacking an ATM each open a full-screen game, and how well you play decides whether you get away and how much you take. The police odds below set how hard it is. The games run on the phone, but the server replays every move (`shared/minigames.js`, shared by both) to decide the result, so they can't be faked. **Practise (free)** plays any of them for nothing first, and heist parts can be practised from the Crime tab too.
    - **🛒 Rob the shop:** a cut-away 3D shop on the real map. Sneak in, empty the till and get out, staying out of the staff's yellow view cones and away from cameras and lasers. Grabbing extra goods off the shelves on the way pays more.
      - **The shop:** polished tiled floor, stocked shelves (packs, tins and bottles, yellow price strips, aisle signs), lit drinks fridges along the back wall, a checkout with a conveyor belt and glowing till, pools of ceiling light, and a glowing EXIT sign. It's all merged into a handful of meshes and a few shared textures, so it stays smooth on cheap phones.
      - **Red lasers** blink on and off across the aisles, with a red glow and red light on the floor. Walk through one while it's on and it beeps: the alarm meter jumps, and the nearest member of staff who isn't already busy walks over (along the aisles, a bit quicker than usual, with ❗ over their head), looks around the spot, then walks back and carries on their round. If you're still there, they'll see you. This is part of the game's rules (`staffAt()` in `shared/minigames.js`), so the server's replay agrees with what you saw.
    - **🎭 Con a tourist:** a real conversation (`genCon`, `conStep` in `shared/minigames.js`). Each tourist is somebody, with a name and a home world: thirteen kinds in all: a collector, a bargain hunter, honeymooners, a geology professor, an executive in a hurry, a nervous first-timer, an influencer, a retired miner, a broke student, a conspiracy theorist, a shuttle pilot, a grandparent after a present and an art dealer. Each has approaches they love and ones they can't stand (a professor wants proof and has no time for jokes; an executive hates long stories; a conspiracy theorist doesn't trust certificates), their own way of saying hello, some worries in their own words ("Anyone can print a certificate."), and their own last word when they buy or walk off.
      - Every turn they say what's on their mind: "How do I know it's real?", "That's a lot of money", "I've got a shuttle to catch", "What would I even do with it?", "Why should I trust a stranger?", "I should ask my partner first", "Can I even take this off-planet?" (pilots and dealers worry about customs), "Would it make a good present?" (grandparents), or, once they're warming up, "I'm tempted…". What comes up follows the talk: suspicious tourists want proof or wonder about you; warm ones get to the price, their partner, or the close.
      - You pick one of four lines from eight approaches (📜 facts, 🔦 show it, 📖 a story, 🌹 flattery, 😄 charm, 🏷️ a deal, ⏳ hurry them, 👂 listen), each written for the worry in front of you (most have two or more wordings, so the talk doesn't repeat itself), and say it with the marker in the green. Answer what they actually asked and trust climbs; dodge it and they ask again, more suspicious; say the same kind of thing twice and it wears thin.
      - They react to what you said ("Number 17… with a certificate? Okay." / "Cheap? Then it's fake."), and their face shows the mood: curious, warming up, suspicious, annoyed, impatient or eager. Trust full: sold. Suspicion full: they walk. Seven turns.
    - **🏧 Hack the ATM:** rewire it (each wire to the socket with its colour's symbol), then tap back the code the keypad flashes. Win and the next one is harder: the sockets shift around and a fuse burns down.
  - **A winning streak makes it harder, gently, but only in the same game.** While you keep playing the same game, every two wins in a row add one difficulty step (two at most); pick a different game and it starts at its usual difficulty (the streak's extra pay carries on). Heist parts always start at their usual difficulty. and each win takes 3 points off the odds (for up to three wins), so the games stay winnable while the pay climbs. Getting caught wipes the streak (`crime_streak`). The games themselves also ramp up gradually: in the shop a second member of staff only appears at the hardest level, cameras come in one at a time, and there's a little more time; the ATM's code grows more slowly; and the getaway leaves more room between cars.
  - **How they look** (`public/world3d.js`): people have rounded limbs, hands, shoes, hair and a painted face, and their clothes a fabric weave. Cars are real car shapes (bonnet, sloped windscreen, roof, boot, wheel arches) with wrap-round glass, tyres on spoked alloys that turn as they roll, lights, grille, mirrors, door lines and number plates; police cars carry a blue band, POLICE on the doors and a flashing light bar, and the getaway car racing stripes. The getaway street has zebra crossings with traffic lights, worn asphalt and manholes, bus stops, benches, bins, bollards and trees in planters. In the zombie yard, the dead have rotting faces (hollow eyes, open mouths), torn bloodied shirts and veined skin, and each one differs in height, slump, head tilt and limp; the lot has abandoned cars, wet puddles, oil stains, litter, tyre stacks, pallets and graffiti. The shop has soft shadows where the shelves meet the floor, posters, a clock, CCTV domes, a fire extinguisher, plants, a stack of baskets and spare stock on the shelves. Everything that doesn't move is merged into a few meshes, every car or zombie of a kind shares one shape, and the zombies are drawn in batches, so it stays smooth on phones.
  - **Sound and feel** (`public/juice.js`): the games have their own sounds, made in the browser (no sound files), plus a camera shake that builds up and fades, flashes, pop-up text, and a coin count that ticks up on a win. The 🔊 button in a game's corner turns the sound off or on, and the phone remembers it. None of this changes the result.
  - **Pay:** the first 8 solo jobs each real day pay in full; after that each pays 4% less than the last, but never less than three quarters (heists aren't cut). What a job can take is capped by what the treasury holds. See **The economy**.
  - **Pickpocket:** steal 10–25% of a colonist's coins, up to 1,500. Other colonists' cards have **Pick their pocket**.
    - Only someone **out and about** can be pickpocketed: on their lunch break, commuting, out in the evening, job hunting, or on a trip somewhere that isn't a home. When that is depends on their shift and bedtime (see **Shifts and bedtimes** under Jobs).
    - Nobody can be pickpocketed at home (asleep or relaxing: for a day worker roughly 19:20 to 07:55 game time, later for night owls), while visiting someone's home, or in the Jail.
    - At work (during their shift), only a workmate at the same building can try.
    - The server checks this (`routineAt` in `shared/rules.js`, `whereIs` in `server/actions.js`). The card shows "🛡️ … is safe at home right now" instead of the button when it isn't possible.
  - **Rob the nearest shop:** 5,000–10,000 coins from the till (at most 3% of the treasury), which the treasury pays.
  - **Chances** depend on how far the nearest Police station is from where the crime happens (`crimeOdds()` in `shared/rules.js`):
    - 🟢 more than 40 tiles away, or no police at all: pickpocket 75%, robbery 60%
    - 🟡 16 to 40 tiles: pickpocket 45%, robbery 32%
    - 🔴 within 15 tiles: pickpocket 20%, robbery 12%
    - A crime wave adds 15 points, to at most 90%.
    - **Night** (20:00 game time, through midnight, until 06:00) adds another 15 points, to at most 90%. The Crime tab shows 🌙 when it applies.
  - **Where it happens:** for a robbery, the shop; for a pickpocket, wherever the victim is right now (a place they're visiting, their workplace, their hangout, or near home). Before you try, the Crime tab shows that victim's odds and where they are.
  - **Getting caught:** a fine of about a seventh of the takings on offer (at least 50, at most 1,500), and never more than you have in cash and savings, so a bad game never puts you in debt. It goes to the treasury.
  - **Jail:** if the colony has a Jail, 10 minutes in it, seen inside. A jailed colonist can't gamble, bet, go out, adopt or commit crimes.
  - **News:** successes are reported anonymously in the Colony Log; arrests name the culprit.
  - **More solo crimes** (`SOLO_CRIMES` in `shared/rules.js`): **🎭 Con a tourist** (800–2,000 coins; 85% / 60% / 35%) and **🏧 Hack an ATM** at the nearest Bank (8,000–15,000; 50% / 28% / 10%). Same cooldown, fines, jail, night and crime-wave bonuses; at most 1% and 5% of the treasury.
- **Group crimes (heists)** (`server/heists.js`, `HEISTS` in `shared/rules.js`), at the bottom of the Crime tab:
  - **🚚 Hit an armoured truck** (crew 2–5, 20,000–50,000, jail 20 min), **👑 Rob the Mayor** (crew 2–5, 30–50% of the cash on the Mayor, jail 25 min; needs a Mayor), **🔓 Break someone out of jail** (crew 2–6, frees the inmate and pays a 6,000–12,000 bounty; fail and the inmate gets 10 more minutes; jail 30 min), **🏦 Bank heist** (crew 3–6, 60,000–150,000 from the vault, jail 30 min). Odds use the same police bands (armoured 50/30/14%, Mayor 50/30/15%, jailbreak 45/28/12%, bank 40/24/10%), plus night, a crime wave or the Mayor's pledge, and +4 points for each crew member beyond the minimum.
  - **Planning:** pick the job, when it goes down (5, 10, 20, 30 or 60 real minutes away) and who to invite. The crew get a group chat named after the job, with an invite from the colony saying who invited them, to agree the plan. Joining the chat is joining the crew; the Crime tab shows each job, its crew, a countdown, **💬 Crew chat**, and for the planner **Go now** (once the minimum crew has joined) and **Call it off**.
  - **What happens:** at the set time (checked every 15 seconds) one roll decides whether the job comes off; then each member is caught or not (15% if it came off, 70% if it went wrong, 10 points less at night). Everyone who gets away splits the loot equally (each cut follows that member's own hot streak, rank and jobs today); anyone caught is fined about a seventh of their share (50 to 1,500, never more than they have) and jailed. Members who are in jail or homeless when it happens sit it out; with too few left, it's called off. The result goes to the crew chat, the Colony Log and each member's notices. Loot comes from the treasury (from the Mayor's own pocket for that job), so no coins are made up, and it's capped at a share of the treasury (see **The economy**). Afterwards the crew lie low for 20 seconds.
  - **Each member plays a part** when the job goes live, as a mini game: 🚗 the **driver** steers the getaway car down a road that keeps speeding up, 💻 the **hacker** rewires the bank's security panel (hazard stripes, a light for each wire that turns green, a borrowed wiring diagram, a circuit board, and a terminal that reports every move and every short circuit), 🔐 the **safecracker** stops a spinning dial on each number (a steel vault door in torchlight: the locking bolts slide back one by one, the wedge lights up when the pointer's on the number, and the door swings open on gold and cash), 👀 the **lookout** watches the back doors round a 3D yard and taps the police before they slip away (each door is set in brick with a lamp, an awning and a window; doors swing open as people step out; ordinary people carry bags, rucksacks and briefcases; plain-clothes police wear dark glasses and an earpiece; the crew's van waits with its hazards on; and police lights flash on the walls as the heat rises), and 💪 the **muscle** holds off a zombie horde (move with the left thumb, hold the red button to fight, pick up weapons; the waves keep growing). How the crew plays sets the loot.
  - **The crew chat closes** 2 minutes after the result. It sits under **Heists** in Chats.
- **Pet.** Adopt one of the six native creatures at a Pet store (2,500–10,000 coins), name it, and it walks beside you on the map. You can rename it or let it go.

## Finding a building to build

Every building menu has a **search box** at the top that searches all buildings by name, by what they are, or by job title ("bank", "pets", "school", "banker"). Each result says which menu it lives in (for example "Shops → Small"), and tapping one picks it up to place, the same as in its own menu. There are four kinds of bank, all under Offices (`BANK_TYPES` in `shared/catalog.js`). Any of them takes deposits and pays out withdrawals from the same account.

| Bank | Size | Look | Jobs | Cost to build |
|---|---|---|---|---|
| Microfinance bank | 1×1 | a small cream branch with a green "MFB" sign | 3 loan officers | 2,500 |
| Community bank | 2×1 | a red-brick branch with a "COMMUNITY" sign | 8 tellers | 4,500 |
| Local bank | 2×2 | the colonnaded classic (banks built before keep this look) | 24 bankers, down from 92 | 8,200 |
| International bank | 3×3 | a tall glass tower with an "INTL BANK" sign | 40 investment bankers | 22,000 |

## Mayor elections

Town Square has a **👑 Mayor** tab. Every week (Monday to Monday, UTC) any verified colonist with a home can **run for mayor** for 5,000 coins in cash. They pick a pledge and can write a pitch of up to 140 characters (no links). Every verified colonist gets one vote, which they can change until the week ends. Candidates can withdraw (no refund).

When the week ends, the most votes wins; a tie goes to whoever ran first. The winner is mayor for the next week:

| Pledge | While they're mayor |
|---|---|
| 💼 Jobs drive | side earnings (deliveries, shifts, fishing, foraging, scavenging) pay 15% more |
| 🚓 Tough on crime | every pickpocket and robbery is 15 points less likely to succeed |
| 🏦 Savers first | bank interest is doubled |
| 🎁 Daily bonus | daily rewards are 50% bigger |

- **Perks:** the mayor earns **60 coins a game day** (about 2,900 a real day, like a top job) from the treasury, and wears a 👑 on their map name tag (shown when zoomed in a little), on their card ("Role: Mayor") and on their Town Square posts.
- **News:** candidacies and results go in the News flash. Candidates get a phone notification with the result.
- **Code and storage:** the server is `server/elections.js`, with tables `candidates`, `mayor_votes` and `elections` (migration 37). The pledges are in `shared/elections.js`.

## Phone notifications

Players get notifications on their phone (or computer) even when the game is closed. They're **on by default**: browsers need the player to say yes once, so the game asks on the first tap after signing in, with every kind switched on. Once allowed, it keeps that device signed up by itself on every visit. **⚙️ Settings** on the player's own card switches them off, or switches off individual kinds; it also shows or hides the getting-started guide. The kinds are:

| Kind | When |
|---|---|
| Pickpockets and thieves | someone picked your pocket (named, with the refund, if they were caught) |
| Gifts | someone sent you coins |
| Chat messages | a message arrives while you're not in the game |
| Race, lottery and casino wins | your creature won a race you bet on, or you won the lottery |
| Daily reward reminders | at 18:00 UTC (7pm in Lagos), if you have a streak going and haven't collected today |

- **How it works:** standard Web Push, with no app store. `public/sw.js` only shows notifications and opens the game when one is tapped (a chat notification opens that chat); it caches nothing. The server side is `server/push.js`, with subscriptions in `push_subs` (migration 36).
- **Sent only after it's saved:** notifications are sent once the action that caused them has been saved, so a failed action never notifies anyone.
- **Gone phones are forgotten:** a phone the push service reports as gone is dropped, and so is one that fails five times in a row.
- **Keys:** the keys that identify the colony to push services come from `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` if set. Otherwise they're generated once and kept in the database, so it works with no setup. `VAPID_SUBJECT` (a `mailto:` address) is optional.
- **iPhone:** notifications only work after adding the game to the Home Screen (Share → Add to Home Screen) and opening it from there. The panel explains this on iPhone. Android Chrome works straight away.

## Getting started guide

A signed-in colonist's own card opens with **🧭 Getting started**: six first steps, each with a small reward the treasury pays once, and a **+1,500** bonus for finishing them all (rewards of 250–500 each). Each step is ticked off from what the player has actually done (`server/guide.js`), so steps they've already done count straight away.

| Step | Done when | Reward |
|---|---|---|
| 🎁 Collect your daily reward | they've collected a daily reward | 50 |
| 💼 Get a job | they have a job | 100 |
| 📦 Earn coins on the side | they've earned from a shift, delivery, fishing, foraging or scavenging | 100 |
| 🏦 Put cash in the Bank | they've deposited at a Bank | 100 |
| 🚶 Go somewhere | they've sent their colonist somewhere with Go here | 50 |
| 📣 Say hello in Town Square | they've posted | 50 |

- **Buttons:** a finished step shows **Collect +N**. An unfinished one has **Show me**, which opens the daily reward, the right tab on your card (Work, Earn, Go out), flies to the nearest Bank, or opens Town Square with the message box ready.
- **Hiding:** the guide can be folded, or hidden (bring it back from the Badges tab). It disappears for good once the bonus is collected.
- **Storage:** what's been collected is kept in `citizens.guide` (migration 35). Deposits and trips out are now counted in `stats` (`deposits`, `outings`).

## Pets, watching yourself, and who's online

- **Pet store.** Pets are adopted at a **Pet store** (a new 2×1 shop, under Shops, with pet-keeper jobs). Tap one on the map to open its card. The **🐾 Adopt a pet** section shows every native creature with its price; renaming or letting go of your pet happens there too.
  - Prices, paid in cash (`PET_PRICES` in `shared/creatures.js`, never under 2,500): Mudgulper 2,500, Ironshell 3,500, Dustrunner 4,500, Skyskimmer 6,000, Starcrest 7,500, Glimmerhop 10,000.
  - The player card no longer has a Pet tab, and the server refuses an adoption unless it names an open Pet store.
- **Watch me go.** On a delivery gig, **👀 Watch me go** hides the card and panels and keeps the camera on your colonist, walking or in a car or cab, until the delivery is done (then it reminds you to get paid).
  - An orange **You** marker floats over you, and a bar at the top shows the time left.
  - Dragging the map pauses following (**Back to me** resumes it), and **Stop** ends it.
- **Full-screen casino.** The casino games on a Casino's card have a full-screen button next to its title, like Town Square and chats; tap it again, switch tab or close the card to go back to normal size.
- **🎥 Follow me.** The same thing on your own card, with no end time: watch whatever your colonist is doing.
- **Online now.** The Town Square header shows how many colonists are online (signed in and seen in the last 90 seconds), from `/api/online/count`. It's refreshed every 30 seconds while Town Square is open.
- **Traffic.**
  - Each roaming vehicle runs errands around its patch at its own speed, with short stops, and only to streets it can actually reach, so it never gets stuck or jumps.
  - Vehicles' hours are staggered, so they no longer all appear or vanish at once. A vehicle going off duty fades out where it parked and fades back in where it next sets off.
  - Vehicles heading the same way in the same lane queue behind each other instead of driving through each other.

## Notices and distances

- **Personal notices.** When someone picks your pocket you get a notice straight away, or the next time you open the game if you were away ("While you were away"). Notices are kept in the `notices` table (migration 34) until seen.
  - **If the thief got away:** "👛 Someone just picked your pocket and got away with N coins". Their name isn't revealed.
  - **If they were caught:** "🚓 @thief picked your pocket but got caught by the police. Your N coins have been refunded". The thief is named only when caught, and you never actually lose the coins.
- **Miles.** Distances players see (Go here, homes, jobs, delivery gigs, crime odds) are in game miles, at 20 tiles to the mile (`miles()` in `shared/rules.js`). The developer's build tools still count tiles.

## Money: the Bank, cars, homes and buildings

**The scale.** A game day is 30 real minutes, so 48 pass in a real day. Prices are set against what a player can earn in a real day, not a game day: an active player (job, shifts, deliveries, fishing, scavenging, the daily reward) makes roughly 4,000–5,000 coins a real day. A first small home or a hatchback takes several days of play, a block of flats months, and the towers and the car plant are for the colony's richest. Everything else follows the same scale: pets 2,500–10,000, running for mayor 5,000, daily rewards 200–1,600, gifts up to 10,000 a real day, Getting started rewards 250–500, badges at 10,000 / 50,000 in the bank / 1,000,000 (a casino Jackpot is a 10,000 win), lottery tickets up to 10,000.

These live on a signed-in colonist's own card, under **Home**, **👛 Wallet** and **Cars**, and on a Bank's own card.

- **Bank.**
  - **All pay is cash.** Wages, rent, profits and winnings arrive as cash on you, and cash can be pickpocketed.
  - **Deposits and withdrawals happen at a Bank.** Tap any bank on the map (Microfinance, Community, Local or International, all under Offices; or type "bank" in the build menu search): its card has **🏦 Your account**, with Deposit, Withdraw and Deposit all my cash. The server refuses both unless the request names a finished Bank.
  - The **👛 Wallet** tab on your own card shows your cash and savings, and has **Go to the nearest Bank**, the buildings you own, and **📒 Cash flow**: everything that came in (green) or went out (red), newest first, grouped by day, with totals for the last 24 hours and All / Money in / Money out filters. It covers wages (once a game day), gigs, rewards, winnings and bets, fares, rent and movers, cars, buildings, bills, gifts sent and received, crimes, fines and bank deposits and withdrawals (`ledger` table, migration 43; kept for a month).
  - Money in the bank can't be pickpocketed.
  - Savings grow 0.02% each game day (about 1% a real day), up to 100 coins a game day, scaled by the stabiliser's dial (see **The economy**). Interest is paid only from what the treasury has left after rents and profits; if that isn't enough for everyone, everyone gets the same share. The bank never creates coins.
  - The Wallet also has the **status ladder** (titles to buy, only for show; see **The economy**).
- **🧭 Places & travel** (the compass button with the map's round buttons; `Places` and `legendOf()` in `public/index.html`, `directory()` in `server/world.js`, `GET /api/places`): the map legend and a travel list. It shows every kind of place by the sign it carries on the map (🚓 Police, 🏦 Banks, 🎰 Casinos, 🏥 Health, ✈️ Airports & hangars, 🚀 the landing station…, then shops, offices, parks and so on by kind), with how many the colony has, and a search box. Tap a kind to list them all, nearest first: **👁 View** flies the map there and opens its card; **Go** sends your colonist (free on foot, or the car fuel or cab fare shown). Airports and hangars now carry a ✈️ sign on the map, the landing station a 🚀.
- **💤 Asleep at home:** when you watch, follow or open the card of a colonist who is asleep indoors, Z's drift up from their home's roof with "💤 … is asleep".
- **Mini game intro** (`intro()` in `public/crimegames.js`): short, like a game card: a banner in the game's colours, three tiles (difficulty, your chance with how near the police are, what it usually pays), a one-line tip, and the full steps folded away under **How to play**. **Practise** is offered only the first time you open each game (remembered on the phone); after that it's straight to **🎯 Do it for real**. Practice-only openings (heist parts) always show it.
- **Status:** the status ladder (titles to buy) is on the ⭐ Stars tab of your card, under your stars (it was in the Wallet).
- **Cars.**
  - Cars are bought at a **🚘 Car dealership** (a new building, under Shops → Large): its card has the showroom and a list of your cars to sell. The **Cars** tab on your card just lists your cars (drive or sell) and has **Go to the Car dealership**.
  - The dealer sells five models (Hatchback 25,000, Sedan 45,000, Pickup 70,000, SUV 95,000, Sports car 300,000), each in a choice of colours.
  - Colonists keep up to 3 in their garage, pick which one they drive, and can sell for 60% of what they paid (cars bought before the October 2026 repricing sell for 60% of their old price).
  - Signed-in colonists drive their own car on longer trips and commutes; without one they take a cab. Everyone else keeps the old rule, where about half own a car.
  - **✈️ Planes need a hangar** (`needsHangar`, `hangarCap` in `shared/catalog.js`; `hangars()` and `rehomePlanes()` in `server/economy.js`). Before buying a Private plane, a colonist builds a **Plane hangar** (3×3, holds 2 planes, about 127,000 with charges) or a **Private airport** (8×4, with a runway, terminal, control tower and windsock, holds 6, about 477,000) on their own land: plot → **🏗️ Build here** → Services → **Aviation**. Each plane bought goes into a hangar with space and flies over the colony from there; when every hangar is full the dealer says so. A hangar's card lists the planes parked in it. A hangar with planes in it can't be knocked down, sold or sold on to another player unless the planes fit in the owner's other hangars (they move there). Helicopters, balloons and boats keep the old rule (3 between them). To make another aircraft need a hangar, add `hangar:true` to it in `CAR_MODELS`.
- **Home and renting.** The **Home** tab shows where you live, with **Go see it** and **Leave this home** (you move out, and leave your job too, until you rent again; the housing queue won't put you back). With no home it says so and offers **🔎 Find a home to rent**. Every home's card has **🔑 Rent here**: a moving-in fee (a tenth of what one flat there is worth, `rentCost()` in `shared/rules.js`; it goes to the owner less the treasury's 20%, or to the colony) plus the movers (500 + 15 coins a tile from your old home), paid in cash. If you live somewhere else you move out of there automatically; from no home you're given a job nearby. A home you own has no moving-in fee. Once per game day.
- **Old move rule.** Rent any home with free space and move there, once per game day. Rent comes out of wages as before. You can always move into a home you own, and if it's full, the newest tenant who hasn't claimed their avatar moves out.
- **Owning buildings.**
  - A home or business (housing, shops, offices, industry) can be bought from its card on the map, up to 5 per colonist. Public buildings, parks, landmarks and utilities stay the colony's.
  - **Earnings you collect** (`ownerYield()`, `tillCap()`, `TILL_DAYS` in `shared/rules.js`; `tills()`, `collect()` in `server/economy.js`; `Tills` in `public/index.html`; migration 65 adds `buildings.till`): every home, shop, office and industry you own earns each game day what it would earn full (after the treasury's 20%), raised by its level. So the dearer the building, the more it makes, whether or not its rooms and jobs are filled, and it still pays for itself in about a real month. The treasury pays it (scaled by the stabiliser; if the treasury can't cover every building, each gets the same share).
    - The earnings build up in the building's till, which holds one real day's worth (48 game days); a full till stops filling until it's collected.
    - Only the owner sees it: a coin floats over each of your buildings, bronze while it fills, silver past half, gold when full; every coin glows in its colour (a full one brightest, pulsing, with rays, and bouncing with a squash as it lands) and twinkles, with the amount underneath when zoomed in. Tap it: it spins, flies to your coins in the top bar, and they count up. The building's card shows what's waiting, what it makes a game day, and a **Collect** button.
    - Selling a building or plot (to the colony or another player) or knocking it down pays out what's in its till first.
    - The top bar's "+…/day" counts wages plus what your buildings make.
  - **Prices** (`propertyPrice()` in `shared/rules.js`) are set so a full building pays for itself in about a real month (30 real days, 1,440 game days), and slower when it isn't full. For example: Market stall or Shelter tent 5,000; Log cabin 14,000; House 37,000; Small office 48,000; Restaurant 46,000; Casino 59,000; Panel block 195,000; Local bank 275,000; Apartment tower 485,000; Shopping mall 760,000; Belle époque tower 7,900,000. A building's "Cost" in the build menu is what the developer pays to build it, not what a player pays to buy it.
  - Buildings sell back to the colony for 70% of what was paid. If the developer knocks one down, the owner gets back what they paid.
  - **✏️ Rename** on the card of a building you own puts your own name over the door, shown on the map and its card (up to 40 letters; leave it empty to go back to the usual name). The landing site keeps its name.
  - **🏗️ Building on your land, made simple** (`BuildHub` and `Plots.picker` / `Plots.choose` in `public/index.html`):
    - The plot card's **🏗️ Build here** opens the build menu. (`BuildHub` can also open it straight for your plot, but there's no button for it on the bottom bar.)
    - The menu is in plain groups: 🏠 Homes, 💼 Businesses, 🌳 Garden, 🧱 Fences, 🪑 Decorations, 🟫 Floors, ✈️ Aviation and ✨ More, with a **search box** (house, café, fence, marble, hangar…). It shows only what fits on the plot unless you untick **Only what fits on this plot**. Each item shows its price with charges, its size, how long it takes, what it earns a day (or how many homes it has, or how many planes it holds), and "Need N more coins" when you can't afford it yet.
    - Picking a building puts it straight onto the first free spot on your plot (turned if that's the only way it fits), with the price and **Build** ready to tap; drag it elsewhere or **⟲ Turn** it first if you like, or **✕ Cancel** (in the box and on the tool bar) to build nothing. Small things are tapped into place one after another.
    - While you build, your plot is outlined in green and its free tiles are lit up.
  - **Fences laid like roads** (`buildLine()` in `server/world.js`, `buildLineOn()` in `server/housing.js`): fences, walls and hedges are dragged out along a line and built when you let go, one on every free tile (blocked tiles show red and are skipped; the count and the price show as you drag). The builder does the same from Decor → Fences & walls (up to 400 tiles a stroke, undoable in one go); players do it on their own plot (up to 64 tiles a stroke), and a fence can go over their own paving (it's lifted).
  - **🧩 Estates** (`estate` on `plots`, migration 64; `estateOf()`, `inEstate()`, `ownAdjacent()` in `server/housing.js`): land you buy (or win at auction) that shares an edge with a plot you own joins it as one estate. Every group of a colonist's plots that touch, through any chain of plots, becomes one estate (`mergeEstates()`): when land is bought, won at auction or sold on to them, and once each time the server starts (which joins land bought before estates existed). The estate keeps its lead plot (the one already leading, else a named one, else the oldest), so its name and any offers stay. It counts as one property (it can be bought even at your property limit), it needs no road beside it (touching your own land is enough), and it's drawn with one outline and one name. The estate's card shows all of it (tiles, plots joined, every building), buildings, fences and paving can stand across its plots, and it's sold whole, to the colony or to another player.
  - **Land prices** (`LAND_TILE_MIN`, `LAND_TILE_MAX`, `LAND_RADIUS` in `shared/rules.js`): an 8×8 plot's land costs 25,000 coins at the least and 1,200,000 at the most (before charges), the price per tile scaling with the homes and businesses within 60 tiles.
  - **Surfaces on your land** (`pave()` in `server/housing.js`, `paveCost()` in `shared/rules.js`): the plot's **🏗️ Build here** menu has a **Surfaces** tab with every surface from the developer's Roads → Surfaces list. Pick one, then tap or drag over open ground on your plot to lay it (three times the developer's price per tile, at least 10 coins, paid to the treasury); **Lift paving** turns tiles back to grass for free. Only inside your own plot, never under a building; building something over your own paving lifts it automatically.
  - **Flooring designs** (`pat` on the surface in `ROAD_TYPES`, drawn by `drawPattern()` in `public/index.html`): besides cobblestone, brick plaza, stone, grass pavers, sand, gravel and dirt, there are 15 more: herringbone brick, terracotta tiles, marble, chequered tiles, mosaic, wooden decking, slate flagstones, crazy paving, pebbles, stepping stones, hexagon pavers, terrazzo, a flower-edged path, a red play surface and golden tiles. The developer can lay them anywhere from Roads → Surfaces too.
  - **✥ Move** (on a building you built on your own plot) lets you drag it to another free spot on that plot and let go; **⟲ Turn** faces it the other way. It can't leave the plot, and it can't move during an upgrade. Bought buildings stay where they are.
- **🔨 Land auctions** (`server/auctions.js`, `AUCTION_*` in `shared/rules.js`): prime land the developer puts up for bidding.
  - **Starting one (developer):** Town Square → **🔨 Auctions** → **Put land up for auction**. Swipe to the spot, double-tap it and drag over the grass (2×2 to 8×8, beside a road), just like buying land. Then give it a name if you like, set the opening bid (it starts at what the land would cost the ordinary way) and how long it runs (30 minutes to 48 hours). The Colony Log announces it.
  - **On the map** the land shows in gold with a dashed edge and a sign with the top bid (or the opening bid). Nobody can buy it the ordinary way while it's up for auction.
  - **Bidding:** tap the land (or the auction in Town Square → 🔨 Auctions) and bid. Bids are paid in cash straight away and held by the auction. Each bid must beat the last by 5% (at least 100 coins). The top bidder can't bid against themselves.
  - **Outbid?** Every coin comes straight back to your cash, with a notice (and a phone notification if they're switched on) so you can bid again.
  - **No last-second snatching:** a bid in the last 2 minutes moves the close to 2 minutes after it.
  - **Closing:** the winning bid goes to the treasury and the land becomes the winner's plot, to build on like any other (it counts as one of their properties; you can't bid if leading would take you over your limit). The Colony Log names the winner. With no bids, the land is simply free again.
  - **Calling it off:** the developer's **Call it off** on the auction's card gives the top bid back.
  - Finished auctions stay listed for an hour. Tables: `auctions` and `auction_bids` (migration 61).
- **Gifts.** Signed-in colonists can send coins to each other, with **Send a gift** on another colonist's card or **Gift coins** in the Wallet tab.
  - Gifts are paid in cash, from what you have on you; withdraw savings at a Bank first.
  - Each colonist can send up to 10,000 a real day, so nobody can funnel a stack of accounts into one.
  - Only verified avatars (claimed, with a password) can receive gifts.
  - The Colony Log says who gifted whom, but not the amount.
- **Bills** (`weeklyBills()` in `server/economy.js`): owners pay upkeep to the treasury, from cash first and then the bank. A 🧾 notice lists what was paid.
  - **Car maintenance, every game week** (7 game days): 0.1% of each car's price: Hatchback 25, Sedan 45, Pickup 70, SUV 95, Sports car 300. With about 7 game weeks in a real day, a sedan costs about 310 a real day to keep.
  - **Property upkeep, twice a game year** (a game year is 52 game weeks, so every 26 game weeks, about every 3.8 real days; `PROPERTY_BILL_WEEKS` in `shared/rules.js`): 2.6% of what each home, business and plot you own is worth (0.1% for each of those weeks), so the yearly cost is the same as before, in two bills. For a full building that's about a fifth of what it earns.
  - If both cash and savings run out, the rest is let go for that week.
- **New buildings.** A **Gym** and an outdoor **Fitness park**, under Parks → Sports.

## Chats and who's online

- **Who can chat.** Verified colonists (claimed, signed in) can message each other privately.
  - Tap **💬 Message** on a verified colonist's card, or open the **Chats** tab, which only signed-in players see.
  - The Chats tab lists your conversations with unread counts, plus an **Online now** row.
- **Delivery.** Messages arrive live, with a pop-up and an unread badge, and go only to the two people's own screens, never to anyone else.
- **Limits.** Messages are up to 500 characters, with a short pause between sends. The last 500 messages of each chat are kept.
- **Opening their card.** Tap the name or picture at the top of a chat to open that colonist's card.
- **Replies.** Tap any message, then **↩ Reply**. A bar above the box shows what you're answering, and the reply carries a short quote of it; tap the quote to jump back to the original.
- **Message requests.** A chat someone else starts with you lands under **Requests** (beside **Chats**, with a count), not in your chats. You can reply without accepting it; it stays a request until you tap **Accept**. **Delete** clears it; **Block** is there too.
- **@ suggestions.** Type @ in any text box (a gift, a pickpocket target, group or crew invites, searches, messages) and the people you chat with pop up, most messages first: chats you started and requests you accepted (`GET /api/dm-contacts`). Tap one (or press Enter) to fill in their @username.
- **The far-away fee.** Messaging a colonist whose home is within 40 tiles of yours (your area) is free. Anyone further away, or without a home, costs **2 coins a message** from your cash, paid to the treasury. The chat shows which applies above the message box. In a group, a message is free only if every other member lives near you.
- **Pin and delete.** **⋯ → 📌 Pin chat** keeps a chat at the top. **⋯ → 🗑 Delete chat** clears it for you only (tap twice to confirm); the other person keeps theirs, and a new message brings it back starting fresh.
- **Groups and Heists.** Along the top of the Chats tab, **Groups** gathers your group chats (with **Create a group chat**) and **Heists** your crew chats, each with its own unread count. A crew chat closes 2 minutes after the job's result.
- **Group chats.** **➕ New group** on the Chats tab: give it a name and pick colonists from your chats or who's online, or type @handles (up to 30 people). Each invitee gets a message from the colony (for example "🪐 Gliese-12b: @zara invited you to join the group chat “Night owls”. Do you want to join?"), live and as a phone notification, and it waits at the top of their Chats tab with **Join** and **Decline**. Members see who joins and leaves, can invite more people, pin, clear the chat for themselves, or **Leave group**. Tap a sender's name to open their card.
- **Under the hood.** Migration 42 adds reply and fee columns to `dms`, `chat_state` (per-person pin, cleared-at, accepted, read-at), `chat_groups`, `group_members` and `group_msgs`. Group messages go out as the private live op `gm`, invites as `chatInvite`.
- **Online status.** A colonist is online while they're signed in with the colony open. Verified colonists show a green dot and "● Online now" or "Last seen 5 min ago" on their card, in the Colonists list and in chats.

## Colony events

- **When.** Something happens in the colony every 2–4 real hours, never two at once (`shared/events.js`, `server/colonyevents.js`). The first comes 20 minutes after the server starts.
- **What happens when one starts.**
  - It's announced in the Colony Log.
  - Everyone gets a pop-up with **Go**.
  - A pulsing banner under the news ticker shows the event and a countdown; tapping it opens the Earn tab (the Crime tab for a crime wave).
  - When it's over, the Colony Log says so.
- **The events:**
  - 🎉 **Festival** (30 min): shifts, deliveries, fishing, foraging and scavenging all pay 1.5×.
  - 🐟 **Fishing frenzy** (25 min, needs water): bites come in 1–3½ s instead of 2½–7½ s, and catches pay 2×.
  - ☄️ **Meteor shower** (25 min, needs the landing station): searches take 1 minute with no wait between them, and finds pay 2×.
  - ⛈️ **Great storm** (20 min): storm weather, so no fishing or foraging, but deliveries pay 1.5× hazard money. The weather goes back to how it was afterwards.
  - 🦹 **Crime wave** (20 min): crimes succeed 15% more often.
  - 📦 **Supply drop** (15 min, needs the landing station): the first 15 colonists to tap **Claim supplies** in the Earn tab get 300–900 coins each (from the treasury).
- **Developer controls.** In developer mode, **⚡ Start a colony event** in the Town Square starts any of them now (replacing one that's on) or ends the current one.

## Ways to earn

- **Where.** The **💰 Earn** tab, the first tab on your own card, lists every way to make coins and lets you do the active ones right there (`server/earn.js`).
- **Rules for all of them.**
  - Everything is paid from the treasury; if it runs low, pay shrinks to what it holds.
  - Daily limits reset at midnight UTC. Together they're worth roughly as much as a job, so a job stays the main income.
- **💼 Your job.** Paid automatically every game day. If you have no job, **Find a job** opens the Work tab.
- **⏱️ Extra shift.** Overtime at your job pays 8× your daily salary at once. Your colonist goes to work for a few minutes. Up to 4 a day, with a 45-minute rest in between.
- **📦 Delivery gigs.**
  - Three parcels are offered at a time (refreshed every 10 minutes), each between two buildings in town.
  - Taking one sends your colonist to the address, walking, driving or by cab like any trip. You're paid on arrival (1–5 minutes later): 30–260 coins depending on distance. Up to 8 a day.
- **🎣 Fishing and 🌿 foraging.**
  - Fishing needs water in the colony; foraging needs a park or garden.
  - Cast, wait 2½–7½ seconds for the bite (the screen shakes), then tap **Reel in!** within about 1½ seconds. Too early or too late and it gets away.
  - Catches sell for 0–1,000 coins: Glowfin 15 up to a rare leviathan scale 1,000; Sunberries 12 up to a crystal shard 300. Up to 30 catches a day.
  - The bite time is set on the server, so it can't be faked.
- **🛰️ Scavenging.** Search the old drop pods by the landing station for 2 minutes and find nothing, scrap or treasure (the captain's lost log is worth 1,200). Up to 10 a day, 15 minutes apart.
- **Colony Log.** Rare finds and big deliveries are announced.
- **More ways.** The tab also points to the daily reward, being a landlord, bank interest, gifts, races and the casino, and crime (risky).

## Daily rewards and streaks

- **Collecting.** Signed-in colonists collect a reward once per real-world day. A pop-up offers it when they open the colony, and it waits until any first-time setup is done. They can also collect it from **Collect +N** at the top of their own card.
- **The 7-day cycle.** 200 → 300 → 400 → 500 → 600 → 800 → **1,600** on day 7, then it starts again at 200. The streak count keeps growing across cycles.
  - A full week is 1,100 coins, about one real day of wages from a job, so it rewards coming back without flooding the economy.
- **Streaks.** Collecting on consecutive days builds the streak. Missing a day starts it over, and the pop-up says what was lost.
  - Days start at midnight UTC, which is 01:00 in Lagos. The pop-up shows the local time.
  - Each colonist's best streak is remembered.
- **Where the coins come from.** The treasury, like every other payout. If it runs low the reward is cut to what it holds, and the streak still counts.
- **Colony Log.** Streaks of 7, 14, 30, 50, 100, 200 and 365 days are announced.

## Leaderboards

- **Where.** The **Top** tab, which everyone can see. Only verified colonists are ranked.
- **Weekly boards.** These start over every **Monday at 00:00 UTC** (01:00 in Lagos), so newcomers can win:
  - 🏁 Top racer (net race winnings)
  - 🎰 Luckiest (net casino winnings)
  - 🦹 Most wanted (crimes got away with)
  - 🎁 Most generous (coins gifted)
- **All-time boards.** 💰 Richest (pocket and bank), 🏙️ Biggest landlord (buildings owned), 🔥 Longest streak (current daily streak), 🏅 Most badges.
- **Privacy.** Balances and gift amounts are private, so **Richest** and **Most generous** show the order only. The others show the numbers.
- **The list.** Each board shows the top 10 with 🥇🥈🥉, your own place (even below the top 10), and when it starts over. Tapping someone opens their card.
- **Champions.** When a week ends, its winners are crowned once, shown as "🏆 Last week's champion" on each weekly board, and announced in the Colony Log. Weekly scores are kept per week in `scores`, and winners in `weekly_champions`.

## Stars

- **What they are.** 1 to 12 stars for how active a colonist is (`STAR_STEPS` in `shared/rules.js`, `server/stars.js`). They replaced the old badges.
- **Points.** Every action a signed-in player takes themself (anything that changes something: shifts, gigs, games, trips, chats, crimes, buying and selling, and so on; at most one every 5 seconds; reading and settings don't count) is a point, and every real day they play adds 20.
- **Steps.** 10, 30, 70, 130, 220, 350, 520, 750, 1,050, 1,450, 2,000 and 2,800 points. Stars 1–3 are bronze, 4–6 silver, 7–9 gold, then diamond, amethyst and supernova, each a slightly different gradient.
- **Showing them.** Every verified colonist's card shows their stars. A new star pops up live; reaching 4 or more is announced in the Colony Log. Your own card's **⭐ Stars** tab shows all 12, your points and how many more to the next star.
- **Coins.** Stars are cosmetic.

## Sharing to X, YouTube and anywhere else

- **Where.** The **↗** button at the top of any colonist's or building's card, **↗ Share my win** after a casino win (50+ coins) or a race win, and **Share** on the pop-up when you win the lottery.
- **The picture.** A 1080×1350 snapshot of the live map around that spot (no menus), framed with RESURGENCE, the colony's name, a caption card (with the colonist's face, if it's about a colonist) and playresurgence.com.
- **Share options.**
  - **Share…** uses the phone's own share menu, so you can pick X, Instagram, WhatsApp or anything else with the picture attached. It only shows where the browser supports it (most phones).
  - **𝕏 Post on X** opens a ready-written post with the link.
  - **Save picture** and **Copy link**.
  - The caption can be edited first.
- **YouTube Shorts.** **▶ Make a YouTube Short** records an 8-second vertical (720×1280) clip of the live map, slowly zooming in, with the same frame and caption. It's an mp4 where the browser can make one (Safari, recent Chrome), otherwise webm.
  - **Share clip…** goes to the YouTube app (or TikTok, Reels, Status).
  - **Save clip** and **Open YouTube** are there to upload it by hand.
- **Links.**
  - `playresurgence.com/?c=handle` opens that colonist's card.
  - `/?b=<building id>&at=x,y` opens a building.
  - Colonist links get their own title in link previews ("@handle on Resurgence"). Every link shows `og.jpg` (1200×630) as its preview picture.

## Blocking, reports and muting

- **Block.** Tap **🚫 Block** on a colonist's card, or **⋯ → Block** in a chat. Neither of you can message the other, their chat leaves your list, they don't show as online to you, and their Town Square posts are hidden from you. They aren't told. Your blocked list is at the bottom of the Chats tab, with **Unblock** next to each name.
- **Report.** Tap any message someone sent you and choose **⚑ Report**, or **Report** under someone's Town Square post. Pick a reason (spam, abuse, scam, something else); for messages, **Also block** is ticked by default. The reported person isn't told who reported them. Each colonist can send up to 20 reports a day, and reporting the same thing twice counts once.
- **The developer's Reports tab.** In developer mode a **Reports** tab shows waiting reports with a badge and a pop-up when a new one arrives. Each shows who, why, who reported it, how many times that colonist has been reported, and, for private messages, the few messages before it.
  - **Dismiss**, **Delete message**, **Mute 1 day** or **Mute 1 week**. Muting also deletes the message. A muted colonist can't send messages or post in the Town Square, and is told how long is left. **Lift** ends a mute early.
  - Settled reports move to **Settled**, with what was done.

## Creature races

- **The creatures.** Six native creatures race: Starcrest, Dustrunner, Skyskimmer, Mudgulper, Ironshell and Glimmerhop (`shared/creatures.js`). Each has a speed, a level of unpredictability, and likes and dislikes for the weather.
- **When.** Every finished **Racetrack** (Parks → Sports) runs its own race every 30 real minutes.
  - The first track races on the hour and half hour. Each extra track is staggered by 5-minute steps, so more tracks mean more races.
  - Each track has its own field (usually five of the six creatures; a different one sits out), odds, bets and Cup.
  - With several tracks, the Races tab has a track picker showing each one's countdown or "● Live". Tracks are named "Racetrack 1", "Racetrack 2" unless the developer names them.
- **Announcement.** The Colony Log announces each race **2½ minutes before it starts**, and everyone watching gets a pop-up.
- **Betting.** Signed-in colonists open the **Races** tab and place one bet per race until the gates close. The odds come from form and the weather at race time, and the house keeps about 10%.
- **The race.** The server decides the result when the gates open. Everyone watches the same ~45 s race, in the tab and on the track itself. Winners are paid at the finish, and the Colony Log names the winner.
- **How they run.** Each creature has a racing style: Starcrest is a front-runner, Dustrunner a sprinter, Skyskimmer a glider, Mudgulper a closer, Ironshell steady, and Glimmerhop unpredictable (it stalls and leaps).
  - Each race adds its own luck to those styles, seeded by the race, so everyone sees the same race (`paceCurve` in `shared/creatures.js`).
  - Leads change hands during the race, but the finishing order is always the server's.
- **Cups.** In developer mode, **Make the next race a Cup** adds a bonus from the treasury, shared by everyone who backs the winner. If nobody does, it goes back to the treasury.

## Lottery

- **Starting one.** In developer mode, open the Races tab and use **Start a lottery**: choose when it's drawn (5 minutes to 24 hours), the ticket price, and an optional bonus from the treasury.
- **Tickets.** Colonists buy up to 10 tickets each.
- **The draw.** It's announced 2½ minutes before it happens. One ticket wins the whole pot: every ticket's price plus the bonus.

## Performance on phones

**Staying connected.** The live connection reopens itself: if the line goes quiet for 12 seconds (the server ticks every 1.25 s), or a connection attempt hangs for 8, it starts over. Whenever the phone wakes (screen back on, app back in front, network back, or any touch or key press) and nothing has arrived for 5 seconds, it reconnects straight away and then catches up on what was missed: chats, notices, races, the lottery, your coins and any table you're at.

The map is tuned for low-end Android phones. The main pieces, all in `public/index.html`:
- **Buildings are cached pictures.** Each finished building is drawn once into its own picture, sized to its type's measured outline and redrawn only when the zoom moves to a new step, and that picture is copied each frame. Night lights and chimney smoke are replayed on top. Buildings that animate (clocks, windmills, neon, ferris wheels…) are drawn live. The cache is limited to 6 to 9 million pixels.
- **Vehicles are cached pictures** too: one per type, colour and heading (32 headings). Flashing sirens are drawn live.
- **People are drawn from pre-drawn parts**, packed on 1024×1024 pages. Pages are kept small because adding a part to a page that's also being drawn from makes the browser copy the whole page.
- **Quality adapts.** If frames run slow, the map drops to a lower resolution and simulates fewer people (1,500 → 1,100 → 700 → 450). Each phone remembers the level it settled on. On a first visit, a phone with little memory or few cores starts two steps down.
- **Water: only shores are shaped.** Open water is drawn as plain strips along each row; only shore tiles get their rounded edges, beach and wet sand, and each tile's neighbours are looked up once. Ripples are skipped when zoomed far out and thinned when zoomed out. (Zooming out over the sea used to freeze a phone for several seconds.)
- **The ground waits for the zoom to settle.** Mid-pinch the last ground picture is stretched to fit, and it's drawn again once, after the zoom stops, instead of at every step.
- **Night windows are reused while the view is still.** The lit-windows layer is rebuilt only when the camera moves, the night deepens or a building changes; vehicles' windows don't light up (their headlights still glow), so passing traffic doesn't force a rebuild every frame.
- **Far out, swaying trees and similar scenery are still pictures**, and the faint "see-through" people behind buildings aren't drawn.
- **Keeping phones cool.** Left alone for 20 seconds, the map draws 10 frames a second on a phone (15 while you're looking around, full speed while you touch it); behind a full-screen game, card or panel it draws once a second. Races, the lottery and Fight Night refresh only while the Races tab is open (the 24/7 stream page excepted), and coins aren't refreshed while the app is in the background. Measured idle on the live colony: the main thread went from busy 84% of the time to 44%.
- **Fonts never block the first screen.** On a slow or blocked connection the game opens in the phone's own font.

Results on a simulated low-end Android (360×780 screen, CPU slowed 6×, 9,000 colonists):
- town centre: 2.4 → 8–10 frames a second
- zoomed out over the whole colony: 8 → 11–30
- jumping from the whole colony into a busy street: freezes went from 2.2 s to under 0.3 s
- total freezes while loading: 13.5 s → 5.5–7.5 s

At full speed the town centre runs at about 46–60 frames a second (it was 18). November 2026, measured on the live colony on a phone-sized screen with the CPU slowed 4×: zoomed out went from 0.5 frames a second with a 5.4 s freeze to 5 frames a second with no frame over 0.23 s; the worst freeze while panning and zooming went from 3.1 s to 0.76 s; the town centre at rest at night went from 43 to 59 frames a second at full speed. A two-minute session of wandering, zooming and opening tabs keeps memory flat at 20–30 MB.

## 📺 24/7 live stream

The colony streams itself around the clock to YouTube, Twitch, Facebook, Instagram and TikTok, with the colony radio as its soundtrack.

**How it works.** A small cloud server runs the streamer (`streamer/`). It opens the stream page (`/?stream=1`) in a browser on a virtual screen, films it, adds the radio's sound and sends one stream to every destination that's switched on. A 16:9 picture goes to YouTube, Twitch and Facebook; a 9:16 picture goes to Instagram and TikTok. Anything that stops is restarted. Facebook (8 h) and Instagram (4 h) end lives after a while, so the streamer reconnects just before that. It checks in every 30 seconds, and the **Stream** tab shows what's live, what's on screen and a small picture of it.

**Setting it up**
1. On the game server, set `STREAM_TOKEN` to any long random text.
2. Get a cloud server with Ubuntu: 2 vCPU / 4 GB for one 720p picture, or 4 vCPU / 8 GB for 1080p or for both shapes at once. Run:
   `curl -fsSL https://raw.githubusercontent.com/Here001/Living_Settlement/main/streamer/setup.sh | sudo bash -s -- <STREAM_TOKEN>`
   If the repo is private, add `REPO=https://<github-token>@github.com/Here001/Living_Settlement.git` in front of `bash`. Run the same command again to update. Logs: `sudo docker logs -f streamer`.
3. In the game, open **Stream** (developer toolbar), add each platform's stream key, switch it on and press **Save**. The streamer picks it up within 30 seconds.
   - **YouTube**: YouTube Studio → Go live → Stream. Copy the stream key and turn on Auto-start.
   - **Twitch**: Dashboard → Settings → Stream. Copy the primary stream key.
   - **Facebook**: Live Producer → Streaming software → use a persistent stream key.
   - **Instagram**: on a computer, Create → Live video. Copy the URL and key. The key works for one live only, so paste a new one each time.
   - **TikTok**: LIVE Studio, or "LIVE with streaming software" (needs LIVE access). Paste the server URL and key; TikTok also gives a new key for each live.

**Streaming from OBS instead (or as well).** The Stream tab's **🎥 OBS** box gives the link to add in OBS as a **Browser Source**: `https://playresurgence.com/?stream=1`. Add `&station=pidgin` to fix that scene's station, or `&radio=off` to use your own music.
- Size: 1280 × 720, or 720 × 1280 for a phone-shaped scene (the screen rearranges itself).
- Tick **Control audio via OBS**, then set the platform and stream key in OBS's Settings → Stream.
- Within a minute the box shows "🟢 OBS is showing the stream", with its size, station and whether its sound is running. The camera, radio, DJs and announcements work exactly as on the cloud streamer.
- OBS only streams while your computer is on, so use it for testing or for streams with your own commentary, and the cloud streamer for 24/7.
- Don't send the same stream key from both at once: a platform takes one feed per key.

**The camera (director).** In **Auto** it keeps choosing what to show:
- **Action:** a race (it always cuts to a live one), someone who just arrived, won or got caught, a player who's online, the busiest spot.
- **Calm:** a quiet park, sunrise or sunset over the skyline, the city lights at night, rainy streets, a neighbourhood it hasn't shown lately, the whole colony.

It remembers its last dozen shots so it keeps moving to new parts of the map, and after two action shots it always shows a calm one. When a DJ talks about someone, the camera goes to them. In the Stream tab's **Camera** box you can take over instead:
- follow a @player, show a place, the racetrack, the whole colony or something calm;
- or move your own map anywhere and press **What I'm looking at**.

Pick how long to hold it (1, 5 or 15 minutes, or until you release it). **Auto** hands it back and **Next shot** skips ahead.

## 📻 Colony radio

Tap **📻 Radio** (top left) to pick a station. Each one has its own sound and its own DJ:

| Station | Sound | Presenters (lead & funny sidekick) |
|---|---|---|
| Ìlú FM 88.1 | Yoruba: Fuji, Jùjú, Apala (talking drum, iron bell, shekere) | DJ Àyìnkẹ́ & Kọ́lá · Bàbá Fẹ́mi & Tòpẹ́ |
| Obodo FM 91.5 | Igbo: Highlife guitars, congas, horns | Uncle Obiora & Chioma · Nneka & Emeka |
| Gari FM 94.3 | Hausa: kalangu, calabash, Sahel flute | Malam Sani & Hauwa · Zainab & Danladi |
| Colony 101 101.1 | English: Afrobeats and chill | Tolu Waves & Big Dayo · David Ace & Lola Laughs |
| Gbedu FM 105.9 | Pidgin: Amapiano log drums, street-pop | Oga Gbedu & Ada Wahala · Madam Rita & Bobo Chuks |

- **Four presenters per station.** They work in two pairs that take turns in 3-hour shifts. In each pair, the lead runs the show and the sidekick is the funny one: jokes about everything, hypes up the lead and compliments them. About two breaks in three are the pair together as a back-and-forth, and the rest are the lead alone. Each presenter has their own voice, which you pick in the Stream tab, and the sidekick talks a little faster and livelier. Announcements are read by the lead on shift.

- **Real songs.** In the **Stream** tab, under **🎵 Radio songs**, pick a station, optionally type the **artist**, and press **Add songs**. You can upload several MP3, M4A, WAV or FLAC files at once, up to 40 MB each.
  - Each song is evened out in loudness (so none is much louder than the next) and saved twice: a 128 kbps copy, about 1 MB a minute, and a 48 kbps **data-saver** copy, about 0.35 MB a minute.
  - A station plays its songs in a new shuffled order every round, and the DJs name the artist when they introduce a song.
  - You can rename songs, set the artist, switch songs off or delete them.
  - While a station has fewer than 8 songs, a generated song plays after every second one.
  - Only upload songs you have the right to stream: your own (for example from a **paid** Suno plan), or artists who gave permission. Copyrighted songs get live streams muted or taken down.
- **Big catalogues: Cloudflare R2.** With R2 set up, songs are kept in R2 instead of the database, and players download them straight from Cloudflare's network, so the game server and database stay light however big the catalogue gets. R2 is free up to 10 GB (about 2,500 songs), with no charge for downloads. To set it up:
  1. In Cloudflare, go to **R2 → Create bucket** (for example `resurgence-music`).
  2. In the bucket's **Settings**, under **Public access**, turn on the **r2.dev** URL, or connect your own domain such as `music.playresurgence.com`.
  3. In the bucket's **Settings → CORS policy**, paste this, so the game can play the files:
     `[{"AllowedOrigins":["https://playresurgence.com"],"AllowedMethods":["GET","HEAD"],"AllowedHeaders":["*"],"ExposeHeaders":["Content-Length","Content-Range","Accept-Ranges"],"MaxAgeSeconds":86400}]`
  4. Go to **R2 → Manage API tokens → Create API token** with **Object Read & Write** for that bucket.
  5. In Render, set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` and `R2_PUBLIC_URL` (the bucket's public address).
  6. In the Stream tab, press **☁️ Move songs to Cloudflare** to move any songs already in the database.

  Without R2, songs are stored in the database.
- **Slow connections.** The radio only loads when someone turns it on, so it never slows down the game itself.
  - The next song is loaded while the current one plays.
  - Players can turn on **📶 Data saver** in the Radio sheet. It's on automatically for phones on data-saver or 2G/3G connections, and the radio switches to it by itself if a song keeps stalling.
  - If a song can't load at all, a generated song plays in its place, so the radio never goes silent.
- **Generated music** fills in when a station has few or no songs. It's composed live in the browser in each station's style (`public/music.js`), so it never repeats and needs no licence. Each song has an intro, verses and hooks, chants and a "Hey!" in the hooks, drum fills, a build-up that drops into the last hooks (the final one a step higher) and an outro, with the instruments spread left and right.
- Everyone on a station hears the same song at the same moment, like real radio.
- **The DJs.** Every second song opens with a talk break written from what just happened: the Colony Log, the Town Square, the mayor's race and the next race. An event is only told once per station. Breaks are only made for stations someone is listening to.
  - `ANTHROPIC_API_KEY` (from console.anthropic.com): Claude writes every break fresh, in the DJ's voice, without reusing their recent jokes or lines. Optional `RADIO_MODEL` (default `claude-haiku-5-5`). Without the key, the DJs use their phrase banks, still never repeating a recent phrase.
  - `FISH_API_KEY` (fish.audio → API Keys; top up prepaid credit): the DJs speak through Fish Audio, at $15 per million bytes of text (about $0.05 an hour for a station someone is listening to, at one break every 2 songs). There's no subscription. In the Stream tab, pick each DJ's voice: your own voices come first, then the most used Nigerian voices from the Fish Audio library. Automatic picks a Nigerian voice of the DJ's gender. The tab shows the credit left, and when it runs out the DJs switch to text only. Commercial use needs a paid (topped-up) account. Optional `FISH_MODEL` (default `s2.1-pro`). Fish Audio is used first if several voice keys are set.
  - `ELEVENLABS_API_KEY` (elevenlabs.io → your profile → API Keys): the DJs speak, and the music dips under them. Pick each DJ's voice in the Stream tab (add Nigerian voices to "My Voices" from the ElevenLabs Voice Library first), or leave it on Automatic to use a Nigerian voice of the DJ's gender from your account. The Stream tab shows the month's characters used. Just before they run out, the DJs switch to text only, so the radio keeps going. Use a paid plan (Starter or higher), because the free plan doesn't allow commercial use. One station that's listened to all day uses about 3,500 characters an hour at one break every 2 songs, so set **DJ talks every** to 3, 4 or 6 songs to stretch a small plan. Optional `ELEVENLABS_MODEL` (default `eleven_flash_v2_5`). Azure AI Speech also works (`AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION`). Without a voice, the words show on screen.
- **When and how long the DJ talks.** In the Stream tab, **DJ talks every** sets 1, 2, 3, 4 or 6 songs, and **Each break** sets short (10–15 s), normal (20–30 s) or long (40–60 s). The DJ comes in at the start of a song, uploaded or generated, and talks over its first seconds while the music plays quietly underneath. Then the music comes back up.
- **📢 Announcements.** In the Stream tab, type a message and press **Go on air now**. Every station on air (or just the one you pick) cuts in straight away, over the music and any DJ talk. The DJ introduces it, reads it word for word, and says it twice if it's short. You can let the DJ say it in their own words instead, keeping every fact (needs ANTHROPIC_API_KEY). It also appears as a red banner on everyone's screen, even players with the radio off, and on the 24/7 stream, and goes in the Colony Log.
- **Switches.** Players turn the radio on and off with the switch at the top of the Radio sheet. In the **Stream** tab you can take the whole radio off air or switch single stations off. A station that's off disappears from everyone's dial straight away (anyone listening is stopped) and makes no DJ breaks, so it costs nothing. The stream plays only stations that are on.
- The **Stream** tab shows whether Claude and Azure are set up and the latest breaks, and has buttons to put any DJ on air right away. The stream plays one station all day or a new one each hour (**Radio** under Sound).
- The old calm background music is still there as **Ambient**.

## Run it on your computer

With Docker: `docker compose up --build`, then open http://localhost:3000/#builder (token `local-dev-token-please-change`).

Without Docker: install Node 20+ and Postgres, copy `.env.example` to `.env`, fill it in, then `npm install` and `npm run dev`.

| Command | What it does |
|---|---|
| `npm test` | About 285 end-to-end checks against a running server. **Throwaway database only:** it founds a test town. Start that server with `ALLOW_TEST_ROUTES=1 RATE_PER_MIN=5000` so the payday check runs and the test isn't rate-limited. |
| `npm run check` | Recounts every total from scratch and compares it with the running totals. Read-only, safe on the live database. |
| `npm run loadtest` | Floods a running server with 200,000 followers, webhooks, towers and viewers. **Throwaway database only.** |
| `node scripts/actionload.mjs 120 20` | Players' everyday actions (trips, Home tab, Earn, shifts) at 120 a second for 20 s, with response times. **Local test server only.** |
| `QLOG=1 npm start` | Prints every database query each change makes (for finding slow changes). |

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

## Security: limits, quotas and costs

Everything is in `server/limits.js`, and any number can be changed with an environment variable on Render (named in that file).

- **Speed limits.** Each visitor's address gets a steady allowance that refills over time: 300 game requests a minute, with smaller allowances for heavy ones (searches, map chunks, land quotes, the builder's stats: 60 a minute) and for signing in (20 a minute). Each signed-in player gets 120 actions a minute wherever they connect from. A minute of very busy play uses about 90, so real players never notice. Too fast, and the game answers "slow down a little" with how long to wait.
- **Real addresses.** The game sits behind Cloudflare, which passes on each visitor's real address (`cf-connecting-ip`), so one busy player can't slow down everyone else on the same Cloudflare server.
- **Wrong passwords and keys.** Ten wrong builder passwords from one address lock that address out for 15 minutes (even if the next one is right); the same for the stream and cron keys. Players: 8 wrong passwords lock that username for 15 minutes, and 30 wrong passwords from one address (across any usernames) lock that address.
- **Live connections.** At most 20 open at once from one address, 30 new ones a minute, about 40 messages a second on each, and a few sign-ins a minute. Flooding one gets it cut off.
- **Daily quotas, per player** (they reset at midnight UTC and are kept in the database, table `usage_daily`): 50 Town Square posts, 800 private messages, 1,500 group messages, 15 new group chats, 150 group invites, 50 offers, 30 reports, 20 renames, 40 heists planned, 400 practice games, and a few notification and election changes. Past one, the player is told when it resets.
- **Costs.** The radio's paid AI writer has 300 breaks a day and the paid voice 150,000 characters; past those it uses the free phrases and plain text until tomorrow. Requests are kept small (64 KB from players; only the builder can send big ones).
- **Browser safety headers** on every page: no guessing file types, no framing the game inside other sites, no camera, microphone or location, and https only.
- **Who sees what.** Every player action works from the signed-in player's own account; anything addressed by an id (a notice, a group chat, a heist, an offer, a car, a post) checks it's theirs first, and only the builder sees others' coins, accounts and reports.
- **The builder's view.** Stats → **Limits and costs today**: the AI budget used, each quota with who's used it most, and how many addresses are locked out (`GET /api/admin/usage`).

## Settings

**⚙️ Settings** on your own card has **Your name** (the name shown above your avatar; it used to be on the card itself), phone notifications and the getting-started guide.

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
| `PG_POOL_SIZE` | no | Database connections per server (default 16) |
| `RATE_PER_MIN` | no | Requests per minute per visitor (default 240) |

## API

Public: `GET /api/meta` · `GET /api/chunks?keys=0_0,1_0` · `GET /api/citizens?q=prefix` · `GET /api/citizens/:handle` · `GET /health` · WebSocket `/ws` (send `{"type":"sub","chunks":["0_0"]}`)

Builder (header `Authorization: Bearer ADMIN_TOKEN`): `POST /api/admin/found` · `POST /api/admin/buildings` · `PATCH|DELETE /api/admin/buildings/:id` · `POST /api/admin/buildings/restore` · `POST /api/admin/roads` · `POST /api/admin/citizens` · `DELETE /api/admin/citizens/:id` · `PUT /api/admin/build-post` · `GET /api/admin/requests` · `POST /api/admin/buildings/:id/finish|repair` · `POST /api/admin/construction/finish-all` · `POST /api/admin/bulldoze` · `POST /api/admin/citizens/bulk` · `PATCH /api/admin/citizens/:id` · `POST /api/admin/water` · `POST|DELETE /api/admin/vehicles` · `POST /api/admin/disasters` · `POST /api/admin/ruins/clear` · `PUT /api/admin/weather`

## Adding to the city

- **A building:** one line in `shared/catalog.js` (about 190 buildings and 20 road types are there now, grouped into tabs). Give it homes, jobs or visitors and the queue, jobs and hangouts use it automatically.
- **A road, vehicle, disaster or water type:** one entry in `ROAD_TYPES`, `VEHICLE_TYPES`, `DISASTER_TYPES` or `WATER_TYPES` in the same file.
- **A database change:** add a new entry at the end of `MIGRATIONS` in `server/db.js`. Never edit an old one.
