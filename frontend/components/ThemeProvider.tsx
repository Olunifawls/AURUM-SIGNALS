'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';
export const THEME_KEY = 'aurum-theme';

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'dark', toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initialise from the class the inline script (layout.tsx) already set on <html>
  // before paint — so hydration matches and there is no flash.
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document === 'undefined') return 'dark';
    return document.documentElement.classList.contains('light') ? 'light' : 'dark';
  });

  // Re-assert the saved theme class on <html> after hydration (React can reset the
  // html className during hydration; this guarantees the real .light/.dark vars apply).
  useEffect(() => {
    let saved: Theme = 'dark';
    try {
      const s = localStorage.getItem(THEME_KEY);
      if (s === 'light' || s === 'dark') saved = s;
    } catch {
      /* ignore */
    }
    const el = document.documentElement;
    el.classList.remove('light', 'dark');
    el.classList.add(saved);
    el.style.colorScheme = saved;
    setThemeState(saved);
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setThemeState(next);
    const el = document.documentElement;
    el.classList.remove('light', 'dark');
    el.classList.add(next);
    el.style.colorScheme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* private mode — non-fatal */
    }
  };

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
