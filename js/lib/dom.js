// 小さな DOM 差分更新。innerHTML で丸ごと差し替えると要素が作り直されて CSS トランジション
// （スイッチのつまみ、セグメントのサム、入場アニメーション）が途切れるため、同じ構造なら属性とテキストだけ更新する。

function syncAttrs(a, b) {
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
  for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
}

function patchChildren(a, b) {
  const an = [...a.childNodes];
  const bn = [...b.childNodes];
  const n = Math.max(an.length, bn.length);
  for (let i = 0; i < n; i++) {
    const x = an[i];
    const y = bn[i];
    if (!y) {
      x.remove();
      continue;
    }
    if (!x) {
      a.append(y);
      continue;
    }
    if (x.nodeType !== y.nodeType || (x.nodeType === 1 && x.tagName !== y.tagName)) {
      x.replaceWith(y);
      continue;
    }
    if (x.nodeType === 3 || x.nodeType === 8) {
      if (x.data !== y.data) x.data = y.data;
      continue;
    }
    syncAttrs(x, y);
    patchChildren(x, y);
  }
}

/** target の中身を html（文字列）に合わせて差分更新する */
export function morph(target, htmlString) {
  const tpl = document.createElement(target.tagName.toLowerCase() === 'svg' ? 'div' : target.tagName.toLowerCase());
  tpl.innerHTML = String(htmlString);
  patchChildren(target, tpl);
}

/** 新規描画の直後だけ入場アニメーションを許可し、2 回目以降は無効にする */
export function settleRise(root, first) {
  if (!first) root.querySelectorAll('.rise').forEach((el) => el.classList.remove('rise'));
}
