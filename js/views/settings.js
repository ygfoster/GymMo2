// 設定タブ（iOS の「設定」アプリ風のグループ化リスト）
import { html, createEl } from '../lib/html.js';
import { icons } from '../ui/icons.js';
import { createScreen } from './common.js';
import { morph } from '../lib/dom.js';
import { state, on, updateSettings, sync, disconnect, resetDemo, PART_ORDER, partColor } from '../store.js';
import { CONFIG } from '../config.js';
import { openSheet, confirmDialog, toast, showHud } from '../ui/overlay.js';
import { formatSleep, trainingToRows } from '../lib/parse.js';
import { fmtClock, fmtInt } from '../lib/format.js';
import { haptic } from '../lib/haptics.js';
import { toSheetDate } from '../lib/dates.js';
import { native } from '../native.js';

const PALETTE = ['#FF453A', '#FF9F0A', '#FFD60A', '#30D158', '#63E6E2', '#0A84FF', '#5E5CE6', '#BF5AF2', '#FF375F', '#8E8E93'];

const iconTile = (color, icon) => html`<span class="row-icon" style="background:${color}">${icon}</span>`;

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function download(filename, text) {
  if (native.available) {
    native.saveFile(filename, 'text/csv', '\ufeff' + text);
    return;
  }
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function createSettingsView() {
  const screen = createScreen({ title: '設定', eyebrow: `${CONFIG.appName} v${CONFIG.version}`, className: 'settings' });
  const content = createEl(html`<div class="settings-content"></div>`);
  screen.body.append(content);

  const syncText = () => {
    const s = state.sync;
    if (!state.mode) return '未接続';
    if (s.state === 'syncing') return '同期中…';
    if (s.state === 'offline') return 'オフライン';
    if (s.state === 'error') return s.error || 'エラー';
    if (s.lastAt) {
      const d = new Date(s.lastAt);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} に同期`;
    }
    return '未同期';
  };

  const stepper = (key, label, valueText) => html`<div class="row">
    <div class="row-body"><div class="row-title">${label}</div></div>
    <div class="row-value">${valueText}</div>
    <div class="stepper"><button data-step="${key}" data-d="-1" aria-label="${label}を減らす">−</button><span class="sep"></span><button data-step="${key}" data-d="1" aria-label="${label}を増やす">＋</button></div>
  </div>`;

  const toggle = (key, label, on_, icon, color, sub = '') => html`<div class="row has-icon">
    ${iconTile(color, icon)}
    <div class="row-body"><div class="row-title">${label}</div>${sub ? html`<div class="row-sub">${sub}</div>` : ''}</div>
    <button class="switch" role="switch" aria-checked="${!!on_}" data-toggle="${key}" aria-label="${label}"></button>
  </div>`;

  let rendered = false;
  const render = () => {
    const s = state.settings;
    const themeIdx = ['auto', 'light', 'dark'].indexOf(s.theme);
    const markup = String(html`
      <div class="section" style="margin-top:6px">
        <div class="group">
          <div class="row has-icon">${iconTile('#5E5CE6', icons.paint)}
            <div class="row-body"><div class="row-title">外観</div></div>
            <div class="segmented seg-inline" style="--n:3;--i:${themeIdx}">
              <button data-theme="auto" aria-pressed="${s.theme === 'auto'}">自動</button>
              <button data-theme="light" aria-pressed="${s.theme === 'light'}">ライト</button>
              <button data-theme="dark" aria-pressed="${s.theme === 'dark'}">ダーク</button>
            </div>
          </div>
          <button class="row has-icon" data-open="colors">${iconTile('#FF9F0A', icons.paint)}
            <div class="row-body"><div class="row-title">部位の色</div></div>
            <div class="row-value"><span class="swatches">${PART_ORDER.map((p) => html`<i style="background:${partColor(p)}"></i>`)}</span></div>${icons.rowChevron}
          </button>
        </div>
      </div>

      <div class="section">
        <div class="section-head"><h2 class="cap">操作</h2></div>
        <div class="group">
          ${toggle('haptics', '触覚フィードバック', s.haptics, icons.vibrate, '#34C759', 'タップ時に振動します')}
          ${toggle('sound', '効果音', s.sound, icons.speaker, '#FF3B30', '休憩終了と自己ベスト更新で鳴ります')}
        </div>
      </div>

      <div class="section">
        <div class="section-head"><h2 class="cap">休憩タイマー</h2></div>
        <div class="group">
          ${toggle('autoStart', 'セット完了で自動開始', s.timer.autoStart, icons.stopwatch, '#FF2D55', '✓を押すとタイマーが始まります')}
          ${toggle('nudge', '入力後にそっと知らせる', s.timer.nudge, icons.sparkle, '#FF9500', '✓がやさしく脈動して知らせます')}
          ${toggle('notify', native.available ? '通知欄にタイマーを表示' : '休憩終了を通知', s.timer.notify, icons.bell, '#007AFF', native.available ? 'カウントダウンと終了の合図を通知で' : '画面を閉じているときに通知します')}
          <button class="row has-icon" data-open="rest">${iconTile('#30B0C7', icons.history)}
            <div class="row-body"><div class="row-title">部位ごとの休憩時間</div></div>
            <div class="row-value">${fmtClock(s.timer.presets['胸'])}〜</div>${icons.rowChevron}
          </button>
        </div>
      </div>

      <div class="section">
        <div class="section-head"><h2 class="cap">目標</h2></div>
        <div class="group">
          ${stepper('sleep', '睡眠', formatSleep(s.goals.sleepMin))}
          ${stepper('protein', 'タンパク質', `${fmtInt(s.goals.protein)} g`)}
          ${stepper('kcal', '摂取カロリー', s.goals.kcal ? `${fmtInt(s.goals.kcal)} kcal` : '消費に合わせる')}
        </div>
        <p class="section-note">サマリーのリングの 100% にあたる値です。カロリーを「消費に合わせる」にすると、その日の消費カロリーが目標になります。</p>
      </div>

      <div class="section">
        <div class="section-head"><h2 class="cap">データ</h2></div>
        <div class="group">
          <button class="row has-icon" data-act="sync">${iconTile('#007AFF', icons.refresh)}
            <div class="row-body"><div class="row-title">今すぐ同期</div></div>
            <div class="row-value">${state.sync.pending ? `未送信 ${state.sync.pending}件 ・ ` : ''}${syncText()}</div>
          </button>
          <button class="row has-icon" data-act="csv-training">${iconTile('#5856D6', icons.download)}
            <div class="row-body"><div class="row-title">トレーニング記録を書き出す</div><div class="row-sub">CSV（シートと同じ書式）</div></div>
          </button>
          <button class="row has-icon" data-act="csv-health">${iconTile('#30B0C7', icons.download)}
            <div class="row-body"><div class="row-title">ヘルスデータを書き出す</div><div class="row-sub">CSV</div></div>
          </button>
        </div>
      </div>

      <div class="section">
        <div class="section-head"><h2 class="cap">接続</h2></div>
        <div class="group">
          <div class="row has-icon">${iconTile(state.mode === 'live' ? '#34C759' : '#8E8E93', icons.lock)}
            <div class="row-body"><div class="row-title">${state.mode === 'live' ? 'Googleヘルスと接続中' : state.mode === 'demo' ? 'デモデータを表示中' : '未接続'}</div>
              <div class="row-sub">${state.mode === 'live' ? 'パスコードはこの端末にのみ保存されています' : '実データには接続していません'}</div></div>
          </div>
          ${state.mode === 'demo' ? html`<button class="row has-icon" data-act="reset-demo">${iconTile('#FF9F0A', icons.refresh)}<div class="row-body"><div class="row-title">デモデータをリセット</div></div></button>` : ''}
          <button class="row has-icon danger" data-act="disconnect">${iconTile('#FF3B30', icons.xmark)}
            <div class="row-body"><div class="row-title">${state.mode === 'live' ? '接続を解除（パスコードを忘れる）' : 'デモを終了'}</div></div></button>
        </div>
      </div>

      <p class="foot">${CONFIG.appName} v${CONFIG.version}${native.available ? `（Android アプリ ${native.info()?.version ?? ''}）` : ''}<br>元の GymMo とは独立して動作します。</p>`);
    if (rendered) morph(content, markup);
    else content.innerHTML = markup;
    rendered = true;
  };

  /* ---------- シート ---------- */
  const openRestSheet = () => {
    const body = createEl(html`<div><div class="group rest-list"></div><p class="section-note">セット完了のとき、選んだ部位の時間で休憩タイマーが始まります。</p></div>`);
    const paint = () => {
      body.querySelector('.rest-list').innerHTML = String(html`${PART_ORDER.map((p) => html`<div class="row">
        <i class="part-bar" style="background:${partColor(p)}"></i>
        <div class="row-body"><div class="row-title">${p}</div></div>
        <div class="row-value num">${fmtClock(state.settings.timer.presets[p])}</div>
        <div class="stepper"><button data-rest="${p}" data-d="-1" aria-label="${p}を15秒短く">−</button><span class="sep"></span><button data-rest="${p}" data-d="1" aria-label="${p}を15秒長く">＋</button></div>
      </div>`)}`);
    };
    paint();
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rest]');
      if (!b) return;
      haptic.select();
      const p = b.dataset.rest;
      const v = Math.min(600, Math.max(15, state.settings.timer.presets[p] + Number(b.dataset.d) * 15));
      updateSettings({ timer: { presets: { [p]: v } } });
      paint();
    });
    openSheet({ title: '部位ごとの休憩時間', content: body, right: html`<button class="nav-btn strong" data-close>完了</button>` });
  };

  const openColorSheet = () => {
    const body = createEl(html`<div><div class="group color-list"></div></div>`);
    const paint = () => {
      body.querySelector('.color-list').innerHTML = String(html`${PART_ORDER.map((p) => html`<div class="row color-row">
        <div class="row-body"><div class="row-title">${p}</div>
          <div class="palette">${PALETTE.map((c) => html`<button class="swatch" data-part="${p}" data-c="${c}" aria-pressed="${partColor(p).toLowerCase() === c.toLowerCase()}" aria-label="${p}の色 ${c}" style="background:${c}"></button>`)}</div></div>
      </div>`)}`);
    };
    paint();
    body.addEventListener('click', (e) => {
      const b = e.target.closest('.swatch');
      if (!b) return;
      haptic.select();
      updateSettings({ partColors: { [b.dataset.part]: b.dataset.c } });
      paint();
    });
    openSheet({ title: '部位の色', content: body, right: html`<button class="nav-btn strong" data-close>完了</button>` });
  };

  /* ---------- 書き出し ---------- */
  const exportTraining = () => {
    const rows = [['日付', 'トレーニング部位', '種目', '重量 × 回数', 'トレーニングメモ']];
    for (const d of Object.keys(state.training).sort()) {
      trainingToRows(state.training[d]).forEach((r) => rows.push([r.date, r.part, r.exercise, r.details, r.memo]));
    }
    download(`gymmo2-training-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((r) => r.map(csvEscape).join(',')).join('\r\n'));
    showHud({ text: '書き出しました', sub: `${rows.length - 1}行` });
  };
  const exportHealth = () => {
    const rows = [['日付', '睡眠(分)', 'タンパク質(g)', '脂質(g)', '炭水化物(g)', '摂取カロリー', '消費カロリー']];
    for (const d of Object.keys(state.health).sort()) {
      const h = state.health[d];
      rows.push([toSheetDate(d), h.sleepMin ?? '', h.protein ?? '', h.fat ?? '', h.carb ?? '', h.intake ?? '', h.burned ?? '']);
    }
    download(`gymmo2-health-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((r) => r.map(csvEscape).join(',')).join('\r\n'));
    showHud({ text: '書き出しました', sub: `${rows.length - 1}日分` });
  };

  /* ---------- イベント ---------- */
  screen.el.addEventListener('click', async (e) => {
    const t = e.target;
    const themeBtn = t.closest('[data-theme]');
    if (themeBtn) {
      haptic.select();
      updateSettings({ theme: themeBtn.dataset.theme });
      return;
    }
    const tog = t.closest('[data-toggle]');
    if (tog) {
      haptic.tap();
      const k = tog.dataset.toggle;
      const next = !(k === 'haptics' || k === 'sound' ? state.settings[k] : state.settings.timer[k]);
      if (k === 'haptics' || k === 'sound') updateSettings({ [k]: next });
      else if (k === 'notify' && next && native.available) {
        native.requestNotifications();
        updateSettings({ timer: { notify: true } });
      } else if (k === 'notify' && next) {
        if (typeof Notification === 'undefined') return toast('この端末は通知に対応していません', { kind: 'error' });
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') return toast('通知が許可されませんでした', { kind: 'error' });
        updateSettings({ timer: { notify: true } });
      } else updateSettings({ timer: { [k]: next } });
      return;
    }
    const st = t.closest('[data-step]');
    if (st) {
      haptic.select();
      const d = Number(st.dataset.d);
      const g = state.settings.goals;
      if (st.dataset.step === 'sleep') updateSettings({ goals: { sleepMin: Math.min(720, Math.max(240, g.sleepMin + d * 15)) } });
      else if (st.dataset.step === 'protein') updateSettings({ goals: { protein: Math.min(400, Math.max(30, g.protein + d * 5)) } });
      else if (st.dataset.step === 'kcal') {
        const cur = g.kcal;
        let next;
        if (cur == null) next = 2400;
        else next = cur + d * 50;
        if (cur != null && next < 1200) next = null;
        updateSettings({ goals: { kcal: next === null ? null : Math.min(6000, next) } });
      }
      return;
    }
    const open = t.closest('[data-open]')?.dataset.open;
    if (open === 'rest') return openRestSheet();
    if (open === 'colors') return openColorSheet();
    const act = t.closest('[data-act]')?.dataset.act;
    if (act === 'sync') {
      if (!state.mode) return;
      await sync();
      toast(state.sync.state === 'idle' ? '同期しました' : state.sync.error || '同期できませんでした', { kind: state.sync.state === 'idle' ? 'success' : 'error' });
    } else if (act === 'csv-training') exportTraining();
    else if (act === 'csv-health') exportHealth();
    else if (act === 'reset-demo') {
      const ok = await confirmDialog({ title: 'デモデータをリセットしますか？', message: '編集内容は破棄され、サンプルデータに戻ります。', confirmLabel: 'リセット', destructive: true });
      if (ok) {
        resetDemo();
        showHud({ text: 'リセットしました' });
      }
    } else if (act === 'disconnect') {
      const live = state.mode === 'live';
      const ok = await confirmDialog({
        title: live ? '接続を解除しますか？' : 'デモを終了しますか？',
        message: live ? 'この端末のパスコードとキャッシュを削除します。データはGoogleシートに残ります。' : 'デモデータを削除して最初の画面に戻ります。',
        confirmLabel: live ? '解除' : '終了',
        destructive: true,
      });
      if (ok) disconnect();
    }
  });

  const offA = on('settings', render);
  const offB = on('sync', render);
  render();
  return { el: screen.el, destroy() { offA(); offB(); } };
}
