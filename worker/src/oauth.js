// The OAuth 2.0 authorization-code flow: the browser leaves for the provider and comes back to
// /api/auth/{provider}/callback with a code, which the Worker exchanges for an id_token
// server-side. Everything here is provider-agnostic except the Google constants at the bottom, so
// a second provider is a start/callback pair plus its own URLs and profile mapping.
//
// Two things guard the round trip:
//   state – signed with SESSION_SECRET, so a callback can only carry a state this Worker issued
//   nonce – inside that state and also set as a cookie, so only the browser it was issued to can
//           redeem it

// How long a signed state stays redeemable.
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

// The cookie holding the in-flight state's nonce.
export const OAUTH_NONCE_COOKIE = 'sutamaya_oauth';

const encoder = new TextEncoder();

// Encodes bytes as base64url.
function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Decodes a base64url string to bytes.
function fromBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

// Imports the secret as an HMAC-SHA-256 key.
function hmacKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

// Returns the payload signed as `${base64url(json)}.${base64url(hmac)}`. It travels through the
// provider in plain sight, so it carries only a nonce, a return path, an origin and a timestamp.
export async function signState(payload, secret) {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

// Returns a state's payload, or null if it was tampered with, forged, malformed or is older than
// STATE_MAX_AGE_MS.
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

// Parses WEB_ORIGIN's comma-separated list into trimmed origins. The first is the canonical one.
export function webOrigins(value) {
  return String(value || '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

// Returns the origin a redirect should be built on: `candidate` if WEB_ORIGIN lists it, else the
// canonical one. The candidate is only ever matched against the list, never trusted as a value.
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

// Returns the path to send the app to after the flow, as a same-origin path only: anything
// absolute, protocol-relative or off-origin collapses to '/', the app's own entry point.
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

// Adds `auth_error=1` to a return path, keeping any query and hash it already carries. AuthContext
// turns it into a visible "sign-in failed" message.
export function withAuthError(path) {
  const [beforeHash, hash = ''] = path.split('#');
  const separator = beforeHash.includes('?') ? '&' : '?';
  return `${beforeHash}${separator}auth_error=1${hash ? `#${hash}` : ''}`;
}

// Joins an origin and a path into an absolute URL.
export function appUrl(webOrigin, path) {
  return `${webOrigin.replace(/\/+$/, '')}${path}`;
}

// Returns the Set-Cookie for the state's nonce: short-lived, HttpOnly, and SameSite=Lax, which the
// provider's top-level redirect back here still carries.
export function nonceCookie(nonce, { secure = true } = {}) {
  return `${OAUTH_NONCE_COOKIE}=${nonce}; Max-Age=600; Path=/api/auth; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

// Returns the Set-Cookie that expires the nonce cookie.
export function clearNonceCookie() {
  return `${OAUTH_NONCE_COOKIE}=; Max-Age=0; Path=/api/auth; HttpOnly; SameSite=Lax`;
}

// --- Google ---------------------------------------------------------------------------------

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Returns the callback URL Google redirects back to, which must match one registered on the OAuth
// client exactly.
export function googleRedirectUri(webOrigin) {
  return appUrl(webOrigin, '/api/auth/google/callback');
}

// Returns the URL that starts the flow at Google.
export function googleAuthUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // Always show the account chooser rather than reusing the browser's signed-in account.
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

// Exchanges the one-time code for Google's id_token, which verifyGoogleCredential (auth.js) then
// validates. Throws if the exchange fails or returns no token.
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
