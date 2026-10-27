// D1（SQLite）とのやりとり。表の定義は migrations/ にある。
// 日付はシートと同じ 'yyyy/MM/dd'、ヘルスの値もシートの表示形式（'105 g' など）で持つ。

export async function getMeta(env, key) {
  const row = await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}

export async function setMeta(env, key, value) {
  await env.DB.prepare('INSERT INTO meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, String(value), Date.now())
    .run();
}

export async function deleteMeta(env, key) {
  await env.DB.prepare('DELETE FROM meta WHERE key = ?').bind(key).run();
}

/* ---------- ワークアウト ---------- */
export async function allWorkouts(env) {
  const { results } = await env.DB.prepare('SELECT date, part, exercise, details, memo FROM workouts ORDER BY date, seq, id').all();
  return results;
}

/** その日の行を丸ごと置き換える（1 つのバッチ＝トランザクションで実行） */
export async function replaceDay(env, slashKey, rows) {
  const stmts = [env.DB.prepare('DELETE FROM workouts WHERE date = ?').bind(slashKey)];
  rows.forEach((r, i) => {
    stmts.push(env.DB.prepare('INSERT INTO workouts (date, seq, part, exercise, details, memo) VALUES (?, ?, ?, ?, ?, ?)').bind(slashKey, i, r.part, r.exercise, r.details, r.memo));
  });
  await env.DB.batch(stmts);
}

export async function deleteDay(env, slashKey) {
  const res = await env.DB.prepare('DELETE FROM workouts WHERE date = ?').bind(slashKey).run();
  return res.meta?.changes ?? 0;
}

/** 部位名（または種目名）の一括変更。前後の空白は無視して一致を見る。 */
export async function renameValues(env, field, from, to) {
  const col = field === 'exercise' ? 'exercise' : 'part';
  const marks = from.map(() => '?').join(', ');
  const res = await env.DB.prepare(`UPDATE workouts SET ${col} = ? WHERE trim(${col}) IN (${marks})`).bind(to, ...from).run();
  return res.meta?.changes ?? 0;
}

/* ---------- ヘルス ---------- */
export async function allHealth(env) {
  const { results } = await env.DB.prepare('SELECT date, sleep, protein, fat, carb, intake, burned FROM health ORDER BY date').all();
  return results;
}

export async function getHealth(env, slashKey) {
  return env.DB.prepare('SELECT date, sleep, protein, fat, carb, intake, burned FROM health WHERE date = ?').bind(slashKey).first();
}

export function upsertHealthStmt(env, r) {
  return env.DB.prepare(
    `INSERT INTO health (date, sleep, protein, fat, carb, intake, burned, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET sleep = excluded.sleep, protein = excluded.protein, fat = excluded.fat, carb = excluded.carb,
       intake = excluded.intake, burned = excluded.burned, updated_at = excluded.updated_at`
  ).bind(r.date, r.sleep, r.protein, r.fat, r.carb, r.intake, r.burned, Date.now());
}
