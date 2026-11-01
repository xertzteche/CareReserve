'use client'

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { loginAction } from '../actions';

const inputCls =
  'w-full bg-stone-100 border border-transparent rounded-xl px-4 py-3.5 text-sm font-medium text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-300 transition-all';

export default function LoginForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await loginAction(formData);
      // If loginAction calls redirect('/dashboard'), this code is never reached.
      // We only land here on an error return.
      if (result?.error) {
        setError(result.error);
      } else if (result?.success) {
        // Fallback client-side redirect if server redirect didn't fire
        router.push('/dashboard');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="username"
          className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1.5 ml-0.5"
        >
          Branch Username
        </label>
        <input
          id="username"
          type="text"
          name="username"
          placeholder="e.g. apollo_mumbai"
          autoComplete="username"
          className={inputCls}
          required
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1.5 ml-0.5"
        >
          Password
        </label>
        <input
          id="password"
          type="password"
          name="password"
          placeholder="••••••••"
          autoComplete="current-password"
          className={inputCls}
          required
        />
      </div>

      {/* Error callout */}
      {error && (
        <div className="bg-rose-50 border border-rose-100 rounded-xl px-4 py-3 text-xs font-medium text-rose-700">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full bg-teal-800 hover:bg-teal-900 disabled:bg-teal-800/60 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-2xl transition-all text-sm tracking-wide mt-2"
      >
        {isPending ? 'Verifying…' : 'Access Dashboard'}
      </button>
    </form>
  );
}

