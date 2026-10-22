// ヘッドレス Chrome（専用の一時プロファイル）で、Service Worker によるオフライン起動を検証する。
//   node scripts/offline-check.mjs
// 手順: サーバー起動 → ページ読込 → SW が有効化しキャッシュが埋まるのを待つ → サーバー停止 → 再読込 → アプリが表示されるか確認
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_PORT = 5199;
const DEBUG_PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('python3', ['scripts/dev-server.py', String(APP_PORT)], { stdio: 'ignore' });
const profile = mkdtempSync(join(tmpdir(), 'gymmo2-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });

const cleanup = () => {
  try { server.kill(); } catch {}
  try { chrome.kill(); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
};
process.on('exit', cleanup);

async function waitFor(fn, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(250);
  }
  throw new Error(`timeout: ${label}`);
}

let nextId = 1;
const pending = new Map();
let ws;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
  return r.result.value;
};

try {
  await waitFor(() => fetch(`http://127.0.0.1:${APP_PORT}/index.html`).then((r) => r.ok), 'app server');
  const target = await waitFor(async () => (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' })).json(), 'chrome');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');

  const url = `http://localhost:${APP_PORT}/index.html?demo#/today`;
  await send('Page.navigate', { url });
  await waitFor(() => evaluate('document.documentElement.dataset.ready === "1"'), 'app ready');

  const sw = await waitFor(() => evaluate(`(async () => { const r = await navigator.serviceWorker.getRegistration(); return r && r.active ? r.active.state : null; })()`), 'service worker active', 80);
  const cached = await waitFor(() => evaluate(`(async () => { const k = (await caches.keys()).find(x => x.startsWith('gymmo2-shell')); return k ? (await (await caches.open(k)).keys()).length : 0; })()`).then((n) => (n >= 40 ? n : 0)), 'shell cache filled', 80);
  console.log(`✔ Service Worker: ${sw} / プリキャッシュ ${cached} 件`);

  // オフライン化: サーバーを止めて再読込
  server.kill();
  await sleep(600);
  const down = await fetch(`http://127.0.0.1:${APP_PORT}/index.html`).then(() => false).catch(() => true);
  console.log(`✔ サーバー停止: ${down ? '確認' : '停止できていません'}`);

  await send('Page.navigate', { url });
  const booted = await waitFor(() => evaluate('!!document.querySelector(".tabbar") && !!document.querySelector(".screen .large-title-block")'), 'offline boot', 60);
  const title = await evaluate('document.querySelector(".screen h1")?.textContent');
  console.log(`✔ オフライン起動: ${booted ? 'アプリが表示されました' : '失敗'}（画面タイトル: ${title}）`);
  process.exitCode = booted ? 0 : 1;
} catch (e) {
  console.error('✖', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}
