// 日付ピッカー（ボトムシートの中に月カレンダー）
import { html, createEl } from '../lib/html.js';
import { openSheet } from './overlay.js';
import { createCalendar } from './calendar.js';
import { state, partColor } from '../store.js';
import { dayStats } from '../lib/metrics.js';
import { todayKey } from '../lib/dates.js';

export function marksFor(key) {
  const day = state.training[key];
  if (!day || !day.exercises.length) return [];
  return dayStats(day).parts.map((p) => partColor(p));
}

export function openDatePicker({ selected, onPick }) {
  const wrap = createEl(html`<div class="picker"></div>`);
  const cal = createCalendar({
    selected,
    marks: marksFor,
    onSelect: (key) => {
      setTimeout(() => {
        sheet.close();
        onPick(key);
      }, 160);
    },
  });
  wrap.append(cal.el);
  const sheet = openSheet({
    title: '日付を選択',
    content: wrap,
    right: html`<button class="nav-btn" data-close>閉じる</button>`,
    left: html`<button class="nav-btn" id="pick-today">今日</button>`,
  });
  sheet.$('#pick-today').addEventListener('click', () => {
    sheet.close();
    onPick(todayKey());
  });
  return sheet;
}
