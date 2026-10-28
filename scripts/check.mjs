// Recounts everything from scratch and compares it with the running totals the server keeps.
// Safe to run against the live database at any time (read-only). Usage: npm run check
import 'dotenv/config';
import pg from 'pg';
import { BUILDING_TYPES } from '../shared/catalog.js';
import { GRANT, taxOf } from '../shared/rules.js';

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined });
await db.connect();
let bad = 0;
const check = (ok, what, detail = '') => { console.log(ok ? '  ✓' : '  ✗', what, ok ? '' : detail); if (!ok) bad++; };
const one = async sql => (await db.query(sql)).rows[0];

const meta = (await one('select data from meta where id = 1'))?.data;
if (!meta) { console.log('Not founded yet.'); process.exit(0); }
const counts = await one(`select count(*)::int pop, count(home_id)::int res, count(job_id)::int emp,
  count(*) filter (where job_id is not null and home_id is null)::int jobless_home from citizens`);
check(meta.population === counts.pop, 'population matches', `${meta.population} vs ${counts.pop}`);
check(meta.residents === counts.res, 'residents match', `${meta.residents} vs ${counts.res}`);
check(meta.employed === counts.emp, 'employed match', `${meta.employed} vs ${counts.emp}`);
check(counts.jobless_home === 0, 'nobody in the Outskirts holds a job', `${counts.jobless_home}`);

for (const [col, cap, ref] of [['home_used', 'home_cap', 'home_id'], ['job_used', 'job_cap', 'job_id'], ['hang_used', 'hang_cap', 'hang_id']]) {
  const r = await one(`select count(*)::int n from buildings b where b.${col} <> (select count(*) from citizens c where c.${ref} = b.id)`);
  check(r.n === 0, `${col.replace('_used', '')} occupancy counts are exact`, `${r.n} buildings off`);
  const over = await one(`select count(*)::int n from buildings where ${col} > ${cap}`);
  check(over.n === 0, `no building over its ${col.replace('_used', '')} capacity`, `${over.n} over`);
}
const dangling = await one(`select count(*)::int n from citizens c where (home_id is not null and not exists (select 1 from buildings b where b.id = c.home_id))
  or (job_id is not null and not exists (select 1 from buildings b where b.id = c.job_id)) or (hang_id is not null and not exists (select 1 from buildings b where b.id = c.hang_id))`);
check(dangling.n === 0, 'every home, job and hangout points at a real building', `${dangling.n} dangling`);

// Daily income = grant + (tax on wages + rent) for each employed resident.
const rows = (await db.query(`select j.type jt, h.type ht, count(*)::int n from citizens c join buildings j on j.id = c.job_id
  join buildings h on h.id = c.home_id group by 1, 2`)).rows;
let income = GRANT, netBad = 0;
for (const r of rows) income += r.n * (taxOf(BUILDING_TYPES[r.jt]?.work?.salary || 0) + (BUILDING_TYPES[r.ht]?.home?.rent || 0));
check(meta.income === income, 'daily treasury income matches wages and rents', `${meta.income} vs ${income}`);
for (const r of (await db.query(`select c.net, j.type jt, h.type ht from citizens c left join buildings j on j.id = c.job_id left join buildings h on h.id = c.home_id
  where c.net <> 0 or c.job_id is not null`)).rows) {
  const want = r.jt ? (BUILDING_TYPES[r.jt]?.work?.salary || 0) - (BUILDING_TYPES[r.ht]?.home?.rent || 0) : 0;
  if (r.net !== want) netBad++;
}
check(netBad === 0, "every citizen's daily earnings match their job and rent", `${netBad} wrong`);
const stuck = await one(`select count(*)::int n from comments where status = 'processing'`);
check(stuck.n === 0, 'no comments stuck mid-processing', `${stuck.n}`);

console.log(bad ? `\n${bad} problem(s) found.` : `\nAll consistent: ${counts.pop.toLocaleString()} citizens, ${counts.res.toLocaleString()} housed, ${counts.emp.toLocaleString()} employed.`);
await db.end();
process.exit(bad ? 1 : 0);
