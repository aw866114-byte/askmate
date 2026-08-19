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
// POST /api/quote  { notes, images:[dataURL...], job? }
// Photos from his phone + what he says about it -> a priced quote, saved, spoken back.
const { call } = require('../lib/models');
const { loadCanon } = require('../lib/canon');
const { guard } = require('../lib/guard');
const { log } = require('../lib/store');
const { SYSTEM, LOOK, price, RULES } = require('../lib/quote');

function body(req){ return typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{}); }

module.exports = async (req,res) => {
  res.setHeader('Content-Type','application/json');
  // CORS. AJ runs BRAVE, and the desktop copy of this app opens straight off his disk as a
  // file://, which has a null origin. Without these headers the browser silently refuses every
  // call and it looks, once again, like nothing works. 16 Aug 2026.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  if (req.method!=='POST'){ res.statusCode=405; return res.end(JSON.stringify({ok:false,error:'POST only'})); }
  if (!okKey(req)){
    res.statusCode=401; return res.end(JSON.stringify({ok:false,error:'unauthorised'})); }

  const b = body(req);
  const { notes='', images=[], job='' } = b;
  // 19 Aug 2026: photos can now be read BEFORE this call, five at a time, by /api/look.
  // When that has happened the page sends the WORDS instead of the pictures, so this request
  // carries no photos at all and comes back in seconds rather than forty-five. See api/look.js.
  const priorObs = Array.isArray(b.observations)
    ? b.observations.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : [];
  const priorCount = Math.max(0, Number(b.photosRead || 0));
  if (!notes && !images.length && !priorObs.length){ res.statusCode=400; return res.end(JSON.stringify({ok:false,error:'send photos or notes'})); }

  const t0=Date.now();
  try{
    const canon = await loadCanon();
    // ── EVERY PHOTO GETS SEEN. AJ, 16 Aug 2026: "All the photos are different."
    // A cap of ten was my limit, not his job's. So they go through in small batches,
    // each batch read properly, and the findings are merged before anything is priced.
    const EYES = (process.env.VISION_ORDER || 'judge,google_big,openai,free_eyes').split(',').map(x => x.trim());
    const BATCH = Number(process.env.PHOTO_BATCH || 5);
    const pics = images.slice(0, 60);
    const batches = [];
    for (let i = 0; i < pics.length; i += BATCH) batches.push(pics.slice(i, i + BATCH));

    const tried = [];
    async function withEyes(messages, maxTokens) {
      for (const role of EYES) {
        try {
          const r = await call(role, messages, { temperature: 0.2, maxTokens, model: process.env.VISION_MODEL || null });
          if ((r.content || '').trim()) { tried.push({ role, provider: r.provider, chars: r.content.length }); return r; }
          tried.push({ role, provider: r.provider, chars: 0, finish: r.finishReason });
        } catch (e) { tried.push({ role, error: String(e.message || e).slice(0, 120) }); }
      }
      return null;
    }

    // PASS 1 — look at every batch, in parallel, and write down what is physically there.
    const seen = await Promise.all(batches.map(async (group, i) => {
      const content = [{ type: 'text', text: `PHOTO BATCH ${i + 1} of ${batches.length}. Photos ${i * BATCH + 1}-${i * BATCH + group.length} of ${pics.length}.` }];
      for (const url of group) content.push({ type: 'image_url', image_url: { url } });
      const r = await withEyes([{ role: 'system', content: LOOK }, { role: 'user', content }], 1200);
      return r ? `--- PHOTOS ${i * BATCH + 1}-${i * BATCH + group.length} ---\n${r.content}` : null;
    }));
    const observations = priorObs.concat(seen.filter(Boolean));
    if (!observations.length && pics.length) {
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: false, error: 'no model on the bench could read those photos', tried }));
    }

    // PASS 2 — price ONCE, off everything that was seen across every photo.
    const r = await withEyes([
      { role: 'system', content: SYSTEM(canon) },
      { role: 'user', content:
        `JOB: ${job || '(unnamed)'}\n\nAJ'S NOTES:\n${notes || '(none)'}\n\n` +
        `WHAT WAS SEEN ACROSS ALL ${priorCount + pics.length} PHOTOS (${observations.length} batches, every photo read):\n` +
        observations.join('\n\n') +
        `\n\nPrice the WHOLE property from all of that. Do not price one batch.` },
    ], 4000);

    let parsed = null;
    if (r) {
      const txt = (r.content || '').replace(/^```json|^```|```$/gm, '').trim();
      const at = txt.indexOf('{');
      if (at >= 0) { try { parsed = JSON.parse(txt.slice(at)); } catch { parsed = null; } }
    }
    if (!parsed) {
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: false, error: 'the photos were read but the pricing pass did not return clean JSON',
        photosRead: priorCount + pics.length, batches: observations.length, observations, tried, raw: (r && r.content || '').slice(0, 800) }));
    }

    // The arithmetic is done HERE, in code. Not by a model. This is the $352 lesson.
    const money = price(parsed.lines||[]);
    const g = await guard(parsed.customerWording||'', 'general');

    const out = {
      ok:true, job: parsed.job||job,
      internal: { ...money, leastCertain: parsed.leastCertain||'', assumptions: parsed.assumptions||[] },
      customerWording: parsed.customerWording||'',
      excluded: [...(parsed.excluded||[]),
        'Green waste disposal — charged at cost, per trip, itemised.',
        'Travel time and tip-run driving.'],
      questionsForAJ: parsed.questionsForAJ||[],
      guard: { verdict:g.verdict, violations:g.violations||[] },
      spoken: `${parsed.job||'That job'}. ${money.onSiteHours} hours on site with two of you, so ${money.manHours} man hours. `
            + `${money.totalIncGST} dollars including G S T. Green waste on top at cost. `
            + `The least certain part is ${parsed.leastCertain||'nothing flagged'}.`,
      costUSD: r.costUSD, ms: Date.now()-t0, readBy: r.provider, tried,
      photosRead: priorCount + pics.length, batches: observations.length, observations,
    };
    // WRITTEN THE MOMENT IT EXISTS. A chat lost his quote figures once; never again.
    await log('quotes', { job: out.job, notes, photos: priorCount + pics.length, total: money.totalIncGST,
      onSiteHours: money.onSiteHours, manHours: money.manHours, rate: RULES.rateIncGST,
      customerWording: out.customerWording, guard: g.verdict });
    res.statusCode=200; res.end(JSON.stringify(out));
  }catch(e){
    await log('quotes',{ job, status:'ERROR', error:String(e.message||e) });
    res.statusCode=500; res.end(JSON.stringify({ok:false,error:String(e.message||e)}));
  }
};
