import { Router } from 'express';
import { userDoc } from '../firestore.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../asyncHandler.js';

export const prefsRouter = Router();
prefsRouter.use(requireAuth);

// A signed-in user's reader/UI settings, so they follow the account across devices instead of
// living only in this browser's localStorage (see ReaderPrefsContext/UiPrefsContext, which stay
// the source of truth locally and push here on change, then pull back down on sign-in — see
// useProfileSyncedPrefs). Stored as two independent slots under `users/{uid}.prefs` (dot-path
// `.update()`, not a full-document overwrite) so saving one never clobbers the other, and either
// can be omitted from a given request.
prefsRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const { reader, ui } = req.body || {};
    const update = {};
    if (reader && typeof reader === 'object') update['prefs.reader'] = reader;
    if (ui && typeof ui === 'object') update['prefs.ui'] = ui;
    if (Object.keys(update).length) await userDoc(req.user.id).update(update);
    res.json({ ok: true });
  })
);
