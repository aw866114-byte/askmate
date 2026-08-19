// ═══════════════════════════════════════════════════════════════════════════
// LOOK AT FIVE PHOTOS. NOTHING ELSE. 19 Aug 2026.
//
// AJ, 19 Aug: "I need to be able to put, like, say, five photos in, and then it wants to
// price it straight away, but I need to be able to add another five photos and then another
// five photos for up to fifteen photos in sections."
//
// WHY THIS EXISTS AND NOT JUST A BIGGER /api/quote. Measured 19 Aug: six photos through
// /api/quote is a 2.5 MB upload and takes FORTY-FIVE SECONDS on the server. The server
// answers fine. His phone does not wait that long - Safari drops the fetch and the page
// shows "TypeError: Load failed", which reads to him as the app being broken. Fifteen
// photos in one request would be three times worse.
//
// So the work is split. Each batch of five is READ HERE as he adds it - a short trip, a few
// seconds, while he is still picking the next five. The words are kept in the page. When he
// presses PRICE IT, /api/quote gets the WORDS instead of the pictures, so the pricing call
// carries no photos at all and comes back quickly.
//
// In:  { images:[dataURL,...], from?:number, total?:number }
// Out: { ok:true, observations:"--- PHOTOS 1-5 ---\n...", photosRead:5, readBy, costUSD, ms }
// ═══════════════════════════════════════════════════════════════════════════

// Same forgiving login as /api/quote - see the note there.
function okKey(req) {
  const want = String(process.env.ASKMATE_KEY || '').trim().toLowerCase();
  if (!want) return false;
  const sent = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '')
    .replace(/^Bearer\s*/i, '').trim().toLowerCase();
  return sent !== '' && sent === want;
}

const { call } = require('../lib/models');
const { LOOK } = require('../lib/quote');

function body(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ ok: false, error: 'POST only' })); }
  if (!okKey(req)) { res.statusCode = 401; return res.end(JSON.stringify({ ok: false, error: 'unauthorised' })); }

  const b = body(req);
  const images = Array.isArray(b.images) ? b.images.filter(Boolean).slice(0, 6) : [];
  if (!images.length) { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, error: 'send photos' })); }

  const from = Number(b.from || 1);
  const to = from + images.length - 1;
  const total = Number(b.total || 0);

  const t0 = Date.now();
  const EYES = (process.env.VISION_ORDER || 'judge,google_big,openai,free_eyes').split(',').map(x => x.trim());
  const tried = [];

  const content = [{ type: 'text', text:
    `PHOTOS ${from}-${to}${total ? ` of ${total} so far` : ''}. These are part of ONE property. ` +
    `Write down only what is physically there. Do not price anything and do not guess at the rest of the site.` }];
  for (const url of images) content.push({ type: 'image_url', image_url: { url } });

  for (const role of EYES) {
    try {
      const r = await call(role, [{ role: 'system', content: LOOK }, { role: 'user', content }],
        { temperature: 0.2, maxTokens: 1200, model: process.env.VISION_MODEL || null });
      if ((r.content || '').trim()) {
        res.statusCode = 200;
        return res.end(JSON.stringify({
          ok: true,
          observations: `--- PHOTOS ${from}-${to} ---\n${r.content.trim()}`,
          photosRead: images.length, from, to,
          readBy: r.provider, costUSD: r.costUSD, ms: Date.now() - t0, tried,
        }));
      }
      tried.push({ role, provider: r.provider, chars: 0, finish: r.finishReason });
    } catch (e) {
      tried.push({ role, error: String((e && e.message) || e).slice(0, 160) });
    }
  }

  res.statusCode = 200;
  return res.end(JSON.stringify({ ok: false, error: 'no model on the bench could read those photos', tried, ms: Date.now() - t0 }));
};
