// Firestore calls are all async; this catches rejections from route handlers and forwards
// them to Express's error middleware instead of letting them hang as unhandled rejections.
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
