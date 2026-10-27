// 履歴タブ: 月カレンダー + 今月のワークアウト一覧 + 実績（今月/今週/累計）
import { html, createEl } from '../lib/html.js';
import { icons } from '../ui/icons.js';
import { createScreen, partTag, lazyUpdater } from './common.js';
import { state, on, partColor, sync } from '../store.js';
import { router } from '../router.js';
import { createCalendar } from '../ui/calendar.js';
import { marksFor } from '../ui/datepicker.js';
import { dayStats, trainingDates } from '../lib/metrics.js';
import { todayKey, startOfMonth, startOfWeek, addDays, fromKey, formatShort } from '../lib/dates.js';
import { fmtInt } from '../lib/format.js';
import { haptic } from '../lib/haptics.js';

export function createHistoryView() {
  let monthKey = startOfMonth(todayKey());
  const screen = createScreen({
    title: '履歴',
    eyebrow: 'ワークアウトの記録',
    className: 'history',
    onRefresh: () => sync(),
    right: html`<button class="nav-btn pill nav-add" data-act="add" aria-label="ワークアウトを記録">${icons.plus}<span>記録</span></button>`,
  });
  const stats = createEl(html`<div class="stat-trio"></div>`);
  const calCard = createEl(html`<section class="card cal-card rise" style="--i:1"></section>`);
  const listSection = createEl(html`<section class="section rise" style="--i:2"></section>`);
  screen.body.append(stats, calCard, listSection);

  const cal = createCalendar({
    month: monthKey,
    marks: marksFor,
    onSelect: (key) => router.navigate(`/day/${key}`),
    onMonthChange: (m) => {
      monthKey = m;
      renderList();
    },
  });
  calCard.append(cal.el);

  const renderStats = () => {
    const dates = trainingDates(state.training);
    const today = todayKey();
    const weekStart = startOfWeek(today);
    const month = startOfMonth(today);
    const wk = dates.filter((d) => d >= weekStart && d <= addDays(weekStart, 6)).length;
    const mo = dates.filter((d) => d >= month && d.slice(0, 7) === month.slice(0, 7)).length;
    const cell = (label, n) => html`<div class="stat"><div class="stat-v">${n}<small>日</small></div><div class="stat-k">${label}</div></div>`;
    stats.innerHTML = String(html`${cell('今週', wk)}${cell('今月', mo)}${cell('累計', dates.length)}`);
  };

  const renderList = () => {
    const ym = monthKey.slice(0, 7);
    const days = trainingDates(state.training).filter((d) => d.slice(0, 7) === ym).reverse();
    const d = fromKey(monthKey);
    listSection.innerHTML = String(html`
      <div class="section-head"><h2 class="section-title">${d.getMonth() + 1}月のワークアウト</h2><span class="card-aside">${days.length}日</span></div>
      ${days.length
        ? html`<div class="group">${days.map((k) => {
            const st = dayStats(state.training[k]);
            return html`<button class="row day-row" data-day="${k}">
              <div class="row-body">
                <div class="day-row-top"><span class="day-row-date">${formatShort(k)}</span><span class="part-tags">${st.parts.map((p) => partTag(p))}</span></div>
                <div class="row-sub">${st.exercises}種目 ・ ${st.sets}セット ・ ${fmtInt(st.volume)}kg</div>
              </div>${icons.rowChevron}
            </button>`;
          })}</div>`
        : html`<div class="card"><div class="empty tight"><div class="s">この月のワークアウトはありません。</div></div></div>`}`);
  };

  const render = () => {
    renderStats();
    cal.refresh();
    renderList();
  };

  screen.el.addEventListener('click', (e) => {
    const row = e.target.closest('[data-day]');
    if (row) {
      haptic.tap();
      router.navigate(`/day/${row.dataset.day}`);
      return;
    }
    if (e.target.closest('[data-act="add"]')) router.navigate(`/log/${todayKey()}`);
  });

  const lazy = lazyUpdater(render);
  const offs = [on('data', lazy.request), on('settings', lazy.request)];
  render();
  return {
    el: screen.el,
    onShow: lazy.show,
    onHide: lazy.hide,
    destroy: () => offs.forEach((f) => f()),
  };
}
