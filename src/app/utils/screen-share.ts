import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './desktop-notifications';
import { mobileOrTablet } from './user-agent';

/**
 * Opens or closes the capture gate that lasts for a whole call.
 *
 * Only the Linux shell acts on it. Element Call runs in an iframe and calls
 * getUserMedia/getDisplayMedia itself, at a moment nothing outside the iframe
 * can predict, so the short one-shot window used for voice messages cannot
 * cover it. Without this, pressing "share screen" inside a call on Linux was
 * denied with no explanation.
 */
export async function setCaptureSession(active: boolean): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('set_capture_session', { active });
  } catch {
    // Older shell without the command. Capture behaves as it did before.
  }
}

/**
 * The shell's capture gate now EXPIRES rather than staying open for the process
 * lifetime, so an open call has to keep saying it is still open.
 *
 * The gate previously never closed: one `set_capture_session(true)` granted
 * every later capture request from every frame until the app exited. A deadline
 * the caller must renew means a page that stops renewing - or that never had a
 * real call - loses it on its own.
 *
 * Renewal interval is well inside the shell's TTL so a slow tick cannot leave a
 * live call briefly ungated.
 */
const CAPTURE_SESSION_RENEW_MS = 45_000;

export function openCaptureSession(): () => void {
  if (!isTauri()) return () => {};
  void setCaptureSession(true);
  const timer = setInterval(() => {
    void setCaptureSession(true);
  }, CAPTURE_SESSION_RENEW_MS);
  return () => {
    clearInterval(timer);
    void setCaptureSession(false);
  };
}

export type ScreenShareSupport = { supported: true } | { supported: false; reason: string };

/**
 * Whether this build can capture a screen at all.
 *
 * Nothing in the app calls getDisplayMedia directly today — screen sharing
 * happens inside the Element Call iframe, which asks for it itself. This exists
 * so the capability can be reported honestly in diagnostics rather than
 * discovered as a rejected promise inside a widget.
 *
 * Reported rather than assumed, because the answer differs per engine and the
 * failure is otherwise a rejected promise inside a widget with no user-visible
 * cause:
 *
 * - Android WebView has no getDisplayMedia. Screen capture there needs the
 *   native MediaProjection API, which is not reachable from a web page.
 * - WebKitGTK routes it through xdg-desktop-portal; without a portal running
 *   the call rejects.
 * - WebView2 and WKWebView provide their own picker.
 */
export function checkScreenShareSupport(): ScreenShareSupport {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
    if (isTauri() && mobileOrTablet()) {
      return {
        supported: false,
        reason: 'Android cannot share a screen from inside the app.',
      };
    }
    return {
      supported: false,
      reason: 'This app build has no screen capture support.',
    };
  }
  return { supported: true };
}
