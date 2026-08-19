-- Sign-in by emailed verification code, alongside Google.
--
-- Additive only, like every migration here (see docs/deploy.md): migrations run before the new
-- Worker is uploaded, so the previous one keeps serving against this schema for a moment.

-- One row per way of proving you are a given user: ('google', <sub>) or ('email', <address>).
-- This is the authoritative record from here on. `users.google_id` stays because dropping a
-- NOT NULL column would need a destructive table rebuild; for accounts created by any other
-- provider it holds an opaque placeholder that means nothing (see placeholderGoogleId in
-- worker/src/auth.js) — read identities, not that column.
CREATE TABLE identities (
  provider    TEXT NOT NULL,          -- 'google' | 'email'
  subject     TEXT NOT NULL,          -- the provider's own id: Google's `sub`, or the address
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
);

INSERT INTO identities (provider, subject, user_id, created_at)
  SELECT 'google', google_id, id, created_at FROM users;

CREATE INDEX identities_user ON identities(user_id);

-- Accounts are linked on a verified email address — signing in by code to the address a Google
-- account already uses lands on that same account rather than forking a second one. That rule
-- only holds if an address maps to at most one user, so it is enforced here rather than in code.
CREATE UNIQUE INDEX users_email_unique ON users(email);

-- Pending verification codes, one per address at a time: requesting a new code replaces whatever
-- was outstanding, so an old code can never be used after a new one is asked for. Only the hash
-- is stored (HMAC-SHA256 under SESSION_SECRET), so the table is worthless to anyone reading it.
-- `attempts` is what actually stops a six-digit code being guessed — the row is spent after
-- MAX_CODE_ATTEMPTS wrong tries, long before a million guesses are possible.
CREATE TABLE login_codes (
  email       TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,          -- ISO 8601
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
