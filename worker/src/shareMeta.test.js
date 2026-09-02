import { describe, expect, it } from 'vitest';
import { applyShareMeta, shareMetaFor } from './shareMeta.js';

// A corpus small enough to read, carrying one of every shape the real one has: MN's two levels,
// SN's four with the description on the saṁyutta rather than the vagga that displays it, AN's
// three with a description nowhere, and both kinds of KN book — one holding its documents directly
// and one splitting them across vaggas.
const corpus = {
  nikayas: [
    {
      id: 'dn',
      label: 'Dīgha Nikāya',
      chapters: [{ id: 'dn-silakkhandhavagga', ref: 'DN1–13', label: 'The Chapter on Morality', blurb: '<p>The first thirteen discourses.</p>' }],
    },
    {
      id: 'an',
      label: 'Aṅguttara Nikāya',
      sub: 'Numbered Discourses',
      chapters: [
        { id: 'an3', ref: 'AN 3', label: 'Book of Threes', chapters: [{ id: 'an3.1-10', ref: 'AN3.1–10', label: 'Fools' }] },
        { id: 'an1', ref: 'AN 1', label: 'Book of Ones', chapters: [{ id: 'an1-cittavagga', ref: 'AN1.1–10', label: 'What Occupies the Mind' }] },
      ],
    },
    {
      id: 'sn',
      label: 'Saṁyutta Nikāya',
      chapters: [
        {
          id: 'sn-nidanavagga',
          label: 'The Book of Causation',
          blurb: 'The second of the five books.',
          chapters: [
            {
              id: 'sn12',
              ref: 'SN 12',
              label: 'Causation',
              blurb: 'Dependent origination,   the process by which\nsuffering  arises.',
              chapters: [{ id: 'sn12.1-10', ref: 'SN12.1–10', label: 'The Buddhas' }],
            },
          ],
        },
      ],
    },
    {
      id: 'kn',
      label: 'Khuddaka Nikāya',
      chapters: [
        { id: 'dhp', ref: 'Dhp', label: 'Sayings of Dhamma' },
        { id: 'ud', ref: 'Ud', label: 'Heartfelt Sayings', chapters: [{ id: 'ud-bodhivagga', ref: 'Ud1.1–10', label: 'Awakening', blurb: 'Ten sayings from the weeks after the awakening.' }] },
      ],
    },
  ],
  suttas: {
    dn16: { ref: 'DN 16', en: 'The Great Discourse on the Buddha’s Extinguishment', blurb: 'The Buddha’s last days.', node: 'dn-silakkhandhavagga' },
    'dhp320-333': { ref: 'Dhp 320–333', en: 'The Elephant', blurb: '', node: 'dhp' },
    'sn12.1': { ref: 'SN 12.1', en: 'Dependent Origination', blurb: '', node: 'sn12.1-10' },
    'ud1.1': { ref: 'Ud 1.1', en: 'Upon Awakening (1st)', blurb: '', node: 'ud-bodhivagga' },
    'an1.1-10': { ref: 'AN1.1–10', en: 'What Occupies the Mind', blurb: '', node: 'an1-cittavagga' },
    'an3.3': { ref: 'AN 3.3', en: 'Deeds', blurb: '', node: 'an3.1-10' },
  },
};

describe('shareMetaFor', () => {
  it('describes a sutta with its reference, title and blurb', () => {
    expect(shareMetaFor(corpus, '/read/dn16')).toEqual({
      title: 'DN 16 · The Great Discourse on the Buddha’s Extinguishment',
      description: 'The Buddha’s last days.',
    });
  });

  // Every reference the app displays is capitalized, so a link copied from what someone is reading
  // arrives that way and has to resolve to the same document.
  it('folds the case of an id shared from the address bar', () => {
    expect(shareMetaFor(corpus, '/read/DN16')?.title).toBe(shareMetaFor(corpus, '/read/dn16')?.title);
  });

  // "/read/dhp321" is a link the app itself produces; the verse has no entry of its own.
  it('resolves a verse inside a batched document to the batch', () => {
    expect(shareMetaFor(corpus, '/read/dhp321')?.title).toBe('Dhp 320–333 · The Elephant');
  });

  // Most of the canon has no description written for it, and where the title is a name — a monk,
  // a place — the collection it comes from is the one useful thing left to say.
  it('falls back to where an undescribed sutta sits in the canon', () => {
    expect(shareMetaFor(corpus, '/read/dhp321')?.description).toBe('Khuddaka Nikāya · Sayings of Dhamma');
  });

  it('falls back to the collection above an undescribed group', () => {
    expect(shareMetaFor(corpus, '/browse/an3.1-10')).toEqual({
      title: 'AN3.1–10 · Fools',
      description: 'Aṅguttara Nikāya · Book of Threes',
    });
  });

  // SN is the only collection deep enough for the choice to matter: the saṁyutta is described and
  // the vagga under it is not, so naming the described level says "Causation" rather than the
  // vagga's own opaque label.
  it('picks the closest described level rather than the deepest one', () => {
    expect(shareMetaFor(corpus, '/read/sn12.1')?.description).toBe('Saṁyutta Nikāya · Causation');
  });

  // AN is described at no level at all, so there is no described level to prefer and the group
  // actually holding the document is the nearest thing to say.
  it('names the enclosing group when nothing above it is described', () => {
    expect(shareMetaFor(corpus, '/read/an3.3')?.description).toBe('Aṅguttara Nikāya · Fools');
  });

  // 37 of AN's documents are named after the very vagga holding them, which would otherwise put
  // the same words on both lines of the card.
  it('skips a level whose name the title already carries', () => {
    expect(shareMetaFor(corpus, '/read/an1.1-10')).toEqual({
      title: 'AN1.1–10 · What Occupies the Mind',
      description: 'Aṅguttara Nikāya · Book of Ones',
    });
  });

  // A KN book that holds its documents directly is the only level between them and the collection.
  it('names the book a KN document sits in', () => {
    expect(shareMetaFor(corpus, '/read/dhp320-333')?.description).toBe('Khuddaka Nikāya · Sayings of Dhamma');
  });

  // The other kind of KN book splits its documents across vaggas, and those are described, so the
  // vagga is the level named rather than the book above it.
  it('names a described vagga over the book holding it', () => {
    expect(shareMetaFor(corpus, '/read/ud1.1')?.description).toBe('Khuddaka Nikāya · Awakening');
  });

  // A book sitting directly under its collection has nothing between the two to name.
  it('names the collection alone for a group directly beneath it', () => {
    expect(shareMetaFor(corpus, '/browse/dhp')?.description).toBe('Khuddaka Nikāya');
  });

  it('leaves an unknown sutta id alone', () => {
    expect(shareMetaFor(corpus, '/read/not-a-sutta')).toBeNull();
  });

  it('describes a group from its own blurb, flattened and collapsed', () => {
    expect(shareMetaFor(corpus, '/browse/dn-silakkhandhavagga')).toEqual({
      title: 'DN1–13 · The Chapter on Morality',
      description: 'The first thirteen discourses.',
    });
  });

  // SN writes its descriptions on the saṁyutta, and the page borrows one down to the vaggas under
  // a label saying where it came from. A card has no such label, so it says where the group sits
  // rather than passing off the saṁyutta's paragraph as a description of these ten discourses.
  it('does not borrow an ancestor’s blurb for a group that has none', () => {
    expect(shareMetaFor(corpus, '/browse/sn12.1-10')).toEqual({
      title: 'SN12.1–10 · The Buddhas',
      description: 'Saṁyutta Nikāya · Causation',
    });
  });

  // A collection has nothing above it to name, and its title is Pali, so its English name is the
  // one thing left to say. It has no reference either.
  it('describes a collection by its English name', () => {
    expect(shareMetaFor(corpus, '/browse/an')).toEqual({ title: 'Aṅguttara Nikāya', description: 'Numbered Discourses' });
  });

  // A browse URL may carry the selected sutta as a second segment; the page describes the group.
  it('describes the group when a sutta rides along in the path', () => {
    expect(shareMetaFor(corpus, '/browse/sn12.1-10/sn12.1')).toEqual(shareMetaFor(corpus, '/browse/sn12.1-10'));
  });

  // A list id is opaque, names nothing in the corpus, and belongs to one reader.
  it('says nothing about a user list', () => {
    expect(shareMetaFor(corpus, '/browse/l-7f3a91c2')).toBeNull();
  });

  it('says nothing for a page with no subject of its own', () => {
    expect(shareMetaFor(corpus, '/settings')).toBeNull();
    expect(shareMetaFor(corpus, '/index.html')).toBeNull();
    expect(shareMetaFor(corpus, '/browse')).toBeNull();
  });

  // The corpus is fetched from the assets binding and may not answer during a deploy.
  it('says nothing when the corpus is unavailable', () => {
    expect(shareMetaFor(null, '/read/dn16')).toBeNull();
  });

  it('cuts a long blurb at a word boundary', () => {
    const long = { ...corpus, suttas: { x1: { ref: 'X 1', en: 'Long', blurb: `${'word '.repeat(60)}end` } } };
    const { description } = shareMetaFor(long, '/read/x1');
    expect(description.length).toBeLessThanOrEqual(156);
    expect(description).toMatch(/word…$/);
  });
});

const SHELL = '<!doctype html><html><head><title>sutamaya</title><meta name="description" content="the app" /></head><body></body></html>';

const rendered = (meta) =>
  applyShareMeta(
    new Response(SHELL, { headers: { 'Content-Type': 'text/html' } }),
    meta,
    new URL('https://app.sutamaya.org/read/dn16')
  ).text();

describe('applyShareMeta', () => {
  it('replaces the title and the description, and adds the preview tags', async () => {
    const html = await rendered({ title: 'DN 16 · The Great Discourse', description: 'The Buddha’s last days.' });
    expect(html).toContain('<title>DN 16 · The Great Discourse</title>');
    expect(html).toContain('<meta name="description" content="The Buddha’s last days." />');
    expect(html).toContain('<meta property="og:title" content="DN 16 · The Great Discourse" />');
    expect(html).toContain('<meta property="og:description" content="The Buddha’s last days." />');
    expect(html).toContain('<meta property="og:url" content="https://app.sutamaya.org/read/dn16" />');
    expect(html).toContain('<meta name="twitter:card" content="summary" />');
  });

  // Small and square is what makes the leaf a thumbnail beside the title rather than a banner
  // across the top of the card, so the declared size matters as much as the file.
  it('points at the leaf mark at thumbnail size', async () => {
    const html = await rendered({ title: 'DN 16 · The Great Discourse', description: null });
    expect(html).toContain('<meta property="og:image" content="https://app.sutamaya.org/share-card.png" />');
    expect(html).toContain('<meta property="og:image:width" content="256" />');
    expect(html).toContain('<meta property="og:image:height" content="256" />');
  });

  // The card shows the title alone rather than the app's boilerplate, which means the shell's own
  // description has to go — leaving it is what makes every group in AN preview identically.
  it('removes the description entirely when the page has none', async () => {
    const html = await rendered({ title: 'AN3.1–10 · Fools', description: null });
    expect(html).toContain('<title>AN3.1–10 · Fools</title>');
    expect(html).not.toContain('name="description"');
    expect(html).not.toContain('og:description');
  });

  it('escapes a title that would otherwise close its own attribute', async () => {
    const html = await rendered({ title: 'Mendicants & "Friends"', description: null });
    expect(html).toContain('<meta property="og:title" content="Mendicants &amp; &quot;Friends&quot;" />');
  });
});
