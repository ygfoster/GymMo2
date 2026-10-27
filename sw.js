// 旧住所（GitHub Pages）のサービスワーカーを片付けるためのもの。GymMo2 は https://gymmo2.gymmo2.workers.dev/ へ移転した。
// 以前インストールされたサービスワーカーが更新されると、これに置き換わり、キャッシュを消して自分を登録解除し、
// 開いている画面を再読み込みする（再読み込み後は index.html の転送ページが新しい住所へ移動させる）。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('gymmo2')).map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.navigate(c.url));
    })()
  );
});
