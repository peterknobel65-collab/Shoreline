"""Measure the vegetation line and the wet/dry sand line in each dated image.

Steps
1. Co-register every image to the newest one by phase correlation on the
   landward half of the frame (roads, roofs, trees), because each image's
   absolute position error is 4-10 m.
2. Along the UH/USGS transects that cross 461's frontage (596-600), sample a
   5-pixel-wide strip and classify each pixel as water, sand or vegetation.
3. The vegetation line is the seaward edge of the first run of >= 3 m of
   vegetation landward of the sand; the waterline is the landward edge of
   water. Distances are metres along the transect (larger = farther inland),
   the same convention as the USGS historical shorelines.

Writes data/site/history.json and an annotated contact sheet for checking.
"""
import json, math, os
import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer
import imagery as I

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(HERE, '..', 'data', 'site')
FRONT = [596, 597, 598, 599, 600]
to_ll = Transformer.from_crs(32604, 4326, always_xy=True)


def load_transects():
    import shapefile
    to_utm = Transformer.from_crs(4326, 32604, always_xy=True)
    out = {}
    for sr in shapefile.Reader(os.path.join(SITE, 'usgs', 'MauiN_LT')).iterShapeRecords():
        t = sr.record['TransOrder']
        if 594 <= t <= 602:
            out[t] = [to_utm.transform(*p) for p in (sr.shape.points[0], sr.shape.points[-1])]
    return out


def phase_shift(ref, img):
    """Integer-pixel translation that maps img onto ref (dy, dx)."""
    a = ref - ref.mean(); b = img - img.mean()
    win = np.outer(np.hanning(a.shape[0]), np.hanning(a.shape[1]))
    F = np.fft.fft2(a * win) * np.conj(np.fft.fft2(b * win))
    r = np.fft.ifft2(F / (np.abs(F) + 1e-9)).real
    dy, dx = np.unravel_index(np.argmax(r), r.shape)
    if dy > a.shape[0] // 2: dy -= a.shape[0]
    if dx > a.shape[1] // 2: dx -= a.shape[1]
    return int(dy), int(dx)


def classify(rgb):
    r, g, b = [rgb[..., i].astype(float) for i in range(3)]
    bright = (r + g + b) / 3
    water = (b > r + 8) & (g > r)                   # blue-green
    veg = (g >= r) & (g > b + 4) & ~water & (bright < 150)
    sand = (r > 120) & (r >= b) & ~veg & ~water     # bright, warm
    return np.where(water, 0, np.where(veg, 2, np.where(sand, 1, 3)))  # 3 = other (rock, shadow)


def main():
    idx = json.load(open(os.path.join(SITE, 'imagery_index.json')))
    # one entry per capture date (several releases re-serve the same photo)
    by_cap = {}
    for e in sorted(idx, key=lambda e: e['release_date']):
        cap = (e.get('capture') or {}).get('date') or e['release_date']
        by_cap[cap] = e      # keep the latest release of each capture
    entries = [dict(e, capture_date=c) for c, e in sorted(by_cap.items())]
    ref_e = entries[-1]
    ref = np.asarray(Image.open(os.path.join(SITE, 'imagery', ref_e['file'])).convert('L'), float)
    H, W = ref.shape
    land = slice(H // 2, H)
    trs = load_transects()
    z = ref_e['zoom']
    mpp = I.metres_per_px(20.9077, z)
    results, sheets = [], []
    for e in entries:
        im = Image.open(os.path.join(SITE, 'imagery', e['file'])).convert('RGB')
        g = np.asarray(im.convert('L'), float)
        dy, dx = phase_shift(ref[land], g[land]) if e is not ref_e else (0, 0)
        if abs(dy) > 80 or abs(dx) > 80:
            dy, dx = 0, 0
        arr = np.asarray(im)
        cls = classify(arr)
        ox, oy = e['origin_px']
        draw_im = im.copy(); d = ImageDraw.Draw(draw_im)
        row = {'capture_date': e['capture_date'], 'source': (e.get('capture') or {}).get('source'),
               'accuracy_m': (e.get('capture') or {}).get('accuracy_m'), 'shift_px': [dy, dx],
               'shift_m': [round(dy * mpp, 1), round(dx * mpp, 1)], 'transects': {}}
        for t in FRONT:
            (x0, y0), (x1, y1) = trs[t]
            L = math.dist((x0, y0), (x1, y1))
            samples = []
            for dist_m in np.arange(200, 320, 0.25):
                f = dist_m / L
                lon, lat = to_ll.transform(x0 + f * (x1 - x0), y0 + f * (y1 - y0))
                px, py = I.lonlat_to_px(lon, lat, z)
                # position in this image = reference position minus registration shift
                ix, iy = int(round(px - ox - dx)), int(round(py - oy - dy))
                if 2 <= ix < W - 2 and 2 <= iy < H - 2:
                    patch = cls[iy - 2:iy + 3, ix - 2:ix + 3].ravel()
                    samples.append((dist_m, np.bincount(patch, minlength=4)))
            ds = np.array([s[0] for s in samples]); cnt = np.array([s[1] for s in samples])
            frac = cnt / cnt.sum(1, keepdims=True)
            veg = frac[:, 2] > 0.5
            water = frac[:, 0] > 0.5
            run = int(round(3 / 0.25))
            vline = None
            for i in range(len(ds) - run):
                if veg[i:i + run].all() and i > 0 and not water[i]:
                    vline = float(ds[i]); break
            wl = None
            wi = np.where(water)[0]
            if len(wi):
                seaward = wi[ds[wi] < (vline if vline else 999)]
                if len(seaward):
                    wl = float(ds[seaward.max()])
            row['transects'][t] = {'veg_line': vline, 'waterline': wl,
                                   'beach_width': (vline - wl) if (vline and wl) else None}
            # annotate
            for val, col in ((vline, (255, 60, 60)), (wl, (60, 160, 255))):
                if val is None: continue
                f = val / L
                lon, lat = to_ll.transform(x0 + f * (x1 - x0), y0 + f * (y1 - y0))
                px, py = I.lonlat_to_px(lon, lat, z)
                cx, cy = px - ox - dx, py - oy - dy
                d.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], outline=col, width=2)
            f0, f1 = 220 / L, 300 / L
            a = I.lonlat_to_px(*to_ll.transform(x0 + f0 * (x1 - x0), y0 + f0 * (y1 - y0)), z)
            b = I.lonlat_to_px(*to_ll.transform(x0 + f1 * (x1 - x0), y0 + f1 * (y1 - y0)), z)
            d.line([(a[0] - ox - dx, a[1] - oy - dy), (b[0] - ox - dx, b[1] - oy - dy)], fill=(255, 255, 0), width=1)
        d.text((10, 10), e['capture_date'], fill=(255, 255, 0))
        sheets.append(draw_im.crop((300, 250, 1000, 800)))
        results.append(row)
        print(e['capture_date'], 'shift m', row['shift_m'],
              {t: (v['veg_line'], v['waterline']) for t, v in row['transects'].items()})
    json.dump({'pixel_m': mpp, 'images': results}, open(os.path.join(SITE, 'history.json'), 'w'), indent=1)
    w, h = sheets[0].size
    sheet = Image.new('RGB', (w * 3, h * ((len(sheets) + 2) // 3)), 'white')
    for i, s in enumerate(sheets):
        sheet.paste(s, ((i % 3) * w, (i // 3) * h))
    sheet.save(os.path.join(SITE, 'history_check.jpg'), quality=85)


if __name__ == '__main__':
    main()
