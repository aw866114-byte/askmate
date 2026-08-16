// ═══════════════════════════════════════════════════════════════════════════
// THE COUNCIL — AJ's stack. Broad spectrum, pennies on the dollar.
//
// ONE OpenRouter key runs every member below. More models does NOT mean more
// accounts. If AJ also has a native key for a provider, that key is used
// instead (cheaper, and DeepSeek's cache discount only exists natively).
//
// Prices are USD per 1,000,000 tokens.
// VERIFIED 16 Aug 2026 from OpenRouter's live /api/v1/models and the vendors'
// own pricing pages. Re-check before quoting these to anyone.
// ═══════════════════════════════════════════════════════════════════════════

const ROSTER = {
  // ── FREE. $0. Use these first for bulk drafting and throwaway passes. ──────
  free_bulk: {
    name: 'Nemotron 3.5 Lightning (free)',
    or: 'nvidia/nemotron-3.5-lightning:free',
    price: { in: 0, cachedIn: 0, out: 0 }, ctx: 1000000, vision: false,
    job: 'Free bulk drafting. 1M context. Costs nothing, so try it first.',
  },
  free_eyes: {
    name: 'Dots-3 Note (free)',
    or: 'dots-studio/dots-3-note-preview:free',
    price: { in: 0, cachedIn: 0, out: 0 }, ctx: 512000, vision: true,
    job: 'Free and it READS PICTURES. First look at job photos before paying anyone.',
  },

  // ── PENNIES. The everyday workers. ────────────────────────────────────────
  cheapest: {
    name: 'Ling 3.0 Flash',
    or: 'inclusionai/ling-3.0-flash',
    price: { in: 0.021, cachedIn: 0.021, out: 0.063 }, ctx: 262144, vision: false,
    job: 'The cheapest paid model on the board. Sorting, tagging, classifying.',
  },
  judge: {
    name: 'Qwen3.7 Flash',
    or: 'qwen/qwen3.7-flash',
    native: { url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', env: 'QWEN_API_KEY', model: 'qwen-flash' },
    price: { in: 0.03, cachedIn: 0.03, out: 0.13 }, ctx: 1000000, vision: true,
    job: 'Second opinion. Different family, so it actually disagrees. Reads pictures. 1M context.',
  },
  frugal: {
    name: 'Solar Pro 4',
    or: 'upstage/solar-pro4',
    price: { in: 0.03, cachedIn: 0.03, out: 0.12 }, ctx: 524288, vision: false,
    job: 'Third cheap voice for a 3-way vote without a 3rd bill.',
  },
  openai: {
    name: 'GPT-5.6 Luna',
    or: 'openai/gpt-5.6-luna',
    native: { url: 'https://api.openai.com/v1/chat/completions', env: 'OPENAI_API_KEY', model: 'gpt-5.6-luna' },
    price: { in: 0.10, cachedIn: 0.10, out: 0.60 }, ctx: 1050000, vision: true,
    job: "OpenAI's cheapest. Best of the cheap ones at strict JSON — so it writes the schema.",
  },
  google: {
    name: 'Gemini 2.5 Flash-Lite',
    or: 'google/gemini-2.5-flash-lite',
    // Google's own OpenAI-compatible endpoint. Free tier exists on an AI Studio
    // key with no card. NOT yet tested live from this app — treat as INFERRED
    // until a real call returns 200.
    native: { url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', env: 'GEMINI_API_KEY', model: 'gemini-2.5-flash-lite' },
    price: { in: 0.10, cachedIn: 0.10, out: 0.40 }, ctx: 1048576, vision: true,
    job: 'Google in the room. Free on an AI Studio key. Reads pictures.',
  },
  google_big: {
    name: 'Gemini 3.7 Flash',
    or: 'google/gemini-3.7-flash',
    native: { url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', env: 'GEMINI_API_KEY', model: 'gemini-3.7-flash' },
    price: { in: 0.375, cachedIn: 0.375, out: 1.875 }, ctx: 1048576, vision: true,
    job: "Google's current Flash. Best cheap eyes for a messy site photo.",
  },
  worker: {
    name: 'DeepSeek V4-Flash',
    or: 'deepseek/deepseek-v4-flash-0731',
    native: { url: 'https://api.deepseek.com/chat/completions', env: 'DEEPSEEK_API_KEY', model: 'deepseek-chat' },
    // The cached-input price is a NATIVE-ONLY discount: 50x cheaper on repeat context.
    price: { in: 0.14, cachedIn: 0.0028, out: 0.28 }, ctx: 1048576, vision: false,
    job: 'The main worker, as AJ asked. Everything routes here first.',
  },
  settle: {
    name: 'Grok 4.3',
    or: 'x-ai/grok-4.3',
    native: { url: 'https://api.x.ai/v1/chat/completions', env: 'XAI_API_KEY', model: 'grok-4.3' },
    price: { in: 1.25, cachedIn: 1.25, out: 2.50 }, ctx: 2000000, vision: true,
    job: 'Tie-breaker. Only fires when worker and judge disagree.',
  },
  code: {
    name: 'Seed 2.0 Code',
    or: 'bytedance-seed/seed-2.0-code',
    price: { in: 0.50, cachedIn: 0.50, out: 3.00 }, ctx: 262144, vision: true,
    job: 'Writes and fixes code for the sites and apps.',
  },

  // ── SPECIALISTS. Worth the extra, used on purpose, not by default. ────────
  search: {
    name: 'Perplexity Sonar',
    or: 'perplexity/sonar',
    native: { url: 'https://api.perplexity.ai/chat/completions', env: 'PERPLEXITY_API_KEY', model: 'sonar' },
    price: { in: 1.00, cachedIn: 1.00, out: 1.00 }, ctx: 127000, vision: false,
    // Native Perplexity also charges a request fee (~$5 per 1,000 low-context searches).
    perRequestUSD: 0.005,
    job: 'LIVE WEB WITH SOURCES. This is the one that stops the others inventing facts.',
  },
  long: {
    name: 'Kimi K3',
    or: 'moonshotai/kimi-k3',
    price: { in: 3.00, cachedIn: 3.00, out: 15.00 }, ctx: 1048576, vision: true,
    job: 'Long-form writing when the cheap ones go thin. Used sparingly.',
  },
  big: {
    name: 'Claude Opus 5',
    or: 'anthropic/claude-opus-5',
    native: { url: 'https://api.anthropic.com/v1/chat/completions', env: 'ANTHROPIC_API_KEY', model: 'claude-opus-5' },
    price: { in: 5.00, cachedIn: 5.00, out: 25.00 }, ctx: 1000000, vision: true,
    job: 'The expensive one. GATED. Final money-facing copy only, never bulk.',
  },
};

// Roles that must never be called automatically without a reason — they cost real money.
const GATED = new Set(['big', 'long']);

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function resolve(role) {
  const m = ROSTER[role];
  if (!m) throw new Error(`unknown council member: ${role}. Known: ${Object.keys(ROSTER).join(', ')}`);
  const nativeKey = m.native && process.env[m.native.env];
  if (nativeKey) return { m, url: m.native.url, key: nativeKey, model: m.native.model, via: 'native' };
  const or = process.env.OPENROUTER_API_KEY;
  if (!or) {
    const want = m.native ? `${m.native.env} or OPENROUTER_API_KEY` : 'OPENROUTER_API_KEY';
    throw new Error(`no API key for "${role}" (${m.name}) — set ${want}`);
  }
  return { m, url: OPENROUTER_URL, key: or, model: m.or, via: 'openrouter' };
}

/** Cheapest member that can do the job. vision:true restricts to picture-readers. */
function cheapestFor({ vision = false, free = false } = {}) {
  return Object.entries(ROSTER)
    .filter(([, m]) => (!vision || m.vision) && (!free || m.price.in === 0))
    .sort((a, b) => (a[1].price.in + a[1].price.out) - (b[1].price.in + b[1].price.out))
    .map(([role]) => role)[0] || null;
}

async function call(role, messages, {
  temperature = 0.2, maxTokens = 1500, tools = null, model: modelOverride = null, allowGated = false,
} = {}) {
  if (GATED.has(role) && !allowGated) {
    throw new Error(`"${role}" (${ROSTER[role].name}) is gated because it is expensive. Pass allowGated:true and say why.`);
  }
  const { m, url, key, model: resolved, via } = resolve(role);
  const model = modelOverride || resolved;

  const started = Date.now();
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      ...(via === 'openrouter' ? { 'X-Title': 'AskMate', 'HTTP-Referer': 'https://askmate.local' } : {}),
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, ...(tools ? { tools, tool_choice: 'auto' } : {}) }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${m.name} (${via}) ${r.status}: ${text.slice(0, 300)}`);
  let j; try { j = JSON.parse(text); } catch { throw new Error(`${m.name} returned non-JSON`); }

  const u = j.usage || {};
  const cachedIn = u.prompt_cache_hit_tokens || u.prompt_tokens_details?.cached_tokens || 0;
  const freshIn = Math.max(0, (u.prompt_tokens || 0) - cachedIn);
  const out = u.completion_tokens || 0;
  const cost = (freshIn * m.price.in + cachedIn * m.price.cachedIn + out * m.price.out) / 1e6
             + (via === 'native' ? (m.perRequestUSD || 0) : 0);

  return {
    role, provider: m.name, model, via,
    content: (j.choices?.[0]?.message?.content || '').trim(),
    toolCalls: j.choices?.[0]?.message?.tool_calls || null,
    citations: j.citations || j.choices?.[0]?.message?.annotations || null,
    ms: Date.now() - started,
    tokens: { in: u.prompt_tokens || 0, cached: cachedIn, out },
    costUSD: Number(cost.toFixed(6)),
  };
}

/** What 1,000 jobs of 8k in / 2k out costs on each member. For AJ, in dollars. */
function per1000Jobs(inTok = 8000, outTok = 2000) {
  return Object.entries(ROSTER).map(([role, m]) => ({
    role, name: m.name, vision: m.vision,
    usd: Number((((inTok * m.price.in + outTok * m.price.out) / 1e6) * 1000 + (m.perRequestUSD || 0) * 1000).toFixed(2)),
  })).sort((a, b) => a.usd - b.usd);
}

// Back-compat: the old three-layer names still work.
const PROVIDERS = ROSTER;

module.exports = { call, ROSTER, PROVIDERS, GATED, cheapestFor, per1000Jobs };
