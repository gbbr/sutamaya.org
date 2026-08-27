// Every localStorage key this app persists to, in one place, so nothing silently reuses one.
export const TREE_VIEW_KEY = 'sutamaya.treeView';
export const LIBRARY_VIEW_KEY = 'sutamaya.libraryView';
export const TREE_EXPANDED_KEY = 'sutamaya.treeExpanded';
export const SCROLL_POSITIONS_KEY = 'sutamaya.scrollPositions';
export const LAST_LOCATION_KEY = 'sutamaya.lastLocation';
export const READER_ORIGIN_KEY = 'sutamaya.readerOrigin';
export const ROUTE_INTENT_KEY = 'sutamaya.routeIntent';
export const UI_PREFS_KEY = 'sutamaya.uiPrefs';
export const READER_PREFS_KEY = 'sutamaya.readerPrefs';
// The reader menu panel's last-used tab, so it reopens where the reader left off (see
// lib/readerPanelTab.ts).
export const READER_PANEL_TAB_KEY = 'sutamaya.readerPanelTab';
export const LAYOUT_PREFS_KEY = 'sutamaya.layout';
export const HAS_OPENED_SUTTA_KEY = 'sutamaya.hasOpenedSutta';
export const OFFLINE_NUDGE_DISMISSED_KEY = 'sutamaya.offlineNudgeDismissed';
// The corpus dataVersion/dictionaryVersion this device last completed a full offline download at
// (see lib/offline.ts) — compared against the live corpus to spot a stale offline copy.
export const OFFLINE_DATA_VERSION_KEY = 'sutamaya.offlineDataVersion';
export const OFFLINE_DICTIONARY_VERSION_KEY = 'sutamaya.offlineDictionaryVersion';
// The dataVersion whose "updated text available" nudge was dismissed. Stores the version rather
// than a boolean, so dismissing one update doesn't silence every later one.
export const OFFLINE_UPDATE_DISMISSED_KEY = 'sutamaya.offlineUpdateDismissed';
// This device's own id — the tiebreak half of every mtime this client stamps (see lib/mtime.ts).
export const DEVICE_ID_KEY = 'sutamaya.deviceId';
// The last signed-in user, so a cold start with no network still knows whose mirror to open
// (see lib/lastUser.ts).
export const LAST_USER_KEY = 'sutamaya.lastUser';
// The id a signed-out user's lists, notes and highlights are filed under (see lib/localAccount.ts),
// kept until a sign-in adopts it or a sign-out retires it.
export const LOCAL_USER_KEY = 'sutamaya.localUserId';
// The local user id whose "sign in to keep this safe" banner was dismissed. Stores the id rather
// than a boolean, so signing out — which mints a fresh local id — offers the prompt again.
export const KEEP_SAFE_DISMISSED_KEY = 'sutamaya.keepSafeDismissed';
