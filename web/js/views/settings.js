// 設定タブ（iOS の「設定」アプリ風のグループ化リスト）
import { html, createEl } from '../lib/html.js';
import { icons } from '../ui/icons.js';
import { createScreen } from './common.js';
import { morph } from '../lib/dom.js';
import { state, on, updateSettings, sync, disconnect, resetDemo, partColor, updatePart, addPart, deletePart, movePart, renamePart, validatePartName, PART_NAME_MAX, normalizeTemplates, TEMPLATE_LIMITS } from '../store.js';
import { CONFIG } from '../config.js';
import { openSheet, confirmDialog, toast, showHud } from '../ui/overlay.js';
import { formatSleep, trainingToRows, normPart, OTHER_PART } from '../lib/parse.js';
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

  // 通知がオンなのに端末側で許可されていない場合は、その旨を表示する
  const notifyBlocked = () => {
    if (!state.settings.timer.notify) return false;
    if (native.available) return !native.notificationsAllowed();
    return typeof Notification !== 'undefined' && Notification.permission !== 'granted';
  };
  const notifySub = () => {
    if (notifyBlocked()) return native.available ? '⚠︎ Android の設定で通知がオフになっています' : '⚠︎ ブラウザの設定で通知がブロックされています';
    return native.available ? 'カウントダウンと終了の合図を通知で' : '画面を閉じているときに通知します';
  };

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
          ${toggle('notify', native.available ? '通知欄にタイマーを表示' : '休憩終了を通知', s.timer.notify, icons.bell, '#007AFF', notifySub())}
          <button class="row has-icon" data-open="parts">${iconTile('#30B0C7', icons.dumbbell)}
            <div class="row-body"><div class="row-title">部位と休憩時間</div><div class="row-sub">名前・色・休憩時間・追加と削除</div></div>
            <div class="row-value"><span class="swatches">${[...s.parts.map((p) => p.color), s.other.color].map((c) => html`<i style="background:${c}"></i>`)}</span></div>${icons.rowChevron}
          </button>
          <button class="row has-icon" data-open="templates">${iconTile('#FF9500', icons.stopwatch)}
            <div class="row-body"><div class="row-title">タイマーのテンプレート</div><div class="row-sub">タイマー画面の時間ボタン（最大${TEMPLATE_LIMITS.count}個）</div></div>
            <div class="row-value">${s.timer.templates.length}個</div>${icons.rowChevron}
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
        <p class="section-note">今日のサマリーの棒に引く目標線の値です。カロリーを「消費に合わせる」にすると、収支 ±0 が目標になります。摂取カロリーを決めると、その日の「目標摂取 − 消費」の位置に線が引かれます。</p>
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

  /* ---------- 部位と休憩時間 ---------- */
  const daysWithPart = (names) => Object.values(state.training).filter((d) => names.includes(normPart(d.part)) || d.exercises.some((e) => names.includes(normPart(e.part)))).length;

  const openPartsSheet = () => {
    const body = createEl(html`<div class="parts-editor">
      <div class="group parts-list"></div>
      <div class="group" style="margin-top:14px"><button class="row add-part" data-add>${iconTile('#34C759', icons.plus)}<div class="row-body"><div class="row-title accent">部位を追加</div></div></button></div>
      <p class="section-note">部位をタップすると名前・色・並び順の変更や削除ができます。セット完了のとき、選んだ部位の休憩時間でタイマーが始まります。</p>
    </div>`);
    const restRow = (id, name, color, rest, editable) => html`<div class="row part-row" data-id="${id}">
      <button class="part-main" data-edit="${id}" aria-label="${name}を編集">
        <i class="part-dot" style="background:${color}"></i>
        <span class="part-name">${name}</span>${editable ? '' : html`<span class="part-fixed">固定</span>`}
      </button>
      <div class="row-value num part-rest">${fmtClock(rest)}</div>
      <div class="stepper"><button data-rest="${id}" data-d="-1" aria-label="${name}の休憩を15秒短く">−</button><span class="sep"></span><button data-rest="${id}" data-d="1" aria-label="${name}の休憩を15秒長く">＋</button></div>
    </div>`;
    const paint = () => {
      const st = state.settings;
      body.querySelector('.parts-list').innerHTML = String(html`${st.parts.map((p) => restRow(p.id, p.name, p.color, p.rest, true))}${restRow('other', OTHER_PART, st.other.color, st.other.rest, false)}`);
    };
    paint();
    body.addEventListener('click', (e) => {
      const r = e.target.closest('[data-rest]');
      if (r) {
        haptic.select();
        const id = r.dataset.rest;
        const cur = id === 'other' ? state.settings.other.rest : state.settings.parts.find((p) => p.id === id)?.rest;
        if (cur == null) return;
        updatePart(id, { rest: Math.min(600, Math.max(15, cur + Number(r.dataset.d) * 15)) });
        paint();
        return;
      }
      const ed = e.target.closest('[data-edit]');
      if (ed) {
        haptic.tap();
        openPartEditor(ed.dataset.edit, paint);
        return;
      }
      if (e.target.closest('[data-add]')) {
        haptic.tap();
        openPartEditor(null, paint);
      }
    });
    openSheet({ title: '部位と休憩時間', tall: true, content: body, right: html`<button class="nav-btn strong" data-close>完了</button>` });
  };

  /** 部位の編集（id=null で追加、'other' は色だけ） */
  const openPartEditor = (id, onDone) => {
    const isNew = id == null;
    const isOther = id === 'other';
    const part = isNew ? null : isOther ? { id: 'other', name: OTHER_PART, ...state.settings.other } : state.settings.parts.find((p) => p.id === id);
    if (!isNew && !part) return;
    const used = new Set(state.settings.parts.map((p) => p.color.toLowerCase()));
    let color = part?.color || PALETTE.find((c) => !used.has(c.toLowerCase())) || PALETTE[0];
    const idx = isNew || isOther ? -1 : state.settings.parts.findIndex((p) => p.id === id);
    const last = state.settings.parts.length - 1;
    const records = isNew || isOther ? 0 : daysWithPart(part.name === '脚' ? ['脚', '足'] : [part.name]);

    const body = createEl(html`<div class="part-editor">
      <div class="section-head"><h2 class="cap">名前</h2></div>
      <div class="group pad">
        ${isOther
          ? html`<div class="row"><div class="row-body"><div class="row-title">${OTHER_PART}</div><div class="row-sub">どの部位にも当てはまらない記録の受け皿なので、名前の変更と削除はできません</div></div></div>`
          : html`<input class="field part-name-in" maxlength="${PART_NAME_MAX}" placeholder="例: 胸、背中、二頭筋" value="${part?.name || ''}" enterkeyhint="done" autocomplete="off" aria-label="部位の名前" />
            <p class="field-error" hidden></p>`}
      </div>
      ${!isNew && !isOther && records ? html`<p class="section-note">名前を変えると、過去の記録（${records}日分）も新しい名前に書き換わります。</p>` : ''}
      <div class="section-head"><h2 class="cap">色</h2></div>
      <div class="group pad"><div class="palette">${PALETTE.map((c) => html`<button class="swatch" data-c="${c}" aria-pressed="${color.toLowerCase() === c.toLowerCase()}" aria-label="色 ${c}" style="background:${c}"></button>`)}</div></div>
      ${idx >= 0 && last > 0
        ? html`<div class="section-head"><h2 class="cap">並び順</h2></div>
          <div class="group"><div class="row"><div class="row-body"><div class="row-title order-n">${idx + 1}番目</div></div>
            <div class="stepper order-stepper"><button data-move="-1" aria-label="上へ" ${idx === 0 ? 'disabled' : ''}>${icons.chevronLeft}</button><span class="sep"></span><button data-move="1" aria-label="下へ" ${idx === last ? 'disabled' : ''}>${icons.chevronRight}</button></div></div></div>`
        : ''}
      ${!isNew && !isOther
        ? html`<div class="group" style="margin-top:26px"><button class="row danger del-part" data-del><div class="row-body"><div class="row-title">この部位を削除</div></div></button></div>
          <p class="section-note">${records ? `削除しても過去の記録（${records}日分）は消えず、「その他」として表示されます。同じ名前の部位を追加し直すと元に戻ります。` : 'この部位の記録はありません。'}</p>`
        : ''}
    </div>`);
    const input = body.querySelector('.part-name-in');
    const errEl = body.querySelector('.field-error');
    const showErr = (msg) => {
      if (!errEl) return;
      errEl.textContent = msg || '';
      errEl.hidden = !msg;
    };
    input?.addEventListener('input', () => showErr(''));

    let sheet;
    const commit = async () => {
      if (isOther) {
        updatePart('other', { color });
        sheet.close();
        onDone();
        return;
      }
      const name = input.value.trim();
      const err = validatePartName(name, { exceptId: isNew ? null : id });
      if (err) {
        haptic.error();
        showErr(err);
        input.focus();
        return;
      }
      if (isNew) {
        addPart(name, color);
        sheet.close();
        onDone();
        showHud({ text: '追加しました', sub: name });
        return;
      }
      updatePart(id, { color });
      const renamed = name !== part.name;
      sheet.close();
      onDone();
      if (renamed) {
        const res = await renamePart(id, name).catch((er) => {
          toast(er.message, { kind: 'error' });
          return null;
        });
        onDone();
        if (res) showHud(res.synced ? { text: '名前を変更しました', sub: res.count ? `過去の記録 ${res.count}日分も更新` : '' } : { text: '端末で変更しました', sub: '接続後にシートへ反映します', kind: 'offline' });
      }
    };

    body.addEventListener('click', async (e) => {
      const sw = e.target.closest('.swatch');
      if (sw) {
        haptic.select();
        color = sw.dataset.c;
        body.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-pressed', String(b === sw)));
        return;
      }
      const mv = e.target.closest('[data-move]');
      if (mv && !mv.disabled) {
        haptic.select();
        movePart(id, Number(mv.dataset.move));
        onDone();
        const i2 = state.settings.parts.findIndex((p) => p.id === id);
        body.querySelector('.order-n').textContent = `${i2 + 1}番目`;
        body.querySelector('[data-move="-1"]').disabled = i2 === 0;
        body.querySelector('[data-move="1"]').disabled = i2 === last;
        return;
      }
      if (e.target.closest('[data-del]')) {
        const ok = await confirmDialog({
          title: `「${part.name}」を削除しますか？`,
          message: records ? `過去の記録（${records}日分）は消えずに「その他」として表示されます。` : '',
          confirmLabel: '削除',
          destructive: true,
        });
        if (!ok) return;
        deletePart(id);
        haptic.warning();
        sheet.close();
        onDone();
        showHud({ text: '削除しました' });
      }
    });
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      }
    });
    sheet = openSheet({
      title: isNew ? '部位を追加' : isOther ? OTHER_PART : '部位を編集',
      content: body,
      left: html`<button class="nav-btn" data-close>キャンセル</button>`,
      right: html`<button class="nav-btn strong" data-commit>${isNew ? '追加' : '完了'}</button>`,
    });
    sheet.$('[data-commit]').addEventListener('click', commit);
    if (isNew) setTimeout(() => input?.focus(), 420);
  };

  /* ---------- タイマーのテンプレート ---------- */
  // 編集中は並びを保ち（押している行が動かないように）、保存は常に短い順・重複なしで行う。閉じると表示も短い順になる。
  const openTemplatesSheet = () => {
    const { min, max, step, count } = TEMPLATE_LIMITS;
    let list = state.settings.timer.templates.slice();
    const body = createEl(html`<div class="tpl-editor">
      <div class="group tpl-list"></div>
      <div class="group" style="margin-top:14px"><button class="row add-part" data-tadd>${iconTile('#34C759', icons.plus)}<div class="row-body"><div class="row-title">テンプレートを追加</div></div></button></div>
      <p class="section-note">−／＋ は ${step} 秒刻みです（長押しで連続して変わります）。${fmtClock(min)}〜${fmtClock(max)}・最大 ${count} 個。タイマー画面には短い順に並びます。</p>
    </div>`);
    const save = () => updateSettings({ timer: { templates: normalizeTemplates(list) } });
    const paint = () => {
      body.querySelector('.tpl-list').innerHTML = String(html`${list.map((v, i) => html`<div class="row tpl-row" data-i="${i}">
        <button class="tpl-del" data-tdel="${i}" aria-label="${fmtClock(v)} を削除" ${list.length <= 1 ? 'disabled' : ''}><span></span></button>
        <div class="row-body"><div class="row-title num tpl-val">${fmtClock(v)}</div></div>
        <div class="stepper"><button data-tstep="${i}" data-d="-1" aria-label="${step}秒短く">−</button><span class="sep"></span><button data-tstep="${i}" data-d="1" aria-label="${step}秒長く">＋</button></div>
      </div>`)}`);
      const add = body.querySelector('[data-tadd]');
      add.disabled = list.length >= count;
      add.classList.toggle('is-disabled', list.length >= count);
    };
    const stepBy = (btn) => {
      const i = Number(btn.dataset.tstep);
      const next = Math.min(max, Math.max(min, list[i] + Number(btn.dataset.d) * step));
      if (next === list[i]) return false;
      list[i] = next;
      btn.closest('.tpl-row').querySelector('.tpl-val').textContent = fmtClock(next);
      haptic.select();
      save();
      return true;
    };
    // 長押しで連続変更（だんだん速く）
    let rep = 0;
    const stopRepeat = () => {
      clearTimeout(rep);
      rep = 0;
    };
    body.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-tstep]');
      if (!b) return;
      e.preventDefault();
      stopRepeat();
      stepBy(b);
      let delay = 420;
      const again = () => {
        if (!stepBy(b)) return stopRepeat();
        delay = Math.max(45, delay * 0.8);
        rep = setTimeout(again, delay);
      };
      rep = setTimeout(again, delay);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => body.addEventListener(t, stopRepeat));
    body.addEventListener('click', (e) => {
      const st = e.target.closest('[data-tstep]');
      if (st) {
        if (e.detail === 0) stepBy(st); // キーボード操作（ポインターでは pointerdown で処理済み）
        return;
      }
      const del = e.target.closest('[data-tdel]');
      if (del && !del.disabled) {
        haptic.warning();
        list.splice(Number(del.dataset.tdel), 1);
        save();
        paint();
        return;
      }
      if (e.target.closest('[data-tadd]') && list.length < count) {
        haptic.tap();
        let v = Math.min(max, Math.max(...list) + 30);
        while (list.includes(v) && v > min) v -= step;
        list.push(v);
        save();
        paint();
      }
    });
    paint();
    openSheet({
      title: 'タイマーのテンプレート',
      content: body,
      right: html`<button class="nav-btn strong" data-close>完了</button>`,
      onClose: () => {
        stopRepeat();
        save();
      },
    });
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
    // <html data-theme> にも同じ属性があるので、必ずボタンに限定する（限定しないとライト/ダーク時に全タップを横取りする）
    const themeBtn = t.closest('button[data-theme]');
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
        updateSettings({ timer: { notify: true } });
        const ok = await native.askNotifications();
        render();
        if (!ok) toast('通知が許可されていません。Android の「設定 › アプリ › GymMo2 › 通知」でオンにしてください', { kind: 'error', duration: 7000 });
      } else if (k === 'notify' && next) {
        if (typeof Notification === 'undefined') return toast('この端末は通知に対応していません', { kind: 'error' });
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') return toast('通知が許可されませんでした。ブラウザのサイト設定で通知を許可してください', { kind: 'error', duration: 6000 });
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
    if (open === 'parts') return openPartsSheet();
    if (open === 'templates') return openTemplatesSheet();
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
  // 端末の設定アプリで通知を許可して戻ってきたときに表示を更新する
  const onVis = () => document.visibilityState === 'visible' && render();
  document.addEventListener('visibilitychange', onVis);
  render();
  return { el: screen.el, destroy() { offA(); offB(); document.removeEventListener('visibilitychange', onVis); } };
}
