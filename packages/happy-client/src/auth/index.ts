// NOTE: credentials.ts is deliberately NOT re-exported here — it shells out
// to `node:child_process` (macOS `security` CLI) and would break any
// browser/webview bundle (e.g. happydeck's Vite build) that imports this
// barrel or the package root. Node-based tooling (the verification scripts)
// imports it directly: `from '../src/auth/credentials'`.
export * from './link';
export * from './token';
