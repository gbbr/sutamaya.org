import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from './ErrorBoundary';

function Boom({ throws }: { throws: boolean }): React.ReactElement {
  if (throws) throw new Error('render exploded');
  return <div>the app</div>;
}

// React logs a caught render error itself, on top of the boundary's own componentDidCatch — both
// are noise here, so every test that actually throws silences console.error and asserts on what
// the boundary logged rather than on the call count.
function silenceConsole() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('ErrorBoundary', () => {
  it('renders its children untouched when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Boom throws={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('the app')).toBeInTheDocument();
  });

  it('replaces a throwing tree with the fallback instead of unmounting to a blank page', () => {
    const consoleError = silenceConsole();

    render(
      <ErrorBoundary>
        <Boom throws={true} />
      </ErrorBoundary>
    );

    expect(screen.queryByText('the app')).not.toBeInTheDocument();
    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('logs the failure as one copyable string carrying the stack', () => {
    const consoleError = silenceConsole();

    render(
      <ErrorBoundary>
        <Boom throws={true} />
      </ErrorBoundary>
    );

    const logged = consoleError.mock.calls.map((args) => String(args[0]));
    const own = logged.find((line) => line.startsWith('Unhandled render error:'));
    expect(own).toBeDefined();
    // A crash report is only useful if it says where — the message alone names no component.
    expect(own).toContain('render exploded');
    expect(own).toContain('Component stack:');
    consoleError.mockRestore();
  });

  it('recovers by reloading the page, not by re-rendering the tree that just threw', async () => {
    const consoleError = silenceConsole();
    const reload = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload, assign });

    render(
      <ErrorBoundary>
        <Boom throws={true} />
      </ErrorBoundary>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));

    expect(reload).toHaveBeenCalled();
    consoleError.mockRestore();
    vi.unstubAllGlobals();
  });

  it('offers the library as an escape from a page that would crash again on reload', async () => {
    const consoleError = silenceConsole();
    const reload = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload, assign });

    render(
      <ErrorBoundary>
        <Boom throws={true} />
      </ErrorBoundary>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Go to the library' }));

    expect(assign).toHaveBeenCalledWith('/browse');
    consoleError.mockRestore();
    vi.unstubAllGlobals();
  });
});
