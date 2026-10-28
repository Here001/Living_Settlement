import express from 'express';
import crypto from 'node:crypto';

// Instagram comments webhook (Instagram API with Instagram Login, "comments" field).
//   GET  /webhooks/instagram  → Meta's one-time verification handshake
//   POST /webhooks/instagram  → a comment was made on one of your posts
// A comment containing the word SPAWN moves that person into the city.
// Comments on the post you mark as the "build vote" post are saved as build requests.
export function instagramRouter(world) {
  const r = express.Router();

  r.get('/', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && process.env.IG_VERIFY_TOKEN && req.query['hub.verify_token'] === process.env.IG_VERIFY_TOKEN) {
      return res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
    }
    res.sendStatus(403);
  });

  r.post('/', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
    const secret = process.env.IG_APP_SECRET;
    const sig = req.get('x-hub-signature-256') || '';
    const expected = 'sha256=' + crypto.createHmac('sha256', secret || '').update(req.body || '').digest('hex');
    if (!secret || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return res.sendStatus(401);
    res.sendStatus(200); // answer fast; Meta retries slow webhooks
    let body; try { body = JSON.parse(req.body.toString('utf8')); } catch { return; }
    for (const entry of body.entry || []) for (const change of entry.changes || []) {
      if (change.field === 'comments') handleComment(world, change.value).catch(e => console.error('comment failed', e.message));
    }
  });
  return r;
}

const SPAWN_WORD = new RegExp(`\\b${(process.env.SPAWN_KEYWORD || 'spawn').replace(/[^a-z0-9]/gi, '')}\\b`, 'i');

async function handleComment(world, v = {}) {
  const username = v.from?.username, text = v.text || '', id = v.id, mediaId = v.media?.id;
  if (!username || !id) return;
  const isNew = await world.recordComment({ id, username, text, mediaId, source: 'instagram' });
  if (!isNew) return;
  if (SPAWN_WORD.test(text)) {
    await world.run(() => world.spawn(username, 'instagram')).catch(e => { if (e.status !== 409) throw e; });
  }
}
