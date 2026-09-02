import { useState } from 'react';
import { Check, Highlighter, List as ListIcon, Share, Type } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import type { ThemeColors } from '../lib/types';
import type { ReaderPanelTab } from '../lib/readerPanelTab';
import { KeyCap } from './ShortcutsModal';
import { SHORTCUTS, SHOWS_KEY_HINTS } from '../lib/shortcuts';

interface ReaderOverflowMenuProps {
  mobile: boolean;
  theme: ThemeColors;
  onClose: () => void;
  // Opens the settings/lists/highlights panel on that tab.
  onOpenTab: (tab: ReaderPanelTab) => void;
  // What Share hands the platform: the link to this sutta, and the name it travels under.
  shareUrl: string;
  shareTitle: string;
}

// The reader's secondary actions, gathered behind the header's Menu button. The three panel tabs
// are named here rather than reached by opening the panel and switching tab, so every destination
// is one labelled tap from the same place; Share sits below the rule as the one action that leaves
// the reading rather than adjusting it.
export function ReaderOverflowMenu({ mobile, theme, onClose, onOpenTab, shareUrl, shareTitle }: ReaderOverflowMenuProps) {
  const [copied, setCopied] = useState(false);

  // `keyName` names the shortcut that reaches the same place, so someone who found it here learns
  // the key. Drawn only where there is a keyboard to press it on (SHOWS_KEY_HINTS), as elsewhere.
  const item = (icon: ReactNode, label: string, onClick: () => void, keyName?: string) => (
    <button
      key={label}
      className="font-sans w-full flex items-center gap-3.5 text-left text-ui-base px-4 py-3"
      style={{ color: theme.fg }}
      onClick={onClick}
    >
      <span className="flex-none flex items-center" style={{ color: theme.dim }}>
        {icon}
      </span>
      <span className="flex-1 min-w-0">{label}</span>
      {keyName && SHOWS_KEY_HINTS && <KeyCap keyName={keyName} theme={theme} small />}
    </button>
  );

  const openTab = (tab: ReaderPanelTab) => () => {
    onClose();
    onOpenTab(tab);
  };

  async function share() {
    // The native share sheet, wherever there is one — every browser this app supports on a phone,
    // and most on a desktop. Its own dismissal rejects, which is not a failure.
    if (navigator.share) {
      onClose();
      try {
        await navigator.share({ title: shareTitle, url: shareUrl });
      } catch {
        /* dismissed */
      }
      return;
    }
    // Nowhere to hand it to: copy the link instead and say so in place, keeping the menu open —
    // a copy that closes the menu silently reads as the button having done nothing.
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      /* clipboard refused — the menu stays as it was */
    }
  }

  const size = 19;
  const rows = [
    item(<Type size={size} strokeWidth={1.75} />, 'Appearance', openTab('text'), SHORTCUTS.readerTheme.keys[0]),
    item(<ListIcon size={size} strokeWidth={1.75} />, 'Lists', openTab('lists'), SHORTCUTS.readerLists.keys[0]),
    item(
      <Highlighter size={size} strokeWidth={1.75} />,
      // Singular: a sutta carries many highlights but exactly one note. The plural belongs to the
      // Library, where the notes of many suttas are listed together.
      'Highlights & Note',
      openTab('highlights'),
      SHORTCUTS.readerHighlights.keys[0],
    ),
  ];
  // The box-and-up-arrow rather than the three-node graph: this is installed as a PWA and read
  // mostly on iOS, where that glyph is what "share" looks like everywhere else on the device.
  const belowRule = [
    copied
      ? item(<Check size={size} strokeWidth={1.75} />, 'Link copied', onClose)
      : item(<Share size={size} strokeWidth={1.75} />, 'Share', share),
  ];

  // Mobile rises from the bottom edge as a sheet; desktop drops from the Menu button it belongs to.
  const menuStyle: CSSProperties = mobile
    ? {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        background: theme.panel,
        // No padding of its own: the rows fill the menu edge to edge, so their own padding sets
        // the text's inset and a hover band covers the whole row. Only the home indicator's strip
        // is held clear at the foot.
        padding: 0,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }
    : {
        position: 'absolute',
        top: 56,
        right: 14,
        width: 260,
        background: theme.panel,
        border: `1px solid ${theme.rule}`,
        boxShadow: '0 10px 30px rgba(0,0,0,.18)',
        padding: 0,
      };

  return (
    <>
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,.12)' }} onClick={onClose} />
      <div
        data-component="ReaderOverflowMenu"
        role="menu"
        // `--menu-hover` is the colour the rows take under the pointer, painted by index.css: a
        // `hover:` class can't reach the active reader theme, which only exists as inline style.
        style={{ ...menuStyle, '--menu-hover': theme.tint } as CSSProperties}
        // `overflow-hidden` so a full-width hover band is clipped by the menu's own corners.
        className={`overflow-hidden ${mobile ? 'rounded-t-sheet shadow-sheet animate-sheetUp' : 'rounded-field animate-popIn'}`}
      >
        {rows}
        <div style={{ borderTop: `1px solid ${theme.tint}`, margin: '6px 0' }} />
        {belowRule}
      </div>
    </>
  );
}
