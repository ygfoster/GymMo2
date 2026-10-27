// 旧バックエンド（Apps Script）の bootstrap の内容を、D1 に流し込む SQL に変換する（移行時に 1 回だけ使う）。
// 使い方: node scripts/migrate-to-d1.mjs <bootstrap.json> <out.sql>
//   bootstrap.json は `python3 scripts/api-check.py dump-legacy <path>` で保存したもの（リポジトリの外に置くこと）
import { readFileSync, writeFileSync } from 'node:fs';
import { normalizeDateKey, normalizeExerciseName, toSheetRow } from '../worker/src/lib.js';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('使い方: node scripts/migrate-to-d1.mjs <bootstrap.json> <out.sql>');
  process.exit(1);
}
const data = JSON.parse(readFileSync(input, 'utf8'));
if (!data.ok) throw new Error('bootstrap の応答が ok ではありません');

const q = (v) => `'${String(v ?? '').replace(/'/g, "''")}'`;
const lines = ['DELETE FROM workouts;', 'DELETE FROM health;'];

// ワークアウト: シートの並び順のまま、日付ごとに seq を振る
const seqByDate = {};
let workouts = 0;
for (const r of data.training || []) {
  const date = normalizeDateKey(r.date);
  if (!date) continue;
  const seq = (seqByDate[date] = (seqByDate[date] ?? -1) + 1);
  lines.push(`INSERT INTO workouts (date, seq, part, exercise, details, memo) VALUES (${q(date)}, ${seq}, ${q(String(r.part ?? '').trim())}, ${q(normalizeExerciseName(r.exercise) || '種目不明')}, ${q(String(r.details ?? '').trim())}, ${q(String(r.memo ?? '').trim())});`);
  workouts += 1;
}

// ヘルス: 1 日 1 行（同じ日付が複数あれば後の行を採用）。シートと同じ表示形式にそろえる
const byDate = new Map();
for (const r of data.health || []) {
  const date = normalizeDateKey(r.date);
  if (date) byDate.set(date, toSheetRow(date, r));
}
const now = Date.now();
for (const r of byDate.values()) {
  lines.push(`INSERT INTO health (date, sleep, protein, fat, carb, intake, burned, updated_at) VALUES (${[r.date, r.sleep, r.protein, r.fat, r.carb, r.intake, r.burned].map(q).join(', ')}, ${now});`);
}

writeFileSync(output, lines.join('\n') + '\n');
console.log(`ワークアウト ${workouts} 行 / ヘルス ${byDate.size} 日分 → ${output}`);
