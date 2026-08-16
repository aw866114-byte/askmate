// POST /api/jobs  { task, runAt?, repeat? }  -> queue a job for the cron to do unattended
// GET  /api/jobs                              -> what is queued, what is done, what is blocked
const { addJob, listJobs } = require('../lib/store');
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if ((req.headers.authorization || '').replace('Bearer ', '') !== process.env.ASKMATE_KEY || !process.env.ASKMATE_KEY) {
    res.statusCode = 401; return res.end(JSON.stringify({ ok: false, error: 'unauthorised' }));
  }
  if (req.method === 'GET') return res.end(JSON.stringify({ ok: true, jobs: await listJobs() }, null, 2));
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  if (!b.task) { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, error: 'no task' })); }
  const r = await addJob({ task: b.task, runAt: b.runAt || new Date().toISOString(), repeat: b.repeat || null, maxSteps: b.maxSteps || 6 });
  res.end(JSON.stringify({ ok: true, ...r }));
};
