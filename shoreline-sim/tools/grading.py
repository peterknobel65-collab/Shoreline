"""Concept grading design for 461 Laulea Pl from the 2023 lidar DEM.

Builds the existing surface on a 0.5 m local grid, finds the bank edge and
toe along the frontage, lays the designed surface (berm, vegetated foredune,
lawn dune, path) over it, solves the berm width for a target sand volume,
and reports cut/fill quantities. Local frame: see dem.py (x along shore,
+ toward 459; s across shore, + inland; origin = bank edge on transect 599).
"""
import json, math, os
import numpy as np
import dem as D

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(HERE, '..', 'data', 'site')
F = D.frame()
O, US, UX = F['origin_utm'], F['us'], F['ux']
R = np.load(os.path.join(SITE, 'dem_utm.npy'))
RM = json.load(open(os.path.join(SITE, 'dem_utm.json')))
STEP = 0.5
XS = np.arange(-40, 40 + 1e-9, STEP)
SS = np.arange(-30, 25 + 1e-9, STEP)


def sample(x, s):
    e = O[0] + x * UX[0] + s * US[0]
    n = O[1] + x * UX[1] + s * US[1]
    c = e - RM['xmin'] - 0.5
    r = RM['ymax'] - n - 0.5
    c0 = np.clip(np.floor(c).astype(int), 0, R.shape[1] - 2)
    r0 = np.clip(np.floor(r).astype(int), 0, R.shape[0] - 2)
    fc, fr = c - c0, r - r0
    v = (R[r0, c0] * (1 - fc) * (1 - fr) + R[r0, c0 + 1] * fc * (1 - fr) +
         R[r0 + 1, c0] * (1 - fc) * fr + R[r0 + 1, c0 + 1] * fc * fr)
    return v


X, S = np.meshgrid(XS, SS)
E_RAW = sample(X, S)


def unflatten(Z):
    """Lidar is hydro-flattened: the sea surface is replaced by a flat ~+1.0 m plane.
    Seaward of the waterline (the lowest point of the beach face in each column),
    replace it with the beach face extended at a 1:16 nearshore slope down to -1.5 m."""
    Z = Z.copy()
    for i in range(Z.shape[1]):
        col = Z[:, i]
        land = np.where(col > 1.6)[0]
        if not len(land):
            continue
        k_land = land[0]
        seg = col[:k_land]
        if not len(seg):
            continue
        k = int(np.argmin(seg))                     # waterline (lowest beach point)
        z0 = col[k]
        for j in range(k):
            col[j] = max(-1.5, z0 - (SS[k] - SS[j]) / 16.0)
        Z[:, i] = col
    return Z


E = unflatten(E_RAW)


def lines():
    """Per-x bank edge (first s from the sea where ground >= 2.5 m) and toe (>= 1.6 m)."""
    edge, toe = [], []
    for i, x in enumerate(XS):
        col = E[:, i]
        k = np.argmax(col >= 2.5) if (col >= 2.5).any() else None
        t = np.argmax(col >= 1.6) if (col >= 1.6).any() else None
        edge.append(float(SS[k]) if k is not None else None)
        toe.append(float(SS[t]) if t is not None else None)
    return edge, toe


if __name__ == '__main__':
    edge, toe = lines()
    for x, e, t in zip(XS, edge, toe):
        if x % 2 == 0:
            print(f'x {x:6.1f}  toe(+1.6) {t}  edge(+2.5) {e}  lawn z at edge+4: {float(sample(x, (e or 0) + 4)):.2f}')


# ---------------------------------------------------------------- design
FRONT = (-19.0, 11.0)           # 461's open frontage between 463's high ground and 459's wall
TAPER = 3.0
ZB, ZC = 2.0, 3.5               # berm and dune crest elevations (m above MSL)
FORE, BACK, CREST = 3.0, 4.0, 1.5
TOE_SLOPE = 6.0               # 1:6 construction face on the seaward edge of the berm
PATH_X, PATH_W, PATH_Z = -5.0, 1.6, 2.95
YD3 = 0.764555


def control_line():
    """Bank-face line C(x): smoothed toe(+1.6) + 1 m across the frontage."""
    _, toe = lines()
    t = np.array([v if v is not None else 0 for v in toe], float)
    k = int(5 / STEP)
    sm = np.convolve(np.pad(t, k, mode='edge'), np.ones(2 * k + 1) / (2 * k + 1), mode='valid')
    return sm + 1.0


def design_surface(berm_w, C=None):
    C = control_line() if C is None else C
    P = E.copy()
    for i, x in enumerate(XS):
        if x < FRONT[0] - TAPER or x > FRONT[1] + TAPER:
            continue
        w = min(1.0, (x - (FRONT[0] - TAPER)) / TAPER, ((FRONT[1] + TAPER) - x) / TAPER)
        u = SS - C[i]
        crest0 = 1.0
        t = np.full_like(u, -9.0)
        rise = (ZC - ZB) * FORE                                    # 4.5 m of 1:3 face
        face0 = crest0 - rise
        t = np.where((u >= face0) & (u < crest0), ZB + (u - face0) / FORE, t)
        t = np.where((u >= crest0) & (u < crest0 + CREST), ZC, t)
        t = np.where(u >= crest0 + CREST, ZC - (u - crest0 - CREST) / BACK, t)
        t = np.where((u < face0) & (u >= face0 - berm_w), ZB, t)
        t = np.where(u < face0 - berm_w, ZB - (face0 - berm_w - u) / TOE_SLOPE, t)   # construction face; waves reshape it
        # beach-access path: lowered notch through the dune
        g = math.exp(-((x - PATH_X) / PATH_W) ** 2)
        t = np.where(t > PATH_Z, t - (t - PATH_Z) * g, t)
        col = E[:, i]
        P[:, i] = col + (np.maximum(col, t) - col) * w
    return P, C


def quantities(P, C):
    cell = STEP * STEP
    fill = np.maximum(P - E, 0) * cell
    seaward = S < (np.interp(X[0], XS, C)[None, :] + 0.0)
    beach = float(fill[seaward].sum())
    dune = float(fill[~seaward].sum())
    return beach, dune


def solve_berm(target_beach_yd3):
    lo, hi = 0.0, 25.0
    for _ in range(40):
        mid = (lo + hi) / 2
        P, C = design_surface(mid)
        b, _ = quantities(P, C)
        if b / YD3 < target_beach_yd3:
            lo = mid
        else:
            hi = mid
    P, C = design_surface((lo + hi) / 2)
    return (lo + hi) / 2, P, C
