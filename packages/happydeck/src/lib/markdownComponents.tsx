import { openUrl } from '@tauri-apps/plugin-opener';
import type { Components } from 'react-markdown';

/**
 * Shared react-markdown component overrides.
 *
 * The only one so far is <a>: a bare anchor navigates the WEBVIEW to the
 * target, which in a Tauri app means the whole application is replaced by
 * that web page — no back button, no browser chrome, nothing to return
 * with. (src-tauri/src/lib.rs's navigation_guard refuses that navigation
 * as a backstop, but relying on it alone would make every link look
 * broken rather than useful.) Handing the URL to the OS browser is what
 * the user actually wants from a link inside a desktop app, and matches
 * what the sidebar's own GitHub button already does.
 */
export const markdownComponents: Components = {
  a({ href, children, ...rest }) {
    // A relative/anchor link has nothing meaningful to open externally —
    // leave it inert rather than launching a browser at a bad URL.
    const isExternal = Boolean(href && /^(https?|mailto):/i.test(href));
    return (
      <a
        {...rest}
        href={href}
        // Belt and braces: even though onClick preventDefaults, an href
        // that never resolves in-webview means a middle-click or a
        // "copy link" still behaves sensibly.
        onClick={(event) => {
          if (!isExternal || !href) return;
          event.preventDefault();
          void openUrl(href);
        }}
      >
        {children}
      </a>
    );
  },
};
