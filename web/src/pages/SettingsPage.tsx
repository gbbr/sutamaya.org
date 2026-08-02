import { navigate, type RouteComponentProps } from '@reach/router';
import { useAuth } from '../context/AuthContext';
import { dataApi } from '../lib/api';

export function SettingsPage(_props: RouteComponentProps) {
  const { user, logout, loading } = useAuth();

  if (loading) return null;

  return (
    <div className="min-h-screen bg-paper px-5 py-10 flex justify-center">
      <div className="w-full max-w-[420px]">
        <button className="font-sans text-[13px] text-ink/50 mb-6" onClick={() => navigate('/')}>
          ← Back
        </button>
        <div className="text-[22px] font-semibold tracking-[-.01em] mb-6">Settings</div>

        {user ? (
          <>
            <div className="font-sans text-[13px] text-ink/60 mb-1">Signed in as</div>
            <div className="text-[16px] mb-6">{user.email}</div>
            <a
              href={dataApi.exportUrl}
              className="block w-full text-center h-11 leading-[44px] rounded-field border border-ink/[.22] font-sans text-[14px] font-medium mb-3"
            >
              Export my data as JSON
            </a>
            <button
              className="w-full h-11 rounded-field bg-ink text-[#FBFAF7] font-sans text-[14px] font-medium"
              onClick={async () => {
                await logout();
                navigate('/');
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <>
            <div className="font-sans text-[14px] text-ink/60 mb-4">
              Sign in to sync your lists, notes and highlights across devices.
            </div>
            <button
              className="w-full h-11 rounded-field bg-ink text-[#FBFAF7] font-sans text-[14px] font-medium"
              onClick={() => navigate('/login')}
            >
              Sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
