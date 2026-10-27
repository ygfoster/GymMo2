# GymMo2 Android アプリ

Web アプリ（https://gymmo2.gymmo2.workers.dev/ 、Cloudflare）を全画面で表示する Android アプリです。
**ブラウザ版との違いは、休憩タイマーを OS の通知とアラームで動かすこと**だけです。画面は Web アプリそのものなので、Web 側を更新すればアプリの入れ直しは不要です（ネイティブ側を変えたときだけ APK を作り直します）。

## ブラウザ版（PWA）では実現できなかったこと

| 課題 | アプリ版の対応 |
| --- | --- |
| 画面を閉じると休憩終了の検知が最大約 1 分遅れる（Chrome がバックグラウンドの JS を間引くため） | 終了時刻に **AlarmManager の正確なアラーム**を登録。画面オフ・Doze・アプリ終了中でも秒単位で鳴る |
| 他のアプリを使っていても残り時間を見たい | 通知欄に**カウントダウン**を表示（システムが毎秒描画するので、アプリが止まっていても進む）。Android 16 以降は「ライブアップデート」を要求し、対応端末ではステータスバーにも出る |
| 通知から操作したい | 通知のボタン: 一時停止 / 再開 / +30 秒 / リセット（アプリが閉じていても動く） |

## 仕組み

```
Web（js/timer.js）  ──timerSync(JSON)──▶  NativeBridge ─▶ TimerNotifier ─▶ 通知 + AlarmManager
       ▲                                                          │
       └────── pollEvents() / __gymmoNativePoll ◀── TimerState ◀──┘（通知ボタン・アラームで変わった状態）
```

- 状態の形（Web と共通）: `{ status: idle|running|paused|done, endsAt, remainingSec, totalSec, label, logDate, startedAt, updatedAt, notify }`
- どちらかが状態を変えるたびに相手へ送り、**`updatedAt` が新しいほうを採用**します。
- アプリを見ているときに休憩が終わった場合は、通知を出さず Web 側が音と振動で知らせます。バックグラウンドなら通知（音・振動つき）を出します。
- 戻る操作は Web 側のルーターに任せます（`window.__gymmoBack`）。シートやメニューが開いていれば閉じ、タブの先頭ならアプリを背面へ送ります。

## 接続リンク（App Links）

`https://gymmo2.gymmo2.workers.dev/#/connect?k=…` を端末で開くと、ブラウザではなく**このアプリが直接開き**、パスコードを入力せずに接続できます（接続リンク/QR 用）。

- アプリ側: `AndroidManifest.xml` の VIEW フィルターに `android:autoVerify="true"`（新しい住所と、旧住所 `ygfoster.github.io/GymMo2` の転送ページの両方）。
- サイト側: Worker（`worker/src/index.js` の `ASSET_LINKS`）が `/.well-known/assetlinks.json` を返し、パッケージ名と**署名鍵の SHA-256 指紋**を伝える。旧住所の分は `ygfoster/ygfoster.github.io` の assetlinks.json に登録済み。署名鍵を作り直したときは、両方の指紋を更新する。
- 確認: `adb shell pm get-app-links io.github.ygfoster.gymmo2` で `gymmo2.gymmo2.workers.dev: verified` になっていること。
- 1.0.x（旧住所を読み込む版）は、旧住所の転送ページが「アプリの更新が必要です」と案内する。

## ビルド

前提: JDK 17、Android SDK（platform 36 / build-tools）。`local.properties` に `sdk.dir` を書きます（git 管理外）。

```bash
cd android
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
echo "sdk.dir=/opt/homebrew/share/android-commandlinetools" > local.properties
./gradlew assembleDebug      # エミュレーター用（別アプリ io.github.ygfoster.gymmo2.debug として並べて入る）
./gradlew assembleRelease    # 配布用（署名鍵は ../.secrets/keystore.properties。無ければ未署名）
```

APK: `app/build/outputs/apk/{debug,release}/`。

### 署名鍵

- `../.secrets/gymmo2.keystore` と `../.secrets/keystore.properties`（どちらも git 管理外）。
- **なくすと同じアプリとして更新できなくなります。** 別の場所にもバックアップしてください。

## エミュレーターでの検証

```bash
# 開発サーバーを起動（Mac 側）
npm run serve
# debug ビルドをエミュレーターへ入れ、Mac の開発サーバーを読み込ませる（debug ビルドのみ有効）
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell pm grant io.github.ygfoster.gymmo2.debug android.permission.POST_NOTIFICATIONS
adb shell am start -n io.github.ygfoster.gymmo2.debug/io.github.ygfoster.gymmo2.MainActivity --es url "http://10.0.2.2:5173/index.html?demo"
# WebView を DevTools で操作
adb forward tcp:9333 localabstract:webview_devtools_remote_$(adb shell pidof io.github.ygfoster.gymmo2.debug)
node scripts/android-cdp.mjs "(async()=>{const t=await import('/js/timer.js');t.timer.start({seconds:12});})()"
```

通知の確認: `adb shell dumpsys notification --noredact | grep -A30 io.github.ygfoster.gymmo2`

## 権限

| 権限 | 用途 |
| --- | --- |
| `POST_NOTIFICATIONS` | 休憩タイマーの通知（Android 13 以降は初回に許可を求める） |
| `USE_EXACT_ALARM` | 休憩終了を秒単位で鳴らす正確なアラーム（タイマーアプリは自動で許可） |
| `POST_PROMOTED_NOTIFICATIONS` | Android 16 のライブアップデート |
| `VIBRATE` / `INTERNET` | 振動 / Web アプリの読み込み |
