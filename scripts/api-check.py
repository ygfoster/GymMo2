#!/usr/bin/env python3
"""デプロイ済み API の疎通確認。パスコードは .secrets/passcode.txt から読み、出力には出さない。

使い方:
  python3 scripts/api-check.py read              ping → bootstrap → 今日のヘルスデータ
  python3 scripts/api-check.py roundtrip         複製シートに 2000/01/01 のテスト行を書いて、読み戻して、削除
"""
import json
import re
import sys
import urllib.error
import urllib.request

URL = re.search(r"apiUrl:\s*'([^']+)'", open('js/config.js').read()).group(1)
TOKEN = open('.secrets/passcode.txt').read().strip()


def call(action, **payload):
    body = json.dumps({'action': action, 'token': TOKEN, **payload}).encode()
    # -X のような強制はせず、ブラウザと同じ「302 で GET に切り替わる」挙動で呼ぶ
    req = urllib.request.Request(URL, data=body, headers={'Content-Type': 'text/plain;charset=utf-8'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read().decode()
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
    try:
        return json.loads(raw)
    except Exception:
        text = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', raw))[:200]
        return {'ok': False, 'error': 'JSON ではない応答', 'head': text}


def show(label, value):
    print(f'{label}: {json.dumps(value, ensure_ascii=False)}')


def read():
    r = call('ping')
    show('ping', r)
    if not r.get('ok'):
        return 1
    r = call('bootstrap')
    if not r.get('ok'):
        show('bootstrap', r)
        return 1
    print(f"bootstrap: ワークアウト {len(r['training'])} 行 / ヘルス {len(r['health'])} 行")
    show('  ワークアウト先頭', r['training'][:1])
    show('  ヘルス末尾2行', r['health'][-2:])
    from datetime import datetime, timedelta, timezone
    jst = timezone(timedelta(hours=9))
    today = datetime.now(jst).strftime('%Y-%m-%d')
    h = call('health', date=today)
    show(f'health({today})', h)
    return 0 if h.get('ok') else 1


def roundtrip():
    date = '2000-01-01'
    memos = ['=1+1 のような文字列', '+3kg 増えた', '-5 回で失敗', '1/2 のペースで', "'引用符で始まる", '@メンション風', '12', '普通のメモ\n2行目']
    rows = [{'date': '2000/01/01', 'part': '胸', 'exercise': f'接続テスト{i}', 'details': '1セット目: 10kg × 10回', 'memo': m} for i, m in enumerate(memos)]
    r = call('saveDay', date=date, rows=rows)
    show('saveDay', r)
    if not r.get('ok'):
        return 1
    b = call('bootstrap')
    found = {x['exercise']: x for x in b.get('training', []) if x['date'] == '2000/01/01'}
    bad = []
    for i, m in enumerate(memos):
        got = found.get(f'接続テスト{i}', {}).get('memo')
        flag = 'OK' if got == m else 'NG'
        if got != m:
            bad.append(m)
        print(f'  [{flag}] 入力={m!r}  →  読み戻し={got!r}')
    d = call('deleteDay', date=date)
    show('deleteDay', d)
    b2 = call('bootstrap')
    left = [x for x in b2.get('training', []) if x['date'] == '2000/01/01']
    print(f"結果: 文字のまま保存={'OK' if not bad else 'NG'} / 削除={'OK' if not left else 'NG'}")
    return 0 if (not bad and not left) else 1


def dump(path):
    """bootstrap の生レスポンスをファイルに保存する（フロントのパース処理との整合性検証用。リポジトリ外に保存すること）"""
    r = call('bootstrap')
    if not r.get('ok'):
        show('bootstrap', r)
        return 1
    json.dump(r, open(path, 'w'), ensure_ascii=False)
    print(f'保存: {path}')
    return 0


def rename_noop():
    """存在しない部位名の改名（書き換え 0 件）で renameValues の配線と検証だけを確かめる。シートは変わらない。"""
    res = call('renameValues', field='part', **{'from': ['__gymmo2_check_nonexistent__']}, to='__never__')
    show('renameValues(0件のはず)', res)
    bad = call('renameValues', field='date', **{'from': ['x']}, to='y')
    show('renameValues(不正な項目は拒否)', bad)
    return 0 if res.get('ok') and res.get('count') == 0 and not bad.get('ok') else 1


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'read'
    if cmd == 'dump':
        sys.exit(dump(sys.argv[2]))
    if cmd == 'rename-noop':
        sys.exit(rename_noop())
    sys.exit(read() if cmd == 'read' else roundtrip())
