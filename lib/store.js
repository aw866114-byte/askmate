// Firestore via REST + a service-account JWT. No SDK, no dependencies.
// Reuses the SAME service account VerifyMate already uses: FIREBASE_SERVICE_ACCOUNT_KEY.
const crypto = require('crypto');

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
  const sig = crypto.createSign('RSA-SHA256').update(`${header}.${claim}`).sign(k.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claim}.${sig}` }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('firestore auth failed: ' + JSON.stringify(j).slice(0, 200));
  token = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return token.value;
}

function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
}

// Append-only. Nothing in this app ever overwrites a record — same rule as VerifyMate.
async function log(collection, data) {
  const k = sa(); if (!k) return { ok: false, skipped: 'no FIREBASE_SERVICE_ACCOUNT_KEY' };
  const t = await accessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${k.project_id}/databases/(default)/documents/${collection}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries({ ...data, at: new Date().toISOString() }).map(([kk, v]) => [kk, enc(v)])) }),
  });
  if (!r.ok) return { ok: false, error: (await r.text()).slice(0, 200) };
  return { ok: true };
}

module.exports = { log };

// ── JOB QUEUE. This is what makes it run on its own instead of waiting to be asked.
async function fs_(method, path, body) {
  const k = sa(); if (!k) return null;
  const t = await accessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${k.project_id}/databases/(default)/documents${path}`;
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) return { error: (await r.text()).slice(0, 200) };
  return await r.json();
}
function dec(f = {}) {
  const o = {};
  for (const [k, v] of Object.entries(f)) {
    o[k] = v.stringValue ?? v.booleanValue ?? (v.integerValue != null ? Number(v.integerValue) : undefined)
        ?? v.doubleValue ?? (v.nullValue !== undefined ? null : undefined);
  }
  return o;
}
async function addJob(job) {
  const d = await fs_('POST', '/jobs', { fields: Object.fromEntries(Object.entries({ ...job, status: 'due', created: new Date().toISOString() }).map(([k, v]) => [k, enc(v)])) });
  return d && !d.error ? { ok: true, id: (d.name || '').split('/').pop() } : { ok: false, ...(d || {}) };
}
async function listJobs() {
  const d = await fs_('GET', '/jobs?pageSize=100');
  return (d?.documents || []).map((x) => ({ id: x.name.split('/').pop(), ...dec(x.fields) }));
}
async function listDue() {
  const now = new Date().toISOString();
  return (await listJobs()).filter((j) => j.status === 'due' && (!j.runAt || j.runAt <= now));
}
async function complete(id, patch) {
  const fields = Object.fromEntries(Object.entries({ ...patch, finished: new Date().toISOString() }).map(([k, v]) => [k, enc(v)]));
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&');
  return await fs_('PATCH', `/jobs/${id}?${mask}`, { fields });
}
module.exports.addJob = addJob;
module.exports.listJobs = listJobs;
module.exports.listDue = listDue;
module.exports.complete = complete;

async function listLogins(site) {
  const d = await fs_('GET', '/logins?pageSize=100');
  return (d?.documents || []).map((x) => dec(x.fields))
    .filter((r) => (r.site || '').includes(site) || site.includes(r.site || ''))
    .sort((a, b) => (a.at < b.at ? 1 : -1));
}
module.exports.listLogins = listLogins;
