# ASKMATE — AJ Walker's AI operator

Not a chatbot. **Fully automated, like InvoiceMate, ReviewMate and the rest.**
It runs on a Vercel cron, does jobs on its own, and only stops when it needs your yes.

## What it actually is

| Layer | What it does |
|---|---|
| **Canon** | Loads your VerifyMate rules **before** anything. If VerifyMate is down it **refuses to answer** rather than guess. In code, not in a prompt. |
| **Worker** | DeepSeek V4-Flash. Does the job. **Has hands** — see tools. |
| **Judge** | Qwen3.7 Flash — a different family, told to attack the worker's answer. |
| **Settle** | Grok 4.1 Fast — only when those two disagree. |
| **Guard** | VerifyMate's own stage-20 guard. Nothing goes out in your name without passing. |
| **Cron** | Hourly. Picks up due jobs and does them unattended. |

## The tools — this is what makes it more than a chat
`web_search` · `web_fetch` · `verifymate_read` · `verifymate_write` ·
`github_read` · `github_write` (**writes to your repo, Vercel redeploys — this is how it builds
sites and apps**) · `calc` (never does sums in its head) · `check_before_sending` (mandatory guard)

## Endpoints
| Route | What it is |
|---|---|
| `POST /api/agent` `{task, repo}` | **Do a job now, with tools.** |
| `POST /api/ask` `{question}` | Ask a question. Three models, one answer, labelled AGREED / ESCALATED. |
| `POST /api/jobs` `{task, runAt}` | **Queue a job.** The cron does it on its own. |
| `GET /api/jobs` | What is queued, done, blocked. |
| `GET /api/cron/run` | The hourly run. Vercel calls this. |
| `GET /api/health` | Which keys are set, and whether the canon actually loaded. |
| `/` | Phone page. Big buttons. **Reads answers out loud.** |

## Cost
DeepSeek V4-Flash $0.14 in / $0.28 out per 1M tokens; cached input **$0.0028**.
Qwen judge $0.03 / $0.13. Grok only on disagreement $0.20 / $0.50.
**1,000 jobs a month ≈ US$1.60.** Writing all 76 missing Etsy listings ≈ **2 cents**.

## Deploy
1. Push to a GitHub repo.
2. Import to Vercel. No build step.
3. Set the variables below.
4. `GET /api/health` — it tells you what is missing.
5. Open the URL on your phone, Add to Home Screen.

## Environment variables
| Name | Needed |
|---|---|
| `ASKMATE_KEY` | yes — any long random string you invent |
| `VERIFYMATE_AGENT_KEY` | yes — the one in `claude\.vm_agent_key.txt` |
| `DEEPSEEK_API_KEY` / `QWEN_API_KEY` / `XAI_API_KEY` | yes — **or** just `OPENROUTER_API_KEY` for all three |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | yes for the job queue — the same JSON VerifyMate uses |
| `GITHUB_TOKEN` | only if you want it building sites |
| `CRON_SECRET` | optional, for the cron |

## What it will not do
Create accounts or passwords on its own. It prepares everything and hands you one click.
That is deliberate — unattended credential creation is how accounts get locked.

---

## Added after AJ's notes, 16 Aug 2026

### Photos in, priced quote out — `POST /api/quote`
Take photos on your phone, say what you saw, press **PRICE IT**.
It reads the pictures, breaks the job into lines, and prices it on **your** rate.
Everything learned pricing 17 Thrumster St is baked in:
- **$88 per man per hour, GST inclusive. Nothing added on top.**
- **$77 is a LAWN minimum only** — never a floor on anything else.
- Hours are **on-site hours with two men**, and **man-hours = hours × 2**. Stated that way so nobody mixes them up again.
- **The arithmetic is done in code, not by a model.** That is the $352 lesson.
- **Green waste is never in the fixed price** — at cost, per trip, itemised.
- Two outputs: your internal sheet, and **the customer wording with no hours and no rate on it**.
- **Every number is written to Firestore the moment it exists.** A chat lost his quote figures once.

### A real browser — `BROWSER_WS_URL`
Provider-agnostic on purpose, so he is never locked in. Point it at Browserless (free self-hosted
via Docker, or ~$50/mo cloud), Steel.dev (free tier, open source), Human Browser (~$0.05/min,
no subscription), or his own Chrome on `--remote-debugging-port=9222`.
Tools: `browser_goto` `browser_read` `browser_click` `browser_type` `browser_js`
`browser_save_login` `browser_use_login`. Logged-in sessions persist via cookies stored in **his own**
Firestore. **If `BROWSER_WS_URL` is not set the browser tools are hidden from the model entirely**,
so it is never told it has hands it hasn't got.

### Secrets and accounts — his rules, followed properly
- `vault_put`, `vault_list`, `make_password` go through **VerifyMate's own vault**. AES-256-GCM,
  and **there is no read path — not for AJ, not for the model, not for anyone.** Names and lengths only.
- `make_password` generates a strong password straight into the vault. **The value is never returned.**
- **`request_approval` is mandatory** before anything irreversible — account creation, setting a
  password, paying, publishing, sending, deleting. It prepares everything, then **stops**.
  That is VerifyMate's `claude-capabilities` rule in full: *through AJ's browser, with his click-approval.*
  It will not create accounts while nobody is watching.

### Rule Zero
Loaded at the top of **every** system prompt, above the canon, in `lib/rulezero.js`.
VERIFIED / INFERRED / UNKNOWN labelling, the six traps that actually cost him money, the name rule,
and **search his canon before asking him anything**.
