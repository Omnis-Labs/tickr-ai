'use client';

/**
 * Ask the browser for OS notification permission once. Idempotent: if
 * already granted or denied, this is a no-op. Caller should invoke at a
 * moment that matches user intent (after they finish mandate setup is the
 * canonical moment — they've just told us they want signals).
 *
 * Returns the resulting permission so the caller can branch UI on it
 * (e.g. show "you'll only see in-app toasts; enable notifications in
 * browser settings" if denied).
 */
export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'denied';
  }
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}
