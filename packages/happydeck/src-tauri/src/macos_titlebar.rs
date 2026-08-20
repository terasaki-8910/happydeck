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

use objc2_app_kit::{NSView, NSWindow, NSWindowButton};
use objc2_foundation::NSPoint;

/// Wraps a raw NSWindow pointer so it can cross into `run_on_main_thread`'s
/// `Send` closure -- Tauri hands us the pointer from an arbitrary thread,
/// but every AppKit call below must run on the main thread, which the
/// caller is responsible for (see `run_on_main_thread` at the call site).
pub struct SendableNSWindow(pub *mut std::ffi::c_void);
unsafe impl Send for SendableNSWindow {}

/// `titlebar_height` and `left_inset` are both real, measured CSS pixels
/// (== AppKit points, no scale-factor conversion needed -- both live in
/// the same logical coordinate space) passed in from the frontend, which
/// reads them straight off the rendered `.titlebar` DOM element. Nothing
/// here is a guessed constant.
pub fn center_traffic_lights(window_ptr: SendableNSWindow, titlebar_height: f64, left_inset: f64) {
    let window: &NSWindow = unsafe { &*(window_ptr.0 as *mut NSWindow) };

    let Some(close) = window.standardWindowButton(NSWindowButton::CloseButton) else { return };
    let Some(miniaturize) = window.standardWindowButton(NSWindowButton::MiniaturizeButton) else { return };
    let zoom = window.standardWindowButton(NSWindowButton::ZoomButton);

    let Some(container) = (unsafe { close.superview().and_then(|v| v.superview()) }) else { return };

    let close_frame = NSView::frame(&close);
    let button_height = close_frame.size.height;
    // Real spacing between button centers, read from AppKit's own layout
    // before we touch anything -- not the usual "12px + 8px gap" folklore.
    let space_between = NSView::frame(&miniaturize).origin.x - close_frame.origin.x;

    // Grow the container to our titlebar's real height, top edge pinned
    // to the window's top edge (same anchoring wry itself uses).
    let window_height = window.frame().size.height;
    let mut container_rect = NSView::frame(&container);
    container_rect.size.height = titlebar_height;
    container_rect.origin.y = window_height - titlebar_height;
    container.setFrame(container_rect);

    let centered_y = (titlebar_height - button_height) / 2.0;

    for (i, button) in [Some(close), Some(miniaturize), zoom].into_iter().flatten().enumerate() {
        button.setFrameOrigin(NSPoint { x: left_inset + i as f64 * space_between, y: centered_y });
    }
}
