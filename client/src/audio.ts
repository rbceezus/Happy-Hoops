// Sons sintetizados com WebAudio (sem arquivos): chuá, aro, tabela, toco, ankle breaker, quique, buzina.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
export let muted = false;

export function initAudio() {
  if (ctx) { void ctx.resume(); return; }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function setMuted(m: boolean) { muted = m; if (master) master.gain.value = m ? 0 : 0.8; }

function noise(dur: number, filt: { type: BiquadFilterType; f: number; q?: number; f2?: number }, gain: number, atk = 0.005, delay = 0) {
  if (!ctx || !master || !noiseBuf) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = filt.type; bp.frequency.setValueAtTime(filt.f, t); bp.Q.value = filt.q ?? 1;
  if (filt.f2) bp.frequency.exponentialRampToValueAtTime(filt.f2, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp); bp.connect(g); g.connect(master);
  src.start(t, Math.random()); src.stop(t + dur + 0.05);
}

function tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', freq2?: number, delay = 0) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freq2) o.frequency.exponentialRampToValueAtTime(freq2, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

/** Chuá: bola passando limpa pela rede. */
export function swish(v = 1) {
  noise(0.42, { type: 'bandpass', f: 5200, f2: 2400, q: 0.9 }, 0.5 * v, 0.02);
  noise(0.3, { type: 'highpass', f: 3000 }, 0.25 * v, 0.03, 0.02);
}

/** Aro: clang metálico. */
export function rim(v = 0.7) {
  const base = 480 + Math.random() * 120;
  [1, 2.32, 3.9, 5.47].forEach((m, i) => tone(base * m, 0.7 - i * 0.12, (0.28 * v) / (i + 1), 'sine'));
  noise(0.05, { type: 'highpass', f: 2500 }, 0.3 * v, 0.001);
}

export function board(v = 0.7) {
  tone(170, 0.18, 0.4 * v, 'triangle', 90);
  noise(0.1, { type: 'bandpass', f: 900, q: 0.8 }, 0.35 * v, 0.002);
}

/** Toco: tapa seca + reação. */
export function block() {
  tone(210, 0.16, 0.7, 'square', 60);
  noise(0.14, { type: 'bandpass', f: 1800, q: 0.7 }, 0.8, 0.002);
  noise(0.7, { type: 'bandpass', f: 700, f2: 1100, q: 2 }, 0.25, 0.15, 0.08);
}

/** Ankle breaker: tênis cantando + "ooooh" da torcida + impacto. */
export function ankle() {
  for (let i = 0; i < 3; i++) tone(1500 + i * 220, 0.11, 0.18, 'sawtooth', 2600 + i * 200, i * 0.07);
  noise(0.12, { type: 'bandpass', f: 3800, q: 6 }, 0.35, 0.002);
  tone(120, 0.25, 0.6, 'sine', 45, 0.12);
  // coro "oooh"
  noise(1.1, { type: 'bandpass', f: 420, f2: 780, q: 3.5 }, 0.45, 0.25, 0.1);
  noise(1.1, { type: 'bandpass', f: 950, f2: 1500, q: 4 }, 0.25, 0.3, 0.1);
}

export function bounce(v = 0.5) {
  tone(130 + Math.random() * 20, 0.12, 0.5 * v, 'sine', 70);
  noise(0.04, { type: 'lowpass', f: 600 }, 0.3 * v, 0.001);
}

export function whoosh() { noise(0.16, { type: 'bandpass', f: 1400, f2: 500, q: 1.2 }, 0.15, 0.03); }
export function whistle() { tone(2900, 0.22, 0.18, 'sine', 3100); tone(2950, 0.14, 0.14, 'sine', 3050, 0.25); }
export function buzzer() { tone(180, 1.0, 0.35, 'sawtooth'); tone(185, 1.0, 0.3, 'square'); }
export function cheer() { noise(1.2, { type: 'bandpass', f: 900, f2: 1700, q: 0.8 }, 0.35, 0.15); }
export function tick() { tone(900, 0.05, 0.12, 'square'); }
export function violation() { tone(300, 0.25, 0.25, 'square', 200); }

/** Enterrada: aro vibrando forte + tabela + torcida. */
export function dunk() {
  board(1);
  [1, 1.7, 2.6, 3.9].forEach((m, i) => tone(330 * m, 0.9 - i * 0.12, 0.34 / (i + 1), 'sine', undefined, 0.02));
  tone(90, 0.35, 0.7, 'sine', 40);
  noise(0.09, { type: 'highpass', f: 2200 }, 0.5, 0.001);
  noise(1.6, { type: 'bandpass', f: 800, f2: 1900, q: 0.8 }, 0.5, 0.2, 0.1);
}
