// 表示用の数値・時間フォーマット
export const fmtInt = (n) => (n == null || Number.isNaN(n) ? '--' : Math.round(n).toLocaleString('ja-JP'));

export const fmtSigned = (n) => (n == null ? '--' : (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(Math.round(n)).toLocaleString('ja-JP'));

/** 22.5 → "22.5"、50 → "50" */
export const fmtNum = (n, digits = 1) => (n == null ? '--' : String(Number(n.toFixed(digits))));

export const fmtPct = (r, digits = 0) => (r == null ? '--' : `${(r * 100).toFixed(digits)}%`);

export const fmtDeltaPct = (r) => (r == null ? '' : `${r >= 0 ? '+' : '−'}${Math.abs(r * 100).toFixed(0)}%`);

/** 秒 → "03:05" または "1:02:03" */
export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
}

/** 秒 → "3分" / "1分30秒" / "45秒" */
export function fmtDurationJa(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m && s) return `${m}分${s}秒`;
  if (m) return `${m}分`;
  return `${s}秒`;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
