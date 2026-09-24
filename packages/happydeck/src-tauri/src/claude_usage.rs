//! Reads Claude Code's account-wide usage limits (5-hour rolling session
//! window + weekly window(s)) directly out of `~/.claude.json`.
//!
//! The CLI keeps its own copy of the numbers `/usage` prints, under the
//! top-level `cachedUsageUtilization` key, and refreshes it from the
//! account API while any Claude Code session is running. Reading it is a
//! file read: no subprocess, sub-millisecond, and the data is already
//! structured (`utilization.limits[]`), so nothing has to parse English
//! prose that a CLI release can reword without notice.
//!
//! This replaced spawning `claude -p "/usage" --output-format json` on
//! every poll (how v0.4.x–0.5.1 did it). That worked, but each poll booted
//! an entire Node + CLI process — ~3.5s wall time, and a ~3KB empty
//! session transcript left behind in `~/.claude/projects` every time. At
//! the old 3-minute cadence that was 500+ processes and 500+ junk
//! transcripts a day, for three integers.
//!
//! Deliberately no CLI fallback when the key is absent: the one confirmed
//! real-world case of missing usage data (a Windows machine, 2026-09-03)
//! was a stale login, which the subprocess path did not fix either — it
//! reported a cost summary instead. Re-login fixed both.
//!
//! BUT the cache does have to be refreshable, which is what
//! `refresh_claude_usage` below is for — see its own doc for the measured
//! reason. Both of the old cost concerns turned out to be independently
//! fixable rather than inherent to the subprocess itself (verified live,
//! 2026-09-24, not assumed):
//!
//! - Credits: `claude -p "/usage"` reports `total_cost_usd: 0` and every
//!   `usage.*_tokens` field at 0, across repeated clean runs. It never drew
//!   on the account's quota to begin with — the earlier framing of a
//!   refresh "costing" something conflated this with the two costs below,
//!   which are real but unrelated to the user's plan limits.
//! - The junk transcript: still real per call, but avoidable. Passing a
//!   fresh `--session-id` names exactly which transcript file this call
//!   produced, so `refresh_claude_usage` deletes it immediately after —
//!   nothing accumulates. (`--session-id` reuse errors with "already in
//!   use" — confirmed live — so each call needs its own, which is exactly
//!   what makes the resulting file unambiguous to clean up.)
//! - Wall time (~3.7s measured): irreducible — it is a real Node + CLI
//!   boot — but no longer compounds into either of the above, so a
//!   several-times-a-minute cadence is no longer the same tradeoff the
//!   2026-09-08 rewrite was reacting to.
//!
//! The frontend does the interpretation (see src/lib/claudeUsage.ts) so
//! the mapping stays unit-testable without a Tauri runtime; this module
//! only extracts the subtree.

use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use uuid::Uuid;

/// `~/.claude.json` is rewritten wholesale by the CLI — and often, for
/// reasons unrelated to usage (project history, MCP state; its mtime is
/// routinely newer than the usage cache's own `fetchedAtMs`). A read
/// landing mid-write returns truncated bytes that fail to parse. That
/// window is milliseconds, so a couple of short retries turn the race into
/// a non-event rather than a visible gap in the badge.
const READ_ATTEMPTS: usize = 4;
const RETRY_DELAY_MS: u64 = 40;

/// Stable, machine-matchable failure codes. The frontend localizes these
/// (see src/lib/errorMessages.ts); anything unrecognized there falls
/// through to the raw string, so adding a code is not a breaking change.
const MISSING_FILE: &str = "missing-file";
const NO_USAGE_DATA: &str = "no-usage-data";

/// Only the one key matters. Serde walks the whole ~180KB document either
/// way, but skipping unknown fields instead of materializing them keeps
/// this off the allocator — and, more to the point, keeps the rest of that
/// file (every project path, history entry and MCP server the user has
/// ever configured) out of the IPC payload.
#[derive(Deserialize)]
struct ClaudeConfig {
    #[serde(rename = "cachedUsageUtilization")]
    cached_usage_utilization: Option<serde_json::Value>,
}

/// `HOME` is not set for a GUI-launched process on Windows — that's
/// `USERPROFILE` there.
fn home_dir() -> Result<String, String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "neither HOME nor USERPROFILE is set".to_string())
}

fn read_usage_json(path: &Path) -> Result<String, String> {
    let mut last_parse_error: Option<String> = None;

    for attempt in 0..READ_ATTEMPTS {
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_millis(RETRY_DELAY_MS));
        }

        let text = match std::fs::read_to_string(path) {
            Ok(text) => text,
            // Not retried: a missing config file is a stable state (Claude
            // Code has never run for this user), not a torn write.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(MISSING_FILE.to_string()),
            Err(e) => return Err(format!("unreadable: {e}")),
        };

        match serde_json::from_str::<ClaudeConfig>(&text) {
            Ok(config) => {
                return match config.cached_usage_utilization {
                    Some(value) => serde_json::to_string(&value).map_err(|e| format!("unreadable: {e}")),
                    None => Err(NO_USAGE_DATA.to_string()),
                }
            }
            Err(e) => last_parse_error = Some(e.to_string()),
        }
    }

    // Every attempt saw invalid JSON. Reported rather than swallowed, but
    // the frontend keeps its last good numbers on screen — see
    // src/store/usageStore.ts.
    Err(format!("corrupt: {}", last_parse_error.unwrap_or_default()))
}

/// Returns `cachedUsageUtilization` from `~/.claude.json`, re-serialized.
/// The frontend maps it to windows — this command does no interpretation.
#[tauri::command]
pub async fn claude_usage() -> Result<String, String> {
    let path = PathBuf::from(home_dir()?).join(".claude.json");

    // On `spawn_blocking`'s pool rather than an async worker: the read
    // itself is sub-millisecond, but the retry loop above can sleep up to
    // ~120ms, and blocking a runtime worker for that is not free.
    tauri::async_runtime::spawn_blocking(move || read_usage_json(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// Caches the resolved `claude` binary path across calls so the PATH probe
/// in `resolve_claude_path` only runs once per app launch. Only
/// `refresh_claude_usage` uses it — the ordinary read path is a plain file
/// read and needs no binary at all.
pub struct ClaudePath(pub Mutex<Option<PathBuf>>);

/// Base `Command` with the platform's "don't flash a console window" flag
/// applied. Without `CREATE_NO_WINDOW` on Windows, a refresh (and the
/// `where` probe) pops a visible console window in front of the user.
fn quiet_command(program: &Path) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// A GUI-launched Tauri app inherits macOS's minimal system PATH
/// (`/etc/paths` + `/etc/paths.d`), not the user's shell profile — a bare
/// `Command::new("claude")` that works fine from a terminal can silently
/// fail to spawn from the packaged app. Falling back to a login shell
/// (`$SHELL -lc 'command -v claude'`) sources the user's actual profile and
/// therefore sees whatever PATH their own terminal sees, covering
/// nvm/asdf/custom-prefix installs the fixed list doesn't anticipate.
#[cfg(not(target_os = "windows"))]
fn resolve_claude_path(home: &str) -> PathBuf {
    let candidates = [
        PathBuf::from(home).join(".local/bin/claude"),
        PathBuf::from("/opt/homebrew/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
    ];
    for candidate in candidates {
        if candidate.is_file() {
            return candidate;
        }
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    if let Ok(output) = Command::new(&shell).arg("-lc").arg("command -v claude").output() {
        if output.status.success() {
            if let Some(line) = String::from_utf8_lossy(&output.stdout).lines().next() {
                let path = line.trim();
                if !path.is_empty() {
                    return PathBuf::from(path);
                }
            }
        }
    }
    PathBuf::from("claude")
}

/// Windows needs a different strategy, and a bare `Command::new("claude")`
/// fails here for a reason unrelated to PATH: Rust's `Command` appends only
/// `.exe` when resolving a bare program name — it does NOT consult
/// `PATHEXT` — so an npm-shim install (`claude.cmd`) is invisible to it even
/// when `claude` runs fine in the user's own terminal. That was exactly the
/// failure reported against v0.4.0 ("program not found").
///
/// Unlike macOS, a GUI-launched process on Windows DOES inherit the full
/// user+system PATH from the registry, so no login-shell dance is needed —
/// `where.exe` (which honours PATHEXT) is the reliable probe.
#[cfg(target_os = "windows")]
fn resolve_claude_path(home: &str) -> PathBuf {
    let mut candidates = vec![PathBuf::from(home).join(r".local\bin\claude.exe")];
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        candidates.push(PathBuf::from(&local_app_data).join(r"Programs\claude\claude.exe"));
    }
    if let Ok(app_data) = std::env::var("APPDATA") {
        candidates.push(PathBuf::from(&app_data).join(r"npm\claude.exe"));
        candidates.push(PathBuf::from(&app_data).join(r"npm\claude.cmd"));
    }
    for candidate in candidates {
        if candidate.is_file() {
            return candidate;
        }
    }
    // `where` prints EVERY match, one per line, and that order is not a
    // preference order. An npm global install produces both an
    // extensionless `claude` (a bash script, for Git Bash/WSL) and
    // `claude.cmd` — and the bash script sorts FIRST. CreateProcess cannot
    // launch a shell script, so taking the first line would pick the one
    // file here that definitely does not work.
    if let Ok(output) = quiet_command(Path::new("where")).arg("claude").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let runnable: Vec<&str> = stdout
                .lines()
                .map(str::trim)
                .filter(|line| {
                    let lower = line.to_ascii_lowercase();
                    lower.ends_with(".exe") || lower.ends_with(".cmd") || lower.ends_with(".bat")
                })
                .collect();
            if let Some(exe) = runnable.iter().find(|m| m.to_ascii_lowercase().ends_with(".exe")) {
                return PathBuf::from(exe);
            }
            if let Some(first) = runnable.first() {
                return PathBuf::from(first);
            }
        }
    }
    PathBuf::from("claude")
}

/// Claude Code stores a session's transcript at
/// `~/.claude/projects/<slug>/<session-id>.jsonl`, where `<slug>` is the
/// process's cwd with every path separator rewritten to `-` (confirmed
/// live, 2026-09-24: cwd `/Users/masa669` produced folder `-Users-masa669`,
/// exactly). Reconstructing it from the disposable `--session-id` this
/// module itself generated means cleanup only ever targets a file THIS
/// call produced — never a real conversation's history — even in the
/// failure paths below, where best-effort is enough: worst case a file
/// gets left behind, exactly like before this existed.
fn transcript_path(home: &str, session_id: &Uuid) -> PathBuf {
    let slug: String = home.chars().map(|c| if c == '/' || c == '\\' { '-' } else { c }).collect();
    Path::new(home).join(".claude").join("projects").join(slug).join(format!("{session_id}.jsonl"))
}

fn run_usage_refresh(cached_path: Option<PathBuf>, home: String) -> (Result<(), String>, Option<PathBuf>) {
    let path = cached_path.unwrap_or_else(|| resolve_claude_path(&home));

    // A fresh id per call, not reused: confirmed live that `--session-id`
    // errors ("already in use") the second time the same one names an
    // existing transcript — which is exactly what makes the file this call
    // produces unambiguous to find and delete afterward.
    let session_id = Uuid::new_v4();
    let transcript = transcript_path(&home, &session_id);

    // A `.cmd` is a batch script rather than an image CreateProcess can
    // launch, but this deliberately does NOT wrap it in `cmd.exe /C` by
    // hand: since Rust 1.77.2 `Command` detects a .bat/.cmd program and
    // routes it through cmd.exe itself, applying the cmd-specific argument
    // escaping that CVE-2024-24576 was filed over. Let std do it.
    let output = quiet_command(&path)
        .arg("-p")
        .arg("/usage")
        .arg("--output-format")
        .arg("json")
        .arg("--session-id")
        .arg(session_id.to_string())
        .current_dir(&home)
        .output();

    let output = match output {
        Ok(output) => output,
        // The cached path stopped working (e.g. `claude update` moved the
        // binary) — drop the cache so the next call re-resolves instead of
        // repeating the same failure forever.
        Err(e) => return (Err(format!("failed to launch claude at {}: {e}", path.display())), None),
    };

    // Best-effort regardless of outcome below: a failed run can still have
    // written a partial transcript before erroring.
    let _ = std::fs::remove_file(&transcript);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        // Also drops the cached path: a batch shim whose target has moved
        // reports "not recognized" on stderr with a non-zero status rather
        // than failing to spawn, so a stale cache has to be dropped here too.
        let message = if stderr.is_empty() {
            format!("claude at {} exited with {}", path.display(), output.status)
        } else {
            stderr
        };
        return (Err(message), None);
    }

    // stdout is deliberately discarded. The command's whole value is its
    // SIDE EFFECT — it makes the CLI re-fetch the account API and rewrite
    // `cachedUsageUtilization` — after which the ordinary `claude_usage`
    // read above picks the fresh numbers up in structured form. Parsing the
    // envelope's English prose is what this module moved away from.
    (Ok(()), Some(path))
}

/// Forces Claude Code to re-fetch its usage numbers, then returns; the
/// caller re-reads `claude_usage` for the result.
///
/// Needed because nothing else in this user's workflow refreshes that
/// cache. Measured on this Mac (2026-09-24): `~/.claude.json`'s mtime was
/// current to the second while `cachedUsageUtilization.fetchedAtMs` sat
/// 12 hours stale — the CLI rewrites the file constantly for unrelated
/// reasons but only refreshes the usage key on its own schedule. A plain
/// `claude -p "hi"` did NOT move `fetchedAtMs`; `claude -p "/usage"` did
/// (11:52 → 00:00), which is why it specifically is the command here.
///
/// Sessions driven through happy-cli's SDK wrapper — i.e. every session
/// this app launches — never trigger that refresh, so a 5-hour window
/// silently passes its `resets_at` and renders "—" indefinitely with no
/// way for the user to recover it.
///
/// Does not touch the account's usage quota (see the module doc's
/// verification) and leaves no transcript behind (`run_usage_refresh`
/// deletes the one it names), so this is safe to call on a short periodic
/// timer, not just the explicit "refresh now" action — see
/// src/store/usageStore.ts for that cadence.
#[tauri::command]
pub async fn refresh_claude_usage(state: tauri::State<'_, ClaudePath>) -> Result<(), String> {
    let home = home_dir()?;
    let cached = state.0.lock().unwrap().clone();

    // On `spawn_blocking`'s pool, not an async worker: `Command::output()`
    // blocks its OS thread for the subprocess's entire multi-second life.
    let (result, resolved_path) = tauri::async_runtime::spawn_blocking(move || run_usage_refresh(cached, home))
        .await
        .map_err(|e| e.to_string())?;

    *state.0.lock().unwrap() = resolved_path;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Locks in the slug rule confirmed live against a real `claude`
    /// invocation (2026-09-24): cwd `/Users/masa669` produced the transcript
    /// folder `-Users-masa669`, i.e. every `/` becomes `-`, nothing else
    /// changes. If a future CLI version slugifies differently, this is the
    /// test that should catch cleanup silently stopping (it fails open —
    /// see run_usage_refresh's own doc — so nothing else would).
    #[test]
    fn transcript_path_matches_the_cli_slug_rule() {
        let id = Uuid::nil();
        let path = transcript_path("/Users/masa669", &id);
        assert_eq!(path, PathBuf::from("/Users/masa669/.claude/projects/-Users-masa669/00000000-0000-0000-0000-000000000000.jsonl"));
    }

    /// A plain temp path plus cleanup — no dev-dependency for something this
    /// small, and each test names its own file so they can't collide.
    struct TempFile(PathBuf);

    impl TempFile {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!("happydeck-usage-test-{name}.json"));
            let _ = std::fs::remove_file(&path);
            Self(path)
        }
        fn write(&self, contents: &str) {
            std::fs::write(&self.0, contents).expect("write temp fixture");
        }
    }

    impl Drop for TempFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    #[test]
    fn extracts_only_the_usage_subtree() {
        let file = TempFile::new("subtree");
        // The neighbouring keys stand in for the ~180KB of project history,
        // MCP config and OAuth state the real file carries — none of which
        // should reach the frontend.
        file.write(r#"{"projects":{"/secret/path":{"history":["a"]}},"oauthAccount":{"emailAddress":"x@example.com"},"cachedUsageUtilization":{"fetchedAtMs":1,"utilization":{"limits":[{"kind":"session","percent":13}]}}}"#);

        let json = read_usage_json(&file.0).expect("reads");
        assert!(json.contains("\"percent\":13"));
        assert!(!json.contains("secret"));
        assert!(!json.contains("example.com"));
    }

    #[test]
    fn reports_a_missing_file_distinctly() {
        let missing = std::env::temp_dir().join("happydeck-usage-test-nonexistent.json");
        let _ = std::fs::remove_file(&missing);
        assert_eq!(read_usage_json(&missing), Err(MISSING_FILE.to_string()));
    }

    #[test]
    fn reports_a_config_without_the_usage_key_distinctly() {
        let file = TempFile::new("nokey");
        file.write(r#"{"projects":{},"numStartups":42}"#);
        assert_eq!(read_usage_json(&file.0), Err(NO_USAGE_DATA.to_string()));
    }

    #[test]
    fn gives_up_with_corrupt_after_exhausting_retries() {
        let file = TempFile::new("torn");
        // What a read landing mid-rewrite actually sees: the leading bytes
        // of a valid document, cut off.
        file.write(r#"{"cachedUsageUtilization":{"fetchedAtMs":1,"utiliz"#);

        let result = read_usage_json(&file.0);
        assert!(matches!(result, Err(ref e) if e.starts_with("corrupt:")), "got {result:?}");
    }

    #[test]
    fn recovers_when_a_later_retry_sees_a_complete_file() {
        let file = TempFile::new("recovers");
        file.write(r#"{"cachedUsageUtilization":{"fetchedAtMs":1,"utiliz"#);

        // Repairs the file after the first attempt has already failed —
        // the case the retry loop exists for.
        let path = file.0.clone();
        let repair = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(RETRY_DELAY_MS / 2));
            std::fs::write(&path, r#"{"cachedUsageUtilization":{"fetchedAtMs":1}}"#).expect("repair");
        });

        let result = read_usage_json(&file.0);
        repair.join().expect("repair thread");
        assert_eq!(result, Ok(r#"{"fetchedAtMs":1}"#.to_string()));
    }
}
