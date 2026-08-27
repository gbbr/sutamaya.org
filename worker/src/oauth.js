// The OAuth 2.0 authorization-code flow: the browser leaves for the provider and comes back to
// /api/auth/{provider}/callback with a code, which the Worker exchanges for an id_token
// server-side. Everything here is provider-agnostic except the Google constants at the bottom, so
// a second provider is a start/callback pair plus its own URLs and profile mapping.
//
// Two things guard the round trip, and both are needed:
//   - the `state` parameter is signed with SESSION_SECRET, so a callback can only carry a state
//     this Worker issued (and one issued no more than STATE_MAX_AGE_MS ago);
//   - a nonce inside that state is *also* set as a short-lived HttpOnly cookie, so the state can
//     only be redeemed by the same browser it was issued to. Without it an attacker could run the
//     flow to the point of holding a valid code for their own account and then trick a victim into
//     loading the callback, silently signing the victim into the attacker's account.

const STATE_MAX_AGE_MS = 10 * 60 * 1000;

export const OAUTH_NONCE_COOKIE = 'sutamaya_oauth';

const encoder = new TextEncoder();

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

function hmacKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

// `${base64url(json)}.${base64url(hmac)}` — the payload is readable by anyone holding the URL (it
// travels through the provider), so it carries only a nonce, a return path and a timestamp.
export async function signState(payload, secret) {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

// Returns the payload, or null for anything that isn't a currently-valid state we issued —
// tampered, forged, malformed or older than STATE_MAX_AGE_MS. Verification goes through
// crypto.subtle.verify rather than comparing strings, so there's no timing-comparison to get
// wrong here.
export async function verifyState(token, secret) {
  if (typeof token !== 'string') return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  let valid;
  try {
    valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromBase64Url(signature), encoder.encode(body));
  } catch {
    return null; // signature wasn't valid base64url
  }
  if (!valid) return null;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.t !== 'number' || Date.now() - payload.t > STATE_MAX_AGE_MS) return null;
  return payload;
}

// WEB_ORIGIN is normally one origin, but it accepts a comma-separated list so a dev machine can
// serve the same Worker to both `http://localhost:5173` and the LAN hostname a phone reaches it by
// (see docs/deploy.md "Testing on mobile") without editing .dev.vars between the two. The first
// entry is the canonical one — what every leg of the flow falls back to when the request doesn't
// identify which of them it came in on.
export function webOrigins(value) {
  return String(value || '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

// Picks the origin a redirect should be built on. `candidate` is attacker-controllable (it comes
// from the `return` URL in a query parameter and then travels through the provider inside the
// signed state), so it is only ever *matched* against the configured list, never trusted as a
// value — anything not configured here falls back to the canonical origin.
export function resolveWebOrigin(value, candidate) {
  const origins = webOrigins(value);
  let candidateOrigin;
  try {
    candidateOrigin = candidate ? new URL(candidate).origin : null;
  } catch {
    candidateOrigin = null; // relative path, or not a URL at all
  }
  return origins.find((o) => o === candidateOrigin) || origins[0] || '';
}

// Where the app is sent after the flow ends. The candidate arrives from a query parameter, so
// this is the guard against turning /api/auth/google/start into an open redirect: resolve it
// against our own origin and keep only the path, so anything absolute, protocol-relative
// (`//evil.example`) or otherwise off-origin collapses to '/'.
export function safeReturnPath(candidate, webOrigin) {
  if (typeof candidate !== 'string' || !candidate) return '/';
  let resolved;
  try {
    resolved = new URL(candidate, webOrigin);
  } catch {
    return '/';
  }
  if (resolved.origin !== new URL(webOrigin).origin) return '/';
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

// Adds the marker AuthContext turns into a visible "sign-in failed" message on the page the user
// lands back on, without clobbering a return path that already carries a query of its own.
export function withAuthError(path) {
  const [beforeHash, hash = ''] = path.split('#');
  const separator = beforeHash.includes('?') ? '&' : '?';
  return `${beforeHash}${separator}auth_error=1${hash ? `#${hash}` : ''}`;
}

export function appUrl(webOrigin, path) {
  return `${webOrigin.replace(/\/+$/, '')}${path}`;
}

// Short-lived, HttpOnly, and SameSite=Lax so it survives the provider's top-level GET redirect
// back to us — which is exactly the navigation Lax permits, and why the redirect flow needs no
// third-party cookie access at all.
export function nonceCookie(nonce, { secure = true } = {}) {
  return `${OAUTH_NONCE_COOKIE}=${nonce}; Max-Age=600; Path=/api/auth; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function clearNonceCookie() {
  return `${OAUTH_NONCE_COOKIE}=; Max-Age=0; Path=/api/auth; HttpOnly; SameSite=Lax`;
}

// --- Google ---------------------------------------------------------------------------------

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Must match a redirect URI registered on the OAuth client in the Google Cloud console, exactly —
// mismatches fail at the provider with redirect_uri_mismatch, before the user ever gets back here.
export function googleRedirectUri(webOrigin) {
  return appUrl(webOrigin, '/api/auth/google/callback');
}

export function googleAuthUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // Show the account chooser rather than silently reusing whichever Google account the browser
    // happens to be signed into — signing in as the wrong person is tedious to undo here, since
    // the account is what the whole local mirror is keyed by.
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

// Exchanges the one-time code for Google's id_token — the same JWT shape verifyGoogleCredential
// (auth.js) validates, so nothing downstream of this step has to know how it arrived.
export async function exchangeGoogleCode({ code, clientId, clientSecret, redirectUri }) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!response.ok) {
    throw new Error(`Google token exchange failed (${response.status}): ${await response.text()}`);
  }
  const { id_token: idToken } = await response.json();
  if (!idToken) throw new Error('Google token response carried no id_token.');
  return idToken;
}
