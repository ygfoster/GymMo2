// 月カレンダー（履歴タブと日付ピッカーで共用）。横スワイプ/矢印で月送り、日付の下に部位ドットを表示。
import { html, createEl } from '../lib/html.js';
import { icons } from './icons.js';
import { haptic } from '../lib/haptics.js';
import { fromKey, monthMatrix, formatMonthTitle, todayKey, addMonths, startOfMonth } from '../lib/dates.js';

const WEEK = ['月', '火', '水', '木', '金', '土', '日'];

/**
 * @param {{month?:string, selected?:string, onSelect:(key:string)=>void, marks:(key:string)=>string[], onMonthChange?:(monthKey:string)=>void}} o
 */
export function createCalendar(o) {
  let monthKey = startOfMonth(o.month || o.selected || todayKey());
  let selected = o.selected || null;
  const el = createEl(html`
    <div class="cal">
      <div class="cal-head">
        <button class="cal-title" data-act="today" aria-label="今月へ移動"></button>
        <div class="cal-nav">
          <button class="icon-btn" data-act="prev" aria-label="前の月">${icons.chevronLeft}</button>
          <button class="icon-btn" data-act="next" aria-label="次の月">${icons.chevronRight}</button>
        </div>
      </div>
      <div class="cal-week">${WEEK.map((w, i) => html`<span class="${i >= 5 ? 'we' : ''}">${w}</span>`)}</div>
      <div class="cal-viewport"><div class="cal-grid"></div></div>
    </div>`);
  const titleEl = el.querySelector('.cal-title');
  const viewport = el.querySelector('.cal-viewport');
  let grid = el.querySelector('.cal-grid');

  const buildGrid = () => {
    const d = fromKey(monthKey);
    const today = todayKey();
    const cells = monthMatrix(d.getFullYear(), d.getMonth());
    const g = createEl(html`<div class="cal-grid">${cells.map((c) => {
      const marks = c.inMonth ? o.marks(c.key) : [];
      const cls = ['cal-cell', c.inMonth ? '' : 'out', c.key === today ? 'today' : '', c.key === selected ? 'sel' : '', marks.length ? 'has' : ''].join(' ');
      return html`<button class="${cls}" data-key="${c.key}" ${c.inMonth ? '' : 'tabindex="-1"'} aria-label="${c.key}">
        <span class="d">${c.day}</span>
        <span class="m">${marks.slice(0, 3).map((col) => html`<i style="background:${col}"></i>`)}</span>
      </button>`;
    })}</div>`);
    return g;
  };

  const show = (dir) => {
    const d = fromKey(monthKey);
    titleEl.textContent = formatMonthTitle(d.getFullYear(), d.getMonth());
    const next = buildGrid();
    if (!dir) {
      grid.replaceWith(next);
      grid = next;
      return;
    }
    const old = grid;
    const h = Math.max(old.offsetHeight, next.offsetHeight);
    viewport.style.height = `${old.offsetHeight}px`;
    old.classList.add(dir > 0 ? 'out-left' : 'out-right');
    next.classList.add(dir > 0 ? 'in-right' : 'in-left');
    viewport.append(next);
    next.style.position = 'absolute';
    next.style.inset = '0 0 auto 0';
    requestAnimationFrame(() => {
      viewport.style.height = `${next.offsetHeight || h}px`;
    });
    grid = next;
    setTimeout(() => {
      old.remove();
      next.classList.remove('in-right', 'in-left');
      next.style.position = '';
      next.style.inset = '';
      viewport.style.height = '';
    }, 420);
  };

  const move = (delta) => {
    monthKey = addMonths(monthKey, delta);
    haptic.select();
    show(delta);
    o.onMonthChange?.(monthKey);
  };

  el.addEventListener('click', (e) => {
    const cell = e.target.closest('.cal-cell');
    if (cell && !cell.classList.contains('out')) {
      haptic.tap();
      selected = cell.dataset.key;
      o.onSelect(selected);
      el.querySelectorAll('.cal-cell.sel').forEach((c) => c.classList.remove('sel'));
      cell.classList.add('sel');
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'prev') move(-1);
    else if (act === 'next') move(1);
    else if (act === 'today') {
      const t = startOfMonth(todayKey());
      if (t !== monthKey) {
        const dir = t > monthKey ? 1 : -1;
        monthKey = t;
        show(dir);
        o.onMonthChange?.(monthKey);
      }
    }
  });

  // 横スワイプで月送り
  let sx = 0;
  let sy = 0;
  viewport.addEventListener('touchstart', (e) => {
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
  }, { passive: true });
  viewport.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) move(dx < 0 ? 1 : -1);
  }, { passive: true });

  show(0);
  return {
    el,
    refresh: () => show(0),
    setSelected(key) {
      selected = key;
      show(0);
    },
    get month() {
      return monthKey;
    },
  };
}
