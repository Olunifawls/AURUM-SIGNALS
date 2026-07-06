'use client';

import { useEffect, useState } from 'react';
import { useTheme } from './ThemeProvider';

/** Day/night toggle. Persists via ThemeProvider (localStorage). Theme-dependent
 * content is gated until mount so server and client hydration match (no mismatch). */
export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = theme === 'dark';

  return (
    <button
      onClick={toggle}
      aria-label={!mounted ? 'Toggle theme' : dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={!mounted ? 'Toggle theme' : dark ? 'Light mode' : 'Dark mode'}
      className="rounded px-2 py-1.5 text-sm text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-100"
    >
      {!mounted ? '◐' : dark ? '☀️' : '🌙'}
    </button>
  );
}
