// デモモード用の合成データ（実データではありません）。サーバーが返す生の行と同じ形式で生成するので、
// 本番と同じパース経路を通る。日付は「今日」を基準に毎回組み立てる。
import { addDays, fromKey } from './lib/dates.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLAN = {
  1: { part: '胸', ex: [['ベンチプレス', 72.5, 2.5, 6, 4], ['インクラインダンベルプレス', 22.5, 1.25, 9, 3], ['ダンベルフライ', 12.5, 1.25, 10, 3], ['ディップス', 0, 0, 8, 3]] },
  2: { part: '背中', ex: [['チンニング', 0, 0, 10, 4], ['ラットプルダウン', 50, 2.5, 10, 4], ['シーテッドロウ', 50, 2.5, 10, 3], ['スミスベントロウ', 55, 2.5, 9, 3]] },
  4: { part: '脚', ex: [['スクワット', 90, 2.5, 6, 4], ['レッグプレス', 160, 5, 10, 3], ['ルーマニアンデッドリフト', 80, 2.5, 8, 3], ['レッグカール', 40, 2.5, 12, 3]] },
  5: { part: '肩', ex: [['ショルダープレス', 40, 2.5, 8, 4], ['サイドレイズ', 8, 0.5, 14, 4], ['リアレイズ', 6, 0.5, 14, 3], ['フェイスプル', 25, 2.5, 14, 3]] },
  6: { part: '腕', ex: [['EZバーカール', 25, 1.25, 10, 4], ['ナローベンチプレス', 60, 2.5, 8, 3], ['インクラインカール', 8, 0.5, 10, 3], ['ケーブルプッシュダウン', 30, 2.5, 12, 3]] },
};

const MEMOS = ['フォームを意識。可動域を広く', '最後の1回はきつかった', '調子が良い。次回は重量UP', 'ネガティブをゆっくり', '前回より安定した', '肩の違和感が少しあり、軽めに'];

const workoutDate = (key) => key.replace(/-/g, '/');
const healthDate = (key) => {
  const d = fromKey(key);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};

export function buildDemoRows(today, days = 100) {
  const rand = rng(20261022);
  const gauss = (mean, sd) => mean + sd * (rand() + rand() + rand() - 1.5) * 1.15;
  const training = [];
  const health = [];

  for (let i = days; i >= 0; i--) {
    const key = addDays(today, -i);
    const dow = fromKey(key).getDay();
    const weekIdx = Math.floor((days - i) / 7);
    const plan = PLAN[dow];
    const trained = plan && i > 0 && rand() > 0.14;

    if (trained) {
      for (const [name, base, inc, reps, sets] of plan.ex) {
        const w = base ? Math.round((base + Math.floor(weekIdx / 2) * inc) * 4) / 4 : 0;
        const lines = [];
        for (let s = 0; s < sets; s++) {
          const r = Math.max(3, Math.round(reps - s * (rand() > 0.4 ? 1 : 0) - (rand() > 0.7 ? 1 : 0)) + (s === 0 && rand() > 0.6 ? 1 : 0));
          const wt = w && s === sets - 1 && rand() > 0.55 ? Math.round((w - inc * 2) * 4) / 4 : w;
          lines.push(`${s + 1}セット目: ${wt ? `${wt}kg` : '-'} × ${r}回`);
        }
        training.push({ date: workoutDate(key), part: plan.part, exercise: name, details: lines.join('\n'), memo: rand() > 0.78 ? MEMOS[Math.floor(rand() * MEMOS.length)] : '' });
      }
    }

    // ヘルス
    const isToday = i === 0;
    const skipSleep = rand() < 0.04;
    const skipFood = rand() < 0.08 && !isToday;
    const sleepMin = Math.round(Math.min(540, Math.max(255, gauss(400, 50))));
    const p = Math.round(Math.max(60, gauss(128, 24)));
    const f = Math.round(Math.max(35, gauss(70, 16)));
    const c = Math.round(Math.max(120, gauss(290, 60)));
    const burned = Math.round(gauss(2750, 260) + (trained ? 260 : 0));
    const intake = Math.round(p * 4 + f * 9 + c * 4 + gauss(0, 60));

    if (isToday) {
      health.push({ date: healthDate(key), sleep: `${Math.floor(sleepMin / 60)}時間${sleepMin % 60}分`, protein: '32 g', fat: '14 g', carb: '66 g', intake: '518', burned: '1180' });
    } else {
      health.push({
        date: healthDate(key),
        sleep: skipSleep ? '記録なし' : `${Math.floor(sleepMin / 60)}時間${sleepMin % 60}分`,
        protein: skipFood ? '0 g' : `${p} g`,
        fat: skipFood ? '0 g' : `${f} g`,
        carb: skipFood ? '0 g' : `${c} g`,
        intake: skipFood ? '0' : String(intake),
        burned: String(burned),
      });
    }
  }
  return { training, health };
}
