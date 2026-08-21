import { useEffect } from 'react';
import { navigate, type RouteComponentProps } from '@reach/router';
import { ArrowLeft } from 'lucide-react';
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
// columns of picture + numbered legend. Each column carries its own legend directly beneath its own
// screenshot, so a reader never has to scroll past two pictures to reach the words for the first
// one, and the pairing survives the columns wrapping to a single stack on a phone. Every legend
// line is kept to a handful of words — this page is read by someone looking for one specific
// answer, not studying.
//
// **Phone-width captures serve every viewport.** A full 1280×800 desktop window shown in this
// column renders its 13px UI text at about 5px — unreadable, and no marker placement rescues it.
// The app's structure is the same either way, so a desktop set would be a second copy of the same
// explanation, needing a per-section crop to stay legible.
//
// **Markers number continuously across a section's columns** rather than restarting at 1 in each.
// Side by side, two pictures each showing their own "1" would be genuinely ambiguous about which
// legend a marker belongs to.
//
// **The markers are DOM, not painted into the image.** Each is an [x%, y%] pair positioned over the
// `<img>`, so the screenshots stay clean, the numbers stay crisp at any size and DPR, and
// repositioning one is a number edit rather than a re-export. They are deliberately *not* in the
// app's palette: they are annotation laid over the product, not part of it.
//
// ---------------------------------------------------------------------------------------------
// ADDING OR REPLACING A SCREENSHOT
//
// 1. Capture. Chrome DevTools (`Cmd+Option+I`) → device toolbar (`Cmd+Shift+M`) → set the viewport
//    to exactly **390×844** → `Cmd+Shift+P` → "Capture screenshot". That yields a 780×1688 PNG at
//    2× DPR with no browser chrome, framed identically every time — consistent framing across the
//    set matters more than any single shot.
// 2. Convert. `cwebp -q 82 shot.png -o shot.webp` (`brew install webp`). At this size that lands
//    well under 150KB with clean text. Bump to `-q 90` if small type shows fringing.
// 3. Place. Drop it in `web/src/assets/help/` and `import` it at the top of this file. Imported
//    rather than `public/`, because Vite content-hashes imported assets — so a re-captured
//    screenshot actually reaches devices that already cached the old one, where an unversioned
//    `/help/library.webp` would not (see CLAUDE.md, "Cache staleness"). PNG or WebP, never SVG:
//    vite.config.ts precaches `**/*.svg`, which would push every screenshot into the install
//    payload for people who never open this page.
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
  // Names this column when a section has more than one, so the pair reads as two labelled halves
  // rather than one picture and its sequel.
  title: string;
  // One [x%, y%] marker per `steps` line, measured from this image's own top-left.
  marks: Array<[number, number]>;
  // What each of this column's markers points at, in order. Every line must correspond to
  // something visible in this shot — anything that doesn't (a keyboard shortcut, a gesture that
  // can't be photographed mid-flight, a state the screenshot isn't in) belongs in the section's
  // `note`, so a number never points at nothing.
  steps: string[];
}

interface HelpSection {
  title: string;
  // A one-line orientation before the pictures — what this section is about.
  lead: string;
  shots: HelpShot[];
  note?: string;
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
          [79.3, 33.4],
          [48.5, 2.4],
          [75.3, 8.4],
          [92.2, 8.4],
        ],
        steps: [
          'Tap any node to see its contents.',
          'Switch between the Canon and your own Lists.',
          'Search by number, title, summary, your own notes or list names.',
          'Your account, and every setting.',
        ],
      },
      {
        src: libraryItemsShot,
        name: 'library-items-mobile.webp',
        title: 'Inside a book',
        marks: [
          [15.4, 2.6],
          [84.1, 16.0],
        ],
        steps: [
          'Back to the collections.',
          'A tick marks that you have already spent time here. Tap any row to start reading.',
        ],
      },
    ],
    note: 'On a keyboard, press ? to see a full list of shortcuts.',
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
    note: 'On a keyboard, press ? for the full list of shortcuts. Tip: pressing / in the Reader reveals' +
      ' a Search bar so you can easily navigate to another sutta.',
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
          [4.5, 14.6],
          [25.0, 21.9],
          [60.7, 91.8],
          [88.0, 22.5],
        ],
        steps: [
          'Your notes show up after the sutta summary.',
          'Highlight count. Clicking it takes you to Highlights.',
          'Select text in the sutta and choose a colour to highlight it.',
          'Any existing highlights show up on the right edge. Click the mark to scroll to them.',
        ],
      },
      {
        src: highlightsTabShot,
        name: 'highlights-tab-mobile.webp',
        title: 'Highlights Tab',
        marks: [
          [29.5, 11.3],
          [66.7, 28.7],
        ],
        steps: [
          'Add or change your note.',
          'Tap a highlight to scroll to it in the Reader. Tap the bin on the right to remove it.',
        ],
      },
    ],
    note: 'Every highlight is also marked down the reader’s right edge — tap a mark to jump there.',
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
          [82.0, 11.1],
          [93.0, 11.1],
          [86.3, 22.8],
          [92.5, 39.7],
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
          [92.5, 32.2],
        ],
        steps: [
          'Toggle the re-ordering of suttas within a list. Sort them by your own criteria.',
          'Drag the handle to move a sutta to a different position.',
        ],
      },
    ],
    note: 'Deleting a list takes the suttas in it with it, and deleting a group takes every list nested ' +
      'inside it. There is one confirmation and no undo.',
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
          [22.7, 82.9],
          [55.9, 10.4],
        ],
        steps: [
          'Lists this sutta is part of and number of highlights. Click a list ' +
            'to navigate to it. Click the highlight count to open the Highlights side panel.',
          'If you\'ve opened this sutta from a list, it is displayed here. Navigating to the next or previous ' +
            'sutta will be within that list.',
        ],
      },
      {
        src: listsTabShot,
        name: 'lists-tab-mobile.webp',
        title: 'The Lists tab',
        marks: [
          [21.1, 11.0],
          [30.7, 16.0],
          [45.7, 27.9],
          [50.7, 31.8],
        ],
        steps: [
          'Type the nameo of a list or group that you\'d like to add this sutta too. Press Enter to toggle its membership.',
          'Click a group to create another list or group within it.',
          'Create a new list with that name.',
          'Create a new group with that name.',
        ],
      },
    ],
    note: 'Tip: When reading, swiping left or right (or pressing Shift+Left/Right) navigates the the next ' +
      'or previous sutta in the current collection.',
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
    note: 'Signing in is never required — everything works signed out. "Download all content" fetches the whole canon, so even a sutta you have never opened are there with no connection.',
  },
];

// Deliberately outside the app's palette. These are annotation drawn over a photograph of the
// product, not part of the product, and a marker in the accent colour would read as another piece
// of the UI it is pointing at. Solid with a pale ring so it holds an edge over screenshot pixels
// of any colour, in either theme.
const MARKER = 'flex items-center justify-center rounded-full bg-[#E23A2E] font-sans font-medium text-white tabular-nums';

// Section ids for the contents list, derived from the title rather than stored beside it so the
// two can't disagree about what a link points at.
function anchorId(title: string): string {
  return `help-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
}

// Dev-only authoring aid: click anywhere on a shot and this prints the pair that puts a marker's
// centre exactly there, ready to paste into that shot's `marks`. The numbers come out right with
// no adjustment because a marker is translated by -50%/-50%, so its `left`/`top` *is* its centre —
// the same percentage the click resolves to. `import.meta.env.DEV` is a compile-time constant, so
// the handler and this function drop out of a production build entirely.
function logMarkOnClick(e: React.MouseEvent<HTMLImageElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  console.log(`[${x.toFixed(1)}, ${y.toFixed(1)}]`);
}

// One column: the picture, its name, and the legend for its own markers. Columns share a row until
// the page is too narrow to give each a usable width, at which point they stack — and because the
// legend travels inside the column, a stacked reader still gets the words directly under the
// picture they describe.
function ShotColumn({ shot, startIndex, showTitle }: { shot: HelpShot; startIndex: number; showTitle: boolean }) {
  return (
    <div className="flex-1 min-w-[190px]">
      <div className="relative">
        {shot.src ? (
          <img
            src={shot.src}
            alt=""
            className={`block w-full rounded-field border border-ink/[.12] ${import.meta.env.DEV ? 'cursor-crosshair' : ''}`}
            onClick={import.meta.env.DEV ? logMarkOnClick : undefined}
          />
        ) : (
          <div className="flex items-center justify-center rounded-field border border-dashed border-ink/[.18] bg-ink/[.02] aspect-[390/844]">
            <span className="font-sans text-[11px] text-center leading-[1.4] text-ink/35 px-3">{shot.name}</span>
          </div>
        )}
        {/* Decorative: the legend below repeats every marker as a number, so nothing is lost when
            the image isn't seen. `pointer-events-none` so a marker sitting over the spot you want
            to click doesn't swallow the dev coordinate readout above. */}
        {shot.marks.map(([x, y], i) => (
          <span
            key={i}
            aria-hidden
            className={`${MARKER} absolute pointer-events-none w-4 h-4 text-[9.5px] ring-[1.0px] ring-white/80 shadow-[0_1px_2px_rgba(0,0,0,.4)]`}
            style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
          >
            {startIndex + i + 1}
          </span>
        ))}
      </div>
      {showTitle && <div className="font-sans text-[12px] font-semibold text-ink/70 mt-3">{shot.title}</div>}
      <ol className="mt-2 flex flex-col gap-2">
        {shot.steps.map((step, i) => (
          <li key={step} className="flex items-start gap-2">
            <span className={`${MARKER} flex-none w-[17px] h-[17px] mt-[1px] text-[10px]`}>{startIndex + i + 1}</span>
            <span className="font-sans text-[13px] leading-[1.45] text-ink/75">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function HelpPage(_props: RouteComponentProps) {
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
    <div data-component="HelpPage" className="sc h-full bg-paper px-5 pt-10">
      <div className="w-full max-w-[520px] pb-10 mx-auto">
        <button className="flex items-center gap-1.5 font-sans text-[13px] text-ink/50 mb-5" onClick={() => navigate('/')}>
          <ArrowLeft size={14} strokeWidth={1.75} />
          Back
        </button>
        <div className="text-[22px] font-semibold tracking-[-.01em] mb-2">How to use this app</div>
        <p className="font-serif text-[15px] leading-[1.55] text-ink/65 mb-4">
          A tour of the app in pictures. Nothing here needs an account, and nothing you've already visited needs a connection.
          For complete offline access, download all content from the Settings page.
        </p>
        {/* Stacked on a phone the sections run to several screens each, so without this the one
            answer someone came for is a long scroll away with no sign of how far.
            A labelled, indented column rather than a wrapped inline run or a bordered card: the
            app already says "a group of rows you can go to" exactly this way — a quiet uppercase
            micro-label with its rows indented beneath it, the same shape as MY LISTS and AUTOMATIC
            in the lists pane — so this needs no new visual device. Six links threaded into one
            wrapped line would also sit close enough together to be mis-tapped on a phone, and a
            card would give a signpost more weight than the sections it points at. The label is
            dimmer than a real section header, so this reads as a way in rather than as a seventh
            section. Unnumbered: numbers here would compete with the markers on the pictures.
            Scrolled with scrollIntoView rather than an href, since a real hash link would put a
            URL into @reach/router's history that means nothing to the router. */}
        <nav className="mb-8">
          <div className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/40 mb-1">On this page</div>
          <div className="flex flex-col items-start pl-3.5">
            {SECTIONS.map((section) => (
              <button
                key={section.title}
                className="font-sans text-[13px] text-left text-ink/45 hover:text-ink/75 py-[5px]"
                onClick={() =>
                  document.getElementById(anchorId(section.title))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                {section.title}
              </button>
            ))}
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
              <div className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58] mb-2">
                {section.title}
              </div>
              <p className="font-serif text-[15px] leading-[1.55] text-ink/70 mb-4">{section.lead}</p>
              <div className="flex flex-wrap gap-x-5 gap-y-7">
                {columns.map(({ shot, startIndex }) => (
                  <ShotColumn key={shot.name} shot={shot} startIndex={startIndex} showTitle={columns.length > 1} />
                ))}
              </div>
              {section.note && <p className="font-sans text-[12.5px] leading-[1.5] text-ink/50 mt-4">{section.note}</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
