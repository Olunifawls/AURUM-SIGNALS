'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../utils/supabase/client';
import type { User } from '@supabase/supabase-js';

/** Inline feedback badge (success / error). */
function StatusMsg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <p
      className={`mt-2 rounded-lg px-3 py-2 text-sm ${
        msg.ok
          ? 'border border-green-800/50 bg-green-950/40 text-green-400'
          : 'border border-red-800/50 bg-red-950/40 text-red-400'
      }`}
    >
      {msg.text}
    </p>
  );
}

/**
 * /profile — view/edit display name + email, change password, sign out.
 * Protected by middleware; never reachable when logged out.
 */
export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  // Account details form
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [detailsMsg, setDetailsMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingDetails, setSavingDetails] = useState(false);

  // Password change form
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  const [signingOut, setSigningOut] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) { router.push('/login'); return; }
    setUser(data.user);
    setEmail(data.user.email ?? '');
    setDisplayName((data.user.user_metadata?.display_name as string) ?? '');
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  async function handleSaveDetails(e: React.FormEvent) {
    e.preventDefault();
    setSavingDetails(true);
    setDetailsMsg(null);
    const supabase = createClient();
    const updates: { email?: string; data?: { display_name: string } } = {
      data: { display_name: displayName },
    };
    if (email !== user?.email) updates.email = email;
    const { error } = await supabase.auth.updateUser(updates);
    setDetailsMsg(
      error
        ? { ok: false, text: error.message }
        : { ok: true, text: email !== user?.email ? 'Details saved. Check your new email address for a confirmation link.' : 'Details saved.' },
    );
    setSavingDetails(false);
    if (!error) await load();
  }

  async function handleChangePw(e: React.FormEvent) {
    e.preventDefault();
    if (newPw !== confirmPw) {
      setPwMsg({ ok: false, text: 'Passwords do not match.' });
      return;
    }
    if (newPw.length < 8) {
      setPwMsg({ ok: false, text: 'Password must be at least 8 characters.' });
      return;
    }
    setSavingPw(true);
    setPwMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setPwMsg(
      error
        ? { ok: false, text: error.message }
        : { ok: true, text: 'Password changed. Sign in with the new password next time.' },
    );
    setSavingPw(false);
    if (!error) { setNewPw(''); setConfirmPw(''); }
  }

  async function handleSignOut() {
    setSigningOut(true);
    // POST to server-side signout so cookies are cleared properly.
    await fetch('/api/auth/signout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  if (!user) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-neutral-500">
        Loading…
      </div>
    );
  }

  const inputClass =
    'w-full rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-sm text-neutral-100 placeholder-neutral-500 transition focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/60';
  const btnPrimary =
    'rounded-lg bg-amber-500 px-5 py-2 text-sm font-semibold text-neutral-950 transition hover:bg-amber-400 disabled:opacity-50';

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Profile</h1>
        <p className="mt-1 text-sm text-neutral-400">{user.email}</p>
      </div>

      {/* ── Account details ── */}
      <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Account details
        </h2>
        <form onSubmit={handleSaveDetails} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-300">Display name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={inputClass}
              placeholder="Your name"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-300">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={inputClass}
            />
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={savingDetails} className={btnPrimary}>
              {savingDetails ? 'Saving…' : 'Save details'}
            </button>
          </div>
          <StatusMsg msg={detailsMsg} />
        </form>
      </section>

      {/* ── Change password ── */}
      <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Change password
        </h2>
        <form onSubmit={handleChangePw} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-300">New password</label>
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              required
              autoComplete="new-password"
              className={inputClass}
              placeholder="At least 8 characters"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-300">
              Confirm new password
            </label>
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              required
              autoComplete="new-password"
              className={inputClass}
            />
          </div>
          <button type="submit" disabled={savingPw} className={btnPrimary}>
            {savingPw ? 'Updating…' : 'Update password'}
          </button>
          <StatusMsg msg={pwMsg} />
        </form>
      </section>

      {/* ── Sign out ── */}
      <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Session
        </h2>
        <p className="mb-4 text-sm text-neutral-400">
          Signed in as <span className="text-neutral-200">{user.email}</span>
        </p>
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="rounded-lg border border-red-800/60 bg-red-950/30 px-5 py-2 text-sm font-semibold text-red-400 transition hover:bg-red-900/40 disabled:opacity-50"
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </section>
    </div>
  );
}
