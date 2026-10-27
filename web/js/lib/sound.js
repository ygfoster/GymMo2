// 休憩終了などの控えめな効果音（WebAudio）。最初のタップで AudioContext を解錠する。
let ctx = null;
let enabled = true;

export function setSoundEnabled(on) {
  enabled = !!on;
}

export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    /* 無視 */
  }
}

function tone(freq, start, dur, gain = 0.18) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + dur + 0.05);
}

export function chime(kind = 'rest-end') {
  if (!enabled || !ctx) return;
  try {
    if (kind === 'rest-end') {
      tone(880, 0, 0.5);
      tone(1174.66, 0.16, 0.5);
      tone(1568, 0.32, 0.9, 0.2);
    } else if (kind === 'pr') {
      tone(784, 0, 0.35, 0.14);
      tone(1046.5, 0.1, 0.35, 0.14);
      tone(1318.5, 0.2, 0.6, 0.16);
    } else if (kind === 'tick') {
      tone(1200, 0, 0.08, 0.06);
    }
  } catch {
    /* 無視 */
  }
}
