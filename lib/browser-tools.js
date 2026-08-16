// The browser tools the model is actually given. One session per task, cookies persisted per host.
const { connect, page, evalJs, wait } = require('./browser');
const { log } = require('./store');

let SESSION = null; // reused within one invocation

async function open() {
  if (SESSION) return SESSION;
  const b = await connect();
  const s = await page(b);
  SESSION = { b, s };
  return SESSION;
}
async function shut() { if (SESSION) { SESSION.b.close(); SESSION = null; } }

const READ = `(() => {
  const drop = ['script','style','noscript','svg'];
  const c = document.body.cloneNode(true);
  drop.forEach(t => c.querySelectorAll(t).forEach(e => e.remove()));
  return (c.innerText || '').replace(/\\n{3,}/g,'\\n\\n').replace(/[ \\t]{2,}/g,' ').trim().slice(0, 12000);
})()`;

const CLICK = (text) => `(() => {
  const t = ${JSON.stringify(text)}.toLowerCase();
  const els = [...document.querySelectorAll('button,a,[role=button],input[type=submit],[onclick]')];
  const hit = els.find(e => (e.innerText||e.value||e.getAttribute('aria-label')||'').trim().toLowerCase().includes(t));
  if (!hit) return 'NOT FOUND: ' + t;
  hit.scrollIntoView({block:'center'}); hit.click();
  return 'clicked: ' + (hit.innerText||hit.value||'').trim().slice(0,60);
})()`;

const TYPE = (label, value) => `(() => {
  const l = ${JSON.stringify(label)}.toLowerCase();
  const ins = [...document.querySelectorAll('input,textarea,[contenteditable=true]')];
  const f = ins.find(e => ((e.placeholder||'')+(e.name||'')+(e.id||'')+(e.getAttribute('aria-label')||'')).toLowerCase().includes(l));
  if (!f) return 'FIELD NOT FOUND: ' + l;
  const v = ${JSON.stringify(value)};
  if (f.isContentEditable) { f.focus(); f.textContent = v; }
  else { const set = Object.getOwnPropertyDescriptor(f.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;
         set.call(f, v); }
  f.dispatchEvent(new Event('input',{bubbles:true})); f.dispatchEvent(new Event('change',{bubbles:true}));
  return 'typed into: ' + (f.name||f.id||f.placeholder||'field');
})()`;

const TOOLS = [
  { type:'function', function:{ name:'browser_goto', description:'Open a URL in the real browser and return the page text.',
    parameters:{ type:'object', properties:{ url:{type:'string'} }, required:['url'] } } },
  { type:'function', function:{ name:'browser_read', description:'Read the visible text of the current page.',
    parameters:{ type:'object', properties:{} } } },
  { type:'function', function:{ name:'browser_click', description:'Click the first button or link whose text contains this.',
    parameters:{ type:'object', properties:{ text:{type:'string'} }, required:['text'] } } },
  { type:'function', function:{ name:'browser_type', description:'Type into the field whose name, id, placeholder or label contains this.',
    parameters:{ type:'object', properties:{ field:{type:'string'}, value:{type:'string'} }, required:['field','value'] } } },
  { type:'function', function:{ name:'browser_js', description:'Run JavaScript on the page and return the result. Last resort.',
    parameters:{ type:'object', properties:{ code:{type:'string'} }, required:['code'] } } },
  { type:'function', function:{ name:'browser_save_login', description:'Save the current cookies for this site so it stays signed in next time.',
    parameters:{ type:'object', properties:{ site:{type:'string'} }, required:['site'] } } },
  { type:'function', function:{ name:'browser_use_login', description:'Restore saved cookies for a site before visiting it.',
    parameters:{ type:'object', properties:{ site:{type:'string'} }, required:['site'] } } },
];

const EXEC = {
  async browser_goto({ url }) {
    const { b, s } = await open();
    await b.send('Page.navigate', { url }, s);
    await wait(3500);
    return String(await evalJs(b, s, READ));
  },
  async browser_read() { const { b, s } = await open(); return String(await evalJs(b, s, READ)); },
  async browser_click({ text }) {
    const { b, s } = await open();
    const r = await evalJs(b, s, CLICK(text)); await wait(2500);
    return `${r}\n---\n${String(await evalJs(b, s, READ)).slice(0, 3000)}`;
  },
  async browser_type({ field, value }) { const { b, s } = await open(); return String(await evalJs(b, s, TYPE(field, value))); },
  async browser_js({ code }) { const { b, s } = await open(); return String(await evalJs(b, s, code)).slice(0, 6000); },
  async browser_save_login({ site }) {
    const { b, s } = await open();
    const { cookies } = await b.send('Network.getCookies', {}, s);
    const keep = cookies.filter((c) => (c.domain || '').includes(site.replace(/^https?:\/\//, '').split('/')[0]));
    await log('logins', { site, cookies: JSON.stringify(keep) });
    return `saved ${keep.length} cookies for ${site}. They live in your own Firestore and nowhere else.`;
  },
  async browser_use_login({ site }) {
    // Reads the newest saved jar for this site and sets it before navigating.
    const { listLogins } = require('./store');
    const rows = await listLogins(site);
    if (!rows.length) return `no saved login for ${site} — sign in once with browser_goto, then call browser_save_login`;
    const { b, s } = await open();
    const cookies = JSON.parse(rows[0].cookies || '[]');
    await b.send('Network.setCookies', { cookies }, s);
    return `restored ${cookies.length} cookies for ${site}`;
  },
};

module.exports = { TOOLS, EXEC, shut };
