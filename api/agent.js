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
// POST /api/agent  { task, repo?, maxSteps? }
// The worker gets HANDS. It searches, fetches, reads and writes GitHub (which redeploys Vercel),
// reads and writes VerifyMate, and CANNOT send anything in AJ's name without the guard passing.
// Canon loads first. Always. If VerifyMate is down, it refuses.
const { call } = require('../lib/models');
const { loadCanon } = require('../lib/canon');
const { ALL_DEFS, runAny, shutBrowser } = require('../lib/tools');
const { guard } = require('../lib/guard');
const { log } = require('../lib/store');
const { recall, remember, asText } = require('../lib/memory');
const { PROTOCOL, open } = require('../lib/protocol');
const { PATCH_DEF, githubPatch } = require('../lib/patch');

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
7. He listens, he does not read. Final answer: short, plain, no tables, no URLs read aloud.
8. Seek, Jora, Indeed, Gumtree, Facebook Marketplace and most big job boards and marketplaces BLOCK
   servers - web_fetch on them returns 403. Do NOT retry a page that refused you. web_search already
   comes back with the listings, the prices and the sources, so use what it gave you. Never spend more
   than two web_fetch calls on one job.`;

function body(req){ return typeof req.body === 'string' ? JSON.parse(req.body||'{}') : (req.body||{}); }

module.exports = async (req, res) => {
  res.setHeader('Content-Type','application/json');
  // CORS. AJ runs BRAVE, and the desktop copy of this app opens straight off his disk as a
  // file://, which has a null origin. Without these headers the browser silently refuses every
  // call and it looks, once again, like nothing works. 16 Aug 2026.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  if (req.method !== 'POST'){ res.statusCode=405; return res.end(JSON.stringify({ok:false,error:'POST only'})); }
  if (!okKey(req)){
    res.statusCode=401; return res.end(JSON.stringify({ok:false,error:'unauthorised'})); }

  const { task, repo, maxSteps = 20, thread = 'aj' } = body(req);
  if (!task){ res.statusCode=400; return res.end(JSON.stringify({ok:false,error:'no task'})); }

  const t0=Date.now(); const trail=[]; let cost=0;
  // STAGE 1 — register the run with VerifyMate and acknowledge the rules.
  const run = await open('agent', task);
  try{
    const canon = await loadCanon();
    await run.step('loaded canon from VerifyMate', `${canon.length} chars`);
    const messages=[{role:'system',content:SYS(canon,repo)},{role:'user',content:task}];

    for (let step=0; step<maxSteps; step++){
      // 18 Aug 2026: on its LAST move it gets no tools at all, so it has to stop hunting and
      // write AJ the answer from what it already has. This is why it no longer runs out of steps
      // on him. It burned 20 moves knocking on Seek and Jora, both of which block servers.
      const lastLap = step === maxSteps - 1;
      if (lastLap) messages.push({ role:'user', content:'You are out of moves. Do not call anything else. Write AJ the answer NOW from what you already have, and say plainly what you could not check.' });
      const r = await call('worker', messages, { tools: lastLap ? null : ALL_DEFS().concat([PATCH_DEF]), temperature: 0.2, maxTokens: 8000 });
      cost += r.costUSD;
      if (r.toolCalls && r.toolCalls.length){
        messages.push({ role:'assistant', content:r.content||null, tool_calls:r.toolCalls });
        for (const tc of r.toolCalls){
          let args={}; try{ args=JSON.parse(tc.function.arguments||'{}'); }catch{}
          const out = tc.function.name === 'github_patch' ? await githubPatch(args) : await runAny(tc.function.name, args);
          trail.push({ step:step+1, tool:tc.function.name, args, result:String(out).slice(0,1500) });
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
    // 18 Aug 2026: this used to hand AJ a red box with nothing in it. If it runs out of
    // moves it now gives him what it actually found, because that is usually most of the job.
    const found = trail.map(s2 => '- ' + s2.tool + ': ' + String(s2.result || '')).join('\n\n');
    const out={ ok:true, status:'RAN OUT OF STEPS',
      answer:'It ran out of moves before it could write this up properly. Here is what it found:\n\n' + found,
      steps:trail, costUSD:Number(cost.toFixed(6)), ms:Date.now()-t0, session: run.session };
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
