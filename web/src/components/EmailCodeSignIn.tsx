import { useEffect, useRef, useState } from 'react';
import { navigate } from '@reach/router';
import { useAuth } from '../context/AuthContext';

// Sign in with a code emailed to the user — two steps on one card: address, then the six digits
// that arrive. Nothing here navigates away, which is the whole reason this exists alongside the
// OAuth button: an installed PWA can complete it without the OS handing the session to a browser
// (see worker/src/emailAuth.js).

const FIELD =
  'w-full h-10 px-3 rounded-field border border-ink/[.18] bg-transparent font-sans text-[14px] placeholder:text-ink/35';
const SUBMIT =
  'flex items-center justify-center gap-1.5 w-full h-10 rounded-field bg-accent text-[#FBFAF7] font-sans text-[13.5px] font-medium disabled:opacity-50';
const LINK = 'font-sans text-[12.5px] text-ink/55 underline decoration-ink/25 underline-offset-2';
const LINK_SPENT = 'font-sans text-[12.5px] text-ink/35';

// Matches RESEND_COOLDOWN_MS in worker/src/emailAuth.js, where a request inside the window is
// accepted and deliberately not sent — the outstanding code is still valid, and a second one would
// only make it ambiguous which to type. Counting down here is what makes that legible: without it
// the button is live, does nothing visible, and reads as broken.
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
        // Signed in without ever leaving the page, so nothing has moved us off Settings — go
        // where the user was when they were sent here.
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
          <div className="font-sans text-[13px] text-ink/60">
            We sent a six-digit code to <span className="text-ink/85">{email.trim()}</span>. It expires in 10 minutes.
          </div>
          <input
            ref={codeRef}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            aria-label="Six-digit code"
            // inputMode/autoComplete are what let a phone offer the code from the notification
            // rather than making the user switch to their mail app and back.
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            className={`${FIELD} tracking-[.3em] text-center`}
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
      {error && <div className="font-sans text-[13px] text-red-600">{error}</div>}
    </form>
  );
}
