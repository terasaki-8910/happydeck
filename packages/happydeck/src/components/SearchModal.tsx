import { useEffect, useMemo, useState } from 'react';
import { useT } from '../lib/i18n';
import { searchSessions } from '../lib/search';
import { useHappyStore } from '../store/happyStore';
import { useViewStore } from '../store/viewStore';

interface SearchModalProps {
  onClose: () => void;
}

/**
 * Cmd+F — searches session titles/paths and message text across every
 * already-loaded session, including ones on a currently-offline machine
 * (there's nothing else to search against for those; this never issues a
 * new network request, it's pure client-side filtering over what's already
 * in the store). A message beyond what's currently loaded for a session
 * (see loadOlderMessages) isn't searchable until that page is fetched.
 */
export function SearchModal({ onClose }: SearchModalProps) {
  const t = useT();
  const sessions = useHappyStore((s) => s.sessions);
  const focusSession = useViewStore((s) => s.focusSession);
  const [query, setQuery] = useState('');

  const results = useMemo(() => searchSessions(sessions, query), [sessions, query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const select = (sessionId: string) => {
    focusSession(sessionId);
    onClose();
  };

  return (
    <div className="confirm-backdrop search-backdrop" onClick={onClose}>
      <div className="search-dialog" onClick={(event) => event.stopPropagation()}>
        <input
          autoFocus
          type="text"
          className="search-input"
          placeholder={t('searchPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="search-results">
          {query.trim() !== '' && results.length === 0 && <p className="search-empty">{t('searchNoResults')}</p>}
          {results.map((result, index) => (
            <button
              key={`${result.session.id}-${index}`}
              type="button"
              className="search-result"
              onClick={() => select(result.session.id)}
            >
              <div className="search-result-header">
                {result.host && <span className="search-result-host">{result.host}</span>}
                <span className="search-result-title">{result.title}</span>
              </div>
              {result.snippet.match && (
                <div className="search-result-snippet">
                  {result.snippet.before}
                  <strong>{result.snippet.match}</strong>
                  {result.snippet.after}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
