"""Fetch dated aerial imagery (Esri World Imagery Wayback) as georeferenced mosaics.

Tiles are standard Web Mercator (EPSG:3857) XYZ tiles. Every Wayback release
of the same tile covers the same ground footprint, so mosaics from different
dates can be compared pixel for pixel (apart from each image's own
orthorectification error, which we correct by co-registering on fixed
features such as roofs; see analyze_history.py).
"""
import io, json, math, os, time, urllib.error, urllib.request
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '..', 'data', 'site', 'tiles')
CONFIG_URL = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json'
TILE = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{rel}/{z}/{y}/{x}'
UA = {'User-Agent': 'shoreline-sim/1.0 (coastal research)'}


def lonlat_to_px(lon, lat, z):
    """Global pixel coordinates at zoom z (256-px tiles)."""
    n = 256 * 2 ** z
    x = (lon + 180) / 360 * n
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y


def px_to_lonlat(x, y, z):
    n = 256 * 2 ** z
    lon = x / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lon, lat


def metres_per_px(lat, z):
    return 156543.03392 * math.cos(math.radians(lat)) / 2 ** z


def releases():
    path = os.path.join(CACHE, 'waybackconfig.json')
    if not os.path.exists(path):
        os.makedirs(CACHE, exist_ok=True)
        with urllib.request.urlopen(urllib.request.Request(CONFIG_URL, headers=UA), timeout=60) as r:
            open(path, 'wb').write(r.read())
    cfg = json.load(open(path))
    out = []
    for k, v in cfg.items():
        date = v['itemTitle'].split('Wayback ')[-1].rstrip(')')
        out.append({'rel': int(k), 'date': date, 'title': v['itemTitle']})
    return sorted(out, key=lambda r: r['date'])


def tile(rel, z, x, y):
    d = os.path.join(CACHE, str(rel), str(z))
    os.makedirs(d, exist_ok=True)
    f = os.path.join(d, f'{x}_{y}.jpg')
    if not os.path.exists(f):
        url = TILE.format(rel=rel, z=z, x=x, y=y)
        for attempt in range(4):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                    open(f, 'wb').write(r.read())
                break
            except urllib.error.HTTPError as e:
                if e.code in (400, 404):
                    raise RuntimeError('no tile: ' + url)
                time.sleep(2 + 3 * attempt)
            except Exception:
                time.sleep(2 + 3 * attempt)
        else:
            raise RuntimeError('tile failed: ' + url)
        time.sleep(0.15)
    return Image.open(f).convert('RGB')


def mosaic(rel, z, lon0, lat0, lon1, lat1):
    """Mosaic covering the box; returns (image, (px0, py0)) with global pixel origin."""
    x0, y0 = lonlat_to_px(lon0, lat1, z)
    x1, y1 = lonlat_to_px(lon1, lat0, z)
    tx0, ty0, tx1, ty1 = int(x0 // 256), int(y0 // 256), int(x1 // 256), int(y1 // 256)
    img = Image.new('RGB', ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            img.paste(tile(rel, z, tx, ty), ((tx - tx0) * 256, (ty - ty0) * 256))
    return img, (tx0 * 256, ty0 * 256)


def tile_bytes_are_unique(rel_a, rel_b, z, x, y):
    """Wayback serves the previous image when a release did not change a tile."""
    return tile(rel_a, z, x, y).tobytes() != tile(rel_b, z, x, y).tobytes()


def distinct_releases(lon, lat, z=19):
    """Releases holding a distinct image at this point, newest first.

    Uses the Wayback tilemap endpoint: for a release it returns the release
    whose imagery is actually shown ("select"). Walk back from the newest.
    """
    rs = releases()
    order = [r['rel'] for r in rs]
    by_rel = {r['rel']: r for r in rs}
    cx, cy = lonlat_to_px(lon, lat, z)
    tx, ty = int(cx // 256), int(cy // 256)
    out, i = [], len(order) - 1
    while i >= 0:
        url = f'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tilemap/{order[i]}/{z}/{ty}/{tx}'
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
            j = json.loads(r.read())
        if not j.get('data') or not j['data'][0]:
            break
        sel = j['select'][0] if j.get('select') else order[i]
        if sel not in by_rel:
            break
        out.append(by_rel[sel])
        i = order.index(sel) - 1
    return out
