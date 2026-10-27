// 画面共通の部品: スクロール連動ナビバー付きの画面骨格、部位ラベル、セット表示など。
import { html, createEl, raw } from '../lib/html.js';
import { state, partColor } from '../store.js';
import { fmtNum } from '../lib/format.js';
import { partCategory } from '../lib/parse.js';
import { clamp } from '../lib/format.js';
import { attachPullToRefresh } from '../ui/ptr.js';

/**
 * Apple 風の画面骨格。スクロールに応じてラージタイトルがナビバーのインライン表示に移り変わる。
 * @returns {{el:HTMLElement, body:HTMLElement, navbar:HTMLElement, setTitle:(t:string)=>void, setEyebrow:(t:string)=>void, setRight:(h:any)=>void}}
 */
export function createScreen({ title = '', eyebrow = '', left = '', right = '', className = '', dock = false, onRefresh = null } = {}) {
  const el = createEl(html`
    <section class="screen ${className} ${dock ? 'has-dock' : ''}">
      <header class="navbar">
        <div class="navbar-bg"></div>
        <div class="navbar-row">
          <div class="nav-left">${left}</div>
          <div class="nav-title">${title}</div>
          <div class="nav-right">${right}</div>
        </div>
      </header>
      <div class="content">
        <div class="large-title-block">
          <div class="eyebrow">${eyebrow}</div>
          <h1 class="t-large">${title}</h1>
        </div>
        <div class="body"></div>
      </div>
    </section>`);
  const navbar = el.querySelector('.navbar');
  let raf = 0;
  el.addEventListener(
    'scroll',
    () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        navbar.style.setProperty('--p', clamp((el.scrollTop - 14) / 26, 0, 1).toFixed(3));
      });
    },
    { passive: true }
  );
  if (onRefresh) attachPullToRefresh(el, el.querySelector('.content'), onRefresh);
  return {
    el,
    navbar,
    body: el.querySelector('.body'),
    setTitle(t) {
      el.querySelector('.nav-title').textContent = t;
      el.querySelector('h1').textContent = t;
    },
    setEyebrow(t) {
      el.querySelector('.eyebrow').textContent = t;
      el.querySelector('.eyebrow').hidden = !t;
    },
    setRight(h) {
      el.querySelector('.nav-right').innerHTML = String(h);
    },
  };
}

/** 部位の色付きドット + 名前 */
export function partTag(part) {
  const p = partCategory(part);
  return html`<span class="part-tag"><i style="background:${partColor(p)}"></i>${p}</span>`;
}

/** 1 セットのピル表示（"55kg×8" / 自重は "10回"） */
export function setPill(set, { pr = false } = {}) {
  const w = set.w != null ? html`${fmtNum(set.w)}<small>kg</small>` : '';
  const r = set.r != null ? set.r : '–';
  return html`<span class="setpill ${pr ? 'is-pr' : ''}">${set.w != null ? html`${w}<em>×</em>${r}` : html`${r}<small>回</small>`}</span>`;
}

/** 数値を「大きな数字 + 小さな単位」で */
export function bigNum(value, unit = '') {
  return html`<span class="bignum">${value}${unit ? html`<small>${unit}</small>` : ''}</span>`;
}

export const loadingBlock = (h = 120) => html`<div class="skeleton" style="height:${h}px;border-radius:22px"></div>`;

/** 画面が非表示のあいだはデータ更新を保留し、表示時にまとめて再描画するための小さな仕掛け */
export function lazyUpdater(render) {
  let visible = false;
  let dirty = false;
  return {
    show() {
      visible = true;
      if (dirty) {
        dirty = false;
        render();
      }
    },
    hide() {
      visible = false;
    },
    request() {
      if (visible) render();
      else dirty = true;
    },
    get visible() {
      return visible;
    },
  };
}

export { raw };
