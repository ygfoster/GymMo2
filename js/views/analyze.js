// 分析タブ: 期間サマリー・部位別週間セット数・種目一覧・睡眠/カロリー/PFC の推移・睡眠とパフォーマンスの関係
import { html, createEl } from '../lib/html.js';
import { icons } from '../ui/icons.js';
import { createScreen, lazyUpdater } from './common.js';
import { state, on, getIndex, partColor, PART_ORDER, sync } from '../store.js';
import { router } from '../router.js';
import { openSheet, closeAllLayers } from '../ui/overlay.js';
import { barChart, sparkline } from '../ui/charts.js';
import {
  periodRange, periodTotals, weeklySetsByPart, healthSeries, mean, pctDelta, sleepVsPerformance, trainingDates,
} from '../lib/metrics.js';
import { todayKey, startOfWeek, formatShort, fromKey } from '../lib/dates.js';
import { fmtInt, fmtSigned, fmtNum, fmtDeltaPct, fmtPct } from '../lib/format.js';
import { formatSleep } from '../lib/parse.js';
import { haptic } from '../lib/haptics.js';
import { settleRise } from '../lib/dom.js';

const PERIODS = [
  { id: '1M', label: '1か月' },
  { id: '3M', label: '3か月' },
  { id: '6M', label: '6か月' },
  { id: 'ALL', label: 'すべて' },
];

const md = (k) => {
  const d = fromKey(k);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/** 長い期間は週平均にまとめて棒が潰れないようにする */
function bucketize(series, pick, days) {
  if (days <= 62) return series.map((s) => ({ key: s.date, y: pick(s), label: formatShort(s.date) }));
  const groups = new Map();
  for (const s of series) {
    const w = startOfWeek(s.date);
    if (!groups.has(w)) groups.set(w, []);
    const v = pick(s);
    if (v != null) groups.get(w).push(v);
  }
  return [...groups.entries()].map(([w, vals]) => ({ key: w, y: vals.length ? mean(vals) : null, label: `${md(w)}〜の週平均` }));
}

const labeler = (n) => {
  const step = Math.max(1, Math.ceil(n / 5));
  return (b, i) => (i % step === 0 ? md(b.key) : null);
};

export function createAnalyzeView() {
  let period = '3M';
  let charts = [];
  let renderedOnce = false;
  const screen = createScreen({ title: '分析', eyebrow: 'トレーニングとコンディション', className: 'analyze', onRefresh: () => sync() });
  const seg = createEl(html`<div class="seg-wrap sticky"><div class="segmented" style="--n:${PERIODS.length};--i:1" role="group" aria-label="期間">
    ${PERIODS.map((x) => html`<button data-period="${x.id}" aria-pressed="${x.id === period}">${x.label}</button>`)}</div></div>`);
  const content = createEl(html`<div class="analyze-content"></div>`);
  screen.body.append(seg, content);

  const mount = (host, chart) => {
    host.append(chart.el);
    charts.push(chart);
  };

  const render = () => {
    charts.forEach((c) => c.destroy());
    charts = [];
    const today = todayKey();
    const index = getIndex();
    const tDates = trainingDates(state.training);
    const hDates = Object.keys(state.health).sort();
    const earliest = [tDates[0], hDates[0]].filter(Boolean).sort()[0];
    const r = periodRange(period, today, earliest);

    if (!state.loaded && !tDates.length) {
      content.innerHTML = '<div class="skeleton" style="height:240px;border-radius:22px;margin-top:14px"></div>';
      return;
    }

    /* --- サマリー --- */
    const cur = periodTotals(state.training, r.from, r.to);
    const prev = periodTotals(state.training, r.prevFrom, r.prevTo);
    const hs = healthSeries(state.health, r.from, r.to, today);
    const hsPrev = healthSeries(state.health, r.prevFrom, r.prevTo, today);
    const avgSleep = mean(hs.map((h) => h.sleepMin).filter((v) => v != null));
    const avgSleepPrev = mean(hsPrev.map((h) => h.sleepMin).filter((v) => v != null));
    const showDelta = period !== 'ALL' && !!earliest && earliest <= r.prevFrom;
    const tile = (label, value, unit, d) => html`<div class="tile">
      <div class="tile-label">${label}</div>
      <div class="tile-value">${value}<span class="unit">${unit}</span></div>
      <div class="tile-delta ${d != null && d > 0 ? 'up' : d != null && d < 0 ? 'down' : ''}">${showDelta && d != null ? `${fmtDeltaPct(d)} 前の期間比` : '　'}</div>
    </div>`;

    /* --- 部位別 週間セット数 --- */
    const weeks = weeklySetsByPart(state.training, r.from, r.to);
    const partsPresent = PART_ORDER.filter((p) => weeks.some((w) => w.parts[p]));

    /* --- 種目 --- */
    const exs = [...index.values()]
      .map((e) => ({ e, sess: e.sessions.filter((s) => s.date >= r.from && s.date <= r.to) }))
      .filter((x) => x.sess.length)
      .sort((a, b) => b.sess.length - a.sess.length || (a.sess.at(-1).date < b.sess.at(-1).date ? 1 : -1));
    const topN = exs.slice(0, 6);

    /* --- コンディション --- */
    const sleepVals = hs.map((h) => h.sleepMin).filter((v) => v != null);
    const balVals = hs.map((h) => h.balance).filter((v) => v != null);
    const macroDays = hs.filter((h) => h.shares);
    const avgShare = macroDays.length
      ? { p: mean(macroDays.map((h) => h.shares.p)), f: mean(macroDays.map((h) => h.shares.f)), c: mean(macroDays.map((h) => h.shares.c)) }
      : null;
    const avgG = macroDays.length ? { p: mean(macroDays.map((h) => h.protein)), f: mean(macroDays.map((h) => h.fat)), c: mean(macroDays.map((h) => h.carb)) } : null;
    const svp = sleepVsPerformance(state.training, state.health, index, r.from, r.to);

    content.innerHTML = String(html`
      <div class="tiles rise" style="--i:0">
        ${tile('ワークアウト', cur.days, '日', pctDelta(cur.days, prev.days))}
        ${tile('総ボリューム', cur.volume >= 100000 ? fmtNum(cur.volume / 1000, 1) : fmtInt(cur.volume), cur.volume >= 100000 ? 't' : 'kg', pctDelta(cur.volume, prev.volume))}
        ${tile('総セット', cur.sets, 'セット', pctDelta(cur.sets, prev.sets))}
        ${tile('平均睡眠', avgSleep != null ? html`${Math.floor(avgSleep / 60)}<span class="unit">時間</span>${Math.round(avgSleep % 60)}<span class="unit">分</span>` : '--', '', pctDelta(avgSleep, avgSleepPrev))}
      </div>

      <section class="section rise" style="--i:1">
        <div class="section-head"><h2 class="section-title">部位別セット数</h2><span class="card-aside">週ごと</span></div>
        <div class="card">
          ${partsPresent.length ? html`<div data-host="parts"></div>
            <div class="legend-row">${partsPresent.map((p) => html`<span class="lg-chip"><i style="background:${partColor(p)}"></i>${p}</span>`)}</div>`
            : html`<div class="empty tight"><div class="s">この期間のトレーニングはありません。</div></div>`}
        </div>
      </section>

      <section class="section rise" style="--i:2">
        <div class="section-head"><h2 class="section-title">種目</h2><button class="link-btn" data-act="all-ex">すべて見る</button></div>
        ${topN.length
          ? html`<div class="group">${topN.map(({ e, sess }) => {
              const rm = sess.filter((s) => s.best1RM > 0).map((s) => s.best1RM);
              const reps = sess.map((s) => s.maxReps);
              const vals = (rm.length >= 2 ? rm : reps).slice(-10);
              const last = sess.at(-1);
              return html`<button class="row ex-row" data-ex="${e.name}">
                <i class="part-bar" style="background:${partColor(e.part)}"></i>
                <div class="row-body"><div class="row-title">${e.name}</div>
                  <div class="row-sub">${sess.length}回 ・ ${last.weighted ? `推定1RM ${fmtNum(last.best1RM)}kg` : `最多 ${last.maxReps}回`}</div></div>
                <div class="spark">${sparkline(vals, { color: partColor(e.part), width: 72, height: 28 })}</div>${icons.rowChevron}
              </button>`;
            })}</div>`
          : html`<div class="card"><div class="empty tight"><div class="s">この期間の種目はありません。</div></div></div>`}
      </section>

      <section class="section rise" style="--i:3">
        <div class="section-head"><h2 class="section-title">睡眠</h2><span class="card-aside">${avgSleep != null ? `平均 ${formatSleep(Math.round(avgSleep))}` : ''}</span></div>
        <div class="card"><div data-host="sleep">${sleepVals.length ? '' : html`<div class="empty tight"><div class="s">睡眠データがありません。</div></div>`}</div></div>
      </section>

      <section class="section rise" style="--i:4">
        <div class="section-head"><h2 class="section-title">カロリー収支</h2><span class="card-aside">${balVals.length ? `平均 ${fmtSigned(mean(balVals))} kcal` : ''}</span></div>
        <div class="card"><div data-host="balance">${balVals.length ? '' : html`<div class="empty tight"><div class="s">食事の記録がある日がありません。</div></div>`}</div>
          ${balVals.length ? html`<p class="card-note">食事が未記録の日は集計に含めていません。</p>` : ''}</div>
      </section>

      <section class="section rise" style="--i:5">
        <div class="section-head"><h2 class="section-title">PFCバランス</h2><span class="card-aside">${macroDays.length ? `${macroDays.length}日の平均` : ''}</span></div>
        <div class="card">
          ${avgShare
            ? html`<div class="pfc-bar"><i style="--w:${(avgShare.p * 100).toFixed(1)}%;background:var(--c-protein)"></i><i style="--w:${(avgShare.f * 100).toFixed(1)}%;background:var(--c-fat)"></i><i style="--w:${(avgShare.c * 100).toFixed(1)}%;background:var(--c-carb)"></i></div>
              <div class="pfc-cols">
                ${[['タンパク質', 'p', 'var(--c-protein)'], ['脂質', 'f', 'var(--c-fat)'], ['炭水化物', 'c', 'var(--c-carb)']].map(([l, k, c]) => html`<div class="pfc-col"><div class="pfc-k"><i style="background:${c}"></i>${l}</div><div class="pfc-v">${fmtInt(avgG[k])}<small>g</small></div><div class="pfc-p">${fmtPct(avgShare[k])}</div></div>`)}
              </div>`
            : html`<div class="empty tight"><div class="s">栄養データがありません。</div></div>`}
        </div>
      </section>

      <section class="section rise" style="--i:6">
        <div class="section-head"><h2 class="section-title">睡眠と重量の関係</h2></div>
        <div class="card">
          ${svp.samples >= 6
            ? html`<div class="svp">${svp.buckets.map((b) => {
                const enough = b.perf != null && b.n >= 3;
                const pct = enough ? (b.perf - 1) * 100 : null;
                const w = enough ? Math.min(100, Math.max(6, b.perf * 50)) : 0;
                return html`<div class="svp-row"><div class="svp-l">${b.label}<small>${b.n}回</small></div>
                  <div class="svp-bar"><i style="--w:${w}%" class="${pct != null && pct < 0 ? 'neg' : ''}"></i><b></b></div>
                  <div class="svp-v ${pct == null ? 'faint' : pct < 0 ? 'down' : 'up'}">${pct != null ? `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%` : '--'}</div></div>`;
              })}</div>
              <p class="card-note">各種目の推定1RMを、その種目の期間平均と比べた値です（${svp.samples}日分）。サンプルが少ないうちは傾向として参考にしてください。</p>`
            : html`<div class="empty tight"><div class="s">睡眠と重量の両方が記録された日が増えると表示されます（現在 ${svp.samples}日 / 6日）。</div></div>`}
        </div>
      </section>`);

    settleRise(content, !renderedOnce);
    renderedOnce = true;

    /* --- チャートを差し込む --- */
    const host = (n) => content.querySelector(`[data-host="${n}"]`);
    if (host('parts') && weeks.length) {
      const lab = labeler(weeks.length);
      mount(host('parts'), barChart({
        height: 170,
        bars: weeks.map((w) => ({ key: w.start, y: w.total, label: `${md(w.start)}〜の週`, stack: partsPresent.map((p) => ({ value: w.parts[p] || 0, color: partColor(p) })) })),
        yFormat: (v) => `${Math.round(v)}`,
        xLabels: lab,
      }));
    }
    if (host('sleep') && sleepVals.length) {
      const bars = bucketize(hs, (h) => (h.sleepMin != null ? h.sleepMin / 60 : null), r.days);
      mount(host('sleep'), barChart({
        height: 160,
        color: 'var(--c-sleep)',
        bars,
        goal: { value: state.settings.goals.sleepMin / 60 },
        yFormat: (v) => `${fmtNum(v, 1)}h`,
        xLabels: labeler(bars.length),
      }));
    }
    if (host('balance') && balVals.length) {
      const bars = bucketize(hs, (h) => h.balance, r.days);
      mount(host('balance'), barChart({
        height: 170,
        color: 'var(--c-move)',
        negativeColor: 'var(--c-move)',
        signed: true,
        bars,
        yFormat: (v) => fmtSigned(v),
        xLabels: labeler(bars.length),
      }));
    }
    requestAnimationFrame(() => content.querySelectorAll('.pfc-bar i, .svp-bar i').forEach((i) => i.classList.add('on')));
  };

  /* --- 操作 --- */
  const openAllExercises = () => {
    const index = getIndex();
    const groups = PART_ORDER.map((p) => ({ p, list: [...index.values()].filter((e) => e.part === p).sort((a, b) => b.sessions.length - a.sessions.length) })).filter((g) => g.list.length);
    const body = createEl(html`<div>
      <div class="search"><span class="search-i">${icons.search}</span><input class="field" type="search" placeholder="種目を検索" aria-label="種目を検索" /></div>
      <div class="all-ex">${groups.map((g) => html`
        <div class="group-h" data-g="${g.p}"><i style="background:${partColor(g.p)}"></i>${g.p}</div>
        <div class="group" data-g="${g.p}">${g.list.map((e) => html`<button class="row" data-ex="${e.name}" data-k="${e.name.toLowerCase()}"><div class="row-body"><div class="row-title">${e.name}</div><div class="row-sub">${e.sessions.length}回 ・ 最終 ${formatShort(e.sessions.at(-1).date)}</div></div>${icons.rowChevron}</button>`)}</div>`)}
        ${groups.length ? '' : html`<div class="empty"><div class="s">記録された種目がありません。</div></div>`}
      </div></div>`);
    const sheet = openSheet({ title: 'すべての種目', tall: true, content: body, right: html`<button class="nav-btn strong" data-close>完了</button>` });
    const input = body.querySelector('input');
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      body.querySelectorAll('.row[data-k]').forEach((r2) => (r2.hidden = !!q && !r2.dataset.k.includes(q)));
      body.querySelectorAll('.group').forEach((g) => {
        const any = [...g.querySelectorAll('.row')].some((r2) => !r2.hidden);
        g.hidden = !any;
        body.querySelector(`.group-h[data-g="${g.dataset.g}"]`).hidden = !any;
      });
    });
    body.addEventListener('click', async (e) => {
      const row = e.target.closest('[data-ex]');
      if (!row) return;
      haptic.tap();
      await closeAllLayers();
      router.navigate(`/exercise/${encodeURIComponent(row.dataset.ex)}`);
    });
  };

  screen.el.addEventListener('click', (e) => {
    const ex = e.target.closest('.ex-row');
    if (ex) {
      haptic.tap();
      router.navigate(`/exercise/${encodeURIComponent(ex.dataset.ex)}`);
      return;
    }
    if (e.target.closest('[data-act="all-ex"]')) openAllExercises();
  });
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-period]');
    if (!b || b.dataset.period === period) return;
    haptic.select();
    period = b.dataset.period;
    const s = seg.querySelector('.segmented');
    s.style.setProperty('--i', PERIODS.findIndex((x) => x.id === period));
    s.querySelectorAll('[data-period]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.period === period)));
    render();
  });

  const stuckCheck = () => {
    const top = screen.navbar.getBoundingClientRect().bottom;
    seg.classList.toggle('stuck', seg.getBoundingClientRect().top <= top + 1 && screen.el.scrollTop > 30);
  };
  screen.el.addEventListener('scroll', stuckCheck, { passive: true });

  const lazy = lazyUpdater(render);
  const off = on('data', lazy.request);
  const offS = on('settings', lazy.request);
  render();
  seg.querySelector('.segmented').style.setProperty('--i', PERIODS.findIndex((x) => x.id === period));
  return {
    el: screen.el,
    onShow: lazy.show,
    onHide: lazy.hide,
    destroy() {
      off();
      offS();
      charts.forEach((c) => c.destroy());
    },
  };
}
