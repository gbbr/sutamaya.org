// Express's global `express.json()` left every handler free to read `req.body`; in Hono each
// handler parses its own, so this recovers the same "a malformed or absent body is just an empty
// object" behavior the routes' own validation already assumes.
export async function jsonBody(c) {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}
