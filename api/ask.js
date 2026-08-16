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
const { loadCanon } = require('../lib/canon');
const { log } = require('../lib/store');
const { guard } = require('../lib/guard');

// The bench that answers in council mode — five different companies on purpose.
// Different training, different blind spots. Agreement between them means something;
// agreement between three copies of one model means nothing.
const BENCH = ['worker', 'google', 'openai', 'frugal', 'free_bulk'];

// Anything that smells like a fact about the world right now goes to Perplexity first.
const NEEDS_LIVE_FACTS = /\b(today|now|current|currently|latest|this week|this month|price|cost|how much|who is|when (is|does|did)|news|202[5-9]|deadline|still (open|live|available)|rate|fee)\b/i;

const WORKER_SYS = (canon, evidence) => `${canon}
${evidence}
You are AJ's worker. Do the job he asked. Short. Two lines where two lines will do.
If you do not know, say UNKNOWN. Never state a guess as a fact.`;

const JUDGE_ONE = (canon) => `${canon}

You are the JUDGE. You did not write the answer below and you are not here to be agreeable.
Your only job is to find what is WRONG with it. Check it against the canon above, hardest of all
against the DO NOT REOPEN list and the WITHDRAWN CLAIMS.

Reply with STRICT JSON and nothing else:
{"verdict":"AGREE"|"DISPUTE","confidence":0-100,"problems":["..."],"breaches":["..."],"fix":"..."}

DISPUTE if: it states something unverified as fact; it contradicts canon; it asks AJ for something
already written down; it reopens a settled item; the arithmetic is wrong; or it is longer than he needs.
Say AGREE only if you genuinely cannot fault it.`;

const JUDGE_PANEL = (canon) => `${canon}

You are the JUDGE of a panel. Below are answers from several different models to the same question.
They could not see each other. Score them against the canon above and against plain correctness.

Reply with STRICT JSON and nothing else:
{"best":<index>,"scores":[{"i":0,"score":0-100,"wrong":["..."]}],
 "missedByBest":["things another answer got right that the best one left out"],
 "breaches":["canon breaches by any of them"],"confidence":0-100}

Punish hardest: a guess stated as a fact, a contradiction of canon, asking AJ something already written
down, wrong arithmetic, and length he does not need.`;

const SETTLE_SYS = (canon) => `${canon}

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
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ ok: false, error: 'POST only' })); }

  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.ASKMATE_KEY || auth !== process.env.ASKMATE_KEY) {
    res.statusCode = 401; return res.end(JSON.stringify({ ok: false, error: 'unauthorised' }));
  }

  const { question, mode = 'fast' } = body(req);
  if (!question) { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, error: 'no question' })); }

  const t0 = Date.now();
  const used = [];
  const track = (r) => { if (r) used.push(r); return r; };

  try {
    // 1. CANON FIRST. Not optional. Throws if VerifyMate is unreachable.
    const canon = await loadCanon();

    // 2. LIVE FACTS. Perplexity searches the actual web and brings sources back,
    //    so the rest of the bench is reasoning from evidence instead of memory.
    let evidence = '';
    let sources = null;
    if (NEEDS_LIVE_FACTS.test(question)) {
      try {
        const s = track(await call('search', [
          { role: 'system', content: 'Answer from the live web. Be specific: numbers, dates, names. List your sources.' },
          { role: 'user', content: question },
        ], { maxTokens: 800 }));
        evidence = `\n=== LIVE WEB EVIDENCE (Perplexity, fetched just now — prefer this over your memory) ===\n${s.content}\n=== END EVIDENCE ===\n`;
        sources = s.citations || null;
      } catch (e) {
        evidence = `\n=== LIVE WEB EVIDENCE: UNAVAILABLE (${String(e.message || e).slice(0, 120)}). Say UNKNOWN rather than guess. ===\n`;
      }
    }

    let final, status, objection = null, confidence = null, panel = null;

    if (mode === 'council') {
      // 3a. THE WHOLE BENCH answers, blind to each other, in parallel.
      const answers = await Promise.all(BENCH.map(async (role) => {
        try {
          const r = track(await call(role, [
            { role: 'system', content: WORKER_SYS(canon, evidence) },
            { role: 'user', content: question },
          ]));
          return { role, provider: r.provider, content: r.content };
        } catch (e) { return { role, provider: ROSTER[role] ? ROSTER[role].name : role, content: null, error: String(e.message || e).slice(0, 140) }; }
      }));
      const live = answers.filter((a) => a.content);
      if (!live.length) throw new Error('every model on the bench failed — check the keys on /api/health');

      // 3b. JUDGE scores all of them.
      const jr = track(await call('judge', [
        { role: 'system', content: JUDGE_PANEL(canon) },
        { role: 'user', content: `QUESTION:\n${question}\n\n${live.map((a, i) => `--- ANSWER ${i} (${a.provider}) ---\n${a.content}`).join('\n\n')}` },
      ], { temperature: 0, maxTokens: 900 }));
      const j = parseJSON(jr.content, { best: 0, scores: [], missedByBest: [], breaches: [] });

      // 3c. SETTLER writes the one answer AJ reads.
      const st = track(await call('settle', [
        { role: 'system', content: SETTLE_SYS(canon) },
        { role: 'user', content: `QUESTION:\n${question}\n\nPANEL:\n${live.map((a, i) => `--- ${i} (${a.provider}) ---\n${a.content}`).join('\n\n')}\n\nJUDGE:\n${JSON.stringify(j)}` },
      ]));
      final = st.content;
      status = 'COUNCIL';
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

    const costUSD = Number(used.reduce((n, r) => n + (r.costUSD || 0), 0).toFixed(6));
    const out = {
      ok: true, status, answer: final, objection, confidence, panel, sources,
      searched: !!evidence,
      guard: { verdict: g.verdict, violations: g.violations || [] },
      costUSD, ms: Date.now() - t0,
      layers: used.map((x) => ({ role: x.role, provider: x.provider, via: x.via, ms: x.ms, tokens: x.tokens, costUSD: x.costUSD })),
    };

    await log('asks', { question, mode, status, answer: final, costUSD, ms: out.ms,
      models: used.map((x) => x.provider).join(' | '),
      breaches: (objection?.breaches || []).join(' | '),
      guardVerdict: g.verdict, guardViolations: (g.violations || []).map((v) => v.id).join(' | ') });
    res.statusCode = 200; res.end(JSON.stringify(out));
  } catch (e) {
    await log('asks', { question, status: 'ERROR', error: String(e.message || e) });
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, status: 'ERROR', error: String(e.message || e) }));
  }
};
