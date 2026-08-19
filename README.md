# happydeck

A native desktop dashboard (Tauri v2, Mac/Windows/Linux) for monitoring and
controlling [Claude Code](https://claude.com/claude-code) sessions running via
[Happy](https://github.com/slopus/happy) across multiple machines on the same
network — one screen instead of SSHing into each machine's terminal
separately.

Reuses your existing Happy account (device-link once via QR code, same as the
mobile app) — no separate login, no server of its own. Talks directly to
Happy's own relay over the same end-to-end-encrypted protocol the CLI and
mobile app use.

## Packages

- **`packages/happydeck`** — the app itself (React + Vite + Tauri v2).
- **`packages/happy-client`** — clean-room TypeScript client for the Happy
  relay protocol (device-link auth, E2E crypto, sync). The shared core
  happydeck is built on; has its own test suite and CLI verification scripts
  independent of the UI.
- **`packages/happy-wire`** — shared message wire types and Zod schemas.
- **`packages/happy-app`** — a reference copy of the official Happy mobile
  app's source, kept for cross-checking protocol behavior. Not built or
  shipped as part of happydeck.

## Development

Requires Node >=24 and pnpm 11.12.0 (see root `package.json`).

```sh
pnpm install
pnpm --filter happydeck tauri dev
```

The first real run needs a one-time device link (QR code, scanned from your
phone's Happy app) — credentials are then stored in the macOS Keychain.

For UI work without touching the real account/relay/machines, run with the
mock data fixtures instead:

```sh
VITE_HAPPYDECK_MOCK=1 pnpm --filter happydeck exec vite
```

### Other useful commands

```sh
pnpm typecheck                        # every package
pnpm --filter happy-client test       # crypto/protocol test suite
pnpm --filter happydeck exec tsc --noEmit
```

## Installing a downloaded build

Release builds ([GitHub Releases](../../releases)) aren't code-signed with a
paid Apple Developer ID, so **macOS will refuse to open the app** after
downloading it through a browser, with an error like:

> "happydeck.app" is damaged and can't be opened. You should move it to the Trash.

This is **not actually about the app being broken**, and it isn't specific to
`.dmg` vs `.app.tar.gz` — either would hit the same thing. Any unsigned app
downloaded through a browser gets a `com.apple.quarantine` flag from macOS,
and Gatekeeper refuses to run an unsigned/ad-hoc-signed app carrying that
flag, misreporting it as "damaged" instead of showing the usual "are you sure
you want to open this?" prompt it shows for signed apps.

**Fix**: after extracting the `.app`, clear the quarantine flag from Terminal:

```sh
xattr -cr /path/to/happydeck.app
```

Then open it normally. You only need to do this once per downloaded copy.

(The real fix is enrolling in the Apple Developer Program and code-signing +
notarizing release builds in CI — not set up yet.)

## Releasing

Push a tag matching `happydeck-v*` (e.g. `happydeck-v0.1.0`) to trigger
[`.github/workflows/release.yml`](.github/workflows/release.yml), which
builds macOS/Windows/Linux in parallel and creates a **draft** GitHub Release
with the installers attached. Review it and publish manually when ready —
nothing is public until you do.
