const { loadCanon } = require('../lib/canon');
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  // Open by default so AJ can see what is wired up. But if a password IS sent,
  // it must be right — this is what the login screen tests against, so a wrong
  // password is rejected at the door instead of after it has spent money.
  const sent = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (sent) {
    if (!process.env.ASKMATE_KEY) { res.statusCode = 503; return res.end(JSON.stringify({ ok: false, error: 'ASKMATE_KEY is not set on this project, so nothing can log in yet.' })); }
    if (sent !== process.env.ASKMATE_KEY) { res.statusCode = 401; return res.end(JSON.stringify({ ok: false, error: 'wrong password' })); }
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
