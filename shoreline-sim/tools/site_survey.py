"""Desk survey of 461 Laulea Pl (Spreckelsville, Maui) from public data.

1. Lidar profiles: USGS 3DEP 1 m DEM (Elevation Point Query Service),
   sampled every metre along the UH/USGS shoreline-change transects that
   cross the lot (OFR 2011-1009, MauiN transects 596-600).
2. Historical imagery: every distinct Esri World Imagery Wayback image of
   the beach since 2014, with its capture date from the imagery metadata.

Outputs go to data/site/ (lidar_profiles.json, imagery_index.json, and one
georeferenced crop per distinct image).
"""
import concurrent.futures as cf, hashlib, json, math, os, urllib.parse, urllib.request
import shapefile
from pyproj import Transformer
import imagery as I

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(HERE, '..', 'data', 'site')
UA = {'User-Agent': 'shoreline-sim/1.0 (coastal research)'}
TRANSECTS = range(596, 602)
# Box around the pocket beach used for imagery crops (lon/lat)
BOX = (-156.4140, 20.9068, -156.4112, 20.9088)
CENTRE = (-156.4123, 20.9077)

to_utm = Transformer.from_crs(4326, 32604, always_xy=True)
to_ll = Transformer.from_crs(32604, 4326, always_xy=True)


def get_json(url, timeout=20):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return json.loads(r.read())
        except Exception:
            if attempt == 3:
                raise


def transects():
    out = {}
    for sr in shapefile.Reader(os.path.join(SITE, 'usgs', 'MauiN_LT')).iterShapeRecords():
        t = sr.record['TransOrder']
        if t in TRANSECTS:
            a, b = (to_utm.transform(*p) for p in (sr.shape.points[0], sr.shape.points[-1]))
            out[t] = {'start': a, 'end': b, 'lt_rate': sr.record['WLR'], 'lt_ci95': sr.record['WCI95']}
    st = {sr.record['TransOrder']: (sr.record['WLR'], sr.record['WCI95'])
          for sr in shapefile.Reader(os.path.join(SITE, 'usgs', 'MauiN_ST')).iterShapeRecords()}
    for t in out:
        out[t]['st_rate'], out[t]['st_ci95'] = st[t]
    return out


def lidar_profiles(trs, d0=235, d1=305, step=1.0):
    def elev(lon, lat):
        q = urllib.parse.urlencode({'x': lon, 'y': lat, 'wkid': 4326, 'units': 'Meters', 'includeDate': 'true'})
        j = get_json('https://epqs.nationalmap.gov/v1/json?' + q)
        v = float(j['value'])
        return (None if v < -100 else v), j.get('attributes', {}).get('AcquisitionDate')
    jobs = []
    for t, tr in trs.items():
        (x0, y0), (x1, y1) = tr['start'], tr['end']
        L = math.dist(tr['start'], tr['end'])
        d = d0
        while d <= d1:
            f = d / L
            lon, lat = to_ll.transform(x0 + f * (x1 - x0), y0 + f * (y1 - y0))
            jobs.append((t, d, lon, lat))
            d += step
    res = {}
    with cf.ThreadPoolExecutor(6) as ex:
        for (t, d, lon, lat), (z, date) in zip(jobs, ex.map(lambda j: elev(j[2], j[3]), jobs)):
            res.setdefault(t, []).append({'d': d, 'lon': lon, 'lat': lat, 'z': z, 'date': date})
    return res


def capture_date(meta_url, lon, lat):
    """Imagery source date at a point from a Wayback metadata layer."""
    lay = get_json(meta_url + '?f=json')
    for layer in lay.get('layers', []):
        q = urllib.parse.urlencode({'geometry': f'{lon},{lat}', 'geometryType': 'esriGeometryPoint', 'inSR': 4326,
                                    'spatialRel': 'esriSpatialRelIntersects', 'outFields': '*',
                                    'returnGeometry': 'false', 'f': 'json'})
        try:
            j = get_json(f"{meta_url}/{layer['id']}/query?{q}")
        except Exception:
            continue
        feats = j.get('features') or []
        if feats:
            a = feats[0]['attributes']
            ms = a.get('SRC_DATE2') or a.get('SRC_DATE')
            if isinstance(ms, (int, float)) and ms > 1e11:
                import datetime as dt
                date = dt.datetime.utcfromtimestamp(ms / 1000).date().isoformat()
            else:
                date = str(ms)
            return {'date': date, 'source': a.get('NICE_DESC') or a.get('SRC_DESC'),
                    'resolution_m': a.get('SAMP_RES') or a.get('SRC_RES'), 'accuracy_m': a.get('SRC_ACC'),
                    'layer': layer.get('name')}
    return None


def imagery_history(z=19):
    cfg = json.load(open(os.path.join(I.CACHE, 'waybackconfig.json')))
    out = []
    for r in I.distinct_releases(*CENTRE, z=z):
        try:
            img, org = I.mosaic(r['rel'], z, *BOX)
        except RuntimeError as e:
            print('skip', r['date'], e)
            continue
        name = f"wayback_{r['date']}.jpg"
        img.save(os.path.join(SITE, 'imagery', name), quality=90)
        try:
            meta = capture_date(cfg[str(r['rel'])]['metadataLayerUrl'], *CENTRE)
        except Exception as e:
            meta = {'error': str(e)}
        out.append({'release': r['rel'], 'release_date': r['date'], 'file': name, 'origin_px': org, 'zoom': z,
                    'capture': meta})
        print(r['date'], meta, flush=True)
    return out


if __name__ == '__main__':
    os.makedirs(os.path.join(SITE, 'imagery'), exist_ok=True)
    trs = transects()
    with cf.ThreadPoolExecutor(2) as ex:
        f_lidar = ex.submit(lidar_profiles, trs)
        f_img = ex.submit(imagery_history)
        prof = f_lidar.result()
        json.dump({'source': 'USGS 3DEP via EPQS (1 m DEM), metres NAVD88-equivalent (Hawaii local MSL-based datum)',
                   'transects': {t: dict(trs[t], profile=prof[t]) for t in trs}},
                  open(os.path.join(SITE, 'lidar_profiles.json'), 'w'), indent=1)
        idx = f_img.result()
        json.dump(idx, open(os.path.join(SITE, 'imagery_index.json'), 'w'), indent=1)
    print('done', len(idx), 'distinct images')
