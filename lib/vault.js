// ── SECRETS. Stage 15 of AJ's own contract, wired straight into VerifyMate's vault.
// "Keys go in the vault, pasted by AJ on the dashboard, never into chat. No API returns a value. Ever."
// AskMate follows the same rule: it can PUT a secret in and it can never read one back out.
async function putSecret(name, value, note) {
  const base = process.env.VERIFYMATE_URL || 'https://verifymate.vercel.app';
  const r = await fetch(`${base}/api/vault`, { method:'POST',
    headers:{ Authorization:`Bearer ${process.env.VERIFYMATE_AGENT_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ name, value, note: note||'' }) });
  const j = await r.json().catch(()=>({}));
  return { ok: !!j.ok, name, stored: !!j.stored, length: j.length };  // value is never echoed
}
async function listSecretNames() {
  const base = process.env.VERIFYMATE_URL || 'https://verifymate.vercel.app';
  const r = await fetch(`${base}/api/vault`, { headers:{ Authorization:`Bearer ${process.env.VERIFYMATE_AGENT_KEY}` } });
  const j = await r.json().catch(()=>({}));
  return (j.secrets||[]).map(s=>({ name:s.name, note:s.note, length:s.length, updatedAt:s.updatedAt }));
}
// Strong password, generated in-process, put straight in the vault, NEVER returned.
function makePassword(len=24){
  const c='abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_=+';
  const b=require('crypto').randomBytes(len);
  return Array.from(b,(x)=>c[x%c.length]).join('');
}
module.exports = { putSecret, listSecretNames, makePassword };
