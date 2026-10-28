import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined,
  max: 5,
});

export async function migrate() {
  await pool.query(`
    create table if not exists meta      (id int primary key default 1, data jsonb not null);
    create table if not exists buildings (id text primary key, data jsonb not null);
    create table if not exists roads     (key text primary key, type text not null);
    create table if not exists citizens  (id text primary key, handle text not null, data jsonb not null);
    create unique index if not exists citizens_handle_lower on citizens (lower(handle));
    create table if not exists events    (id text primary key, t bigint not null, kind text, text text not null);
    create index if not exists events_t on events (t desc);
    create table if not exists comments  (id text primary key, t bigint not null, username text, text text, media_id text, source text);
    create index if not exists comments_media on comments (media_id, t desc);
  `);
}

// Run several statements atomically.
export async function tx(fn) {
  const client = await pool.connect();
  try { await client.query('begin'); const r = await fn(client); await client.query('commit'); return r; }
  catch (e) { await client.query('rollback'); throw e; }
  finally { client.release(); }
}
