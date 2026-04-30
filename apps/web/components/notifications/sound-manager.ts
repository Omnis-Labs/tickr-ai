'use client';

/**
 * Plays a short two-note "ding" using Web Audio API. Synthesised on the fly so
 * we don't need to ship an mp3. Audio contexts must be created/resumed inside
 * a user gesture — `unlockSound()` is called synchronously at the start of
 * the mandate-page "Start Desk" submit handler so the AudioContext is ready
 * before the user lands on /desk and signal sounds start firing.
 */

interface AudioCtxCtor {
  new (): AudioContext;
}

let ctx: AudioContext | null = null;
let unlocked = false;

function getAudioCtor(): AudioCtxCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioCtxCtor; webkitAudioContext?: AudioCtxCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = getAudioCtor();
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

function playDing(volume: number): void {
  const c = ensureCtx();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();

  const now = c.currentTime;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
  gain.connect(c.destination);

  const osc = c.createOscillator();
  osc.type = 'sine';
  // A5 → E6 quick rise (880 → 1318.5 Hz).
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.linearRampToValueAtTime(1318.5, now + 0.13);
  osc.connect(gain);
  osc.start(now);
  osc.stop(now + 0.45);
}

export function unlockSound(): void {
  if (unlocked) return;
  const c = ensureCtx();
  if (!c) return;
  // Some browsers leave the context suspended until first sound.
  void c.resume();
  // Fire a near-silent buffer so the resume actually takes effect on Safari.
  try {
    const buffer = c.createBuffer(1, 1, 22050);
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.connect(c.destination);
    src.start(0);
  } catch {
    /* noop */
  }
  unlocked = true;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem('hunch-it.soundUnlocked', '1');
    } catch {
      /* noop */
    }
  }
}

export function isSoundUnlocked(): boolean {
  if (unlocked) return true;
  if (typeof window === 'undefined') return false;
  try {
    unlocked = window.localStorage.getItem('hunch-it.soundUnlocked') === '1';
  } catch {
    /* noop */
  }
  return unlocked;
}

export function playSignalSound(volume = 0.5): void {
  if (!isSoundUnlocked()) return;
  playDing(volume);
}
