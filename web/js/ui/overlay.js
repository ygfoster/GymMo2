// オーバーレイ層: シート / ポップアップメニュー / ダイアログ / HUD / トースト。
// Android の「戻る」操作でシートが閉じるよう、履歴ガード（layer）を持つ。ルーターより先に popstate を購読すること。
import { html, createEl, esc } from '../lib/html.js';
import { icons } from './icons.js';
import { haptic } from '../lib/haptics.js';

let shell = null;
let root = null;
let zCounter = 10;

/* ---------- 履歴ガード ---------- */
const layers = [];
let waitingPop = null;

function layerState() {
  return { ...(history.state || {}), layer: layers.length };
}

function pushLayer(layer) {
  layers.push(layer);
  history.pushState(layerState(), '');
}

/** UI から閉じた layer を履歴からも取り除く */
function releaseLayer(layer) {
  const i = layers.indexOf(layer);
  if (i === -1) return;
  layers.splice(i, 1);
  history.back();
}

/** すべての layer を閉じる。履歴の巻き戻し完了まで待つ。 */
export function closeAllLayers() {
  const n = layers.length;
  if (!n) return Promise.resolve();
  return new Promise((resolve) => {
    waitingPop = resolve;
    layers.splice(0).forEach((l) => l.closeNow());
    history.go(-n);
  });
}

function onPop(e) {
  const want = e.state?.layer ?? 0;
  if (waitingPop && want === 0) {
    const r = waitingPop;
    waitingPop = null;
    e.stopImmediatePropagation();
    r();
    return;
  }
  let handled = false;
  while (layers.length > want) {
    layers.pop().closeNow();
    handled = true;
  }
  if (handled) e.stopImmediatePropagation();
}

export function initOverlay(shellEl, rootEl) {
  shell = shellEl;
  root = rootEl;
  window.addEventListener('popstate', onPop);
}

export const hasOpenLayer = () => layers.length > 0;

function updateCovered() {
  const covered = root.querySelectorAll('.sheet.tall.show').length > 0;
  shell.classList.toggle('is-covered', covered);
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/* ---------- シート ---------- */
/**
 * 通常シート: { title, left, right, tall, content }
 * 独自レイアウト: { node }（.sheet-head / .sheet-body を含む要素を渡す）
 * ルート連動: { routeBound:true, onRequestClose } — 履歴はルーターが管理し、閉じる操作は onRequestClose へ委ねる。
 */
export function openSheet(opts) {
  const { title = '', left = '', right = '', tall = false, content, node, onClose, className = '', routeBound = false, onRequestClose, dragBody = true, dragExclude = '' } = opts;
  const backdrop = createEl(html`<div class="sheet-backdrop"></div>`);
  const sheet = createEl(html`
    <div class="sheet ${tall ? 'tall' : ''} ${className}" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="sheet-grab"></div>
    </div>`);
  if (node) {
    sheet.append(node);
  } else {
    const head = createEl(html`<div class="sheet-head"><div class="l">${left}</div><div class="t">${title}</div><div class="r">${right}</div></div>`);
    const bodyEl = createEl(html`<div class="sheet-body"></div>`);
    if (content instanceof Node) bodyEl.append(content);
    else bodyEl.innerHTML = String(content ?? '');
    sheet.append(head, bodyEl);
  }
  const body = sheet.querySelector('.sheet-body');
  zCounter += 2;
  backdrop.style.zIndex = zCounter;
  sheet.style.zIndex = zCounter + 1;
  root.append(backdrop, sheet);

  let closed = false;
  const layer = { closeNow: () => finish() };

  const finish = () => {
    if (closed) return;
    closed = true;
    sheet.classList.remove('show', 'dragging');
    sheet.style.removeProperty('--drag');
    backdrop.classList.remove('show');
    updateCovered();
    setTimeout(() => {
      sheet.remove();
      backdrop.remove();
      onClose?.();
    }, 520);
  };
  const close = () => {
    if (closed) return;
    if (routeBound) {
      onRequestClose?.();
      return;
    }
    releaseLayer(layer);
    finish();
  };

  if (!routeBound) pushLayer(layer);
  nextFrame().then(() => {
    if (closed) return;
    sheet.classList.add('show');
    backdrop.classList.add('show');
    updateCovered();
  });

  backdrop.addEventListener('click', close);
  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });
  enableDrag(sheet, close, { body: dragBody, exclude: dragExclude });

  return {
    el: sheet,
    body,
    close,
    dismiss: finish,
    setTitle: (t) => (sheet.querySelector('.sheet-head .t').textContent = t),
    $: (sel) => sheet.querySelector(sel),
  };
}

/**
 * body:false のときは、つまみと見出しの行だけで引き下げられる（本文の操作と取り合わないように）。
 * exclude: 本文のうち、引き下げを始めない部分のセレクタ（記録画面の種目カードなど、左スワイプと取り合う場所）。
 */
function enableDrag(sheet, close, { body: fromBody = true, exclude = '' } = {}) {
  const body = fromBody ? sheet.querySelector('.sheet-body') : null;
  const handles = [...sheet.querySelectorAll('.sheet-grab, .sheet-head')];
  let startY = 0;
  let dy = 0;
  let t0 = 0;
  let active = false;

  const begin = (y) => {
    startY = y;
    dy = 0;
    t0 = performance.now();
    active = true;
    sheet.classList.add('dragging');
  };
  const move = (y) => {
    dy = Math.max(0, y - startY);
    // 引き始めは抵抗を持たせる
    const shown = dy < 40 ? dy * 0.7 : 28 + (dy - 40);
    sheet.style.setProperty('--drag', `${shown}px`);
  };
  const end = () => {
    if (!active) return;
    active = false;
    sheet.classList.remove('dragging');
    const v = dy / Math.max(1, performance.now() - t0);
    if (dy > 110 || v > 0.7) {
      haptic.select();
      close();
    } else {
      sheet.style.setProperty('--drag', '0px');
    }
  };

  handles.forEach((h) => {
    h.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      h.setPointerCapture?.(e.pointerId);
      begin(e.clientY);
    });
    h.addEventListener('pointermove', (e) => active && move(e.clientY));
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
  });

  // 本文がいちばん上までスクロールされている状態からの引き下げ
  if (!body) return;
  let bodyTracking = false;
  let startX = 0;
  body.addEventListener('touchstart', (e) => {
    bodyTracking = body.scrollTop <= 0 && !(exclude && e.target.closest?.(exclude));
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
  }, { passive: true });
  body.addEventListener('touchmove', (e) => {
    if (!bodyTracking) return;
    const y = e.touches[0].clientY;
    if (!active) {
      const dy = y - startY;
      const dx = Math.abs(e.touches[0].clientX - startX);
      // 横方向の動き（左スワイプ・チップの横スクロール）が混ざる操作では閉じない。はっきり下向きのときだけ
      if (dx > 12 && dx > dy * 0.6) {
        bodyTracking = false;
        return;
      }
      if (dy > 10 && dy > dx * 1.7 && body.scrollTop <= 0) begin(startY);
      else return;
    }
    e.preventDefault();
    move(y);
  }, { passive: false });
  body.addEventListener('touchend', () => {
    bodyTracking = false;
    end();
  }, { passive: true });
}

/* ---------- ポップアップメニュー ---------- */
/**
 * @param {Element|{x:number,y:number}} anchor
 * @param {Array<{label?:string, icon?:any, onSelect?:Function, danger?:boolean, checked?:boolean, sep?:boolean}>} items
 */
export function openMenu(anchor, items) {
  const layerEl = createEl(html`<div class="menu-layer"></div>`);
  layerEl.style.zIndex = ++zCounter + 20;
  const menu = createEl(html`<div class="menu" role="menu">${items.map((it, i) =>
    it.sep
      ? html`<div class="menu-sep"></div>`
      : html`<button class="menu-item ${it.danger ? 'danger' : ''}" role="menuitem" data-i="${i}"><span class="grow">${it.label}</span>${it.checked ? icons.check : it.icon || ''}</button>`
  )}</div>`);
  layerEl.append(menu);
  root.append(layerEl);

  const shellRect = shell.getBoundingClientRect();
  const a = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  const alignRight = a.left + a.width / 2 > shellRect.left + shellRect.width / 2;
  let left = alignRight ? a.right - mw : a.left;
  left = Math.min(Math.max(left, shellRect.left + 12), shellRect.right - mw - 12);
  let top = a.bottom + 8;
  let originY = 0;
  if (top + mh > shellRect.bottom - 16) {
    top = Math.max(shellRect.top + 12, a.top - mh - 8);
    originY = 100;
  }
  menu.style.left = `${left - shellRect.left}px`;
  menu.style.top = `${top - shellRect.top}px`;
  menu.style.setProperty('--ox', alignRight ? '100%' : '0%');
  menu.style.setProperty('--oy', `${originY}%`);
  haptic.select();

  let closed = false;
  const layer = { closeNow: () => finish() };
  const finish = () => {
    if (closed) return;
    closed = true;
    menu.classList.add('out');
    setTimeout(() => layerEl.remove(), 180);
  };
  const close = () => {
    if (closed) return;
    releaseLayer(layer);
    finish();
  };
  pushLayer(layer);
  layerEl.addEventListener('pointerdown', (e) => {
    if (!menu.contains(e.target)) close();
  });
  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('.menu-item');
    if (!btn) return;
    const item = items[Number(btn.dataset.i)];
    haptic.tap();
    close();
    setTimeout(() => item.onSelect?.(), 120);
  });
  return { close };
}

/* ---------- ダイアログ ---------- */
export function confirmDialog({ title, message = '', confirmLabel = 'OK', cancelLabel = 'キャンセル', destructive = false }) {
  return new Promise((resolve) => {
    const layerEl = createEl(html`<div class="dialog-layer">
      <div class="dialog" role="alertdialog" aria-modal="true" aria-label="${title}">
        <div class="dialog-body"><div class="dialog-title">${title}</div>${message ? html`<div class="dialog-msg">${message}</div>` : ''}</div>
        <div class="dialog-actions">${cancelLabel ? html`<button data-v="0">${cancelLabel}</button>` : ''}<button data-v="1" class="${destructive ? 'danger' : 'strong'}">${confirmLabel}</button></div>
      </div></div>`);
    layerEl.style.zIndex = ++zCounter + 40;
    root.append(layerEl);
    haptic.warning();
    let done = false;
    const layer = { closeNow: () => finish(false) };
    const finish = (v) => {
      if (done) return;
      done = true;
      layerEl.classList.add('out');
      setTimeout(() => layerEl.remove(), 160);
      resolve(v);
    };
    pushLayer(layer);
    layerEl.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      haptic.tap();
      releaseLayer(layer);
      finish(b.dataset.v === '1');
    });
  });
}

/* ---------- HUD ---------- */
let hudTimer = null;
export function showHud({ text, sub = '', kind = 'check', duration = 1400 }) {
  root.querySelectorAll('.hud-layer').forEach((n) => n.remove());
  clearTimeout(hudTimer);
  const glyph =
    kind === 'check'
      ? html`<svg viewBox="0 0 52 52" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle class="check-circle" cx="26" cy="26" r="23"/><path class="check-mark" d="M15.5 27l7.5 7.5L37 19.5"/></svg>`
      : kind === 'offline'
        ? icons.cloudOff
        : icons.alert;
  const el = createEl(html`<div class="hud-layer"><div class="hud">${glyph}<div>${text}</div>${sub ? html`<div class="sub">${sub}</div>` : ''}</div></div>`);
  el.style.zIndex = ++zCounter + 60;
  root.append(el);
  if (kind === 'check') haptic.success();
  hudTimer = setTimeout(() => {
    el.firstElementChild.classList.add('out');
    setTimeout(() => el.remove(), 320);
  }, duration);
}

/* ---------- トースト ---------- */
let toastLayer = null;
/** action: { label, onSelect } を渡すと右端にボタン（「取り消す」など）を出す */
export function toast(message, { kind = 'info', duration = 3200, action = null } = {}) {
  if (!toastLayer || !toastLayer.isConnected) {
    toastLayer = createEl(html`<div class="toast-layer"></div>`);
    toastLayer.style.zIndex = 9999;
    root.append(toastLayer);
  }
  const icon = kind === 'error' ? icons.alert : kind === 'offline' ? icons.cloudOff : icons.check;
  const el = createEl(html`<div class="toast ${kind}" role="status">${icon}<div class="toast-msg">${message}</div>${action ? html`<button class="toast-act">${action.label}</button>` : ''}</div>`);
  toastLayer.append(el);
  if (kind === 'error') haptic.error();
  let gone = false;
  const dismiss = () => {
    if (gone) return;
    gone = true;
    el.classList.add('out');
    setTimeout(() => el.remove(), 320);
  };
  el.querySelector('.toast-act')?.addEventListener('click', () => {
    haptic.tap();
    action.onSelect?.();
    dismiss();
  });
  setTimeout(dismiss, duration);
  return { dismiss };
}

export { esc };
