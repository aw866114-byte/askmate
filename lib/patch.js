// ── A SURGICAL FILE EDITOR. Added 19 Aug 2026.
// WHY THIS EXISTS: AskMate could not repair its own lib/tools.js. Writing a file with
// github_write means the model has to hold the ENTIRE file in one tool call, and at about
// ten thousand characters it produced an empty call five times running. It managed a six
// thousand character file fine. So the limit is real and it sits between the two.
// This does the read, the replace and the write ON THE SERVER. The model only ever says
// WHAT to change - it never has to carry the file. It refuses unless the target text
// appears exactly once, so it cannot quietly change the wrong thing.

async function ghRead(repo, path) {
  const r = await fetch('https://api.github.com/repos/' + repo + '/contents/' + path, {
    headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json' }
  });
  if (!r.ok) return null;
  const j = await r.json();
  return { text: Buffer.from(j.content || '', 'base64').toString('utf8'), sha: j.sha };
}

async function githubPatch({ repo, path, find, replace, message }) {
  if (!repo || !path || !find) return 'need repo, path and find';
  const cur = await ghRead(repo, path);
  if (!cur) return 'could not read ' + repo + '/' + path;
  const hits = cur.text.split(find).length - 1;
  if (hits === 0) return 'REFUSED: that text is not in the file. NOTHING was changed.';
  if (hits > 1) return 'REFUSED: that text appears ' + hits + ' times. Be more specific. NOTHING was changed.';
  const out = cur.text.replace(find, replace == null ? '' : replace);
  const w = await fetch('https://api.github.com/repos/' + repo + '/contents/' + path, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: message || ('patch ' + path),
      content: Buffer.from(out, 'utf8').toString('base64'),
      sha: cur.sha
    })
  });
  if (!w.ok) return 'write failed HTTP ' + w.status + ': ' + (await w.text()).slice(0, 200);
  return 'PATCHED ' + path + ' - replaced exactly 1 occurrence. ' + cur.text.length + ' chars in, ' + out.length + ' chars out. Vercel will redeploy.';
}

const PATCH_DEF = { type: 'function', function: {
  name: 'github_patch',
  description: 'Change ONE exact piece of text inside a file in a GitHub repo without rewriting the whole file. Use this instead of github_write for any edit to a large file. Refuses if the text is not found, or found more than once.',
  parameters: { type: 'object', properties: {
    repo: { type: 'string', description: 'owner/name' },
    path: { type: 'string' },
    find: { type: 'string', description: 'the exact existing text' },
    replace: { type: 'string', description: 'what to put in its place' },
    message: { type: 'string' }
  }, required: ['repo', 'path', 'find', 'replace'] } } };

module.exports = { PATCH_DEF, githubPatch };