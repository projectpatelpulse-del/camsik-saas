'use client';

import { FormEvent, useEffect, useState } from 'react';

type Mode = 'loading' | 'setup' | 'login';

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('loading');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/auth/status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setMode(d.setupRequired ? 'setup' : 'login'))
      .catch(() => setError('Cannot reach the server. Check that MongoDB is configured.'));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const endpoint = mode === 'setup' ? '/api/auth/setup' : '/api/auth/login';
      const body = mode === 'setup' ? { name, email, password } : { email, password };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.message || 'Sign-in failed');
        return;
      }
      window.location.assign('/');
    } catch {
      setError('Network error. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8 shadow-xl">
        <h1 className="text-xl font-semibold text-white">
          {mode === 'setup' ? 'Create the super admin account' : 'Super Admin sign in'}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {mode === 'setup'
            ? 'First-time setup. This screen closes permanently once an account exists.'
            : 'Access is restricted to platform operators.'}
        </p>

        {mode === 'loading' && <p className="mt-6 text-sm text-slate-400">Loading…</p>}

        {(mode === 'setup' || mode === 'login') && (
          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === 'setup' && (
              <label className="block text-sm text-slate-300">
                Name
                <input
                  className="mt-1 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-white"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </label>
            )}
            <label className="block text-sm text-slate-300">
              Email
              <input
                type="email"
                required
                className="mt-1 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-white"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Password
              <input
                type="password"
                required
                minLength={mode === 'setup' ? 12 : undefined}
                className="mt-1 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-white"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
              />
            </label>
            {mode === 'setup' && (
              <p className="text-xs text-slate-500">Minimum 12 characters.</p>
            )}
            {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-emerald-500 px-4 py-2 font-medium text-black disabled:opacity-60"
            >
              {busy ? 'Please wait…' : mode === 'setup' ? 'Create account' : 'Sign in'}
            </button>
          </form>
        )}
        {mode === 'loading' && error && <p role="alert" className="mt-4 text-sm text-rose-400">{error}</p>}
      </div>
    </main>
  );
}
