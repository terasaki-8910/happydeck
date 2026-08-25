//! Positions the native traffic-light buttons ourselves, instead of going
//! through Tauri/wry's `trafficLightPosition` config.
//!
//! Why not just use `trafficLightPosition`: wry's own implementation
//! (wry-0.55.1's `inset_traffic_lights`, in
//! wkwebview/class/wry_web_view_parent.rs) only ever writes the configured
//! `x` onto each button's `frame.origin.x`. The configured `y` is used
//! *only* to grow the native title-bar container's height
//! (`container_height = button_height + y`, top edge pinned to the
//! window's top edge) -- the buttons' own `frame.origin.y` is never
//! touched, so they stay wherever AppKit's default (non-custom-height)
//! title bar originally put them. Centering them in a custom-height
//! titlebar this way only works via an undocumented, version-fragile
//! side effect (the container growing downward while the button's
//! *local* origin stays fixed shifts the button's on-screen position by
//! `y - <AppKit's internal default margin>`, a constant nobody publishes
//! and that isn't safe to hardcode).
//!
//! So instead: resize the container to our actual titlebar height
//! ourselves, and explicitly set each button's local origin so it's
//! truly vertically centered within it -- no implicit AppKit constant
//! involved.
//!
//! ## Why this can't just be "reapply on WindowEvent::Resized / Focused"
//!
//! A prior version of this file reapplied the correction from
//! `on_window_event` whenever tao delivered `Resized` or `Focused`. That
//! did not fix either symptom it was meant to fix (buttons jittering
//! during a live resize drag, buttons vanishing when the window isn't
//! key), and tracing why led here:
//!
//! - tao's `Resized`/`Focused` are genuinely delivered promptly, even
//!   during an interactive resize drag -- but not literally synchronously
//!   from inside AppKit's own delegate callback. `windowDidResize:`
//!   (tao-0.35.3's window_delegate.rs) calls `WindowDelegateState::emit_event`,
//!   which only pushes onto a `VecDeque` (`AppState::queue_event`) --
//!   it does not call into Rust's `on_window_event` from that same call
//!   stack. The actual dispatch happens on the next tick of a
//!   `CFRunLoopObserver` callback registered on `kCFRunLoopBeforeWaiting`
//!   (`AppState::cleared`, driven by `observer.rs`'s
//!   `setup_control_flow_observers` -> `RunLoop::add_observer`), and that
//!   observer is itself registered on `kCFRunLoopCommonModes` -- common
//!   modes includes `NSEventTrackingRunLoopMode`, so it keeps firing once
//!   per tracking-loop pass during a live-resize drag, not just at
//!   mouse-up. So there's no multi-frame backlog, but the honest
//!   description is "queued, then drained on the next run-loop tick," not
//!   "synchronous with `windowDidResize:`." Once dispatch does happen,
//!   Tauri's `run_on_main_thread`, called from inside our
//!   `on_window_event` callback, resolves to `tauri-runtime-wry`'s
//!   `send_user_message`, which checks
//!   `current_thread().id() == context.main_thread_id` and, when true (as
//!   it is here -- `on_window_event` already runs on the main thread),
//!   runs the closure immediately (`Message::Task(task) => task()`), not
//!   via any further dispatch/queue -- that part really is synchronous.
//!
//! - The problem is a cadence mismatch, not a delivery-lag one. AppKit
//!   re-lays-out its own title-bar chrome (the container + the three
//!   buttons) on its own schedule tied to the window's actual display/
//!   layout passes -- which runs at least once per `windowDidResize:`
//!   call too, but is not required to run *before* delegate notifications
//!   for that same tick; it can (and during a live-resize drag,
//!   observably does) also run additional times that have no
//!   corresponding discrete `WindowEvent` at all -- e.g. the interpolated
//!   redraws macOS performs between mouse-dragged ticks to keep live
//!   resize visually smooth, and the layout pass AppKit runs internally
//!   when swapping the buttons' active/inactive artwork on a key/resign-
//!   key transition. Reacting only to tao's coarser `Resized`/`Focused`
//!   notifications means our correction and AppKit's own layout race each
//!   other: whichever runs last for a given displayed frame wins, and
//!   AppKit's own pass is not guaranteed to run before ours, or to run
//!   only exactly when a `WindowEvent` says it did. That race, replayed
//!   every tick of a drag, is what reads as jitter; a resign-key layout
//!   pass that outraces (or simply isn't matched 1:1 by) our correction
//!   is what reads as the buttons vanishing (AppKit's own recompute can
//!   put them at a position/height belonging to the *default*, un-tall
//!   titlebar, still nominally "on screen" but not where this app's own
//!   taller custom titlebar background expects them, and/or clipped by
//!   the container's own bounds once its height no longer matches ours).
//!
//! - (The prior fix's `NSAnimationContext` wrapping was independently a
//!   no-op, for a different reason: `NSAnimationContext`'s `duration`
//!   only affects code that goes through the `.animator()` proxy, or
//!   direct property mutation when `allowsImplicitAnimation` is
//!   explicitly set `true` -- see objc2-app-kit's
//!   `NSAnimationContext::setAllowsImplicitAnimation`, whose backing
//!   property defaults to `NO` per Apple's docs. The prior code called
//!   plain `setFrame:`/`setFrameOrigin:` -- never `.animator()` -- and
//!   never touched `allowsImplicitAnimation`, so those direct mutations
//!   were never implicitly animated by Core Animation in the first
//!   place, wrapped in a zero-duration context or not.)
//!
//! The fix, part one: stop trying to out-guess *when* AppKit will re-lay
//! these views out, and instead react to the fact that it did, directly.
//! Every `NSView` can be told to post `NSViewFrameDidChangeNotification`
//! whenever its frame actually changes, for *any* reason -- our own
//! calls, AppKit's internal layout, or anything else. We opt the three
//! buttons into that (`postsFrameChangedNotifications = true`) once, and
//! observe it with a block-based `NSNotificationCenter` observer
//! (`queue: nil`, so the block runs synchronously, in-place, on whatever
//! thread posted the notification -- always the main thread for these
//! views) that just re-applies our corrected geometry. This closes most
//! of the gap: it fires at AppKit's own layout cadence, not tao's coarser
//! event cadence.
//!
//! It does NOT close it completely, though -- a real `cliclick`-driven
//! corner drag (not a synthetic one-shot resize) with
//! `HAPPYDECK_TITLEBAR_DEBUG=1` logging every correction showed AppKit
//! periodically (roughly once per live-resize tick) reasserting its own
//! native button positions on its OWN internal layout pass, synchronously,
//! on the same main thread we're on. If that write lands after ours
//! within the same displayed frame, ours loses that frame regardless of
//! how fast we react afterward -- there's no tao/Tauri/AppKit hook
//! fine-grained enough to guarantee going last against a same-thread
//! competitor. (This part is NOT container-frame-specific, unlike the
//! constraint theory above: once `apply_correction` below stopped writing
//! `container.setFrame` entirely -- see its own comment -- the container
//! stopped being reset, but AppKit still periodically reset all three
//! BUTTON positions together, in sync, confirmed by direct measurement:
//! close/miniaturize/zoom all move by the exact same delta at the exact
//! same instant. The zoom/green button isn't specially targeted; it's
//! just the most visually salient of the three, so it's the one users
//! notice.)
//!
//! The fix, part two: stop trying to win that race at all, and sidestep
//! it. `NSWindowWillStartLiveResizeNotification`/
//! `…DidEndLiveResizeNotification` are WINDOW-level notifications AppKit
//! sends exactly once per live-resize drag (not once per tick) -- hide
//! the three buttons for that exact span and reveal them, freshly
//! corrected, the instant it ends. Verified live: with this in place, a
//! real corner drag produces a single `apply_correction` call at drag-end
//! with every button already at its correct position, and zero visible
//! ones in between (they're hidden, not wrong). The trade-off is
//! deliberate and known: no traffic lights are visible while actively
//! dragging a resize handle.

use std::cell::Cell;
use std::ptr::NonNull;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2_app_kit::{
    NSButton, NSView, NSViewFrameDidChangeNotification, NSWindow, NSWindowButton, NSWindowDidEndLiveResizeNotification, NSWindowWillStartLiveResizeNotification,
};
use objc2_foundation::{NSNotification, NSNotificationCenter, NSNotificationName, NSObjectProtocol, NSPoint};

/// Wraps a raw NSWindow pointer so it can cross into `run_on_main_thread`'s
/// `Send` closure -- Tauri hands us the pointer from an arbitrary thread,
/// but every AppKit call below must run on the main thread, which the
/// caller is responsible for (see `run_on_main_thread` at the call site).
pub struct SendableNSWindow(pub *mut std::ffi::c_void);
unsafe impl Send for SendableNSWindow {}

/// Diagnostic logging for chasing the two traffic-light bugs (resize
/// jitter, disappearing when the window isn't key) that already survived
/// two fix attempts. Opt-in via `HAPPYDECK_TITLEBAR_DEBUG=1` -- checked
/// fresh on every call rather than cached, since this only matters for a
/// short debugging session, never in a normal run.
///
/// Writes to a FILE (`~/Library/Logs/happydeck/titlebar-debug.log`), not
/// stderr: a GUI app launched normally (double-click, or `open`) has no
/// attached terminal, and its stderr does not show up in `log
/// stream`/Console.app either -- unified logging only captures os_log/
/// NSLog calls, not raw fd 2 writes. A file is the one sink that's both
/// guaranteed to receive the output and easy to hand back afterward.
fn dbg_log(message: &str) {
    if std::env::var_os("HAPPYDECK_TITLEBAR_DEBUG").is_none() {
        return;
    }
    let Some(home) = std::env::var_os("HOME") else { return };
    let dir = std::path::Path::new(&home).join("Library/Logs/happydeck");
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("titlebar-debug.log")) {
        let _ = writeln!(file, "{message}");
    }
}

/// A live `NSNotificationCenter` observer token, as returned by
/// `addObserverForName:object:queue:usingBlock:`. Kept alive for as long
/// as it should keep observing; dropping it would implicitly unregister.
type FrameObserver = Retained<ProtocolObject<dyn NSObjectProtocol>>;

thread_local! {
    // Re-entrancy guard: the corrective `setFrame`/`setFrameOrigin` calls
    // below themselves change the frame of views we've opted into
    // `postsFrameChangedNotifications`, so they synchronously re-trigger
    // the very notification handler that's reapplying them. Main-thread-
    // only (all AppKit calls here are), so a thread-local `Cell` is
    // enough -- no atomics needed.
    static APPLYING_CORRECTION: Cell<bool> = const { Cell::new(false) };

    // Keeps the block-based observers (and the params they close over)
    // alive for as long as the window does. `Retained<...>` isn't `Send`,
    // so this can't be a plain `static`; it's only ever touched from the
    // main thread, matching where it's installed and where AppKit fires
    // the notifications it's observing.
    static FRAME_OBSERVERS: Cell<Option<Vec<FrameObserver>>> = const { Cell::new(None) };

    // AppKit's own real, native (space_between, button_height) -- measured
    // ONCE, the very first time `apply_correction` runs (before this
    // module has ever written a button frame), then reused for every
    // correction after that. See `apply_correction`'s doc comment for why
    // re-deriving this from live button positions on every call, as a
    // prior version did, was itself a bug.
    static BUTTON_METRICS: Cell<Option<(f64, f64)>> = const { Cell::new(None) };
}

/// `titlebar_height` and `left_inset` are both real, measured CSS pixels
/// (== AppKit points, no scale-factor conversion needed -- both live in
/// the same logical coordinate space) passed in from the frontend, which
/// reads them straight off the rendered `.titlebar` DOM element. Nothing
/// here is a guessed constant.
pub fn center_traffic_lights(window_ptr: SendableNSWindow, titlebar_height: f64, left_inset: f64) {
    let window: &NSWindow = unsafe { &*(window_ptr.0 as *mut NSWindow) };
    apply_correction(window, titlebar_height, left_inset);
    install_frame_change_correction(window, titlebar_height, left_inset);
}

/// The actual geometry fix, factored out so both the one-shot caller
/// above and the continuous `NSViewFrameDidChangeNotification` observer
/// below can share it.
fn apply_correction(window: &NSWindow, titlebar_height: f64, left_inset: f64) {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
    dbg_log(&format!("[{now}] apply_correction entered (h={titlebar_height} inset={left_inset})"));
    if APPLYING_CORRECTION.with(|flag| flag.get()) {
        // We're already inside a correction pass that's about to trigger
        // this same notification recursively -- don't recurse.
        return;
    }

    let Some(close) = window.standardWindowButton(NSWindowButton::CloseButton) else {
        dbg_log(&format!("[{now}] EARLY RETURN: no close button"));
        return;
    };
    let Some(miniaturize) = window.standardWindowButton(NSWindowButton::MiniaturizeButton) else {
        dbg_log(&format!("[{now}] EARLY RETURN: no miniaturize button"));
        return;
    };
    let zoom = window.standardWindowButton(NSWindowButton::ZoomButton);

    let Some(container) = (unsafe { close.superview().and_then(|v| v.superview()) }) else {
        dbg_log(&format!("[{now}] EARLY RETURN: no container"));
        return;
    };

    // Real spacing between button centers and their shared height, read
    // from AppKit's own layout before we (ever) touch anything -- not the
    // usual "12px + 8px gap" folklore, and NOT re-derived on every call:
    // this now runs on every NSViewFrameDidChangeNotification (far more
    // often than the old WindowEvent-driven version), and re-measuring
    // from live button positions fed back into itself -- any sub-pixel
    // noise between corrections got multiplied by each button's own index
    // when computing its target x (0x for close, 1x for miniaturize, 2x
    // for zoom), so only the zoom button, at 2x, ever visibly shook.
    // Caching the real measurement once and reusing it removes that
    // amplification path entirely, regardless of what's actually causing
    // the underlying noise.
    let (space_between, button_height) = BUTTON_METRICS.with(|cell| {
        if let Some(metrics) = cell.get() {
            return metrics;
        }
        let close_frame = NSView::frame(&close);
        let metrics = (NSView::frame(&miniaturize).origin.x - close_frame.origin.x, close_frame.size.height);
        cell.set(Some(metrics));
        metrics
    });

    let window_height = window.frame().size.height;
    let centered_y = (titlebar_height - button_height) / 2.0;

    // z-order of the titlebar container among its siblings, plus each
    // sibling's class — if the webview ever ends up drawn ABOVE the
    // container, the buttons are occluded rather than moved, which looks
    // identical to "they vanished" but has nothing to do with geometry.
    if let Some(parent) = unsafe { container.superview() } {
        let siblings = parent.subviews();
        let names: Vec<String> = siblings
            .iter()
            .map(|v| {
                let obj: &objc2::runtime::AnyObject = v.as_ref();
                format!("{}", obj.class().name().to_string_lossy())
            })
            .collect();
        let container_idx = siblings.iter().position(|v| {
            let a: *const NSView = &*v;
            let b: *const NSView = container.as_ref();
            a == b
        });
        dbg_log(&format!("[{now}] z-order: containerIdx={container_idx:?} of {} siblings -> {names:?}", names.len()));
    }
    dbg_log(&format!(
        "[{now}] visibility: containerHiddenOrAncestor={} closeAlpha={:.2} closeHidden={} closeHiddenOrAncestor={} titlebarViewFrame={:?}",
        container.isHiddenOrHasHiddenAncestor(),
        close.alphaValue(),
        close.isHidden(),
        close.isHiddenOrHasHiddenAncestor(),
        unsafe { close.superview() }.map(|sv| {
            let f = NSView::frame(&sv);
            (f.origin.x, f.origin.y, f.size.width, f.size.height)
        }),
    ));
    {
        let zoom_frame = zoom.as_ref().map(|z| NSView::frame(z));
        // "cached" is what this call will actually use (space_between,
        // button_height). "live" is what a fresh measurement would give
        // right now, purely diagnostic — if the two ever drift apart, that
        // confirms something (AppKit or otherwise) really is moving these
        // buttons independent of this module's own writes.
        let live_close = NSView::frame(&close);
        let live_space_between = NSView::frame(&miniaturize).origin.x - live_close.origin.x;
        dbg_log(&format!(
            "[{now}] key={} main={} winH={:.1} | container={:?} hidden={} alpha={:.2} | close={:?} mini={:?} zoom={:?} | zoomHidden={:?} | cached(space={:.2} h={:.2}) live_space={:.2} centered_y={:.2}",
            window.isKeyWindow(),
            window.isMainWindow(),
            window_height,
            (NSView::frame(&container).origin.x, NSView::frame(&container).origin.y, NSView::frame(&container).size.width, NSView::frame(&container).size.height),
            container.isHidden(),
            container.alphaValue(),
            (live_close.origin.x, live_close.origin.y),
            (NSView::frame(&miniaturize).origin.x, NSView::frame(&miniaturize).origin.y),
            zoom_frame.map(|f| (f.origin.x, f.origin.y)),
            zoom.as_ref().map(|z| z.isHidden()),
            space_between,
            button_height,
            live_space_between,
            centered_y,
        ));
    }

    // Deliberately NOT `container.setFrame(...)` any more -- a live-drag
    // capture (HAPPYDECK_TITLEBAR_DEBUG=1, real cliclick-driven corner
    // drag, not a synthetic one-shot resize) showed AppKit re-asserting
    // ITS OWN native ~32pt container height and native button positions
    // on EVERY live-resize layout tick, unconditionally -- container
    // first, then close, then miniaturize, then zoom, each stomping this
    // function's previous correction in turn, all within single-digit
    // milliseconds of each other. That's consistent with
    // NSTitlebarContainerView owning an internal (private, unremovable
    // from here) Auto Layout constraint on its own height for this
    // window's style mask: an imperative `setFrame` satisfies it for one
    // frame, and AppKit's constraint solver reasserts the "real" value on
    // the very next layout pass -- which live resize triggers continuously,
    // not occasionally. Zoom was the most visibly "stuck" of the three
    // simply because its notification/correction happened to land last in
    // that per-tick cascade, leaving it wrong for the largest fraction of
    // each tick.
    //
    // Buttons don't have that problem: AppKit still moves them (as part of
    // the same cascade, since they're relaid-out alongside the container
    // it's "fixing"), but a button's own frame isn't the thing with a
    // private constraint holding it to a specific value -- only the
    // container's height is. So leave the container's frame alone
    // entirely and never give AppKit a reason to reassert it, and place
    // the buttons by converting the ABSOLUTE window-space position we
    // want into whatever the container's local coordinate space happens
    // to be at that instant (`convertPoint:fromView:nil` means "point is
    // in the window's own base coordinate system") -- correct regardless
    // of the container's current frame, without ever writing to it.
    let target_y_in_window = window_height - titlebar_height + centered_y;
    APPLYING_CORRECTION.with(|flag| flag.set(true));
    for (i, button) in [Some(close), Some(miniaturize), zoom].into_iter().flatten().enumerate() {
        let target_in_window = NSPoint { x: left_inset + i as f64 * space_between, y: target_y_in_window };
        let target_in_container = container.convertPoint_fromView(target_in_window, None);
        button.setFrameOrigin(target_in_container);
    }
    APPLYING_CORRECTION.with(|flag| flag.set(false));
}

/// Installs (once per process -- `FRAME_OBSERVERS` doubles as the "already
/// installed" guard) block-based `NSViewFrameDidChangeNotification`
/// observers on the container and all three buttons, so the correction
/// re-applies at AppKit's own layout cadence instead of tao's coarser
/// `WindowEvent` cadence. See the module doc comment for why this is the
/// part that actually fixes both symptoms; `apply_correction` alone
/// (called once here, and from `WindowEvent::Resized`/`Focused` if the
/// caller still wants that as a defensive first application) is not
/// enough on its own.
fn install_frame_change_correction(window: &NSWindow, titlebar_height: f64, left_inset: f64) {
    if FRAME_OBSERVERS.with(|cell| {
        let installed = cell.take();
        let already_installed = installed.is_some();
        cell.set(installed);
        already_installed
    }) {
        return;
    }

    let Some(close) = window.standardWindowButton(NSWindowButton::CloseButton) else { return };
    let Some(miniaturize) = window.standardWindowButton(NSWindowButton::MiniaturizeButton) else { return };
    let zoom = window.standardWindowButton(NSWindowButton::ZoomButton);
    let Some(container) = (unsafe { close.superview().and_then(|v| v.superview()) }) else { return };

    let center = NSNotificationCenter::defaultCenter();
    let mut observers = Vec::with_capacity(4);

    // `&NSButton`/`&NSView` both work as `view: &NSView` here via objc2's
    // subclass `Deref` chain (NSButton -> NSControl -> NSView) -- no
    // upcast needed to call `setPostsFrameChangedNotifications` or to
    // hand the reference to `addObserverForName_object_queue_usingBlock`
    // (which widens it further, to `&AnyObject`, the same way).
    let mut watch = |view: &NSView| {
        view.setPostsFrameChangedNotifications(true);

        // SAFETY: `window` outlives these observers -- both are torn down
        // together with the app, never individually -- so capturing it by
        // raw pointer and re-borrowing inside the block is sound as long
        // as the block never runs after the window is gone, which it
        // can't (nothing posts to a deallocated NSView).
        let window_ptr = window as *const NSWindow;
        let block = RcBlock::new(move |_note: NonNull<NSNotification>| {
            let window: &NSWindow = unsafe { &*window_ptr };
            apply_correction(window, titlebar_height, left_inset);
        });

        let observer = unsafe {
            center.addObserverForName_object_queue_usingBlock(
                Some(NSViewFrameDidChangeNotification),
                Some(view),
                None,
                &block,
            )
        };
        observers.push(observer);
    };

    watch(&container);
    watch(&close);
    watch(&miniaturize);
    if let Some(zoom) = &zoom {
        watch(zoom);
    }

    // NSViewFrameDidChangeNotification (above) reacts fast, but it's still
    // reactive: a live-drag capture showed AppKit periodically reasserting
    // its own native button positions on its OWN internal layout cadence
    // (once or so per drag tick), synchronously, on the same thread -- if
    // that write lands after ours within the same displayed frame, ours
    // loses that frame regardless of how fast we react afterward. There is
    // no tao/Tauri event fine-grained enough to guarantee going last.
    //
    // So stop trying to win that race and sidestep it instead: hide the
    // buttons for the exact duration AppKit itself reports as "live
    // resize" (NSWindowWillStartLiveResizeNotification /
    // …DidEndLiveResizeNotification -- window-level, fired once per drag,
    // not per tick, so this is cheap), and reveal them, correctly placed,
    // the instant the drag ends. A known, deliberate trade: no traffic
    // lights are visible while actively dragging a resize handle, instead
    // of occasionally-flickering-to-the-wrong-place ones.
    let mut watch_live_resize = |name: &'static NSNotificationName, hidden: bool| {
        let close_ptr = Retained::as_ptr(&close);
        let miniaturize_ptr = Retained::as_ptr(&miniaturize);
        let zoom_ptr = zoom.as_ref().map(Retained::as_ptr);
        let window_ptr = window as *const NSWindow;
        let block = RcBlock::new(move |_note: NonNull<NSNotification>| {
            let close: &NSButton = unsafe { &*close_ptr };
            let miniaturize: &NSButton = unsafe { &*miniaturize_ptr };
            close.setHidden(hidden);
            miniaturize.setHidden(hidden);
            if let Some(zoom_ptr) = zoom_ptr {
                let zoom: &NSButton = unsafe { &*zoom_ptr };
                zoom.setHidden(hidden);
            }
            if !hidden {
                let window: &NSWindow = unsafe { &*window_ptr };
                apply_correction(window, titlebar_height, left_inset);
            }
        });
        let observer = unsafe { center.addObserverForName_object_queue_usingBlock(Some(name), Some(window.as_ref()), None, &block) };
        observers.push(observer);
    };
    unsafe {
        watch_live_resize(NSWindowWillStartLiveResizeNotification, true);
        watch_live_resize(NSWindowDidEndLiveResizeNotification, false);
    }

    FRAME_OBSERVERS.with(|cell| cell.set(Some(observers)));
}
