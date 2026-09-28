// Synthesised sound. AudioContext is created on the first user gesture.
// Song shapes follow RSPB descriptions: robin = short gushing phrases of twitters and
// trills; blue tit = high 'tsee tsee' then a lower rattle; goldfinch = liquid twittering;
// song thrush = phrases repeated two or three times; wren = loud rapid trill.
let ctx = null, master = null, windGain = null, enabled = true;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
  startWind();
}

export function setEnabled(on) {
  enabled = on;
  if (master) master.gain.setTargetAtTime(on ? 0.55 : 0, ctx.currentTime, 0.05);
}
export const isEnabled = () => enabled;

function tone(t, f0, f1, dur, vol = 0.18, type = 'sine') {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.01, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

function noiseBurst(t, dur, vol, freq, q = 1) {
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t);
}

const SONGS = {
  robin(t) {
    const notes = [3400, 5200, 4100, 6100, 3800, 4700, 5600];
    notes.forEach((f, i) => tone(t + i * 0.085, f, f * (i % 2 ? 0.8 : 1.15), 0.07, 0.12));
    tone(t + 0.66, 2900, 2600, 0.25, 0.1);
  },
  bluetit(t) {
    tone(t, 7200, 6900, 0.09, 0.12); tone(t + 0.14, 7200, 6900, 0.09, 0.12);
    for (let i = 0; i < 8; i++) tone(t + 0.32 + i * 0.035, 4200, 3900, 0.03, 0.1, 'triangle');
  },
  goldfinch(t) {
    for (let i = 0; i < 9; i++) { const f = 4000 + Math.sin(i * 1.7) * 1400; tone(t + i * 0.06, f, f * 1.25, 0.05, 0.1); }
  },
  thrush(t) {
    for (let rep = 0; rep < 3; rep++) {
      const s = t + rep * 0.22;
      tone(s, 2600, 3900, 0.07, 0.14); tone(s + 0.09, 3900, 2400, 0.08, 0.14);
    }
  },
  wren(t) {
    for (let i = 0; i < 18; i++) tone(t + i * 0.028, 5200 + (i % 3) * 700, 4800, 0.024, 0.16, 'triangle');
    tone(t + 0.55, 4300, 6200, 0.12, 0.14);
  },
};

export function birdSong(key) { if (ctx && enabled && SONGS[key]) SONGS[key](ctx.currentTime + 0.01); }

export function stretch(amount) {
  if (!ctx || !enabled) return;
  tone(ctx.currentTime, 90 + amount * 160, 100 + amount * 170, 0.06, 0.03, 'sawtooth');
}
export function twang() {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime;
  tone(t, 180, 60, 0.35, 0.25, 'triangle');
  noiseBurst(t, 0.25, 0.25, 900, 0.8);
}
export function thud(strength = 1, mat = 'wood') {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime;
  const f = mat === 'stone' ? 380 : mat === 'twig' ? 1600 : 700;
  noiseBurst(t, 0.12 + strength * 0.1, Math.min(0.6, 0.12 + strength * 0.3), f, mat === 'twig' ? 3 : 1.4);
  if (mat !== 'twig') tone(t, f * 0.4, f * 0.2, 0.12, Math.min(0.3, 0.05 + strength * 0.15), 'sine');
}
export function crack(mat = 'wood') {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime;
  noiseBurst(t, 0.3, 0.55, mat === 'stone' ? 500 : 1800, 2);
  noiseBurst(t + 0.05, 0.2, 0.3, mat === 'stone' ? 250 : 3200, 4);
}
export function squeak() {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime;
  tone(t, 1800, 3200, 0.08, 0.14, 'square'); tone(t + 0.1, 2600, 1200, 0.14, 0.12, 'square');
}
export function whoosh() {
  if (!ctx || !enabled) return;
  noiseBurst(ctx.currentTime, 0.4, 0.3, 1400, 0.6);
}
export function fanfare() {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime;
  [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.12, f, f, 0.22, 0.14, 'triangle'));
}

// Upland wind: filtered looping noise, gusting slowly. Strength follows live wind speed.
function startWind() {
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) { last = last * 0.985 + (Math.random() * 2 - 1) * 0.015; d[i] = last * 6; }
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520;
  windGain = ctx.createGain(); windGain.gain.value = 0.05;
  src.connect(f); f.connect(windGain); windGain.connect(master);
  src.start();
}
export function setWindLevel(speed) {
  if (!windGain) return;
  const t = ctx.currentTime;
  const base = Math.min(0.22, 0.03 + speed * 0.012);
  windGain.gain.setTargetAtTime(base * (0.75 + Math.random() * 0.5), t, 1.2);
}
