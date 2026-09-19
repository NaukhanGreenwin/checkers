/**
 * sound.js — tiny Web Audio synth. No external assets, no licensing.
 * Off by default; the context is created lazily on first enabled use so
 * autoplay policies never produce a console warning.
 */

let ctx = null;
let enabled = false;

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function setEnabled(v) {
  enabled = !!v;
  if (enabled) ac();
}

export function isEnabled() {
  return enabled;
}

function tone({ freq, dur = 0.12, type = 'sine', gain = 0.09, slideTo = null, delay = 0 }) {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

function noise({ dur = 0.07, gain = 0.06, delay = 0 }) {
  const a = ac();
  if (!a) return;
  const frames = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, frames, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filt = a.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.value = 1500;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(filt).connect(g).connect(a.destination);
  src.start(a.currentTime + delay);
}

export const sfx = {
  move() {
    if (!enabled) return;
    tone({ freq: 380, slideTo: 230, dur: 0.07, type: 'triangle', gain: 0.07 });
    noise({ dur: 0.045, gain: 0.03 });
  },
  capture() {
    if (!enabled) return;
    tone({ freq: 300, slideTo: 140, dur: 0.12, type: 'square', gain: 0.055 });
    noise({ dur: 0.09, gain: 0.07 });
  },
  king() {
    if (!enabled) return;
    [523.25, 659.25, 783.99].forEach((f, i) =>
      tone({ freq: f, dur: 0.16, type: 'triangle', gain: 0.07, delay: i * 0.075 }));
  },
  win() {
    if (!enabled) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone({ freq: f, dur: 0.30, type: 'triangle', gain: 0.075, delay: i * 0.11 }));
  },
  lose() {
    if (!enabled) return;
    [440, 370, 294].forEach((f, i) =>
      tone({ freq: f, dur: 0.30, type: 'sine', gain: 0.07, delay: i * 0.13 }));
  },
  select() {
    if (!enabled) return;
    tone({ freq: 620, dur: 0.045, type: 'sine', gain: 0.04 });
  },
  invalid() {
    if (!enabled) return;
    tone({ freq: 150, dur: 0.1, type: 'sawtooth', gain: 0.035 });
  },
};
