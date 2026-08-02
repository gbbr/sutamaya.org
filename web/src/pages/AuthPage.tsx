import { useState, type FormEvent } from 'react';
import { navigate, type RouteComponentProps } from '@reach/router';
import { useAuth } from '../context/AuthContext';

interface AuthPageProps extends RouteComponentProps {
  mode: 'login' | 'register';
}

export function AuthPage({ mode }: AuthPageProps) {
  const { login, register, user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) {
    navigate('/');
    return null;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-paper px-5">
      <div className="w-full max-w-[360px]">
        <div className="text-[22px] font-semibold tracking-[-.01em] mb-6 text-center">Sutamaya</div>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="h-11 border border-ink/[.22] rounded-field px-3 bg-field text-[15px] outline-none"
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="h-11 border border-ink/[.22] rounded-field px-3 bg-field text-[15px] outline-none"
          />
          {error && <div className="font-sans text-[13px] text-[#A3453C]">{error}</div>}
          <button
            type="submit"
            disabled={busy}
            className="h-11 rounded-field bg-ink text-[#FBFAF7] text-[15px] font-medium font-sans disabled:opacity-50"
          >
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <div className="font-sans text-center text-[13px] text-ink/60 mt-4">
          {mode === 'login' ? (
            <>
              No account? <a href="/register" onClick={(e) => { e.preventDefault(); navigate('/register'); }}>Register</a>
            </>
          ) : (
            <>
              Have an account? <a href="/login" onClick={(e) => { e.preventDefault(); navigate('/login'); }}>Sign in</a>
            </>
          )}
        </div>
        <div className="font-sans text-center text-[12px] text-ink/40 mt-6">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>Continue browsing without an account</a>
        </div>
      </div>
    </div>
  );
}
