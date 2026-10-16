#!/usr/bin/env python3
"""讀取「資料庫」資料夾中的三個 Excel，產生網頁用的資料檔 系統/data.js。

只用 Python 內建模組，不需安裝任何套件。
用法：在網站根目錄執行  python3 系統/build.py
"""
import datetime
import json
import math
import os
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile

# ---------- 設定 ----------
SHOW_ELDER_NAME = False      # 是否在網頁上顯示耆老姓名
# 不顯示在網頁上的欄位（「完整欄位」中以「不公開」表示）；欄位名稱以開頭比對
PRIVATE_FIELDS = ('耆老姓名', '耆老生日', '住址', '受訪同意書')
ROW = '\x00row'               # 記錄每筆資料在 Excel 中的列號
THUMB_SIZE = 480             # 縮圖長邊（像素）
SPLIT = re.compile(r'[、,，;；/\n]+')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SYS = os.path.join(ROOT, '系統')
DB_DIR = os.path.join(ROOT, '資料庫')
MEDIA_DIRS = ['照片', '錄音', '文件']
THUMB_DIR = os.path.join(SYS, '縮圖')

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

report = []


def warn(msg):
    report.append(msg)


# ---------- Excel ----------
def col_index(ref):
    letters = re.match(r'[A-Z]+', ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n - 1


def read_xlsx(path):
    """回傳第一個工作表的 [ {標題: 值} ]。"""
    z = zipfile.ZipFile(path)
    names = z.namelist()
    shared = []
    if 'xl/sharedStrings.xml' in names:
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
            shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    first = wb.find('m:sheets', NS)[0]
    rid = first.get('{%s}id' % NS['r'])
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    target = next(r.get('Target') for r in rels if r.get('Id') == rid)
    target = target.lstrip('/')
    sheet_path = target if target.startswith('xl/') else 'xl/' + target
    rows = []
    for row in ET.fromstring(z.read(sheet_path)).iter('{%s}row' % NS['m']):
        cells = {}
        for c in row.findall('m:c', NS):
            t, v = c.get('t'), c.find('m:v', NS)
            if t == 's' and v is not None:
                val = shared[int(v.text)]
            elif t == 'inlineStr':
                val = ''.join(x.text or '' for x in c.iter('{%s}t' % NS['m']))
            else:
                val = v.text if v is not None else ''
            cells[col_index(c.get('r'))] = (val or '').strip()
        rows.append((row.get('r'), cells))
    if not rows:
        return []
    header = {i: h for i, h in sorted(rows[0][1].items()) if h}
    out = []
    for rno, cells in rows[1:]:
        rec = {header[i]: cells.get(i, '') for i in header}
        if any(rec.values()):
            rec[ROW] = int(rno) if rno and rno.isdigit() else None
            out.append(rec)
    return out


def fmt_value(v):
    """浮點數去掉多餘的位數（例：120.48030300000001 → 120.480303）。"""
    if re.fullmatch(r'-?\d+\.\d{8,}', v or ''):
        return ('%.7f' % float(v)).rstrip('0').rstrip('.')
    if re.fullmatch(r'-?\d+\.0+', v or ''):
        return v.split('.')[0]
    return v


def raw_of(rec, source):
    """保留 Excel 原始欄位（依欄位順序），供網頁「完整欄位」區塊顯示。"""
    private = tuple(f for f in PRIVATE_FIELDS if not (SHOW_ELDER_NAME and f == '耆老姓名'))
    fields = []
    for k, v in rec.items():
        if k == ROW:
            continue
        fields.append([k, None if k.startswith(private) else fmt_value(v)])
    return {'src': source, 'row': rec.get(ROW), 'fields': fields}


def pick(rec, *candidates):
    for c in candidates:
        if c in rec:
            return rec[c]
    for c in candidates:
        for k in rec:
            if k.startswith(c):
                return rec[k]
    return ''


def norm_id(v):
    v = (v or '').strip()
    if re.fullmatch(r'\d+\.0+', v):
        v = v.split('.')[0]
    return v


def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def year_month(v):
    if re.fullmatch(r'\d{4,5}(\.\d+)?', v or '') and 10000 < float(v) < 80000:
        d = datetime.date(1899, 12, 30) + datetime.timedelta(days=float(v))
        return d.strftime('%Y-%m')
    return v


def split_list(v):
    return [s.strip() for s in SPLIT.split(v or '') if s.strip()]


def find_db(keyword):
    for f in sorted(os.listdir(DB_DIR)):
        if keyword in f and f.lower().endswith('.xlsx') and not f.startswith('~$'):
            return os.path.join(DB_DIR, f)
    warn(f'找不到檔名含「{keyword}」的 Excel')
    return None


# ---------- 媒體檔 ----------
media_index = {}


def index_media():
    for d in MEDIA_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dirpath, _, files in os.walk(base):
            for f in files:
                if f.startswith('.'):
                    continue
                rel = os.path.relpath(os.path.join(dirpath, f), ROOT).replace(os.sep, '/')
                media_index.setdefault(f.lower(), rel)
                media_index.setdefault(os.path.splitext(f)[0].lower(), rel)


HAS_SIPS = shutil.which('sips') is not None
HAS_AFINFO = shutil.which('afinfo') is not None
HAS_FFPROBE = shutil.which('ffprobe') is not None


def audio_seconds(rel):
    """讀取錄音長度（秒）。Mac 用內建 afinfo；有安裝 ffprobe 也可；都沒有則略過。"""
    path = os.path.join(ROOT, rel)
    try:
        if HAS_AFINFO:
            out = subprocess.run(['afinfo', path], capture_output=True, text=True).stdout
            m = re.search(r'estimated duration:\s*([\d.]+)', out)
            if m:
                return round(float(m.group(1)))
        if HAS_FFPROBE:
            out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                                  '-of', 'default=nw=1:nk=1', path], capture_output=True, text=True).stdout
            return round(float(out.strip()))
    except Exception:  # noqa: BLE001
        pass
    return None


def thumb(rel):
    src = os.path.join(ROOT, rel)
    name = re.sub(r'[\\/]', '_', rel)
    name = os.path.splitext(name)[0] + '.jpg'
    dst = os.path.join(THUMB_DIR, name)
    if not HAS_SIPS:
        return rel
    if not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(src):
        os.makedirs(THUMB_DIR, exist_ok=True)
        r = subprocess.run(['sips', '-Z', str(THUMB_SIZE), '-s', 'format', 'jpeg', src, '--out', dst],
                           capture_output=True)
        if r.returncode != 0:
            return rel
    return '系統/縮圖/' + name


def read_doc_text(rel):
    path = os.path.join(ROOT, rel)
    ext = os.path.splitext(rel)[1].lower()
    try:
        if ext == '.docx':
            body = ET.fromstring(zipfile.ZipFile(path).read('word/document.xml'))
            paras = []
            for p in body.iter(W + 'p'):
                buf = []
                for el in p.iter():
                    if el.tag == W + 't':
                        buf.append(el.text or '')
                    elif el.tag == W + 'tab':
                        buf.append('\t')
                    elif el.tag in (W + 'br', W + 'cr'):
                        buf.append('\n')
                paras.append(''.join(buf))
            return paras
        if ext == '.txt':
            with open(path, encoding='utf-8', errors='replace') as f:
                return f.read().splitlines()
    except Exception as e:  # noqa: BLE001
        warn(f'無法讀取文字檔 {rel}：{e}')
    return None


def media(name, kind, owner):
    rel = media_index.get(name.lower()) or media_index.get(os.path.splitext(name)[0].lower())
    if not rel:
        warn(f'{owner}：找不到檔案「{name}」')
        return {'name': name, 'missing': True}
    item = {'name': name, 'src': rel, 'size': os.path.getsize(os.path.join(ROOT, rel))}
    if kind == 'photo':
        item['thumb'] = thumb(rel)
    elif kind == 'audio':
        sec = audio_seconds(rel)
        if sec is not None:
            item['sec'] = sec
    elif kind == 'doc':
        text = read_doc_text(rel)
        if text is not None:
            item['text'] = text
    return item


# ---------- 距離 ----------
def dist_m(a, b):
    if None in (a.get('lat'), a.get('lng'), b.get('lat'), b.get('lng')):
        return None
    R = 6371000
    p1, p2 = math.radians(a['lat']), math.radians(b['lat'])
    dp, dl = p2 - p1, math.radians(b['lng'] - a['lng'])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return round(2 * R * math.asin(math.sqrt(h)))


# ---------- 主程式 ----------
def main():
    index_media()
    places, sites, elders = [], [], []

    path = find_db('地名')
    for r in read_xlsx(path) if path else []:
        pid = norm_id(pick(r, '編號', '地名編號'))
        name = pick(r, '地名')
        if not name:
            continue
        p = {
            'id': pid or name, 'name': name,
            'hanyu': pick(r, '漢語拼音'), 'tailo': pick(r, '台羅', '臺羅'), 'poj': pick(r, '白話字'),
            'county': pick(r, '縣市'), 'town': pick(r, '鄉鎮'), 'village': pick(r, '村里'),
            'lng': to_float(pick(r, '經度')), 'lat': to_float(pick(r, '緯度')),
            'intro': pick(r, '地名簡介', '簡介'), 'source': pick(r, '資料來源'),
        }
        a = pick(r, '念法錄音')
        if a:
            p['audio'] = media(a, 'audio', f'地名 {name}')
        if p['lat'] is None:
            warn(f'地名 {name}：缺少經緯度，不會出現在地圖上')
        p['raw'] = raw_of(r, os.path.basename(path))
        places.append(p)

    path = find_db('古蹟')
    for r in read_xlsx(path) if path else []:
        sid = norm_id(pick(r, '古蹟編號'))
        name = pick(r, '古蹟名稱')
        if not (sid or name):
            continue
        s = {
            'id': sid or name, 'name': name, 'intro': pick(r, '古蹟簡介'),
            'tailo': pick(r, '古蹟母語拼音'), 'poj': pick(r, '古蹟白話字'),
            'county': pick(r, '所在縣市', '縣市'), 'town': pick(r, '鄉鎮'), 'village': pick(r, '村里'),
            'lng': to_float(pick(r, '經度')), 'lat': to_float(pick(r, '緯度')),
            'summary': pick(r, '耆老訪談摘要'),
            '_nearby': split_list(pick(r, '附近古地名')),
            'photos': [media(f, 'photo', f'古蹟 {name}') for f in split_list(pick(r, '古蹟地名照片', '古蹟照片'))],
        }
        if s['lat'] is None:
            warn(f'古蹟 {name}：缺少經緯度，不會出現在地圖上')
        s['raw'] = raw_of(r, os.path.basename(path))
        sites.append(s)

    # 耆老：一位耆老可對應多處古蹟。
    #   古蹟編號一格可填多個（以「、」分隔），或同一位耆老填多列，會自動合併。
    path = find_db('耆老')
    by_elder = {}
    for r in read_xlsx(path) if path else []:
        eid = norm_id(pick(r, '耆老編號'))
        if not eid:
            continue
        label = f'耆老 {eid}'
        e = by_elder.get(eid)
        if e is None:
            e = by_elder[eid] = {
                'id': eid, 'sites': [], 'birth': '', 'gender': '', 'birthplace': '', 'residence': '',
                'summaries': [], '_places': [], 'photos': [], 'audio': [], 'docs': [], '_seen': set(),
            }
            e['raws'] = []
            elders.append(e)
            if SHOW_ELDER_NAME:
                e['name'] = pick(r, '耆老姓名')
        e['raws'].append(raw_of(r, os.path.basename(path)))
        for k, col in (('birth', '耆老生日'), ('gender', '性別'), ('birthplace', '出生地'), ('residence', '居住地')):
            if not e[k]:
                e[k] = year_month(pick(r, col)) if k == 'birth' else pick(r, col)
        for sid in split_list(pick(r, '古蹟編號')):
            sid = norm_id(sid)
            if sid not in e['sites']:
                e['sites'].append(sid)
        sm = pick(r, '訪談重點摘要')
        if sm and sm not in e['summaries']:
            e['summaries'].append(sm)
        for t in split_list(pick(r, '訪談提及地名')):
            if t not in e['_places']:
                e['_places'].append(t)
        for kind, key, col in (('photo', 'photos', '耆老照片'), ('audio', 'audio', '錄音檔名'), ('doc', 'docs', '文字稿檔名')):
            for f in split_list(pick(r, col)):
                if (key, f) not in e['_seen']:
                    e['_seen'].add((key, f))
                    e[key].append(media(f, kind, label))
    for e in elders:
        e.pop('_seen')
        e['summary'] = '\n'.join(e.pop('summaries'))

    # ---- 關聯 ----
    by_place = {}
    for p in places:
        by_place[p['name'].replace(' ', '')] = p
        by_place[p['id']] = p
    site_ids = {s['id'] for s in sites}

    def resolve(tokens, owner):
        hits, plain = [], []
        for t in tokens:
            p = by_place.get(t.replace(' ', '')) or by_place.get(norm_id(t))
            if p:
                if p['id'] not in hits:
                    hits.append(p['id'])
            else:
                plain.append(t)
                warn(f'{owner}：地名「{t}」不在地名資料庫中，無法連結')
        return hits, plain

    for p in places:
        p['sites'], p['elders'] = [], []
    place_by_id = {p['id']: p for p in places}

    for s in sites:
        s['places'], s['placesUnlinked'] = resolve(s.pop('_nearby'), f'古蹟 {s["name"]} 附近古地名')
        s['elders'] = []
        for pid in s['places']:
            place_by_id[pid]['sites'].append(s['id'])
        # 直線距離（僅供參考）
        # 只計算 Excel「附近古地名」已填寫的關聯之間的直線距離，不自動推算新的關聯
        s['near'] = []
        for p in places:
            d = dist_m(s, p)
            if d is not None and p['id'] in s['places']:
                s['near'].append({'id': p['id'], 'm': d})
        for p in places:
            d = dist_m(s, p)
            if d is not None:
                p.setdefault('dist', {})[s['id']] = d

    site_by_id = {s['id']: s for s in sites}
    for e in elders:
        for sid in e['sites']:
            if sid not in site_ids:
                warn(f'耆老 {e["id"]}：古蹟編號「{sid}」不在古蹟資料庫中')
            elif e['id'] not in site_by_id[sid]['elders']:
                site_by_id[sid]['elders'].append(e['id'])
        e['sites'] = [sid for sid in e['sites'] if sid in site_ids]
        e['places'], e['placesUnlinked'] = resolve(e.pop('_places'), f'耆老 {e["id"]} 訪談提及地名')
        for pid in e['places']:
            place_by_id[pid]['elders'].append(e['id'])

    data = {
        'generated': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'),
        'sources': [{'name': f, 'src': '資料庫/' + f, 'size': os.path.getsize(os.path.join(DB_DIR, f))} for f in sorted(os.listdir(DB_DIR))
                    if f.lower().endswith('.xlsx') and not f.startswith('~$')],
        'places': places, 'sites': sites, 'elders': elders,
    }
    stamp_index()
    with open(os.path.join(SYS, 'data.js'), 'w', encoding='utf-8') as f:
        f.write('window.SITE_DATA = ')
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write(';\n')

    lines = [f'產生時間：{data["generated"]}',
             f'地名 {len(places)} 筆、古蹟 {len(sites)} 處、耆老 {len(elders)} 位', '']
    lines += ['需要注意：'] + ['・' + m for m in report] if report else ['沒有發現問題。']
    with open(os.path.join(SYS, '檢查報告.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print('\n'.join(lines))


def stamp_index():
    """在 index.html 引用的程式、樣式、資料後面加上版本號（?v=時間），
    瀏覽器才不會拿快取裡的舊檔案和新檔案混用。"""
    path = os.path.join(ROOT, 'index.html')
    with open(path, encoding='utf-8') as f:
        html = f.read()
    v = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
    new = re.sub(r'(系統/(?:app\.js|app\.css|data\.js))(\?v=\d+)?', r'\1?v=' + v, html)
    if new != html:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(new)


if __name__ == '__main__':
    sys.exit(main())
