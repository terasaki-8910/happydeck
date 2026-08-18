fn main() {
    // Without this, Cargo has no reason to know an icon-only change (no .rs
    // touched) should trigger a rebuild — tauri_build::build() embeds the
    // icons at compile time, so a stale cached binary silently keeps
    // shipping the OLD icon indefinitely otherwise. Confirmed happening:
    // the icon fix landed on disk while the running dev binary's mtime
    // stayed over an hour older, across multiple `tauri dev` restarts.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
