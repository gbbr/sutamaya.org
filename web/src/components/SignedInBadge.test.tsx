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
    render(<SignedInBadge user={user} size={26} promptGoogleSignIn={vi.fn()} />);
    const badge = screen.getByLabelText('Signed in as reader@example.com');
    expect(badge).toHaveTextContent('R');
    await userEvent.click(badge);
    expect(navigate).toHaveBeenCalledWith('/settings');
  });

  it('signed in with a picture: renders the image instead of the initial', () => {
    render(<SignedInBadge user={{ ...user, picture: 'https://example.com/p.jpg' }} size={26} promptGoogleSignIn={vi.fn()} />);
    expect(screen.getByLabelText('Signed in as reader@example.com').querySelector('img')).toHaveAttribute(
      'src',
      'https://example.com/p.jpg'
    );
  });

  it('signed out: shows the Google sign-in button and calls promptGoogleSignIn on click', async () => {
    const promptGoogleSignIn = vi.fn();
    render(<SignedInBadge user={null} size={26} promptGoogleSignIn={promptGoogleSignIn} />);
    await userEvent.click(screen.getByLabelText('Sign in with Google'));
    expect(promptGoogleSignIn).toHaveBeenCalled();
    expect(screen.queryByLabelText(/Signed in as/)).not.toBeInTheDocument();
  });
});
