import pg from 'pg';
import { BUILDING_TYPES } from '../shared/catalog.js';
import { capacities } from '../shared/rules.js';

// Postgres returns bigint as text by default; our bigints are timestamps and sequence numbers that fit in a JS number.
pg.types.setTypeParser(20, v => Number(v));

// sslmode=require (what Neon gives you) already means "check the certificate fully" in this version of pg; it's
// spelled out as verify-full so the connection stays exactly as safe when pg changes what "require" means.
const dbUrl = (process.env.DATABASE_URL || '').replace(/([?&]sslmode=)(require|prefer|verify-ca)\b/, process.env.PGSSL === '1' ? '$1$2' : '$1verify-full');
export const pool = new pg.Pool({
  connectionString: dbUrl || undefined,
  ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PG_POOL_SIZE || 16), // enough for hundreds of players acting at once; Neon allows far more
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 15000,          // a cold or unreachable database fails a request instead of hanging it
  keepAlive: true,
});
// Hosted Postgres (Neon) closes idle connections now and then. Without this listener that would crash the server.
pool.on('error', e => console.error('database connection dropped (will reconnect):', e.message));

// Each entry runs once, in order, and is recorded so it never runs again.
// To change the database later, add a new entry at the end. Never edit an old one.
const MIGRATIONS = [
  `create table meta (id int primary key default 1, data jsonb not null);

   create table buildings (
     id text primary key, type text not null,
     x int not null, y int not null, w int not null, d int not null, cx int not null, cy int not null,
     name text not null default '', requested_by text not null default '',
     built_at bigint not null, built_day int not null,
     home_cap int not null default 0, home_used int not null default 0,
     job_cap int not null default 0, job_used int not null default 0,
     leisure boolean not null default false);
   create index buildings_chunk on buildings (cx, cy);
   create index buildings_free_home on buildings (built_at, id) where home_used < home_cap;
   create index buildings_free_job on buildings (id) where job_used < job_cap;
   create index buildings_leisure on buildings (x, y) where leisure;

   create table roads (x int not null, y int not null, type text not null, cx int not null, cy int not null, primary key (x, y));
   create index roads_chunk on roads (cx, cy);

   -- seq is the order people arrived in; it is also their place in the housing queue.
   create table citizens (
     id text primary key, seq bigserial unique, handle text not null, joined_at bigint not null,
     founder boolean not null default false, source text,
     home_id text, home_cx int, home_cy int,
     job_id text, job_cx int, job_cy int,
     hang_id text, hang_cx int, hang_cy int,
     coins_base bigint not null default 0, coins_day int not null default 0, net int not null default 0);
   create unique index citizens_handle on citizens (lower(handle));
   create index citizens_handle_prefix on citizens (lower(handle) text_pattern_ops);
   create index citizens_outskirts on citizens (seq) where home_id is null;
   create index citizens_unemployed on citizens (seq) where home_id is not null and job_id is null;
   create index citizens_home on citizens (home_id);
   create index citizens_job on citizens (job_id);
   create index citizens_hang on citizens (hang_id);
   create index citizens_home_chunk on citizens (home_cx, home_cy);
   create index citizens_job_chunk on citizens (job_cx, job_cy);
   create index citizens_hang_chunk on citizens (hang_cx, hang_cy);

   create table events (id text primary key, t bigint not null, kind text, text text not null);
   create index events_t on events (t desc);

   -- Incoming social comments. Spawn requests wait as 'pending' until the worker processes them in batches.
   create table comments (id text primary key, t bigint not null, username text, text text, media_id text, source text,
     status text not null default 'stored');
   create index comments_pending on comments (t) where status = 'pending';
   create index comments_media on comments (media_id, t desc);`,

  // v2: hangout spots have a visitor capacity, like homes and jobs, so one new park can't re-route a whole district.
  `alter table buildings add column hang_cap int not null default 0, add column hang_used int not null default 0;
   update buildings b set hang_used = (select count(*) from citizens c where c.hang_id = b.id);
   drop index buildings_leisure;
   create index buildings_free_hang on buildings (x, y) where leisure and hang_used < hang_cap;`,

  // v3: buildings can be under construction (no homes, jobs or visitors until done), and the developer can
  // set someone's job by hand, which automatic hiring then leaves alone.
  `alter table buildings add column done boolean not null default true, add column ready_at bigint not null default 0;
   create index buildings_constructing on buildings (ready_at) where not done;
   alter table citizens add column manual boolean not null default false;
   drop index citizens_unemployed;
   create index citizens_unemployed on citizens (seq) where home_id is not null and job_id is null and not manual;`,

  // v4: water, ruins left by disasters, vehicles the developer places, and a record of disasters for replaying their animation.
  `create table water (x int not null, y int not null, kind text not null, cx int not null, cy int not null, primary key (x, y));
   create index water_chunk on water (cx, cy);
   alter table buildings add column ruin boolean not null default false, add column ruined_at bigint not null default 0;
   create table vehicles (id text primary key, type text not null, x int not null, y int not null, cx int not null, cy int not null, placed_at bigint not null);
   create index vehicles_chunk on vehicles (cx, cy);
   create table disasters (id text primary key, kind text not null, x int not null, y int not null, r int not null, dir real not null default 0, t bigint not null, hit int not null default 0);
   create index disasters_t on disasters (t desc);`,
  // v5: every citizen is a man or a woman. Existing citizens get a fixed coin-flip from their id.
  `alter table citizens add column gender char(1) not null default 'm' check (gender in ('m', 'f'));
   update citizens set gender = case when ('x' || substr(md5(id), 1, 2))::bit(8)::int % 2 = 0 then 'm' else 'f' end;`,
  // v6: the developer's unpublished draft (only one at a time).
  `create table draft (id int primary key default 1, data jsonb not null, updated_at bigint not null);`,
  // v7: a building can be turned to face the other way (its width and depth swap).
  `alter table buildings add column rot smallint not null default 0;`,
  // v8: players prove an avatar is theirs (claim codes), set a password, and stay signed in (sessions).
  `alter table citizens add column pass_hash text, add column pass_set_at bigint;
   create table claims (id_hash text primary key, citizen_id text not null, handle text not null, code text not null,
     created_at bigint not null, expires_at bigint not null, verified_at bigint, used_at bigint);
   create index claims_code on claims (code);
   create index claims_citizen on claims (citizen_id);
   create table sessions (token_hash text primary key, citizen_id text not null, created_at bigint not null, last_seen bigint not null);
   create index sessions_citizen on sessions (citizen_id);`,
  // v9: small settings that must survive restarts (like which Instagram account is connected).
  `create table settings (key text primary key, value jsonb not null);`,
  // v10: a colonist may choose their gender once, after claiming their avatar.
  `alter table citizens add column gender_chosen boolean not null default false;`,
  // v11: messages colonists post in the Town Square.
  `create table messages (id text primary key, citizen_id text not null, handle text not null, gender char(1) not null default 'm', text text not null, t bigint not null);
   create index messages_t on messages (t desc);`,
  // v12: a colonist's display name (first and last, or just one), shown on their avatar. The username stays for search.
  `alter table citizens add column display_name text;`,
  // v13: official posts from the developer, and pinned posts at the top of the Town Square.
  `alter table messages add column official boolean not null default false, add column pinned boolean not null default false;`,
  // v14: the game day a colonist last took a job themselves (one new job per game day)
  `alter table citizens add column job_changed_day int;`,
  // v15: a short visit somewhere (the casino), so everyone sees the colonist inside while it lasts
  `alter table citizens add column visit_id text, add column visit_until bigint, add column visit_cx int, add column visit_cy int;`,
  // v16: creature races and bets
  `create table races (n int primary key, start_at bigint not null, weather text not null, odds jsonb not null, result jsonb, cup jsonb,
     announced boolean not null default false, settled boolean not null default false);
   create table race_bets (id text primary key, n int not null, citizen_id text not null, handle text not null, creature text not null,
     amount int not null, pays real not null, payout int, t bigint not null);
   create index race_bets_n on race_bets (n); create index race_bets_citizen on race_bets (citizen_id, n);`,
  // v17: crime (last attempt, jail time) and pets
  `alter table citizens add column crime_at bigint, add column jailed_until bigint, add column pet jsonb;`,
  // v18: the lottery
  `create table lotteries (id serial primary key, draw_at bigint not null, price int not null, bonus int not null default 0, created_at bigint not null,
     announced boolean not null default false, drawn boolean not null default false, winner text, prize int);
   create table lottery_tickets (lottery_id int not null, citizen_id text not null, handle text not null, count int not null, primary key (lottery_id, citizen_id));`,
  // v19: when a visit started, so every viewer can draw the same trip there (walk, drive, cab or police car)
  `alter table citizens add column visit_from bigint;`,
  // v20: the Bank, cars, moving home, and owning buildings
  `alter table citizens add column bank bigint not null default 0, add column cars jsonb, add column car_active text, add column home_changed_day int;
   alter table buildings add column owner_id text, add column owner_handle text, add column bought_at bigint, add column price int;
   create index buildings_owner on buildings (owner_id) where owner_id is not null;`,
  // v21: gifts between colonists (how much each has sent today, for the daily limit)
  `alter table citizens add column gift_day int, add column gift_sent int not null default 0;`,
  // v22: private chats between verified colonists, and when each was last online
  `alter table citizens add column last_seen bigint;
   create table dms (id text primary key, pair text not null, sender_id text not null, recipient_id text not null, text text not null, t bigint not null, read boolean not null default false);
   create index dms_pair on dms (pair, t desc); create index dms_unread on dms (recipient_id) where not read;`,
  // v23: blocking, reports to the developer, and muting colonists who break the rules
  `alter table citizens add column muted_until bigint;
   create table blocks (blocker_id text not null, blocked_id text not null, t bigint not null, primary key (blocker_id, blocked_id));
   create index blocks_blocked on blocks (blocked_id);
   create table reports (id text primary key, reporter_id text not null, reporter_handle text not null, target_id text not null, target_handle text not null,
     kind text not null, message_id text not null, text text not null, context jsonb, reason text not null, t bigint not null,
     status text not null default 'open', action text, resolved_at bigint, unique (reporter_id, message_id));
   create index reports_open on reports (t desc) where status = 'open';`,
  // v24: daily rewards for coming back (the real-world day they last collected, and their streak)
  `alter table citizens add column daily_day int, add column daily_streak int not null default 0, add column daily_best int not null default 0;`,
  // v25: badges, and running counts of things that leave no other trace (casino wins, gifts, crimes…)
  `alter table citizens add column stats jsonb;
   create table achievements (citizen_id text not null, id text not null, t bigint not null, primary key (citizen_id, id));
   create index achievements_id on achievements (id);`,
  // v26: weekly leaderboards (this week's scores, and each week's champions)
  `create table scores (week int not null, key text not null, citizen_id text not null, value bigint not null default 0, primary key (week, key, citizen_id));
   create table weekly_champions (week int not null, board text not null, citizen_id text not null, handle text not null, value bigint not null, primary key (week, board));
   create table weekly_done (week int primary key);`,
  // v27: every Racetrack runs its own races (races and bets belong to a track)
  `alter table races add column track_id text not null default '';
   alter table race_bets add column track_id text not null default '';
   update races set track_id = coalesce((select id from buildings where type = 'racetrack' and done and not ruin order by built_at, id limit 1), '');
   update race_bets b set track_id = r.track_id from races r where r.n = b.n;
   alter table races drop constraint races_pkey; alter table races add primary key (track_id, n);
   create index race_bets_track on race_bets (track_id, n);`,
  // v28: a casino table game in progress (Blackjack hand or Rocket flight)
  `alter table citizens add column casino_game jsonb;`,
  // v29: extra ways to earn (shifts, deliveries, fishing, foraging, scavenging): each colonist's progress today
  `alter table citizens add column earn jsonb;`,
  // v30: colony events (festival, fishing frenzy, meteor shower, storm, crime wave, supply drop)
  `create table colony_events (id serial primary key, kind text not null, started_at bigint not null, ends_at bigint not null, data jsonb, ended boolean not null default false);`,
  // v31: indexes for chats (by sender and recipient), Town Square posts by author, who's online, weekly race winnings,
  // and the races still to run (checked every two seconds)
  `create index if not exists dms_sender on dms (sender_id, recipient_id);
   create index if not exists dms_recipient on dms (recipient_id, t desc);
   create index if not exists messages_citizen on messages (citizen_id, t desc);
   create index if not exists citizens_last_seen on citizens (last_seen) where last_seen is not null;
   create index if not exists race_bets_t on race_bets (t);
   create index if not exists races_unsettled on races (start_at) where not settled;`,
  // v32: the colony is now called Gliese-12b (after its planet), and so is its official updates account
  `update meta set data = jsonb_set(data, '{name}', '"Gliese-12b"') where lower(replace(data->>'name', ' ', '-')) = 'man-landing';
   update messages set handle = 'Gliese-12b Updates' where official and handle = 'Man Landing Updates';`,
  // v33: the Colony Log no longer lists purchases or small construction; clear the old ones out
  `delete from events where kind in ('car', 'pet') or (kind = 'property' and text like '%bought%')
     or (kind = 'build' and (text like '% update: %' or text like '%Tree%' or text like '%Road%' or text like '%Bench%' or text like '%Lamp%' or text like '%Flower%' or text like '%Bush%'));`,
  // v34: personal notices (e.g. "someone picked your pocket"), kept until the colonist has seen them
  `create table notices (id bigserial primary key, citizen_id text not null, t bigint not null, kind text, text text not null, seen boolean not null default false);
   create index notices_unseen on notices (citizen_id, seen, t desc);`,
  // v35: the first-day guide (which steps' rewards a colonist has collected, and whether they hid it)
  `alter table citizens add column guide jsonb;`,
  // v36: phone notifications (Web Push): one row per phone or browser a colonist turned them on in
  `create table push_subs (endpoint text primary key, citizen_id text not null, keys jsonb not null, prefs jsonb, created bigint not null, fails int not null default 0);
   create index push_subs_citizen on push_subs (citizen_id);`,
  // v37: mayor elections (candidates and votes per week, and each week's result)
  `create table candidates (week int not null, citizen_id text not null, handle text not null, policy text not null, pitch text, t bigint not null, primary key (week, citizen_id));
   create table mayor_votes (week int not null, voter_id text not null, candidate_id text not null, t bigint not null, primary key (week, voter_id));
   create index mayor_votes_cand on mayor_votes (week, candidate_id);
   create table elections (week int primary key, winner_id text, winner_handle text, policy text, votes int not null default 0, total int not null default 0, decided_at bigint);`,
  // v38: where a trip starts (the colonist's real position when they set off) and whether they walk it
  `alter table citizens add column visit_origin jsonb;`,
  // v39: developer stats: who played each real day, every coin earned or spent (by kind), and a daily money snapshot
  `create table activity (day int not null, citizen_id text not null, t bigint not null, primary key (day, citizen_id));
   create index activity_citizen on activity (citizen_id, day);
   create table flows (day int not null, key text not null, n bigint not null default 0, coins bigint not null default 0, primary key (day, key));
   create table flow_players (day int not null, key text not null, citizen_id text not null, primary key (day, key, citizen_id));
   create table snapshots (day int primary key, data jsonb not null, t bigint not null);`,
  // v40: the Game House: a game in progress there (penalties, darts, snooker practice) and the day of the last free wheel spin
  `alter table citizens add column play_game jsonb, add column wheel_day int, add column snooker_day int;`,
  // v41: tables where colonists play each other (Whot, Ludo, Ayo, Snooker, Hold'em), and the table each one is at
  `create table game_tables (id text primary key, game text not null, building_id text not null, stake int not null, seats int not null, opts jsonb,
     players jsonb not null, state jsonb, status text not null, created_at bigint not null, turn_at bigint, ended_at bigint, result jsonb);
   create index game_tables_open on game_tables (building_id, game, status);
   create index game_tables_turn on game_tables (status, turn_at);
   alter table citizens add column table_id text;`,
  // v42: chats: replies, message requests, pinned and deleted chats (per person), the fee for far-away messages, and group chats
  `alter table dms add column reply_to text, add column reply_text text, add column reply_from text, add column fee int not null default 0;
   create table chat_state (citizen_id text not null, key text not null, pinned boolean not null default false, cleared_at bigint not null default 0,
     accepted boolean not null default false, read_at bigint not null default 0, primary key (citizen_id, key));
   create table chat_groups (id text primary key, name text not null, owner_id text not null, created_at bigint not null);
   create table group_members (group_id text not null, citizen_id text not null, status text not null, invited_by text, t bigint not null, primary key (group_id, citizen_id));
   create index group_members_citizen on group_members (citizen_id, status);
   create table group_msgs (id text primary key, group_id text not null, sender_id text not null, text text not null, t bigint not null,
     reply_to text, reply_text text, reply_from text, fee int not null default 0);
   create index group_msgs_group on group_msgs (group_id, t);`,
  // v43: renting by choice, the cash-flow ledger, group crimes (heists) and the activity stars
  `alter table citizens add column left_home boolean not null default false, add column acts bigint not null default 0, add column stars int not null default 0,
     add column heist_at bigint not null default 0;
   create table ledger (id bigserial primary key, citizen_id text not null, t bigint not null, key text not null, coins bigint not null, note text);
   create index ledger_citizen on ledger (citizen_id, id desc);
   create table heists (id text primary key, kind text not null, planner_id text not null, group_id text not null, target_id text, target_label text,
     building_id text, at bigint not null, status text not null, result jsonb, created_at bigint not null);
   create index heists_status on heists (status, at);`,
  // v44: joining without Instagram (a username and password on the website, or Google)
  `alter table citizens add column google_sub text, add column email text;
   create unique index citizens_google on citizens (google_sub) where google_sub is not null;`,
  // v45: colony radio: each DJ talk break (its script, what it talked about, and the voice recording)
  `create table radio_talk (id text primary key, station text not null, slot int not null, t bigint not null, at bigint not null, kind text,
     text text not null, events text[] not null default '{}', focus jsonb, audio bytea, dur real, source text, unique (station, slot));
   create index radio_talk_t on radio_talk (station, t);`,
  // v46: colony radio: songs the developer uploads for each station
  `create table radio_tracks (id text primary key, station text not null, title text not null, dur real not null, mime text not null,
     size int not null, data bytea not null, enabled boolean not null default true, t bigint not null);
   create index radio_tracks_station on radio_tracks (station);`,
  // v47: colony radio: who spoke in a break (the lead alone, or the lead and their sidekick) and their lines
  `alter table radio_talk add column dj text, add column lines jsonb;`,
  // v48: radio songs can live in Cloudflare R2 (url and a data-saver copy) instead of the database; who the artist is
  `alter table radio_tracks alter column data drop not null, add column url text, add column lite_url text, add column lite_size int,
     add column r2key text, add column artist text;`,
  // v49: land plots players buy and build on, building upgrade levels, and offers between colonists for each other's property
  `create table if not exists plots (id text primary key, owner_id text not null, owner_handle text not null, x int not null, y int not null,
     w int not null, d int not null, cx int not null, cy int not null, price numeric not null default 0, bought_at bigint not null, name text not null default '');
   create index if not exists plots_owner on plots (owner_id);
   create index if not exists plots_chunk on plots (cx, cy);
   alter table buildings add column if not exists plot_id text, add column if not exists level int not null default 1,
     add column if not exists up_at bigint not null default 0, add column if not exists up_cost numeric not null default 0;
   create index if not exists buildings_plot on buildings (plot_id);
   create table if not exists offers (id text primary key, kind text not null, target_id text not null, label text not null default '',
     from_id text not null, from_handle text not null, to_id text not null, to_handle text not null, amount numeric not null, counter numeric,
     message text not null default '', reply text not null default '', status text not null default 'open', created_at bigint not null, expires_at bigint not null, closed_at bigint);
   create index if not exists offers_to on offers (to_id, status);
   create index if not exists offers_from on offers (from_id, status);`,
  // v50: the clock looks for finished upgrades every few seconds; only the few buildings being upgraded are indexed
  `create index if not exists buildings_upgrading on buildings (up_at) where up_at > 0;
   create index if not exists offers_open on offers (expires_at) where status in ('open', 'countered');`,
  // v51: coins paid into or out of the treasury by one player's own actions (trips, shifts, gigs…), which don't wait for
  // the colony-wide lock; the next colony-wide change (or the clock, within seconds) adds them to the treasury
  `create table if not exists treasury_pending (id bigserial primary key, delta numeric not null, t bigint not null);`,
  // v52: Fight Night at the Colosseum: the nights, their bouts, who signed up, the bets, and each fighter's record
  `create table if not exists fight_nights (n int primary key, start_at bigint not null, arena_id text, made boolean not null default false,
     done boolean not null default false, gap bigint, fast boolean not null default false);
   create table if not exists fight_bouts (n int not null, i int not null, start_at bigint not null, a jsonb not null, b jsonb not null, odds jsonb not null,
     result jsonb, settled boolean not null default false, primary key (n, i));
   create table if not exists fight_signups (n int not null, citizen_id text not null, t bigint not null, primary key (n, citizen_id));
   create table if not exists fight_bets (id text primary key, n int not null, i int not null, citizen_id text not null, handle text not null, side text not null,
     amount int not null, pays numeric not null, payout int, t bigint not null);
   create index if not exists fight_bets_bout on fight_bets (n, i);
   create index if not exists fight_bets_who on fight_bets (citizen_id, n);
   create table if not exists fighters (citizen_id text primary key, handle text not null, wins int not null default 0, losses int not null default 0,
     kos int not null default 0, rating int not null default 1000, purses bigint not null default 0);`,
  // v53: boats and aircraft players buy at the dealer show on the map as their own vehicles; offers can be cleared from your list
  `alter table vehicles add column if not exists owner_id text; alter table vehicles add column if not exists owner_handle text; alter table vehicles add column if not exists car_id text;
   create index if not exists vehicles_owner on vehicles (owner_id);
   alter table offers add column if not exists from_hidden boolean not null default false; alter table offers add column if not exists to_hidden boolean not null default false;`,
  // v54: crime mini games: each game the server deals (its level comes from the seed), and what came of it
  `create table if not exists crime_runs (id text primary key, citizen_id text not null, kind text not null, seed bigint not null, diff int not null,
     practice boolean not null default false, started_at bigint not null, finished_at bigint, chance numeric not null default 0, band text, night boolean,
     loot int not null default 0, scene jsonb, result jsonb);
   create index if not exists crime_runs_who on crime_runs (citizen_id, started_at);`,
  // v55: heists played live: each member's chosen part, the live job (crew, parts, levels, the deadline), and each part's game
  `alter table heists add column if not exists roles jsonb; alter table heists add column if not exists live jsonb;
   alter table crime_runs add column if not exists heist_id text; create index if not exists crime_runs_heist on crime_runs (heist_id);`,
  // v56: street games (Hunters & Civilians, Hide and seek): each match's result, and the prizes paid out each day
  `create table if not exists arena_results (id text primary key, mode text not null, started_at bigint not null, ended_at bigint, humans int not null default 0, result jsonb);
   create table if not exists arena_pay (citizen_id text not null, day text not null, n int not null default 0, primary key (citizen_id, day));`,
  // v57: a run of jobs that came off makes the next one harder (wiped when caught)
  `alter table citizens add column if not exists crime_streak int not null default 0;`,
  // v58: group chats can close (a heist's crew chat closes a little after the result is in)
  `alter table chat_groups add column if not exists closed_at bigint;`,
  // v59: the economy: jobs pulled today (each pays a bit less), the status a player has bought, and hourly money snapshots
  `alter table citizens add column if not exists crime_day text, add column if not exists crime_today int not null default 0, add column if not exists status_tier int not null default 0;
   create table if not exists econ_snaps (t bigint primary key, money numeric not null, players numeric not null, treasury numeric not null, top10 numeric not null default 0, wages numeric not null default 0, f numeric not null default 1);`
];

export async function migrate() {
  const c = await pool.connect();
  try {
    await c.query('select pg_advisory_lock(90210)'); // only one server migrates at a time
    await c.query('create table if not exists schema_migrations (version int primary key, at timestamptz not null default now())');
    // Databases created by the first prototype have no migration record; their tables are replaced.
    const { rows } = await c.query('select coalesce(max(version), 0) v from schema_migrations');
    if (rows[0].v === 0) {
      const old = await c.query(`select 1 from information_schema.columns where table_name = 'buildings' and column_name = 'data'`);
      if (old.rowCount) {
        console.log('Replacing prototype tables with the scalable schema');
        await c.query('drop table if exists meta, buildings, roads, citizens, events, comments cascade');
      }
    }
    for (let v = rows[0].v + 1; v <= MIGRATIONS.length; v++) {
      await c.query('begin');
      await c.query(MIGRATIONS[v - 1]);
      await c.query('insert into schema_migrations (version) values ($1)', [v]);
      await c.query('commit');
      console.log(`Database migrated to version ${v}`);
    }
    // Keep each building's capacities in step with the catalog, so changing a number there takes effect on restart.
    for (const lv of (await c.query('select distinct level from buildings')).rows.map(r => r.level)) for (const [type, t] of Object.entries(BUILDING_TYPES)) {
      const cap = capacities(type, lv);
      await c.query('update buildings set home_cap = $2, job_cap = $3, hang_cap = $4, leisure = $5 where type = $1 and level = $6 and done and not ruin and (home_cap, job_cap, hang_cap, leisure) is distinct from ($2, $3, $4, $5)',
        [type, cap.homeCap, cap.jobCap, cap.hangCap, cap.leisure, lv]);
    }
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; }
  finally { await c.query('select pg_advisory_unlock(90210)').catch(() => {}); c.release(); }
}

// Run a world change atomically. The advisory lock makes changes from every server instance happen one at a time,
// so two servers can never hand the same home to two people.
// One player's own action: an ordinary transaction without the colony-wide lock. Rows it changes are still locked
// (select … for update), so two actions on the same colonist still happen one after the other.
export async function personalTx(fn) {
  const client = await pool.connect(); let broken = false;
  try {
    await client.query('begin');
    await client.query("set local idle_in_transaction_session_timeout = '30s'");
    const r = await fn(client);
    await client.query('commit');
    return r;
  } catch (e) { await client.query('rollback').catch(() => { broken = true; }); throw e; }
  finally { client.release(broken); }
}
export async function worldTx(fn) {
  const client = await pool.connect(); let broken = false;
  try {
    await client.query('begin');
    await client.query("set local idle_in_transaction_session_timeout = '60s'"); // a stuck change can't hold the world lock forever
    await client.query('select pg_advisory_xact_lock(4242)');
    const r = await fn(client);
    await client.query('commit');
    return r;
  } catch (e) { await client.query('rollback').catch(() => { broken = true; }); throw e; }
  finally { client.release(broken); } // a connection that couldn't even roll back is thrown away, not reused
}
