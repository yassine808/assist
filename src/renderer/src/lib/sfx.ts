// Tiny WebAudio synth: no audio files needed. Toggle with sfx.setEnabled(false).
let ctx: AudioContext | null = null;
let enabled = (() => {
  try { return localStorage.getItem("rs_sfx") !== "off"; } catch { return true; }
})();

function ac(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch { return null; }
}

interface ToneOpts { type?: OscillatorType; gain?: number; to?: number; delay?: number }

function tone(freq: number, dur: number, { type = "sine", gain = 0.05, to, delay = 0 }: ToneOpts = {}) {
  if (!enabled) return;
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

let lastHover = 0;

export const sfx = {
  hover() {
    const now = performance.now();
    if (now - lastHover < 80) return;
    lastHover = now;
    tone(2200, 0.045, { type: "triangle", gain: 0.012, to: 2600 });
  },
  start() {
    tone(110, 0.28, { gain: 0.16, to: 42 });                       // thump
    tone(320, 0.22, { type: "sawtooth", gain: 0.02, to: 1100 });   // rising sweep
  },
  launched() {
    tone(659, 0.35, { gain: 0.05 });
    tone(988, 0.45, { gain: 0.045, delay: 0.09 });
    tone(1480, 0.6, { gain: 0.02, delay: 0.18 });
  },
  setEnabled(v: boolean) {
    enabled = v;
    try { localStorage.setItem("rs_sfx", v ? "on" : "off"); } catch { /* ignore */ }
  },
  isEnabled: () => enabled,
};
