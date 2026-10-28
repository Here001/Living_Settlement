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
});

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
      await c.query('update buildings set home_cap = $2, job_cap = $3, hang_cap = $4, leisure = $5 where type = $1 and (home_cap, job_cap, hang_cap, leisure) is distinct from ($2, $3, $4, $5)',
        [type, cap.homeCap, cap.jobCap, cap.hangCap, cap.leisure]);
    }
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; }
  finally { await c.query('select pg_advisory_unlock(90210)').catch(() => {}); c.release(); }
}

// Run a world change atomically. The advisory lock makes changes from every server instance happen one at a time,
// so two servers can never hand the same home to two people.
export async function worldTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(4242)');
    const r = await fn(client);
    await client.query('commit');
    return r;
  } catch (e) { await client.query('rollback').catch(() => {}); throw e; }
  finally { client.release(); }
}
