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
//!
//! Finding the binary is the whole difficulty here, and it is different on
//! each platform — see `resolve_claude_path`'s two cfg branches.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

/// Caches the resolved `claude` binary path across calls so the PATH probe in
/// `resolve_claude_path` below only runs once per app launch.
pub struct ClaudePath(pub Mutex<Option<PathBuf>>);

/// `HOME` is not set for a GUI-launched process on Windows — that's
/// `USERPROFILE` there. Used both to build candidate paths and as the
/// subprocess's cwd.
fn home_dir() -> Result<String, String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "neither HOME nor USERPROFILE is set".to_string())
}

/// Base `Command` with the platform's "don't flash a console window" flag
/// applied. Without `CREATE_NO_WINDOW` on Windows, every poll (and every
/// `where` probe) pops a visible console window in front of the user — once
/// every 3 minutes, forever.
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
/// `Command::new("claude")` that works fine from a terminal (where this was
/// verified) can silently fail to spawn at all from the packaged app. Same
/// class of bug as `dragDropEnabled` (see this project's own dev-workflow
/// notes): works everywhere it's tested except the one place that matters.
/// Falling back to a login shell (`$SHELL -lc 'command -v claude'`) sources
/// the user's actual profile and therefore sees whatever PATH their own
/// terminal sees, covering nvm/asdf/custom-prefix installs the fixed list
/// doesn't anticipate.
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

/// Windows needs a completely different strategy, and a bare
/// `Command::new("claude")` fails here for a reason that has nothing to do
/// with PATH: Rust's `Command` appends only `.exe` when resolving a bare
/// program name — it does NOT consult `PATHEXT` — so an npm-shim install
/// (`claude.cmd`) is invisible to it even when `claude` runs fine in the
/// user's own terminal. That is exactly the failure reported against v0.4.0
/// ("failed to launch claude at claude: program not found").
///
/// Unlike macOS, a GUI-launched process on Windows DOES inherit the full
/// user+system PATH from the registry, so there's no login-shell dance
/// needed — `where.exe` (which honours PATHEXT) is the reliable probe. The
/// fixed candidates are only there to skip a subprocess in the common cases.
#[cfg(target_os = "windows")]
fn resolve_claude_path(home: &str) -> PathBuf {
    let mut candidates = vec![PathBuf::from(home).join(r".local\bin\claude.exe")];
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        candidates.push(PathBuf::from(&local_app_data).join(r"Programs\claude\claude.exe"));
    }
    if let Ok(app_data) = std::env::var("APPDATA") {
        // npm's global bin dir. Confirmed against a real affected install
        // (`where claude` there returns only an extensionless bash script and
        // `claude.cmd` — no .exe at all), so the .cmd entry is the one that
        // actually resolves; the .exe is listed first for a native install
        // that happens to sit in the same directory.
        candidates.push(PathBuf::from(&app_data).join(r"npm\claude.exe"));
        candidates.push(PathBuf::from(&app_data).join(r"npm\claude.cmd"));
    }
    for candidate in candidates {
        if candidate.is_file() {
            return candidate;
        }
    }
    // `where` prints EVERY match, one per line, and the order it prints them
    // is not a preference order. An npm global install produces two entries:
    // an extensionless `claude` (a bash shell script, for Git Bash/WSL) and
    // `claude.cmd` (the Windows shim) — and the bash script sorts FIRST.
    // CreateProcess cannot launch a shell script, so taking the first line
    // would pick the one file here that definitely does not work. Filter to
    // what Windows can actually execute, preferring a real .exe.
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

/// Runs on `spawn_blocking`'s dedicated pool, not an async-runtime worker —
/// `Command::output()` blocks the calling OS thread for the whole ~3.5s
/// subprocess lifetime (measured live), and every other command in this
/// codebase is synchronous today, so nothing else is set up to tolerate a
/// worker thread blocking that long.
fn run_claude_usage(cached_path: Option<PathBuf>, home: String) -> (Result<String, String>, Option<PathBuf>) {
    let path = cached_path.unwrap_or_else(|| resolve_claude_path(&home));

    // A `.cmd` is a batch script rather than an image CreateProcess can
    // launch, but this deliberately does NOT wrap it in `cmd.exe /C` by
    // hand: since Rust 1.77.2 (hardened again in 1.81.0) `Command` detects a
    // .bat/.cmd program and routes it through cmd.exe itself, applying the
    // cmd-specific argument escaping that CVE-2024-24576 was filed over.
    // Wrapping it manually would hand cmd.exe's parser arguments quoted by
    // the ordinary MSVCRT rules instead — re-creating exactly the mismatch
    // that CVE describes. Let std do it.
    let output = quiet_command(&path)
        .arg("-p")
        .arg("/usage")
        .arg("--output-format")
        .arg("json")
        .current_dir(&home)
        .output();

    let output = match output {
        Ok(output) => output,
        // The cached path stopped working (e.g. `claude update` moved the
        // binary) — drop the cache so the next call re-resolves instead of
        // repeating the same failure forever.
        Err(e) => return (Err(format!("failed to launch claude at {}: {e}", path.display())), None),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        // Returns None for the path so the next call re-resolves: a batch
        // shim whose target has moved reports "not recognized" on stderr with
        // a non-zero status rather than failing to spawn, so a stale cache
        // has to be dropped from this branch too, not just the spawn-error
        // one above.
        let message = if stderr.is_empty() {
            format!("claude at {} exited with {}", path.display(), output.status)
        } else {
            stderr
        };
        return (Err(message), None);
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
    let home = home_dir()?;
    let cached = state.0.lock().unwrap().clone();

    let (result, resolved_path) = tauri::async_runtime::spawn_blocking(move || run_claude_usage(cached, home))
        .await
        .map_err(|e| e.to_string())?;

    *state.0.lock().unwrap() = resolved_path;
    result
}
