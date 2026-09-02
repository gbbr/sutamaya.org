// Returns a request's parsed JSON body, or an empty object if it is absent or malformed.
export async function jsonBody(c) {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}
