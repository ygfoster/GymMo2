# GymMo2

ワークアウトの記録と、Google ヘルス（Fitbit Air）のコンディションデータを、ひとつの画面で見られる筋トレ記録アプリ（PWA）。
元の [GymMo](https://github.com/ygfoster/GymMo) を Apple の Human Interface Guidelines を手本に作り直したもので、元アプリとは**完全に独立**して動きます（シートも Apps Script も別）。

- 公開先: https://ygfoster.github.io/GymMo2/
- ビルド不要（プレーンな HTML / CSS / ES Modules）。GitHub Pages にそのまま置けます。

## 画面

| タブ | 内容 |
| --- | --- |
| 今日 | 週ストリップ + サマリーリング（カロリー収支・タンパク質・睡眠）、トレーニング、PFC バランス、睡眠、直近 7 日の推移 |
| 履歴 | 月カレンダー（部位ごとの色ドット）、今週/今月/累計、月ごとのワークアウト一覧 |
| ダンベル（中央） | 記録シート。部位チップ → 種目（サジェスト・前回の記録）→ セット入力 → ✓ で休憩タイマー自動開始。セットは左スワイプで削除（取り消し可） |
| 分析 | 期間サマリー、部位別週間セット数、種目一覧、睡眠・カロリー収支・PFC、睡眠と重量の関係 |
| 設定 | 外観、触覚・効果音、休憩タイマー、目標値（既定: タンパク質 140g・睡眠 7 時間）、CSV 書き出し、接続 |

## Android アプリ（通知つきの休憩タイマー）

ブラウザ版では、画面を閉じると休憩終了の検知が遅れ、ほかのアプリを使っている間は残り時間も見えません。
`android/` の Android アプリ版は、休憩タイマーを OS の**通知（カウントダウン表示）と正確なアラーム**で動かすので、画面オフ・アプリ終了中・他のアプリの使用中でも、残り時間の確認と終了の合図ができます。通知から一時停止・+30 秒・リセットも操作できます。詳しくは [android/README.md](android/README.md)。

## 開発

```bash
npm run serve        # http://127.0.0.1:5173 （キャッシュ無効の開発サーバー）
npm test             # ユニットテスト（日付・パース・指標・API・バックエンドの純粋関数）
node scripts/offline-check.mjs   # ヘッドレス Chrome で Service Worker のオフライン起動を検証
```

`http://127.0.0.1:5173/?demo` でデモデータ（合成データ）が使えます。

## 構成

```
index.html / manifest.webmanifest / sw.js
css/      tokens.css（色・タイポ・モーション） base.css components.css screens.css log.css
js/
  main.js router.js store.js api.js timer.js demo-data.js config.js
  lib/    dates parse metrics format html dom storage haptics sound   ← 純粋ロジック（テスト対象）
  ui/     overlay（シート/メニュー/ダイアログ/HUD/トースト） charts tabbar dock calendar ptr icons
  views/  day history analyze settings log exercise welcome
android/  Android アプリ（WebView + ネイティブの休憩タイマー通知）
backend/  Apps Script（clasp 管理）。GymMo2 専用のシートに読み書きし、Google ヘルス API を同期する
tests/    node --test
docs/     DESIGN.md（設計判断・元アプリとの比較）
```

## バックエンド（Apps Script）

`backend/README.md` を参照。要点:

- アプリは Apps Script ウェブアプリに **POST（本文は JSON）** で接続します。パスコードは URL ではなく本文で送ります。
- パスコードとシート ID、OAuth クライアント情報は `backend/src/Config.gs`（**git に含まれません**）にあり、アプリ側のコードには書かれていません。初回起動時に入力したパスコードは、その端末の `localStorage` にだけ保存されます。
- 保存先は GymMo2 専用に複製したシートです。元の GymMo のシートは参照しません。

## ライセンス・フォント

個人利用。フォントは [Inter](https://rsms.me/inter/)（SIL OFL）を Google Fonts から読み込みます。Apple 端末では SF Pro が使われます。
