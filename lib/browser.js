// ── HANDS ON A REAL BROWSER. Raw Chrome DevTools Protocol over Node 22's built-in WebSocket.
// No puppeteer, no playwright, no 300MB chromium in the bundle — it connects to a browser
// running somewhere else and drives it.
//
// PROVIDER-AGNOSTIC ON PURPOSE. Set BROWSER_WS_URL to whichever you want and never be locked in:
//   Browserless cloud   wss://production-sfo.browserless.io?token=KEY
//   Browserless self-host (free, Docker)   ws://your-box:3000
//   Steel.dev (free tier, open source)     wss://connect.steel.dev?apiKey=KEY
//   Human Browser (pay as you go, $0.05/min)
//   Your own PC: start Chrome with --remote-debugging-port=9222 and tunnel it
//
// LOGGED-IN SESSIONS: cookies are saved to Firestore per site and reloaded before each run, so it
// stays signed in to Etsy, Pinterest, KDP without AJ logging in every time.
// ⚠ Those cookies are as good as passwords. They live in AJ's OWN Firestore, nowhere else,
// and they never appear in a response.

let _id = 0;

async function connect() {
  const url = process.env.BROWSER_WS_URL;
  if (!url) throw new Error('no BROWSER_WS_URL set — point it at a browser (Browserless, Steel, or your own Chrome on --remote-debugging-port=9222)');
  const ws = new WebSocket(url);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('browser connect failed: ' + url.split('?')[0])); });
  const pending = new Map();
  ws.onmessage = (m) => {
    let d; try { d = JSON.parse(m.data); } catch { return; }
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  };
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
    const id = ++_id;
    const t = setTimeout(() => { pending.delete(id); no(new Error(`${method} timed out`)); }, 30000);
    pending.set(id, (d) => { clearTimeout(t); d.error ? no(new Error(`${method}: ${d.error.message}`)) : ok(d.result); });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { ws, send, close: () => { try { ws.close(); } catch {} } };
}

// One page, one session id.
async function page(b) {
  const { targetId } = await b.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await b.send('Target.attachToTarget', { targetId, flatten: true });
  await b.send('Page.enable', {}, sessionId);
  await b.send('Runtime.enable', {}, sessionId);
  return sessionId;
}

const evalJs = async (b, s, expression) => {
  const r = await b.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, s);
  if (r.exceptionDetails) return 'JS error: ' + (r.exceptionDetails.exception?.description || '').slice(0, 200);
  return r.result?.value;
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { connect, page, evalJs, wait };
