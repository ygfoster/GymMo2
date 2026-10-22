// アプリ全体の状態・永続化・同期。画面は on('data'|'settings'|'sync') を購読して再描画する。
import { CONFIG } from './config.js';
import { createLiveApi, createDemoApi, ApiError } from './api.js';
import { safeStorage } from './lib/storage.js';
import { rowsToTraining, rowsToHealth, trainingToRows, mergeHealth, normalizeHealthRow, normPart } from './lib/parse.js';
import { buildExerciseIndex } from './lib/metrics.js';
import { setHapticsEnabled } from './lib/haptics.js';
import { setSoundEnabled } from './lib/sound.js';
import { native } from './native.js';

const K = (n) => CONFIG.keyPrefix + n;
const KEYS = {
  settings: K('settings.v1'),
  token: K('token'),
  mode: K('mode'),
  cache: (m) => K(`cache.v1.${m}`),
  queue: (m) => K(`queue.v1.${m}`),
  draft: (d) => K(`draft.v1.${d}`),
};

export const PART_ORDER = ['胸', '背中', '脚', '肩', '腕', 'その他'];

export const DEFAULT_SETTINGS = {
  theme: 'auto', // auto | light | dark
  haptics: true,
  sound: true,
  goals: { sleepMin: 420, protein: 140, kcal: null }, // kcal: null＝消費カロリーを目安にする
  timer: {
    autoStart: true,
    nudge: true,
    notify: native.available, // アプリ版は通知が主役なので既定でオン（ブラウザ版は許可が要るのでオフ）
    presets: { 胸: 180, 背中: 180, 脚: 180, 肩: 90, 腕: 120, その他: 120 },
  },
  partColors: { 胸: '#FF453A', 背中: '#0A84FF', 脚: '#30D158', 肩: '#FF9F0A', 腕: '#BF5AF2', その他: '#8E8E93' },
};

function mergeSettings(base, saved) {
  const out = JSON.parse(JSON.stringify(base));
  if (!saved || typeof saved !== 'object') return out;
  for (const k of Object.keys(out)) {
    if (!(k in saved)) continue;
    if (out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      for (const kk of Object.keys(out[k])) {
        if (saved[k]?.[kk] === undefined) continue;
        if (out[k][kk] && typeof out[k][kk] === 'object') out[k][kk] = { ...out[k][kk], ...saved[k][kk] };
        else out[k][kk] = saved[k][kk];
      }
    } else {
      out[k] = saved[k];
    }
  }
  return out;
}

export const state = {
  mode: null, // 'live' | 'demo' | null（未接続）
  loaded: false, // キャッシュ or 初回同期でデータが載ったか
  training: {},
  health: {},
  queue: [],
  settings: mergeSettings(DEFAULT_SETTINGS, null),
  sync: { state: 'idle', error: null, lastAt: null, pending: 0 },
};

/* ---------- イベント ---------- */
const listeners = { data: new Set(), settings: new Set(), sync: new Set() };
export function on(topic, fn) {
  listeners[topic].add(fn);
  return () => listeners[topic].delete(fn);
}
function emit(topic) {
  listeners[topic].forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error(`[store:${topic}]`, e);
    }
  });
}

/* ---------- 派生データ ---------- */
let dataVersion = 0;
let indexVersion = -1;
let indexCache = null;
export function getIndex() {
  if (indexVersion !== dataVersion) {
    indexCache = buildExerciseIndex(state.training);
    indexVersion = dataVersion;
  }
  return indexCache;
}
const bump = () => {
  dataVersion += 1;
};

/* ---------- 設定 ---------- */
export function updateSettings(patch) {
  state.settings = mergeSettings(state.settings, patch);
  safeStorage.write(KEYS.settings, state.settings);
  applySettings();
  emit('settings');
}

export function effectiveScheme() {
  const t = state.settings.theme;
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applySettings() {
  const s = state.settings;
  const root = document.documentElement;
  if (s.theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', s.theme);
  const meta = document.querySelector('meta[name="theme-color"]:not([media])') || document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', effectiveScheme() === 'dark' ? '#000000' : '#F2F2F7');
  setHapticsEnabled(s.haptics);
  setSoundEnabled(s.sound);
  if (native.available) {
    const dark = effectiveScheme() === 'dark';
    native.setTheme(dark, dark ? '#000000' : '#F2F2F7');
  }
  for (const [part, color] of Object.entries(s.partColors)) root.style.setProperty(`--part-${PART_ORDER.indexOf(part)}`, color);
}

export const partColor = (part) => state.settings.partColors[part] || state.settings.partColors['その他'];

/* ---------- API ---------- */
let api = null;
let demoApi = null;
const getToken = () => safeStorage.readRaw(KEYS.token, '');

function buildApi() {
  if (state.mode === 'demo') {
    demoApi ||= createDemoApi();
    api = demoApi;
  } else if (state.mode === 'live') {
    api = createLiveApi({ url: CONFIG.apiUrl, getToken });
  } else {
    api = null;
  }
}

/* ---------- 永続化 ---------- */
function persistCache() {
  if (!state.mode) return;
  safeStorage.write(KEYS.cache(state.mode), { v: 1, training: state.training, health: state.health, at: Date.now() });
}
function persistQueue() {
  if (!state.mode) return;
  safeStorage.write(KEYS.queue(state.mode), state.queue);
  setSync({ pending: state.queue.length });
}
function loadMode(mode) {
  const cache = safeStorage.read(KEYS.cache(mode), null);
  state.training = cache?.v === 1 ? cache.training || {} : {};
  state.health = cache?.v === 1 ? cache.health || {} : {};
  state.queue = safeStorage.read(KEYS.queue(mode), []) || [];
  state.loaded = cache?.v === 1;
  state.sync.pending = state.queue.length;
  bump();
}

function setSync(patch) {
  Object.assign(state.sync, patch);
  emit('sync');
}

/* ---------- 初期化・接続 ---------- */
export function init() {
  state.settings = mergeSettings(DEFAULT_SETTINGS, safeStorage.read(KEYS.settings, null));
  applySettings();
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applySettings);

  const params = new URLSearchParams(location.search);
  const token = getToken();
  let mode = null;
  if (params.has('demo')) mode = 'demo';
  else if (token && CONFIG.apiUrl) mode = 'live';
  else if (safeStorage.readRaw(KEYS.mode) === 'demo') mode = 'demo';
  setMode(mode);

  window.addEventListener('online', () => {
    if (state.mode) sync({ quiet: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.mode && Date.now() - (state.sync.lastAt || 0) > 90_000) sync({ quiet: true });
  });
  return state.mode;
}

function setMode(mode) {
  state.mode = mode;
  state.loaded = false;
  state.training = {};
  state.health = {};
  state.queue = [];
  if (mode) {
    loadMode(mode);
    buildApi();
    sync({ quiet: true });
  } else {
    api = null;
  }
  emit('data');
  emit('sync');
}

export async function connect(passcode) {
  if (!CONFIG.apiUrl) throw new ApiError('接続先が設定されていません', 'server');
  const token = String(passcode || '').trim();
  if (!token) throw new ApiError('パスコードを入力してください', 'auth');
  const probe = createLiveApi({ url: CONFIG.apiUrl, getToken: () => token });
  await probe.ping();
  safeStorage.writeRaw(KEYS.token, token);
  safeStorage.remove(KEYS.mode);
  setMode('live');
}

export function enterDemo() {
  safeStorage.writeRaw(KEYS.mode, 'demo');
  setMode('demo');
}

export function disconnect() {
  const m = state.mode;
  safeStorage.remove(KEYS.token);
  safeStorage.remove(KEYS.mode);
  if (m) {
    safeStorage.remove(KEYS.cache(m));
    safeStorage.remove(KEYS.queue(m));
  }
  if (m === 'demo') demoApi?.reset?.();
  demoApi = null;
  setMode(null);
}

export function resetDemo() {
  demoApi?.reset?.();
  demoApi = null;
  safeStorage.remove(KEYS.cache('demo'));
  safeStorage.remove(KEYS.queue('demo'));
  setMode('demo');
}

/* ---------- 同期 ---------- */
let syncing = null;
let flushing = null;

function applyQueueOverlay(training) {
  for (const op of state.queue) {
    if (op.kind === 'delete') delete training[op.date];
    else {
      const day = rowsToTraining(op.rows)[op.date];
      if (day) training[op.date] = day;
    }
  }
}

function handleError(e) {
  if (e instanceof ApiError && e.kind === 'auth') {
    safeStorage.remove(KEYS.token);
    setSync({ state: 'error', error: e.message });
    setMode(null);
    return;
  }
  const offline = e instanceof ApiError && (e.kind === 'network' || e.kind === 'timeout');
  setSync({ state: offline ? 'offline' : 'error', error: e.message });
}

export function sync({ quiet = false } = {}) {
  if (!state.mode || !api) return Promise.resolve();
  if (syncing) return syncing;
  syncing = (async () => {
    setSync({ state: 'syncing', error: null });
    try {
      await flushQueue();
      const res = await api.bootstrap();
      const training = rowsToTraining(res.training);
      applyQueueOverlay(training);
      const incoming = rowsToHealth(res.health);
      for (const [d, rec] of Object.entries(incoming)) state.health[d] = mergeHealth(state.health[d], rec);
      state.training = training;
      state.loaded = true;
      bump();
      persistCache();
      emit('data');
      setSync({ state: 'idle', error: null, lastAt: Date.now() });
    } catch (e) {
      if (!quiet || !(e instanceof ApiError && (e.kind === 'network' || e.kind === 'timeout'))) console.warn('[sync]', e);
      handleError(e);
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

export function flushQueue() {
  if (!api || flushing) return flushing || Promise.resolve();
  flushing = (async () => {
    try {
      while (state.queue.length) {
        const op = state.queue[0];
        if (op.kind === 'delete') await api.deleteDay(op.date);
        else await api.saveDay(op.date, op.rows);
        state.queue.shift();
        persistQueue();
      }
    } catch (e) {
      handleError(e);
      throw e;
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

function enqueue(op) {
  state.queue = state.queue.filter((q) => q.date !== op.date);
  state.queue.push({ ...op, at: Date.now() });
  persistQueue();
}

const lastHealthFetch = {};
/** 指定日のヘルスデータを（Google ヘルス API 経由で）取り直す。5 分以内の再取得は抑制。 */
export async function refreshHealth(date, { force = false } = {}) {
  if (state.mode !== 'live' && state.mode !== 'demo') return;
  if (!force && Date.now() - (lastHealthFetch[date] || 0) < 5 * 60_000) return;
  lastHealthFetch[date] = Date.now();
  try {
    const res = await api.health(date);
    const rec = res.row ? normalizeHealthRow(res.row) : null;
    if (rec) {
      state.health[rec.date] = mergeHealth(state.health[rec.date], rec);
      persistCache();
      emit('data');
    }
  } catch (e) {
    if (e instanceof ApiError && e.kind === 'auth') handleError(e);
  }
}

/* ---------- 記録の保存・削除 ---------- */
export function cleanDay(input) {
  const exercises = [];
  for (const ex of input.exercises || []) {
    const name = String(ex.name || '').trim();
    const sets = (ex.sets || []).filter((s) => s.w != null || s.r != null).map((s) => ({ w: s.w ?? null, r: s.r ?? null }));
    const memo = String(ex.memo || '').trim();
    if (!name && !sets.length && !memo) continue;
    exercises.push({ id: ex.id || '', name: name || '種目不明', part: normPart(input.part), sets, memo, raw: ex.raw || '' });
  }
  exercises.forEach((e, i) => (e.id = `${input.date}#${i}`));
  return { date: input.date, part: normPart(input.part), exercises };
}

/** @returns {Promise<{synced:boolean}>} */
export async function saveDay(input) {
  const day = cleanDay(input);
  if (!day.exercises.length) return deleteDay(day.date);
  state.training[day.date] = day;
  bump();
  enqueue({ kind: 'save', date: day.date, rows: trainingToRows(day) });
  persistCache();
  emit('data');
  try {
    await flushQueue();
    return { synced: true };
  } catch {
    return { synced: false };
  }
}

export async function deleteDay(date) {
  delete state.training[date];
  bump();
  enqueue({ kind: 'delete', date });
  persistCache();
  emit('data');
  try {
    await flushQueue();
    return { synced: true };
  } catch {
    return { synced: false };
  }
}

/* ---------- 下書き（記録画面の入力途中を端末に保持） ---------- */
export const loadDraft = (date) => safeStorage.read(KEYS.draft(date), null);
export const saveDraft = (date, draft) => safeStorage.write(KEYS.draft(date), { ...draft, at: Date.now() });
export const clearDraft = (date) => safeStorage.remove(KEYS.draft(date));
export const hasDraft = (date) => !!safeStorage.readRaw(KEYS.draft(date));
