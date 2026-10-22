// 休憩タイマー + ワークアウト合計時間。絶対時刻ベースなので画面オフ・タブ切替・再読込でもずれない。
import { CONFIG } from './config.js';
import { safeStorage } from './lib/storage.js';
import { haptic } from './lib/haptics.js';
import { chime } from './lib/sound.js';
import { state as appState } from './store.js';

const KEY = `${CONFIG.keyPrefix}session.v1`;
const STALE_MS = 6 * 3600 * 1000;
const DEFAULT_REST = 120;

const blank = () => ({
  startedAt: null, // ワークアウト開始（合計時間の起点）
  logDate: null, // 記録中の日付（ミニプレイヤーから戻る先）
  part: null,
  restTotal: DEFAULT_REST,
  restEndsAt: null,
  restRemaining: DEFAULT_REST,
  status: 'idle', // idle | running | paused | done
});

let s = blank();
const subs = new Set();
let tickId = null;
let wakeLock = null;
let doneTimer = null;
let nudgeUntil = 0;

function load() {
  const saved = safeStorage.read(KEY, null);
  if (!saved || !saved.startedAt || Date.now() - saved.startedAt > STALE_MS) return;
  s = { ...blank(), ...saved };
  if (s.status === 'running' && s.restEndsAt <= Date.now()) {
    // 離れている間に終わった休憩は静かに待機へ戻す
    s.status = 'idle';
    s.restEndsAt = null;
    s.restRemaining = s.restTotal;
  } else if (s.status === 'done') {
    s.status = 'idle';
    s.restRemaining = s.restTotal;
  }
}

function persist() {
  if (!s.startedAt && s.status === 'idle') safeStorage.remove(KEY);
  else safeStorage.write(KEY, s);
}

function emit() {
  persist();
  subs.forEach((fn) => {
    try {
      fn(snapshot());
    } catch (e) {
      console.error('[timer]', e);
    }
  });
}

const now = () => Date.now();

function remainingNow() {
  if (s.status === 'running') return Math.max(0, (s.restEndsAt - now()) / 1000);
  return s.restRemaining;
}

export function snapshot() {
  const remaining = remainingNow();
  const total = Math.max(s.restTotal, remaining, 1);
  return {
    status: s.status,
    remaining,
    total,
    progress: s.status === 'idle' ? 1 : Math.min(1, remaining / total),
    part: s.part,
    logDate: s.logDate,
    workoutSec: s.startedAt ? (now() - s.startedAt) / 1000 : 0,
    active: !!s.startedAt || s.status === 'running' || s.status === 'paused',
    started: !!s.startedAt,
    nudge: now() < nudgeUntil,
  };
}

function ensureTick() {
  const needed = s.status === 'running' || !!s.startedAt;
  if (needed && !tickId) tickId = setInterval(tick, 250);
  else if (!needed && tickId) {
    clearInterval(tickId);
    tickId = null;
  }
}

function tick() {
  if (s.status === 'running' && s.restEndsAt - now() <= 0) {
    finishRest();
    return;
  }
  subs.forEach((fn) => fn(snapshot()));
}

function finishRest() {
  s.status = 'done';
  s.restEndsAt = null;
  s.restRemaining = 0;
  releaseWakeLock();
  haptic.timerEnd();
  chime('rest-end');
  notifyEnd();
  emit();
  clearTimeout(doneTimer);
  doneTimer = setTimeout(() => {
    if (s.status === 'done') {
      s.status = 'idle';
      s.restRemaining = s.restTotal;
      emit();
    }
  }, 9000);
}

async function notifyEnd() {
  if (document.visibilityState === 'visible') return;
  if (!appState.settings.timer.notify || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.showNotification('休憩終了', { body: '次のセットを始めましょう', tag: 'gymmo2-rest', vibrate: [200, 100, 200], renotify: true });
  } catch {
    /* 通知はベストエフォート */
  }
}

async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    }
  } catch {
    /* 非対応・拒否は無視 */
  }
}
function releaseWakeLock() {
  wakeLock?.release?.().catch?.(() => {});
  wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (s.status === 'running') acquireWakeLock();
    tick();
  }
});

/* ---------- 公開 API ---------- */
export const timer = {
  init() {
    load();
    ensureTick();
    if (s.status === 'running') acquireWakeLock();
    emit();
  },
  subscribe(fn) {
    subs.add(fn);
    fn(snapshot());
    return () => subs.delete(fn);
  },
  snapshot,

  /** 記録画面を開いた日付・部位を伝える（プリセット選択とミニプレイヤーの復帰先に使う） */
  context({ logDate, part }) {
    if (logDate !== undefined) s.logDate = logDate;
    if (part !== undefined && part !== s.part) {
      s.part = part;
      if (s.status === 'idle' || s.status === 'paused') {
        const sec = appState.settings.timer.presets[part] ?? DEFAULT_REST;
        s.restTotal = sec;
        s.restRemaining = sec;
        s.status = 'idle';
      }
    }
    emit();
  },

  setDuration(seconds) {
    const sec = Math.max(5, Math.round(seconds));
    s.restTotal = sec;
    s.restRemaining = sec;
    if (s.status === 'running') s.restEndsAt = now() + sec * 1000;
    if (s.status === 'done') s.status = 'idle';
    emit();
  },

  /** 休憩を（最初から）始める。ワークアウト合計時間もここで開始。 */
  start({ seconds } = {}) {
    clearTimeout(doneTimer);
    if (seconds) s.restTotal = Math.max(5, Math.round(seconds));
    const sec = s.status === 'paused' && !seconds ? s.restRemaining : s.restTotal;
    if (!s.startedAt) s.startedAt = now();
    s.restRemaining = sec;
    s.restEndsAt = now() + sec * 1000;
    s.status = 'running';
    nudgeUntil = 0;
    haptic.impact();
    acquireWakeLock();
    ensureTick();
    emit();
  },

  pause() {
    if (s.status !== 'running') return;
    s.restRemaining = remainingNow();
    s.restEndsAt = null;
    s.status = 'paused';
    haptic.tap();
    releaseWakeLock();
    emit();
  },

  /** 再生ボタン: 待機/完了なら開始、実行中なら一時停止、一時停止なら再開 */
  toggle() {
    if (s.status === 'running') this.pause();
    else this.start();
  },

  reset() {
    clearTimeout(doneTimer);
    s.status = 'idle';
    s.restEndsAt = null;
    s.restRemaining = s.restTotal;
    haptic.tap();
    releaseWakeLock();
    emit();
  },

  adjust(deltaSec) {
    haptic.select();
    if (s.status === 'running') {
      s.restEndsAt = Math.max(now() + 1000, s.restEndsAt + deltaSec * 1000);
    } else {
      s.restRemaining = Math.max(5, s.restRemaining + deltaSec);
      s.restTotal = Math.max(s.restTotal, s.restRemaining);
      if (s.status === 'done') s.status = 'idle';
    }
    emit();
  },

  /** 回数入力後なのにタイマーが止まっているときの「やさしい催促」 */
  nudge(ms = 7000) {
    if (s.status === 'running') return;
    nudgeUntil = now() + ms;
    emit();
    setTimeout(() => subs.forEach((fn) => fn(snapshot())), ms + 50);
  },

  endWorkout() {
    clearTimeout(doneTimer);
    s = blank();
    releaseWakeLock();
    ensureTick();
    emit();
  },
};

/** 部位ごとの既定休憩秒 */
export const presetFor = (part) => appState.settings.timer.presets[part] ?? DEFAULT_REST;
