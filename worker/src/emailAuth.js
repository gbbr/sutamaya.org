// Sign-in by a six-digit code emailed to the user: the code is typed into the page it was asked
// for from, so the session is established from inside the installed PWA rather than in whichever
// browser a link would have opened.

// How long a code stays valid.
export const CODE_TTL_MS = 10 * 60 * 1000;
// Wrong guesses before the code is spent.
export const MAX_CODE_ATTEMPTS = 5;
// How long after a send a resend is answered without sending again.
export const RESEND_COOLDOWN_MS = 30 * 1000;

const encoder = new TextEncoder();

// The shape an address must have to be worth a send. Permissive by design; only a delivered code
// settles whether the address is real.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

// Lowercases and trims a submitted address, or returns '' for anything that isn't a string.
export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// Reports whether an address is worth sending a code to.
export function isPlausibleEmail(value) {
  return value.length <= 254 && EMAIL_SHAPE.test(value);
}

// Returns a six-digit code, uniform over 000000-999999 by rejection sampling.
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

// Returns the stored hex digest for a code, bound to the address it was sent to.
export async function hashCode(code, email, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${email}:${code}`));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Compares two hex digests in time independent of where they differ.
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Returns the sign-in email's subject and both bodies. The code leads the subject line, so a phone
// shows it in the notification.
export function codeEmail({ code }) {
  const minutes = Math.round(CODE_TTL_MS / 60000);
  return {
    subject: `${code} is your sutamaya sign-in code`,
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

// Sends one message through Resend, throwing if it is rejected.
export async function sendEmail({ apiKey, from, to, message }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    // Both bodies: some clients render only the plain one, and its absence reads as spam.
    body: JSON.stringify({ from, to: [to], subject: message.subject, text: message.text, html: message.html }),
  });
  if (!response.ok) {
    throw new Error(`Resend rejected the message (${response.status}): ${await response.text()}`);
  }
}
