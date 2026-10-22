// エミュレーター/実機の WebView（debug ビルド）に Chrome DevTools Protocol で接続して、ページ内で JS を実行する小さなヘルパー。
//   node scripts/android-cdp.mjs '<JS 式>'
// 事前に: adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
const port = process.env.CDP_PORT || 9333;
const expr = process.argv[2];
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('WebView のページが見つかりません');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
if (r.result?.exceptionDetails) console.log('ERR', r.result.exceptionDetails.exception?.description);
else console.log(JSON.stringify(r.result?.result?.value, null, 2));
ws.close();
