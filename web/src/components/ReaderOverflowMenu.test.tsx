import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReaderOverflowMenu } from './ReaderOverflowMenu';
import { READER_THEMES } from '../lib/theme';

const URL = 'https://app.sutamaya.org/read/mn10';

function setup(overrides: Partial<Parameters<typeof ReaderOverflowMenu>[0]> = {}) {
  const onClose = vi.fn();
  const onOpenTab = vi.fn();
  render(
    <ReaderOverflowMenu
      mobile={false}
      theme={READER_THEMES.light}
      onClose={onClose}
      onOpenTab={onOpenTab}
      shareUrl={URL}
      shareTitle="MN 10 · Mindfulness Meditation"
      {...overrides}
    />
  );
  return { onClose, onOpenTab };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// `navigator` is read-only in jsdom, so each branch is set up by replacing the whole object with
// one carrying only what that branch needs.
function stubNavigator(props: Record<string, unknown>) {
  vi.stubGlobal('navigator', props);
}

describe('ReaderOverflowMenu', () => {
  it('opens the panel on the tab a row names, and closes itself', async () => {
    const { onClose, onOpenTab } = setup();
    await userEvent.click(screen.getByText('Lists'));
    expect(onOpenTab).toHaveBeenCalledWith('lists');
    expect(onClose).toHaveBeenCalled();
  });

  it('hands the link to the native share sheet where there is one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share });
    const { onClose } = setup();
    await userEvent.click(screen.getByText('Share'));
    expect(share).toHaveBeenCalledWith({ title: 'MN 10 · Mindfulness Meditation', url: URL });
    expect(onClose).toHaveBeenCalled();
  });

  it('dismissing the share sheet is not treated as a failure', async () => {
    stubNavigator({ share: vi.fn().mockRejectedValue(new Error('AbortError')) });
    setup();
    await userEvent.click(screen.getByText('Share'));
    // The row is gone with the menu; nothing is reported and no copy happens behind it.
    await waitFor(() => expect(screen.queryByText('Link copied')).toBeNull());
  });

  it('copies the link and says so in place where there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ clipboard: { writeText } });
    const { onClose } = setup();
    await userEvent.click(screen.getByText('Share'));
    expect(writeText).toHaveBeenCalledWith(URL);
    // The menu stays open, so the confirmation is somewhere the reader is still looking.
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText('Link copied')).toBeTruthy();
  });

  it('a refused clipboard leaves the row as it was', async () => {
    stubNavigator({ clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    setup();
    await userEvent.click(screen.getByText('Share'));
    await waitFor(() => expect(screen.queryByText('Link copied')).toBeNull());
    expect(screen.getByText('Share')).toBeTruthy();
  });
});
