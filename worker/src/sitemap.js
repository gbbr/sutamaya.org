import { offeredBy, readPath } from './shareMeta.js';

// Returns the sitemap: the landing page where `landingOrigin` is given, Help, and every sutta in
// each translation it offers, at the addresses their pages name as canonical.
export function sitemapXml(corpus, appOrigin, landingOrigin) {
  const urls = [...(landingOrigin ? [`${landingOrigin}/`] : []), `${appOrigin}/help`];
  for (const [docId, sutta] of Object.entries(corpus.suttas)) {
    urls.push(`${appOrigin}${readPath(docId, null)}`);
    for (const by of Object.keys(sutta.by ?? {})) {
      if (offeredBy(sutta, by)) urls.push(`${appOrigin}${readPath(docId, by)}`);
    }
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `<url><loc>${url}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
}
