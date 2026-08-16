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
// POST /api/jobs  { task, runAt?, repeat? }  -> queue a job for the cron to do unattended
// GET  /api/jobs                              -> what is queued, what is done, what is blocked
const { addJob, listJobs } = require('../lib/store');
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (!okKey(req)) {
    res.statusCode = 401; return res.end(JSON.stringify({ ok: false, error: 'unauthorised' }));
  }
  if (req.method === 'GET') return res.end(JSON.stringify({ ok: true, jobs: await listJobs() }, null, 2));
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  if (!b.task) { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, error: 'no task' })); }
  const r = await addJob({ task: b.task, runAt: b.runAt || new Date().toISOString(), repeat: b.repeat || null, maxSteps: b.maxSteps || 6 });
  res.end(JSON.stringify({ ok: true, ...r }));
};
