import express from 'express';
import crypto from 'node:crypto';

// Instagram comments webhook (Instagram API with Instagram Login, "comments" field).
//   GET  /webhooks/instagram  → Meta's one-time verification handshake
//   POST /webhooks/instagram  → a comment was made on one of your posts
// The webhook only saves comments. A comment containing the spawn word is queued, and the
// leader server turns queued comments into citizens in batches. A viral post with 100,000
// comments therefore can't overload the city: they wait in line and are processed steadily.
const SPAWN_WORD = new RegExp(`\\b${(process.env.SPAWN_KEYWORD || 'spawn').replace(/[^a-z0-9]/gi, '')}\\b`, 'i');

export function instagramRouter(world) {
  const r = express.Router();

  r.get('/', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && process.env.IG_VERIFY_TOKEN && req.query['hub.verify_token'] === process.env.IG_VERIFY_TOKEN) {
      return res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
    }
    res.sendStatus(403);
  });

  r.post('/', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    const secret = process.env.IG_APP_SECRET;
    const sig = req.get('x-hub-signature-256') || '';
    const expected = 'sha256=' + crypto.createHmac('sha256', secret || '').update(req.body || '').digest('hex');
    if (!secret || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return res.sendStatus(401);
    let body; try { body = JSON.parse(req.body.toString('utf8')); } catch { return res.sendStatus(400); }
    const saves = [];
    for (const entry of body.entry || []) for (const change of entry.changes || []) {
      if (change.field !== 'comments') continue;
      const v = change.value || {}; const username = v.from?.username;
      if (!username || !v.id) continue;
      saves.push(world.recordComment({ id: v.id, username, text: v.text, mediaId: v.media?.id, source: 'instagram', wantsSpawn: SPAWN_WORD.test(v.text || '') }));
    }
    // Saving is one quick insert per comment, so Meta gets its answer fast. If saving fails, a non-200 makes Meta retry later.
    try { await Promise.all(saves); res.sendStatus(200); }
    catch (e) { console.error('saving comment failed:', e.message); res.sendStatus(500); }
  });
  return r;
}
