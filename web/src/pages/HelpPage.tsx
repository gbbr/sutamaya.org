import { useEffect, useRef } from 'react';
import { navigate, type RouteComponentProps } from '@reach/router';
import { ArrowLeft, ArrowUp, ExternalLink, Lightbulb } from 'lucide-react';
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

// A single scrolling page of annotated screenshots: one section per thing the app does, built from
// columns of picture plus numbered legend. Each column carries its legend directly beneath its own
// screenshot, so the pairing survives the columns stacking on a phone. Every legend line is a
// handful of words — this page is read by someone looking for one answer.
//
// **Phone-width captures serve every viewport.** A 1280×800 desktop window shown in this column
// renders its 16px UI text at about 6px, and the app's structure is the same either way, so a
// desktop set would be a second copy of the same explanation.
//
// **Markers number continuously across a section's columns** rather than restarting at 1 in each,
// so two pictures side by side can't both show a "1".
//
// **The markers are DOM, not painted into the image.** Each is an [x%, y%] pair positioned over the
// `<img>`, so the screenshots stay clean, the numbers stay crisp at any DPR, and repositioning one
// is a number edit rather than a re-export. They sit outside the app's palette: they are annotation
// laid over the product, not part of it.
//
// ---------------------------------------------------------------------------------------------
// ADDING OR REPLACING A SCREENSHOT
//
// 1. Capture. Chrome DevTools (`Cmd+Option+I`) → device toolbar (`Cmd+Shift+M`) → set the viewport
//    to exactly **390×844** → `Cmd+Shift+P` → "Capture screenshot". That yields a 780×1688 PNG at
//    2× DPR with no browser chrome, framed identically every time.
// 2. Convert. `cwebp -q 82 shot.png -o shot.webp` (`brew install webp`). At this size that lands
//    well under 150KB with clean text. Bump to `-q 90` if small type shows fringing.
// 3. Place. Drop it in `web/src/assets/help/` and `import` it at the top of this file — imported
//    rather than served from `public/`, because Vite content-hashes imported assets, so a
//    re-captured screenshot reaches devices that cached the old one (see CLAUDE.md, "Cache
//    staleness"). PNG or WebP, never SVG: vite.config.ts precaches `**/*.svg`, which would push
//    every screenshot into the install payload.
// 4. Mark it up. In a dev build, clicking anywhere on a shot prints the exact `[x, y]` pair to
//    paste into that shot's `marks` — see logMarkOnClick below. Add one `steps` line per marker.
//
// A shot with no `src` yet renders as a labelled slot naming the file it is waiting for, so a
// half-finished page is still a usable one.
// ---------------------------------------------------------------------------------------------

interface HelpShot {
  // The imported image URL. Undefined until the screenshot exists.
  src?: string;
  // Filename to capture. Also the key for this column, and what the empty slot displays.
  name: string;
  // Names this column when a section has more than one, so the pair reads as two labelled halves.
  title: string;
  // One [x%, y%] marker per `steps` line, measured from this image's own top-left.
  marks: Array<[number, number]>;
  // What each of this column's markers points at, in order. Every line must correspond to something
  // visible in this shot; anything that doesn't — a keyboard shortcut, a gesture, a state the
  // screenshot isn't in — belongs in the section's `tips`, so a number never points at nothing.
  steps: string[];
}

interface HelpSection {
  title: string;
  // A one-line orientation before the pictures — what this section is about.
  lead: string;
  shots: HelpShot[];
  // The things a marker can't point at — a keyboard shortcut, a gesture, a consequence that shows
  // up after the fact. One paragraph each, at most two or three per section: they render as a
  // tinted card, which stops reading as "worth stopping for" once it grows into a wall.
  // `*asterisks*` emphasise a run within a tip — see withEmphasis.
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

// Who wrote the words being read, and the one thing this app does to them. It sits after the tour
// and the install steps, which are what a reader does next. The full account of every change is in
// docs/translation-changes.md — the page the reader's "Source: SuttaCentral, modified" line links
// to — so this is the credit and the disclosure, not the list.
const TRANSLATION_TITLE = 'The translation';

const TRANSLATION_LEAD =
  'The English is Bhante Sujato’s translation, published by SuttaCentral under CC0. It is not ' +
  'reproduced verbatim here: a number of Pali terms are rendered differently (or left in Pali) — ' +
  'bhikkhu rather than mendicant, composure rather than immersion — and about fifty individual ' +
  'lines are reworded. Everything else is his, word for word, and his own footnotes are never ' +
  'altered.';

const TRANSLATION_URL = 'https://github.com/gbbr/sutamaya.org/blob/main/docs/translation-changes.md';

// The dictionary behind every word tap is someone else's work, under a licence that asks to be
// named, so it is named where a reader meets it rather than only in the repo. Kept to whose it is
// and where to find it whole; the version this build shipped is in corpus.json.
const DICTIONARY_TITLE = 'The dictionary';

const DICTIONARY_LEAD =
  'Tapping a Pali word looks it up in the Digital Pali Dictionary, Bodhirasa’s work, used here ' +
  'under CC BY-NC-SA 4.0. What ships with sutamaya is a small part of it: the words that appear ' +
  'in these suttas, with their meanings and little else. The full dictionary is far larger, and ' +
  'is worth visiting on its own.';

const DICTIONARY_URL = 'https://www.dpdict.net/';

// Not a HelpSection, because installing happens in browser chrome — Safari's Share sheet, Chrome's
// ⋮ menu — which no capture of this app can show, and which Apple and Google rename often enough
// that a picture would age faster than a sentence.
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

// The issue tracker rather than an email address: an address on a public page is harvested by
// crawlers, and a bug report is more useful where it can be answered in the open.
const CONTACT_LEAD =
  'Bugs, questions and suggestions all go to the same place — the project’s issue tracker. ' +
  'Anything filed there is public, and posting needs a free GitHub account.';

const CONTACT_URL = 'https://github.com/gbbr/sutamaya.org/issues/new';

// Outside the app's palette, and louder than anything in it: these are annotation drawn over a
// photograph of the product, so a marker in the accent colour would read as another piece of the UI
// it points at, and a dark neutral one would have to be hunted for against arbitrary screenshot
// pixels. A cool blue, the one hue nothing in the warm palette holds, and without the "something
// went wrong" a red marker would carry. Solid with a pale ring, so it holds an edge over those
// pixels in either theme — the shots are fixed images and don't invert, so this can't be
// theme-var-backed.
//
// Both call sites share the colour: the number on the picture and the number in the legend are the
// same marker, matched by sight before the digit is read. Both size the digit with a raw px
// font-size rather than a `text-ui-*` token, since the numeral is artwork fitted to its circle
// rather than UI text.
const MARKER = 'flex items-center justify-center rounded-full bg-[#1D4ED8] font-sans font-medium text-white tabular-nums';

// `*emphasis*` inside a tip. A single asterisk rather than Markdown's double, since a tip is a
// hand-authored string in this file and never user input. Split on the delimiter rather than
// replaced into HTML, so the text stays text and can't inject markup — the capture group puts every
// emphasised run on an odd index. `font-semibold` rather than bold, because the self-hosted IBM
// Plex Sans carries only 400–600 and a 700 request gets a synthesised smear.
function withEmphasis(tip: string) {
  return tip.split(/\*(.+?)\*/).map((part, i) =>
    i % 2 ? <span key={i} className="font-semibold text-ink">{part}</span> : part,
  );
}

// Section ids for the contents list, derived from the title rather than stored beside it, so the
// two can't disagree about what a link points at.
function anchorId(title: string): string {
  return `help-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
}

// Dev-only authoring aid: click anywhere on a shot and this prints the pair that puts a marker's
// centre there, ready to paste into that shot's `marks`. A marker is translated by -50%/-50%, so
// its `left`/`top` is its centre — the same percentage the click resolves to — and no adjustment is
// needed. `import.meta.env.DEV` is a compile-time constant, so this drops out of a production build.
function logMarkOnClick(e: React.MouseEvent<HTMLImageElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  console.log(`[${x.toFixed(1)}, ${y.toFixed(1)}]`);
}

// One column: the picture, its name, and the legend for its own markers. Columns share a row until
// the page is too narrow to give each a usable width, then stack — and since the legend travels
// inside the column, a stacked reader still gets the words directly under the picture.
function ShotColumn({ shot, startIndex, showTitle }: { shot: HelpShot; startIndex: number; showTitle: boolean }) {
  return (
    <div className="flex-1 min-w-[190px]">
      <div className="relative">
        {shot.src ? (
          <img
            src={shot.src}
            alt=""
            // The shots are captured in dark mode, which on the light theme puts a hard black block
            // in the middle of the page. The light-mode-only filters lift its blacks toward the
            // page, so it reads as a picture rather than a hole; dark mode turns them all off. The
            // hairline is dark-mode-only for the inverse reason: against the light theme a
            // mostly-black image already draws its own edge.
            className={`block w-full rounded-field dark:border dark:border-ink/[.12] brightness-110 contrast-[.92] opacity-[.92] dark:brightness-100 dark:contrast-100 dark:opacity-100 ${import.meta.env.DEV ? 'cursor-crosshair' : ''}`}
            onClick={import.meta.env.DEV ? logMarkOnClick : undefined}
          />
        ) : (
          <div className="flex items-center justify-center rounded-field border border-dashed border-ink/[.18] bg-ink/[.02] aspect-[390/844]">
            <span className="font-sans text-ui-xs text-center leading-[1.4] text-ink-5 px-3">{shot.name}</span>
          </div>
        )}
        {/* Decorative: the legend below repeats every marker as a number, so nothing is lost when
            the image isn't seen. `pointer-events-none` so a marker sitting over the spot you want
            to click doesn't swallow the dev coordinate readout above. */}
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

// A tip is the part of a section a reader is least likely to know already, so it gets a tinted card
// rather than the quietest text on the page, read at the legend's size and weight. The amber is
// `warning-text`, the tone HeaderBanner and Settings already use for "worth knowing", rather than
// the markers' red — that red means annotation drawn over a screenshot, and spreading it to the
// page's own furniture would stop it meaning that. One card per section, not per tip, so two tips
// don't repeat the icon.
// The padding is asymmetric on purpose: the icon already holds the text well clear of the left
// edge, while on the right nothing but the padding keeps a wrapped line off it.
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

// A section runs to several screens on a phone, so the way back to "On this page" — the only route
// to a different section — is a long swipe up from wherever the reader finished. Dimmer than the
// section's own text and set to the right margin, off the left edge every other line starts from,
// so it reads as the end of the section rather than as one more thing to read.
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
  // The one app page listed in the sitemap, so it gets a description written for a search result
  // rather than the app-wide default.
  useDocumentMeta(
    'How to use sutamaya',
    'How to use sutamaya: browsing the canon, reading with the Pali and dictionary, highlighting and taking notes, keeping your own lists, and reading offline.'
  );

  // The page's own scroll container, so "Back to top" can return to it. The document itself never
  // scrolls here — the app shell is a fixed-height layout and this `.sc` div is what moves.
  const scrollRef = useRef<HTMLDivElement>(null);

  // Escape leaves the page, matching Settings — both are side trips off whatever the reader was
  // actually doing, and '/' restores that rather than relying on browser history (see
  // RestoreLastLocation in App.tsx).
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
        {/* Stacked on a phone the sections run to several screens each, so without this the one
            answer someone came for is a long scroll away with no sign of how far.
            A labelled, indented column rather than a wrapped inline run or a bordered card: the
            app already says "a group of rows you can go to" exactly this way — a quiet uppercase
            micro-label with its rows indented beneath it, the same shape as MY LISTS and AUTOMATIC
            in the lists pane — so this needs no new visual device. The links threaded into one
            wrapped line would also sit close enough together to be mis-tapped on a phone, and a
            card would give a signpost more weight than the sections it points at. The label is
            dimmer than a real section header, so this reads as a way in rather than as a seventh
            section. Unnumbered: numbers here would compete with the markers on the pictures.
            Scrolled with scrollIntoView rather than an href, since a real hash link would put a
            URL into @reach/router's history that means nothing to the router. */}
        <nav className="mb-8">
          <div className="font-sans text-ui-2xs font-bold tracking-[.12em] uppercase text-ink-4 mb-1">On this page</div>
          <div className="flex flex-col items-start pl-3.5">
            {SECTIONS.map((section) => (
              <button
                key={section.title}
                className="font-sans text-ui-base text-left text-ink-4 hover:text-ink-2 py-[5px]"
                onClick={() =>
                  document.getElementById(anchorId(section.title))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                {section.title}
              </button>
            ))}
            <button
              className="font-sans text-ui-base text-left text-ink-4 hover:text-ink-2 py-[5px]"
              onClick={() =>
                document.getElementById(anchorId(INSTALL_TITLE))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            >
              {INSTALL_TITLE}
            </button>
            <button
              className="font-sans text-ui-base text-left text-ink-4 hover:text-ink-2 py-[5px]"
              onClick={() =>
                document
                  .getElementById(anchorId(TRANSLATION_TITLE))
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            >
              {TRANSLATION_TITLE}
            </button>
            <button
              className="font-sans text-ui-base text-left text-ink-4 hover:text-ink-2 py-[5px]"
              onClick={() =>
                document.getElementById(anchorId(DICTIONARY_TITLE))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            >
              {DICTIONARY_TITLE}
            </button>
            <button
              className="font-sans text-ui-base text-left text-ink-4 hover:text-ink-2 py-[5px]"
              onClick={() =>
                document.getElementById(anchorId(CONTACT_TITLE))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            >
              {CONTACT_TITLE}
            </button>
          </div>
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

        {/* Written out here rather than driven from SECTIONS: it is the same section furniture
            around two plain numbered lists instead of a picture and its legend. The numbers are
            the page's own quiet ink, not the markers' red — nothing here is annotation over a
            screenshot, and reusing that red would blunt what it means everywhere else. */}
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

        {/* Prose and one link, with the same section furniture as everything else so it lands in
            "On this page". Plain prose rather than a tip card: nothing here is an aside to a
            picture, and the tinted card is reserved for the thing a marker couldn't point at. */}
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

        {/* The same shape as the translation credit above, and directly after it: the two are one
            answer to the same question — whose words are these. */}
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

        {/* Last section on the page, and the shortest: a lead and one link. It keeps the section
            furniture so it appears in "On this page" like everything else, but it gets no tip card
            and no back-to-top — the page ends here, so there is nothing further to return from. */}
        <section id={anchorId(CONTACT_TITLE)} className="mb-10 scroll-mt-6">
          <div className="font-sans text-ui-2xs font-bold tracking-[.12em] uppercase text-ink-3 mb-2">
            {CONTACT_TITLE}
          </div>
          <p className="font-serif text-ui-lg leading-[1.55] text-ink-2 mb-4">{CONTACT_LEAD}</p>
          <a
            href={CONTACT_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 font-sans text-ui-base text-ink-2 hover:text-ink underline decoration-ink/25 underline-offset-2"
          >
            Open an issue on GitHub
            <ExternalLink size={16} strokeWidth={1.75} className="flex-none text-ink-4" />
          </a>
        </section>
      </div>
    </div>
  );
}
