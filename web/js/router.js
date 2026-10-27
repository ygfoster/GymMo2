// ハッシュルーター + iOS 風の画面遷移（タブ=フェード、プッシュ/ポップ=横スライド、モーダル=下からのシート）。
// ナビゲーションは「スタック」として扱う: nav = [タブのルート, ...プッシュされた画面, モーダル?]
import { openSheet } from './ui/overlay.js';

const defs = [];
const nav = [];
const tabCache = new Map();
const listeners = new Set();
let stageEl = null;
let shellEl = null;
let idx = 0;

/**
 * @param {{name:string, re:RegExp, keys?:string[], kind:'tab'|'push'|'modal', make:(params:object)=>object}} def
 * view = { el, onShow?, onHide?, destroy?, title? }
 */
export function defineRoute(def) {
  defs.push(def);
}

function match(path) {
  for (const def of defs) {
    const m = def.re.exec(path);
    if (!m) continue;
    const params = {};
    (def.keys || []).forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    return { def, params, path };
  }
  return null;
}

const currentHashPath = () => location.hash.replace(/^#/, '') || '/today';
const notify = () => listeners.forEach((fn) => fn(info()));

function info() {
  const top = nav[nav.length - 1];
  const root = nav[0];
  return {
    path: top?.path,
    name: top?.def.name,
    params: top?.params || {},
    tab: root?.def.name,
    depth: nav.length,
    modal: top?.def.kind === 'modal',
  };
}

export const router = {
  start({ stage, shell }) {
    stageEl = stage;
    shellEl = shell;
    history.replaceState({ ...(history.state || {}), idx: 0 }, '');
    window.addEventListener('popstate', onPopState);
    // リンクや URL 直接入力による hash 変更にも追従する（pushState 経由の遷移では発火しない）
    window.addEventListener('hashchange', () => {
      const p = currentHashPath();
      const top = nav[nav.length - 1];
      if (top && p !== top.path && match(p)) showRoute(p, 'fade');
    });
    showRoute(currentHashPath(), 'none');
  },
  navigate(path, { replace = false } = {}) {
    const m = match(path);
    if (!m) return;
    const isTab = m.def.kind === 'tab';
    if (isTab || replace) {
      history.replaceState({ ...(history.state || {}), idx }, '', `#${path}`);
    } else {
      idx += 1;
      history.pushState({ idx }, '', `#${path}`);
    }
    showRoute(path, isTab ? 'fade' : 'push');
  },
  back() {
    if ((history.state?.idx ?? 0) > 0) history.back();
    else {
      const parent = nav.length > 1 ? nav[nav.length - 2].path : '/today';
      history.replaceState({ ...(history.state || {}), idx }, '', `#${parent}`);
      showRoute(parent, 'pop');
    }
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get info() {
    return info();
  },
  /** 現在の文脈で「記録」を開く日付（日別詳細にいればその日、なければ今日） */
  topEntry: () => nav[nav.length - 1],
  /** タブのルート画面を先頭までスクロール、またはプッシュ画面を閉じる */
  reselectTab() {
    if (nav.length > 1) {
      router.back();
      return;
    }
    const el = nav[0]?.view.el;
    el?.scrollTo({ top: 0, behavior: 'smooth' });
  },
};

function onPopState(e) {
  const newIdx = e.state?.idx ?? 0;
  if (newIdx === idx) {
    // シート用の履歴エントリなら何もしない。URL の hash を直接書き換えられた場合だけ追従する。
    const p = currentHashPath();
    const top = nav[nav.length - 1];
    if (top && p !== top.path && match(p)) showRoute(p, 'fade');
    return;
  }
  const dir = newIdx < idx ? 'pop' : 'push';
  idx = newIdx;
  showRoute(currentHashPath(), dir);
}

function showRoute(path, dir) {
  const m = match(path) || match('/today');
  const top = nav[nav.length - 1];
  if (top && top.path === m.path) return;

  const existing = nav.findIndex((e) => e.path === m.path);
  if (existing !== -1 && existing < nav.length - 1) {
    popTo(existing, dir === 'none' ? 'none' : 'pop');
    return;
  }
  if (m.def.kind === 'tab') switchTab(m, dir === 'none' ? 'none' : 'fade');
  else pushEntry(m, dir === 'pop' ? 'push' : dir);
}

/* ---------- アニメーション補助 ---------- */
function animate(el, cls, done) {
  if (!el) return;
  let finished = false;
  const end = () => {
    if (finished) return;
    finished = true;
    el.classList.remove(cls);
    el.removeEventListener('animationend', onEnd);
    done?.();
  };
  const onEnd = (e) => {
    if (e.target === el) end();
  };
  el.classList.add(cls);
  el.addEventListener('animationend', onEnd);
  setTimeout(end, 700);
}

function destroyEntry(entry) {
  try {
    entry.view.onHide?.();
    entry.view.destroy?.();
  } catch (e) {
    console.error('[router] destroy', e);
  }
  entry.view.el.remove();
  if (entry.handle) entry.handle.dismiss();
}

/* ---------- タブ切替 ---------- */
function switchTab(m, anim) {
  let entry = tabCache.get(m.def.name);
  const prevTab = nav[0];
  if (!entry) {
    const view = m.def.make(m.params);
    entry = { path: m.path, def: m.def, params: m.params, view };
    tabCache.set(m.def.name, entry);
    view.el.hidden = true;
    stageEl.append(view.el);
  }

  // 積まれているプッシュ画面・モーダルを片付ける
  while (nav.length > 1) {
    const e = nav.pop();
    if (e.def.kind === 'modal') shellEl.classList.remove('hide-tabbar');
    if (anim === 'none') destroyEntry(e);
    else {
      const el = e.view.el;
      animate(el, 'leave-fade', () => destroyEntry(e));
    }
  }
  if (prevTab && prevTab !== entry) {
    const pv = prevTab.view;
    pv.onHide?.();
    if (anim === 'none') pv.el.hidden = true;
    else animate(pv.el, 'leave-fade', () => (pv.el.hidden = true));
  }
  nav.length = 0;
  nav.push(entry);
  entry.view.el.hidden = false;
  if (prevTab !== entry && anim !== 'none') animate(entry.view.el, 'enter-fade');
  entry.view.onShow?.();
  notify();
}

/* ---------- プッシュ / モーダル ---------- */
function pushEntry(m, anim) {
  if (!nav.length) {
    switchTab(match('/today'), 'none');
  }
  const prev = nav[nav.length - 1];
  const view = m.def.make(m.params);
  const entry = { path: m.path, def: m.def, params: m.params, view };

  if (m.def.kind === 'modal') {
    entry.handle = openSheet({
      node: view.el,
      tall: true,
      routeBound: true,
      className: 'modal-screen',
      dragExclude: view.dragExclude || '',
      onRequestClose: () => router.back(),
    });
    shellEl.classList.add('hide-tabbar');
    prev.view.onHide?.();
  } else {
    stageEl.append(view.el);
    if (anim !== 'none') {
      animate(view.el, 'enter-push');
      animate(prev.view.el, 'leave-push', () => (prev.view.el.hidden = true));
    } else {
      prev.view.el.hidden = true;
    }
    prev.view.onHide?.();
  }
  nav.push(entry);
  view.onShow?.();
  notify();
}

function popTo(k, anim) {
  const removed = nav.splice(k + 1);
  const target = nav[k];
  const topRemoved = removed[removed.length - 1];
  // 途中の画面は即座に破棄し、最上位だけアニメーションさせる
  removed.slice(0, -1).forEach(destroyEntry);

  if (topRemoved.def.kind === 'modal') {
    shellEl.classList.remove('hide-tabbar');
    topRemoved.view.onHide?.();
    topRemoved.handle?.dismiss();
    setTimeout(() => {
      topRemoved.view.destroy?.();
    }, 560);
    target.view.el.hidden = false;
  } else if (anim === 'none') {
    destroyEntry(topRemoved);
    target.view.el.hidden = false;
  } else {
    target.view.el.hidden = false;
    animate(target.view.el, 'enter-pop');
    animate(topRemoved.view.el, 'leave-pop', () => destroyEntry(topRemoved));
    topRemoved.view.onHide?.();
  }
  target.view.onShow?.();
  notify();
}
