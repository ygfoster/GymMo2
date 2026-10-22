// プルして更新（iOS 風）。先頭までスクロールした状態で下に引くと、コンテンツが抵抗を持って下がり、
// しきい値を超えて離すと更新する。振動でしきい値到達を知らせる。
import { haptic } from '../lib/haptics.js';

const THRESHOLD = 74;
const MAX_PULL = 130;
const HOLD = 58;

const ARC = `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="11" stroke="currentColor" stroke-opacity=".18" stroke-width="3"/><circle class="arc" cx="16" cy="16" r="11" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="69.1" stroke-dashoffset="69.1" transform="rotate(-90 16 16)"/></svg>`;

/**
 * @param {HTMLElement} screenEl スクロールする .screen
 * @param {HTMLElement} contentEl 引き下げで動かす .content
 * @param {() => Promise<any>} onRefresh
 */
export function attachPullToRefresh(screenEl, contentEl, onRefresh) {
  const ind = document.createElement('div');
  ind.className = 'ptr';
  ind.innerHTML = ARC;
  screenEl.append(ind);
  const arc = ind.querySelector('.arc');

  let startY = 0;
  let pull = 0;
  let active = false;
  let busy = false;
  let crossed = false;

  const set = (px, animate = false) => {
    contentEl.style.transition = animate ? 'transform 0.45s var(--ease-out)' : 'none';
    contentEl.style.transform = px ? `translateY(${px}px)` : '';
    ind.style.transition = animate ? 'opacity 0.3s' : 'none';
    ind.style.opacity = String(Math.min(1, px / 46));
    ind.style.transform = `translateY(${Math.min(px, HOLD) * 0.55 - 8}px)`;
    if (!busy) arc.style.strokeDashoffset = String(69.1 * (1 - Math.min(1, px / THRESHOLD)));
  };

  screenEl.addEventListener('touchstart', (e) => {
    if (busy || e.touches.length !== 1 || screenEl.scrollTop > 0) return;
    startY = e.touches[0].clientY;
    pull = 0;
    active = true;
    crossed = false;
  }, { passive: true });

  screenEl.addEventListener('touchmove', (e) => {
    if (!active) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0 || screenEl.scrollTop > 0) {
      if (pull) set(0);
      pull = 0;
      return;
    }
    e.preventDefault();
    pull = Math.min(MAX_PULL, dy * 0.52);
    set(pull);
    if (!crossed && pull >= THRESHOLD) {
      crossed = true;
      haptic.impact();
    } else if (crossed && pull < THRESHOLD) crossed = false;
  }, { passive: false });

  const end = async () => {
    if (!active) return;
    active = false;
    if (pull >= THRESHOLD && !busy) {
      busy = true;
      ind.classList.add('spin');
      arc.style.strokeDashoffset = '24';
      set(HOLD, true);
      try {
        await Promise.all([onRefresh(), new Promise((r) => setTimeout(r, 650))]);
        haptic.success();
      } catch {
        haptic.error();
      } finally {
        busy = false;
        ind.classList.remove('spin');
        set(0, true);
      }
    } else {
      set(0, true);
    }
    pull = 0;
  };
  screenEl.addEventListener('touchend', end, { passive: true });
  screenEl.addEventListener('touchcancel', end, { passive: true });
}
