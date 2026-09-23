// staleBundles returns the keys of the bundle zips a release can delete: all but the `keep` newest,
// never `live`. It returns none when `live` is missing from `objects`, since a listing without the
// bundle just published is not one to delete by.
//   objects – the bucket's listing, each with `key` and an ISO `last_modified`
//   live    – the key of the bundle the Worker now serves
export function staleBundles(objects, live, keep) {
  if (!objects.some((o) => o.key === live)) return [];
  return objects
    .filter((o) => o.key !== live)
    .sort((a, b) => (a.last_modified < b.last_modified ? 1 : -1))
    .slice(keep - 1)
    .map((o) => o.key);
}
