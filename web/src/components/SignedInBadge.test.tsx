import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@reach/router', () => ({ navigate: vi.fn() }));

import { navigate } from '@reach/router';
import { SignedInBadge } from './SignedInBadge';
import type { User } from '../lib/types';

const user: User = { id: 'u1', email: 'reader@example.com', picture: null };

describe('SignedInBadge', () => {
  it('signed in: shows the initial, navigates to /settings on click', async () => {
    render(<SignedInBadge user={user} size={26} />);
    const badge = screen.getByLabelText('Signed in as reader@example.com');
    expect(badge).toHaveTextContent('R');
    await userEvent.click(badge);
    expect(navigate).toHaveBeenCalledWith('/settings');
  });

  it('signed in with a picture: renders the image instead of the initial', () => {
    render(<SignedInBadge user={{ ...user, picture: 'https://example.com/p.jpg' }} size={26} />);
    expect(screen.getByLabelText('Signed in as reader@example.com').querySelector('img')).toHaveAttribute(
      'src',
      'https://example.com/p.jpg'
    );
  });

  it('signed out: shows a neutral badge that also navigates to /settings', async () => {
    vi.mocked(navigate).mockClear();
    render(<SignedInBadge user={null} size={26} />);
    await userEvent.click(screen.getByLabelText('Settings'));
    expect(navigate).toHaveBeenCalledWith('/settings');
    expect(screen.queryByLabelText(/Signed in as/)).not.toBeInTheDocument();
  });

  // The "only on this device" warning lives in the footer's DataStatus, not here — see the badge's
  // own comment for why it carries no mark of its own.
  it('signed out: carries no at-risk mark', () => {
    const { container } = render(<SignedInBadge user={null} size={26} />);
    expect(container.querySelector('[data-component="SignedInBadgeDot"]')).not.toBeInTheDocument();
  });
});
