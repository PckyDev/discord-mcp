// Original deterministic 100 BPM electronic score. No sampled music or voices.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const out = fileURLToPath(new URL('../assets/', import.meta.url));
mkdirSync(out, { recursive: true });
const sr = 44100, seconds = 74, count = sr * seconds, beat = 60 / 100;
const left = new Float64Array(count), right = new Float64Array(count);
const tau = 2 * Math.PI;
const hz = midi => 440 * 2 ** ((midi - 69) / 12);
function note(start, duration, midi, level, pan = 0, type = 'pluck') {
  const base = hz(midi), offset = Math.round(start * sr);
  for (let k = 0; k < duration * sr && offset + k < count; k++) {
    const t = k / sr, release = Math.min(1, (duration - t) / .28);
    const env = type === 'pad' ? Math.min(1, t / .35) * release * .55 : (1 - Math.exp(-t * 300)) * Math.exp(-t * 4.4) * release;
    const tone = Math.sin(tau * base * t) + .22 * Math.sin(tau * base * 2.003 * t) + .06 * Math.sin(tau * base * 3 * t);
    left[offset + k] += tone * env * level * (1 - pan * .4);
    right[offset + k] += (tone + .025 * Math.sin(tau * base * 1.007 * t)) * env * level * (1 + pan * .4);
  }
}
const chords = [[50,57,61,66],[47,54,57,62],[43,50,54,59],[45,52,57,61]];
for (let bar = 0; bar < 29; bar++) {
  const chord = chords[bar % 4], start = bar * beat * 4;
  chord.forEach((m, i) => note(start, beat * 4 + .5, m + 12, .06, (i - 1.5) / 2, 'pad'));
  for (let b = 0; b < 4; b++) {
    const t = start + b * beat;
    if (t > 68) break;
    const asking = (t > 6 && t < 16) || (t > 31 && t < 41);
    note(t, 1.6, chord[[0,2,1,3][b]] + 24, asking ? .09 : .13, b % 2 ? .65 : -.65);
  }
  if (bar > 0 && start < 68 && !(start >= 6 && start < 16) && !(start >= 31 && start < 41)) for (let b = 0; b < 4; b += 2) {
    const t0 = start + b * beat, off = Math.round(t0 * sr);
    for (let k = 0; k < .32 * sr && off + k < count; k++) {
      const t = k / sr, v = Math.sin(tau * (46 * t + 1.9 * (1 - Math.exp(-t * 45)))) * Math.exp(-t * 18) * .28;
      left[off + k] += v; right[off + k] += v;
    }
    note(t0, .3, chord[0] - 12, .10, 0, 'pad');
  }
}
[50,57,61,66,74].forEach((m, i) => note(69 + i * .04, 5 - i * .04, m, .10, (i - 2) * .2, 'pad'));
[78,81,86].forEach((m, i) => note(69 + i * .12, 3.8, m, .11, (i - 1) * .5));
for (const [lag, gain] of [[.273, .20], [.545, .11]]) {
  const d = Math.round(lag * sr);
  for (let i = count - 1; i >= d; i--) {left[i] += right[i - d] * gain;right[i] += left[i - d] * gain;}
}
let peak = 0;
for (let i = 0; i < count; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
const pcm = Buffer.alloc(count * 4 + 44);
pcm.write('RIFF');pcm.writeUInt32LE(pcm.length - 8, 4);pcm.write('WAVEfmt ', 8);pcm.writeUInt32LE(16, 16);pcm.writeUInt16LE(1, 20);pcm.writeUInt16LE(2, 22);
pcm.writeUInt32LE(sr, 24);pcm.writeUInt32LE(sr * 4, 28);pcm.writeUInt16LE(4, 32);pcm.writeUInt16LE(16, 34);pcm.write('data', 36);pcm.writeUInt32LE(count * 4, 40);
for (let i = 0; i < count; i++) {
  const t = i / sr, fade = Math.min(1, t / .3, Math.max(0, (seconds - t) / 2.5));
  pcm.writeInt16LE(Math.round(left[i] / peak * 26000 * fade), 44 + i * 4);pcm.writeInt16LE(Math.round(right[i] / peak * 26000 * fade), 46 + i * 4);
}
writeFileSync(out + 'score.wav', pcm);
console.log('Original score: 74 seconds, 100 BPM, stereo 44.1 kHz.');
