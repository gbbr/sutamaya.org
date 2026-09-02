import { Component, type ErrorInfo, type ReactNode } from 'react';

// The app's last line of defence, against a throw that would otherwise unmount everything React
// has rendered and leave a blank page. The outermost element in App.tsx, outside the providers, so
// one throwing during its own render is caught too. A class, React exposing no hook equivalent.
//
// It catches only what is thrown while rendering, and in the lifecycle methods beneath it: an
// event handler, a timer or a rejected promise needs its own handling where it happens.

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
    // One string rather than several arguments, so a crash report can be copied in one selection.
    console.error(`Unhandled render error: ${error.stack || error.message}\nComponent stack:${info.componentStack}`);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    // The fallback: static markup only, this being the one thing that can't itself throw. Recovery
    // is a full page load rather than a state reset, which would land back here.
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
}
