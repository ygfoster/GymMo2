// backend/src/Config.gs として複製し、値を埋めて使います（Config.gs は .gitignore 済みで、公開されません）。
const CONFIG = {
  // アプリの接続パスコード。推測されにくいランダム文字列にしてください（例: 24文字以上）。
  API_TOKEN: 'CHANGE_ME',
  // Google Cloud Console で作成した OAuth クライアント（Google ヘルス API 用）
  OAUTH_CLIENT_ID: 'xxxxxxxx.apps.googleusercontent.com',
  OAUTH_CLIENT_SECRET: 'GOCSPX-xxxxxxxx',
  // このアプリ専用に複製したスプレッドシートの ID
  SPREADSHEET_ID: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
};
