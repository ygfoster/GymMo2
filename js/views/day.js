// 日別ビュー。「今日」タブ（root）と履歴/分析から開く日別詳細（pushed）で共用する。
// 構成: 週ストリップ → サマリーリング → トレーニング → 栄養(PFC) → 睡眠 → 直近 7 日の推移 → 記録ボタン
import { html, createEl } from '../lib/html.js';
import { icons } from '../ui/icons.js';
import { createScreen, partTag, setPill, lazyUpdater } from './common.js';
import { state, on, getIndex, partColor, refreshHealth, deleteDay, hasDraft, sync } from '../store.js';
import { router } from '../router.js';
import {
  todayKey, addDays, weekKeys, fromKey, relativeLabel, formatMD, formatWeekdayLong, WEEKDAYS, diffDays,
} from '../lib/dates.js';
import { dayStats, healthView, sessionOn, mean } from '../lib/metrics.js';
import { fmtInt, fmtSigned, fmtNum, fmtPct } from '../lib/format.js';
import { formatSleep } from '../lib/parse.js';
import { ringsSvg, animateRings, sparkline } from '../ui/charts.js';
import { openMenu, confirmDialog, showHud, toast } from '../ui/overlay.js';
import { openDatePicker } from '../ui/datepicker.js';
import { haptic } from '../lib/haptics.js';
import { settleRise } from '../lib/dom.js';

const titlesFor = (key) => {
  const rel = relativeLabel(key);
  const y = fromKey(key).getFullYear();
  return rel
    ? { title: rel, eyebrow: `${formatMD(key)} ${formatWeekdayLong(key)}` }
    : { title: formatMD(key), eyebrow: `${y}年 ${formatWeekdayLong(key)}` };
};

/** PR の種類を 1 つ選んで表示用テキストにする */
function prInfo(session) {
  if (!session) return null;
  if (session.pr.rm) return `推定1RM ${fmtNum(session.best1RM)}kg`;
  if (session.pr.weight) return `最高重量 ${fmtNum(session.maxWeight)}kg`;
  if (session.pr.reps) return `最多 ${session.maxReps}回`;
  return null;
}

const sleepParts = (min) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return html`<span class="bignum">${h}<small>時間</small>${m ? html`${m}<small>分</small>` : ''}</span>`;
};

export function createDayView({ date, root = false }) {
  let current = date || todayKey();
  const followToday = root && current === todayKey();
  let ringsPlayed = '';
  let slide = 'none';
  let renderedOnce = false;

  const t0 = titlesFor(current);
  const screen = createScreen({
    title: t0.title,
    eyebrow: t0.eyebrow,
    className: 'day',
    onRefresh: () => Promise.all([sync(), state.mode ? refreshHealth(current, { force: true }) : null]),
    left: root ? '' : html`<button class="nav-btn" data-act="back" aria-label="戻る">${icons.chevronLeft}<span>戻る</span></button>`,
    right: html`<button class="nav-btn icon" data-act="calendar" aria-label="日付を選ぶ">${icons.calendar}</button><button class="nav-btn icon" data-act="more" aria-label="その他">${icons.ellipsis}</button>`,
  });
  const strip = createEl(html`<div class="weekstrip"></div>`);
  const content = createEl(html`<div class="day-content"></div>`);
  screen.body.append(strip, content);

  /* ---------- 週ストリップ ---------- */
  const renderStrip = () => {
    const today = todayKey();
    strip.innerHTML = String(html`<div class="ws" role="tablist" aria-label="週">${weekKeys(current).map((k) => {
      const d = fromKey(k);
      const day = state.training[k];
      const marks = day?.exercises.length ? dayStats(day).parts.map(partColor) : [];
      return html`<button class="ws-day ${k === today ? 'today' : ''} ${k > today ? 'future' : ''}" role="tab" aria-selected="${k === current}" data-key="${k}" aria-label="${formatMD(k)}">
        <span class="wd">${WEEKDAYS[d.getDay()]}</span>
        <span class="dn">${d.getDate()}</span>
        <span class="md">${marks.slice(0, 3).map((c) => html`<i style="background:${c}"></i>`)}</span>
      </button>`;
    })}</div>`);
  };

  /* ---------- 各カード ---------- */
  const ringsCard = (hv, key) => {
    const g = state.settings.goals;
    const kcalTarget = g.kcal || hv.burned;
    const calV = hv.hasIntake && kcalTarget ? hv.intake / kcalTarget : 0;
    const pV = hv.protein != null && g.protein ? hv.protein / g.protein : 0;
    const sV = hv.sleepMin != null && g.sleepMin ? hv.sleepMin / g.sleepMin : 0;
    const notes = [];
    if (!hv.hasAny) notes.push('この日のヘルスデータはまだありません。');
    else {
      if (!hv.hasIntake) notes.push('食事が記録されていないため、カロリー収支は表示していません。');
      if (hv.provisional) notes.push('今日の値は暫定です。夜にかけて更新されます。');
    }
    const kcalSub = hv.hasIntake ? `摂取 ${fmtInt(hv.intake)} ・ 消費 ${fmtInt(hv.burned)}` : hv.burned != null ? `消費 ${fmtInt(hv.burned)}` : '';
    return html`
      <section class="card rings-card rise" style="--i:1">
        <div class="rings-wrap">${ringsSvg({ rings: [{ value: calV, color: 'var(--c-move)' }, { value: pV, color: 'var(--c-protein)' }, { value: sV, color: 'var(--c-sleep)' }] })}</div>
        <div class="legend">
          <div class="lg" style="--c:var(--c-move)">
            <div class="lg-k">カロリー収支</div>
            <div class="lg-v">${hv.balance != null ? html`${fmtSigned(hv.balance)}<small>kcal</small>` : html`<span class="faint">--</span>`}</div>
            ${kcalSub ? html`<div class="lg-s">${kcalSub}</div>` : ''}
          </div>
          <div class="lg" style="--c:var(--c-protein)">
            <div class="lg-k">タンパク質</div>
            <div class="lg-v">${hv.protein != null ? html`${fmtInt(hv.protein)}<small>g</small>` : html`<span class="faint">--</span>`}</div>
            <div class="lg-s">目標 ${fmtInt(g.protein)} g</div>
          </div>
          <div class="lg" style="--c:var(--c-sleep)">
            <div class="lg-k">睡眠</div>
            <div class="lg-v">${hv.sleepMin != null ? sleepParts(hv.sleepMin) : html`<span class="faint">--</span>`}</div>
            <div class="lg-s">目標 ${formatSleep(g.sleepMin)}</div>
          </div>
        </div>
        ${notes.length ? html`<p class="card-note">${notes.join(' ')}</p>` : ''}
      </section>`;
  };

  const trainingCard = (key, day) => {
    const index = getIndex();
    if (!day || !day.exercises.length) {
      const future = key > todayKey();
      return html`
        <section class="card rise" style="--i:2">
          <div class="card-head"><div class="card-title">${icons.dumbbell}<span>トレーニング</span></div></div>
          <div class="empty tight">
            ${icons.barbellBig}
            <div class="t">${future ? 'まだ先の日です' : '記録がありません'}</div>
            <div class="s">${future ? '予定をあらかじめ書き留めておくこともできます。' : 'この日のワークアウトを記録しましょう。'}</div>
          </div>
        </section>`;
    }
    const st = dayStats(day);
    const prCount = day.exercises.filter((ex) => prInfo(sessionOn(index, ex.name, key))).length;
    return html`
      <section class="card rise" style="--i:2">
        <div class="card-head">
          <div class="card-title">${icons.dumbbell}<span>トレーニング</span></div>
          <div class="part-tags">${st.parts.map((p) => partTag(p))}</div>
        </div>
        <div class="train-hero">
          <div>
            <div class="bignum xl">${fmtInt(st.volume)}<small>kg</small></div>
            <div class="t-footnote muted">総ボリューム</div>
          </div>
          <div class="train-meta">
            <div><b>${st.exercises}</b><span>種目</span></div>
            <div><b>${st.sets}</b><span>セット</span></div>
            ${prCount ? html`<div class="gold"><b>${prCount}</b><span>PR</span></div>` : ''}
          </div>
        </div>
        <div class="ex-list">${day.exercises.map((ex) => {
          const s = sessionOn(index, ex.name, key);
          const pr = prInfo(s);
          return html`<button class="ex" data-ex="${ex.name}">
            <div class="ex-head">
              <span class="ex-name">${ex.name}</span>
              ${pr ? html`<span class="pr">${icons.star}PR</span>` : ''}
              <span class="spacer"></span>${icons.rowChevron}
            </div>
            ${pr ? html`<div class="ex-pr t-caption">${pr}</div>` : ''}
            ${ex.sets.length ? html`<div class="ex-sets">${ex.sets.map((st2) => setPill(st2))}</div>` : ex.raw ? html`<div class="ex-memo">${ex.raw}</div>` : ''}
            ${ex.memo ? html`<div class="ex-memo">${ex.memo}</div>` : ''}
          </button>`;
        })}</div>
      </section>`;
  };

  const nutritionCard = (hv) => {
    const rows = [
      { k: 'p', label: 'タンパク質', c: 'var(--c-protein)', v: hv.protein },
      { k: 'f', label: '脂質', c: 'var(--c-fat)', v: hv.fat },
      { k: 'c', label: '炭水化物', c: 'var(--c-carb)', v: hv.carb },
    ];
    return html`
      <section class="card rise" style="--i:3">
        <div class="card-head">
          <div class="card-title">${icons.fork}<span>栄養バランス</span></div>
          <div class="card-aside">${hv.intake != null ? `${fmtInt(hv.intake)} kcal` : ''}</div>
        </div>
        ${hv.shares
          ? html`
            <div class="pfc-bar" role="img" aria-label="PFCバランス">
              ${rows.map((r) => html`<i style="--w:${(hv.shares[r.k] * 100).toFixed(2)}%;background:${r.c}"></i>`)}
            </div>
            <div class="pfc-cols">
              ${rows.map((r) => html`
                <div class="pfc-col">
                  <div class="pfc-k"><i style="background:${r.c}"></i>${r.label}</div>
                  <div class="pfc-v">${fmtInt(r.v)}<small>g</small></div>
                  <div class="pfc-p">${fmtPct(hv.shares[r.k])}</div>
                </div>`)}
            </div>
            <p class="card-note">割合は P・C 4kcal／F 9kcal で換算したカロリー比です。</p>`
          : html`<div class="empty tight"><div class="s">この日の栄養データはありません。</div></div>`}
      </section>`;
  };

  const sleepCard = (hv) => {
    const g = state.settings.goals.sleepMin;
    if (hv.sleepMin == null) {
      return html`<section class="card rise" style="--i:4"><div class="card-head"><div class="card-title">${icons.moon}<span>睡眠</span></div></div><div class="empty tight"><div class="s">睡眠が記録されていません。</div></div></section>`;
    }
    const diff = hv.sleepMin - g;
    const ratio = Math.min(1, hv.sleepMin / g);
    const msg = Math.abs(diff) < 5 ? '目標どおりです' : diff > 0 ? `目標より ${formatSleep(diff)} 長く眠れました` : `目標まであと ${formatSleep(-diff)}`;
    return html`
      <section class="card rise" style="--i:4">
        <div class="card-head"><div class="card-title">${icons.moon}<span>睡眠</span></div><div class="card-aside">目標 ${formatSleep(g)}</div></div>
        <div class="sleep-big">${sleepParts(hv.sleepMin)}</div>
        <div class="goal-bar"><i style="--w:${(ratio * 100).toFixed(1)}%"></i></div>
        <p class="card-note">${msg}</p>
      </section>`;
  };

  const trendCard = (key) => {
    const today = todayKey();
    const days = Array.from({ length: 7 }, (_, i) => addDays(key, i - 6));
    const hvs = days.map((d) => healthView(state.health[d], d, today));
    const avg = (arr) => {
      const v = arr.filter((x) => x != null);
      return v.length ? mean(v) : null;
    };
    const bal = hvs.map((h) => h.balance);
    const pro = hvs.map((h) => h.protein);
    const slp = hvs.map((h) => h.sleepMin);
    const tile = (label, color, value, vals) => html`
      <div class="trend">
        <div class="trend-k" style="color:${color}">${label}</div>
        <div class="trend-v">${value}</div>
        <div class="trend-s">${sparkline(vals, { color, width: 92, height: 30 })}</div>
      </div>`;
    const b = avg(bal);
    const p = avg(pro);
    const s = avg(slp);
    return html`
      <section class="section rise" style="--i:5">
        <div class="section-head"><h2 class="section-title">直近7日</h2><span class="card-aside">平均</span></div>
        <div class="trend-grid">
          ${tile('収支', 'var(--c-move)', b != null ? html`${fmtSigned(b)}<small>kcal</small>` : '--', bal)}
          ${tile('タンパク質', 'var(--c-protein)', p != null ? html`${fmtInt(p)}<small>g</small>` : '--', pro)}
          ${tile('睡眠', 'var(--c-sleep)', s != null ? html`${Math.floor(s / 60)}<small>h</small>${Math.round(s % 60)}<small>m</small>` : '--', slp)}
        </div>
      </section>`;
  };

  /* ---------- 全体描画 ---------- */
  const render = ({ animate = false } = {}) => {
    const key = current;
    const t = titlesFor(key);
    screen.setTitle(t.title);
    screen.setEyebrow(t.eyebrow);
    renderStrip();
    const day = state.training[key];
    const hv = healthView(state.health[key], key, todayKey());
    if (!state.loaded && !Object.keys(state.training).length) {
      content.innerHTML = '<div class="skeleton" style="height:196px;border-radius:22px"></div><div class="skeleton" style="height:260px;border-radius:22px;margin-top:14px"></div>';
      return;
    }
    const cta = hasDraft(key) ? '下書きを続ける' : day?.exercises.length ? 'この日の記録を編集' : 'ワークアウトを記録';
    content.innerHTML = String(html`
      <div class="day-stack ${animate ? `slide-${slide}` : ''}">
        ${ringsCard(hv, key)}
        ${trainingCard(key, day)}
        ${nutritionCard(hv)}
        ${sleepCard(hv)}
        ${trendCard(key)}
        <div class="cta rise" style="--i:6"><button class="btn btn-primary btn-block" data-act="log">${icons.dumbbell}${cta}</button></div>
      </div>`);
    settleRise(content, !renderedOnce);
    renderedOnce = true;
    // 同じ日のリングは再描画してもアニメーションをやり直さない
    const stamp = `${key}`;
    const rc = content.querySelector('.rings-wrap');
    if (rc) {
      if (ringsPlayed !== stamp) animateRings(rc);
      else rc.querySelectorAll('.ring-prog').forEach((a) => a.setAttribute('stroke-dashoffset', a.dataset.offset));
    }
    ringsPlayed = stamp;
    requestAnimationFrame(() => content.querySelectorAll('.pfc-bar i, .goal-bar i').forEach((i) => i.classList.add('on')));
  };

  const setDate = (key, how = 'jump') => {
    if (key === current) return;
    slide = how === 'prev' ? 'left' : how === 'next' ? 'right' : 'none';
    current = key;
    if (!root) {
      try {
        history.replaceState({ ...(history.state || {}) }, '', `#/day/${key}`);
      } catch {
        /* 無視 */
      }
    }
    render({ animate: true });
    if (state.mode) refreshHealth(key);
    screen.el.scrollTo({ top: 0 });
  };

  /* ---------- 操作 ---------- */
  const openLog = () => router.navigate(`/log/${current}`);
  const more = (anchor) => {
    const day = state.training[current];
    openMenu(anchor, [
      { label: day?.exercises.length ? '記録を編集' : 'ワークアウトを記録', icon: icons.dumbbell, onSelect: openLog },
      { label: 'ヘルスデータを再取得', icon: icons.refresh, onSelect: async () => { await refreshHealth(current, { force: true }); toast('ヘルスデータを更新しました'); } },
      ...(day?.exercises.length ? [{ sep: true }, { label: 'この日の記録を削除', icon: icons.trash, danger: true, onSelect: confirmDelete }] : []),
    ]);
  };
  const confirmDelete = async () => {
    const ok = await confirmDialog({ title: 'この日の記録を削除しますか？', message: `${formatMD(current)}のトレーニング記録をすべて削除します。`, confirmLabel: '削除', destructive: true });
    if (!ok) return;
    const res = await deleteDay(current);
    showHud(res.synced ? { text: '削除しました' } : { text: '端末から削除', sub: '接続後に同期します', kind: 'offline' });
  };

  screen.el.addEventListener('click', (e) => {
    const k = e.target.closest('.ws-day');
    if (k) {
      haptic.select();
      setDate(k.dataset.key, k.dataset.key > current ? 'next' : 'prev');
      return;
    }
    const ex = e.target.closest('[data-ex]');
    if (ex) {
      haptic.tap();
      router.navigate(`/exercise/${encodeURIComponent(ex.dataset.ex)}`);
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;
    if (a === 'back') router.back();
    else if (a === 'log') openLog();
    else if (a === 'calendar') openDatePicker({ selected: current, onPick: (k2) => setDate(k2, k2 > current ? 'next' : 'prev') });
    else if (a === 'more') more(act);
  });

  // 横スワイプで前後の日へ
  let sx = 0;
  let sy = 0;
  screen.el.addEventListener('touchstart', (e) => {
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
  }, { passive: true });
  screen.el.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    haptic.select();
    setDate(addDays(current, dx < 0 ? 1 : -1), dx < 0 ? 'next' : 'prev');
  }, { passive: true });

  const lazy = lazyUpdater(() => render());
  const offs = [on('data', lazy.request), on('settings', lazy.request)];
  render({ animate: false });

  return {
    el: screen.el,
    get date() {
      return current;
    },
    setDate,
    onShow() {
      // 「今日」タブを開いたまま日付が変わっていたら、新しい今日へ
      if (followToday && current !== todayKey() && current === addDays(todayKey(), -1)) setDate(todayKey(), 'next');
      lazy.show();
      if (state.mode) refreshHealth(current);
    },
    onHide: lazy.hide,
    destroy() {
      offs.forEach((f) => f());
    },
  };
}
