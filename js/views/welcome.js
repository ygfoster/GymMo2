// 初回起動の画面: パスコードで接続するか、デモデータで試す。
import { html, createEl, raw } from '../lib/html.js';
import { icons } from '../ui/icons.js';
import { connect, enterDemo } from '../store.js';
import { CONFIG } from '../config.js';
import { haptic } from '../lib/haptics.js';
import { ApiError } from '../api.js';

const mark = `<svg class="welcome-mark" viewBox="0 0 512 512" aria-hidden="true">
  <defs><linearGradient id="wbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2a31"/><stop offset="1" stop-color="#08080a"/></linearGradient></defs>
  <rect width="512" height="512" fill="url(#wbg)"/>
  <g fill="none" stroke-width="34" stroke-linecap="round" transform="rotate(-90 256 256)">
    <circle cx="256" cy="256" r="170" stroke="#FF375F" stroke-opacity=".24"/><circle cx="256" cy="256" r="170" stroke="#FF375F" stroke-dasharray="820 1068"/>
    <circle cx="256" cy="256" r="128" stroke="#0A84FF" stroke-opacity=".24"/><circle cx="256" cy="256" r="128" stroke="#0A84FF" stroke-dasharray="520 804"/>
    <circle cx="256" cy="256" r="86" stroke="#7A78FF" stroke-opacity=".24"/><circle cx="256" cy="256" r="86" stroke="#7A78FF" stroke-dasharray="440 540"/>
  </g>
  <g fill="#fff"><rect x="203" y="234" width="15" height="44" rx="5"/><rect x="190" y="245" width="13" height="22" rx="4"/><rect x="218" y="251" width="76" height="10" rx="5"/><rect x="294" y="234" width="15" height="44" rx="5"/><rect x="309" y="245" width="13" height="22" rx="4"/></g>
</svg>`;


export function showWelcome({ shell, onDone, notice = '' }) {
  const live = !!CONFIG.apiUrl;
  const el = createEl(html`
    <div class="welcome" role="main">
      <div class="rise" style="--i:0">${raw(mark)}</div>
      <h1 class="t-large rise" style="--i:1">GymMo</h1>
      <p class="welcome-sub rise" style="--i:2">ワークアウトとコンディションを、<br>ひとつに。</p>
      <div class="welcome-feats">
        <div class="feat rise" style="--i:3"><span class="feat-i" style="--c:var(--c-move)">${icons.tabToday}</span><div><div class="feat-t">リングでひと目</div><div class="feat-s">カロリー収支・タンパク質・睡眠を、その日のサマリーに。</div></div></div>
        <div class="feat rise" style="--i:4"><span class="feat-i" style="--c:var(--c-train)">${icons.stopwatch}</span><div><div class="feat-t">休憩タイマーが寄り添う</div><div class="feat-s">セット完了で自動スタート。かけ忘れを防ぎます。</div></div></div>
        <div class="feat rise" style="--i:5"><span class="feat-i" style="--c:var(--c-gold-2)">${icons.trophy}</span><div><div class="feat-t">自己ベストを見逃さない</div><div class="feat-s">前回の記録を呼び出し、更新を自動で検出します。</div></div></div>
      </div>
      <form class="welcome-form rise" style="--i:6" autocomplete="off">
        ${live ? html`<input class="field" type="password" name="passcode" placeholder="パスコード" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="パスコード" />
          <div class="welcome-err" role="alert">${notice}</div>
          <button class="btn btn-primary btn-block" type="submit"><span class="lbl">接続する</span></button>
          <button class="btn btn-tinted btn-block" type="button" data-demo>デモデータで試す</button>`
        : html`<button class="btn btn-primary btn-block" type="button" data-demo>デモデータで試す</button>
          <div class="welcome-note">接続先が設定されていないため、サンプルデータで機能を確認できます。</div>`}
        ${live ? html`<div class="welcome-note">パスコードはこの端末にのみ保存され、公開コードには含まれません。</div>` : ''}
      </form>
    </div>`);
  shell.append(el);

  const finish = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 560);
    onDone();
  };

  el.querySelector('[data-demo]')?.addEventListener('click', () => {
    haptic.tap();
    enterDemo();
    finish();
  });

  const form = el.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.querySelector('input');
    const err = form.querySelector('.welcome-err');
    const btn = form.querySelector('button[type="submit"]');
    if (!btn) return;
    err.textContent = '';
    const label = btn.querySelector('.lbl');
    btn.disabled = true;
    label.innerHTML = '<span class="spin"></span>';
    try {
      await connect(input.value);
      haptic.success();
      finish();
    } catch (ex) {
      haptic.error();
      input.classList.add('error');
      input.classList.remove('shake');
      void input.offsetWidth;
      input.classList.add('shake');
      err.textContent = ex instanceof ApiError && ex.kind === 'auth' ? 'パスコードが違います。' : ex.message || '接続できませんでした。';
      label.textContent = '接続する';
      btn.disabled = false;
      setTimeout(() => input.classList.remove('error'), 1200);
    }
  });
  return el;
}
