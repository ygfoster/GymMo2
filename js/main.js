// アプリの起動: ストア初期化 → シェル構築 → ルート定義 → 画面表示。
import { state, on, init as initStore, connect } from './store.js';
import { initOverlay, toast, hasOpenLayer } from './ui/overlay.js';
import { router, defineRoute } from './router.js';
import { createTabbar } from './ui/tabbar.js';
import { createDock } from './ui/dock.js';
import { timer } from './timer.js';
import { createDayView } from './views/day.js';
import { createHistoryView } from './views/history.js';
import { createAnalyzeView } from './views/analyze.js';
import { createSettingsView } from './views/settings.js';
import { createExerciseView } from './views/exercise.js';
import { createLogView } from './views/log.js';
import { showWelcome } from './views/welcome.js';
import { todayKey } from './lib/dates.js';
import { native } from './native.js';
import { html, createEl } from './lib/html.js';

const shell = document.getElementById('shell');
const stage = document.getElementById('stage');
const overlayRoot = document.getElementById('overlay-root');

function defineRoutes() {
  defineRoute({ name: 'today', re: /^\/today$/, kind: 'tab', make: () => createDayView({ root: true }) });
  defineRoute({ name: 'history', re: /^\/history$/, kind: 'tab', make: () => createHistoryView() });
  defineRoute({ name: 'analyze', re: /^\/analyze$/, kind: 'tab', make: () => createAnalyzeView() });
  defineRoute({ name: 'settings', re: /^\/settings$/, kind: 'tab', make: () => createSettingsView() });
  defineRoute({ name: 'day', re: /^\/day\/(\d{4}-\d{2}-\d{2})$/, keys: ['date'], kind: 'push', make: (p) => createDayView({ date: p.date }) });
  defineRoute({ name: 'exercise', re: /^\/exercise\/(.+)$/, keys: ['name'], kind: 'push', make: (p) => createExerciseView({ name: p.name }) });
  defineRoute({ name: 'log', re: /^\/log\/(\d{4}-\d{2}-\d{2})$/, keys: ['date'], kind: 'modal', make: (p) => createLogView({ date: p.date }) });
}

/** 「＋」を押したときに記録を開く日付（日別ビューを見ていればその日） */
function contextDate() {
  const view = router.topEntry()?.view;
  return view?.date || todayKey();
}

function mountChrome() {
  shell.insertBefore(createTabbar({ onAdd: () => router.navigate(`/log/${contextDate()}`) }), overlayRoot);

  // 他の画面で休憩中・ワークアウト中のときに出るミニプレイヤー
  const slot = createEl(html`<div class="dock-slot" aria-live="polite"></div>`);
  const dock = createDock({
    variant: 'compact',
    onOpen: () => router.navigate(`/log/${timer.snapshot().logDate || todayKey()}`),
  });
  slot.append(dock.el);
  shell.insertBefore(slot, overlayRoot);
  const update = () => {
    const snap = timer.snapshot();
    const show = snap.active && !router.info.modal;
    slot.classList.toggle('show', show);
    shell.classList.toggle('dock-on', show);
  };
  timer.subscribe(update);
  router.onChange(update);
}

function watchSync() {
  let lastState = 'idle';
  on('sync', () => {
    const s = state.sync;
    if (s.state === lastState) return;
    if (s.state === 'offline') toast('オフラインです。記録は端末に保存され、接続後に同期されます', { kind: 'offline' });
    else if (s.state === 'error' && state.mode) toast(`同期できませんでした: ${s.error}`, { kind: 'error' });
    else if (s.state === 'idle' && (lastState === 'offline' || lastState === 'error')) toast('同期しました');
    lastState = s.state;
  });
  // 接続解除後はクリーンな状態で最初の画面に戻る
  let hadMode = !!state.mode;
  on('data', () => {
    if (hadMode && !state.mode) location.replace(location.pathname + location.search.replace(/[?&]demo(=[^&]*)?/, '') + '#/today');
    hadMode = !!state.mode;
  });
}

/** 例: https://…/#/connect?k=パスコード （ワンタップ接続用リンク）。読み取ったら URL から即座に消す。 */
async function handleConnectLink() {
  const m = /^#\/connect\?k=(.+)$/.exec(location.hash);
  if (!m) return { used: false };
  const key = decodeURIComponent(m[1]);
  history.replaceState(null, '', location.pathname + location.search + '#/today');
  try {
    await connect(key);
    return { used: true, ok: true };
  } catch (e) {
    return { used: true, ok: false, error: e.kind === 'auth' ? 'このリンクのパスコードは無効です。' : `リンクから接続できませんでした。${e.message || ''}` };
  }
}

/** アプリ起動中に接続リンクを開かれた場合（hash だけが変わるので、起動時の処理は走らない） */
function watchConnectLinks() {
  window.addEventListener('hashchange', async () => {
    const link = await handleConnectLink();
    if (!link.used) return;
    if (link.ok) {
      location.reload();
      return;
    }
    const err = document.querySelector('.welcome-err');
    if (err) err.textContent = link.error;
    else toast(link.error, { kind: 'error' });
  });
}

async function start() {
  if (native.available) document.documentElement.dataset.native = '1';
  // ネイティブ（通知タップなど）から画面遷移させるための入口
  window.__gymmoNavigate = (path) => router.navigate(path);
  // ネイティブの「戻る」: シートやメニューが開いていれば閉じ、画面が積まれていれば 1 つ戻る。
  // タブの先頭なら false を返し、ネイティブ側がアプリを閉じる（バックグラウンドへ）。
  window.__gymmoBack = () => {
    if (hasOpenLayer()) {
      history.back();
      return true;
    }
    const info = router.info;
    if (info.depth > 1 || info.modal) {
      router.back();
      return true;
    }
    return false;
  };
  initOverlay(shell, overlayRoot);
  initStore(); // 設定を先に読み込む（タイマーがネイティブへ同期するときに通知設定を参照する）
  timer.init();
  defineRoutes();
  watchConnectLinks();
  const link = await handleConnectLink();

  const boot = () => {
    mountChrome();
    router.start({ stage, shell });
    watchSync();
  };
  if (state.mode) {
    boot();
    if (link.ok) toast('接続しました');
  } else {
    showWelcome({ shell, onDone: boot, notice: link.error || '' });
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  document.documentElement.dataset.ready = '1';
}

start();
