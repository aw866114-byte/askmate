// POST /api/agent  { task, repo?, maxSteps? }
// The worker gets HANDS. It searches, fetches, reads and writes GitHub (which redeploys Vercel),
// reads and writes VerifyMate, and CANNOT send anything in AJ's name without the guard passing.
// Canon loads first. Always. If VerifyMate is down, it refuses.
const { call } = require('../lib/models');
const { loadCanon } = require('../lib/canon');
const { ALL_DEFS, runAny, shutBrowser } = require('../lib/tools');
const { guard } = require('../lib/guard');
const { log } = require('../lib/store');
const { PROTOCOL, open } = require('../lib/protocol');

const SYS = (canon, repo) => `${canon}
${PROTOCOL}

You are AJ's operator. You have hands. USE THEM — do not describe what could be done, do it.

HARD RULES, in order:
1. NEVER state a present-day fact without web_search or web_fetch first. On 16 Aug 2026 a chat
   told AJ his own rate "was not recorded anywhere" when it was sitting in his own file. Look first.
2. NEVER do arithmetic in your head. Use calc. A quote was out by $352 exactly that way.
3. Before ANY text goes out in AJ's name, call check_before_sending. If it does not pass, fix it.
4. Search verifymate_read BEFORE asking AJ anything. If it is written down, do not ask him.
5. To build or change a site or app, use github_write. Vercel redeploys on push.${repo ? ` Default repo: ${repo}` : ''}
6. Say what you have NOT done, first. Label claims VERIFIED, INFERRED or UNKNOWN.
7. He listens, he does not read. Final answer: short, plain, no tables, no URLs read aloud.`;

function body(req){ return typeof req.body === 'string' ? JSON.parse(req.body||'{}') : (req.body||{}); }

module.exports = async (req, res) => {
  res.setHeader('Content-Type','application/json');
  if (req.method !== 'POST'){ res.statusCode=405; return res.end(JSON.stringify({ok:false,error:'POST only'})); }
  if ((req.headers.authorization||'').replace('Bearer ','') !== process.env.ASKMATE_KEY || !process.env.ASKMATE_KEY){
    res.statusCode=401; return res.end(JSON.stringify({ok:false,error:'unauthorised'})); }

  const { task, repo, maxSteps = 8 } = body(req);
  if (!task){ res.statusCode=400; return res.end(JSON.stringify({ok:false,error:'no task'})); }

  const t0=Date.now(); const trail=[]; let cost=0;
  // STAGE 1 — register the run with VerifyMate and acknowledge the rules.
  const run = await open('agent', task);
  try{
    const canon = await loadCanon();
    await run.step('loaded canon from VerifyMate', `${canon.length} chars`);
    const messages=[{role:'system',content:SYS(canon,repo)},{role:'user',content:task}];

    for (let step=0; step<maxSteps; step++){
      const r = await call('worker', messages, { tools: ALL_DEFS(), temperature: 0.2, maxTokens: 2000 });
      cost += r.costUSD;
      if (r.toolCalls && r.toolCalls.length){
        messages.push({ role:'assistant', content:r.content||null, tool_calls:r.toolCalls });
        for (const tc of r.toolCalls){
          let args={}; try{ args=JSON.parse(tc.function.arguments||'{}'); }catch{}
          const out = await runAny(tc.function.name, args);
          trail.push({ step:step+1, tool:tc.function.name, args, result:String(out).slice(0,300) });
          // STAGE 5 — every action lands in VerifyMate's journal AS IT HAPPENS,
          // so a run that dies halfway still leaves a record of what it did.
          await run.step(`${tc.function.name} ${JSON.stringify(args).slice(0,200)}`, String(out).slice(0,400));
          messages.push({ role:'tool', tool_call_id:tc.id, content:String(out).slice(0,120000) });  // was 8,000 - too small to hold one of AJ's own files
        }
        continue;
      }
      // finished
      await shutBrowser();
    const g = await guard(r.content, 'general');
      const out = { ok:true, status: g.pass?'DONE':'BLOCKED', answer:r.content,
        guard:{verdict:g.verdict,violations:g.violations||[]}, steps:trail, costUSD:Number(cost.toFixed(6)), ms:Date.now()-t0,
        session: run.session, recordedInVerifyMate: run.recorded, unrecordedReason: run.recorded ? null : run.startError };
      await run.step(`guard ${g.verdict}`, (g.violations||[]).map(v=>v.id).join(' | '));
      await run.close(out.status, r.content, { costUSD: out.costUSD, steps: trail.length, ms: out.ms });
      await log('agent', { task, status:out.status, answer:r.content, costUSD:out.costUSD, steps:trail.length, ms:out.ms });
      res.statusCode=200; return res.end(JSON.stringify(out));
    }
    const out={ ok:true, status:'RAN OUT OF STEPS', steps:trail, costUSD:Number(cost.toFixed(6)), ms:Date.now()-t0, session: run.session };
    await run.close('RAN OUT OF STEPS', `${trail.length} steps, no final answer`);
    await log('agent',{ task, status:'RAN OUT OF STEPS', steps:trail.length, costUSD:out.costUSD });
    res.statusCode=200; res.end(JSON.stringify(out));
  } catch (e) {
    try { await shutBrowser(); } catch {}
    await run.close('ERROR', String(e.message||e));
    await log('agent',{ task, status:'ERROR', error:String(e.message||e) });
    res.statusCode=500; res.end(JSON.stringify({ok:false,status:'ERROR',error:String(e.message||e),steps:trail}));
  }
};
