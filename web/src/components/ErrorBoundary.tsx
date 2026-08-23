import { Component, type ErrorInfo, type ReactNode } from 'react';

// The app's last line of defence: without it, a single throw anywhere in the tree unmounts
// everything React has rendered and leaves a blank page with no way back — and this app is a
// full-screen reader, so a blank page is the entire UI gone.
//
// A React boundary only catches errors thrown while *rendering* (and in the lifecycle methods and
// constructors underneath it). Event handlers, timers, and rejected promises — the mirror's flush,
// every fetch — never reach it and still need their own handling where they happen. It is a class
// because React exposes no hook equivalent.
//
// Deliberately the outermost element in App.tsx, outside AppProviders, so a provider throwing
// during its own render is caught too.

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // One string rather than several arguments, so the whole thing can be copied out of the
    // console in a single selection when someone reports a crash.
    console.error(`Unhandled render error: ${error.stack || error.message}\nComponent stack:${info.componentStack}`);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    // Recovery is a full page load, not a state reset: whatever produced the error is usually
    // still in the state that produced it, so re-rendering the same tree would land straight back
    // here. The fallback itself renders nothing but static markup for the same reason — it has to
    // be the one thing in the app that cannot throw.
    return (
      <div
        data-component="ErrorBoundaryFallback"
        className="flex flex-col items-center justify-center gap-4 h-full bg-paper px-6 text-center"
      >
        <div className="font-serif text-ui-xl text-ink/70">
          Something went wrong. Your notes, lists and highlights are saved on this device — they're safe.
        </div>
        <div className="flex items-center gap-2">
          <button
            className="font-sans text-ui-md px-4 py-2 rounded-md border border-ink/25 hover:bg-ink/[.06]"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
          {/* The escape hatch from a page that crashes every time it loads — a sutta whose text
              trips the reader, say, which reloading alone would only reproduce. Goes to a fixed
              collection rather than anywhere the user was: "back" is exactly what must not happen
              here, and the label says where it lands rather than implying a return. */}
          <button
            className="font-sans text-ui-md px-4 py-2 rounded-md border border-ink/25 hover:bg-ink/[.06]"
            onClick={() => window.location.assign('/browse/dn')}
          >
            Go to the library
          </button>
        </div>
      </div>
    );
  }
}
