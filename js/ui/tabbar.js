// タブバー（今日 / 履歴 / 記録（ダンベル）/ 分析 / 設定）。選択中のタブをもう一度押すと先頭へスクロール or 戻る。
import { html, createEl } from '../lib/html.js';
import { icons } from './icons.js';
import { router } from '../router.js';
import { haptic } from '../lib/haptics.js';

const TABS = [
  { id: 'today', label: '今日', icon: icons.tabToday, path: '/today' },
  { id: 'history', label: '履歴', icon: icons.tabHistory, path: '/history' },
  { id: 'add' },
  { id: 'analyze', label: '分析', icon: icons.tabAnalyze, path: '/analyze' },
  { id: 'settings', label: '設定', icon: icons.tabSettings, path: '/settings' },
];

export function createTabbar({ onAdd }) {
  const el = createEl(html`<nav class="tabbar" aria-label="メインメニュー">${TABS.map((t) =>
    t.id === 'add'
      ? html`<div class="tab-add"><button class="tab-add-btn" data-tab="add" aria-label="ワークアウトを記録">${icons.dumbbell}</button></div>`
      : html`<button class="tab" data-tab="${t.id}" aria-selected="false">${t.icon}<span>${t.label}</span></button>`
  )}</nav>`);

  const set = (current) => {
    el.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === current)));
  };

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    haptic.select();
    if (b.dataset.tab === 'add') return onAdd();
    const info = router.info;
    if (info.tab === b.dataset.tab) router.reselectTab();
    else router.navigate(TABS.find((t) => t.id === b.dataset.tab).path);
  });

  router.onChange((info) => set(info.tab));
  return el;
}
