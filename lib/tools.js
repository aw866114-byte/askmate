// ── HANDS. This is the difference between an answer machine and something that does the work.
// AJ, 16 Aug 2026: "I want to build my own version of Claude that's way better."
// A model with no tools can only talk. These are the tools.

const { guard } = require('./guard');
const BROWSER = require('./browser-tools');
const VAULT = require('./vault');
const { needsApproval, requestApproval } = require('./approvals');
const { addJob } = require('./store');

const DEFS = [
  { type:'function', function:{ name:'web_search', description:'Search the web. Use before stating any present-day fact.',
    parameters:{ type:'object', properties:{ query:{type:'string'} }, required:['query'] } } },
  { type:'function', function:{ name:'web_fetch', description:'Fetch a URL and return its readable text.',
    parameters:{ type:'object', properties:{ url:{type:'string'} }, required:['url'] } } },
  { type:'function', function:{ name:'verifymate_read', description:"Read AJ's canon: rules, settled, errata, failing, queue.",
    parameters:{ type:'object', properties:{ bucket:{type:'string'}, search:{type:'string'} } } } },
  { type:'function', function:{ name:'verifymate_write', description:'Record a verdict, erratum, queue item or followup in VerifyMate.',
    parameters:{ type:'object', properties:{ type:{type:'string'}, id:{type:'string'}, verdict:{type:'string'},
      evidence:{type:'string'}, claim:{type:'string'}, correction:{type:'string'} }, required:['type'] } } },
  { type:'function', function:{ name:'github_write', description:'Write a file into a GitHub repo. Vercel redeploys on push. This is how it builds sites and apps.',
    parameters:{ type:'object', properties:{ repo:{type:'string',description:'owner/name'}, path:{type:'string'},
      content:{type:'string'}, message:{type:'string'} }, required:['repo','path','content'] } } },
  { type:'function', function:{ name:'github_read', description:'Read a file from a GitHub repo.',
    parameters:{ type:'object', properties:{ repo:{type:'string'}, path:{type:'string'} }, required:['repo','path'] } } },
  { type:'function', function:{ name:'calc', description:'Evaluate arithmetic. Use this instead of doing sums in your head - a model got a quote wrong by $352 that way.',
    parameters:{ type:'object', properties:{ expression:{type:'string'} }, required:['expression'] } } },
  { type:'function', function:{ name:'vault_put', description:'Store a secret (password, API key) in AJ VerifyMate vault. It is encrypted and can NEVER be read back out, not even by you. Returns only the name and length.',
    parameters:{ type:'object', properties:{ name:{type:'string'}, value:{type:'string'}, note:{type:'string'} }, required:['name','value'] } } },
  { type:'function', function:{ name:'vault_list', description:'List which secrets exist in the vault. Names only, never values.',
    parameters:{ type:'object', properties:{} } } },
  { type:'function', function:{ name:'make_password', description:'Generate a strong password AND put it straight in the vault. The value is never shown to you or to anyone. Use before any signup.',
    parameters:{ type:'object', properties:{ name:{type:'string'}, length:{type:'number'} }, required:['name'] } } },
  { type:'function', function:{ name:'request_approval', description:'MANDATORY before anything irreversible: creating an account, setting a password, paying, publishing, sending, deleting. Prepare everything first, then call this and STOP.',
    parameters:{ type:'object', properties:{ action:{type:'string'}, detail:{type:'string'}, prepared:{type:'string'} }, required:['action'] } } },
  { type:'function', function:{ name:'check_before_sending', description:'MANDATORY before any text goes out in AJ name. Runs VerifyMate guard.',
    parameters:{ type:'object', properties:{ text:{type:'string'}, kind:{type:'string'} }, required:['text'] } } },
  // 19 Aug 2026. AJ: "can it not build it and put it in my downloads folder if my computer's on,
  // so that I can drop and drag." This is that. AskMate runs on a server and cannot touch his disk;
  // the agent on his Windows machine polls this queue and does the file work as him.
  { type:'function', function:{ name:'local_job', description:"Give a job to the agent running on AJ's OWN COMPUTER. This is the ONLY way to touch his disk - AskMate itself cannot. Best use: copy a site folder, change some text inside the COPY, and zip it into his Downloads for him to drag. It NEVER deletes, NEVER writes over anything that already existed, and NEVER deploys. Send the verb first, then ONE LINE of JSON. Verbs: list, count, copy, write, zip, md5, copyfile, build. Example: build {\"src\":\"C:/Users/rippe/OneDrive/Documents/ajws Empire/claude/allcare-DEPLOY-READY\",\"dst\":\"C:/Users/rippe/OneDrive/Documents/ajws Empire/claude/allcare-build-2026-08-19\",\"zip\":\"C:/Users/rippe/Downloads/allcare-2026-08-19.zip\",\"edits\":[{\"file\":\"index.html\",\"find\":\"10 reviews\",\"replace\":\"11 reviews\",\"count\":1}]}. It only runs when his computer is on and the agent is running, so say that when you use it.",
    parameters:{ type:'object', properties:{ task:{type:'string', description:'the verb, then one line of JSON'} }, required:['task'] } } },
];

function strip(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&')
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();
}

const EXEC = {
  async web_search({ query }) {
    // 18 Aug 2026: this used DuckDuckGo Lite. From Vercel it comes back empty, so AskMate
    // told AJ that real firms "were not in his canon". Search now goes through Perplexity
    // Sonar on the SAME OpenRouter key - it reads the live web and cites what it used.
    // It is told to LIST every result with its price, never to summarise into a paragraph.
    const { call } = require('./models');
    const SYS = 'You are a research tool, not a chat. List EVERY result you find, one per line. ' +
      'For each one give: name, then price if there is one, then the suburb or town, then the phone ' +
      'number if it is shown, then the URL. Never summarise into a paragraph. Never leave a result out ' +
      'because it looks less relevant. If no price is published write NO PRICE SHOWN. ' +
      'Finish with a SOURCES list of every URL you used.';
    try {
      const r = await call('search', [
        { role:'system', content: SYS },
        { role:'user', content: String(query || '') },
      ], { temperature: 0, maxTokens: 3000 });
      const cites = Array.isArray(r.citations) ? r.citations.filter(c => typeof c === 'string') : [];
      const body = (r.content || '').trim();
      if (!body) return 'no results';
      return body + (cites.length ? '\n\nSOURCES:\n' + cites.join('\n') : '');
    } catch (e) {
      return 'search failed: ' + String(e.message || e).slice(0, 300);
    }
  },
  async web_fetch({ url }) {
    const r = await fetch(url, { headers:{ 'User-Agent':'Mozilla/5.0' } });
    if (!r.ok) return `HTTP ${r.status}`;
    return strip(await r.text()).slice(0, 12000);
  },
  async verifymate_read({ bucket = 'settled', search = '' }) {
    const base = process.env.VERIFYMATE_URL || 'https://verifymate.vercel.app';
    const r = await fetch(`${base}/api/context`, { headers:{ Authorization:`Bearer ${process.env.VERIFYMATE_AGENT_KEY}` } });
    const d = await r.json();
    let rows = d[bucket] || [];
    if (search) { const q = search.toLowerCase(); rows = rows.filter(x => JSON.stringify(x).toLowerCase().includes(q)); }
    return JSON.stringify(rows.slice(0, 25));
  },
  async verifymate_write(args) {
    const base = process.env.VERIFYMATE_URL || 'https://verifymate.vercel.app';
    const r = await fetch(`${base}/api/verdict`, { method:'POST',
      headers:{ Authorization:`Bearer ${process.env.VERIFYMATE_AGENT_KEY}`, 'Content-Type':'application/json' },
      body: JSON.stringify(args) });
    return await r.text();
  },
  async github_read({ repo, path }) {
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`,
      { headers:{ Authorization:`Bearer ${process.env.GITHUB_TOKEN}`, Accept:'application/vnd.github+json' } });
    if (!r.ok) return `HTTP ${r.status}`;
    const j = await r.json();
    const text = Buffer.from(j.content || '', 'base64').toString('utf8');
    // NO CAP. 16 Aug 2026: this was capped at 12,000 characters, so AskMate read AJ's own
    // 17,091-character page, got a truncated copy, and correctly REFUSED to write it back
    // rather than destroy the file. The refusal was right. The cap was the bug.
    return text;
  },
  async github_write(args = {}) {
    // 16 Aug 2026: this threw "The first argument must be of type string" four times in a row
    // and the model could not tell why, so it just retried the same broken call until it ran out
    // of steps. A tool that fails must SAY WHAT IS MISSING, in words the model can act on.
    const { repo, path, message = 'askmate' } = args;
    const raw = args.content ?? args.body ?? args.text ?? args.html ?? args.file;
    if (!repo || !path) return `github_write FAILED: need both "repo" (owner/name) and "path". You sent: ${Object.keys(args).join(', ') || 'nothing'}`;
    if (raw === undefined || raw === null || raw === '') {
      return `github_write FAILED: "content" was empty. Put the WHOLE file in the "content" argument as a single string. You sent these keys: ${Object.keys(args).join(', ') || 'none'}. Try again with content set.`;
    }
    const content = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
    if (!process.env.GITHUB_TOKEN) return 'github_write FAILED: no GITHUB_TOKEN set on this project';
    try {
      const head = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`,
        { headers:{ Authorization:`Bearer ${process.env.GITHUB_TOKEN}`, Accept:'application/vnd.github+json' } });
      const sha = head.ok ? (await head.json()).sha : undefined;
      const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, { method:'PUT',
        headers:{ Authorization:`Bearer ${process.env.GITHUB_TOKEN}`, Accept:'application/vnd.github+json', 'Content-Type':'application/json' },
        body: JSON.stringify({ message, content: Buffer.from(content, 'utf8').toString('base64'), sha }) });
      if (!r.ok) return `github_write FAILED HTTP ${r.status}: ${(await r.text()).slice(0,220)}`;
      return `WRITTEN: ${path} (${content.length} characters). Vercel will redeploy. Do not write it again.`;
    } catch (e) {
      return `github_write FAILED: ${String(e.message || e).slice(0,200)}`;
    }
  },
  async calc({ expression }) {
    if (!/^[\d\s+\-*/().,%]+$/.test(expression)) return 'refused: numbers and operators only';
    try { return String(Function(`"use strict";return (${expression.replace(/,/g,'')})`)()); }
    catch (e) { return 'bad expression'; }
  },
  async vault_put({ name, value, note }) { return JSON.stringify(await VAULT.putSecret(name, value, note)); },
  async vault_list() { return JSON.stringify(await VAULT.listSecretNames()); },
  async make_password({ name, length = 24 }) {
    const pw = VAULT.makePassword(length);
    const r = await VAULT.putSecret(name, pw, 'generated by AskMate');
    return JSON.stringify({ ...r, value: 'NEVER RETURNED — it is in the vault under this name' });
  },
  async request_approval(a) { return JSON.stringify(await requestApproval(a)); },
  async local_job({ task }) {
    const raw = String(task || '').trim();
    if (!raw) return 'local_job FAILED: send a task, e.g. build {"src":"...","dst":"...","zip":"..."}';
    const verb = raw.split(/\s+/)[0].toLowerCase();
    const KNOWN = ['list','count','copy','write','zip','md5','copyfile','build'];
    if (!KNOWN.includes(verb)) {
      return `local_job FAILED: "${verb}" is not a verb the agent knows. It knows: ${KNOWN.join(', ')}`;
    }
    const r = await addJob({ task: raw, runAt: new Date().toISOString(), repeat: null, maxSteps: 1 });
    return JSON.stringify({ queued: true, id: (r && r.id) || null, verb,
      note: "Queued for the agent on AJ's own computer. It only runs while his machine is on and the agent is running. Tell him to look in Downloads, and do not claim it is done until he says he can see the file." });
  },

  async check_before_sending({ text, kind = 'general' }) {
    return JSON.stringify(await guard(text, kind));
  },
};

async function run(name, args) {
  if (!EXEC[name]) return `unknown tool ${name}`;
  try { return await EXEC[name](args || {}); }
  catch (e) { return `tool ${name} failed: ${String(e.message || e)}`; }
}

// Browser tools bolt straight on. If BROWSER_WS_URL is not set they are not offered at all,
// so the model is never told it has a browser it hasn't got.
const HAS_BROWSER = () => !!process.env.BROWSER_WS_URL;
const ALL_DEFS = () => (HAS_BROWSER() ? [...DEFS, ...BROWSER.TOOLS] : DEFS);

async function runAny(name, args) {
  if (BROWSER.EXEC[name]) {
    if (!HAS_BROWSER()) return 'no browser configured — set BROWSER_WS_URL';
    try { return await BROWSER.EXEC[name](args || {}); }
    catch (e) { return `browser ${name} failed: ${String(e.message || e)}`; }
  }
  return run(name, args);
}

module.exports = { DEFS, ALL_DEFS, run, runAny, shutBrowser: BROWSER.shut };
