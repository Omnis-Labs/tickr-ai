'use client';

import { toast } from 'sonner';
import { setAlertFavicon } from '@/components/notifications/favicon-dot';
import { startTitleFlash } from '@/components/notifications/tab-title-flasher';
import { playSignalSound } from '@/components/notifications/sound-manager';

/**
 * Pure side-effect primitives — the verbs available to a notification
 * handler. Handlers in registry.ts compose these; NotificationClient is
 * a driver that runs them. Keeps each call site declarative.
 */

export interface ToastEffect {
  kind: 'toast';
  variant?: 'default' | 'success' | 'error';
  message: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  durationMs?: number;
}

export interface AttentionEffect {
  kind: 'attention';
  /** Title text used by the title flasher. */
  title: string;
  /** Notification body when an OS notification is created. */
  body: string;
  /** Identifier used as `tag` so dup events don't spawn duplicates. */
  tag: string;
  /** Where to navigate when the OS notification is clicked. */
  href: string;
}

export type UIEffect = ToastEffect | AttentionEffect;

interface RunCtx {
  /** Push to a route (typically `router.push`). */
  navigate: (href: string) => void;
  /** Map of active OS notifications keyed by tag, owned by the driver. */
  activeNotifs: Map<string, Notification>;
}

export function runEffects(effects: UIEffect[], ctx: RunCtx): void {
  for (const e of effects) {
    if (e.kind === 'toast') runToast(e);
    else if (e.kind === 'attention') runAttention(e, ctx);
  }
}

function runToast(e: ToastEffect): void {
  const fn =
    e.variant === 'success' ? toast.success : e.variant === 'error' ? toast.error : toast;
  fn(e.message, {
    description: e.description,
    action: e.action,
    duration: e.durationMs ?? 12_000,
  });
}

function runAttention(e: AttentionEffect, ctx: RunCtx): void {
  startTitleFlash(`🔔 ${e.title} — Hunch It`);
  setAlertFavicon();
  playSignalSound();

  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(`Hunch It · ${e.title}`, {
      body: e.body.slice(0, 200),
      tag: e.tag,
      requireInteraction: true,
      icon: '/favicons/signal.png',
    });
    ctx.activeNotifs.set(e.tag, n);
    n.onclick = () => {
      window.focus();
      ctx.navigate(e.href);
      n.close();
      ctx.activeNotifs.delete(e.tag);
    };
    n.onclose = () => {
      ctx.activeNotifs.delete(e.tag);
    };
  } catch (err) {
    console.warn('[notifications] Notification() failed', err);
  }
}
