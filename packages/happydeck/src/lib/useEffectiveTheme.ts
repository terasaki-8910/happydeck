import { useEffect, useState } from 'react';
import { useSettingsStore } from '../store/settingsStore';

/**
 * The theme setting can be 'system', in which case App.tsx deliberately
 * leaves document.documentElement.dataset.theme unset and lets CSS's own
 * `prefers-color-scheme` media query handle it — there's no DOM state to
 * read for "system". Anything that needs to pick between a light-mode and
 * dark-mode ASSET (not just CSS, which the media query already covers)
 * has to resolve 'system' itself, and stay live if the OS appearance
 * changes while the window is open.
 */
export function useEffectiveTheme(): 'light' | 'dark' {
  const theme = useSettingsStore((s) => s.theme);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  if (theme === 'system') return systemPrefersDark ? 'dark' : 'light';
  return theme;
}
