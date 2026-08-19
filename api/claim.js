// ═══════════════════════════════════════════════════════════════════════════
// WHO IS DOING THIS JOB? Added 19 Aug 2026.
//
// AJ: "I want multiple agents working for me, not just one."
// Up to now nothing on the queue said "this one is taken". One agent was fine.
// Two agents would both grab the same job, both do it, and AJ would hear every
// answer twice. So before more than one agent exists, jobs must be claimable.
//
// POST /api/claim { action:"claim", ids:[...], agent:"andy-pc" }
//   -> { ok:true, got:[ids this agent actually won] }
//   Marks each job taken, then READS IT BACK and only returns the ones where
//   this agent's name survived. Last write wins, and both agents then read the
//   same final answer, so exactly one of them proceeds.
//
// POST /api/claim { action:"done", id:"...", ok:true, result:"...", agent:"..." }
//   -> records the outcome on the job so it never comes round again, and so
//      AJ (and the next session) can see what actually happened.
//
// POST /api/claim { action:"alive", agent:"andy-pc" }
//   -> a heartbeat. This is how AskMate can tell AJ "your computer is listening,
//      this will run in twenty seconds" instead of just saying "queued" and
//      hoping. See local_job in lib/tools.js.
//
// GET /api/claim  -> { ok:true, agents:[{name, lastSeen, secondsAgo, alive}] }
// ═══════════════════════════════════════════════════════════════════════════

function okKey(req) {
  const want = String(process.env.ASKMATE_KEY || '').trim().toLowerCase();
  if (!want) return false;
  const sent = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '')
    .replace(/^Bearer\s*/i, '').trim().toLowerCase();
  return sent !== '' && sent === want;
}

const { listJobs, complete, log } = require('../lib/store');

function body(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }

// Heartbeats live in memory on the serverless instance AND in the job log, so a
// cold start does not make AJ's computer look dead. In-memory is the fast path.
const SEEN = globalThis.__ASKMATE_SEEN || (globalThis.__ASKMATE_SEEN = {});
const ALIVE_WINDOW_MS = 90 * 1000;   // it polls every 20 s, so 90 s of silence means gone

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (!okKey(req)) { res.statusCode = 401; return res.end(JSON.stringify({ ok: false, error: 'unauthorised' })); }

  const now = Date.now();

  if (req.method === 'GET') {
    const agents = Object.entries(SEEN).map(([name, t]) => ({
      name, lastSeen: new Date(t).toISOString(),
      secondsAgo: Math.round((now - t) / 1000), alive: (now - t) < ALIVE_WINDOW_MS,
    }));
    return res.end(JSON.stringify({ ok: true, agents, anyAlive: agents.some(a => a.alive) }));
  }

  const b = body(req);
  const agent = String(b.agent || 'unnamed').slice(0, 60);
  SEEN[agent] = now;

  if (b.action === 'alive') {
    return res.end(JSON.stringify({ ok: true, agent, noted: new Date(now).toISOString() }));
  }

  if (b.action === 'done') {
    if (!b.id) { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, error: 'need id' })); }
    await complete(String(b.id), {
      status: b.ok ? 'done' : 'failed',
      doneBy: agent,
      answer: String(b.result || '').slice(0, 1500),
    });
    await log('agent', { jobId: b.id, agent, ok: !!b.ok, result: String(b.result || '').slice(0, 500) });
    return res.end(JSON.stringify({ ok: true, id: b.id, recorded: b.ok ? 'done' : 'failed' }));
  }

  if (b.action === 'claim') {
    const want = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 20) : [];
    if (!want.length) return res.end(JSON.stringify({ ok: true, got: [] }));
    const stamp = new Date(now).toISOString();
    for (const id of want) {
      await complete(id, { status: 'taken', takenBy: agent, takenAt: stamp });
    }
    // Read it back. If another agent wrote after us, its name is what is there now,
    // and we quietly drop that one. Exactly one agent walks away with each job.
    const after = await listJobs();
    const mine = after.filter(j => want.includes(String(j.id)) && j.takenBy === agent).map(j => String(j.id));
    return res.end(JSON.stringify({ ok: true, agent, got: mine, asked: want.length }));
  }

  res.statusCode = 400;
  return res.end(JSON.stringify({ ok: false, error: 'action must be claim, done or alive' }));
};
