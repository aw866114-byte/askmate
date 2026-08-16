// FULLY AUTOMATED. Same shape as AJ's other apps — Vercel cron hits this hourly, it does the work
// itself. Jobs live in Firestore. Each run picks up what is due, does it with tools, records it,
// and leaves anything needing AJ's yes clearly marked. Nothing goes out unless the guard passes.
const { call } = require('../../lib/models');
const { loadCanon } = require('../../lib/canon');
const { ALL_DEFS, runAny, shutBrowser } = require('../../lib/tools');
const { guard } = require('../../lib/guard');
const { log, listDue, complete } = require('../../lib/store');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const secret = (req.headers.authorization || '').replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET && secret !== process.env.ASKMATE_KEY) {
    res.statusCode = 401; return res.end(JSON.stringify({ ok: false, error: 'unauthorised' }));
  }
  const started = Date.now(); const done = [];
  try {
    const canon = await loadCanon();
    const jobs = await listDue();
    for (const job of jobs.slice(0, 5)) {
      const messages = [
        { role: 'system', content: `${canon}

You are AJ's unattended operator. Nobody is watching this run.
Use your tools. Never guess. Never send anything that has not passed check_before_sending.
If something needs AJ's decision, do everything up to that point and say plainly what is waiting on him.` },
        { role: 'user', content: job.task },
      ];
      let cost = 0, answer = '', steps = 0;
      for (let i = 0; i < (job.maxSteps || 6); i++) {
        const r = await call('worker', messages, { tools: ALL_DEFS(), maxTokens: 1500 });
        cost += r.costUSD;
        if (r.toolCalls && r.toolCalls.length) {
          messages.push({ role: 'assistant', content: r.content || null, tool_calls: r.toolCalls });
          for (const tc of r.toolCalls) {
            let a = {}; try { a = JSON.parse(tc.function.arguments || '{}'); } catch {}
            const out = await runAny(tc.function.name, a); steps++;
            messages.push({ role: 'tool', tool_call_id: tc.id, content: String(out).slice(0, 8000) });
          }
          continue;
        }
        answer = r.content; break;
      }
      await shutBrowser();
      const g = await guard(answer, 'general');
      await complete(job.id, { status: g.pass ? 'done' : 'blocked', answer, costUSD: cost, steps, guard: g.verdict });
      await log('cron', { jobId: job.id, task: job.task, status: g.pass ? 'done' : 'blocked', answer, costUSD: cost, steps });
      done.push({ id: job.id, status: g.pass ? 'done' : 'blocked', costUSD: Number(cost.toFixed(6)), steps });
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, ran: done.length, jobs: done, ms: Date.now() - started }));
  } catch (e) {
    try { await shutBrowser(); } catch {}
    await log('cron', { status: 'ERROR', error: String(e.message || e) });
    res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
  }
};
