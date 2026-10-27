# GymMo2

ワークアウトの記録と、Google ヘルス（Fitbit Air）のコンディションデータを、ひとつの画面で見られる筋トレ記録アプリ（PWA）。
元の [GymMo](https://github.com/ygfoster/GymMo) を Apple の Human Interface Guidelines を手本に作り直したもので、元アプリとは**完全に独立**して動きます（データもバックエンドも別）。

- 公開先: **https://gymmo2.gymmo2.workers.dev/** （Cloudflare Workers）
- 旧住所 https://ygfoster.github.io/GymMo2/ は新しい住所への転送ページです（リポジトリ直下の `index.html` / `sw.js`）。
- 画面はビルド不要（プレーンな HTML / CSS / ES Modules、`web/`）。API は同じ住所の `/api`（`worker/`）。

## 画面

| タブ | 内容 |
| --- | --- |
| 今日 | 週ストリップ + サマリー（カロリー収支・タンパク質・睡眠を目標線つきの横棒で）、トレーニング、PFC バランス、睡眠、直近 7 日の推移 |
| 履歴 | 月カレンダー（部位ごとの色ドット）、今週/今月/累計、月ごとのワークアウト一覧 |
| ダンベル（中央） | 記録シート。部位チップ → 種目（サジェスト・前回の記録）→ セット入力 → ✓ で休憩タイマー自動開始。セットは左スワイプで削除（取り消し可） |
| 分析 | 期間サマリー、部位別週間セット数、種目一覧、睡眠・カロリー収支・PFC、睡眠と重量の関係 |
| 設定 | 外観、触覚・効果音、休憩タイマー、目標値（既定: タンパク質 140g・睡眠 7 時間）、CSV 書き出し、接続 |

## Android アプリ（通知つきの休憩タイマー）

ブラウザ版では、画面を閉じると休憩終了の検知が遅れ、ほかのアプリを使っている間は残り時間も見えません。
`android/` の Android アプリ版は、休憩タイマーを OS の**通知（カウントダウン表示）と正確なアラーム**で動かすので、画面オフ・アプリ終了中・他のアプリの使用中でも、残り時間の確認と終了の合図ができます。通知から一時停止・+30 秒・リセットも操作できます。詳しくは [android/README.md](android/README.md)。

## 開発

```bash
npm run serve        # http://127.0.0.1:5173 （web/ だけを配信する開発サーバー。?demo でデモデータ）
npx wrangler dev     # http://127.0.0.1:8787 （画面 + API。ローカルの D1 を使う。秘密情報は .dev.vars）
npm test             # ユニットテスト（日付・パース・指標・API・Worker の純粋関数）
node scripts/offline-check.mjs   # ヘッドレス Chrome で Service Worker のオフライン起動を検証
npx wrangler deploy  # 手元から本番（Cloudflare）へ公開（ふだんは不要。下の自動公開を使う）
```

ローカルの D1 を作るときは `npx wrangler d1 migrations apply gymmo2 --local`。

### 公開（GitHub に push すると自動）

`main` に push すると、Cloudflare の **Workers Builds** が自動で公開します（GitHub の Cloudflare Workers and Pages アプリを、このリポジトリだけに許可済み）。

1. 依存関係をインストール（`npm ci`）
2. ビルドコマンド `npm test` — **テストが 1 つでも失敗したら公開しない**
3. 公開コマンド `npx wrangler deploy`

結果は Cloudflare のダッシュボード（Workers & Pages › gymmo2 › Deployments）と、GitHub のコミットのチェック欄で確認できます。
D1 の表定義（`migrations/`）を変えたときだけは、公開の前に手元で `npx wrangler d1 migrations apply gymmo2 --remote` を実行してください（自動公開では実行しません）。

## 構成

```
web/                 画面（Cloudflare が静的ファイルとして配信）
  index.html manifest.webmanifest sw.js
  css/   tokens.css（色・タイポ・モーション） base.css components.css screens.css log.css
  js/    main.js router.js store.js api.js timer.js demo-data.js config.js native.js
    lib/    dates parse metrics format html dom storage haptics sound   ← 純粋ロジック（テスト対象）
    ui/     overlay（シート/メニュー/ダイアログ/HUD/トースト） charts tabbar dock calendar ptr icons
    views/  day history analyze settings log exercise welcome
worker/src/          API（Cloudflare Worker）: index.js（ルーティング・各操作・Cron） db.js（D1） google.js（OAuth・Google ヘルス・シートへのコピー） lib.js（純粋関数）
migrations/          D1 の表定義
wrangler.jsonc       Worker の設定（D1・Cron・静的ファイル）
android/             Android アプリ（WebView + ネイティブの休憩タイマー通知）
index.html sw.js     旧住所（GitHub Pages）からの転送ページと、古いサービスワーカーの片付け
tests/  node --test   docs/  DESIGN.md（設計判断・元アプリとの比較）
```

## バックエンド（Cloudflare Workers + D1）

- **データの本体は D1**（SQLite）。保存・削除・部位名の変更のたびに、GymMo2 専用に複製した Google スプレッドシートへ**自動でコピー**します（アプリ → シートの一方向。シートを手で直してもアプリには戻りません）。元の GymMo のシートは参照しません。
- **Google ヘルス**: 1 時間ごとの Cron（毎時 7 分）で直近 7 日分を取得して保存し、シートにも反映します。アプリで日付を開いたときも、その日の値を取り直します。
- **Google との連携の許可**（初回・許可が切れたとき）: API の `oauthStart` で許可画面の URL を作り、開いて許可します。戻り先は `https://gymmo2.gymmo2.workers.dev/oauth/callback`（Google Cloud Console の OAuth クライアントに登録が必要）。
- **秘密情報**（`API_TOKEN`＝アプリのパスコード、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`）は `wrangler secret put` で Cloudflare に登録してあり、**リポジトリには含まれません**。パスコードは URL ではなく本文で送り、端末では `localStorage` にだけ保存されます。
- 状態の確認: `python3 scripts/api-check.py read`（Google 連携・シートへのコピーの状態も表示）。

## ライセンス・フォント

個人利用。フォントは [Inter](https://rsms.me/inter/)（SIL OFL）を Google Fonts から読み込みます。Apple 端末では SF Pro が使われます。
