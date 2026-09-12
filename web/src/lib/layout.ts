// The one measurement both layouts are decided from, here rather than in LayoutContext so the
// modules without React can read it too.

// Viewport width below which the app is in its mobile layout: one pane at a time, and a stack of
// screens rather than panes side by side.
export const MOBILE_BREAKPOINT = 860;

// Where a screen's first row sits on a phone: below the safe-area line rather than on it, which a
// native top bar can afford but these headers can't, their first element being a large title. The
// line the library's tree, Settings and Help all start on.
//
// A floor rather than a sum, so the air comes from whichever is larger: a device with a notch
// already clears the status bar and needs only the original 10px above it, while a browser with no
// inset at all would otherwise put the header against the window's edge.
export const MOBILE_TOP_INSET = 'max(15px, calc(10px + var(--safe-top)))';
