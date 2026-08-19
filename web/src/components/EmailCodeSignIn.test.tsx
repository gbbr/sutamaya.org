import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmailCodeSignIn } from './EmailCodeSignIn';
import { useAuth } from '../context/AuthContext';

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('@reach/router', () => ({ navigate }));

let requestEmailCode: ReturnType<typeof vi.fn>;
let signInWithEmailCode: ReturnType<typeof vi.fn>;

beforeEach(() => {
  navigate.mockReset();
  requestEmailCode = vi.fn(async () => {});
  signInWithEmailCode = vi.fn(async () => {});
  vi.mocked(useAuth).mockReturnValue({
    user: null,
    loading: false,
    authError: null,
    requestEmailCode,
    signInWithEmailCode,
    promptGoogleSignIn: vi.fn(),
    logout: vi.fn(async () => {}),
  });
});

describe('EmailCodeSignIn', () => {
  it('asks for the address, then the code, then signs in and returns the user to where they were', async () => {
    render(<EmailCodeSignIn returnTo="/browse/dn/dn1" />);

    await userEvent.type(screen.getByLabelText('Email address'), 'reader@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(requestEmailCode).toHaveBeenCalledWith('reader@example.com');

    await userEvent.type(screen.getByLabelText('Six-digit code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(signInWithEmailCode).toHaveBeenCalledWith('reader@example.com', '123456');
    expect(navigate).toHaveBeenCalledWith('/browse/dn/dn1');
  });

  it('stays put when there is nowhere in particular to go back to', async () => {
    render(<EmailCodeSignIn />);
    await userEvent.type(screen.getByLabelText('Email address'), 'reader@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    await userEvent.type(screen.getByLabelText('Six-digit code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(signInWithEmailCode).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('will not submit an incomplete code', async () => {
    render(<EmailCodeSignIn />);
    await userEvent.type(screen.getByLabelText('Email address'), 'reader@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Email me a code' }));

    await userEvent.type(screen.getByLabelText('Six-digit code'), '123');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('keeps only digits, capped at six, so a pasted code from an email still works', async () => {
    render(<EmailCodeSignIn />);
    await userEvent.type(screen.getByLabelText('Email address'), 'reader@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Email me a code' }));

    await userEvent.type(screen.getByLabelText('Six-digit code'), '12-34 5678');
    expect(screen.getByLabelText('Six-digit code')).toHaveValue('123456');
  });

  it('shows what the server said when a code is refused, and stays on the code step', async () => {
    signInWithEmailCode.mockRejectedValue(new Error('That code is not valid. Request a new one.'));
    render(<EmailCodeSignIn />);
    await userEvent.type(screen.getByLabelText('Email address'), 'reader@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    await userEvent.type(screen.getByLabelText('Six-digit code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByText('That code is not valid. Request a new one.')).toBeInTheDocument();
    expect(screen.getByLabelText('Six-digit code')).toBeInTheDocument();
  });

  it('stays on the address step when the code could not be sent', async () => {
    requestEmailCode.mockRejectedValue(new Error('Could not send the code. Please try again.'));
    render(<EmailCodeSignIn />);
    await userEvent.type(screen.getByLabelText('Email address'), 'reader@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Email me a code' }));

    expect(screen.getByText('Could not send the code. Please try again.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
  });

  it('can go back to correct a mistyped address, clearing the code', async () => {
    render(<EmailCodeSignIn />);
    await userEvent.type(screen.getByLabelText('Email address'), 'typo@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    await userEvent.type(screen.getByLabelText('Six-digit code'), '123456');

    await userEvent.click(screen.getByRole('button', { name: 'Use a different email' }));
    expect(screen.getByLabelText('Email address')).toHaveValue('typo@example.com');

    await userEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(screen.getByLabelText('Six-digit code')).toHaveValue('');
  });

  // The server accepts a resend inside its cooldown and deliberately doesn't send (the outstanding
  // code is still valid), so an always-live button would look broken. The countdown is what makes
  // that legible.
  it('counts down before resending is offered, rather than silently doing nothing', async () => {
    // fireEvent rather than userEvent here: userEvent's own async plumbing deadlocks against the
    // fake clock this test needs to drive the countdown.
    vi.useFakeTimers();
    try {
      render(<EmailCodeSignIn />);
      fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'reader@example.com' } });
      fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
      await act(async () => {});

      expect(screen.getByRole('button', { name: 'Resend in 30s' })).toBeDisabled();

      // One second at a time: each tick reschedules itself from an effect, so React has to commit
      // between them for the next timer to exist at all.
      const tick = async () => act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
      for (let i = 0; i < 10; i += 1) await tick();
      expect(screen.getByRole('button', { name: 'Resend in 20s' })).toBeDisabled();

      for (let i = 0; i < 20; i += 1) await tick();
      const resend = screen.getByRole('button', { name: 'Resend code' });
      expect(resend).toBeEnabled();

      fireEvent.click(resend);
      await act(async () => {});
      expect(requestEmailCode).toHaveBeenCalledTimes(2);
      expect(screen.getByLabelText('Six-digit code')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Resend in 30s' })).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
