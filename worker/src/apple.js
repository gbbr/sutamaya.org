// Sign in with Apple: the website's redirect flow, the iOS sheet's authorization code, and the
// token revocation Apple requires when an account is deleted. See docs/backend.md's "Sign-in".
import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify } from 'jose';
import { appUrl } from './oauth.js';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_AUTH_URL = 'https://appleid.apple.com/auth/authorize';
const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';

// Apple's public keys, cached for the life of the isolate and re-fetched only on an unseen key id.
const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

// The client ids the iOS sheet's codes are issued to: the app's bundle id, first, and that of the
// development copy `npm run dev:ios` installs on a phone.
export const APPLE_APP_CLIENT_IDS = ['org.sutamaya.app', 'org.sutamaya.app.dev'];

// Returns whether every setting Apple sign-in needs is present.
export function appleConfigured(env) {
  return Boolean(env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY && env.APPLE_SERVICES_ID && env.SESSION_SECRET);
}

// Returns the callback URL Apple posts back to, which must match one registered on the Services ID.
export function appleRedirectUri(webOrigin) {
  return appUrl(webOrigin, '/api/auth/apple/callback');
}

// Returns the URL that starts the website flow at Apple. Asking for the name or email makes Apple
// answer with a form POST rather than a redirect.
export function appleAuthUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    response_mode: 'form_post',
    scope: 'name email',
    state,
  });
  return `${APPLE_AUTH_URL}?${params}`;
}

// Returns the short-lived client secret Apple takes in place of a password: a JWT signed with the
// Sign in with Apple key, naming the client it speaks for.
async function clientSecret(env, clientId) {
  // `.dev.vars` holds the key on one line, with its line breaks written as `\n`.
  const key = await importPKCS8(env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'), 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: env.APPLE_KEY_ID })
    .setIssuer(env.APPLE_TEAM_ID)
    .setSubject(clientId)
    .setAudience(APPLE_ISSUER)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

// Exchanges a one-time authorization code for Apple's id_token and refresh token. `redirectUri` is
// the website flow's and is left out for the iOS sheet's code. Throws if the exchange fails.
export async function exchangeAppleCode(env, { code, clientId, redirectUri }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: await clientSecret(env, clientId),
    code,
    grant_type: 'authorization_code',
  });
  if (redirectUri) body.set('redirect_uri', redirectUri);
  const response = await fetch(APPLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new Error(`Apple token exchange failed (${response.status}): ${await response.text()}`);
  const { id_token: idToken, refresh_token: refreshToken } = await response.json();
  if (!idToken) throw new Error('Apple token response carried no id_token.');
  return { idToken, refreshToken: refreshToken || null };
}

// Verifies an Apple id_token issued to `clientId` and returns the Apple ID's subject and address.
// Throws if it doesn't verify or the address is unconfirmed.
export async function verifyAppleIdToken(idToken, clientId) {
  const { payload } = await jwtVerify(idToken, APPLE_JWKS, { issuer: APPLE_ISSUER, audience: clientId });
  // Apple sends the flag as a string or a boolean.
  if (payload.email && String(payload.email_verified) !== 'true') throw new Error('Apple ID email is not verified.');
  return { appleId: payload.sub, email: payload.email || null };
}

// Revokes a refresh token, ending the app's access to the Apple ID. Throws if Apple refuses.
export async function revokeAppleToken(env, { clientId, refreshToken }) {
  const response = await fetch(APPLE_REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: await clientSecret(env, clientId),
      token: refreshToken,
      token_type_hint: 'refresh_token',
    }),
  });
  if (!response.ok) throw new Error(`Apple token revocation failed (${response.status}): ${await response.text()}`);
}

// Returns a display name from the given and family names Apple shares on the first sign-in, or null.
export function appleDisplayName(givenName, familyName) {
  const name = [givenName, familyName]
    .filter((part) => typeof part === 'string')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
  return name || null;
}
