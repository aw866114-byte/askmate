// ── STAGE 20. VerifyMate's own guard, called before anything is handed back.
// AJ, 16 Aug 2026: "VerifyMate has a guard that you haven't been following even though you meant to."
// He was right. It was skipped all day. So here it is in the code path, not in a good intention.
//
// It blocks: "Andrew Walker" (the name is AJ Walker or Andy), claimed field experience,
// invented social proof, Resend-for-cold; and warns on urgency bait and TPC-as-SaaS.

async function guard(text, kind = 'general') {
  const base = process.env.VERIFYMATE_URL || 'https://verifymate.vercel.app';
  const key = process.env.VERIFYMATE_AGENT_KEY;
  if (!key) return { pass: false, verdict: 'GUARD UNAVAILABLE — no VERIFYMATE_AGENT_KEY', violations: [] };
  try {
    const r = await fetch(`${base}/api/guard`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, kind }),
    });
    if (!r.ok) return { pass: false, verdict: `GUARD ERROR ${r.status}`, violations: [] };
    return await r.json();
  } catch (e) {
    return { pass: false, verdict: 'GUARD ERROR — ' + String(e.message || e), violations: [] };
  }
}
module.exports = { guard };
