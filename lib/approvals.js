// ── AJ'S CLICK-APPROVAL, AS CODE.
// VerifyMate rule `claude-capabilities` (AJ, 3 Aug 2026): Claude DOES do passwords, account creation,
// Etsy, Stripe, Vercel, GitHub — "through AJ's browser WITH HIS CLICK-APPROVAL".
// So: the app does everything up to the irreversible step, then STOPS and waits for him.
// It does not create accounts while nobody is watching. That is the difference between
// following his rule and ignoring the half of it that is inconvenient.
const { log } = require('./store');

const NEEDS_APPROVAL = [
  /create.{0,20}account/i, /sign ?up/i, /register/i,
  /password/i, /credential/i, /payment|card|billing|subscribe/i,
  /publish|submit for (review|publishing)/i, /delete|remove permanently/i,
  /send (an? )?(email|message|dm)/i, /place (an? )?order|check ?out/i,
];

function needsApproval(action) { return NEEDS_APPROVAL.some((re) => re.test(String(action))); }

async function requestApproval({ action, detail, prepared }) {
  await log('approvals', { action, detail: detail || '', prepared: prepared || '', status: 'waiting' });
  return {
    blocked: true,
    waitingOnAJ: action,
    prepared: prepared || '',
    message: `STOPPED FOR YOUR YES: ${action}. Everything up to this point is done and ready. ` +
             `Nothing irreversible has happened. Approve it in the app and it finishes the job.`,
  };
}
module.exports = { needsApproval, requestApproval };
