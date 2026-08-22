// ── THE THING THAT WOULD HAVE STOPPED EVERY MISTAKE ON 16 AUG 2026.
// The canon load is NOT optional and NOT a prompt instruction. It is code.
// If VerifyMate cannot be reached, the request FAILS. It does not answer from memory.
//
// AJ's own words are the reason this file exists:
//   "Read it does not mean fetch it."  A chat fetched his context, sampled it, and breached
//   four do-not-reopen records in one evening. On 16 Aug another one asked him for a rate
//   that was written in his own quotes file. Both were reading failures, not model failures.

const { RULE_ZERO } = require('./rulezero');

let cache = { at: 0, text: null };
const TTL_MS = 5 * 60 * 1000;

async function loadCanon({ force = false } = {}) {
  if (!force && cache.text && Date.now() - cache.at < TTL_MS) return cache.text;

  const base = process.env.VERIFYMATE_URL || 'https://verifymate.vercel.app';
  const key = process.env.VERIFYMATE_AGENT_KEY;
  if (!key) throw new Error('CANON REFUSED: VERIFYMATE_AGENT_KEY is not set. This app does not answer without canon.');

  const r = await fetch(`${base}/api/context`, { headers: { Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`CANON REFUSED: VerifyMate returned ${r.status}. Not answering from memory.`);
  const d = await r.json();

  const rules = (d.rules || []).map((x) => `- ${x.text}`).join('\n');
  // 22 Aug 2026: /api/context now sends settled as an INDEX (id + one-line headline)
  // and carries every do-not-reopen fact IN FULL under doNotReopen. Prefer that.
  // The old filter stays as a fallback, so this still works against ?full=1 or an
  // older VerifyMate. Never build canon from headlines - they are only summaries.
  const dnrRows = (Array.isArray(d.doNotReopen) && d.doNotReopen.length)
    ? d.doNotReopen
    : (d.settled || []).filter((x) => x.do_not_reopen);
  const dnr = dnrRows
    .map((x) => `- [DO NOT REOPEN] ${x.id}: ${x.verdict}`).join('\n');
  // errata is an index now too, so take the newest from errataRecent, which
  // carries claim and correction in full. Old shape kept as a fallback.
  const errataRows = (Array.isArray(d.errataRecent) && d.errataRecent.length)
    ? d.errataRecent
    : (d.errata || []).slice(-25);
  const errata = errataRows
    .map((x) => `- WITHDRAWN: ${x.claim} -> CORRECTED: ${x.correction}`).join('\n');
  // 22 Aug 2026: AskMate could only ever see the do-not-reopen facts - 97 of 535.
  // It did not know the round book was live or the call sheet was finished. Now it
  // gets a HEADLINE INDEX of every other settled fact, so it knows what it does not
  // know and can pull any of them whole with verifymate_read.
  const dnrIds = new Set(dnrRows.map((x) => x.id));
  const settledCount = (d.settled || []).length;
  const indexLines = (d.settled || [])
    .filter((x) => !dnrIds.has(x.id))
    .map((x) => '- ' + x.id + ': ' + String(x.headline || x.verdict || '').slice(0, 200))
    .join('\n');
  const failing = (d.failing || []).map((x) => `- OPEN: ${x.id} — ${x.evidence}`).join('\n');

  cache = {
    at: Date.now(),
    text:
`${RULE_ZERO}

=== AJ WALKER — CANON, LIVE FROM VERIFYMATE. NOT BACKGROUND. ===

RULES
${rules || '(none returned)'}

SETTLED — DO NOT REOPEN, DO NOT ASK HIM AGAIN
${dnr || '(none returned)'}

WITHDRAWN CLAIMS — NEVER REPEAT THESE
${errata || '(none returned)'}

EVERYTHING ELSE HE HAS SETTLED - ${settledCount} facts in total, ${dnrRows.length} printed above in full.
HEADLINES ONLY. A headline is a summary, NEVER the fact. Before you state anything from
this list, or ask AJ about any of it, read the whole record with verifymate_read.
Do not assume something is unrecorded just because it is not written out here.
${indexLines || '(none returned)'}

CURRENTLY OPEN
${failing || '(none)'}
=== END CANON ===`,
  };
  return cache.text;
}

module.exports = { loadCanon };
