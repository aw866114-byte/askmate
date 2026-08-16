// ── LOGIN. Deliberately forgiving, and here is why.
// 16 Aug 2026: AJ typed his own password into Vercel, saved it, we redeployed, and it still
// refused him. Case, a stray space, an invisible newline - any of them and an exact match says no,
// and he has no way to see which. He cannot read the box he is typing into. So this app compares
// TRIMMED and LOWERCASED. It is his own single-user app behind an unguessable URL; a password that
// locks the owner out is worse than one that tolerates a capital letter.
function okKey(req) {
  const want = String(process.env.ASKMATE_KEY || '').trim().toLowerCase();
  if (!want) return false;
  const sent = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '')
    .replace(/^Bearer\s*/i, '').trim().toLowerCase();
  return sent !== '' && sent === want;
}
const { loadCanon } = require('../lib/canon');
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  // CORS. AJ runs BRAVE, and the desktop copy of this app opens straight off his disk as a
  // file://, which has a null origin. Without these headers the browser silently refuses every
  // call and it looks, once again, like nothing works. 16 Aug 2026.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  // Open by default so AJ can see what is wired up. But if a password IS sent,
  // it must be right — this is what the login screen tests against, so a wrong
  // password is rejected at the door instead of after it has spent money.
  const sent = (req.headers.authorization || '').replace('Bearer ', '').trim().trim();
  if (sent) {
    if (!process.env.ASKMATE_KEY) { res.statusCode = 503; return res.end(JSON.stringify({ ok: false, error: 'ASKMATE_KEY is not set on this project, so nothing can log in yet.' })); }
    if (!okKey(req)) { res.statusCode = 401; return res.end(JSON.stringify({ ok: false, error: 'wrong password' })); }
  }
  const keys = {
    deepseek: !!process.env.DEEPSEEK_API_KEY, qwen: !!process.env.QWEN_API_KEY,
    xai: !!process.env.XAI_API_KEY, openrouter: !!process.env.OPENROUTER_API_KEY,
    verifymate: !!process.env.VERIFYMATE_AGENT_KEY, firestore: !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY,
    askmate: !!process.env.ASKMATE_KEY,
    github: !!process.env.GITHUB_TOKEN,
    browser: !!process.env.BROWSER_WS_URL,
  };
  let canon = null, canonChars = 0;
  try { const c = await loadCanon({ force: true }); canonChars = c.length; canon = 'loaded'; }
  catch (e) { canon = 'FAILED: ' + e.message; }
  const { ALL_DEFS } = require('../lib/tools');
  res.end(JSON.stringify({ ok: true, app: 'askmate', keysPresent: keys, canon, canonChars,
    tools: ALL_DEFS().map((t) => t.function.name),
    browser: process.env.BROWSER_WS_URL ? 'configured' : 'NOT configured — browser tools are hidden from the model' }, null, 2));
};
