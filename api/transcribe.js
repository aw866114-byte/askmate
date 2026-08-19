// ═══════════════════════════════════════════════════════════════════════════
// EARS THAT WORK ON THE DESKTOP TOO. 19 Aug 2026.
//
// AJ, and this was the whole brief: "I want this to work on my fucking computer
// as well as on my phone."
//
// The old microphone used the browser's own Web Speech API. Brave on the DESKTOP
// strips that API out, so the button was dead there and there was nothing a
// permission prompt could fix. It is not a permissions problem and the answer is
// not "use Chrome".
//
// So the page now RECORDS him and sends the recording here. This runs on the
// server, so it does not care what browser he is in. Brave, Chrome, Edge, Safari,
// desktop and phone, all the same.
//
// In:  { audio: "<base64 16 kHz mono WAV>", format: "wav" }
// Out: { ok:true, text:"...", model:"...", costUSD:0.0006 }
// ═══════════════════════════════════════════════════════════════════════════

// Same forgiving login as /api/quote — see the note there. He cannot read the box
// he is typing into, so a stray capital must not lock him out of his own app.
function okKey(req) {
  const want = String(process.env.ASKMATE_KEY || '').trim().toLowerCase();
  if (!want) return false;
  const sent = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '')
    .replace(/^Bearer\s*/i, '').trim().toLowerCase();
  return sent !== '' && sent === want;
}

const { call } = require('../lib/models');

function body(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }

// Council members that can actually hear. Verified 19 Aug 2026 against
// OpenRouter's live /api/v1/models: both carry "audio" in input_modalities.
// google      = google/gemini-2.5-flash-lite  — $0.30 per 1M audio tokens
// google_big  = google/gemini-3.7-flash       — $0.375 per 1M audio tokens
// A minute of speech is roughly 1,900 audio tokens, so about six hundredths of a cent.
const EARS = (process.env.EARS_ORDER || 'google,google_big').split(',').map(x => x.trim());

const INSTRUCTION =
  'Write down exactly what the speaker said, word for word, in Australian English. ' +
  'Return ONLY the words spoken. Do not add a preamble, a translation, quotation marks, ' +
  'speaker labels, timestamps or any commentary. If the audio contains no speech, return nothing at all.';

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  // CORS — the desktop copy of this app opens off his disk as a file://, which has a
  // null origin. Without these the browser silently refuses and it looks broken again.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ ok: false, error: 'POST only' })); }
  if (!okKey(req)) { res.statusCode = 401; return res.end(JSON.stringify({ ok: false, error: 'unauthorised' })); }

  const b = body(req);
  const format = String(b.format || 'wav').toLowerCase();
  // Accept a bare base64 string or a full data: URL, because both are easy to send by mistake.
  const audio = String(b.audio || '').replace(/^data:[^,]*,/, '').trim();
  if (!audio) { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, error: 'send audio' })); }

  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: INSTRUCTION },
      { type: 'input_audio', input_audio: { data: audio, format } },
    ],
  }];

  const tried = [];
  for (const role of EARS) {
    try {
      const r = await call(role, messages, { temperature: 0, maxTokens: 2000 });
      const text = String(r.content || '')
        .replace(/^\s*(transcript|transcription)\s*:\s*/i, '')
        .replace(/^["'“‘]+|["'”’]+$/g, '')
        .trim();
      if (text) {
        res.statusCode = 200;
        return res.end(JSON.stringify({
          ok: true, text, model: r.model, provider: r.provider,
          ms: r.ms, costUSD: r.costUSD, tried,
        }));
      }
      tried.push({ role, chars: 0, finish: r.finishReason });
    } catch (e) {
      tried.push({ role, error: String((e && e.message) || e).slice(0, 200) });
    }
  }

  // Nothing heard. Say so plainly rather than returning an empty success.
  res.statusCode = 200;
  return res.end(JSON.stringify({ ok: false, error: 'no ear on the bench could hear that', tried }));
};
