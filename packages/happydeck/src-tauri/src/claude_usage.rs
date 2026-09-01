//! Shells out to the `claude` CLI to read Claude Code's account-wide usage
//! limits (5-hour rolling session window + weekly window(s)). There is no
//! documented API or CLI flag for this — `/usage` is a REPL-only slash
//! command — but `claude -p "/usage" --output-format json` was confirmed
//! (live, on this machine) to run it non-interactively: the JSON envelope's
//! `result` field holds exactly the same prose `/usage` prints, `total_cost_usd`
//! is 0 (it does not consume the subscription it's reporting on), and it
//! writes no session transcript. Parsing that prose happens on the TS side
//! (see src/lib/claudeUsage.ts) so the parser itself stays unit-testable
//! without a Tauri runtime — this module's only job is getting the raw
//! stdout back.

use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

/// Caches the resolved `claude` binary path across calls so the PATH/login-shell
/// probe in `resolve_claude_path` below only runs once per app launch.
pub struct ClaudePath(pub Mutex<Option<PathBuf>>);

/// Fixed install locations to check before falling back to a login shell —
/// covers the overwhelming majority of macOS installs without paying for a
/// subprocess on every cache miss.
fn candidate_paths(home: &str) -> Vec<PathBuf> {
    vec![
        PathBuf::from(home).join(".local/bin/claude"),
        PathBuf::from("/opt/homebrew/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
    ]
}

/// A GUI-launched Tauri app inherits macOS's minimal system PATH
/// (`/etc/paths` + `/etc/paths.d`), not the user's shell profile — a bare
/// `Command::new("claude")` that works fine from a terminal (where this was
/// verified) can silently fail to spawn at all from the packaged app. Same
/// class of bug as `dragDropEnabled` (see this project's own dev-workflow
/// notes): works everywhere it's tested except the one place that matters.
/// Falling back to a login shell (`$SHELL -lc 'command -v claude'`) sources
/// the user's actual profile and therefore sees whatever PATH their own
/// terminal sees, covering nvm/asdf/custom-prefix installs the fixed list
/// above doesn't anticipate.
fn resolve_claude_path(home: &str) -> PathBuf {
    for candidate in candidate_paths(home) {
        if candidate.is_file() {
            return candidate;
        }
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    if let Ok(output) = Command::new(&shell).arg("-lc").arg("command -v claude").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return PathBuf::from(path);
            }
        }
    }
    PathBuf::from("claude")
}

/// Runs on `spawn_blocking`'s dedicated pool, not an async-runtime worker —
/// `Command::output()` blocks the calling OS thread for the whole ~3.5s
/// subprocess lifetime (measured live), and every other command in this
/// codebase is synchronous today, so nothing else is set up to tolerate a
/// worker thread blocking that long.
fn run_claude_usage(cached_path: Option<PathBuf>, home: String) -> (Result<String, String>, Option<PathBuf>) {
    let path = cached_path.unwrap_or_else(|| resolve_claude_path(&home));

    let output = Command::new(&path).arg("-p").arg("/usage").arg("--output-format").arg("json").current_dir(&home).output();

    let output = match output {
        Ok(output) => output,
        // The cached path stopped working (e.g. `claude update` moved the
        // binary) — drop the cache so the next call re-resolves instead of
        // repeating the same failure forever.
        Err(e) => return (Err(format!("failed to launch claude at {}: {e}", path.display())), None),
    };

    if !output.status.success() {
        return (Err(String::from_utf8_lossy(&output.stderr).trim().to_string()), Some(path));
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return (Err("claude -p \"/usage\" produced no output".to_string()), Some(path));
    }
    (Ok(stdout), Some(path))
}

/// Returns the raw stdout of `claude -p "/usage" --output-format json` (a
/// JSON envelope; see module doc). The frontend parses it — this command
/// deliberately does no interpretation of the payload.
#[tauri::command]
pub async fn claude_usage(state: tauri::State<'_, ClaudePath>) -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let cached = state.0.lock().unwrap().clone();

    let (result, resolved_path) = tauri::async_runtime::spawn_blocking(move || run_claude_usage(cached, home))
        .await
        .map_err(|e| e.to_string())?;

    *state.0.lock().unwrap() = resolved_path;
    result
}
