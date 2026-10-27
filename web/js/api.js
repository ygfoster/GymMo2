// バックエンド（Cloudflare Worker の /api）クライアントと、同じインターフェースのデモ実装。
// 通信は常に POST + text/plain（CORS のプリフライトを避ける）。トークンは URL ではなくボディで送る。
import { CONFIG } from './config.js';
import { buildDemoRows } from './demo-data.js';
import { todayKey, parseSheetDate } from './lib/dates.js';
import { safeStorage } from './lib/storage.js';

export class ApiError extends Error {
  /** @param {'auth'|'network'|'timeout'|'server'} kind */
  constructor(message, kind = 'server') {
    super(message);
    this.kind = kind;
  }
}

export function createLiveApi({ url, getToken }) {
  async function call(action, payload = {}, timeout = 25000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: getToken(), ...payload }),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw e.name === 'AbortError'
        ? new ApiError('通信がタイムアウトしました', 'timeout')
        : new ApiError('ネットワークに接続できません', 'network');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new ApiError(`サーバーエラー (${res.status})`, 'server');
    let json;
    try {
      json = await res.json();
    } catch {
      throw new ApiError('サーバーの応答を解析できませんでした', 'server');
    }
    if (!json || json.ok === false) {
      throw new ApiError(json?.error || 'サーバーエラー', json?.code === 'AUTH' ? 'auth' : 'server');
    }
    return json;
  }
  return {
    mode: 'live',
    ping: () => call('ping'),
    bootstrap: () => call('bootstrap'),
    health: (date) => call('health', { date }, 45000),
    saveDay: (date, rows) => call('saveDay', { date, rows }),
    deleteDay: (date) => call('deleteDay', { date }),
    renameValues: (field, from, to) => call('renameValues', { field, from, to }, 45000),
  };
}

const DEMO_KEY = `${CONFIG.keyPrefix}demo.v1`;

export function createDemoApi() {
  const wait = (ms = 140) => new Promise((r) => setTimeout(r, ms));
  const today = todayKey();
  let db = safeStorage.read(DEMO_KEY, null);
  if (!db || db.builtFor !== today) {
    const fresh = buildDemoRows(today);
    // 同じ日に作ったデモデータへの編集は保持し、日付が変わったら作り直す
    db = { builtFor: today, training: fresh.training, health: fresh.health };
    safeStorage.write(DEMO_KEY, db);
  }
  const persist = () => safeStorage.write(DEMO_KEY, db);
  return {
    mode: 'demo',
    async ping() {
      await wait(60);
      return { ok: true };
    },
    async bootstrap() {
      await wait();
      return { ok: true, training: db.training, health: db.health, serverTime: Date.now() };
    },
    async health(date) {
      await wait(200);
      const key = parseSheetDate(date);
      const row = db.health.find((r) => parseSheetDate(r.date) === key);
      return { ok: true, row: row || null };
    },
    async saveDay(date, rows) {
      await wait();
      db.training = db.training.filter((r) => parseSheetDate(r.date) !== date).concat(rows);
      persist();
      return { ok: true };
    },
    async deleteDay(date) {
      await wait();
      db.training = db.training.filter((r) => parseSheetDate(r.date) !== date);
      persist();
      return { ok: true };
    },
    async renameValues(field, from, to) {
      await wait();
      const key = field === 'exercise' ? 'exercise' : 'part';
      let count = 0;
      db.training = db.training.map((r) => {
        if (!from.includes(String(r[key] ?? '').trim())) return r;
        count += 1;
        return { ...r, [key]: to };
      });
      persist();
      return { ok: true, count };
    },
    reset() {
      safeStorage.remove(DEMO_KEY);
    },
  };
}
