// 記録画面（モーダルシート）。
// - 部位チップ（前回からの日数つき）→ 種目カード（サジェスト・前回の記録・セット入力）→ 保存
// - セットの✓で休憩タイマーを自動開始（かけ忘れ防止）、回数入力後に未完了なら✓が脈動して催促
// - 入力は下書きとして端末に自動保存。保存時に PR を判定してお祝い表示
import { html, createEl } from '../lib/html.js';
import { icons } from '../ui/icons.js';
import { createDock } from '../ui/dock.js';
import { openMenu, showHud, toast, confirmDialog } from '../ui/overlay.js';
import { openDatePicker } from '../ui/datepicker.js';
import { openExerciseSheet } from './exercise.js';
import { state, on, getIndex, partColor, refreshHealth, saveDay, loadDraft, saveDraft, clearDraft, PART_ORDER } from '../store.js';
import { router } from '../router.js';
import { timer, presetFor } from '../timer.js';
import { haptic } from '../lib/haptics.js';
import { chime } from '../lib/sound.js';
import { unlockAudio } from '../lib/sound.js';
import { todayKey, addDays, diffDays, formatShort, formatWeekdayLong, formatMD, fromKey } from '../lib/dates.js';
import { PARTS, normPart, toNumberOrNull, formatSleep } from '../lib/parse.js';
import { suggestExercises, previousSession, bestBefore, est1RM, healthView, exerciseStats } from '../lib/metrics.js';
import { fmtInt, fmtSigned, fmtNum, fmtClock } from '../lib/format.js';
import { setPill } from './common.js';

const PART_CHIPS = [...PARTS, 'その他'];
const MIN_SETS = 3;
let uidSeq = 0;

const newSet = () => ({ w: '', r: '', done: false });
const newExercise = (n = MIN_SETS) => ({ uid: ++uidSeq, name: '', memo: '', sets: Array.from({ length: n }, newSet) });
const hasData = (s) => String(s.w).trim() !== '' || String(s.r).trim() !== '';

export function createLogView({ date: dateParam }) {
  let date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayKey();
  const form = { part: '', partCustom: '', exercises: [] };
  let draftActive = false;
  let saving = false;
  let draftTimer = 0;

  const root = createEl(html`
    <div class="log-root">
      <div class="sheet-head">
        <div class="l"><button class="nav-btn" data-act="close">閉じる</button></div>
        <div class="t log-title">
          <button class="icon-btn small" data-act="prev" aria-label="前の日">${icons.chevronLeft}</button>
          <button class="log-date" data-act="date" aria-label="日付を選ぶ"></button>
          <button class="icon-btn small" data-act="next" aria-label="次の日">${icons.chevronRight}</button>
        </div>
        <div class="r"><button class="nav-btn strong" data-act="save">保存</button></div>
      </div>
      <div class="sheet-body log-body"></div>
      <div class="log-dock"></div>
    </div>`);
  const body = root.querySelector('.log-body');
  const dateBtn = root.querySelector('.log-date');
  const saveBtn = root.querySelector('[data-act="save"]');
  const dock = createDock({ variant: 'full' });
  root.querySelector('.log-dock').append(dock.el);

  /* ---------- フォーム ⇄ 下書き ---------- */
  const serialize = () => ({
    part: form.part,
    partCustom: form.partCustom,
    exercises: form.exercises.map((e) => ({ name: e.name, memo: e.memo, sets: e.sets.map((s) => ({ w: s.w, r: s.r, done: s.done })) })),
  });

  const scheduleDraft = () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(persistDraft, 350);
  };
  function persistDraft() {
    clearTimeout(draftTimer);
    const empty = !form.part && form.exercises.every((e) => !e.name.trim() && !e.memo.trim() && !e.sets.some(hasData));
    if (empty) {
      clearDraft(date);
      draftActive = false;
    } else {
      saveDraft(date, serialize());
      draftActive = true;
    }
    paintDraftBadge();
  }

  function loadForm() {
    form.part = '';
    form.partCustom = '';
    form.exercises = [];
    draftActive = false;
    const draft = loadDraft(date);
    if (draft) {
      draftActive = true;
      const p = normPart(draft.part);
      form.part = p;
      form.partCustom = draft.partCustom || '';
      form.exercises = (draft.exercises || []).map((e) => ({
        uid: ++uidSeq,
        name: e.name || '',
        memo: e.memo || '',
        sets: padSets((e.sets || []).map((s) => ({ w: String(s.w ?? ''), r: String(s.r ?? ''), done: !!s.done }))),
      }));
    } else {
      const day = state.training[date];
      if (day?.exercises.length) {
        const p = normPart(day.part);
        if (PARTS.includes(p)) form.part = p;
        else if (p) {
          form.part = 'その他';
          form.partCustom = p;
        }
        form.exercises = day.exercises.map((e) => ({
          uid: ++uidSeq,
          name: e.name === '種目不明' ? '' : e.name,
          memo: e.memo || '',
          sets: padSets(e.sets.map((s) => ({ w: s.w != null ? String(s.w) : '', r: s.r != null ? String(s.r) : '', done: true }))),
        }));
      }
    }
    if (!form.exercises.length) form.exercises = [newExercise()];
  }

  const padSets = (sets) => {
    const out = sets.slice();
    while (out.length < MIN_SETS) out.push(newSet());
    return out;
  };

  const partValue = () => (form.part === 'その他' ? form.partCustom.trim() || 'その他' : form.part);

  /* ---------- 描画 ---------- */
  const paintHeader = () => {
    const rel = date === todayKey() ? '今日・' : '';
    dateBtn.textContent = `${rel}${formatShort(date)}`;
  };
  function paintDraftBadge() {
    const note = body.querySelector('.draft-note');
    if (note) note.classList.toggle('on', draftActive);
  }

  const daysSince = (part) => {
    let last = null;
    for (const [d, day] of Object.entries(state.training)) {
      if (d >= date) continue;
      if (!day.exercises.some((e) => (PARTS.includes(normPart(e.part || day.part)) ? normPart(e.part || day.part) : 'その他') === part)) continue;
      if (!last || d > last) last = d;
    }
    return last ? diffDays(date, last) : null;
  };

  const vitalsHtml = () => {
    const hv = healthView(state.health[date], date, todayKey());
    const cell = (label, color, val) => html`<div class="vt"><div class="vt-k" style="color:${color}">${label}</div><div class="vt-v">${val}</div></div>`;
    if (!hv.hasAny && !state.loaded) return html`<div class="skeleton" style="height:76px;border-radius:22px"></div>`;
    return html`<div class="card vitals">
      ${cell('睡眠', 'var(--c-sleep)', hv.sleepMin != null ? html`${Math.floor(hv.sleepMin / 60)}<small>h</small>${Math.round(hv.sleepMin % 60)}<small>m</small>` : html`<span class="faint">--</span>`)}
      ${cell('収支', 'var(--c-move)', hv.balance != null ? html`${fmtSigned(hv.balance)}<small>kcal</small>` : html`<span class="faint">--</span>`)}
      ${cell('タンパク質', 'var(--c-protein)', hv.protein != null ? html`${fmtInt(hv.protein)}<small>g</small>` : html`<span class="faint">--</span>`)}
    </div>`;
  };

  const partChipsHtml = () => html`
    <div class="part-picker">
      <div class="chip-row" role="group" aria-label="トレーニング部位">${PART_CHIPS.map((p) => {
        const since = p === 'その他' ? null : daysSince(p);
        const sub = since == null ? (p === 'その他' ? '' : '—') : since === 0 ? '同日' : `${since}日前`;
        return html`<button class="chip chip-2l" data-part="${p}" aria-pressed="${form.part === p}">
          <span class="chip-main"><i class="dot" style="background:${partColor(p)}"></i>${p}</span>${sub ? html`<span class="chip-sub">${sub}</span>` : ''}
        </button>`;
      })}</div>
      <input class="field part-custom" data-role="part-custom" ${form.part === 'その他' ? '' : 'hidden'} placeholder="部位を入力（例: 胸・三頭筋）" value="${form.partCustom}" enterkeyhint="done" />
    </div>`;

  const setRowHtml = (ex, s, i) => {
    const visible = i === 0 || i < MIN_SETS || hasData(ex.sets[i - 1]) || hasData(s) || s.done;
    return html`<div class="set ${s.done ? 'is-done' : ''}" data-i="${i}" ${visible ? '' : 'hidden'}>
      <span class="set-n">${i + 1}</span>
      <label class="num-in"><input class="in-w" inputmode="decimal" autocomplete="off" placeholder="0" value="${s.w}" aria-label="${i + 1}セット目の重量" /><span class="u">kg</span></label>
      <span class="times">×</span>
      <label class="num-in"><input class="in-r" inputmode="numeric" autocomplete="off" placeholder="0" value="${s.r}" aria-label="${i + 1}セット目の回数" enterkeyhint="done" /><span class="u">回</span></label>
      <button class="set-check" data-act="done" aria-pressed="${s.done}" aria-label="セット完了">${icons.check}</button>
      <span class="set-pr" data-role="pr" hidden><span class="pr pop">${icons.star}PR</span></span>
    </div>`;
  };

  const cardHtml = (ex, idx) => html`
    <section class="xcard rise" data-uid="${ex.uid}" style="--i:${Math.min(idx, 6)}">
      <div class="xhead">
        <div class="xname-wrap">
          <input class="xname" placeholder="種目名" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="next" value="${ex.name}" aria-label="種目名" />
          <div class="suggest" role="listbox" hidden></div>
        </div>
        <button class="icon-btn" data-act="xmenu" aria-label="種目のメニュー">${icons.ellipsis}</button>
      </div>
      <div class="xprev" data-role="prev" hidden></div>
      <div class="sets">
        <div class="set-head"><span></span><span>重量</span><span></span><span>回数</span><span></span></div>
        ${ex.sets.map((s, i) => setRowHtml(ex, s, i))}
      </div>
      <button class="add-set" data-act="addset">${icons.plus}セットを追加</button>
      <textarea class="field memo" rows="1" placeholder="メモ・フォームの意識など" aria-label="メモ">${ex.memo}</textarea>
    </section>`;

  const renderBody = () => {
    body.innerHTML = String(html`
      <div class="log-stack">
        <div class="draft-note" aria-live="polite">${icons.check}<span>入力内容は自動で下書き保存されます</span></div>
        <div class="rise" style="--i:0">${vitalsHtml()}</div>
        <div class="rise" style="--i:1">${partChipsHtml()}</div>
        <div class="xlist">${form.exercises.map((ex, i) => cardHtml(ex, i))}</div>
        <button class="btn btn-tinted btn-block add-ex" data-act="addex">${icons.plus}種目を追加</button>
        <button class="btn btn-primary btn-block save-big" data-act="save">ワークアウトを保存</button>
      </div>`);
    form.exercises.forEach((ex) => {
      refreshPrev(ex.uid);
      refreshPR(ex.uid);
      autosize(cardEl(ex.uid)?.querySelector('.memo'));
      refreshHints(ex.uid);
    });
    paintDraftBadge();
  };

  const cardEl = (uid) => body.querySelector(`.xcard[data-uid="${uid}"]`);
  const exOf = (uid) => form.exercises.find((e) => e.uid === Number(uid));
  const autosize = (ta) => {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(44, ta.scrollHeight)}px`;
  };

  /* ---------- 前回の記録 / PR / ヒント ---------- */
  function refreshPrev(uid) {
    const ex = exOf(uid);
    const holder = cardEl(uid)?.querySelector('[data-role="prev"]');
    if (!ex || !holder) return;
    const prev = ex.name.trim() ? previousSession(getIndex(), ex.name, date) : null;
    if (!prev) {
      holder.hidden = true;
      holder.innerHTML = '';
      return;
    }
    const empty = !ex.sets.some(hasData);
    holder.hidden = false;
    holder.innerHTML = String(html`
      <div class="xprev-l"><span class="t-caption muted">前回 ${formatShort(prev.date)}</span><div class="xprev-sets">${prev.sets.slice(0, 6).map((s) => setPill(s))}</div></div>
      ${empty ? html`<button class="btn btn-tinted btn-sm" data-act="copyprev">${icons.copy}コピー</button>` : ''}`);
  }

  function evalPR(ex) {
    const name = ex.name.trim();
    if (!name) return null;
    const best = bestBefore(getIndex(), name, date);
    if (!best.sessions) return null;
    const sets = ex.sets.map((s) => ({ w: toNumberOrNull(s.w), r: toNumberOrNull(s.r), done: s.done }));
    const weighted = sets.some((s) => s.w);
    let rmIdx = -1;
    let rmVal = 0;
    let wIdx = -1;
    let wVal = 0;
    sets.forEach((s, i) => {
      if (!s.done || !s.r) return;
      if (weighted) {
        const rm = est1RM(s.w || 0, s.r);
        if (rm > rmVal) { rmVal = rm; rmIdx = i; }
        if ((s.w || 0) > wVal) { wVal = s.w; wIdx = i; }
      } else if (s.r > rmVal) {
        rmVal = s.r;
        rmIdx = i;
      }
    });
    if (rmIdx < 0) return null;
    if (weighted) {
      if (best.rm > 0 && rmVal > best.rm + 1e-9) return { idx: rmIdx, kind: '推定1RM' };
      if (best.weight > 0 && wVal > best.weight + 1e-9) return { idx: wIdx, kind: '最高重量' };
      return null;
    }
    return best.reps > 0 && rmVal > best.reps ? { idx: rmIdx, kind: '最多回数' } : null;
  }

  const prShown = new Map();
  function refreshPR(uid, { celebrate = false } = {}) {
    const ex = exOf(uid);
    const card = cardEl(uid);
    if (!ex || !card) return;
    const res = evalPR(ex);
    card.querySelectorAll('.set').forEach((row, i) => {
      const slot = row.querySelector('[data-role="pr"]');
      const show = res && res.idx === i;
      const was = !slot.hidden;
      slot.hidden = !show;
      if (show && !was && celebrate) {
        slot.querySelector('.pr').classList.remove('pop');
        void slot.offsetWidth;
        slot.querySelector('.pr').classList.add('pop');
        haptic.success();
        chime('pr');
        toast(`自己ベスト更新！ ${ex.name}（${res.kind}）`, { kind: 'success' });
      }
    });
    prShown.set(uid, res);
  }

  /** 回数が入っているのに未完了のセットの✓を脈動させる（休憩のかけ忘れ防止） */
  function refreshHints(uid) {
    const card = cardEl(uid);
    const ex = exOf(uid);
    if (!card || !ex) return;
    card.querySelectorAll('.set').forEach((row, i) => {
      const s = ex.sets[i];
      const hint = state.settings.timer.nudge && !s.done && toNumberOrNull(s.r) != null;
      row.querySelector('.set-check').classList.toggle('hint', !!hint);
    });
  }

  /* ---------- 入力イベント ---------- */
  const onInput = (e) => {
    const card = e.target.closest('.xcard');
    if (!card) return;
    const ex = exOf(card.dataset.uid);
    if (!ex) return;
    if (e.target.classList.contains('xname')) {
      ex.name = e.target.value;
      showSuggest(card, ex);
      refreshPrev(ex.uid);
      refreshPR(ex.uid);
    } else if (e.target.classList.contains('memo')) {
      ex.memo = e.target.value;
      autosize(e.target);
    } else if (e.target.classList.contains('in-w') || e.target.classList.contains('in-r')) {
      const row = e.target.closest('.set');
      const s = ex.sets[Number(row.dataset.i)];
      // 小数点は半角ピリオドに揃える
      const v = e.target.value.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[，,]/g, '.').replace('。', '.');
      if (v !== e.target.value) e.target.value = v;
      if (e.target.classList.contains('in-w')) s.w = v;
      else s.r = v;
      revealNextSet(card, ex);
      if (s.done) {
        s.done = false;
        row.classList.remove('is-done');
        row.querySelector('.set-check').setAttribute('aria-pressed', 'false');
      }
      refreshPR(ex.uid);
      refreshHints(ex.uid);
      refreshPrev(ex.uid);
      if (e.target.classList.contains('in-r') && v !== '' && !state.settings.timer.autoStart) timer.nudge();
    } else if (e.target.dataset.role === 'part-custom') {
      form.partCustom = e.target.value;
    }
    scheduleDraft();
  };

  function revealNextSet(card, ex) {
    card.querySelectorAll('.set').forEach((row, i) => {
      const s = ex.sets[i];
      const vis = i === 0 || i < MIN_SETS || hasData(ex.sets[i - 1]) || hasData(s) || s.done;
      row.hidden = !vis;
    });
  }

  function showSuggest(card, ex) {
    const box = card.querySelector('.suggest');
    const list = suggestExercises(getIndex(), ex.name, partValue(), 6);
    if (!list.length || document.activeElement !== card.querySelector('.xname')) {
      box.hidden = true;
      card.classList.remove('is-suggesting');
      return;
    }
    box.innerHTML = String(html`${list.map((s) => html`<button class="sg" role="option" data-name="${s.name}"><i style="background:${partColor(s.part)}"></i><span class="sg-n">${s.name}</span><span class="sg-c">${s.count}回</span></button>`)}`);
    box.hidden = false;
    card.classList.add('is-suggesting');
  }

  body.addEventListener('input', onInput);
  body.addEventListener('focusin', (e) => {
    const card = e.target.closest('.xcard');
    if (e.target.classList.contains('xname') && card) {
      const ex = exOf(card.dataset.uid);
      showSuggest(card, ex);
    }
    if (e.target.matches('input, textarea')) {
      if (e.target.matches('.in-w, .in-r')) setTimeout(() => e.target.select?.(), 0);
      setTimeout(() => e.target.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 300);
    }
  });
  // すでにフォーカス中の入力欄をタップし直したときも候補を出す
  body.addEventListener('click', (e) => {
    if (!e.target.classList.contains('xname')) return;
    const card = e.target.closest('.xcard');
    showSuggest(card, exOf(card.dataset.uid));
  });
  body.addEventListener('focusout', (e) => {
    if (e.target.classList.contains('xname')) {
      const card = e.target.closest('.xcard');
      setTimeout(() => {
        card?.querySelector('.suggest')?.setAttribute('hidden', '');
        card?.classList.remove('is-suggesting');
      }, 120);
    }
  });
  body.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const card = e.target.closest('.xcard');
    if (!card) return;
    if (e.target.classList.contains('xname')) {
      e.preventDefault();
      card.querySelector('.in-w')?.focus();
    } else if (e.target.classList.contains('in-w')) {
      e.preventDefault();
      e.target.closest('.set').querySelector('.in-r').focus();
    } else if (e.target.classList.contains('in-r')) {
      e.preventDefault();
      const row = e.target.closest('.set');
      completeSet(card, Number(row.dataset.i), true);
    }
  });

  /* ---------- セット完了 ---------- */
  function completeSet(card, i, moveNext = false) {
    const ex = exOf(card.dataset.uid);
    const s = ex.sets[i];
    const row = card.querySelectorAll('.set')[i];
    if (toNumberOrNull(s.r) == null) {
      haptic.error();
      row.classList.remove('shake');
      void row.offsetWidth;
      row.classList.add('shake');
      row.querySelector('.in-r').focus();
      return;
    }
    unlockAudio();
    s.done = true;
    row.classList.add('is-done');
    row.querySelector('.set-check').setAttribute('aria-pressed', 'true');
    row.querySelector('.set-check').classList.add('burst');
    setTimeout(() => row.querySelector('.set-check').classList.remove('burst'), 700);
    haptic.impact();
    if (state.settings.timer.autoStart) {
      timer.context({ logDate: date, part: partValue() || null });
      timer.start({ seconds: presetFor(form.part === 'その他' ? 'その他' : form.part) });
    }
    refreshPR(ex.uid, { celebrate: true });
    refreshHints(ex.uid);
    scheduleDraft();
    if (moveNext) {
      if (i + 1 >= ex.sets.length) {
        ex.sets.push(newSet());
        replaceCard(ex.uid, { focusSet: i + 1 });
      } else {
        const next = card.querySelectorAll('.set')[i + 1];
        revealNextSet(card, ex);
        next.hidden = false;
        next.querySelector('.in-w').focus();
      }
    }
  }

  function toggleSet(card, i) {
    const ex = exOf(card.dataset.uid);
    const s = ex.sets[i];
    if (s.done) {
      s.done = false;
      const row = card.querySelectorAll('.set')[i];
      row.classList.remove('is-done');
      row.querySelector('.set-check').setAttribute('aria-pressed', 'false');
      haptic.tap();
      refreshPR(ex.uid);
      refreshHints(ex.uid);
      scheduleDraft();
    } else completeSet(card, i);
  }

  function replaceCard(uid, { focusSet = -1 } = {}) {
    const ex = exOf(uid);
    const old = cardEl(uid);
    if (!ex || !old) return;
    const fresh = createEl(cardHtml(ex, 0));
    fresh.classList.remove('rise');
    old.replaceWith(fresh);
    refreshPrev(uid);
    refreshPR(uid);
    refreshHints(uid);
    autosize(fresh.querySelector('.memo'));
    if (focusSet >= 0) fresh.querySelectorAll('.set')[focusSet]?.querySelector('.in-w')?.focus();
  }

  /* ---------- クリック ---------- */
  body.addEventListener('pointerdown', (e) => {
    const sg = e.target.closest('.sg');
    if (!sg) return;
    e.preventDefault();
    const card = sg.closest('.xcard');
    const ex = exOf(card.dataset.uid);
    ex.name = sg.dataset.name;
    card.querySelector('.xname').value = ex.name;
    card.querySelector('.suggest').hidden = true;
    card.classList.remove('is-suggesting');
    haptic.select();
    refreshPrev(ex.uid);
    refreshPR(ex.uid);
    scheduleDraft();
    card.querySelector('.in-w')?.focus();
  });

  root.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-part]');
    if (chip) {
      haptic.select();
      form.part = form.part === chip.dataset.part ? '' : chip.dataset.part;
      body.querySelectorAll('[data-part]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.part === form.part)));
      const custom = body.querySelector('[data-role="part-custom"]');
      custom.hidden = form.part !== 'その他';
      if (!custom.hidden) custom.focus();
      timer.context({ part: partValue() || null });
      scheduleDraft();
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const card = btn.closest('.xcard');
    if (act === 'close') router.back();
    else if (act === 'save') save();
    else if (act === 'date') {
      persistDraft();
      openDatePicker({ selected: date, onPick: (k) => switchDate(k) });
    } else if (act === 'prev') switchDate(addDays(date, -1));
    else if (act === 'next') switchDate(addDays(date, 1));
    else if (act === 'addex') {
      haptic.tap();
      form.exercises.push(newExercise());
      const el = createEl(cardHtml(form.exercises.at(-1), 0));
      body.querySelector('.xlist').append(el);
      el.querySelector('.xname').focus();
      scheduleDraft();
    } else if (act === 'addset') {
      const ex = exOf(card.dataset.uid);
      haptic.tap();
      ex.sets.push(newSet());
      replaceCard(ex.uid, { focusSet: ex.sets.length - 1 });
      scheduleDraft();
    } else if (act === 'done') {
      toggleSet(card, Number(btn.closest('.set').dataset.i));
    } else if (act === 'copyprev') {
      const ex = exOf(card.dataset.uid);
      const prev = previousSession(getIndex(), ex.name, date);
      if (!prev) return;
      haptic.tap();
      ex.sets = padSets(prev.sets.map((s) => ({ w: s.w != null ? String(s.w) : '', r: s.r != null ? String(s.r) : '', done: false })));
      replaceCard(ex.uid);
      scheduleDraft();
    } else if (act === 'xmenu') {
      const ex = exOf(card.dataset.uid);
      openMenu(btn, [
        { label: '履歴を見る', icon: icons.history, onSelect: () => (ex.name.trim() ? openExerciseSheet(ex.name.trim()) : toast('種目名を入力してください', { kind: 'error' })) },
        ...(ex.sets.length > MIN_SETS || ex.sets.some(hasData) ? [{ label: 'セットをすべてクリア', icon: icons.resetArrow, onSelect: () => { ex.sets = padSets([]); replaceCard(ex.uid); scheduleDraft(); } }] : []),
        { sep: true },
        { label: 'この種目を削除', icon: icons.trash, danger: true, onSelect: () => removeExercise(ex.uid) },
      ]);
    }
  });

  function removeExercise(uid) {
    haptic.warning();
    const el = cardEl(uid);
    form.exercises = form.exercises.filter((e) => e.uid !== uid);
    if (!form.exercises.length) form.exercises = [newExercise()];
    el.style.transition = 'opacity .22s, transform .22s var(--ease-out)';
    el.style.opacity = '0';
    el.style.transform = 'scale(.96)';
    setTimeout(() => {
      if (!form.exercises.some((e) => cardEl(e.uid))) renderBody();
      else el.remove();
    }, 220);
    scheduleDraft();
  }

  /* ---------- 日付の切替 ---------- */
  function switchDate(next) {
    if (next === date) return;
    persistDraft();
    date = next;
    try {
      history.replaceState({ ...(history.state || {}) }, '', `#/log/${date}`);
    } catch {
      /* 無視 */
    }
    loadForm();
    paintHeader();
    renderBody();
    body.scrollTo({ top: 0 });
    timer.context({ logDate: date, part: partValue() || null });
    if (state.mode) refreshHealth(date);
  }

  /* ---------- 保存 ---------- */
  async function save() {
    if (saving) return;
    const filled = form.exercises.filter((e) => e.name.trim() || e.sets.some(hasData) || e.memo.trim());
    if (!filled.length) {
      haptic.error();
      toast('種目またはセットを入力してください', { kind: 'error' });
      return;
    }
    if (!partValue()) {
      haptic.error();
      const pk = body.querySelector('.part-picker');
      pk.classList.remove('shake');
      void pk.offsetWidth;
      pk.classList.add('shake');
      pk.scrollIntoView({ block: 'center', behavior: 'smooth' });
      toast('トレーニング部位を選んでください', { kind: 'error' });
      return;
    }
    saving = true;
    saveBtn.disabled = true;
    const prCount = filled.filter((e) => {
      const r = evalPR({ ...e, sets: e.sets.map((s) => ({ ...s, done: hasData(s) })) });
      return !!r;
    }).length;
    const total = timer.snapshot();
    const day = {
      date,
      part: partValue(),
      exercises: filled.map((e) => ({
        name: e.name,
        memo: e.memo,
        sets: e.sets.map((s) => ({ w: toNumberOrNull(s.w), r: toNumberOrNull(s.r) })).filter((s) => s.w != null || s.r != null),
      })),
    };
    const res = await saveDay(day);
    clearDraft(date);
    draftActive = false;
    const subParts = [];
    if (prCount) subParts.push(`自己ベスト ${prCount}件`);
    if (date === todayKey() && total.started) subParts.push(`合計 ${fmtClock(total.workoutSec)}`);
    showHud(res.synced ? { text: '保存しました', sub: subParts.join(' ・ ') } : { text: '端末に保存しました', sub: '接続後に自動で同期します', kind: 'offline' });
    if (date === todayKey() && total.started) timer.endWorkout();
    saving = false;
    router.back();
  }

  /* ---------- キーボード表示時にドックをコンパクト化 ---------- */
  let baseH = window.innerHeight;
  const onResize = () => {
    baseH = Math.max(baseH, window.innerHeight);
    const kbd = window.innerHeight < baseH - 140 || (window.visualViewport && window.visualViewport.height < baseH - 140);
    root.classList.toggle('kbd', !!kbd);
  };
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);

  const offData = on('data', () => {
    // 他端末からの同期で記録が変わっても、入力中のフォームは触らない。ヘルス値と前回の記録だけ更新する。
    const vit = body.querySelector('.vitals')?.parentElement;
    if (vit) vit.innerHTML = String(vitalsHtml());
    form.exercises.forEach((e) => refreshPrev(e.uid));
  });

  loadForm();
  paintHeader();
  renderBody();
  timer.context({ logDate: date, part: partValue() || null });
  if (state.mode) refreshHealth(date);
  unlockAudio();

  return {
    el: root,
    onShow() {
      if (!form.exercises.some((e) => e.name.trim())) setTimeout(() => body.querySelector('.xname')?.focus({ preventScroll: true }), 650);
    },
    onHide() {
      persistDraft();
    },
    destroy() {
      persistDraft();
      offData();
      dock.destroy();
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    },
  };
}
