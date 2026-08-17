import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SyncIndicator } from './SyncIndicator';

describe('SyncIndicator', () => {
  it('shows synced when nothing is owed', () => {
    render(<SyncIndicator status="synced" pendingCount={0} needsReauth={false} onReauth={vi.fn()} size={22} />);
    expect(screen.getByLabelText('Synced')).toBeInTheDocument();
  });

  it('shows the pending count while a write is queued', () => {
    render(<SyncIndicator status="pending" pendingCount={3} needsReauth={false} onReauth={vi.fn()} size={22} />);
    expect(screen.getByLabelText('Syncing 3 changes')).toBeInTheDocument();
  });

  it('shows offline regardless of the queue', () => {
    render(<SyncIndicator status="offline" pendingCount={2} needsReauth={false} onReauth={vi.fn()} size={22} />);
    expect(screen.getByLabelText(/Offline/)).toBeInTheDocument();
  });

  it('shows stuck for a permanently rejected write', () => {
    render(<SyncIndicator status="stuck" pendingCount={1} needsReauth={false} onReauth={vi.fn()} size={22} />);
    expect(screen.getByLabelText(/couldn.t be synced/)).toBeInTheDocument();
  });

  it('needsReauth takes priority over the status, and calling it triggers sign-in', async () => {
    const onReauth = vi.fn();
    render(<SyncIndicator status="pending" pendingCount={1} needsReauth={true} onReauth={onReauth} size={22} />);
    const button = screen.getByLabelText(/Sign-in expired/);
    await userEvent.click(button);
    expect(onReauth).toHaveBeenCalled();
  });
});
