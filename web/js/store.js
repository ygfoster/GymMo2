// アプリ全体の状態・永続化・同期。画面は on('data'|'settings'|'sync') を購読して再描画する。
import { CONFIG } from './config.js';
import { createLiveApi, createDemoApi, ApiError } from './api.js';
import { safeStorage } from './lib/storage.js';
import { rowsToTraining, rowsToHealth, trainingToRows, mergeHealth, normalizeHealthRow, normPart, setKnownParts, OTHER_PART, normalizeExerciseName } from './lib/parse.js';
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

/** 部位の既定値。名前・色・休憩時間は設定で変えられ、追加・削除もできる。「その他」は固定の受け皿（other）。 */
export const DEFAULT_PARTS = [
  { id: 'chest', name: '胸', color: '#FF453A', rest: 180 },
  { id: 'back', name: '背中', color: '#0A84FF', rest: 180 },
  { id: 'legs', name: '脚', color: '#30D158', rest: 180 },
  { id: 'shoulders', name: '肩', color: '#FF9F0A', rest: 90 },
  { id: 'arms', name: '腕', color: '#BF5AF2', rest: 120 },
];
export const PART_NAME_MAX = 12;

export const DEFAULT_SETTINGS = {
  theme: 'auto', // auto | light | dark
  haptics: true,
  sound: true,
  goals: { sleepMin: 420, protein: 140, kcal: null }, // kcal: null＝消費カロリーを目安にする
  timer: {
    autoStart: true,
    nudge: true,
    notify: native.available, // アプリ版は通知が主役なので既定でオン（ブラウザ版は許可が要るのでオフ）
    templates: [60, 90, 120, 150, 180, 240, 300], // タイマー画面の時間ボタン（設定で編集、最大 8 個・5 秒刻み）
  },
  parts: DEFAULT_PARTS,
  other: { color: '#8E8E93', rest: 120 },
};

/** 旧形式（partColors と timer.presets を部位名で持っていた v1.0）の設定を、parts の配列へ移す */
function migrateSettings(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved.parts)) return saved;
  const colors = saved.partColors || {};
  const presets = saved.timer?.presets || {};
  const out = { ...saved };
  out.parts = DEFAULT_PARTS.map((p) => ({ ...p, color: colors[p.name] || p.color, rest: Number(presets[p.name]) || p.rest }));
  out.other = { color: colors[OTHER_PART] || DEFAULT_SETTINGS.other.color, rest: Number(presets[OTHER_PART]) || DEFAULT_SETTINGS.other.rest };
  delete out.partColors;
  if (out.timer) {
    out.timer = { ...out.timer };
    delete out.timer.presets;
  }
  return out;
}

/** 保存値が壊れていても動くように整える（名前の重複・空・「その他」は除く） */
function sanitizeParts(list) {
  const seen = new Set();
  const out = [];
  for (const p of Array.isArray(list) ? list : []) {
    const name = String(p?.name ?? '').trim().slice(0, PART_NAME_MAX);
    if (!name || name === OTHER_PART || seen.has(name)) continue;
    seen.add(name);
    out.push({
      id: String(p.id || newPartId()),
      name,
      color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#8E8E93',
      rest: clampRest(p.rest),
    });
  }
  return out;
}

const clampRest = (v) => Math.min(600, Math.max(15, Math.round(Number(v) || 120)));

export const TEMPLATE_LIMITS = { min: 10, max: 600, step: 5, count: 8 };
/** タイマーのテンプレート: 5 秒刻み・10 秒〜10 分・重複なし・短い順・最大 8 個 */
export function normalizeTemplates(list) {
  const { min, max, step, count } = TEMPLATE_LIMITS;
  const out = [...new Set((Array.isArray(list) ? list : []).map((v) => Math.min(max, Math.max(min, Math.round(Number(v) / step) * step))).filter((v) => Number.isFinite(v)))];
  out.sort((a, b) => a - b);
  return out.length ? out.slice(0, count) : DEFAULT_SETTINGS.timer.templates.slice();
}
let idSeq = 0;
const newPartId = () => `p${Date.now().toString(36)}${(idSeq++).toString(36)}`;

function mergeSettings(base, saved) {
  const out = JSON.parse(JSON.stringify(base));
  if (!saved || typeof saved !== 'object') return out;
  for (const k of Object.keys(out)) {
    if (!(k in saved)) continue;
    if (out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      for (const kk of Object.keys(out[k])) {
        if (saved[k]?.[kk] === undefined) continue;
        if (Array.isArray(saved[k][kk]) || Array.isArray(out[k][kk])) out[k][kk] = saved[k][kk];
        else if (out[k][kk] && typeof out[k][kk] === 'object') out[k][kk] = { ...out[k][kk], ...saved[k][kk] };
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
  settings: loadSettings(null),
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
function loadSettings(saved) {
  const out = mergeSettings(DEFAULT_SETTINGS, migrateSettings(saved));
  out.parts = sanitizeParts(out.parts);
  out.timer.templates = normalizeTemplates(out.timer.templates);
  out.other = { color: /^#[0-9a-f]{6}$/i.test(out.other?.color) ? out.other.color : DEFAULT_SETTINGS.other.color, rest: clampRest(out.other?.rest) };
  return out;
}

const partNamesKey = () => state.settings.parts.map((p) => p.name).join('\u0000');

export function updateSettings(patch) {
  const before = partNamesKey();
  state.settings = mergeSettings(state.settings, patch);
  if (patch.parts) state.settings.parts = sanitizeParts(state.settings.parts);
  safeStorage.write(KEYS.settings, state.settings);
  applySettings();
  emit('settings');
  // 部位の一覧が変わると、集計（どの記録を「その他」にまとめるか）も変わる
  if (partNamesKey() !== before) {
    bump();
    emit('data');
  }
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
  setKnownParts(s.parts.map((p) => p.name));
}

/* ---------- 部位 ---------- */
/** 部位名（「その他」を含む、表示順） */
export const allParts = () => [...state.settings.parts.map((p) => p.name), OTHER_PART];
const findPart = (name) => {
  const n = normPart(name);
  return state.settings.parts.find((p) => p.name === n) || null;
};
/** 登録されていない部位（削除した部位・自由入力）は「その他」の色と休憩時間を使う */
export const partColor = (part) => findPart(part)?.color || state.settings.other.color;
export const partRest = (part) => findPart(part)?.rest ?? state.settings.other.rest;

/** 部位名の検証。問題があればメッセージを返す。 */
export function validatePartName(name, { exceptId = null } = {}) {
  const n = String(name ?? '').trim();
  if (!n) return '名前を入力してください';
  if (n.length > PART_NAME_MAX) return `${PART_NAME_MAX}文字以内にしてください`;
  if (n === OTHER_PART) return '「その他」は使えません';
  if (state.settings.parts.some((p) => p.name === n && p.id !== exceptId)) return '同じ名前の部位があります';
  return null;
}

export function updatePart(id, patch) {
  if (id === 'other') {
    const other = { ...state.settings.other, ...patch };
    if (patch.rest != null) other.rest = clampRest(patch.rest);
    updateSettings({ other });
    return;
  }
  updateSettings({ parts: state.settings.parts.map((p) => (p.id === id ? { ...p, ...patch, ...(patch.rest != null ? { rest: clampRest(patch.rest) } : {}) } : p)) });
}

export function addPart(name, color) {
  const err = validatePartName(name);
  if (err) throw new Error(err);
  const part = { id: newPartId(), name: String(name).trim(), color, rest: state.settings.other.rest };
  updateSettings({ parts: [...state.settings.parts, part] });
  return part;
}

/** 部位を削除する。その部位の過去の記録は名前を残したまま「その他」として表示される。 */
export function deletePart(id) {
  updateSettings({ parts: state.settings.parts.filter((p) => p.id !== id) });
}

export function movePart(id, dir) {
  const list = state.settings.parts.slice();
  const i = list.findIndex((p) => p.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  updateSettings({ parts: list });
}

/**
 * 部位の名前を変える。過去の記録（端末のキャッシュ・下書き・シート）の部位名も新しい名前に書き換える。
 * @returns {Promise<{synced:boolean, count:number}>}
 */
export async function renamePart(id, nextName) {
  const part = state.settings.parts.find((p) => p.id === id);
  if (!part) throw new Error('部位が見つかりません');
  const to = String(nextName ?? '').trim();
  if (to === part.name) return { synced: true, count: 0 };
  const err = validatePartName(to, { exceptId: id });
  if (err) throw new Error(err);
  // 「足」は「脚」の表記ゆれとして扱っているので、一緒に書き換える
  const from = part.name === '脚' ? ['脚', '足'] : [part.name];
  updatePart(id, { name: to });
  let count = 0;
  if (state.mode) {
    count = renameInTraining(state.training, from, to);
    renameInDrafts(from, to);
    enqueue({ kind: 'rename', field: 'part', from, to });
    bump();
    persistCache();
    emit('data');
    try {
      await flushQueue();
      return { synced: true, count };
    } catch {
      return { synced: false, count };
    }
  }
  return { synced: true, count };
}

/** 端末内の記録の部位名を書き換える。書き換えた日数を返す。 */
function renameInTraining(training, from, to) {
  let count = 0;
  for (const day of Object.values(training)) {
    let hit = false;
    if (from.includes(String(day.part ?? '').trim())) {
      day.part = to;
      hit = true;
    }
    for (const ex of day.exercises) {
      if (from.includes(String(ex.part ?? '').trim())) {
        ex.part = to;
        hit = true;
      }
    }
    if (hit) count += 1;
  }
  return count;
}

function renameInDrafts(from, to) {
  const prefix = KEYS.draft('');
  let keys = [];
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith(prefix));
  } catch {
    return;
  }
  for (const k of keys) {
    const d = safeStorage.read(k, null);
    if (d && from.includes(String(d.part ?? '').trim())) safeStorage.write(k, { ...d, part: to });
    else if (d && d.part === OTHER_PART && from.includes(String(d.partCustom ?? '').trim())) safeStorage.write(k, { ...d, part: to, partCustom: '' });
  }
}

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
  state.settings = loadSettings(safeStorage.read(KEYS.settings, null));
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
    else if (op.kind === 'rename') {
      if (op.field === 'part') renameInTraining(training, op.from, op.to);
    } else {
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
  if (!api) return Promise.resolve();
  if (flushing) return flushing;
  if (!state.queue.length) return Promise.resolve();
  // 注意: async 関数は最初の await まで同期的に走る。以前は finally（flushing = null）が代入より先に実行され、
  // 解決済みの Promise が flushing に残って以後の送信が止まることがあった。代入後に片付けるようにする。
  const run = (async () => {
    try {
      while (state.queue.length) {
        const op = state.queue[0];
        if (op.kind === 'delete') await api.deleteDay(op.date);
        else if (op.kind === 'rename') await api.renameValues(op.field, op.from, op.to);
        else await api.saveDay(op.date, op.rows);
        // 送信中に同じ日が保存し直されると、その操作はキューから差し替えられている。送った操作そのものだけを取り除く
        const i = state.queue.indexOf(op);
        if (i >= 0) state.queue.splice(i, 1);
        persistQueue();
      }
    } catch (e) {
      handleError(e);
      throw e;
    }
  })();
  flushing = run;
  const clear = () => {
    if (flushing === run) flushing = null;
  };
  run.then(clear, clear);
  return run;
}

function enqueue(op) {
  // 同じ日の保存・削除は最後の 1 件だけ送れば足りる（名前の変更は日付を持たないので重ねない）
  if (op.date) state.queue = state.queue.filter((q) => q.date !== op.date);
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
    const name = normalizeExerciseName(ex.name);
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
