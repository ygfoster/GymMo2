> **2026-10 に Cloudflare（Workers + D1）へ移行しました。** このディレクトリは旧バックエンドの記録として残しています。
> 今は「移転モード」（`Code.gs` の `MOVED_TO`）で、書き込み・ヘルス取得・毎時の転記を止め、読み取り（bootstrap）だけ応答します。
> 新しいバックエンドは `worker/`、設定は `wrangler.jsonc`。シートには Cloudflare から自動でコピーされます。

# GymMo2 バックエンド（Apps Script）

GymMo2 専用の Apps Script ウェブアプリです。Google スプレッドシート（ワークアウトとヘルスデータ）の読み書きと、Google ヘルス API からの定期同期を担います。

```
backend/
  src/                 ← clasp の rootDir（Apps Script に push されるのはここだけ）
    Code.gs            API（doPost）とシート入出力
    Health.gs          Google ヘルス API v4・OAuth2・1 時間おきの同期
    Lib.gs             純粋関数（Node でテスト: tests/backend.test.mjs）
    Config.gs          ★秘密情報（.gitignore）。Config.example.gs を元に作る
    appsscript.json
  Config.example.gs
  .clasp.example.json
```

## API

すべて `POST`、本文は JSON 文字列（`Content-Type: text/plain` で CORS のプリフライトを回避）。`token` は `Config.gs` の `API_TOKEN` と一致する必要があります。

| action | 引数 | 返り値 |
| --- | --- | --- |
| `ping` | – | `{ ok: true }`（認証確認） |
| `bootstrap` | – | `{ training: [...全行], health: [...全行] }`（シートを読むだけなので高速） |
| `health` | `date: 'YYYY-MM-DD'` | その日を Google ヘルスから取得してシートに転記し、1 行返す |
| `saveDay` | `date`, `rows[]` | その日のワークアウト行を置き換え |
| `deleteDay` | `date` | その日のワークアウト行を削除 |

エラーは `{ ok: false, error, code? }`（認証失敗は `code: 'AUTH'`）。

## 元の GymMo のバックエンドからの変更点

- トークン・OAuth クライアント情報をコードから分離（`Config.gs`、非公開）。URL クエリではなく POST 本文で認証。
- 保存先を `SPREADSHEET_ID` で固定。元のシートの URL へのフォールバックを廃止。
- 起動時に **全期間** のワークアウトを返す（元は最新 60 行のみで、古い記録が履歴・累計から欠けていた）。
- 起動時の Google ヘルス API 呼び出し（最大 18 回/起動）をやめ、日別の `health` に分離。定期同期は 1 時間おきのトリガー。
- 書き込みは文字列として保存（`=` で始まるメモが数式になるのを防止）。長さ制限と入力検証を追加。

## セットアップ（初回のみ）

1. **Cloud Console**: OAuth クライアントの「承認済みのリダイレクト URI」に、`authorize()` のログに出る URI（`https://script.google.com/macros/d/<ScriptID>/usercallback`）を追加。
2. **Apps Script エディタ**で `setup` を実行 → 権限を承認 → ログの URL を開いて Google ヘルスへのアクセスを許可。
3. `clasp push` → `clasp create-deployment`（または既存のデプロイを `clasp redeploy`）。ウェブアプリの URL を `js/config.js` の `apiUrl` に設定。

```bash
cd backend/src
npx clasp login          # 初回のみ
npx clasp push --force
npx clasp create-deployment --description "GymMo2 API v2"
```
