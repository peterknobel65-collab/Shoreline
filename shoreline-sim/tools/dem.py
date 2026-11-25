"""Download a site DEM (USGS 3DEP 1 m lidar, Aug 2023) on a local grid.

Local frame (metres):
  origin = bank edge on UH/USGS transect 599 (288 m along the transect)
  s      = across the shore, + inland, along the transect azimuth (170 deg)
  x      = along the shore, + toward 459 (azimuth 80 deg)
Writes data/site/dem.json with the grid, frame definition and lon/lat corners.
"""
import concurrent.futures as cf, json, math, os, sys, time, urllib.parse, urllib.request
import shapefile
from pyproj import Transformer

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(HERE, '..', 'data', 'site')
UA = {'User-Agent': 'shoreline-sim/1.0 (coastal research)'}
to_utm = Transformer.from_crs(4326, 32604, always_xy=True)
to_ll = Transformer.from_crs(32604, 4326, always_xy=True)


def frame():
    for sr in shapefile.Reader(os.path.join(SITE, 'usgs', 'MauiN_LT')).iterShapeRecords():
        if sr.record['TransOrder'] == 599:
            a, b = (to_utm.transform(*p) for p in (sr.shape.points[0], sr.shape.points[-1]))
            L = math.dist(a, b)
            us = ((b[0] - a[0]) / L, (b[1] - a[1]) / L)          # unit vector inland
            ux = (-us[1], us[0])                                 # 90 deg clockwise from inland... check sign below
            o = (a[0] + us[0] * 288, a[1] + us[1] * 288)
            # make +x point toward azimuth ~80 deg (east-north-east, toward lot 459)
            if ux[0] < 0:
                ux = (-ux[0], -ux[1])
            return {'origin_utm': o, 'us': us, 'ux': ux, 'epsg': 32604}
    raise SystemExit('transect 599 not found')


def to_lonlat(F, x, s):
    e = F['origin_utm'][0] + x * F['ux'][0] + s * F['us'][0]
    n = F['origin_utm'][1] + x * F['ux'][1] + s * F['us'][1]
    return to_ll.transform(e, n)


def elev(lon, lat):
    q = urllib.parse.urlencode({'x': lon, 'y': lat, 'wkid': 4326, 'units': 'Meters'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request('https://epqs.nationalmap.gov/v1/json?' + q, headers=UA), timeout=20) as r:
                v = float(json.loads(r.read())['value'])
                return None if v < -100 else round(v, 3)
        except Exception:
            time.sleep(1 + attempt)
    return None


def main(step=1.5, x0=-40, x1=40, s0=-30, s1=25, threads=2):
    """Resumable: completed points are cached in data/site/dem_cache.json."""
    F = frame()
    xs = [round(x0 + i * step, 2) for i in range(int((x1 - x0) / step) + 1)]
    ss = [round(s0 + j * step, 2) for j in range(int((s1 - s0) / step) + 1)]
    cache_f = os.path.join(SITE, 'dem_cache.json')
    cache = json.load(open(cache_f)) if os.path.exists(cache_f) else {}
    jobs = [(i, j, *to_lonlat(F, x, s)) for j, s in enumerate(ss) for i, x in enumerate(xs) if f'{i},{j}' not in cache]
    print('to fetch', len(jobs), 'cached', len(cache), flush=True)
    t = time.time()
    with cf.ThreadPoolExecutor(threads) as ex:
        for n, ((i, j, lon, lat), v) in enumerate(zip(jobs, ex.map(lambda q: elev(q[2], q[3]), jobs))):
            if v is not None:
                cache[f'{i},{j}'] = v
            if n % 100 == 0:
                json.dump(cache, open(cache_f, 'w'))
                print(n, '/', len(jobs), round(time.time() - t), 's', flush=True)
    json.dump(cache, open(cache_f, 'w'))
    z = [[cache.get(f'{i},{j}') for i in range(len(xs))] for j in range(len(ss))]
    corners = {k: to_lonlat(F, *p) for k, p in {'sw': (x0, s1), 'se': (x1, s1), 'ne': (x1, s0), 'nw': (x0, s0)}.items()}
    json.dump({'source': 'USGS 3DEP 1 m DEM (lidar 2023-08-04) via EPQS; metres above local mean sea level',
               'frame': F, 'step': step, 'x': xs, 's': ss, 'z': z, 'corners_lonlat': corners},
              open(os.path.join(SITE, 'dem.json'), 'w'))
    print('done in', round(time.time() - t), 's; missing', sum(v is None for row in z for v in row))


if __name__ == '__main__':
    main()
