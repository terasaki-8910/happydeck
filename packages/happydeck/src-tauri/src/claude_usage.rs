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
//! The frontend does the interpretation (see src/lib/claudeUsage.ts) so
//! the mapping stays unit-testable without a Tauri runtime; this module
//! only extracts the subtree.

use serde::Deserialize;
use std::path::{Path, PathBuf};

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

#[cfg(test)]
mod tests {
    use super::*;

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
