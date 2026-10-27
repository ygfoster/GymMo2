// 触覚フィードバック（Android Chrome の Vibration API）。iOS Safari では何も起きないだけで害はない。
let enabled = true;

export function setHapticsEnabled(on) {
  enabled = !!on;
}

function vib(pattern) {
  if (!enabled || typeof navigator === 'undefined' || !navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* 非対応環境は無視 */
  }
}

export const haptic = {
  select: () => vib(6),
  tap: () => vib(9),
  impact: () => vib(16),
  success: () => vib([10, 36, 18]),
  warning: () => vib([18, 40, 18]),
  error: () => vib([22, 34, 22, 34, 30]),
  timerEnd: () => vib([260, 120, 260, 120, 420]),
};
