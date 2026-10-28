/**
 * SoundManager — a WebAudio sound engine that SYNTHESIZES every cue from oscillators
 * + gain envelopes (TERMINAL-ROADMAP area I, the SoundEngine). There are NO binary
 * audio assets to bundle: every sound is generated at play time, so the build stays
 * asset-free and CSP-clean (the policy's `default-src 'self'` covers Web Audio — no
 * media element, no asset URL, nothing is ever fetched).
 *
 * The three distinct, pleasant cues:
 *   - `trade-open`  — a rising two-note chime (C5 → E5), confident / "filled".
 *   - `trade-close` — a falling two-note chime (E5 → C5), the mirror, "done".
 *   - `alert`       — a clear double ping (A5), attention without alarm.
 *
 * Robustness (load-bearing): playback must NEVER throw and must degrade silently
 * when there is no usable AudioContext (headless, the renderer's autoplay policy
 * before a user gesture, a locked-down environment). The context is created lazily
 * on the first `play` / `unlock`; if creation fails it is remembered as unavailable
 * and every later `play` is a clean no-op. A suspended context (autoplay policy) is
 * resumed opportunistically on the first user gesture and on each play attempt.
 *
 * Gating is the caller's concern by default, but `playGated(kind)` is provided so a
 * consumer can route through the live settings (`sounds.enabled`, the per-event
 * toggle `sounds.<event>`, and `sounds.volume`) without re-reading them itself.
 */

import { getSetting } from '../settings/store';

export type SoundKind = 'trade-open' | 'trade-close' | 'alert';

/** The `sounds.*` per-event toggle key for a cue (additive settings, all default on). */
const EVENT_TOGGLE: Record<SoundKind, string> = {
  'trade-open': 'sounds.tradeOpen',
  'trade-close': 'sounds.tradeClose',
  alert: 'sounds.alert',
};

/** A minimal structural type for the Web Audio constructor (avoids a DOM-lib dep
 *  assumption + lets us probe `webkitAudioContext` without `any` leaking around). */
type AudioCtor = { new (): AudioContext };

/** One synthesized tone in a cue: frequency, when it starts, how long, peak gain. */
interface Tone {
  /** Hertz. */
  freq: number;
  /** Start offset from the cue's t0, in seconds. */
  at: number;
  /** Duration in seconds. */
  dur: number;
  /** Peak gain 0..1 (before the master volume is applied). */
  gain: number;
  /** Oscillator shape. `sine`/`triangle` read as soft + pleasant; default `sine`. */
  type?: OscillatorType;
}

/** The note recipes. Frequencies are equal-temperament concert pitches. */
const CUES: Record<SoundKind, Tone[]> = {
  // Rising major third — open/filled. Two short notes, the second slightly softer.
  'trade-open': [
    { freq: 523.25, at: 0.0, dur: 0.13, gain: 0.5, type: 'sine' }, // C5
    { freq: 659.25, at: 0.1, dur: 0.18, gain: 0.42, type: 'sine' }, // E5
  ],
  // Falling major third — the mirror; close/done.
  'trade-close': [
    { freq: 659.25, at: 0.0, dur: 0.13, gain: 0.5, type: 'sine' }, // E5
    { freq: 523.25, at: 0.1, dur: 0.2, gain: 0.42, type: 'sine' }, // C5
  ],
  // Clear double ping — an alert; attention, not alarm.
  alert: [
    { freq: 880.0, at: 0.0, dur: 0.1, gain: 0.5, type: 'triangle' }, // A5
    { freq: 880.0, at: 0.16, dur: 0.14, gain: 0.45, type: 'triangle' }, // A5
  ],
};

class SoundManagerImpl {
  /** null = not created yet; an instance = live; the `unavailable` flag = gave up. */
  private ctx: AudioContext | null = null;
  private unavailable = false;
  private gestureHooked = false;

  constructor() {
    // Best-effort: resume/create on the first real user gesture so the autoplay
    // policy is satisfied before any sound is requested. Guarded for non-DOM hosts.
    this.hookFirstGesture();
  }

  /** Resolve the AudioContext constructor across vendor prefixes; null if none. */
  private ctor(): AudioCtor | null {
    const g = globalThis as unknown as {
      AudioContext?: AudioCtor;
      webkitAudioContext?: AudioCtor;
    };
    return g.AudioContext ?? g.webkitAudioContext ?? null;
  }

  /** Lazily create (or return) the context. Returns null + latches `unavailable`
   *  if construction throws or no constructor exists. Never throws. */
  private ensureCtx(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (this.unavailable) return null;
    const Ctor = this.ctor();
    if (!Ctor) {
      this.unavailable = true;
      return null;
    }
    try {
      this.ctx = new Ctor();
      return this.ctx;
    } catch {
      this.unavailable = true;
      return null;
    }
  }

  /** Attach a one-shot listener that unlocks the context on the first user gesture.
   *  No-op when there is no `window`/`addEventListener` (headless). */
  private hookFirstGesture(): void {
    if (this.gestureHooked) return;
    const w = globalThis as unknown as {
      addEventListener?: (t: string, cb: () => void, o?: unknown) => void;
      removeEventListener?: (t: string, cb: () => void, o?: unknown) => void;
    };
    if (typeof w.addEventListener !== 'function') return;
    this.gestureHooked = true;
    const events = ['pointerdown', 'keydown', 'touchstart'];
    const onGesture = (): void => {
      this.unlock();
      for (const e of events) w.removeEventListener?.(e, onGesture);
    };
    for (const e of events) {
      try {
        w.addEventListener(e, onGesture, { once: false, passive: true });
      } catch {
        /* ignore — degrade silently */
      }
    }
  }

  /** Create + resume the context (call from a user gesture). Safe + idempotent.
   *  Returns true if a running context now exists. */
  unlock(): boolean {
    const ctx = this.ensureCtx();
    if (!ctx) return false;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => { /* ignore */ });
    return ctx.state === 'running' || ctx.state === 'suspended';
  }

  /** True when a context exists and is (or can be) used. For diagnostics/tests. */
  isAvailable(): boolean {
    return !this.unavailable && (this.ctx != null || this.ctor() != null);
  }

  /**
   * Play a cue immediately, UNGATED (respects nothing but availability). The caller
   * owns the enabled/volume decision. `volume` (0..1) scales the cue's gains; a
   * non-positive or non-finite volume is a no-op.
   */
  play(kind: SoundKind, volume = 1): void {
    if (!Number.isFinite(volume) || volume <= 0) return;
    const ctx = this.ensureCtx();
    if (!ctx) return; // no audio here — silent no-op (headless / blocked)
    // Opportunistically resume; if it stays suspended the schedule still queues and
    // will sound once the policy unlocks. Either way we never throw.
    if (ctx.state === 'suspended') void ctx.resume().catch(() => { /* ignore */ });

    const tones = CUES[kind];
    const vol = Math.min(1, volume);
    try {
      const t0 = ctx.currentTime + 0.01; // tiny lead so the envelope's t0 is in the future
      for (const tone of tones) this.scheduleTone(ctx, tone, t0, vol);
    } catch {
      /* a scheduling error must never bubble to the UI */
    }
  }

  /**
   * Play a cue but FIRST check the live settings: master `sounds.enabled`, the
   * per-event toggle (`sounds.tradeOpen` / `…tradeClose` / `…alert`), and apply
   * `sounds.volume`. A missing toggle defaults to ON (the descriptors ship them on,
   * but treat absence as enabled so an older persisted file still plays). Returns
   * whether a sound was actually triggered (useful in tests).
   */
  playGated(kind: SoundKind): boolean {
    if (getSetting<boolean>('sounds.enabled') === false) return false;
    const toggle = getSetting<boolean>(EVENT_TOGGLE[kind]);
    if (toggle === false) return false;
    const v = getSetting<number>('sounds.volume');
    const volume = typeof v === 'number' && Number.isFinite(v) ? v : 0.6;
    if (volume <= 0) return false;
    this.play(kind, volume);
    return true;
  }

  /** Wire one tone: osc → its own gain (ADSR-ish) → destination. */
  private scheduleTone(ctx: AudioContext, tone: Tone, t0: number, masterVol: number): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tone.type ?? 'sine';
    osc.frequency.setValueAtTime(tone.freq, t0 + tone.at);

    const peak = Math.max(0.0001, tone.gain * masterVol);
    const start = t0 + tone.at;
    const end = start + tone.dur;
    const attack = Math.min(0.012, tone.dur * 0.25);
    // Linear attack to peak, exponential decay to near-silence (a soft, musical tail).
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(end + 0.02);
    // Free the nodes once they're done so we don't leak oscillators over a session.
    osc.onended = (): void => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        /* already torn down */
      }
    };
  }
}

/** The shared singleton — one AudioContext for the whole renderer. */
export const soundManager = new SoundManagerImpl();

/** Type alias for consumers that want to accept the manager (e.g. for DI in tests). */
export type SoundManager = SoundManagerImpl;
