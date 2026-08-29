// Sign-in by a six-digit code emailed to the user — the provider-less option, and the one that
// works everywhere the others don't.
//
// A code rather than a magic link, deliberately. A link is opened from the mail client, which on
// iOS means Safari rather than the installed PWA: the session cookie would land in the browser's
// cookie jar while the app the user actually opens stays signed out, with nothing on screen to
// explain why. A code never leaves the app — the user reads six digits in their mail client and
// types them into the page they started on, so the session is established by a fetch from inside
// the PWA and lands where it belongs by construction.

export const CODE_TTL_MS = 10 * 60 * 1000;
// Wrong guesses before the code is spent. Six digits is a million combinations, so this is what
// makes guessing hopeless; the short TTL alone would not.
export const MAX_CODE_ATTEMPTS = 5;
// A resend inside this window returns success without sending again, so the button can't be used
// to send someone a stream of mail.
export const RESEND_COOLDOWN_MS = 30 * 1000;

const encoder = new TextEncoder();

// Deliberately permissive: this only has to reject obvious nonsense before we spend a send on it.
// Whether the address exists is settled by whether the code ever comes back.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isPlausibleEmail(value) {
  return value.length <= 254 && EMAIL_SHAPE.test(value);
}

// Uniform over 000000-999999. Rejection sampling rather than a modulo of a random 32-bit value:
// the bias there is tiny but there's no reason to accept any in the one number guarding an
// account.
export function generateCode() {
  const buffer = new Uint32Array(1);
  const limit = Math.floor(0xffffffff / 1_000_000) * 1_000_000;
  let value;
  do {
    crypto.getRandomValues(buffer);
    [value] = buffer;
  } while (value >= limit);
  return String(value % 1_000_000).padStart(6, '0');
}

// Bound to the address as well as the code, so a hash can't be replayed against a different one.
export async function hashCode(code, email, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${email}:${code}`));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Length-independent comparison of two hex digests. They're the same length in every real call,
// so this is belt and braces, but a hash comparison that leaks timing is not worth keeping around
// to reason about later.
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function codeEmail({ code }) {
  const minutes = Math.round(CODE_TTL_MS / 60000);
  return {
    subject: `${code} is your sutamaya sign-in code`,
    // The code is in the subject line as well as the body: on a phone that often means it can be
    // read straight from the notification, without leaving the app at all.
    text: [
      `Your sutamaya sign-in code is ${code}.`,
      '',
      `Enter it in the app to finish signing in. It expires in ${minutes} minutes.`,
      '',
      "If you didn't ask to sign in, you can ignore this — nothing has happened to your account.",
    ].join('\n'),
    html: [
      '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#222">',
      '<p>Your sutamaya sign-in code is:</p>',
      `<p style="font-size:30px;letter-spacing:.18em;font-weight:600;margin:20px 0">${code}</p>`,
      `<p>Enter it in the app to finish signing in. It expires in ${minutes} minutes.</p>`,
      '<p style="color:#666;font-size:13px">If you didn’t ask to sign in, you can ignore this —',
      ' nothing has happened to your account.</p>',
      '</div>',
    ].join(''),
  };
}

// Sent through Resend rather than Cloudflare's own Email Sending binding, which needs a Workers
// Paid plan; Resend's free tier covers this app's volume many times over. It's a plain REST call,
// so there's no SDK and nothing to mock beyond fetch.
export async function sendEmail({ apiKey, from, to, message }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    // `text` alongside `html` isn't optional politeness: some clients only render the plain part,
    // and its absence reads as a spam signal.
    body: JSON.stringify({ from, to: [to], subject: message.subject, text: message.text, html: message.html }),
  });
  if (!response.ok) {
    throw new Error(`Resend rejected the message (${response.status}): ${await response.text()}`);
  }
}
