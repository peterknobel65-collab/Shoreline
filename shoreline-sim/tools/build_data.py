"""Build the hourly wave + water-level dataset used by the simulator.

Sources (downloaded into data/raw/):
  * NOAA NDBC 51205 (PacIOOS/CDIP 187, Pauwela, Maui) standard meteorological
    history: significant wave height WVHT (m), dominant period DPD (s),
    mean wave direction MWD (deg true, direction waves come FROM).
  * NOAA CO-OPS 1615680 (Kahului Harbor) verified hourly water level, metres
    relative to MSL (1983-2001 epoch). Values include tide, seasonal
    anomaly and any surge, i.e. the real still-water level.

Output: data/winters.json — one record per winter season (Oct 1 - Mar 31),
hourly, integer-packed to keep the page small.
"""
import gzip, glob, json, os, csv, datetime as dt
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, '..', 'data', 'raw')
OUT = os.path.join(HERE, '..', 'data', 'winters.json')

def read_buoy():
    rec = {}
    files = sorted(glob.glob(os.path.join(RAW, '51205h*.txt.gz')))
    lines = []
    for f in files:
        lines += gzip.open(f, 'rt').read().splitlines()
    rt = os.path.join(RAW, '51205_realtime.txt')
    if os.path.exists(rt):
        lines += open(rt).read().splitlines()
    for line in lines:
        if line.startswith('#'):
            continue
        p = line.split()
        try:
            t = dt.datetime(int(p[0]), int(p[1]), int(p[2]), int(p[3]))
            hs, tp, md = float(p[8]), float(p[9]), float(p[11])
        except ValueError:
            continue  # 'MM' missing values in realtime file
        if hs >= 99 or tp >= 99 or md >= 999 or hs <= 0:
            continue
        rec.setdefault(t, []).append((hs, tp, md))
    out = {}
    for t, v in rec.items():
        a = np.array(v)
        # circular mean for direction
        ang = np.deg2rad(a[:, 2])
        d = np.rad2deg(np.arctan2(np.sin(ang).mean(), np.cos(ang).mean())) % 360
        out[t] = (a[:, 0].mean(), a[:, 1].mean(), d)
    return out

def read_tide():
    out = {}
    for f in glob.glob(os.path.join(RAW, 'tide_hourly_*.csv')):
        with open(f) as fh:
            r = csv.reader(fh)
            next(r)
            for row in r:
                try:
                    t = dt.datetime.strptime(row[0].strip(), '%Y-%m-%d %H:%M')
                    out[t] = float(row[1])
                except (ValueError, IndexError):
                    pass
    return out

def fill_gaps(arr, maxgap=6):
    """Linear interpolation across gaps of <= maxgap hours; longer gaps stay NaN."""
    arr = arr.copy()
    n = len(arr)
    good = ~np.isnan(arr)
    i = 0
    while i < n:
        if not good[i]:
            j = i
            while j < n and not good[j]:
                j += 1
            if i > 0 and j < n and (j - i) <= maxgap:
                arr[i:j] = np.interp(np.arange(i, j), [i - 1, j], [arr[i - 1], arr[j]])
            i = j
        else:
            i += 1
    return arr

def main():
    buoy, tide = read_buoy(), read_tide()
    seasons = [(2018, 'Winter 2018-19'), (2019, 'Winter 2019-20'),
               (2023, 'Winter 2023-24'), (2024, 'Winter 2024-25'),
               (2026, 'Fall 2026 (to date)')]
    result = {'meta': {
        'waves': 'NOAA NDBC 51205 / PacIOOS-CDIP 187 Pauwela, Maui (hourly mean)',
        'water_level': 'NOAA CO-OPS 1615680 Kahului Harbor, hourly height, m above MSL (1983-2001 epoch)',
        'packing': 'hs: cm, tp: 0.1 s, dir: deg from, wl: mm; -1 / -9999 = missing',
        'kahului_datums_m_above_msl': {'MHHW': 0.347, 'MHW': 0.238, 'MLLW': -0.339,
                                         'record_max_2020_12_15': 0.755}},
        'seasons': []}
    for y0, name in seasons:
        start = dt.datetime(y0, 10, 1) if y0 != 2026 else dt.datetime(2026, 9, 1)
        end = dt.datetime(y0 + 1, 4, 1) if y0 != 2026 else dt.datetime(2026, 11, 1)
        hours = int((end - start).total_seconds() // 3600)
        ts = [start + dt.timedelta(hours=h) for h in range(hours)]
        hs = np.array([buoy.get(t, (np.nan,) * 3)[0] for t in ts])
        tp = np.array([buoy.get(t, (np.nan,) * 3)[1] for t in ts])
        dr = np.array([buoy.get(t, (np.nan,) * 3)[2] for t in ts])
        wl = np.array([tide.get(t, np.nan) for t in ts])
        hs, tp, wl = fill_gaps(hs), fill_gaps(tp), fill_gaps(wl)
        dr = fill_gaps(dr)
        cov = float(np.mean(~np.isnan(hs) & ~np.isnan(wl)))
        result['seasons'].append({
            'name': name, 'start': start.isoformat() + 'Z', 'hours': hours,
            'coverage': round(cov, 3),
            'hs_max': round(float(np.nanmax(hs)), 2),
            'hs': [int(round(v * 100)) if not np.isnan(v) else -1 for v in hs],
            'tp': [int(round(v * 10)) if not np.isnan(v) else -1 for v in tp],
            'dir': [int(round(v)) % 360 if not np.isnan(v) else -1 for v in dr],
            'wl': [int(round(v * 1000)) if not np.isnan(v) else -9999 for v in wl],
        })
        print(f"{name}: {hours} h, coverage {cov:.0%}, max Hs {np.nanmax(hs):.2f} m")
    with open(OUT, 'w') as f:
        json.dump(result, f, separators=(',', ':'))
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB')

if __name__ == '__main__':
    main()
