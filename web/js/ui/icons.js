// SF Symbols 風のアイコン。すべて 24x24 viewBox、currentColor。固定マークアップなので raw() で埋め込む。
import { raw, esc } from '../lib/html.js';

const svg = (inner, extra = '') =>
  raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${inner}</svg>`);

export const icons = {
  // ----- タブ（.fill が選択時に表示される塗り） -----
  tabToday: svg(
    `<circle cx="12" cy="12" r="9.25"/><circle cx="12" cy="12" r="5"/><circle class="fill" cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/><path class="fill" d="M12 2.75a9.25 9.25 0 0 1 0 18.5" stroke-width="3.2"/>`
  ),
  tabHistory: svg(
    `<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><rect class="fill" x="3.5" y="5" width="17" height="15.5" rx="3.5" fill="currentColor" stroke="none"/><path class="fill" d="M3.5 10h17" stroke="var(--bg)" stroke-width="1.6"/>`
  ),
  tabAnalyze: svg(
    `<rect x="4" y="12" width="3.6" height="8" rx="1.2"/><rect x="10.2" y="4" width="3.6" height="16" rx="1.2"/><rect x="16.4" y="8.5" width="3.6" height="11.5" rx="1.2"/><g class="fill" fill="currentColor" stroke="none"><rect x="4" y="12" width="3.6" height="8" rx="1.2"/><rect x="10.2" y="4" width="3.6" height="16" rx="1.2"/><rect x="16.4" y="8.5" width="3.6" height="11.5" rx="1.2"/></g>`
  ),
  tabSettings: svg(
    `<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.4"/><circle cx="9" cy="17" r="2.4"/><g class="fill" fill="currentColor" stroke="none"><circle cx="15" cy="7" r="2.9"/><circle cx="9" cy="17" r="2.9"/></g>`
  ),

  // ----- 操作 -----
  plus: svg(`<path d="M12 5v14M5 12h14"/>`, 'stroke-width="2.4"'),
  chevronLeft: svg(`<path d="M15 5l-7 7 7 7"/>`, 'stroke-width="2.2"'),
  chevronRight: svg(`<path d="M9 5l7 7-7 7"/>`, 'stroke-width="2.2"'),
  chevronDown: svg(`<path d="M5 9l7 7 7-7"/>`, 'stroke-width="2.2"'),
  chevronUpDown: svg(`<path d="M8 9l4-4 4 4M8 15l4 4 4-4"/>`),
  rowChevron: raw(
    `<svg class="row-chevron" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 1.5L6.5 7l-5 5.5"/></svg>`
  ),
  check: svg(`<path d="M5 12.5l4.5 4.5L19 7.5"/>`, 'stroke-width="2.6"'),
  xmark: svg(`<path d="M6 6l12 12M18 6L6 18"/>`, 'stroke-width="2.2"'),
  trash: svg(`<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.2a2 2 0 0 0 2 1.8h6a2 2 0 0 0 2-1.8L18 7M9 7V4.8A1.8 1.8 0 0 1 10.8 3h2.4A1.8 1.8 0 0 1 15 4.8V7"/>`),
  ellipsis: svg(`<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>`),
  copy: svg(`<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="3"/><path d="M15.5 8.5V6.5a3 3 0 0 0-3-3h-6a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h2"/>`),
  history: svg(`<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 4v4.5H8M12 7.5V12l3 2"/>`),
  calendar: svg(`<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>`),
  download: svg(`<path d="M12 3.5v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>`),
  refresh: svg(`<path d="M20 11.5A8 8 0 0 0 5.6 7.2L4 9M4 4.5V9h4.5M4 12.5a8 8 0 0 0 14.4 4.3L20 15M20 19.5V15h-4.5"/>`),
  lock: svg(`<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>`),
  search: svg(`<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>`),

  // ----- タイマー -----
  play: raw(`<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5.5 5.2v13.6a1 1 0 0 0 1.52.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 5.5 5.2z"/></svg>`),
  pause: raw(`<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4.4" height="15" rx="1.4"/><rect x="13.6" y="4.5" width="4.4" height="15" rx="1.4"/></svg>`),
  resetArrow: svg(`<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5L4.5 8.8"/><path d="M4.5 4.2v4.6h4.6"/>`, 'stroke-width="2"'),
  stopwatch: svg(`<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.5M9.5 3h5M18.5 6l1.2-1.2"/>`),
  bell: svg(`<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>`),

  // ----- 健康・トレーニング -----
  dumbbell: svg(`<path d="M6.5 6v12M17.5 6v12M6.5 12h11"/><rect x="3" y="8.5" width="3.5" height="7" rx="1.2"/><rect x="17.5" y="8.5" width="3.5" height="7" rx="1.2"/>`),
  barbellBig: raw(
    `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 16v32M47 16v32M17 32h30"/><rect x="7" y="22" width="10" height="20" rx="3"/><rect x="47" y="22" width="10" height="20" rx="3"/><path d="M3 28v8M61 28v8"/></svg>`
  ),
  flame: svg(`<path d="M12 21c4 0 6.5-2.6 6.5-6 0-2.6-1.4-4.4-2.8-5.8-.4 1.3-1.2 2.1-2.2 2.4.5-2.9-.6-6-3.5-8.1.1 3-1.5 4.6-3 6.2C5.7 11 5.5 12.7 5.5 15c0 3.4 2.5 6 6.5 6z"/>`),
  moon: svg(`<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>`),
  fork: svg(`<path d="M7 3v7a2.5 2.5 0 0 0 2.5 2.5V21M7 3v5M11.5 3v5M5 3v5.5M16 21V3c-2 1.4-3 4-3 7v3h3"/>`),
  trophy: svg(`<path d="M8 4h8v6a4 4 0 0 1-8 0V4zM8 6H4.5v1.2A3.3 3.3 0 0 0 8 10.5M16 6h3.5v1.2a3.3 3.3 0 0 1-3.5 3.3M12 14v4M8.5 20.5h7"/>`),
  star: raw(`<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.8l2.7 5.9 6.4.7-4.8 4.3 1.4 6.3L12 16.7 6.3 20l1.4-6.3L2.9 9.4l6.4-.7L12 2.8z"/></svg>`),
  sparkle: svg(`<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9L12 3.5zM18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>`),
  trendUp: svg(`<path d="M3.5 17l6-6 4 4 7-8M15.5 7h5v5"/>`),
  moonBig: raw(
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>`
  ),
  cloudOff: svg(`<path d="M3.5 3.5l17 17M7.2 7.4A6.5 6.5 0 0 0 6.5 18H17M9.5 5.4A6 6 0 0 1 18 11a4 4 0 0 1 2 7.2"/>`),
  eyeOff: svg(`<path d="M3 3l18 18M10.6 5.2A9.7 9.7 0 0 1 12 5c5 0 8.5 4 9.5 7a12 12 0 0 1-2.6 3.9M6.3 6.6A12.6 12.6 0 0 0 2.5 12c1 3 4.5 7 9.5 7 1.5 0 2.8-.4 4-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>`),
  info: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.01"/>`, 'stroke-width="2"'),
  alert: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 7.5V13M12 16.4v.01"/>`, 'stroke-width="2.2"'),
  paint: svg(`<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-.8 2-1.7 0-1.4-1.3-1.6-1.3-2.9 0-1 .8-1.7 1.8-1.7H17a3.5 3.5 0 0 0 3.5-3.5C20.5 6.7 16.8 3.5 12 3.5z"/><circle cx="8" cy="11" r="1.1" fill="currentColor"/><circle cx="11" cy="7.6" r="1.1" fill="currentColor"/><circle cx="15.3" cy="8.4" r="1.1" fill="currentColor"/>`),
  target: svg(`<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>`),
  vibrate: svg(`<rect x="8" y="4" width="8" height="16" rx="2.4"/><path d="M4 8.5v7M20 8.5v7M1.8 10.5v3M22.2 10.5v3"/>`),
  speaker: svg(`<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>`),
};

/** 部位などに使う小さな色付きドット */
export const dot = (color, size = 8) => raw(`<span class="dot" style="width:${size}px;height:${size}px;border-radius:50%;background:${esc(color)};display:inline-block"></span>`);
