import { useCallback, useEffect, useMemo, useState } from 'react';
import { navigate, type RouteComponentProps } from '@reach/router';
import { useLayout } from '../context/LayoutContext';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useUiPrefs } from '../context/UiPrefsContext';
import { useCorpusSearch } from '../hooks/useCorpusSearch';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { nodeBlurb, nodeLabel, normalizeBrowseNodeId, normalizeRouteId } from '../lib/corpus';
import { LIST_RESULTS_CAP, SEARCH_RESULTS_CAP } from '../lib/search/metadata';
import { SHORTCUTS, shortcutsForScope, pointerHintsForScope, isShortcut, isTypingTarget } from '../lib/shortcuts';
import { LIBRARY_VIEW_KEY, READER_ORIGIN_KEY, ROUTE_INTENT_KEY } from '../lib/storageKeys';
import { consumeIntent, tagIntent, type RouteIntent } from '../lib/routeIntent';
import { TreePane, type ActiveSearchRow } from '../components/TreePane';
import { ListPane } from '../components/ListPane';
import { ShortcutsModal } from '../components/ShortcutsModal';

// Width of the tree/list divider's undrawn drag strip, left of the boundary.
const TREE_LIST_HIT_BEFORE = 8;
// Width of the same strip right of the boundary.
const TREE_LIST_HIT_AFTER = 14;
// How long typing pauses before the query is written to the address bar.
const QUERY_URL_DELAY = 400;

export function LibraryPage({
  nodeId: urlNodeId,
  suttaId: urlSuttaId,
  location,
}: RouteComponentProps<{ nodeId: string; suttaId?: string }>) {
  // The URL's sutta segment, case-folded — it always names a corpus document. The node segment
  // may name a user list, so only its corpus ids are folded (normalizeBrowseNodeId). The effect
  // below rewrites the address bar to whatever either fold changed.
  const rawSuttaId = urlSuttaId ? normalizeRouteId(urlSuttaId) : urlSuttaId;
  const { mobile, dragTree, resetTree, paneW } = useLayout();
  const { corpus } = useCorpus();
  const { lists, notes, highlights } = useUserData();
  const { toggleTheme } = useUiPrefs();
  const routeNodeId = urlNodeId ? normalizeBrowseNodeId(corpus, urlNodeId) : urlNodeId;
  useEffect(() => {
    if (routeNodeId && (routeNodeId !== urlNodeId || rawSuttaId !== urlSuttaId)) {
      const tail = rawSuttaId ? `/${encodeURIComponent(rawSuttaId)}` : '';
      // Carries the query across, a fold being a correction to the address rather than a departure
      // from the search.
      navigate(`/browse/${encodeURIComponent(routeNodeId)}${tail}${location?.search ?? ''}`, { replace: true });
    }
  }, [urlNodeId, urlSuttaId, routeNodeId, rawSuttaId, location?.search]);
  // The selected sutta, mirrored into state so a handler can set it in the same render as
  // everything else it changes; @reach/router updates the route param a frame later. The effect
  // covers navigation this page didn't initiate.
  const [suttaId, setSuttaId] = useState(rawSuttaId || undefined);
  useEffect(() => {
    setSuttaId(rawSuttaId || undefined);
  }, [rawSuttaId]);
  // Whether the arrival is a reader close returning to its origin, which suppresses TreePane's
  // corrective pane sync. Read straight off location.state, since a refresh resurrecting it is
  // harmless.
  const restoreOrigin = !!(location?.state as { restoreOrigin?: boolean } | undefined)?.restoreOrigin;
  // `fromView` and `flashNodeId` for this arrival, taken once — location.state survives a same-tab
  // refresh, and consumeIntent reads a resurrected one as no intent at all.
  const [consumedIntent] = useState(() =>
    consumeIntent(
      location?.state as ({ fromView?: 'tree' | 'list'; flashNodeId?: string } & RouteIntent) | null | undefined,
      ROUTE_INTENT_KEY
    )
  );
  // The ancestor row a reader breadcrumb click named, which the tree pane scrolls to and
  // highlights for 1600ms.
  const locationFlashNodeId = consumedIntent?.flashNodeId as string | undefined;
  const [flashNodeId, setFlashNodeId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!locationFlashNodeId) return;
    setFlashNodeId(locationFlashNodeId);
    const t = window.setTimeout(() => setFlashNodeId(undefined), 1600);
    return () => window.clearTimeout(t);
  }, [locationFlashNodeId]);
  const [view, setView] = useState<'tree' | 'list'>(() => {
    const fromView = consumedIntent?.fromView;
    if (fromView === 'tree' || fromView === 'list') return fromView;
    // A bookmark or typed URL naming a sutta: no router state, and only the list pane shows the
    // row.
    if (suttaId && !location?.state) return 'list';
    try {
      const stored = localStorage.getItem(LIBRARY_VIEW_KEY);
      if (stored === 'list' || stored === 'tree') return stored;
    } catch {
      // storage unavailable — ignore
    }
    return 'tree';
  });
  useEffect(() => {
    try {
      localStorage.setItem(LIBRARY_VIEW_KEY, view);
    } catch {
      // storage unavailable — ignore
    }
  }, [view]);
  // The search this page arrived on, taken from the address bar's `?q=`.
  const [arrivedQuery] = useState(() => new URLSearchParams(location?.search ?? '').get('q') ?? '');
  const [query, setQuery] = useState(arrivedQuery);
  // The hit the search cursor starts on: the one the reader opened, on the way back from it. Read
  // from the arriving URL, so typing a query while a sutta is selected still starts at the top hit.
  const [restoreHitId] = useState(() => (arrivedQuery.trim() && rawSuttaId ? rawSuttaId : undefined));
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Mirrors the query into the address bar, which is what a closed reader returns to. Written on a
  // pause rather than a keystroke, and in place of the current entry, so a search leaves no trail
  // for Back to walk.
  useEffect(() => {
    const path = location?.pathname;
    if (!path) return;
    const current = new URLSearchParams(location.search ?? '').get('q') ?? '';
    if (current === query) return;
    const t = window.setTimeout(() => {
      navigate(query.trim() ? `${path}?q=${encodeURIComponent(query)}` : path, { replace: true });
    }, QUERY_URL_DELAY);
    return () => window.clearTimeout(t);
  }, [query, location?.pathname, location?.search]);

  // One scan per keystroke, shared by both panes.
  const { hits: allHits, listHits, textStatus, textPending, hitsSettled, updating } = useCorpusSearch(
    corpus,
    query,
    notes,
    lists,
    highlights
  );
  // The sutta hits to show: a member that qualified only through a matched list's name is dropped,
  // since that list's own row already stands for it. Every list that matched, not only the ones
  // the capped block draws. A snippet means the sutta's own text answered the query too —
  // `listOnly` is decided before the text is scanned, so that claim is checked here.
  const hits = useMemo(() => {
    if (!listHits.length) return allHits;
    const members = new Set(listHits.flatMap((h) => h.list.items));
    return allHits.filter((h) => !(h.listOnly && !h.snippet && members.has(h.id)));
  }, [allHits, listHits]);
  // The search row TreePane's arrow-key cursor is on — a sutta hit or a list hit — mirrored here
  // so ListPane can draw the same highlight.
  const [activeRow, setActiveRow] = useState<ActiveSearchRow | undefined>(undefined);
  // Takes TreePane's cursor row by value, since it rebuilds the object on every render.
  const onActiveRowChange = useCallback((row: ActiveSearchRow | undefined) => {
    setActiveRow((prev) => (prev?.kind === row?.kind && prev?.id === row?.id ? prev : row));
  }, []);
  // Whether the lists block shows every match rather than the first LIST_RESULTS_CAP. Owned here
  // because TreePane's arrow-key nav walks exactly the rows ListPane draws.
  const [listsExpanded, setListsExpanded] = useState(false);
  // Collapse the lists block again whenever the query changes.
  useEffect(() => {
    setListsExpanded(false);
  }, [query]);
  // The list hits actually drawn. Memoized, since TreePane's active-row effect depends on this
  // array's identity.
  const shownListHits = useMemo(
    () => (listsExpanded ? listHits : listHits.slice(0, LIST_RESULTS_CAP)),
    [listHits, listsExpanded]
  );
  const toggleListsExpanded = useCallback(() => setListsExpanded((v) => !v), []);

  const [nodeId, setNodeId] = useState(routeNodeId);
  useEffect(() => {
    setNodeId(routeNodeId);
  }, [routeNodeId]);

  // The document title and meta description, from the same `nodeLabel` and `nodeBlurb` lookups
  // ListPane's header uses. A search, and a user list, describe nothing and fall back to the
  // app-wide description.
  const { title, description } = useMemo(() => {
    if (query.trim().length > 0) return { title: 'Search', description: null };
    const { ref, label } = nodeLabel(corpus, nodeId || '', lists);
    return {
      title: label ? (ref ? `${ref} · ${label}` : label) : '',
      description: nodeBlurb(corpus, nodeId || undefined).blurb ?? null,
    };
  }, [corpus, nodeId, lists, query]);
  useDocumentMeta(title, description);

  // Selects a browse node or user list. Stable, since TreePane's keydown effect depends on it.
  const onSelectNode = useCallback((id: string) => {
    setQuery('');
    setView('list');
    setNodeId(id);
    setSuttaId(undefined);
    navigate(`/browse/${encodeURIComponent(id)}`);
  }, []);

  // `segments` are set only where the query was answered by the sutta's text, and are where the
  // reader opens: a title or description match has nothing to jump to and opens at the top, as
  // always.
  const onOpen = useCallback(
    (id: string, segments?: [number, number]) => {
      // The node the reader returns to on close: the one being browsed, which a search leaves
      // untouched, so clearing the search hands the tree and the list back the place they were
      // left. A hit's own node stands in only where nothing was selected to return to.
      const returnNodeId = nodeId || (query.trim() ? corpus?.suttas[id]?.node : undefined);
      // The search travels with it, so closing the reader puts the results back rather than the
      // hit's own collection.
      const search = query.trim() ? `?q=${encodeURIComponent(query)}` : '';
      const from = `/browse/${encodeURIComponent(returnNodeId || '')}/${encodeURIComponent(id)}${search}`;
      // The hits the panes draw, in order, which is the run the reader's Prev/Next steps — capped
      // with them, so a step can't leave the results the reader can see.
      const searchIds = query.trim() ? hits.slice(0, SEARCH_RESULTS_CAP).map((h) => h.id) : undefined;
      // Persisted as well as carried in router state, which a hard refresh drops — see
      // ReaderPage's closeReader.
      try {
        localStorage.setItem(READER_ORIGIN_KEY, JSON.stringify({ suttaId: id, from, fromView: view, searchIds }));
      } catch {
        // storage unavailable — ignore
      }
      // Tagged as a one-shot intent only when there is a passage to jump to, so an ordinary open
      // carries the plain origin it always did.
      const state =
        segments === undefined
          ? { from, fromView: view, searchIds }
          : tagIntent({ from, fromView: view, searchIds, segments });
      navigate(`/read/${encodeURIComponent(id)}`, { state });
    },
    [nodeId, view, query, corpus, hits]
  );

  const showTreePane = !mobile || view === 'tree';
  const showListPane = !mobile || view === 'list';

  // Page-level shortcuts: the help modal and the theme toggle. Arrow-key nav over search hits
  // belongs to TreePane.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // While the help modal is open it owns every key; Esc and '?' both close it.
      if (shortcutsOpen) {
        if (e.key === 'Escape' || isShortcut(e, SHORTCUTS.libraryHelp)) {
          e.preventDefault();
          setShortcutsOpen(false);
        }
        return;
      }
      if (isTypingTarget(e)) return;
      if (isShortcut(e, SHORTCUTS.libraryHelp)) {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (isShortcut(e, SHORTCUTS.libraryTheme)) {
        e.preventDefault();
        toggleTheme();
        return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcutsOpen]);

  return (
    <div data-component="LibraryPage" className="relative flex overflow-hidden bg-paper h-full">
      {/* Both panes stay mounted on mobile and hide, keeping each one's scroll offset and
          expansion state across a tree/list toggle. `display:contents` leaves this wrapper
          transparent to the flex layout, and `visible` tells the pane when it has a scroll extent
          to restore into — see useScrollMemory. */}
      <div style={{ display: showTreePane ? 'contents' : 'none' }}>
        <TreePane
          nodeId={nodeId}
          onSelect={onSelectNode}
          onOpenSutta={onOpen}
          onSearch={setQuery}
          query={query}
          hits={hits}
          listHits={shownListHits}
          listHitTotal={listHits.length}
          textStatus={textStatus}
          textPending={textPending}
          hitsSettled={hitsSettled}
          updating={updating}
          listsExpanded={listsExpanded}
          onToggleListsExpanded={toggleListsExpanded}
          onActiveHitChange={onActiveRowChange}
          restoreHitId={restoreHitId}
          visible={showTreePane}
          restoreOrigin={restoreOrigin}
          flashNodeId={flashNodeId}
          breadcrumbArrival={!!locationFlashNodeId}
          shortcutsOpen={shortcutsOpen}
        />
      </div>

      {/* The divider's drag strip, positioned absolutely so it overhangs both panes without
          changing either one's width. */}
      {!mobile && (
        <div
          className="absolute top-0 bottom-0 z-10 cursor-col-resize touch-none"
          style={{ left: paneW.tree - TREE_LIST_HIT_BEFORE, width: TREE_LIST_HIT_BEFORE + TREE_LIST_HIT_AFTER }}
          onPointerDown={dragTree}
          // Cancelling `touchend` asks iOS not to synthesize the click that would open whichever
          // row the finger drifted over; LayoutContext's `swallowNextClick` backs it up.
          onTouchEnd={(e) => e.preventDefault()}
          onDoubleClick={resetTree}
        />
      )}

      <div style={{ display: showListPane ? 'contents' : 'none' }}>
        <ListPane
          nodeId={nodeId}
          selectedId={suttaId}
          query={query}
          hits={hits}
          listHits={shownListHits}
          listHitTotal={listHits.length}
          textStatus={textStatus}
          textPending={textPending}
          hitsSettled={hitsSettled}
          updating={updating}
          listsExpanded={listsExpanded}
          onToggleListsExpanded={toggleListsExpanded}
          onSelectList={onSelectNode}
          activeId={activeRow?.kind === 'sutta' ? activeRow.id : undefined}
          restoreHitId={restoreHitId}
          activeListId={activeRow?.kind === 'list' ? activeRow.id : undefined}
          onBack={() => setView('tree')}
          onOpen={onOpen}
          visible={showListPane}
        />
      </div>

      {shortcutsOpen && (
        <ShortcutsModal
          shortcuts={[...shortcutsForScope('library'), ...pointerHintsForScope('library')]}
          onClose={() => setShortcutsOpen(false)}
        />
      )}
    </div>
  );
}
