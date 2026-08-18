import { useEffect, useState } from 'react';

/** Delays adopting a new value until it's stayed the same for `delayMs` — smooths a burst of rapid changes into one settled update instead of visibly flickering through every intermediate one. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
