// 依存ライブラリなしの SVG チャート。Apple ヘルスケア風: 細いグリッド、右端の軸ラベル、なぞって値を読むスクラブ操作。
import { raw, esc } from '../lib/html.js';
import { haptic } from '../lib/haptics.js';
import { addDays, fromKey, formatShort } from '../lib/dates.js';

const NS = 'http://www.w3.org/2000/svg';

export const dayNum = (key) => {
  const d = fromKey(key);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
};

/* ==========================================================================
   リング（アクティビティリング風）
   ========================================================================== */
/**
 * @param {{size?:number, stroke?:number, gap?:number, rings:Array<{value:number, color:string, label?:string}>}} o
 * value は 0〜（1 で一周）。1 を超えると二周目が重なる。
 */
export function ringsSvg({ size = 156, stroke = 15, gap = 4, rings }) {
  const c = size / 2;
  const parts = rings.map((r, i) => {
    const radius = c - stroke / 2 - i * (stroke + gap);
    const len = 2 * Math.PI * radius;
    const v = Math.max(0, r.value || 0);
    const first = Math.min(v, 1);
    const lap = v > 1 ? v - Math.floor(v) || 1 : 0;
    const arc = (cls, frac, extra = '') =>
      `<circle class="ring-prog ${cls}" cx="${c}" cy="${c}" r="${radius}" fill="none" style="stroke:${r.color}" stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${len.toFixed(2)}" stroke-dashoffset="${len.toFixed(2)}" data-offset="${(len * (1 - frac)).toFixed(2)}" data-delay="${i * 120}"
        transform="rotate(-90 ${c} ${c})" ${frac <= 0.001 ? 'opacity="0"' : ''} ${extra}/>`;
    return `
      <circle cx="${c}" cy="${c}" r="${radius}" fill="none" style="stroke:${r.color}" stroke-opacity="0.18" stroke-width="${stroke}"/>
      ${arc('lap1', first)}
      ${lap > 0 ? arc('lap2', lap) : ''}`;
  });
  return raw(`<svg class="rings" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-hidden="true">${parts.join('')}</svg>`);
}

/** リングの塗りをアニメーションさせる（描画後に呼ぶ） */
export function animateRings(root) {
  const arcs = root.querySelectorAll('.ring-prog');
  arcs.forEach((a) => {
    a.style.transition = 'none';
  });
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      arcs.forEach((a) => {
        a.style.transition = `stroke-dashoffset 1.15s var(--ease-out) ${a.dataset.delay || 0}ms`;
        a.setAttribute('stroke-dashoffset', a.dataset.offset);
        a.style.strokeDashoffset = a.dataset.offset;
      });
    })
  );
}

/* ==========================================================================
   数値ユーティリティ
   ========================================================================== */
export function niceScale(min, max, count = 3) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { lo: 0, hi: 1, ticks: [0, 1] };
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const step0 = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(Number(v.toFixed(10)));
  return { lo, hi, ticks, step };
}

/** 単調 3 次補間（オーバーシュートしない滑らかな折れ線） */
function monotonePath(pts) {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const dx = [];
  const m = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    m.push((pts[i + 1][1] - pts[i][1]) / (dx[i] || 1));
  }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
    } else {
      const a = t[i] / m[i];
      const b = t[i + 1] / m[i];
      const s = a * a + b * b;
      if (s > 9) {
        const k = 3 / Math.sqrt(s);
        t[i] = k * a * m[i];
        t[i + 1] = k * b * m[i];
      }
    }
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${(pts[i][0] + h).toFixed(1)},${(pts[i][1] + t[i] * h).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)},${(pts[i + 1][1] - t[i + 1] * h).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
}

/** from〜to の日付軸ラベル（最大 maxTicks 個） */
export function timeTicks(from, to, maxTicks = 5) {
  const span = dayNum(to) - dayNum(from);
  const ticks = [];
  if (span <= 0) return [{ x: dayNum(from), text: fmtMD(from) }];
  const step = Math.max(1, Math.ceil(span / (maxTicks - 1)));
  for (let i = 0; i <= span; i += step) {
    const key = addDays(from, i);
    ticks.push({ x: dayNum(key), text: fmtMD(key) });
  }
  return ticks;
}
const fmtMD = (k) => {
  const d = fromKey(k);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

const COLOR_ATTRS = new Set(['stroke', 'fill', 'stop-color']);
const el = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    // var(--token) は presentation attribute では効かない環境があるので style 経由で設定する
    if (COLOR_ATTRS.has(k) && String(v).includes('var(')) n.style.setProperty(k, v);
    else n.setAttribute(k, v);
  }
  return n;
};

/* ==========================================================================
   共通: スクラブ用ツールチップ
   ========================================================================== */
function makeTip(container) {
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.innerHTML = '<div class="tip-v"></div><div class="tip-l"></div>';
  container.append(tip);
  return {
    show(x, y, value, label) {
      tip.querySelector('.tip-v').textContent = value;
      tip.querySelector('.tip-l').textContent = label;
      const w = container.clientWidth;
      const tw = tip.offsetWidth || 90;
      tip.style.left = `${Math.min(Math.max(x - tw / 2, 0), w - tw)}px`;
      tip.style.top = `${Math.max(y - tip.offsetHeight - 10, -4)}px`;
      tip.classList.add('on');
    },
    hide() {
      tip.classList.remove('on');
    },
  };
}

/* ==========================================================================
   折れ線チャート
   ========================================================================== */
/**
 * @param {{points:Array<{x:number,y:number|null,label:string}>, color?:string, height?:number,
 *   yFormat?:(v:number)=>string, xTicks?:Array<{x:number,text:string}>, area?:boolean, yMin?:number, yMax?:number,
 *   goal?:{value:number,label?:string}, xDomain?:[number,number]}} opts
 */
export function lineChart(opts) {
  const root = document.createElement('div');
  root.className = 'chart';
  root.style.height = `${opts.height || 180}px`;
  const tip = makeTip(root);
  let o = opts;
  let lastIdx = -1;

  const render = () => {
    root.querySelectorAll('svg').forEach((n) => n.remove());
    const W = root.clientWidth;
    const H = o.height || 180;
    if (!W) return;
    const padL = 4;
    const padR = 38;
    const padT = 14;
    const padB = 24;
    const color = o.color || 'var(--label)';
    const fmtY = o.yFormat || ((v) => String(Math.round(v)));
    const valid = o.points.filter((p) => p.y != null);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' });
    root.prepend(svg);
    if (!valid.length) {
      const t = el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'chart-empty' });
      t.textContent = 'データがありません';
      svg.append(t);
      return;
    }
    let yMin = o.yMin ?? Math.min(...valid.map((p) => p.y));
    let yMax = o.yMax ?? Math.max(...valid.map((p) => p.y));
    if (o.goal) {
      yMin = Math.min(yMin, o.goal.value);
      yMax = Math.max(yMax, o.goal.value);
    }
    const pad = (yMax - yMin) * 0.12 || 1;
    const scale = niceScale(o.yMin ?? yMin - pad, o.yMax ?? yMax + pad, 3);
    const [x0, x1] = o.xDomain || [Math.min(...o.points.map((p) => p.x)), Math.max(...o.points.map((p) => p.x))];
    const sx = (x) => padL + ((x - x0) / (x1 - x0 || 1)) * (W - padL - padR);
    const sy = (y) => padT + (1 - (y - scale.lo) / (scale.hi - scale.lo || 1)) * (H - padT - padB);

    // グリッドと右端の軸ラベル
    scale.ticks.forEach((t) => {
      const y = sy(t);
      svg.append(el('line', { x1: padL, x2: W - padR + 6, y1: y, y2: y, class: 'chart-grid' }));
      const lab = el('text', { x: W - padR + 10, y: y + 4, class: 'chart-axis' });
      lab.textContent = fmtY(t);
      svg.append(lab);
    });
    (o.xTicks || []).forEach((t) => {
      const lab = el('text', { x: sx(t.x), y: H - 6, 'text-anchor': 'middle', class: 'chart-axis' });
      lab.textContent = t.text;
      svg.append(lab);
    });
    if (o.goal) {
      const y = sy(o.goal.value);
      svg.append(el('line', { x1: padL, x2: W - padR + 6, y1: y, y2: y, class: 'chart-goal' }));
    }

    // 欠損で線を分割
    const segs = [];
    let cur = [];
    o.points.forEach((p) => {
      if (p.y == null) {
        if (cur.length) segs.push(cur);
        cur = [];
      } else cur.push([sx(p.x), sy(p.y)]);
    });
    if (cur.length) segs.push(cur);

    const gid = `g${Math.random().toString(36).slice(2, 8)}`;
    const defs = el('defs');
    defs.innerHTML = `<linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:${color}" stop-opacity="0.3"/><stop offset="1" style="stop-color:${color}" stop-opacity="0"/></linearGradient>`;
    svg.append(defs);

    segs.forEach((pts) => {
      if (pts.length > 1) {
        const d = monotonePath(pts);
        if (o.area !== false) {
          const base = H - padB;
          const area = el('path', { d: `${d} L${pts[pts.length - 1][0]},${base} L${pts[0][0]},${base} Z`, fill: `url(#${gid})`, class: 'chart-area' });
          svg.append(area);
        }
        svg.append(el('path', { d, class: 'chart-line', stroke: color, pathLength: 1 }));
      }
    });
    const showDots = valid.length <= 36;
    valid.forEach((p, i) => {
      const last = p === valid[valid.length - 1];
      if (!showDots && !last) return;
      const c = el('circle', { cx: sx(p.x), cy: sy(p.y), r: last ? 5 : 3, fill: last ? color : 'var(--surface)', stroke: color, 'stroke-width': last ? 0 : 1.6, class: 'chart-dot' });
      c.style.animationDelay = `${300 + i * 12}ms`;
      svg.append(c);
    });

    // スクラブ
    const rule = el('line', { class: 'chart-rule', y1: padT - 4, y2: H - padB });
    const mark = el('circle', { r: 6, fill: color, stroke: 'var(--surface)', 'stroke-width': 2.5, class: 'chart-mark' });
    rule.style.opacity = mark.style.opacity = 0;
    svg.append(rule, mark);
    const hit = el('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent', style: 'touch-action:pan-y' });
    svg.append(hit);
    const pick = (clientX) => {
      const r = svg.getBoundingClientRect();
      const x = clientX - r.left;
      let best = 0;
      let bd = Infinity;
      valid.forEach((p, i) => {
        const d = Math.abs(sx(p.x) - x);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      const p = valid[best];
      if (best !== lastIdx) {
        lastIdx = best;
        haptic.select();
      }
      rule.setAttribute('x1', sx(p.x));
      rule.setAttribute('x2', sx(p.x));
      mark.setAttribute('cx', sx(p.x));
      mark.setAttribute('cy', sy(p.y));
      rule.style.opacity = mark.style.opacity = 1;
      tip.show(sx(p.x), sy(p.y), fmtY(p.y), p.label);
    };
    let scrubbing = false;
    hit.addEventListener('pointerdown', (e) => {
      scrubbing = true;
      hit.setPointerCapture(e.pointerId);
      pick(e.clientX);
    });
    hit.addEventListener('pointermove', (e) => scrubbing && pick(e.clientX));
    const stop = () => {
      scrubbing = false;
      lastIdx = -1;
      rule.style.opacity = mark.style.opacity = 0;
      tip.hide();
    };
    hit.addEventListener('pointerup', stop);
    hit.addEventListener('pointercancel', stop);
  };

  const ro = new ResizeObserver(() => render());
  ro.observe(root);
  return {
    el: root,
    update(next) {
      o = { ...o, ...next };
      root.style.height = `${o.height || 180}px`;
      render();
    },
    destroy() {
      ro.disconnect();
    },
  };
}

/* ==========================================================================
   棒グラフ（通常 / 正負 / 積み上げ）
   ========================================================================== */
/**
 * @param {{bars:Array<{key:string, y:number|null, label:string, stack?:Array<{value:number,color:string}>, faded?:boolean}>,
 *   color?:string, height?:number, yFormat?:(v:number)=>string, xLabels?:(bar:object,i:number)=>string|null,
 *   signed?:boolean, goal?:{value:number}, highlight?:string, onSelect?:(bar:object)=>void, negativeColor?:string}} opts
 */
export function barChart(opts) {
  const root = document.createElement('div');
  root.className = 'chart';
  root.style.height = `${opts.height || 160}px`;
  const tip = makeTip(root);
  let o = opts;
  let lastIdx = -1;

  const render = () => {
    root.querySelectorAll('svg').forEach((n) => n.remove());
    const W = root.clientWidth;
    const H = o.height || 160;
    if (!W) return;
    const padL = 2;
    const padR = 38;
    const padT = 12;
    const padB = 22;
    const color = o.color || 'var(--label)';
    const fmtY = o.yFormat || ((v) => String(Math.round(v)));
    const bars = o.bars;
    const totals = bars.map((b) => (b.stack ? b.stack.reduce((s, x) => s + x.value, 0) : b.y));
    const vals = totals.filter((v) => v != null);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' });
    root.prepend(svg);
    if (!vals.length) {
      const t = el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'chart-empty' });
      t.textContent = 'データがありません';
      svg.append(t);
      return;
    }
    let lo = o.signed ? Math.min(0, ...vals) : 0;
    let hi = Math.max(o.goal?.value ?? 0, ...vals, o.signed ? 0 : 1e-9);
    const scale = niceScale(lo, hi * 1.04, 3);
    lo = scale.lo;
    hi = scale.hi;
    const sy = (y) => padT + (1 - (y - lo) / (hi - lo || 1)) * (H - padT - padB);
    const innerW = W - padL - padR;
    const slot = innerW / bars.length;
    const bw = Math.max(2, Math.min(26, slot * 0.62));

    scale.ticks.forEach((t) => {
      const y = sy(t);
      svg.append(el('line', { x1: padL, x2: W - padR + 6, y1: y, y2: y, class: t === 0 && o.signed ? 'chart-zero' : 'chart-grid' }));
      const lab = el('text', { x: W - padR + 10, y: y + 4, class: 'chart-axis' });
      lab.textContent = fmtY(t);
      svg.append(lab);
    });
    if (o.goal) svg.append(el('line', { x1: padL, x2: W - padR + 6, y1: sy(o.goal.value), y2: sy(o.goal.value), class: 'chart-goal' }));

    const groups = [];
    bars.forEach((b, i) => {
      const cx = padL + slot * i + slot / 2;
      const g = el('g', { class: `bar-g ${o.highlight === b.key ? 'hl' : ''}` });
      g.style.animationDelay = `${Math.min(i * 14, 420)}ms`;
      const base = sy(0 > lo ? 0 : lo);
      if (b.stack) {
        let acc = 0;
        b.stack.forEach((s) => {
          if (!s.value) return;
          const y1 = sy(acc + s.value);
          const y0 = sy(acc);
          g.append(el('rect', { x: cx - bw / 2, y: y1, width: bw, height: Math.max(1, y0 - y1), fill: s.color, rx: 1.5 }));
          acc += s.value;
        });
      } else if (b.y != null) {
        const v = b.y;
        const y = sy(v);
        const zero = sy(0);
        const top = Math.min(y, zero);
        const h = Math.max(1.5, Math.abs(zero - y));
        const fill = o.signed && v < 0 ? o.negativeColor || color : color;
        g.append(el('rect', { x: cx - bw / 2, y: top, width: bw, height: h, fill, rx: Math.min(bw / 2, 4), opacity: b.faded ? 0.35 : o.signed && v < 0 ? 0.55 : 1 }));
      }
      svg.append(g);
      groups.push({ cx, b, g });
      const lbl = o.xLabels?.(b, i);
      if (lbl) {
        const t = el('text', { x: cx, y: H - 6, 'text-anchor': 'middle', class: 'chart-axis' });
        t.textContent = lbl;
        svg.append(t);
      }
    });

    const hit = el('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent', style: 'touch-action:pan-y' });
    svg.append(hit);
    const pick = (clientX, commit) => {
      const r = svg.getBoundingClientRect();
      const i = Math.min(bars.length - 1, Math.max(0, Math.floor((clientX - r.left - padL) / slot)));
      const { b, cx } = groups[i];
      if (i !== lastIdx) {
        lastIdx = i;
        haptic.select();
      }
      groups.forEach((x, j) => x.g.classList.toggle('dim', j !== i));
      const total = totals[i];
      if (total != null) tip.show(cx, sy(Math.max(total, 0)), fmtY(total), b.label);
      if (commit) o.onSelect?.(b);
    };
    let down = false;
    hit.addEventListener('pointerdown', (e) => {
      down = true;
      hit.setPointerCapture(e.pointerId);
      pick(e.clientX, true);
    });
    hit.addEventListener('pointermove', (e) => down && pick(e.clientX, true));
    const stop = () => {
      down = false;
      lastIdx = -1;
      groups.forEach((x) => x.g.classList.remove('dim'));
      tip.hide();
    };
    hit.addEventListener('pointerup', stop);
    hit.addEventListener('pointercancel', stop);
  };

  const ro = new ResizeObserver(() => render());
  ro.observe(root);
  return {
    el: root,
    update(next) {
      o = { ...o, ...next };
      root.style.height = `${o.height || 160}px`;
      render();
    },
    destroy() {
      ro.disconnect();
    },
  };
}

/* ==========================================================================
   スパークライン（静的 SVG 文字列）
   ========================================================================== */
export function sparkline(values, { width = 96, height = 32, color = 'var(--label)', stroke = 2 } = {}) {
  const pts = values.map((v, i) => ({ v, i })).filter((p) => p.v != null);
  if (pts.length < 2) return raw(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>`);
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const sx = (i) => 2 + (i / (values.length - 1)) * (width - 4);
  const sy = (v) => 3 + (1 - (v - min) / (max - min || 1)) * (height - 6);
  const d = monotonePath(pts.map((p) => [sx(p.i), sy(p.v)]));
  const last = pts[pts.length - 1];
  return raw(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" aria-hidden="true"><path d="${d}" style="stroke:${esc(color)}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${sx(last.i).toFixed(1)}" cy="${sy(last.v).toFixed(1)}" r="2.6" style="fill:${esc(color)}"/></svg>`
  );
}
