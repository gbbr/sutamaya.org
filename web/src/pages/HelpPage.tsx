import { useEffect, useRef } from 'react';
import { navigate, type RouteComponentProps } from '@reach/router';
import { ArrowLeft, ArrowUp, ExternalLink, Lightbulb, Mail } from 'lucide-react';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { isTypingTarget } from '../lib/shortcuts';
import dictionaryShot from '../assets/help/dictionary-mobile.webp';
import libraryShot from '../assets/help/library-mobile.webp';
import libraryItemsShot from '../assets/help/library-items-mobile.webp';
import listsShot from '../assets/help/lists-mobile.webp';
import listsItemsShot from '../assets/help/lists-items-mobile.webp';
import listsTabShot from '../assets/help/lists-tab-mobile.webp';
import readerChipsShot from '../assets/help/reader-chips-mobile.webp';
import markupShot from '../assets/help/markup-mobile.webp';
import highlightsTabShot from '../assets/help/highlights-tab-mobile.webp';
import offlineShot from '../assets/help/offline-mobile.webp';
import offlineSignedInShot from '../assets/help/offline-signed-in-mobile.webp';
import readerShot from '../assets/help/reader-mobile.webp';

// A single scrolling page of annotated screenshots: one section per thing the app does, each a
// column of picture plus the numbered legend for its own markers. Captures are phone-width at
// every viewport, markers number continuously across a section's columns, and every marker is DOM
// positioned over the `<img>` rather than painted into it.
//
// ---------------------------------------------------------------------------------------------
// ADDING OR REPLACING A SCREENSHOT
//
// 1. Capture. Chrome DevTools (`Cmd+Option+I`) → device toolbar (`Cmd+Shift+M`) → set the viewport
//    to exactly **390×844** → `Cmd+Shift+P` → "Capture screenshot", for a 780×1688 PNG at 2× DPR.
// 2. Convert. `cwebp -q 82 shot.png -o shot.webp` (`brew install webp`); `-q 90` if small type
//    shows fringing.
// 3. Place. Drop it in `web/src/assets/help/` and `import` it at the top of this file, so Vite
//    content-hashes it. PNG or WebP, never SVG, which vite.config.ts precaches.
// 4. Mark it up. In a dev build, clicking a shot prints the `[x, y]` pair to paste into its
//    `marks` — see logMarkOnClick below. Add one `steps` line per marker.
//
// A shot with no `src` yet renders as a labelled slot naming the file it is waiting for.
// ---------------------------------------------------------------------------------------------

interface HelpShot {
  // The imported image URL. Undefined until the screenshot exists.
  src?: string;
  // Filename to capture. Also this column's key, and what the empty slot displays.
  name: string;
  // Names this column when a section has more than one.
  title: string;
  // One [x%, y%] marker per `steps` line, measured from this image's own top-left.
  marks: Array<[number, number]>;
  // What each of this column's markers points at, in order. Every line must name something visible
  // in this shot; anything else belongs in the section's `tips`.
  steps: string[];
}

interface HelpSection {
  title: string;
  // A one-line orientation before the pictures.
  lead: string;
  shots: HelpShot[];
  // The things a marker can't point at — a shortcut, a gesture, a consequence after the fact —
  // one paragraph each, rendered as one tinted card. `*asterisks*` emphasise a run (withEmphasis).
  tips?: string[];
}

const SECTIONS: HelpSection[] = [
  {
    title: 'Library',
    lead: 'The library lists the five collections and the chapters within them. ' +
      'Open one to see its books, then its suttas.',
    shots: [
      {
        src: libraryShot,
        name: 'library-mobile.webp',
        title: 'The library',
        marks: [
          [81.5, 30.3],
          [44.0, 11.6],
          [56.7, 2.1],
          [69.8, 2.1],
          [82.4, 2.1],
        ],
        steps: [
          'Tap any node to see its contents.',
          'Switch between the Canon and your own Lists.',
          'Display this help page',
          'Search by number, title, summary, your own notes or list names.',
          'Your account, and every setting.',
        ],
      },
      {
        src: libraryItemsShot,
        name: 'library-items-mobile.webp',
        title: 'Inside a book',
        marks: [
          [4.4, 2.6],
          [86.9, 15.3],
          [60.2, 35.0],
          [85.0, 32.6],
        ],
        steps: [
          'Go back.',
          'Information about this collection.',
          'Click a sutta to open it.',
          'Add this sutta to a list.',
        ],
      },
    ],
    tips: ['On a keyboard, press ? to see a full list of shortcuts.'],
  },
  {
    title: 'Reading',
    lead: 'Tap a sutta to read it full screen. Pali is a tap away, and the menu holds everything else — how the page looks, what you have marked, and the lists it belongs to.',
    shots: [
      {
        src: dictionaryShot,
        name: 'dictionary-mobile.webp',
        title: 'Looking up a Pali word',
        marks: [
          [39.4, 15.3],
          [71.4, 26.6],
          [78.1, 53.1],
          [39.1, 3.0],
        ],
        steps: [
          'Tap any text segment to see the Pali underneath it.',
          'Tap any Pali word to open the dictionary.',
          'Navigate back and forth through the words in the sentence or close the dictionary.',
          'Tap the top bar to scroll all the way up.',
        ],
      },
      {
        src: readerShot,
        name: 'reader-mobile.webp',
        title: 'The menu',
        marks: [
          [11.9, 5.2],
          [87.7, 5.2],
          [19.0, 38.9],
          [45.6, 38.9],
          [70.9, 38.9],
        ],
        steps: [
          'Close the Reader.',
          'Open the panel.',
          'Your Highlights & Notes.',
          'List management.',
          'Theme, type size and typeface.',
        ],
      },
    ],
    tips: [
      'On a keyboard, press ? for the full list of shortcuts.',
      'Pressing / in the reader reveals a search bar, so you can jump straight to another sutta.',
    ],
  },
  {
    title: 'Highlights & Notes',
    lead: 'Select any passage to colour it. Each sutta also holds one note of your own. The note ' +
      'is displayed in the Library view and is searchable.',
    shots: [
      {
        src: markupShot,
        name: 'markup-mobile.webp',
        title: 'Marking a passage',
        marks: [
          [4.7, 38.0],
          [75.7, 43.0],
          [52.1, 91.6],
          [90.2, 39.5],
        ],
        steps: [
          'Your note shows up after the sutta summary. Click it to edit it.',
          'Highlight count. Clicking it takes you to the Highlights tab in the menu panel.',
          'Select text and choose a colour to highlight it.',
          'Highlights show up on the right edge. Clicking the small mark takes you there.',
        ],
      },
      {
        src: highlightsTabShot,
        name: 'highlights-tab-mobile.webp',
        title: 'Highlights Tab',
        marks: [
          [29.5, 11.3],
          [38.9, 28.9],
          [86.0, 25.0],
        ],
        steps: [
          'Add or change your note.',
          'Tap a highlight to scroll to it in the Reader. Tap the bin on the right to remove it.',
          'Delete the highlight.',
        ],
      },
    ],
    tips: ['Every highlight is also marked down the reader’s right edge — tap a mark to jump there.'],
  },
  {
    title: 'Lists',
    lead: 'Save suttas into lists of your own, and group those lists into folders.',
    shots: [
      {
        src: listsShot,
        name: 'lists-mobile.webp',
        title: 'Your lists',
        marks: [
          [77.9, 16.6],
          [89.3, 16.6],
          [88.5, 26.0],
          [94.0, 38.8],
        ],
        steps: [
          'Re-order your lists and groups. You may drag lists or groups into other groups to nest them.',
          'Create a new list or group. Displays the text input below it.',
          'Choose between creating a list or a group.',
          'Show controls for renaming, deleting or moving that line.',
        ],
      },
      {
        src: listsItemsShot,
        name: 'lists-items-mobile.webp',
        title: 'Inside a list',
        marks: [
          [82.6, 4.7],
          [91.5, 29.6],
        ],
        steps: [
          'Toggle the re-ordering of suttas within a list. Sort them by your own criteria.',
          'Drag the handle to move a sutta to a different position.',
        ],
      },
    ],
    tips: [
      'Dropping a list at the end of a group moves it outside. To put a list last in its group, ' +
        'drag it onto that same group.',
    ],
  },
  {
    title: 'Lists while reading',
    lead: 'A sutta shows the lists it already belongs to, and can be added to more without leaving the page.',
    shots: [
      {
        src: readerChipsShot,
        name: 'reader-chips-mobile.webp',
        title: 'Where it already is',
        marks: [
          [33.1, 12.6],
          [62.7, 54.8],
          [34.4, 64.7],
        ],
        steps: [
          'The current list you are in. Navigating back and forth between suttas will be within this list (see tip below).',
          'Lists show up as chips under the sutta. They follow the same order you give them in the tree.',
          'Click the "+" sign to open the list picker.',
        ],
      },
      {
        src: listsTabShot,
        name: 'lists-tab-mobile.webp',
        title: 'The Lists tab',
        marks: [
          [23.3, 10.7],
          [47.0, 17.4],
          [47.6, 24.6],
        ],
        steps: [
          'Search for a list or create a new one.',
          'Select a list to toggle its membership.',
          'Create a new list with that name.',
        ],
      },
    ],
    tips: [
      'On a keyboard, Shift+J and Shift+K move to the previous and next sutta in the current ' +
        'collection.',
    ],
  },
  {
    title: 'Settings & Offline',
    lead: 'Everything you read is kept on this device first, so the app works with no connection. ' +
      'For total offline access beyond what you\'ve already visited, download all the suttas.',
    shots: [
      {
        src: offlineShot,
        name: 'offline-mobile.webp',
        title: 'Signed out',
        marks: [
          [68.2, 43.7],
          [79.3, 82.3],
        ],
        steps: [
          'Sign in with Google or using an email verification code to save your data and sync across devices.',
          'Download all content to enable full offline reading.',
        ],
      },
      {
        src: offlineSignedInShot,
        name: 'offline-signed-in-mobile.webp',
        title: 'Signed in',
        marks: [
          [75.8, 23.4],
          [48.3, 72.6],
        ],
        steps: [
          'What has synced, and when, along with authentication details.',
          'UI Theme settings, separate from Reader.',
        ],
      },
    ],
    tips: [
      'Signing in is never required — everything works signed out.',
      '"Download all content" fetches the whole canon, so even a sutta you have never opened is ' +
        'there with no connection.',
    ],
  },
];

// The translation credit and the disclosure that the text is modified; docs/translation-changes.md
// holds the list itself.
const TRANSLATION_TITLE = 'The translation';

const TRANSLATION_LEAD =
  'The English is Bhante Sujato’s translation, published by SuttaCentral under CC0. It is not ' +
  'reproduced verbatim here: a number of Pali terms are rendered differently (or left in Pali) — ' +
  'bhikkhu rather than mendicant, composure rather than immersion — and about fifty individual ' +
  'lines are reworded. Everything else is his, word for word, and his own footnotes are never ' +
  'altered.';

const TRANSLATION_URL = 'https://github.com/gbbr/sutamaya.org/blob/main/docs/translation-changes.md';

// The dictionary credit its licence asks for: whose work it is and where to find it whole. The
// version this build shipped is in corpus.json.
const DICTIONARY_TITLE = 'The dictionary';

const DICTIONARY_LEAD =
  'Tapping a Pali word looks it up in the Digital Pali Dictionary, Bodhirasa’s work, used here ' +
  'under CC BY-NC-SA 4.0. What ships with sutamaya is a small part of it: the words that appear ' +
  'in these suttas, with their meanings and little else. The full dictionary is far larger, and ' +
  'is worth visiting on its own.';

const DICTIONARY_URL = 'https://www.dpdict.net/';

// The install steps, written rather than captured: they happen in browser chrome, which no
// screenshot of this app can show.
const INSTALL_TITLE = 'Install the app';

const INSTALL_LEAD =
  'Adding sutamaya to your home screen gives it its own icon and a full screen with no address ' +
  'bar. It is the same app, with everything you have saved.';

const INSTALL_PLATFORMS: Array<{ title: string; steps: string[] }> = [
  {
    title: 'iPhone and iPad',
    steps: [
      'Open app.sutamaya.org in Safari. It has to be Safari — Chrome and Firefox on iOS cannot install it.',
      'Tap the Share button in the toolbar.',
      'Scroll down the list and tap "Add to Home Screen".',
      'Tap "Add", top right.',
    ],
  },
  {
    title: 'Android',
    steps: [
      'Open app.sutamaya.org in Chrome.',
      'Tap the ⋮ menu, top right.',
      'Tap "Add to Home screen", then "Install".',
      'Chrome may offer to install it for you instead — either way works.',
    ],
  },
];

const INSTALL_TIPS = [
  'Install first, then sign in and download the content — the installed app has its own storage, ' +
    'separate from the browser you installed it from.',
];

const CONTACT_TITLE = 'Get in touch';

const CONTACT_LEAD =
  'Bugs, questions and suggestions are welcome at metta@sutamaya.org. They can also go to the ' +
  'project’s issue tracker, where anything filed is public and posting needs a free GitHub ' +
  'account.';

const CONTACT_EMAIL = 'metta@sutamaya.org';

const CONTACT_URL = 'https://github.com/gbbr/sutamaya.org/issues/new';

// The contents list, in page order: each group's label over the titles it links to.
const CONTENTS: Array<{ label: string; titles: string[] }> = [
  { label: 'Using the app', titles: [...SECTIONS.map((section) => section.title), INSTALL_TITLE] },
  { label: 'About', titles: [TRANSLATION_TITLE, DICTIONARY_TITLE, CONTACT_TITLE] },
];

// A numbered marker, on the picture and in the legend alike. A fixed cool blue outside the app's
// palette, since the shots are images and don't invert with the theme. Both call sites size the
// digit in raw px, as artwork fitted to its circle rather than UI text.
const MARKER = 'flex items-center justify-center rounded-full bg-[#1D4ED8] font-sans font-medium text-white tabular-nums';

// Renders a tip's `*emphasis*` runs, splitting on the markers so the text stays text; the capture
// group puts every emphasised run on an odd index. Semibold, the heaviest weight IBM Plex Sans
// ships here.
function withEmphasis(tip: string) {
  return tip.split(/\*(.+?)\*/).map((part, i) =>
    i % 2 ? <span key={i} className="font-semibold text-ink">{part}</span> : part,
  );
}

// Returns a section's anchor id, derived from its title so the contents list can't disagree with it.
function anchorId(title: string): string {
  return `help-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
}

// Prints the `[x, y]` pair that puts a marker's centre where a shot was clicked, to paste into its
// `marks`. Wired up only under `import.meta.env.DEV`, so it drops out of a production build.
function logMarkOnClick(e: React.MouseEvent<HTMLImageElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  console.log(`[${x.toFixed(1)}, ${y.toFixed(1)}]`);
}

// Renders one column of a section: the picture, its name, and the legend for its own markers.
// Columns share a row until the page is too narrow, then stack, legend and picture together.
function ShotColumn({ shot, startIndex, showTitle }: { shot: HelpShot; startIndex: number; showTitle: boolean }) {
  return (
    <div className="flex-1 min-w-[190px]">
      <div className="relative">
        {shot.src ? (
          <img
            src={shot.src}
            alt=""
            // The shots are captured in dark mode: the light theme lifts their blacks toward the
            // page, and dark mode instead draws the hairline the image can't draw for itself.
            className={`block w-full rounded-field dark:border dark:border-ink/[.12] brightness-110 contrast-[.92] opacity-[.92] dark:brightness-100 dark:contrast-100 dark:opacity-100 ${import.meta.env.DEV ? 'cursor-crosshair' : ''}`}
            onClick={import.meta.env.DEV ? logMarkOnClick : undefined}
          />
        ) : (
          <div className="flex items-center justify-center rounded-field border border-dashed border-ink/[.18] bg-ink/[.02] aspect-[390/844]">
            <span className="font-sans text-ui-xs text-center leading-[1.4] text-ink-5 px-3">{shot.name}</span>
          </div>
        )}
        {/* The markers over the image. Decorative, since the legend below repeats each as a
            number, and `pointer-events-none` so one can't swallow the dev readout's click. */}
        {shot.marks.map(([x, y], i) => (
          <span
            key={i}
            aria-hidden
            className={`${MARKER} absolute pointer-events-none w-5 h-5 text-[12px] ring-[1.0px] ring-white/80 shadow-[0_1px_2px_rgba(0,0,0,.4)]`}
            style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
          >
            {startIndex + i + 1}
          </span>
        ))}
      </div>
      {showTitle && <div className="font-sans text-ui-sm font-semibold text-ink-2 mt-3">{shot.title}</div>}
      <ol className="mt-2 flex flex-col gap-2">
        {shot.steps.map((step, i) => (
          <li key={step} className="flex items-start gap-2">
            <span className={`${MARKER} flex-none w-[21px] h-[21px] mt-[1px] text-[12px]`}>{startIndex + i + 1}</span>
            <span className="font-sans text-ui-base leading-[1.45] text-ink-2">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// Renders a section's tips as one amber card with a single icon, in the `warning-text` tone
// HeaderBanner and Settings use for "worth knowing".
function TipCard({ tips }: { tips: string[] }) {
  return (
    <div className="flex items-start gap-2 rounded-field bg-warning-text/[.09] pl-2.5 pr-[18px] py-3 mt-4">
      <Lightbulb size={18} strokeWidth={1.75} className="flex-none mt-[2px] text-warning-text" />
      <div className="flex-1 min-w-0 flex flex-col gap-2 font-sans text-ui-base leading-[1.45] text-ink-2">
        {tips.map((tip) => (
          <p key={tip}>{withEmphasis(tip)}</p>
        ))}
      </div>
    </div>
  );
}

// The link back to "On this page" that closes each section, set to the right margin.
function BackToTop({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="flex items-center gap-1.5 ml-auto font-sans text-ui-sm text-ink-4 hover:text-ink-2 mt-5 py-1"
      onClick={onClick}
    >
      <ArrowUp size={16} strokeWidth={1.75} />
      Back to top
    </button>
  );
}

export function HelpPage(_props: RouteComponentProps) {
  // Its own description rather than the app-wide default: this is the one app page in the sitemap.
  useDocumentMeta(
    'How to use sutamaya',
    'How to use sutamaya: browsing the canon, reading with the Pali and dictionary, highlighting and taking notes, keeping your own lists, and reading offline.'
  );

  // The page's scroll container, which "Back to top" returns to; the document itself never scrolls.
  const scrollRef = useRef<HTMLDivElement>(null);

  // Escape leaves the page, as it does in Settings, via '/' rather than browser history.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isTypingTarget(e)) navigate('/');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div ref={scrollRef} data-component="HelpPage" className="sc h-full bg-paper px-5 pt-10">
      <div className="w-full max-w-[640px] pb-10 mx-auto">
        <button className="flex items-center gap-1.5 font-sans text-ui-base text-ink-4 mb-5" onClick={() => navigate('/')}>
          <ArrowLeft size={17} strokeWidth={1.75} />
          Back
        </button>
        <div className="text-ui-3xl font-semibold tracking-[-.01em] mb-2">How to use this app</div>
        <p className="font-serif text-ui-lg leading-[1.55] text-ink-2 mb-4">
          A tour of the app in pictures. Nothing here needs an account, and nothing you've already visited needs a connection.
          For complete offline access, download all content from the Settings page.
        </p>
        {/* The contents list: a micro-label over an indented column of links per group, the shape
            the lists pane uses for MY LISTS and AUTOMATIC. Scrolled with scrollIntoView rather than
            an href, which would put a hash URL into @reach/router's history. */}
        <nav className="flex flex-col gap-4 mb-8">
          {CONTENTS.map((group) => (
            <div key={group.label}>
              <div className="font-sans text-ui-2xs font-bold tracking-[.12em] uppercase text-ink-4 mb-1">
                {group.label}
              </div>
              <div className="flex flex-col items-start pl-3.5">
                {group.titles.map((title) => (
                  <button
                    key={title}
                    className="font-sans text-ui-base text-left text-ink-4 hover:text-ink-2 py-[5px]"
                    onClick={() =>
                      document.getElementById(anchorId(title))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }
                  >
                    {title}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {SECTIONS.map((section) => {
          let consumed = 0;
          const columns = section.shots.map((shot) => {
            const startIndex = consumed;
            consumed += shot.marks.length;
            return { shot, startIndex };
          });
          return (
            <section key={section.title} id={anchorId(section.title)} className="mb-10 scroll-mt-6">
              <div className="font-sans text-ui-2xs font-bold tracking-[.12em] uppercase text-ink-3 mb-2">
                {section.title}
              </div>
              <p className="font-serif text-ui-lg leading-[1.55] text-ink-2 mb-4">{section.lead}</p>
              <div className="flex flex-wrap gap-x-5 gap-y-7">
                {columns.map(({ shot, startIndex }) => (
                  <ShotColumn key={shot.name} shot={shot} startIndex={startIndex} showTitle={columns.length > 1} />
                ))}
              </div>
              {section.tips && <TipCard tips={section.tips} />}
              <BackToTop onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} />
            </section>
          );
        })}

        {/* The install section: the same section furniture as the rest, around one plain numbered
            list per platform rather than a picture and its legend. */}
        <section id={anchorId(INSTALL_TITLE)} className="mb-10 scroll-mt-6">
          <div className="font-sans text-ui-2xs font-bold tracking-[.12em] uppercase text-ink-3 mb-2">
            {INSTALL_TITLE}
          </div>
          <p className="font-serif text-ui-lg leading-[1.55] text-ink-2 mb-4">{INSTALL_LEAD}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-7">
            {INSTALL_PLATFORMS.map((platform) => (
              <div key={platform.title} className="flex-1 min-w-[190px]">
                <div className="font-sans text-ui-sm font-semibold text-ink-2">{platform.title}</div>
                <ol className="list-decimal mt-2 pl-[18px] flex flex-col gap-2 marker:font-sans marker:text-ui-sm marker:text-ink-4 marker:tabular-nums">
                  {platform.steps.map((step) => (
                    <li key={step} className="font-sans text-ui-base leading-[1.45] text-ink-2 pl-1">
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
          <TipCard tips={INSTALL_TIPS} />
          <BackToTop onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} />
        </section>

        {/* The translation credit: prose and one link, with the section furniture that puts it in
            "On this page". */}
        <section id={anchorId(TRANSLATION_TITLE)} className="mb-10 scroll-mt-6">
          <div className="font-sans text-ui-2xs font-bold tracking-[.12em] uppercase text-ink-3 mb-2">
            {TRANSLATION_TITLE}
          </div>
          <p className="font-serif text-ui-lg leading-[1.55] text-ink-2 mb-4">{TRANSLATION_LEAD}</p>
          <a
            href={TRANSLATION_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 font-sans text-ui-base text-ink-2 hover:text-ink underline decoration-ink/25 underline-offset-2"
          >
            View the full list of changes
            <ExternalLink size={16} strokeWidth={1.75} className="flex-none text-ink-4" />
          </a>
          <BackToTop onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} />
        </section>

        {/* The dictionary credit, in the same shape as the translation credit above it. */}
        <section id={anchorId(DICTIONARY_TITLE)} className="mb-10 scroll-mt-6">
          <div className="font-sans text-ui-2xs font-bold tracking-[.12em] uppercase text-ink-3 mb-2">
            {DICTIONARY_TITLE}
          </div>
          <p className="font-serif text-ui-lg leading-[1.55] text-ink-2 mb-4">{DICTIONARY_LEAD}</p>
          <a
            href={DICTIONARY_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 font-sans text-ui-base text-ink-2 hover:text-ink underline decoration-ink/25 underline-offset-2"
          >
            The Digital Pali Dictionary
            <ExternalLink size={16} strokeWidth={1.75} className="flex-none text-ink-4" />
          </a>
          <BackToTop onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} />
        </section>

        {/* The contact section, last on the page and so without a back-to-top of its own. */}
        <section id={anchorId(CONTACT_TITLE)} className="mb-10 scroll-mt-6">
          <div className="font-sans text-ui-2xs font-bold tracking-[.12em] uppercase text-ink-3 mb-2">
            {CONTACT_TITLE}
          </div>
          <p className="font-serif text-ui-lg leading-[1.55] text-ink-2 mb-4">{CONTACT_LEAD}</p>
          <div className="flex flex-col items-start gap-2">
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="inline-flex items-center gap-1.5 font-sans text-ui-base text-ink-2 hover:text-ink underline decoration-ink/25 underline-offset-2"
            >
              {CONTACT_EMAIL}
              <Mail size={16} strokeWidth={1.75} className="flex-none text-ink-4" />
            </a>
            <a
              href={CONTACT_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-sans text-ui-base text-ink-2 hover:text-ink underline decoration-ink/25 underline-offset-2"
            >
              Open an issue on GitHub
              <ExternalLink size={16} strokeWidth={1.75} className="flex-none text-ink-4" />
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
