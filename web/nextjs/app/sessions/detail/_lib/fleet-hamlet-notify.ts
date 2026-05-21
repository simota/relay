// Fleet Hamlet — Notification chime playback.
//
// Plays /sounds/hamlet-notify.wav (a short two-note descending bell) via
// the Web Audio API. The WAV is the source-of-truth and lives under
// `web/nextjs/public/sounds/` — re-render with the generator script in
// `web/nextjs/scripts/generate-hamlet-notify-sound.ts` if the tuning ever
// changes. AudioBufferSourceNode is used so repeated chimes don't compete
// for a single <audio> element and stay sample-accurate.
//
// AudioContext lifecycle:
//   - Lazily constructed on first call (SSR-safe).
//   - Browsers require a user gesture before sound can play; `primeOnGesture`
//     attaches one-shot pointer/key listeners that resume the context AND
//     kick off buffer preload on first interaction.

export const CHIME_URL = "/sounds/hamlet-notify.wav";

let ctx: AudioContext | null = null;
let buffer: AudioBuffer | null = null;
let bufferLoad: Promise<AudioBuffer | null> | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx && ctx.state !== "closed") return ctx;
  const Ctor =
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

function loadBuffer(c: AudioContext): Promise<AudioBuffer | null> {
  if (buffer) return Promise.resolve(buffer);
  if (bufferLoad) return bufferLoad;
  bufferLoad = (async () => {
    try {
      const res = await fetch(CHIME_URL, { cache: "force-cache" });
      if (!res.ok) return null;
      const bytes = await res.arrayBuffer();
      const decoded = await c.decodeAudioData(bytes);
      buffer = decoded;
      return decoded;
    } catch {
      return null;
    } finally {
      bufferLoad = null;
    }
  })();
  return bufferLoad;
}

function playBuffer(c: AudioContext, buf: AudioBuffer, gain: number): void {
  const src = c.createBufferSource();
  src.buffer = buf;
  if (gain === 1) {
    src.connect(c.destination);
  } else {
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(g).connect(c.destination);
  }
  src.start();
}

/**
 * Trigger the notification chime. No-op when audio is unavailable. The WAV
 * is decoded lazily on first play; subsequent calls reuse the cached buffer
 * so latency stays sample-accurate.
 *
 * @param gain Multiplier on top of the WAV's baked-in mix level (1 = file as-is).
 */
export function playMessageChime(gain: number = 1): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") {
    void c.resume().catch(() => {});
  }
  if (buffer) {
    playBuffer(c, buffer, gain);
    return;
  }
  void loadBuffer(c).then((buf) => {
    if (buf) playBuffer(c, buf, gain);
  });
}

/**
 * Resume the AudioContext and preload the chime buffer on the first user
 * gesture. Returns a cleanup function so callers can detach the listeners
 * early (e.g., on unmount before any interaction).
 */
export function primeOnGesture(): () => void {
  if (typeof window === "undefined") return () => {};
  let primed = false;
  const handler = () => {
    if (primed) return;
    primed = true;
    const c = getCtx();
    if (!c) return;
    if (c.state === "suspended") void c.resume().catch(() => {});
    void loadBuffer(c);
    window.removeEventListener("pointerdown", handler);
    window.removeEventListener("keydown", handler);
  };
  window.addEventListener("pointerdown", handler, { once: true });
  window.addEventListener("keydown", handler, { once: true });
  return () => {
    window.removeEventListener("pointerdown", handler);
    window.removeEventListener("keydown", handler);
  };
}
