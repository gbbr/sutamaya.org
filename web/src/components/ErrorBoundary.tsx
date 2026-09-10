import { Component, type ErrorInfo, type ReactNode } from 'react';

// The app's last line of defence, against a throw that would otherwise unmount everything React
// has rendered and leave a blank page. The outermost element in App.tsx, around the router; a
// throw inside a route is caught by the router instead, which shows the same fallback and logs it
// the same way (App.tsx, RouterView). A class, React exposing no hook equivalent.
//
// It catches only what is thrown while rendering, and in the lifecycle methods beneath it: an
// event handler, a timer or a rejected promise needs its own handling where it happens.

/** Logs a render error as one string, so a crash report can be copied in one selection. */
export function logRenderError(error: unknown, componentStack?: string | null) {
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`Unhandled render error: ${detail}\nComponent stack:${componentStack ?? ''}`);
}

/**
 * What a render error leaves on screen: static markup only, this being the one thing that can't
 * itself throw. Recovery is a full page load rather than a state reset, which would land back here.
 */
export function ErrorFallback() {
  return (
    <div
      data-component="ErrorBoundaryFallback"
      className="flex flex-col items-center justify-center gap-4 h-full bg-paper px-6 text-center"
    >
      <div className="font-serif text-ui-xl text-ink-2">
        Something went wrong. Your notes, lists and highlights are saved on this device — they're safe.
      </div>
      <div className="flex items-center gap-2">
        <button
          className="font-sans text-ui-md px-4 py-2 rounded-md border border-ink/25 hover:bg-ink/[.06]"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
        {/* The escape hatch from a page that crashes on every load, which reloading would only
            reproduce. It lands on the library with nothing selected, so it can't re-enter
            whatever crashed, and the label says so rather than implying a return. */}
        <button
          className="font-sans text-ui-md px-4 py-2 rounded-md border border-ink/25 hover:bg-ink/[.06]"
          onClick={() => window.location.assign('/browse')}
        >
          Go to the library
        </button>
      </div>
    </div>
  );
}

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
    logRenderError(error, info.componentStack);
  }

  render() {
    return this.state.failed ? <ErrorFallback /> : this.props.children;
  }
}
