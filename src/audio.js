// Synthesized sound effects (WebAudio). No audio files, so no asset or licensing dependency.
let ac = null, muted = false, bgmTimer = null;

export function unlock() {
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { ac = null; } }
  if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
}
export function setMuted(m) { muted = m; if (m) stopBgm(); }
export function isMuted() { return muted; }

function tone(freq, dur, type = 'square', vol = .05, slide = 0, delay = 0) {
  if (muted || !ac) return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + .02);
}
function noise(dur, vol = .12, lowpass = 0) {
  if (muted || !ac) return;
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = ac.createBufferSource(), g = ac.createGain(); g.gain.value = vol;
  s.buffer = buf;
  if (lowpass) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass; s.connect(f).connect(g).connect(ac.destination); }
  else s.connect(g).connect(ac.destination);
  s.start();
}

export const sfx = {
  blip: () => tone(880, .03, 'square', .012),
  select: () => tone(660, .06, 'square', .035),
  back: () => tone(440, .06, 'square', .03),
  hit: () => noise(.16, .12),
  bigHit: () => { noise(.3, .18, 900); tone(160, .25, 'sawtooth', .06, -100); },
  slash: () => { noise(.08, .08); tone(1200, .08, 'square', .03, -700); },
  crit: () => { noise(.25, .14); [880, 1320, 1760].forEach((f, i) => tone(f, .09, 'square', .04, 0, i * .05)); },
  heal: () => [660, 880, 1100].forEach((f, i) => tone(f, .12, 'triangle', .045, 0, i * .09)),
  shield: () => tone(520, .18, 'triangle', .04, 300),
  faint: () => tone(520, .5, 'triangle', .06, -440),
  roar: () => { noise(.6, .2, 400); tone(90, .6, 'sawtooth', .08, -40); },
  pause: () => { tone(740, .08, 'square', .04); tone(740, .08, 'square', .04, 0, .12); },
  cutin: () => { noise(.12, .1); tone(220, .35, 'sawtooth', .07, 600); },
  level: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, .14, 'square', .04, 0, i * .11)),
  win: () => [784, 784, 784, 1046, 0, 932, 1046].forEach((f, i) => f && tone(f, i === 6 ? .5 : .12, 'square', .04, 0, i * .13)),
  lose: () => [440, 415, 392, 349].forEach((f, i) => tone(f, .25, 'triangle', .05, 0, i * .22)),
  stamp: () => { noise(.1, .15, 600); tone(110, .2, 'square', .06, -60); },
  tick: () => tone(1500, .02, 'square', .01),
};

/** Minimal looping BGM: a 4-bar bass + arpeggio pattern. Intensity 0..1 raises tempo and brightness. */
export function startBgm(intensity = .3) {
  stopBgm();
  if (muted || !ac) return;
  const bass = [55, 55, 65.4, 49], arp = [[220, 277, 330], [220, 277, 330], [261, 330, 392], [196, 247, 294]];
  let bar = 0, beat = 0;
  const bpm = 96 + intensity * 40, beatMs = 60000 / bpm / 2;
  bgmTimer = setInterval(() => {
    if (muted) return;
    const b = bass[bar % 4], a = arp[bar % 4];
    if (beat % 2 === 0) tone(b, .22, 'triangle', .05);
    tone(a[beat % 3] * (beat % 4 === 3 ? 2 : 1), .1, 'square', .012 + intensity * .01);
    beat++; if (beat >= 8) { beat = 0; bar++; }
  }, beatMs);
}
export function stopBgm() { if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; } }
