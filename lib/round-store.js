// lib/round-store.js
// Storage for the Round Book. Deliberately self-contained: it does NOT import
// lib/store.js, so nothing that already works can be broken by this file.
// One Firestore document holds the whole round: roundbook/aj
import crypto from 'crypto';

const DOC_PATH = 'roundbook/aj';

function serviceAccount() {
  let raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '').trim();
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not set');
  if (raw[0] !== '{') {
    try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch (e) {}
  }
  const sa = JSON.parse(raw);
  if (!sa.client_email || !sa.private_key || !sa.project_id) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is missing client_email, private_key or project_id');
  }
  sa.private_key = String(sa.private_key).replace(/\\n/g, '\n');
  return sa;
}

let cached = { token: '', exp: 0 };

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cached.token && cached.exp - 60 > now) return cached.token;

  const sa = serviceAccount();
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const body = b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  });
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(head + '.' + body);
  signer.end();
  const jwt = head + '.' + body + '.' + signer.sign(sa.private_key, 'base64url');

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    throw new Error('Google token exchange failed: ' + r.status + ' ' + JSON.stringify(j).slice(0, 300));
  }
  cached = { token: j.access_token, exp: now + Number(j.expires_in || 3600) };
  return cached.token;
}

function docUrl() {
  const sa = serviceAccount();
  return 'https://firestore.googleapis.com/v1/projects/' + sa.project_id +
         '/databases/(default)/documents/' + DOC_PATH;
}

// Returns { jobs: [...] }. An empty round is not an error.
export async function readRound() {
  const tok = await accessToken();
  const r = await fetch(docUrl(), { headers: { Authorization: 'Bearer ' + tok } });
  if (r.status === 404) return { jobs: [] };
  if (!r.ok) throw new Error('Firestore read failed: ' + r.status + ' ' + (await r.text()).slice(0, 300));
  const d = await r.json();
  const raw = d && d.fields && d.fields.json && d.fields.json.stringValue;
  if (!raw) return { jobs: [] };
  try {
    const s = JSON.parse(raw);
    return (s && Array.isArray(s.jobs)) ? s : { jobs: [] };
  } catch (e) {
    return { jobs: [] };
  }
}

// Writes the whole round back. Refuses anything that is not { jobs: [...] }
// so a bad request can never wipe the round.
export async function writeRound(state) {
  if (!state || !Array.isArray(state.jobs)) throw new Error('Refusing to save: state.jobs must be an array');
  const tok = await accessToken();
  const body = {
    fields: {
      json: { stringValue: JSON.stringify({ jobs: state.jobs }) },
      at:   { stringValue: new Date().toISOString() },
      jobCount: { integerValue: String(state.jobs.length) }
    }
  };
  const url = docUrl() + '?updateMask.fieldPaths=json&updateMask.fieldPaths=at&updateMask.fieldPaths=jobCount';
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('Firestore write failed: ' + r.status + ' ' + (await r.text()).slice(0, 300));
  return { ok: true, jobs: state.jobs.length };
}
