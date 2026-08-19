// ═══════════════════════════════════════════════════════════════════════════
// THE SESSION PROTOCOL — AskMate works with VerifyMate exactly the way a
// Claude session does, and it is CODE, not a good intention.
//
// AJ, 16 Aug 2026: "I want AskMate and VerifyMate working together like Claude
// and VerifyMate work together."
//
// A Claude session does five things. Until now AskMate only did two of them.
//
//   1  START      register the run and acknowledge the rules. VerifyMate REFUSES
//                 a session that has not acknowledged them (it returns 428).
//   2  LOAD       pull the canon before doing anything — lib/canon.js, already there.
//   5  WORK       write every action to the journal AS IT HAPPENS, with evidence,
//                 so a run that dies halfway still leaves a record.
//   6  RECORD     write a verdict when something is actually verified.
//   9  HANDOFF    write the state continuously, so a dead run costs nothing.
//  20  GUARD      nothing leaves without passing — lib/guard.js, already there.
//
// Every write here is best-effort: if VerifyMate is unreachable the JOB still
// finishes, but the run is marked unrecorded and says so. What must never happen
// is silence — a step that neither lands nor complains.
// ═══════════════════════════════════════════════════════════════════════════

const BASE = () => process.env.VERIFYMATE_URL || 'https://verifymate.vercel.app';
const KEY = () => process.env.VERIFYMATE_AGENT_KEY;

/** The protocol, in words, injected into every system prompt under the canon. */
const PROTOCOL = `
=== HOW YOU WORK WITH VERIFYMATE — THIS IS THE PROTOCOL, NOT ADVICE ===
1. The canon above came from VerifyMate seconds ago. It outranks anything you remember.
2. NEVER reopen anything marked DO NOT REOPEN. Never repeat a WITHDRAWN claim.
3. Before you ask AJ for a fact about his own business, SEARCH THE CANON with verifymate_read.
   On 16 Aug a chat asked him his own hourly rate three times while it sat in his own file.
4. When you verify something, RECORD IT with verifymate_write {type:'verdict', id, verdict, evidence}.
   Evidence means what you actually ran and what it returned — not "checked".
5. When you were wrong, record an erratum: {type:'erratum', claim, correction}.
6. "Done" only exists with a passing check and stored evidence. Otherwise say:
   checked X of Y, have not opened Z.
=== END PROTOCOL ===

=== RULE ZERO - THIS OUTRANKS EVERYTHING ABOVE IT ===
AJ, 8 Aug 2026: "No guessing. Only the truth. Guessing is probably part of what's fucked me up."
Every factual claim you make is one of three things and you must say which:
  VERIFIED - you ran the check in THIS run and can state what it returned.
  INFERRED - you are reasoning from evidence. Say what the evidence is and where the gap is.
  UNKNOWN  - you have not checked. Say so out loud.
If it is not VERIFIED it does not get stated as a flat fact. Never write "X is happening"
when you mean "X might be happening."
Say what you have NOT done FIRST, before what you have.
AJ cannot check your work. He is not a developer and he does not read - he listens. There is
no safety net behind you. Never offer him a check he cannot perform. Never hand him two
numbers and let him choose - work out which is right and say why the other is wrong.
A number AJ quotes may have come from an earlier session. It carries no authority. Verify it.
A tool returning success is not the thing happening. A file existing is not the file being used.
The one test before any claim reaches him: did you SEE this, or are you telling a story that
fits what you saw? If it is a story, label it INFERRED or go and look.
=== END RULE ZERO ===`;

async function vm(path, method, body) {
  const key = KEY();
  if (!key) return { ok: false, error: 'no VERIFYMATE_AGENT_KEY' };
  try {
    const r = await fetch(`${BASE()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { j = { ok: false, error: text.slice(0, 200) }; }
    return { ...j, httpStatus: r.status };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/** STAGE 1 — register the run. VerifyMate refuses a session that has not acked the rules. */
async function start(session) {
  return vm('/api/session', 'POST', { action: 'start', session, ackRules: true });
}

/** STAGE 5 — append-only journal, written as it happens, never batched at the end. */
async function log(session, did, evidence = '') {
  return vm('/api/session', 'POST', { action: 'log', session, did: String(did).slice(0, 500), evidence: String(evidence).slice(0, 900) });
}

/** STAGE 9 — the handoff, written continuously so a dead run costs nothing. */
async function handoff(session, state) {
  return vm('/api/session', 'POST', { action: 'handoff', session, state: String(state).slice(0, 8000) });
}

/** STAGE 6 — a verified fact, with the evidence that makes it verified. */
async function verdict(payload) {
  return vm('/api/verdict', 'POST', payload);
}

/**
 * Wrap one run in the whole protocol.
 *
 *   const run = await open('ask', question);
 *   await run.step('called the judge', 'DISPUTE, 2 problems');
 *   await run.close('answered', finalText);
 *
 * `recorded` is false when VerifyMate could not be written to. The caller must
 * surface that rather than let it pass as a clean run.
 */
async function open(kind, subject) {
  const session = `askmate-${kind}-${Date.now().toString(36)}`;
  const started = await start(session);
  const recorded = started.ok === true;
  await log(session, `START ${kind}: ${String(subject).slice(0, 200)}`, recorded ? '' : 'session start was refused');
  const trail = [];

  return {
    session,
    recorded,
    startError: recorded ? null : (started.error || `HTTP ${started.httpStatus}`),
    async step(did, evidence = '') {
      trail.push({ did, evidence });
      return log(session, did, evidence);
    },
    async close(status, answer, extra = {}) {
      await log(session, `END ${kind}: ${status}`, String(answer).slice(0, 900));
      await handoff(session, [
        `ASKMATE RUN — ${kind}`,
        `subject : ${String(subject).slice(0, 300)}`,
        `status  : ${status}`,
        ...Object.entries(extra).map(([k, v]) => `${k.padEnd(8)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`),
        '',
        'STEPS',
        ...trail.map((t, i) => `${i + 1}. ${t.did}${t.evidence ? ` — ${t.evidence}` : ''}`),
        '',
        'ANSWER',
        String(answer).slice(0, 3000),
      ].join('\n'));
      return { session, steps: trail.length };
    },
  };
}

module.exports = { PROTOCOL, open, start, log, handoff, verdict };
