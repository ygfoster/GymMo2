// 種目の詳細: 推定1RM・ボリューム推移、自己ベスト、セッション履歴。
// 画面(push)としても、記録画面から開く履歴シートとしても使う。
import { html, createEl } from '../lib/html.js';
import { icons } from '../ui/icons.js';
import { createScreen, setPill } from './common.js';
import { getIndex, partColor, on } from '../store.js';
import { router } from '../router.js';
import { openSheet } from '../ui/overlay.js';
import { lineChart, barChart, timeTicks, dayNum } from '../ui/charts.js';
import { exerciseKey, personalRecords } from '../lib/metrics.js';
import { todayKey, addDays, formatShort, formatYMD, diffDays } from '../lib/dates.js';
import { fmtInt, fmtNum, fmtDeltaPct } from '../lib/format.js';
import { haptic } from '../lib/haptics.js';

const PERIODS = [
  { id: '1M', label: '1か月', days: 30 },
  { id: '3M', label: '3か月', days: 90 },
  { id: '6M', label: '6か月', days: 180 },
  { id: 'ALL', label: 'すべて', days: null },
];

/** 種目名から詳細コンテンツ（期間切替・グラフ・PR・履歴）を作る */
export function buildExerciseContent(name, { compact = false } = {}) {
  let period = 'ALL';
  const wrap = createEl(html`<div class="exercise-content">
    <div class="seg-wrap"><div class="segmented" style="--n:${PERIODS.length};--i:${PERIODS.length - 1}" role="group" aria-label="期間">
      ${PERIODS.map((x) => html`<button data-period="${x.id}" aria-pressed="${x.id === 'ALL'}">${x.label}</button>`)}
    </div></div>
    <div class="ex-body"></div>
  </div>`);
  const view = wrap.querySelector('.ex-body');
  const seg = wrap.querySelector('.segmented');
  let charts = [];

  const draw = () => {
    charts.forEach((c) => c.destroy());
    charts = [];
    const entry = getIndex().get(exerciseKey(name));
    if (!entry) {
      view.innerHTML = String(html`<div class="empty"><div class="t">記録がありません</div><div class="s">この種目の記録はまだありません。</div></div>`);
      return;
    }
    const today = todayKey();
    const p = PERIODS.find((x) => x.id === period);
    const first = entry.sessions[0].date;
    const from = p.days ? addDays(today, -(p.days - 1)) : first;
    const sessions = entry.sessions.filter((s) => s.date >= from);
    const weighted = entry.sessions.some((s) => s.weighted);
    const pr = personalRecords(entry);

    const metric = (s) => (weighted ? s.best1RM : s.maxReps);
    const volMetric = (s) => (weighted ? s.volume : s.totalReps);
    const latest = sessions.at(-1);
    const startVal = sessions.length ? metric(sessions[0]) : null;
    const delta = latest && startVal ? (metric(latest) - startVal) / startVal : null;

    view.innerHTML = String(html`
      <section class="card rise" style="--i:1">
        <div class="card-head"><div class="card-title">${icons.trendUp}<span>${weighted ? '推定1RM' : '最大回数'}</span></div>
          <div class="card-aside">${delta != null && sessions.length > 1 ? html`<span class="${delta >= 0 ? 'up' : 'down'}">${fmtDeltaPct(delta)}</span>` : ''}</div></div>
        <div class="chart-big"><span class="bignum xl">${latest ? (weighted ? fmtNum(metric(latest)) : metric(latest)) : '--'}<small>${weighted ? 'kg' : '回'}</small></span>
          <span class="t-footnote muted">${latest ? formatShort(latest.date) : ''}</span></div>
        <div data-chart="rm"></div>
        ${weighted ? html`<p class="card-note">Epley式（重量 × (1 + 回数/30)）。回数は12回まで考慮します。</p>` : ''}
      </section>

      <section class="card rise" style="--i:2">
        <div class="card-head"><div class="card-title">${icons.dumbbell}<span>${weighted ? 'ボリューム' : '合計回数'}</span></div><div class="card-aside">${weighted ? 'kg' : '回'}</div></div>
        <div data-chart="vol"></div>
      </section>

      <section class="section rise" style="--i:3">
        <div class="section-head"><h2 class="section-title">自己ベスト</h2></div>
        <div class="tiles">
          ${weighted ? prTile('推定1RM', pr.rm, 'kg', 1) : ''}
          ${weighted ? prTile('最高重量', pr.weight, 'kg', 1) : ''}
          ${prTile('最多回数', pr.reps, '回', 0)}
          ${weighted ? prTile('最大ボリューム', pr.volume, 'kg', 0) : ''}
        </div>
      </section>

      <section class="section rise" style="--i:4">
        <div class="section-head"><h2 class="section-title">履歴</h2><span class="card-aside">${entry.sessions.length}回</span></div>
        <div class="group history-list">${[...entry.sessions].reverse().slice(0, compact ? 30 : 60).map((s) => {
          const prKind = s.pr.rm ? '推定1RM' : s.pr.weight ? '最高重量' : s.pr.reps ? '最多回数' : '';
          return html`<button class="row hist ${compact ? '' : ''}" data-day="${s.date}">
            <div class="row-body">
              <div class="hist-top"><span class="t-subhead">${formatYMD(s.date)}</span>${prKind ? html`<span class="pr">${icons.star}PR</span>` : ''}</div>
              <div class="ex-sets">${s.sets.map((st) => setPill(st))}</div>
              ${s.memo ? html`<div class="ex-memo">${s.memo}</div>` : ''}
            </div>${compact ? '' : icons.rowChevron}
          </button>`;
        })}</div>
      </section>`);

    const mount = (sel, chart) => {
      view.querySelector(sel).append(chart.el);
      charts.push(chart);
    };
    const ticks = timeTicks(from, today > (sessions.at(-1)?.date ?? today) && p.days ? today : sessions.at(-1)?.date || today, 5);
    const domain = [dayNum(from), dayNum(p.days ? today : sessions.at(-1)?.date || today)];
    const color = partColor(entry.part);
    mount('[data-chart="rm"]', lineChart({
      height: 190,
      color,
      xDomain: domain[0] === domain[1] ? [domain[0] - 1, domain[1] + 1] : domain,
      xTicks: ticks,
      yFormat: (v) => (weighted ? fmtNum(v) : String(Math.round(v))),
      points: sessions.map((s) => ({ x: dayNum(s.date), y: Math.round(metric(s) * 10) / 10, label: formatShort(s.date) })),
    }));
    mount('[data-chart="vol"]', barChart({
      height: 160,
      color,
      bars: sessions.map((s) => ({ key: s.date, y: Math.round(volMetric(s)), label: formatShort(s.date) })),
      yFormat: (v) => fmtInt(v),
      xLabels: (b, i) => (sessions.length <= 8 || i % Math.ceil(sessions.length / 5) === 0 ? b.label.replace(/\(.\)/, '') : null),
    }));
  };

  seg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-period]');
    if (!b || b.dataset.period === period) return;
    haptic.select();
    period = b.dataset.period;
    seg.style.setProperty('--i', PERIODS.findIndex((x) => x.id === period));
    seg.querySelectorAll('[data-period]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.period === period)));
    draw();
  });

  const prTile = (label, rec, unit, digits) => html`
    <div class="tile">
      <div class="tile-label">${label}</div>
      <div class="tile-value">${rec ? (digits ? fmtNum(rec.value, digits) : fmtInt(rec.value)) : '--'}<span class="unit">${unit}</span></div>
      <div class="tile-delta">${rec ? formatShort(rec.date) : ''}</div>
    </div>`;

  wrap.addEventListener('click', (e) => {
    const d = e.target.closest('[data-day]');
    if (d && !compact) {
      haptic.tap();
      router.navigate(`/day/${d.dataset.day}`);
    }
  });
  const off = on('data', draw);
  draw();
  return {
    el: wrap,
    destroy() {
      off();
      charts.forEach((c) => c.destroy());
    },
  };
}

/** 種目の詳細画面（push） */
export function createExerciseView({ name }) {
  const entry = getIndex().get(exerciseKey(name));
  const screen = createScreen({
    title: name,
    eyebrow: entry ? `${entry.part}・${entry.sessions.length}回` : '',
    className: 'exercise',
    left: html`<button class="nav-btn" data-act="back">${icons.chevronLeft}<span>戻る</span></button>`,
  });
  const content = buildExerciseContent(name);
  screen.body.append(content.el);
  screen.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="back"]')) router.back();
  });
  return { el: screen.el, destroy: content.destroy };
}

/** 記録画面から開く履歴シート */
export function openExerciseSheet(name) {
  const content = buildExerciseContent(name, { compact: true });
  return openSheet({
    title: name,
    tall: true,
    content: content.el,
    right: html`<button class="nav-btn strong" data-close>完了</button>`,
    onClose: content.destroy,
  });
}
