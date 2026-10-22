// 自動エスケープ付きのテンプレートタグ。ユーザー入力（種目名・メモ）を安全に innerHTML へ流すための土台。
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class SafeHtml {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

/** エスケープ済みとして扱う文字列（SVG などの固定マークアップ用） */
export const raw = (s) => new SafeHtml(String(s));

function render(v) {
  if (v instanceof SafeHtml) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  if (v === null || v === undefined) return '';
  // aria-pressed="${flag}" のような属性用途のため、真偽値は 'true'/'false' の文字列にする（条件付き表示は三項演算子で書く）
  if (typeof v === 'boolean') return String(v);
  return esc(v);
}

export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new SafeHtml(out);
}

export const toString = render;

/** html`` の結果から DOM 要素（単一ルート）を作る */
export function createEl(safe) {
  const t = document.createElement('template');
  t.innerHTML = render(safe).trim();
  return t.content.firstElementChild;
}

export function setHtml(el, safe) {
  el.innerHTML = render(safe);
  return el;
}
