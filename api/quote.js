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
    for (const url of images.slice(0,20)) content.push({ type:'image_url', image_url:{ url } });

    // Vision runs on the vision model. Set VISION_MODEL; falls back to the judge provider,
    // which is Qwen and does read images. DeepSeek V4-Flash is text-only.
    const r = await call('judge', [
      { role:'system', content: SYSTEM(canon) },
      { role:'user', content },
    ], { temperature:0.2, maxTokens:2500, model: process.env.VISION_MODEL });

    let parsed={};
    try{ parsed = JSON.parse(r.content.replace(/^```json|^```|```$/gm,'').trim()); }
    catch{ res.statusCode=200; return res.end(JSON.stringify({ok:false,error:'model did not return clean JSON',raw:r.content.slice(0,1500)})); }

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
      costUSD: r.costUSD, ms: Date.now()-t0,
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
