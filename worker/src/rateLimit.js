// A wrapper over Cloudflare's Rate Limiting bindings, which index.js mounts as three per-IP
// budgets. They are declared in wrangler.jsonc, per minute, the binding's period accepting only 10
// or 60 seconds; the numbers themselves are in docs/deploy.md.

// Reports whether a request is allowed through, `key` being what the budget is counted against.
export async function checkRateLimit(binding, key) {
  // No binding configured for this environment, or a request that arrived with no client IP to
  // bucket by, which means it didn't come through the edge.
  if (!binding || !key) return true;
  const { success } = await binding.limit({ key });
  return success;
}
