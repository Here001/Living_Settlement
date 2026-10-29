import pg from 'pg';
import { BUILDING_TYPES } from '../shared/catalog.js';
import { capacities } from '../shared/rules.js';

// Postgres returns bigint as text by default; our bigints are timestamps and sequence numbers that fit in a JS number.
pg.types.setTypeParser(20, v => Number(v));

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PG_POOL_SIZE || 8),
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
    for (const [type, t] of Object.entries(BUILDING_TYPES)) {
      const cap = capacities(type);
      await c.query('update buildings set home_cap = $2, job_cap = $3, hang_cap = $4, leisure = $5 where type = $1 and done and not ruin and (home_cap, job_cap, hang_cap, leisure) is distinct from ($2, $3, $4, $5)',
        [type, cap.homeCap, cap.jobCap, cap.hangCap, cap.leisure]);
    }
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; }
  finally { await c.query('select pg_advisory_unlock(90210)').catch(() => {}); c.release(); }
}

// Run a world change atomically. The advisory lock makes changes from every server instance happen one at a time,
// so two servers can never hand the same home to two people.
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
