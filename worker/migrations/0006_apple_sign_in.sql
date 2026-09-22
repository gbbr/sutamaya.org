-- Sign in with Apple, alongside Google and the emailed code.

-- The Apple refresh token behind an ('apple', <sub>) identity, and the client it was issued to —
-- the app's bundle id for the iOS sheet, the Services ID for the website. Deleting the account
-- revokes it with that same client (docs/backend.md's "Deleting an account"). Null for every other
-- provider.
ALTER TABLE identities ADD COLUMN client_id TEXT;
ALTER TABLE identities ADD COLUMN refresh_token TEXT;
