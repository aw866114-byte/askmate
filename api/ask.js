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
// POST /api/ask  { question, mode? }
//
// mode "fast"    — cheapest useful path: a FREE model drafts, Qwen attacks it,
//                  Grok only settles if they disagree. Typically $0.000-something.
// mode "council" — the WHOLE BENCH. Five different families answer the same
//                  question independently, blind to each other. Qwen scores all
//                  five and says which is right and what is wrong with the rest.
//                  Grok writes the final answer from the winner, grafting
//                  anything the others got right that the winner missed.
//
// Either way, if the question needs facts about the world as it is TODAY,
// Perplexity runs FIRST and its answer (with sources) is handed to everyone as
// evidence — so nobody in the council has to guess at a price, a date or a name.
//
// AJ, 16 Aug 2026: "I don't want just DeepSeek and Qwen and the other one. I want all of it."

const { call, ROSTER } = require('../lib/models');
const { ALL_DEFS, runAny, shutBrowser } = require('../lib/tools');
const { loadCanon } = require('../lib/canon');
const { log } = require('../lib/store');
const { recall, remember, asText } = require('../lib/memory');
const { guard } = require('../lib/guard');
const { PROTOCOL, open } = require('../lib/protocol');

// The bench that answers in council mode — five different companies on purpose.
// Different training, different blind spots. Agreement between them means something;
// agreement between three copies of one model means nothing.
const BENCH = ['worker', 'google', 'openai', 'frugal', 'free_bulk'];

// BEST — AJ presses this when it really matters. Adds the expensive ones, including
// Claude Opus, which is otherwise gated so it can never run up a bill by accident.
// AJ, 16 Aug 2026: "I wanted way more. ChatGPT, Claude at some level, probably Perplexity."
const BENCH_BEST = [...BENCH, 'google_big', 'long', 'big'];

// ── NO TRIGGER WORDS. EVER.
// AJ, 19 Aug 2026: "I don't want trigger words. I want it to work. That's shit."
// He is right. The old gate was a regex of about twenty words. Ask it for the cheapest
// accommodation with a pool in Byron and not one word matched, so it answered from memory
// and made it up. That is precisely the guessing Rule Zero exists to stop.
// Now a FREE model reads the question and decides. It costs nothing, and it errs towards
// looking: anything other than a clear NO means go and look.
const RESEARCH_STEPS = 10;

// The hands the TOP THREE get. Read-only, on purpose.
// AJ, 19 Aug 2026: "I don't need it to write or build anything, but it needs to be able to
// browse and complete research properly on anything I ask it to."
// Search, open a page, read it, read his canon, read a file, do arithmetic. There is no
// github_write, no verifymate_write, no vault_put, no browser_click, no browser_type and no
// send anywhere in this list. ASK / FULL COUNCIL / BEST still cannot change one thing.
const RESEARCH_TOOLS = ['web_search', 'web_fetch', 'browser_goto', 'browser_read',
                        'verifymate_read', 'github_read', 'calc'];
const RESEARCH_DEFS = () => ALL_DEFS().filter((d) => RESEARCH_TOOLS.includes(d.function.name));

async function shouldResearch(question, track) {
  try {
    const r = track(await call('free_bulk', [
      { role: 'system', content:
        'You decide ONE thing. Would answering this properly need looking something up outside your own '
        + 'memory - the live web, a page, a listing, a price, a product, a place, a name, a date, a document, '
        + 'anything about the world as it is now? Reply with one word: YES or NO. '
        + 'If there is any doubt at all, reply YES.' },
      { role: 'user', content: question },
    ], { maxTokens: 4, temperature: 0 }));
    return !/^\s*no\b/i.test(String(r.content || ''));
  } catch { return true; }  // the free gate failed - go and look anyway. Never default to guessing.
}

const WORKER_SYS = (canon, evidence) => `${canon}
${PROTOCOL}
${evidence}
You are AJ's worker. Do the job he asked. Short. Two lines where two lines will do.
If you do not know, say UNKNOWN. Never state a guess as a fact.`;

const JUDGE_ONE = (canon) => `${canon}
${PROTOCOL}

You are the JUDGE. You did not write the answer below and you are not here to be agreeable.
Your only job is to find what is WRONG with it. Check it against the canon above, hardest of all
against the DO NOT REOPEN list and the WITHDRAWN CLAIMS.

Reply with STRICT JSON and nothing else:
{"verdict":"AGREE"|"DISPUTE","confidence":0-100,"problems":["..."],"breaches":["..."],"fix":"..."}

DISPUTE if: it states something unverified as fact; it contradicts canon; it asks AJ for something
already written down; it reopens a settled item; the arithmetic is wrong; or it is longer than he needs.
Say AGREE only if you genuinely cannot fault it.`;

const JUDGE_PANEL = (canon) => `${canon}
${PROTOCOL}

You are the JUDGE of a panel. Below are answers from several different models to the same question.
They could not see each other. Score them against the canon above and against plain correctness.

Reply with STRICT JSON and nothing else:
{"best":<index>,"scores":[{"i":0,"score":0-100,"wrong":["..."]}],
 "missedByBest":["things another answer got right that the best one left out"],
 "breaches":["canon breaches by any of them"],"confidence":0-100}

Punish hardest: a guess stated as a fact, a contradiction of canon, asking AJ something already written
down, wrong arithmetic, and length he does not need.`;

const SETTLE_SYS = (canon) => `${canon}
${PROTOCOL}

You write the FINAL answer AJ actually reads. You get the question, every answer the panel gave,
and the judge's scoring. Take the winner, graft on anything the judge says it missed, cut everything else.
AJ's voice: short, plain, no hedging, most important thing first.
If you corrected something, say so in the first line. If any claim is not verified, label it UNKNOWN.`;

function body(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }
function parseJSON(s, fallback) {
  try { return JSON.parse(String(s).replace(/^```json|^```|```$/gm, '').trim()); } catch { return fallback; }
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  // CORS. AJ runs BRAVE, and the desktop copy of this app opens straight off his disk as a
  // file://, which has a null origin. Without these headers the browser silently refuses every
  // call and it looks, once again, like nothing works. 16 Aug 2026.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ ok: false, error: 'POST only' })); }

  if (!okKey(req)) {
    res.statusCode = 401; return res.end(JSON.stringify({ ok: false, error: 'unauthorised' }));
  }

  const { question, mode = 'fast', thread = 'aj' } = body(req);
  if (!question) { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, error: 'no question' })); }

  const t0 = Date.now();
  const used = [];
  const track = (r) => { if (r) used.push(r); return r; };

  // STAGE 1 — register this run with VerifyMate and acknowledge the rules,
  // exactly as a Claude session does. Nothing runs unrecorded.
  const run = await open('ask', question);

  try {
    // 1. CANON FIRST. Not optional. Throws if VerifyMate is unreachable.
    const canonOnly = await loadCanon();
    // 19 Aug 2026 - the ASK half remembers the conversation now too. AJ: "AskMate needs to have
    // the conversation and the memory like you." BUILD IT got it first; this is the half he
    // actually uses. Folding it into the canon string means EVERY role sees it - the drafter,
    // the judge, the whole bench and the settler - with no other change to this file.
    // 19 Aug 2026 - ONE thread, shared with /api/agent. It used to be 'ask-'+thread here and
    // plain thread over there, so BUILD IT could not see what ASK had just found out. AJ:
    // "you need to make the top three talk to build it... otherwise it's fucking half working."
    const past = await recall(thread);
    const canon = canonOnly + asText(past);
    await run.step('loaded canon from VerifyMate', `${canon.length} chars`);

    // 2. GO AND LOOK. This is the half AJ actually presses, and until 19 Aug 2026 it could
    //    not look anything up unless his question happened to contain a magic word.
    //    Now: a free model decides whether to look, then Perplexity brings back live sources,
    //    then the researcher gets READ-ONLY hands and up to RESEARCH_STEPS moves of its own -
    //    search, open the actual pages, read them - and writes down WHERE each thing came from.
    //    Everything it finds is handed to the whole bench as evidence, so five (or eight)
    //    models reason from fetched pages instead of memory.
    let evidence = '';
    let sources = null;
    const looked = await shouldResearch(question, track);
    await run.step(looked ? 'decided to go and look' : 'answerable without looking', question.slice(0, 200));

    if (looked) {
      const found = [];
      // 2a. Perplexity first. One call, live web, sources attached. It also reaches sites that
      //     block plain server fetches, which web_fetch cannot.
      try {
        const s = track(await call('search', [
          { role: 'system', content: 'Answer from the live web. Be specific: numbers, dates, names, prices. Give the full URL for every source.' },
          { role: 'user', content: question },
        ], { maxTokens: 1200 }));
        found.push('PERPLEXITY - LIVE WEB:\n' + s.content);
        sources = s.citations || null;
        await run.step('searched the live web (Perplexity)', String(s.content).slice(0, 300));
      } catch (e) {
        found.push('PERPLEXITY UNAVAILABLE: ' + String(e.message || e).slice(0, 140) + ' - say UNKNOWN rather than guess.');
      }

      // 2b. Then it does its own digging.
      const rm = [
        { role: 'system', content: `${canon}\n${PROTOCOL}\n\n`
          + 'You are the RESEARCHER. You are not answering AJ - you are going out and finding what is '
          + 'needed to answer him, and writing down exactly where it came from.\n'
          + 'Use the tools. Actually open the pages. Do not stop at the first result - if he asked for '
          + 'the cheapest, or the best priced, or a comparison, get several and compare them.\n'
          + 'Never state a present-day fact you have not fetched in this run.\n'
          + 'Some sites block servers outright (Seek, Jora, Indeed, Gumtree, Facebook Marketplace and '
          + 'similar). Do not retry a 403 - note it and get the same fact somewhere else.\n'
          + 'Finish with a plain list: what you found, and the full URL for each thing.' },
        { role: 'user', content: question },
      ];
      for (let step = 0; step < RESEARCH_STEPS; step++) {
        const lastLap = step === RESEARCH_STEPS - 1;
        if (lastLap) rm.push({ role: 'user', content: 'No more tools. Write up what you found and where it came from, now.' });
        let r;
        try {
          r = track(await call('worker', rm, { tools: lastLap ? null : RESEARCH_DEFS(), temperature: 0.2, maxTokens: 6000 }));
        } catch (e) { found.push('RESEARCH STOPPED: ' + String(e.message || e).slice(0, 140)); break; }
        if (r.toolCalls && r.toolCalls.length) {
          rm.push({ role: 'assistant', content: r.content || null, tool_calls: r.toolCalls });
          for (const tc of r.toolCalls) {
            let out;
            try { out = await runAny(tc.function.name, JSON.parse(tc.function.arguments || '{}')); }
            catch (e) { out = 'TOOL FAILED: ' + String(e.message || e).slice(0, 200); }
            await run.step(`researcher ran ${tc.function.name}`, String(out).slice(0, 300));
            rm.push({ role: 'tool', tool_call_id: tc.id, content: String(out).slice(0, 60000) });
          }
          continue;
        }
        if (r.content) found.push('RESEARCHER FOUND:\n' + r.content);
        break;
      }
      try { await shutBrowser(); } catch {}

      evidence = '\n=== EVIDENCE GATHERED JUST NOW - PREFER THIS OVER YOUR MEMORY ===\n'
        + found.join('\n\n')
        + '\nIf the evidence above does not cover part of the question, say UNKNOWN for that part.'
        + '\n=== END EVIDENCE ===\n';
    }

    let final, status, objection = null, confidence = null, panel = null;

    if (mode === 'council' || mode === 'best') {
      // 3a. THE WHOLE BENCH answers, blind to each other, in parallel.
      const roster = mode === 'best' ? BENCH_BEST : BENCH;
      const answers = await Promise.all(roster.map(async (role) => {
        try {
          const r = track(await call(role, [
            { role: 'system', content: WORKER_SYS(canon, evidence) },
            { role: 'user', content: question },
          ], { allowGated: mode === 'best' }));
          return { role, provider: r.provider, content: r.content };
        } catch (e) { return { role, provider: ROSTER[role] ? ROSTER[role].name : role, content: null, error: String(e.message || e).slice(0, 140) }; }
      }));
      const live = answers.filter((a) => a.content);
      await run.step(`bench answered: ${live.map((a) => a.provider).join(', ')}`, `${live.length} of ${roster.length} returned`);
      if (!live.length) throw new Error('every model on the bench failed — check the keys on /api/health');

      // 3b. JUDGE scores all of them.
      const jr = track(await call('judge', [
        { role: 'system', content: JUDGE_PANEL(canon) },
        { role: 'user', content: `QUESTION:\n${question}\n\n${live.map((a, i) => `--- ANSWER ${i} (${a.provider}) ---\n${a.content}`).join('\n\n')}` },
      ], { temperature: 0, maxTokens: 900 }));
      const j = parseJSON(jr.content, { best: 0, scores: [], missedByBest: [], breaches: [] });
      await run.step('judge scored the panel', JSON.stringify(j).slice(0, 400));

      // 3c. SETTLER writes the one answer AJ reads.
      const st = track(await call('settle', [
        { role: 'system', content: SETTLE_SYS(canon) },
        { role: 'user', content: `QUESTION:\n${question}\n\nPANEL:\n${live.map((a, i) => `--- ${i} (${a.provider}) ---\n${a.content}`).join('\n\n')}\n\nJUDGE:\n${JSON.stringify(j)}` },
      ]));
      final = st.content;
      status = mode === 'best' ? 'BEST' : 'COUNCIL';
      confidence = j.confidence ?? null;
      objection = { problems: (j.scores || []).flatMap((s) => s.wrong || []), breaches: j.breaches || [], fix: (j.missedByBest || []).join('; ') };
      panel = {
        answered: live.map((a) => a.provider),
        failed: answers.filter((a) => !a.content).map((a) => `${a.role}: ${a.error}`),
        best: live[j.best] ? live[j.best].provider : null,
      };
    } else {
      // 3. FAST PATH — the free model drafts, Qwen attacks, Grok only settles on a real dispute.
      let draft;
      try {
        draft = track(await call('free_bulk', [
          { role: 'system', content: WORKER_SYS(canon, evidence) },
          { role: 'user', content: question },
        ]));
      } catch (e) {
        draft = track(await call('worker', [
          { role: 'system', content: WORKER_SYS(canon, evidence) },
          { role: 'user', content: question },
        ]));
      }
      const jr = track(await call('judge', [
        { role: 'system', content: JUDGE_ONE(canon) },
        { role: 'user', content: `QUESTION:\n${question}\n\nANSWER TO ATTACK:\n${draft.content}` },
      ], { temperature: 0, maxTokens: 700 }));
      const j = parseJSON(jr.content, { verdict: 'DISPUTE', problems: ['judge did not return valid JSON'] });
      await run.step(`judge said ${j.verdict}`, JSON.stringify(j.problems || []).slice(0, 400));

      final = draft.content;
      status = 'AGREED';
      confidence = j.confidence ?? null;
      if (j.verdict === 'DISPUTE') {
        const st = track(await call('settle', [
          { role: 'system', content: SETTLE_SYS(canon) },
          { role: 'user', content: `QUESTION:\n${question}\n\nANSWER:\n${draft.content}\n\nOBJECTION:\n${JSON.stringify(j)}` },
        ]));
        final = st.content;
        status = 'ESCALATED';
        objection = { problems: j.problems || [], breaches: j.breaches || [], fix: j.fix || '' };
      }
    }

    // 4. GUARD — stage 20. Nothing leaves this function unchecked. Skipped by hand all day on
    //    16 Aug 2026; it is not skippable now.
    const g = await guard(final, /outreach|email|message|dm|post/i.test(question) ? 'outreach' : 'general');
    if (!g.pass) status = 'BLOCKED';
    await run.step(`guard ${g.verdict}`, (g.violations || []).map((v) => v.id).join(' | '));

    const costUSD = Number(used.reduce((n, r) => n + (r.costUSD || 0), 0).toFixed(6));
    const out = {
      ok: true, status, answer: final, objection, confidence, panel, sources,
      session: run.session, recordedInVerifyMate: run.recorded,
      unrecordedReason: run.recorded ? null : run.startError,
      searched: !!evidence,
      guard: { verdict: g.verdict, violations: g.violations || [] },
      costUSD, ms: Date.now() - t0,
      layers: used.map((x) => ({ role: x.role, provider: x.provider, via: x.via, ms: x.ms, tokens: x.tokens, costUSD: x.costUSD })),
    };

    await log('asks', { question, mode, status, answer: final, costUSD, ms: out.ms,
      models: used.map((x) => x.provider).join(' | '),
      breaches: (objection?.breaches || []).join(' | '),
      guardVerdict: g.verdict, guardViolations: (g.violations || []).map((v) => v.id).join(' | ') });
    await run.close(status, final, { costUSD, ms: out.ms, models: used.map((x) => x.provider).join(', '), guard: g.verdict });
    await remember(thread, question, final);
    res.statusCode = 200; res.end(JSON.stringify(out));
  } catch (e) {
    await run.close('ERROR', String(e.message || e));
    await log('asks', { question, status: 'ERROR', error: String(e.message || e) });
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, status: 'ERROR', error: String(e.message || e) }));
  }
};
