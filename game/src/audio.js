// All sound is synthesised with WebAudio — no audio files, no network. Short noise bursts
// through shaped filters make the gunshots; oscillators make the beeps, clicks and stingers.
// One master gain, created lazily on the first user gesture so autoplay rules are honoured.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return false;
    }
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    const length = ctx.sampleRate * 0.6;
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return true;
  }

  function noise({ at = 0, dur = 0.12, freq = 1800, q = 0.7, gain = 0.5, type = 'lowpass', sweepTo = 0 }) {
    if (!ensure()) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + dur);
    filter.Q.value = q;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(amp).connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone({ at = 0, dur = 0.09, freq = 880, gain = 0.18, type = 'square', slideTo = 0 }) {
    if (!ensure()) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(amp).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return {
    unlock: ensure,
    shot(kind) {
      if (kind === 'sniper') { noise({ dur: 0.32, freq: 2600, gain: 0.8, sweepTo: 120 }); tone({ dur: 0.16, freq: 140, gain: 0.5, type: 'triangle', slideTo: 45 }); }
      else if (kind === 'shotgun') { noise({ dur: 0.24, freq: 1500, gain: 0.85, sweepTo: 90 }); tone({ dur: 0.12, freq: 110, gain: 0.5, type: 'triangle', slideTo: 40 }); }
      else if (kind === 'smg') { noise({ dur: 0.09, freq: 2200, gain: 0.5, sweepTo: 300 }); }
      else if (kind === 'pistol') { noise({ dur: 0.11, freq: 2000, gain: 0.55, sweepTo: 200 }); }
      else { noise({ dur: 0.14, freq: 1900, gain: 0.65, sweepTo: 160 }); tone({ dur: 0.07, freq: 180, gain: 0.25, type: 'triangle', slideTo: 60 }); }
    },
    enemyShot() { noise({ dur: 0.1, freq: 1200, gain: 0.16, sweepTo: 200 }); },
    dryFire() { tone({ dur: 0.04, freq: 1400, gain: 0.12 }); },
    reload() { tone({ dur: 0.05, freq: 500, gain: 0.2 }); tone({ at: 0.16, dur: 0.05, freq: 300, gain: 0.2 }); tone({ at: 0.42, dur: 0.06, freq: 750, gain: 0.24 }); },
    hit(head) { tone({ dur: 0.05, freq: head ? 1560 : 1050, gain: 0.22 }); if (head) tone({ at: 0.05, dur: 0.07, freq: 2100, gain: 0.2 }); },
    hurt() { noise({ dur: 0.12, freq: 500, gain: 0.3, sweepTo: 120 }); },
    kill() { tone({ dur: 0.07, freq: 660, gain: 0.2 }); tone({ at: 0.07, dur: 0.1, freq: 990, gain: 0.2 }); },
    step() { noise({ dur: 0.05, freq: 400, gain: 0.05, sweepTo: 150 }); },
    jump() { noise({ dur: 0.06, freq: 700, gain: 0.06 }); },
    throwWhoosh() { noise({ dur: 0.18, freq: 900, gain: 0.12, type: 'bandpass', sweepTo: 2400 }); },
    explosion() { noise({ dur: 0.7, freq: 900, gain: 1.0, sweepTo: 40 }); tone({ dur: 0.5, freq: 90, gain: 0.7, type: 'sine', slideTo: 30 }); },
    flashPop() { noise({ dur: 0.08, freq: 3200, gain: 0.4, type: 'highpass' }); },
    smokeHiss() { noise({ dur: 0.8, freq: 2600, gain: 0.1, type: 'bandpass' }); },
    beep(final) { tone({ dur: final ? 0.3 : 0.07, freq: final ? 1320 : 980, gain: 0.2 }); },
    plantDone() { tone({ dur: 0.08, freq: 740, gain: 0.2 }); tone({ at: 0.1, dur: 0.12, freq: 1180, gain: 0.2 }); },
    defuseDone() { tone({ dur: 0.08, freq: 1180, gain: 0.2 }); tone({ at: 0.1, dur: 0.12, freq: 740, gain: 0.2 }); },
    buy() { tone({ dur: 0.05, freq: 1250, gain: 0.15 }); tone({ at: 0.05, dur: 0.08, freq: 1670, gain: 0.15 }); },
    denied() { tone({ dur: 0.12, freq: 220, gain: 0.2, type: 'sawtooth' }); },
    roundWin() { tone({ dur: 0.12, freq: 523, gain: 0.2, type: 'triangle' }); tone({ at: 0.12, dur: 0.12, freq: 659, gain: 0.2, type: 'triangle' }); tone({ at: 0.24, dur: 0.22, freq: 784, gain: 0.22, type: 'triangle' }); },
    roundLose() { tone({ dur: 0.14, freq: 392, gain: 0.2, type: 'triangle' }); tone({ at: 0.14, dur: 0.14, freq: 330, gain: 0.2, type: 'triangle' }); tone({ at: 0.28, dur: 0.26, freq: 262, gain: 0.22, type: 'triangle' }); },
    countGo() { tone({ dur: 0.16, freq: 880, gain: 0.22 }); },
  };
}
