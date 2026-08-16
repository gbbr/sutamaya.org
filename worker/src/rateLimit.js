// Thin wrapper over a Cloudflare Rate Limiting binding (declared in wrangler.jsonc), so the
// call sites read the same way whether or not a binding is configured — and so the decision
// logic is unit-testable against a stub binding.
//
// Three per-IP budgets live here: `/api/*` in general, `POST /api/auth/google`, and
// `GET /api/auth/me` on its own. There's no limiter for the static corpus, dictionary and
// per-sutta text under `/data/` — those files are served straight from the assets binding and
// never reach the Worker at all.
//
// The binding's `simple.period` accepts only 10 or 60 seconds, so every budget here is expressed
// per minute in wrangler.jsonc — the actual numbers are in deploy.md.

// Returns true if the request is allowed through. `key` is what the budget is counted against —
// the client IP.
export async function checkRateLimit(binding, key) {
  // No binding means none is configured for this environment (a plain `wrangler dev` without the
  // bindings, or a test env). No key means the request didn't arrive with a client IP: Cloudflare
  // always sets `cf-connecting-ip` on a real edge request, so its absence says we aren't behind
  // the edge and there's nothing meaningful to bucket by. Either way, don't limit.
  if (!binding || !key) return true;
  const { success } = await binding.limit({ key });
  return success;
}
