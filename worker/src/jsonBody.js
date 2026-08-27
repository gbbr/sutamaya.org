// Hono has each handler parse its own body, so this gives every route the "a malformed or absent
// body is just an empty object" behaviour their own validation assumes.
export async function jsonBody(c) {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}
