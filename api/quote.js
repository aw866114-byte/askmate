// POST /api/quote  { notes, images:[dataURL...], job? }
// Photos from his phone + what he says about it -> a priced quote, saved, spoken back.
const { call } = require('../lib/models');
const { loadCanon } = require('../lib/canon');
const { guard } = require('../lib/guard');
const { log } = require('../lib/store');
const { SYSTEM, price, RULES } = require('../lib/quote');

function body(req){ return typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{}); }

module.exports = async (req,res) => {
  res.setHeader('Content-Type','application/json');
  if (req.method!=='POST'){ res.statusCode=405; return res.end(JSON.stringify({ok:false,error:'POST only'})); }
  if ((req.headers.authorization||'').replace('Bearer ','')!==process.env.ASKMATE_KEY || !process.env.ASKMATE_KEY){
    res.statusCode=401; return res.end(JSON.stringify({ok:false,error:'unauthorised'})); }

  const { notes='', images=[], job='' } = body(req);
  if (!notes && !images.length){ res.statusCode=400; return res.end(JSON.stringify({ok:false,error:'send photos or notes'})); }

  const t0=Date.now();
  try{
    const canon = await loadCanon();
    const content = [{ type:'text', text:`JOB: ${job||'(unnamed)'}\n\nAJ'S NOTES:\n${notes||'(none — go off the photos)'}` }];
    for (const url of images.slice(0,10)) content.push({ type:'image_url', image_url:{ url } });

    // EYES. Tried in order, cheapest-that-works first, and it does NOT give up after one.
    // 16 Aug 2026: the first live run came back with an empty answer and the whole quote
    // failed. One model returning nothing must never mean no quote — it means try the next.
    const VISION = (process.env.VISION_ORDER || 'judge,google_big,openai,free_eyes').split(',').map(s => s.trim());
    let parsed = null, r = null, tried = [];
    for (const role of VISION) {
      try {
        r = await call(role, [
          { role:'system', content: SYSTEM(canon) },
          { role:'user', content },
        ], { temperature:0.2, maxTokens:4000, model: process.env.VISION_MODEL || null });
        const txt = (r.content || '').replace(/^```json|^```|```$/gm,'').trim();
        const start = txt.indexOf('{');
        if (start >= 0) {
          try { parsed = JSON.parse(txt.slice(start)); } catch { parsed = null; }
        }
        tried.push({ role, provider:r.provider, chars:(r.content||'').length, finish:r.finishReason, parsed: !!parsed });
        if (parsed) break;
      } catch (e) {
        tried.push({ role, error:String(e.message||e).slice(0,140) });
      }
    }
    if (!parsed) {
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok:false,
        error:'no model on the bench could read those photos into a quote',
        tried,
        raw: (r && r.content || '').slice(0,800),
        rawChoice: (r && r.rawChoice) || null }));
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
    };
    // WRITTEN THE MOMENT IT EXISTS. A chat lost his quote figures once; never again.
    await log('quotes', { job: out.job, notes, photos: images.length, total: money.totalIncGST,
      onSiteHours: money.onSiteHours, manHours: money.manHours, rate: RULES.rateIncGST,
      customerWording: out.customerWording, guard: g.verdict });
    res.statusCode=200; res.end(JSON.stringify(out));
  }catch(e){
    await log('quotes',{ job, status:'ERROR', error:String(e.message||e) });
    res.statusCode=500; res.end(JSON.stringify({ok:false,error:String(e.message||e)}));
  }
};
