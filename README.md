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

In developer mode, the coin counter at the top shows the treasury. **Tap it** to add coins (with quick +1,000 / +10,000 / +100,000 / +1,000,000 buttons, or any amount up to 10 million at a time) or to take some out. Added coins are new money; they aren't taken from anyone. The treasury pays wages, bank interest, daily rewards, casino and race winnings, and everything in the Earn tab, so top it up if it runs low. For a player, tapping their own coin counter opens their Earn tab.

## Renaming the colony

In developer mode, the Town Square has **🪧 Colony name**. Renaming changes the name at the top of the screen, in the Colony Log ("Old name is now called New name") and on shared pictures, and official posts then come from "<name> Updates". The colony that was called Man-Landing was renamed **Gliese-12b** automatically (database migration 32).

## Removing people and starting over

In developer view, **Colonists** (at the bottom) has:
- **Remove these**: paste usernames to remove several colonists at once. Their homes and jobs open up for others.
- **Remove everyone except me**: clears all colonists but keeps the buildings.
- **Reset colony**: type `RESET` to wipe the whole colony (map, colonists, news, Town Square messages, drafts) and return to "Found your colony". The Instagram connection is kept. Everyone watching is reloaded automatically.

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

## Your own card: Work · Crime · Go here

A signed-in colonist with a home sees these on their own card. They see one at a time.

- **Go here.** Every building's card (except the jail, police stations, trees and street furniture) shows **🚶 Go here** and how far it is from your colonist right now, in miles. Pressing it sends them there for 4 game hours (about 5 real minutes), and the camera locks onto them, walking, driving or in a cab, until they arrive ("📍 You've arrived"). On your own home it says **🏠 Go home**. Everyone sees them there. Other colonists' cards have **Visit their home** too.
- **Getting there.** Colonists travel to wherever they're going, whether that's going out, the Casino or the Jail, and come back the same way afterwards.
  - Short trips (under 14 tiles) are walked.
  - Longer ones are driven by colonists who own a car; everyone else takes a cab.
  - Anyone caught for a crime is driven to the Jail in a police car with its lights on.
- **Crime.** Crimes can be tried once every 10 minutes.
  - **Pickpocket:** steal 10–25% of a colonist's coins, up to 300. Other colonists' cards have **Pick their pocket**.
    - Only someone **out and about** can be pickpocketed: on their lunch break, commuting, out in the evening, job hunting, or on a trip somewhere that isn't a home.
    - Nobody can be pickpocketed at home (asleep or relaxing, roughly 21:40–07:45 game time), while visiting someone's home, or in the Jail.
    - At work (roughly 07:50–11:40 and 13:10–16:15), only a workmate at the same building can try.
    - The server checks this (`routineAt` in `shared/rules.js`, `whereIs` in `server/actions.js`). The card shows "🛡️ … is safe at home right now" instead of the button when it isn't possible.
  - **Rob the nearest shop:** 60–400 coins from the till, which the treasury pays.
  - **Chances** depend on how far the nearest Police station is from where the crime happens (`crimeOdds()` in `shared/rules.js`):
    - 🟢 more than 40 tiles away, or no police at all: pickpocket 75%, robbery 60%
    - 🟡 16 to 40 tiles: pickpocket 45%, robbery 32%
    - 🔴 within 15 tiles: pickpocket 20%, robbery 12%
    - A crime wave adds 15 points, to at most 90%.
  - **Where it happens:** for a robbery, the shop; for a pickpocket, wherever the victim is right now (a place they're visiting, their workplace, their hangout, or near home). Before you try, the Crime tab shows that victim's odds and where they are.
  - **Getting caught:** a fine of twice the amount they tried to take, at least 25, which goes to the treasury.
  - **Jail:** if the colony has a Jail, 10 minutes in it, seen inside. A jailed colonist can't gamble, bet, go out, adopt or commit crimes.
  - **News:** successes are reported anonymously in the Colony Log; arrests name the culprit.
- **Pet.** Adopt one of the six native creatures for 200 coins, name it, and it walks beside you on the map. You can rename it or let it go.

## Finding a building to build

Every building menu has a **search box** at the top that searches all buildings by name, by what they are, or by job title ("bank", "pets", "school", "banker"). Each result says which menu it lives in (for example "Shops → Small"), and tapping one picks it up to place, the same as in its own menu. There are four kinds of bank, all under Offices (`BANK_TYPES` in `shared/catalog.js`). Any of them takes deposits and pays out withdrawals from the same account.

| Bank | Size | Look | Jobs | Cost |
|---|---|---|---|---|
| Microfinance bank | 1×1 | a small cream branch with a green "MFB" sign | 3 loan officers | 2,500 |
| Community bank | 2×1 | a red-brick branch with a "COMMUNITY" sign | 8 tellers | 4,500 |
| Local bank | 2×2 | the colonnaded classic (banks built before keep this look) | 24 bankers, down from 92 | 8,200 |
| International bank | 3×3 | a tall glass tower with an "INTL BANK" sign | 40 investment bankers | 22,000 |

## Mayor elections

Town Square has a **👑 Mayor** tab. Every week (Monday to Monday, UTC) any verified colonist with a home can **run for mayor** for 500 coins in cash. They pick a pledge and can write a pitch of up to 140 characters (no links). Every verified colonist gets one vote, which they can change until the week ends. Candidates can withdraw (no refund).

When the week ends, the most votes wins; a tie goes to whoever ran first. The winner is mayor for the next week:

| Pledge | While they're mayor |
|---|---|
| 💼 Jobs drive | side earnings (deliveries, shifts, fishing, foraging, scavenging) pay 15% more |
| 🚓 Tough on crime | every pickpocket and robbery is 15 points less likely to succeed |
| 🏦 Savers first | bank interest is doubled |
| 🎁 Daily bonus | daily rewards are 50% bigger |

- **Perks:** the mayor earns **250 coins a game day** from the treasury, and wears a 👑 on their map name tag (shown when zoomed in a little), on their card ("Role: Mayor") and on their Town Square posts.
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

A signed-in colonist's own card opens with **🧭 Getting started**: six first steps, each with a small reward the treasury pays once, and a **+250** bonus for finishing them all. Each step is ticked off from what the player has actually done (`server/guide.js`), so steps they've already done count straight away.

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
  - Prices, paid in cash (`PET_PRICES` in `shared/creatures.js`, never under 500): Mudgulper 500, Ironshell 700, Dustrunner 900, Skyskimmer 1,200, Starcrest 1,500, Glimmerhop 2,000.
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

These live on a signed-in colonist's own card, under **Home**, **👛 Wallet** and **Cars**, and on a Bank's own card.

- **Bank.**
  - **All pay is cash.** Wages, rent, profits and winnings arrive as cash on you, and cash can be pickpocketed.
  - **Deposits and withdrawals happen at a Bank.** Tap any bank on the map (Microfinance, Community, Local or International, all under Offices; or type "bank" in the build menu search): its card has **🏦 Your account**, with Deposit, Withdraw and Deposit all my cash. The server refuses both unless the request names a finished Bank.
  - The **👛 Wallet** tab on your own card shows your cash and savings, and has **Go to the nearest Bank**.
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
- **Gifts.** Signed-in colonists can send coins to each other, with **Send a gift** on another colonist's card or **Gift coins** in the Wallet tab.
  - Gifts are paid in cash, from what you have on you; withdraw savings at a Bank first.
  - Each colonist can send up to 2,000 a game day, so nobody can funnel a stack of accounts into one.
  - Only verified avatars (claimed, with a password) can receive gifts.
  - The Colony Log says who gifted whom, but not the amount.
- **New buildings.** A **Gym** and an outdoor **Fitness park**, under Parks → Sports.

## Chats and who's online

- **Who can chat.** Verified colonists (claimed, signed in) can message each other privately.
  - Tap **💬 Message** on a verified colonist's card, or open the **Chats** tab, which only signed-in players see.
  - The Chats tab lists your conversations with unread counts, plus an **Online now** row.
- **Delivery.** Messages arrive live, with a pop-up and an unread badge, and go only to the two people's own screens, never to anyone else.
- **Limits.** Messages are up to 500 characters, with a short pause between sends. The last 500 messages of each chat are kept.
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
  - 📦 **Supply drop** (15 min, needs the landing station): the first 15 colonists to tap **Claim supplies** in the Earn tab get 100–300 coins each (from the treasury).
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
- **The 7-day cycle.** 50 → 75 → 100 → 125 → 150 → 200 → **400** on day 7, then it starts again at 50. The streak count keeps growing across cycles.
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

## Badges

- **What they are.** 25 badges in 7 groups (`shared/achievements.js`): Settling in, Money, Things you own, Luck, Friends, Coming back, On the wrong side. Each is Bronze, Silver or Gold.
- **Earning them.** Badges are worked out from what a colonist has: their home, coins, cars, buildings, race and lottery wins, chats, streaks and so on. Things that leave no other trace (casino wins, the biggest casino win, gifts, crimes, jail, cars bought, pets) are counted in `citizens.stats`.
  - Only verified colonists earn them.
  - A colonist is checked right after anything they do, and every minute while they have the colony open, so race and lottery wins count too.
- **Showing them.**
  - New badges pop up live ("🏅 New badge: …", with **See**).
  - Gold ones are announced in the Colony Log.
  - Every colonist's card shows a row of their badges, gold first, for anyone to see.
  - Your own card has a **Badges** tab with all 25: earned or locked, how to earn each, and what share of colonists has it.
- **Coins.** Badges are cosmetic and pay no coins.

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

The map is tuned for low-end Android phones. The main pieces, all in `public/index.html`:
- **Buildings are cached pictures.** Each finished building is drawn once into its own picture, sized to its type's measured outline and redrawn only when the zoom moves to a new step, and that picture is copied each frame. Night lights and chimney smoke are replayed on top. Buildings that animate (clocks, windmills, neon, ferris wheels…) are drawn live. The cache is limited to 6 to 9 million pixels.
- **Vehicles are cached pictures** too: one per type, colour and heading (32 headings). Flashing sirens are drawn live.
- **People are drawn from pre-drawn parts**, packed on 1024×1024 pages. Pages are kept small because adding a part to a page that's also being drawn from makes the browser copy the whole page.
- **Quality adapts.** If frames run slow, the map drops to a lower resolution and simulates fewer people (1,500 → 1,100 → 700 → 450). Each phone remembers the level it settled on. On a first visit, a phone with little memory or few cores starts two steps down.
- **Fonts never block the first screen.** On a slow or blocked connection the game opens in the phone's own font.

Results on a simulated low-end Android (360×780 screen, CPU slowed 6×, 9,000 colonists):
- town centre: 2.4 → 8–10 frames a second
- zoomed out over the whole colony: 8 → 11–30
- jumping from the whole colony into a busy street: freezes went from 2.2 s to under 0.3 s
- total freezes while loading: 13.5 s → 5.5–7.5 s

At full speed the town centre runs at about 46–60 frames a second (it was 18). A two-minute session of wandering, zooming and opening tabs keeps memory flat at 20–30 MB.

## Run it on your computer

With Docker: `docker compose up --build`, then open http://localhost:3000/#builder (token `local-dev-token-please-change`).

Without Docker: install Node 20+ and Postgres, copy `.env.example` to `.env`, fill it in, then `npm install` and `npm run dev`.

| Command | What it does |
|---|---|
| `npm test` | About 285 end-to-end checks against a running server. **Throwaway database only:** it founds a test town. Start that server with `ALLOW_TEST_ROUTES=1 RATE_PER_MIN=5000` so the payday check runs and the test isn't rate-limited. |
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
