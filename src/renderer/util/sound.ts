/**
 * Attention chime, synthesized via Web Audio API -- no bundled audio asset,
 * no licensing to think about, and it stays a tiny file.
 */

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") return null;
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

function tone(context: AudioContext, freq: number, startAt: number, duration: number, peak: number): void {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(context.destination);

  // Quick attack, gentle exponential decay -- a soft "ding", not a beep.
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.start(startAt);
  osc.stop(startAt + duration + 0.05);
}

/** Two-note ascending chime -- distinct enough to notice, soft enough not to startle. */
export function playAttentionChime(): void {
  const context = getContext();
  if (!context) return;
  if (context.state === "suspended") {
    context.resume().catch(() => {
      // Browsers block audio until a user gesture has occurred somewhere in
      // the page; if that hasn't happened yet, silently skip this chime
      // rather than throwing.
    });
  }
  const now = context.currentTime;
  tone(context, 740, now, 0.22, 0.16); // F#5
  tone(context, 988, now + 0.1, 0.28, 0.14); // B5
}
