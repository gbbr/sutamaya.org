import { useEffect, useRef, useState } from 'react';
import { navigate } from '@reach/router';
import { useAuth } from '../context/AuthContext';

// Signing in with an emailed code: two steps on one card, the address and then the six digits.
// Nothing here leaves the page, so an installed PWA completes the flow in its own window.

const FIELD =
  'w-full h-10 px-3 rounded-field border border-ink/[.18] bg-transparent font-sans text-ui-md placeholder:text-ink-5';
// The accent border on the input the card is waiting to have typed into.
const FIELD_ACTIVE = 'border-accent ring-2 ring-accent/25';
const SUBMIT =
  'flex items-center justify-center gap-1.5 w-full py-[12px] rounded-field bg-accent text-[#FBFAF7] font-sans text-ui-base font-medium disabled:opacity-50';
const LINK = 'font-sans text-ui-sm text-ink-4 underline decoration-ink/25 underline-offset-2';
const LINK_SPENT = 'font-sans text-ui-sm text-ink-5';

// How long "Resend" stays disabled, matching the server's own cooldown.
const RESEND_COOLDOWN_SECONDS = 30;

export function EmailCodeSignIn({ returnTo }: { returnTo?: string }) {
  const { requestEmailCode, signInWithEmailCode } = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (step === 'email') {
        await requestEmailCode(email.trim());
        setCooldown(RESEND_COOLDOWN_SECONDS);
        setStep('code');
      } else {
        await signInWithEmailCode(email.trim(), code.trim());
        // The flow never leaves the page, so the return is made here.
        if (returnTo) navigate(returnTo);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form data-component="EmailCodeSignIn" onSubmit={submit} className="flex flex-col gap-2">
      {step === 'email' ? (
        <>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-label="Email address"
            autoComplete="email"
            required
            className={FIELD}
          />
          <button type="submit" className={SUBMIT} disabled={busy || !email.trim()}>
            {busy ? 'Sending…' : 'Email me a code'}
          </button>
        </>
      ) : (
        <>
          <div className="font-sans text-ui-base text-ink-3">
            We sent a six-digit code to <span className="text-ink">{email.trim()}</span>. It expires in 10 minutes.
          </div>
          <input
            ref={codeRef}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            aria-label="Six-digit code"
            // Lets a phone offer the code from its own notification.
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            className={`${FIELD} ${FIELD_ACTIVE} tracking-[.3em] text-center`}
          />
          <button type="submit" className={SUBMIT} disabled={busy || code.length !== 6}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
          <div className="flex items-center justify-between pt-0.5">
            <button
              type="button"
              className={LINK}
              onClick={() => {
                setStep('email');
                setCode('');
                setError(null);
              }}
            >
              Use a different email
            </button>
            <button
              type="button"
              className={cooldown > 0 ? LINK_SPENT : LINK}
              disabled={busy || cooldown > 0}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await requestEmailCode(email.trim());
                  setCooldown(RESEND_COOLDOWN_SECONDS);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Could not resend the code.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </button>
          </div>
        </>
      )}
      {error && <div className="font-sans text-ui-base text-danger-text">{error}</div>}
    </form>
  );
}
