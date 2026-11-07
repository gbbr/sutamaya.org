import { describe, expect, it } from 'vitest';
import { sitemapXml } from '../sitemap.js';

// One sutta in all three translations, one batched document, and one naming a translator the app
// doesn't offer.
const corpus = {
  nikayas: [],
  suttas: {
    dn16: {
      ref: 'DN 16',
      en: 'The Great Discourse on the Buddha’s Extinguishment',
      blurb: '',
      node: 'dn-mahavagga',
      by: { bodhi: 'https://example.org/bodhi/dn16', thanissaro: 'https://example.org/thanissaro/dn16' },
    },
    'dhp320-333': { ref: 'Dhp 320–333', en: 'The Elephant', blurb: '', node: 'dhp' },
    'sn12.1': { ref: 'SN 12.1', en: 'Dependent Origination', blurb: '', node: 'sn12.1-10', by: { someone: 'https://example.org/sn12.1' } },
  },
};

// The addresses a sitemap lists, in order.
const locs = (xml) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);

describe('sitemapXml', () => {
  it('lists the landing page, Help, and every sutta in each translation it offers', () => {
    expect(locs(sitemapXml(corpus, 'https://app.sutamaya.org', 'https://sutamaya.org'))).toEqual([
      'https://sutamaya.org/',
      'https://app.sutamaya.org/help',
      'https://app.sutamaya.org/read/dn16',
      'https://app.sutamaya.org/read/dn16?by=bodhi',
      'https://app.sutamaya.org/read/dn16?by=thanissaro',
      'https://app.sutamaya.org/read/dhp320-333',
      'https://app.sutamaya.org/read/sn12.1',
    ]);
  });

  it('leaves the landing page out where the hostname has none', () => {
    expect(locs(sitemapXml(corpus, 'https://app.sutamaya.org', null))[0]).toBe('https://app.sutamaya.org/help');
  });

  it('is a sitemap document', () => {
    const xml = sitemapXml(corpus, 'https://app.sutamaya.org', null);
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">\n/);
    expect(xml).toMatch(/<\/urlset>\n$/);
  });
});
