// タイマー ドック: 2 つのフローティングウィジェットを、画面下に固定する 1 本のバーに統合したもの。
// - full: 記録画面の下端に常駐（再生/リセットは大ボタン）
// - compact: 他の画面では「ミニプレイヤー」として表示、タップで記録画面に戻る
import { html, createEl, raw } from '../lib/html.js';
import { icons } from './icons.js';
import { timer } from '../timer.js';
import { fmtClock } from '../lib/format.js';
import { openSheet } from './overlay.js';
import { confirmDialog } from './overlay.js';
import { state as appState } from '../store.js';

const R = 28; // play ボタンの外周リング半径
const CIRC = 2 * Math.PI * R;

const caption = (snap) => {
  const part = snap.part ? ` · ${snap.part}` : '';
  const total = snap.started ? ` · 合計 ${fmtClock(snap.workoutSec)}` : '';
  switch (snap.status) {
    case 'running': return `休憩中${part}${total}`;
    case 'paused': return `一時停止${part}${total}`;
    case 'done': return '次のセットを始めましょう';
    default: return snap.started ? `休憩${part}${total}` : `休憩タイマー${part}`;
  }
};

export function createDock({ variant = 'full', onOpen } = {}) {
  const el = createEl(html`
    <div class="dock ${variant}" data-state="idle">
      <button class="dock-info" data-act="info" aria-label="${variant === 'full' ? 'タイマーの設定を開く' : '記録画面に戻る'}">
        <span class="dock-time num">03:00</span>
        <span class="dock-cap">休憩タイマー</span>
      </button>
      <button class="dock-reset" data-act="reset" aria-label="リセット">${icons.resetArrow}</button>
      <button class="dock-play" data-act="toggle" aria-label="開始">
        <svg class="dock-ring" viewBox="0 0 64 64" aria-hidden="true">
          <circle class="trk" cx="32" cy="32" r="${R}"/>
          <circle class="prg" cx="32" cy="32" r="${R}" stroke-dasharray="${CIRC.toFixed(2)}" stroke-dashoffset="0" transform="rotate(-90 32 32)"/>
        </svg>
        <span class="dock-icon"></span>
      </button>
    </div>`);
  const timeEl = el.querySelector('.dock-time');
  const capEl = el.querySelector('.dock-cap');
  const prg = el.querySelector('.prg');
  const iconEl = el.querySelector('.dock-icon');
  const playBtn = el.querySelector('.dock-play');
  let lastStatus = '';
  let lastIconKey = '';

  const paint = (snap) => {
    timeEl.textContent = fmtClock(Math.ceil(snap.remaining));
    capEl.textContent = caption(snap);
    prg.style.strokeDashoffset = `${(CIRC * (1 - snap.progress)).toFixed(2)}`;
    el.dataset.state = snap.status;
    el.classList.toggle('nudge', snap.nudge && snap.status === 'idle');
    const key = snap.status === 'running' ? 'pause' : 'play';
    if (key !== lastIconKey) {
      iconEl.innerHTML = '';
      iconEl.append(createEl(html`<span class="ico">${key === 'pause' ? icons.pause : icons.play}</span>`));
      playBtn.setAttribute('aria-label', key === 'pause' ? '一時停止' : '休憩を開始');
      lastIconKey = key;
    }
    if (snap.status !== lastStatus) {
      if (snap.status === 'done') {
        el.classList.remove('bounce');
        void el.offsetWidth;
        el.classList.add('bounce');
      }
      lastStatus = snap.status;
    }
  };

  const unsub = timer.subscribe(paint);

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'toggle') timer.toggle();
    else if (act === 'reset') timer.reset();
    else if (act === 'info') (variant === 'full' ? openTimerSheet() : onOpen?.());
  });

  return { el, destroy: unsub };
}

/* ==========================================================================
   タイマー詳細シート（時間プリセット・±10 秒・終了）
   ========================================================================== */
const RING = 112;
const RC = 2 * Math.PI * RING;

export function openTimerSheet() {
  const presets = [60, 90, 120, 150, 180, 240, 300];
  const content = createEl(html`
    <div class="timer-sheet">
      <div class="timer-hero">
        <svg viewBox="0 0 252 252" class="timer-ring" aria-hidden="true">
          <circle class="trk" cx="126" cy="126" r="${RING}"/>
          <circle class="prg" cx="126" cy="126" r="${RING}" stroke-dasharray="${RC.toFixed(2)}" stroke-dashoffset="0" transform="rotate(-90 126 126)"/>
        </svg>
        <div class="timer-center">
          <div class="timer-big num">03:00</div>
          <div class="timer-sub t-footnote muted">休憩タイマー</div>
        </div>
      </div>
      <div class="timer-adjust">
        <button class="btn btn-tinted btn-sm" data-adj="-10">−10秒</button>
        <button class="btn btn-tinted btn-sm" data-adj="10">＋10秒</button>
      </div>
      <div class="timer-presets">${presets.map((p) => html`<button class="chip" data-sec="${p}" aria-pressed="false">${fmtClock(p)}</button>`)}</div>
      <div class="timer-actions">
        <button class="btn btn-tinted" data-act="reset">${icons.resetArrow}リセット</button>
        <button class="btn btn-primary" data-act="toggle">開始</button>
      </div>
      <div class="timer-total">
        <div><div class="t-footnote muted">ワークアウト合計時間</div><div class="t-title2 num" data-role="total">00:00</div></div>
        <button class="btn btn-danger btn-sm" data-act="end">終了</button>
      </div>
      <div class="t-footnote muted timer-hint">セット完了のチェックで休憩を自動で開始します（設定で変更できます）。</div>
    </div>`);
  const big = content.querySelector('.timer-big');
  const sub = content.querySelector('.timer-sub');
  const prg = content.querySelector('.prg');
  const toggleBtn = content.querySelector('[data-act="toggle"]');
  const totalEl = content.querySelector('[data-role="total"]');
  const chips = [...content.querySelectorAll('[data-sec]')];

  const paint = (snap) => {
    big.textContent = fmtClock(Math.ceil(snap.remaining));
    sub.textContent = caption(snap);
    prg.style.strokeDashoffset = `${(RC * (1 - snap.progress)).toFixed(2)}`;
    content.dataset.state = snap.status;
    toggleBtn.textContent = snap.status === 'running' ? '一時停止' : snap.status === 'paused' ? '再開' : '開始';
    totalEl.textContent = fmtClock(snap.workoutSec);
    chips.forEach((c) => c.setAttribute('aria-pressed', String(Math.round(Number(c.dataset.sec)) === Math.round(snap.total))));
  };
  const unsub = timer.subscribe(paint);

  const sheet = openSheet({ title: '休憩タイマー', content, right: html`<button class="nav-btn strong" data-close>完了</button>`, onClose: unsub });
  content.addEventListener('click', async (e) => {
    const adj = e.target.closest('[data-adj]');
    const sec = e.target.closest('[data-sec]');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (adj) timer.adjust(Number(adj.dataset.adj));
    else if (sec) timer.setDuration(Number(sec.dataset.sec));
    else if (act === 'toggle') timer.toggle();
    else if (act === 'reset') timer.reset();
    else if (act === 'end') {
      const ok = await confirmDialog({ title: 'ワークアウトを終了しますか？', message: '休憩タイマーと合計時間をリセットします。記録した内容は消えません。', confirmLabel: '終了する', destructive: true });
      if (ok) {
        timer.endWorkout();
        sheet.close();
      }
    }
  });
  return sheet;
}
