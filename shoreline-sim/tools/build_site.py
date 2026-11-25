"""Package the desk-survey evidence for the simulator page.

Reads data/site/{lidar_profiles.json, imagery_index.json, usgs/*} and writes
  data/site.json      lidar profile, historical shoreline positions, rates
  img/aerial_*.jpg    co-registered crops of the frontage for each capture date
"""
import json, math, os
import shapefile
from PIL import Image
from pyproj import Transformer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
SITE = os.path.join(ROOT, 'data', 'site')
to_utm = Transformer.from_crs(4326, 32604, always_xy=True)
KEY = 599          # transect through the middle of 461's frontage


def seg_t(p1, p2, p3, p4):
    (x1, y1), (x2, y2), (x3, y3), (x4, y4) = p1, p2, p3, p4
    d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if abs(d) < 1e-12:
        return None
    t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d
    u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / d
    return t if 0 <= t <= 1 and 0 <= u <= 1 else None


def main():
    lid = json.load(open(os.path.join(SITE, 'lidar_profiles.json')))['transects']
    tr = {sr.record['TransOrder']: [to_utm.transform(*p) for p in (sr.shape.points[0], sr.shape.points[-1])]
          for sr in shapefile.Reader(os.path.join(SITE, 'usgs', 'MauiN_LT')).iterShapeRecords()}
    rates = {}
    for n in ('LT', 'ST'):
        for sr in shapefile.Reader(os.path.join(SITE, 'usgs', 'MauiN_' + n)).iterShapeRecords():
            t = sr.record['TransOrder']
            if 590 <= t <= 602:
                rates.setdefault(t, {})[n] = [sr.record['WLR'], sr.record['WCI95']]
    shores = [(sr.record['DATE_'], sr.record['ACCURACY'], [to_utm.transform(*p) for p in sr.shape.points])
              for sr in shapefile.Reader(os.path.join(SITE, 'usgs', 'MauiN_shorelines')).iterShapeRecords()]
    history = {}
    for t in (597, 598, 599, 600):
        a, b = tr[t]
        L = math.dist(a, b)
        pts = {}
        for date, acc, line in shores:
            for i in range(len(line) - 1):
                f = seg_t(a, b, line[i], line[i + 1])
                if f is not None:
                    yr = int(date[-4:])
                    pts[yr] = {'year': yr, 'date': date, 'd': round(f * L, 1), 'accuracy_m': round(acc, 1)}
        history[t] = sorted(pts.values(), key=lambda r: r['year'])
    prof = [{'d': p['d'], 'z': None if p['z'] is None else round(p['z'], 2)} for p in lid[str(KEY)]['profile']]
    out = {
        'site': {'name': '461 Laulea Pl, Spreckelsville (Pāʻia), Maui', 'lat': 20.9077, 'lon': -156.4123,
                 'faces_deg': 350, 'key_transect': KEY},
        'lidar': {'source': 'USGS 3DEP 1 m DEM, lidar flown 4 Aug 2023 (Elevation Point Query Service)',
                  'datum': 'metres above local mean sea level', 'transect': KEY, 'profile': prof,
                  'house_roof_edge_d': 299, 'bank_edge_d': 288},
        'shorelines': {'source': 'UH Coastal Geology Group / USGS OFR 2011-1009 (MauiN)',
                       'note': 'distance along transect from offshore baseline; larger = farther inland',
                       'transects': history},
        'rates': {'source': 'UH/USGS weighted linear regression, m/yr (negative = erosion), +/- 95% CI',
                  'LT_period': '1912-2002', 'ST_period': '1960-2002', 'by_transect': rates},
    }
    # aerial crops of the frontage, one per capture date (co-registered shift from analyze_history)
    idx = json.load(open(os.path.join(SITE, 'imagery_index.json')))
    hist = json.load(open(os.path.join(SITE, 'history.json')))
    shift = {r['capture_date']: r['shift_px'] for r in hist['images']}
    seen, aerials = set(), []
    os.makedirs(os.path.join(ROOT, 'img'), exist_ok=True)
    for e in sorted(idx, key=lambda e: e['release_date'], reverse=True):
        cap = (e.get('capture') or {}).get('date')
        if not cap or cap in seen:
            continue
        seen.add(cap)
        dy, dx = shift.get(cap, [0, 0])
        box = (560, 300, 1060, 660)
        im = Image.open(os.path.join(SITE, 'imagery', e['file'])).convert('RGB')
        crop = im.crop((box[0] - dx, box[1] - dy, box[2] - dx, box[3] - dy)).resize((750, 540), Image.LANCZOS)
        name = f'aerial_{cap}.jpg'
        crop.save(os.path.join(ROOT, 'img', name), quality=78, optimize=True)
        aerials.append({'date': cap, 'file': 'img/' + name, 'source': e['capture']['source'],
                        'accuracy_m': e['capture']['accuracy_m'], 'resolution_m': e['capture']['resolution_m']})
    out['aerials'] = sorted(aerials, key=lambda a: a['date'])
    json.dump(out, open(os.path.join(ROOT, 'data', 'site.json'), 'w'), indent=1)
    print('wrote site.json;', len(aerials), 'aerials;', {t: [(h['year'], h['d']) for h in v] for t, v in history.items()})


if __name__ == '__main__':
    main()
