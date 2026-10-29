import express from 'express';
import crypto from 'node:crypto';
import { checkClaimComment } from './players.js';

// Instagram comments webhook (Instagram API with Instagram Login, "comments" field).
//   GET  /webhooks/instagram  → Meta's one-time verification handshake
//   POST /webhooks/instagram  → a comment was made on one of your posts
// The webhook only saves comments. A comment containing the spawn word is queued, and the
// leader server turns queued comments into citizens in batches. A viral post with 100,000
// comments therefore can't overload the city: they wait in line and are processed steadily.
const SPAWN_WORD = new RegExp(`\\b${(process.env.SPAWN_KEYWORD || 'spawn').replace(/[^a-z0-9]/gi, '')}\\b`, 'i');

// What the developer's Instagram panel shows: is the webhook being reached, and what arrived last.
export const igStatus = { lastWebhookAt: 0, lastComment: null, rejected: 0, lastRejectedAt: 0, account: null };
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
      igStatus.lastComment = { username, text: String(v.text || '').slice(0, 140), at: Date.now() };
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
// The token is used once and not stored.
export async function connectInstagram(token) {
  token = String(token || '').trim(); if (token.length < 20) throw Object.assign(new Error('Paste the access token from the Meta dashboard.'), { status: 400 });
  const base = 'https://graph.instagram.com';
  const me = await fetch(`${base}/me?fields=user_id,username,account_type&access_token=${encodeURIComponent(token)}`).then(r => r.json()).catch(() => null);
  if (!me || me.error) throw Object.assign(new Error(`Instagram didn't accept that token${me?.error?.message ? ': ' + me.error.message : '.'}`), { status: 400 });
  const sub = await fetch(`${base}/me/subscribed_apps?subscribed_fields=comments&access_token=${encodeURIComponent(token)}`, { method: 'POST' }).then(r => r.json()).catch(() => null);
  if (!sub || !sub.success) throw Object.assign(new Error(`Couldn't subscribe @${me.username} to comments${sub?.error?.message ? ': ' + sub.error.message : '.'}`), { status: 400 });
  igStatus.account = { username: me.username, type: me.account_type, at: Date.now() };
  return igStatus.account;
}
