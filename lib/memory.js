// ═══════════════════════════════════════════════════════════════════════════
// ASKMATE REMEMBERS THE CONVERSATION. Added 19 Aug 2026.
//
// AJ: "AskMate needs to have the conversation and the memory like you. I built
//      VerifyMate so you have memory, and VerifyMate is meant to be connected to
//      AskMate so it has memory. So that's a bullshit answer. Fix it."
//
// He was right and I was wrong. AskMate has NEVER been without long memory - it
// loads the whole canon out of VerifyMate on every single call, about 79,000
// characters of it. What it did not have was SHORT memory. It forgot what he said
// one press ago, so "do that again but for Thursday" meant nothing to it and he
// had to say the whole thing over. That is what this fixes.
//
// One document per thread, holding the last few turns as plain JSON. One read,
// one write, no indexes, nothing to go wrong at three in the morning. Every turn
// is ALSO written append-only to talk_log, so the record outlives the buffer.
// ═══════════════════════════════════════════════════════════════════════════

const { log } = require('./store');
const crypto = require('crypto');

// AJ, 19 Aug 2026: "make sure they have complete memory as well." Twelve turns was six of his
// and six of its - it forgot this morning by lunchtime. Nothing was ever lost (every turn is
// appended to talk_log forever); it simply was not handed back. These are the numbers that get
// handed back. 120 turns / 60,000 chars is about 15,000 tokens - pennies on the cheap models,
// and the canon in front of it is already 74,000 chars.
const KEEP_TURNS = 120;
const MAX_CHARS  = 60000;

let token = { value: null, exp: 0 };
function sa() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); }
}
async function accessToken() {
  if (token.value && Date.now() < token.exp - 60000) return token.value;
  const k = sa(); if (!k) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(JSON.stringify({
    iss: k.client_email, scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })).toString('base64url');
  const sig = crypto.createSign('RSA-SHA256').update(header + '.' + claim).sign(k.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: header + '.' + claim + '.' + sig }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('firestore auth failed');
  token = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return token.value;
}
async function fs_(method, path, body) {
  const k = sa(); if (!k) return null;
  const t = await accessToken();
  const url = 'https://firestore.googleapis.com/v1/projects/' + k.project_id + '/databases/(default)/documents' + path;
  const r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) return { error: (await r.text()).slice(0, 200) };
  return await r.json();
}

function clean(thread) {
  return String(thread || 'aj').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || 'aj';
}

// What was said before, oldest first. Never throws. If memory is down, AskMate must
// still answer him - a forgetful app is annoying, a broken one is useless.
async function recall(thread) {
  try {
    const d = await fs_('GET', '/talk/' + clean(thread));
    if (!d || d.error || !d.fields) return [];
    const turns = JSON.parse((d.fields.turns && d.fields.turns.stringValue) || '[]');
    return Array.isArray(turns) ? turns : [];
  } catch { return []; }
}

async function remember(thread, said, replied) {
  try {
    const id = clean(thread);
    const turns = await recall(id);
    if (said)    turns.push({ who: 'AJ',      text: String(said).slice(0, 8000) });
    if (replied) turns.push({ who: 'AskMate', text: String(replied).slice(0, 8000) });
    let keep = turns.slice(-KEEP_TURNS);
    while (JSON.stringify(keep).length > MAX_CHARS && keep.length > 2) keep = keep.slice(1);
    await fs_('PATCH', '/talk/' + id + '?updateMask.fieldPaths=turns&updateMask.fieldPaths=at', {
      fields: { turns: { stringValue: JSON.stringify(keep) }, at: { stringValue: new Date().toISOString() } },
    });
    await log('talk_log', { thread: id, said: String(said || '').slice(0, 1500), replied: String(replied || '').slice(0, 1500) });
    return keep.length;
  } catch { return 0; }
}

// The block that goes into the system message. Empty string when there is nothing yet.
function asText(turns) {
  if (!turns || !turns.length) return '';
  return '\n\nTHIS IS THE SAME CONVERSATION, CARRY IT ON. Here is what was already said, oldest\n'
    + 'first. If he says "that", "it", "again", "the same thing" or "the other one", the answer\n'
    + 'is in here - do NOT ask him to say it all over again, he hates that and he is right to.\n'
    + turns.map((t) => t.who + ': ' + t.text).join('\n')
    + '\n(end of what was said before)';
}

async function forget(thread) {
  try { await fs_('PATCH', '/talk/' + clean(thread) + '?updateMask.fieldPaths=turns', { fields: { turns: { stringValue: '[]' } } }); return true; }
  catch { return false; }
}

module.exports = { recall, remember, asText, forget };
