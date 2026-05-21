#!/usr/bin/env bun
// Fleet Hamlet — notification chime generator.
//
// Renders the same two-note descending bell ("ピロン") that the runtime
// plays for fresh house chat bubbles, but as a 16-bit / 44.1 kHz mono WAV
// committed under web/nextjs/public/sounds/hamlet-notify.wav. The runtime
// loads that file via fetch + decodeAudioData, so this script is the
// source-of-truth for the sound — re-run it whenever the tuning changes.
//
// Usage:
//   bun web/nextjs/scripts/generate-hamlet-notify-sound.ts
//   (writes web/nextjs/public/sounds/hamlet-notify.wav)

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface NoteSpec {
  /** Fundamental frequency in Hz. */
  freq: number;
  /** Start offset within the chime (seconds). */
  start: number;
  /** Envelope length in seconds (attack + exponential decay). */
  dur: number;
  /** Peak envelope gain (0..1). */
  peak: number;
}

const SAMPLE_RATE = 44_100;
const TOTAL_DURATION_S = 0.5;
const MASTER_VOLUME = 0.18;
const ATTACK_S = 0.005;
const FLOOR = 0.0001; // exponential ramp end-target — −80 dB-ish

// G6 → D6 descending bell. Overtones layered at 2× freq with 0.22 gain to
// give the strike a metallic ring without an FM modulator.
const NOTES: readonly NoteSpec[] = [
  { freq: 1567.98, start: 0, dur: 0.16, peak: 1.0 },
  { freq: 1174.66, start: 0.085, dur: 0.34, peak: 0.95 },
];
const OVERTONE_GAIN = 0.22;

function synthesize(): Float32Array {
  const sampleCount = Math.floor(SAMPLE_RATE * TOTAL_DURATION_S);
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / SAMPLE_RATE;
    let sample = 0;
    for (const note of NOTES) {
      const lt = t - note.start;
      if (lt < 0 || lt >= note.dur) continue;
      let env: number;
      if (lt < ATTACK_S) {
        env = (lt / ATTACK_S) * note.peak;
      } else {
        const tail = note.dur - ATTACK_S;
        const local = lt - ATTACK_S;
        // Exponential decay from `peak` to `FLOOR` over `tail` seconds.
        env = note.peak * Math.pow(FLOOR / note.peak, local / tail);
      }
      const fundamental = Math.sin(2 * Math.PI * note.freq * lt);
      const overtone =
        OVERTONE_GAIN * Math.sin(2 * Math.PI * note.freq * 2 * lt);
      sample += env * (fundamental + overtone);
    }
    out[i] = sample * MASTER_VOLUME;
  }
  return out;
}

function floatToWav(samples: Float32Array, sampleRate: number): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataBytes = samples.length * bytesPerSample;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);

  const data = Buffer.alloc(dataBytes);
  for (let i = 0; i < samples.length; i += 1) {
    const raw = samples[i] ?? 0;
    const clamped = raw > 1 ? 1 : raw < -1 ? -1 : raw;
    data.writeInt16LE(Math.round(clamped * 32767), i * bytesPerSample);
  }
  return Buffer.concat([header, data]);
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = join(here, "..", "public", "sounds", "hamlet-notify.wav");
  mkdirSync(dirname(outPath), { recursive: true });
  const samples = synthesize();
  const wav = floatToWav(samples, SAMPLE_RATE);
  writeFileSync(outPath, wav);
  // eslint-disable-next-line no-console
  console.log(
    `wrote ${outPath} — ${wav.length} bytes (${TOTAL_DURATION_S}s @ ${SAMPLE_RATE}Hz mono 16-bit)`,
  );
}

main();
