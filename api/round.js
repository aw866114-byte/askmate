// api/round.js
// The Round Book's own endpoint. GET reads the round, POST saves it.
// Same key check as api/jobs.js.
import { readRound, writeRound } from '../lib/round-store.js';

function okKey(req) {
  const want = String(process.env.ASKMATE_KEY || '').trim().toLowerCase();
  const sent = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '')
    .replace(/^Bearer\s*/i, '').trim().toLowerCase();
  return want !== '' && sent !== '' && sent === want;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  if (!okKey(req)) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ ok: false, error: 'unauthorised' }));
  }

  try {
    if (req.method === 'GET') {
      const state = await readRound();
      return res.end(JSON.stringify({ ok: true, state }));
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      const state = b && b.state ? b.state : b;
      if (!state || !Array.isArray(state.jobs)) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: 'send { state: { jobs: [...] } }' }));
      }
      const r = await writeRound(state);
      return res.end(JSON.stringify({ ok: true, saved: r.jobs }));
    }
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: 'GET or POST only' }));
  } catch (e) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
  }
}
