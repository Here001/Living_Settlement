import express from 'express';
import crypto from 'node:crypto';
import { checkClaimComment } from './players.js';
import { pool } from './db.js';

// Instagram comments webhook (Instagram API with Instagram Login, "comments" field).
//   GET  /webhooks/instagram  → Meta's one-time verification handshake
//   POST /webhooks/instagram  → a comment was made on one of your posts
// The webhook only saves comments. A comment containing the spawn word is queued, and the
// leader server turns queued comments into citizens in batches. A viral post with 100,000
// comments therefore can't overload the city: they wait in line and are processed steadily.
const SPAWN_WORD = new RegExp(`\\b${(process.env.SPAWN_KEYWORD || 'spawn').replace(/[^a-z0-9]/gi, '')}\\b`, 'i');

// What the developer's Instagram panel shows: is the webhook being reached, and what arrived last.
export const igStatus = { lastWebhookAt: 0, lastComment: null, rejected: 0, lastRejectedAt: 0, account: null };
// The connected account and the last comment are kept in the database, so the panel is right after a restart.
let savedAt = 0;
const saveStatus = (force = false) => { if (!force && Date.now() - savedAt < 60000) return; savedAt = Date.now();
  const v = { account: igStatus.account, lastWebhookAt: igStatus.lastWebhookAt, lastComment: igStatus.lastComment };
  pool.query("insert into settings (key, value) values ('instagram', $1) on conflict (key) do update set value = $1", [JSON.stringify(v)]).catch(e => console.error('saving Instagram status:', e.message)); };
export async function loadIgStatus() { try { const r = (await pool.query("select value from settings where key = 'instagram'")).rows[0]; if (r) Object.assign(igStatus, r.value); } catch (e) { console.error('loading Instagram status:', e.message); } }
// Meta signs with the app's secret. The dashboard shows two (the Meta app secret and the Instagram app secret),
// so IG_APP_SECRET may hold either, or both separated by a comma.
const secrets = () => String(process.env.IG_APP_SECRET || '').split(',').map(x => x.trim()).filter(Boolean);
const signedBy = (body, sig) => secrets().some(sec => { const e = 'sha256=' + crypto.createHmac('sha256', sec).update(body || '').digest('hex'); return sig.length === e.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(e)); });

export function instagramRouter(world) {
  const r = express.Router();

  r.get('/', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && process.env.IG_VERIFY_TOKEN && req.query['hub.verify_token'] === process.env.IG_VERIFY_TOKEN) {
      return res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
    }
    res.sendStatus(403);
  });

  r.post('/', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    const sig = req.get('x-hub-signature-256') || '';
    if (!secrets().length || !signedBy(req.body, sig)) { igStatus.rejected++; igStatus.lastRejectedAt = Date.now(); return res.sendStatus(401); }
    igStatus.lastWebhookAt = Date.now();
    let body; try { body = JSON.parse(req.body.toString('utf8')); } catch { return res.sendStatus(400); }
    const saves = [];
    for (const entry of body.entry || []) for (const change of entry.changes || []) {
      if (change.field !== 'comments') continue;
      const v = change.value || {}; const username = v.from?.username;
      if (!username || !v.id) continue;
      igStatus.lastComment = { username, text: String(v.text || '').slice(0, 140), at: Date.now() }; saveStatus();
      saves.push(world.recordComment({ id: v.id, username, text: v.text, mediaId: v.media?.id, source: 'instagram', wantsSpawn: SPAWN_WORD.test(v.text || '') }));
      saves.push(checkClaimComment(username, v.text)); // "CLAIM 482913" from the avatar's own account proves it's theirs
    }
    // Saving is one quick insert per comment, so Meta gets its answer fast. If saving fails, a non-200 makes Meta retry later.
    try { await Promise.all(saves); res.sendStatus(200); }
    catch (e) { console.error('saving comment failed:', e.message); res.sendStatus(500); }
  });
  return r;
}

// Connect the developer's Instagram account: check the token, then subscribe the account to comment webhooks.
// Accepts either kind of token Meta hands out:
//   - an Instagram user token (Instagram business login), used against graph.instagram.com
//   - a Facebook Page token (Facebook login), for the Page linked to the Instagram professional account
// The token is used once and not stored.
const jget = (url, opts) => fetch(url, opts).then(r => r.json()).catch(() => null);
const fail = msg => Object.assign(new Error(msg), { status: 400 });
export async function connectInstagram(token) {
  token = String(token || '').trim(); if (token.length < 20) throw fail('Paste the access token from the Meta dashboard.');
  const t = encodeURIComponent(token);
  // Instagram business login token?
  const ig = await jget(`https://graph.instagram.com/me?fields=user_id,username,account_type&access_token=${t}`);
  if (ig && !ig.error && ig.username) {
    const sub = await jget(`https://graph.instagram.com/me/subscribed_apps?subscribed_fields=comments&access_token=${t}`, { method: 'POST' });
    if (!sub || !sub.success) throw fail(`Couldn't subscribe @${ig.username} to comments${sub?.error?.message ? ': ' + sub.error.message : '.'}`);
    igStatus.account = { username: ig.username, type: ig.account_type, via: 'Instagram login', at: Date.now() }; saveStatus(true);
    return igStatus.account;
  }
  // Facebook Page token (Facebook login route)?
  const fb = 'https://graph.facebook.com';
  let page = await jget(`${fb}/me?fields=id,name,instagram_business_account{id,username}&access_token=${t}`);
  if (!page || (page.error && page.error.code !== 100)) throw fail(`Meta didn't accept that token${page?.error?.message ? ': ' + page.error.message : (ig?.error?.message ? ': ' + ig.error.message : '.')}`);
  if (page.error || !page.instagram_business_account) {
    // A personal (User) token: find the Pages this person manages and use the one linked to Instagram.
    const pages = await jget(`${fb}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100&access_token=${t}`);
    if (!pages || pages.error) throw fail(`Couldn't list your Facebook Pages${pages?.error?.message ? ': ' + pages.error.message : '.'} Make sure the token allows pages_show_list.`);
    const linked = (pages.data || []).find(p => p.instagram_business_account && p.access_token);
    if (!linked) throw fail((pages.data || []).length
      ? `None of your Pages (${pages.data.map(p => p.name).join(', ')}) has an Instagram professional account linked, or the token wasn't allowed to see it. Link your Instagram to the Page, then generate the token again and tick both.`
      : 'This token can’t see any Facebook Pages. When generating it, tick your Page (and your Instagram account) in the pop-up.');
    page = linked; token = linked.access_token;
  }
  const t2 = encodeURIComponent(token);
  // Install the app on the Page so Meta delivers its Instagram webhooks (the field list is required; feed is the usual one).
  let sub = await jget(`${fb}/${page.id}/subscribed_apps?subscribed_fields=feed&access_token=${t2}`, { method: 'POST' });
  if (!sub || !sub.success) sub = await jget(`${fb}/me/subscribed_apps?subscribed_fields=feed&access_token=${t2}`, { method: 'POST' });
  if (!sub || !sub.success) throw fail(`Couldn't connect the Page "${page.name}"${sub?.error?.message ? ': ' + sub.error.message : '.'} Check the token allows pages_manage_metadata.`);
  igStatus.account = { username: page.instagram_business_account.username, type: 'via Facebook Page ' + page.name, via: 'Facebook login', at: Date.now() }; saveStatus(true);
  return igStatus.account;
}
