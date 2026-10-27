-- GymMo2 のデータ（以前は Google スプレッドシートが本体だった。今はこちらが本体で、シートには自動でコピーする）

-- ワークアウト: 1 種目 = 1 行（シートの「Workout Data」と同じ列）。seq はその日の中での並び順
CREATE TABLE workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,            -- 'yyyy/MM/dd'
  seq INTEGER NOT NULL,
  part TEXT NOT NULL DEFAULT '',
  exercise TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_workouts_date ON workouts (date, seq);

-- ヘルス: 1 日 1 行（シートの「Health Data」と同じ表示形式の文字列）
CREATE TABLE health (
  date TEXT PRIMARY KEY,         -- 'yyyy/MM/dd'
  sleep TEXT NOT NULL DEFAULT '記録なし',
  protein TEXT NOT NULL DEFAULT '0 g',
  fat TEXT NOT NULL DEFAULT '0 g',
  carb TEXT NOT NULL DEFAULT '0 g',
  intake TEXT NOT NULL DEFAULT '0',
  burned TEXT NOT NULL DEFAULT '0',
  updated_at INTEGER
);

-- 設定・状態（Google の更新用トークン、シートへのコピーの状態など）
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER
);
