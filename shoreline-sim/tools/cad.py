"""Concept drawings for the 461 Laulea Pl living shoreline.

Reads the 2023 lidar DEM (dem_utm.npy) and data/design.json, builds the
designed grading surface (grading.py), and writes:
  cad/Laulea_living_shoreline_concept.dxf   layered DXF in UTM zone 4N metres
  cad/Laulea_living_shoreline_concept.pdf   7-sheet concept set (ANSI B)
  img/sheet_*.png                           sheet previews for the web page
  data/grading.json                         grids for the 3D model, quantities
CONCEPT ONLY - NOT FOR CONSTRUCTION. A Hawaii-licensed engineer must prepare
construction drawings from a certified shoreline and topographic survey.
"""
import json, math, os, datetime
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.colors import LightSource, ListedColormap
from matplotlib.patches import Polygon, Rectangle
import ezdxf
import grading as G

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
os.makedirs(os.path.join(ROOT, 'cad'), exist_ok=True)
os.makedirs(os.path.join(ROOT, 'img'), exist_ok=True)

design = json.load(open(os.path.join(ROOT, 'data', 'design.json')))
opt = design['optimal']['design']
INITIAL = opt['initialYd3']
CREST = 2.9 + opt['crestRaise']
G.ZC = CREST
BERM_W, P, C = G.solve_berm(INITIAL)
E = G.E
XS, SS, X, S = G.XS, G.SS, G.X, G.S
beach_m3, dune_m3 = G.quantities(P, C)
FILL = np.maximum(P - E, 0)
CUT = np.maximum(E - P, 0)
YD3 = G.YD3
MHHW, RECORD, SLR2050, SLR2100 = 0.35, 0.76, 0.35 + 0.30, 0.35 + 0.98
# wave runup (2% total water level) from the calibrated model, NOAA buoy 51205 + Kahului tide
STORM_TYPICAL, STORM_RECORD, STORM_2075 = 3.30, 3.56, 4.03

# ---------------- site features in local coordinates ----------------
edge, toe = G.lines()
HOUSE = [(-4.0, 10.5), (16.0, 9.5), (16.5, 21.5), (-3.5, 22.0)]       # 461 roof outline (Jan 2026 aerial)
TOWER = [(0.5, 13.0), (4.0, 12.9), (4.1, 16.2), (0.6, 16.3)]
WALL = [(x, e) for x, e in zip(XS, edge) if x >= 11.5 and e is not None and e > -29]     # 459 rock wall crest
WALL_TOE = [(x, t) for x, t in zip(XS, toe) if x >= 11.5 and t is not None and t > -29.5]
LOW = [(x, e) for x, e in zip(XS, edge) if G.FRONT[0] <= x <= G.FRONT[1] and e is not None]
TOE = [(x, t) for x, t in zip(XS, toe) if G.FRONT[0] <= x <= G.FRONT[1] and t is not None]
SECTIONS = {'A': -15.0, 'B': -8.0, 'C': 0.0, 'D': 5.0, 'E': 9.5}
TREES = [(-12.0, 9.0), (9.0, 6.5)]
F = G.F


def to_utm(x, s):
    return (F['origin_utm'][0] + x * F['ux'][0] + s * F['us'][0], F['origin_utm'][1] + x * F['ux'][1] + s * F['us'][1])


def contour_paths(Z, levels):
    fig = plt.figure()
    cs = plt.contour(XS, SS, Z, levels=levels)
    out = []
    for lev, segs in zip(cs.levels, cs.allsegs):
        for seg in segs:
            if len(seg) > 2:
                out.append((float(lev), seg))
    plt.close(fig)
    return out


def daylight(Pz, Ez):
    """Outline of the fill area (where the design surface rises above existing)."""
    fig = plt.figure()
    cs = plt.contour(XS, SS, Pz - Ez, levels=[0.05])
    segs = [s for s in cs.allsegs[0] if len(s) > 3]
    plt.close(fig)
    return segs


def crest_line():
    pts = []
    for i, x in enumerate(XS):
        if G.FRONT[0] + 1 <= x <= G.FRONT[1] - 1 and abs(x - G.PATH_X) > 1.2:
            pts.append((x, C[i] + 1.0 + G.CREST / 2))
    return pts


def berm_edge():
    face0 = 1.0 - (CREST - G.ZB) * G.FORE
    return [(x, C[i] + face0 - BERM_W) for i, x in enumerate(XS) if G.FRONT[0] <= x <= G.FRONT[1]]


# ---------------- DXF ----------------
def write_dxf(path):
    doc = ezdxf.new('R2010', setup=True)
    doc.units = ezdxf.units.M
    msp = doc.modelspace()
    layers = {
        'EX-CONTOUR-MAJOR': 8, 'EX-CONTOUR-MINOR': 9, 'PR-CONTOUR-MAJOR': 1, 'PR-CONTOUR-MINOR': 30,
        'EX-BANK-EDGE': 6, 'EX-BANK-TOE': 40, 'EX-STRUCT-HOUSE': 7, 'EX-STRUCT-WALL-459': 250,
        'PR-LIMIT-OF-FILL': 3, 'PR-DUNE-CREST': 94, 'PR-BERM-EDGE': 42, 'PR-PATH': 52,
        'PR-PLANT-TREE': 96, 'REF-TRANSECTS': 150, 'REF-SECTIONS': 5, 'ANNO-TEXT': 7,
    }
    for name, color in layers.items():
        doc.layers.add(name, color=color)

    def pl(pts, layer, closed=False):
        msp.add_lwpolyline([to_utm(x, s) for x, s in pts], close=closed, dxfattribs={'layer': layer})

    for lev, seg in contour_paths(E, np.arange(0, 4.01, 0.25)):
        pl(seg, 'EX-CONTOUR-MAJOR' if abs(lev % 1) < 1e-6 else 'EX-CONTOUR-MINOR')
    for lev, seg in contour_paths(np.where(FILL > 0.02, P, np.nan), np.arange(0, 4.01, 0.25)):
        pl(seg, 'PR-CONTOUR-MAJOR' if abs(lev % 1) < 1e-6 else 'PR-CONTOUR-MINOR')
    pl(LOW, 'EX-BANK-EDGE'); pl(TOE, 'EX-BANK-TOE')
    pl(HOUSE, 'EX-STRUCT-HOUSE', True); pl(TOWER, 'EX-STRUCT-HOUSE', True)
    pl(WALL, 'EX-STRUCT-WALL-459'); pl(WALL_TOE, 'EX-STRUCT-WALL-459')
    for seg in daylight(P, E):
        pl(seg, 'PR-LIMIT-OF-FILL')
    pl(crest_line(), 'PR-DUNE-CREST'); pl(berm_edge(), 'PR-BERM-EDGE')
    pl([(G.PATH_X - 0.8, -20), (G.PATH_X - 0.8, 9)], 'PR-PATH'); pl([(G.PATH_X + 0.8, -20), (G.PATH_X + 0.8, 9)], 'PR-PATH')
    for x, s in TREES:
        e, n = to_utm(x, s); msp.add_circle((e, n), 2.5, dxfattribs={'layer': 'PR-PLANT-TREE'})
    for name, x in SECTIONS.items():
        pl([(x, -25), (x, 12)], 'REF-SECTIONS')
        e, n = to_utm(x, -26); msp.add_text(f'{name}', dxfattribs={'layer': 'ANNO-TEXT', 'height': 1.0}).set_placement((e, n))
    lab = [('EXISTING HOUSE 461', 6, 16), ('459 ROCK WALL', 20, -16), ('DUNE CREST +%.1f' % CREST, -12, C[0] + 1.8),
           ('BERM +2.0', -10, C[0] + 1 - (CREST - 2) * 3 - BERM_W / 2)]
    for t, x, s in lab:
        e, n = to_utm(x, s); msp.add_text(t, dxfattribs={'layer': 'ANNO-TEXT', 'height': 0.6}).set_placement((e, n))
    e, n = to_utm(-38, 24)
    msp.add_text('CONCEPT ONLY - NOT FOR CONSTRUCTION. UTM ZONE 4N (WGS84) METRES. ELEV: M ABOVE LOCAL MSL (3DEP 2023 LIDAR).',
                 dxfattribs={'layer': 'ANNO-TEXT', 'height': 0.5}).set_placement((e, n))
    doc.saveas(path)


# ---------------- sheets ----------------
INK, MUTED, ACC = '#1b2622', '#5a6762', '#0d7377'
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 7, 'axes.edgecolor': INK, 'axes.linewidth': 0.6})
TODAY = datetime.date.today().isoformat()


def sheet(title, number, subtitle=''):
    fig = plt.figure(figsize=(17, 11))
    fig.patch.set_facecolor('white')
    fig.add_artist(Rectangle((0.015, 0.02), 0.97, 0.96, transform=fig.transFigure, fill=False, lw=1.2, ec=INK))
    tb = fig.add_axes([0.80, 0.02, 0.185, 0.96]); tb.axis('off')
    tb.add_patch(Rectangle((0, 0), 1, 1, transform=tb.transAxes, fill=False, lw=1.2, ec=INK))
    y = 0.97
    for txt, size, w in [('LAULEA LIVING SHORELINE', 11, 'bold'), ('461 Laulea Place, Spreckelsville, Maui', 8, 'normal'),
                         ('TMK: to be confirmed', 7, 'normal'), ('', 6, 'normal'),
                         (title.upper(), 10, 'bold'), (subtitle, 7, 'normal')]:
        tb.text(0.06, y, txt, fontsize=size, weight=w, va='top', color=INK, wrap=True); y -= 0.035 if size < 9 else 0.045
    tb.text(0.06, 0.30, 'CONCEPT DESIGN\nNOT FOR CONSTRUCTION', fontsize=10, weight='bold', color='#c0392b', va='top')
    notes = ('Base data: USGS 3DEP 1 m lidar (4 Aug 2023);\nUH/USGS shoreline transects (OFR 2011-1009);\n'
             'Esri/Vantor aerial (10 Jan 2026).\nElevations: metres above local mean sea level.\n'
             'Local grid: x along shore (+ toward 459),\ns across shore (+ inland), origin = bank\nedge on transect 599.\n'
             'Certified shoreline and topographic survey\nrequired before final design.')
    tb.text(0.06, 0.22, notes, fontsize=6.5, color=MUTED, va='top', linespacing=1.4)
    tb.text(0.06, 0.06, f'Prepared {TODAY}\nwith the Shoreline Lab model', fontsize=6.5, color=MUTED, va='bottom')
    tb.text(0.94, 0.03, number, fontsize=22, weight='bold', ha='right', va='bottom', color=INK)
    return fig


def plan_axes(fig, rect=(0.04, 0.06, 0.74, 0.88)):
    ax = fig.add_axes(rect)
    ax.set_aspect('equal'); ax.set_xlim(-40, 40); ax.set_ylim(25, -30)    # ocean at top
    ax.set_xticks(range(-40, 41, 10)); ax.set_yticks(range(-30, 26, 10))
    ax.tick_params(labelsize=6, colors=MUTED); ax.grid(color='#e3e8e5', lw=0.4)
    ax.set_xlabel('x along shore (m)', color=MUTED); ax.set_ylabel('s inland (m)', color=MUTED)
    return ax


def base_features(ax, proposed=False):
    ax.add_patch(Polygon(HOUSE, closed=True, fc='#f4f4f0', ec=INK, lw=1.0, zorder=5))
    ax.add_patch(Polygon(TOWER, closed=True, fc='#ffffff', ec=INK, lw=0.7, zorder=6))
    ax.text(6, 17.5, 'EXISTING HOUSE\n461', ha='center', va='center', fontsize=7, weight='bold', zorder=7)
    if WALL:
        wx, ws = zip(*WALL); ax.plot(wx, ws, color='#3b4447', lw=4, solid_capstyle='round', zorder=4)
        ax.text(24, -21, '459 ROCK WALL', rotation=-38, fontsize=6.5, color=INK, zorder=7)
    ax.text(-34, 5, '463', fontsize=8, color=MUTED)
    ax.text(-36, -26, 'PACIFIC OCEAN', fontsize=8, color='#2a7fa3', style='italic')
    ax.annotate('', xy=(35, -27.5), xytext=(35, -22), arrowprops=dict(arrowstyle='->', color=INK))
    ax.text(35.6, -26, 'N≈', fontsize=7)   # local s axis runs 170 deg, so north is ~ toward -s


def sheet_cover(pdf):
    fig = sheet('Cover, notes and sheet index', 'C-001')
    ax = fig.add_axes([0.05, 0.08, 0.72, 0.86]); ax.axis('off')
    ax.text(0, 1, 'Laulea Living Shoreline', fontsize=26, weight='bold', va='top', color=INK)
    ax.text(0, 0.93, 'Soft shoreline restoration: sand berm, vegetated dune, native planting, beach access', fontsize=12, va='top', color=MUTED)
    idx = [('C-001', 'Cover, notes and sheet index'), ('C-101', 'Existing conditions (2023 lidar)'),
           ('C-201', 'Grading plan and fill depth'), ('C-301', 'Sections A-E'), ('L-101', 'Planting plan'),
           ('C-501', 'Typical section and details'), ('C-601', 'Quantities, sequence and maintenance')]
    for k, (n, t) in enumerate(idx):
        ax.text(0, 0.82 - k * 0.04, n, fontsize=10, weight='bold', va='top'); ax.text(0.09, 0.82 - k * 0.04, t, fontsize=10, va='top')
    notes = [
        'GENERAL NOTES',
        '1. Concept design for planning and permitting discussions only. Not for construction.',
        '2. All work seaward of the certified shoreline requires DLNR-OCCL authorisation (Small-Scale Beach Nourishment, Category II).',
        '3. Work landward of the shoreline requires Maui County SMA review and shoreline-setback approval.',
        '4. No rock, concrete, gabions or permanent geotextile. Hawaii prohibits private shoreline hardening at sand beaches (HRS 205A, Act 16 of 2020).',
        f'5. Fill: beach-compatible carbonate sand matching native grain size and colour; fines < 5%. Initial volume {INITIAL:,} yd³ beach + {dune_m3 / YD3:,.0f} yd³ dune.',
        '6. Construction in the calm season (May-Sept) with an archaeological monitor present (SHPD).',
        '7. Unauthorised boulders on the beach remain in place pending OCCL direction.',
        '8. Elevations in metres above local mean sea level (Kahului MSL 1983-2001). MHHW +0.35 m. Highest recorded still water +0.76 m (2020).',
        f'9. Design: dune crest +{CREST:.1f} m, berm +2.0 m x {BERM_W:.1f} m, dune face 1:3, back slope 1:4, beach face 1:10.',
        '10. Maintenance: sand top-ups when the annual survey shows the berm sand below the trigger volume (sheet C-601).',
    ]
    for k, t in enumerate(notes):
        ax.text(0, 0.48 - k * 0.032, t, fontsize=8.5 if k else 10, weight='bold' if k == 0 else 'normal', va='top', color=INK)
    pdf.savefig(fig); fig.savefig(os.path.join(ROOT, 'img', 'sheet_C-001.png'), dpi=110); plt.close(fig)


def hillshade(ax, Z):
    ls = LightSource(azdeg=315, altdeg=35)
    rgb = ls.shade(np.clip(Z, -0.5, 4.5), cmap=plt.cm.gist_earth, vert_exag=3, blend_mode='soft', vmin=-1.5, vmax=6)
    ax.imshow(rgb, extent=(XS[0], XS[-1], SS[-1], SS[0]), alpha=0.55, zorder=0)


def sheet_existing(pdf):
    fig = sheet('Existing conditions', 'C-101', 'From the 2023 USGS lidar and Jan 2026 aerial')
    ax = plan_axes(fig)
    hillshade(ax, E)
    for lev, seg in contour_paths(E, np.arange(0, 4.01, 0.25)):
        major = abs(lev % 1) < 1e-6
        ax.plot(seg[:, 0], seg[:, 1], color='#6b5a40' if major else '#a8987c', lw=0.9 if major else 0.4, zorder=2)
        if major and len(seg) > 30:
            m = seg[len(seg) // 2]; ax.text(m[0], m[1], f'{lev:+.0f}', fontsize=6, color='#6b5a40', ha='center', va='center',
                                            bbox=dict(fc='white', ec='none', pad=0.3), zorder=3)
    if LOW:
        lx, ls_ = zip(*LOW); ax.plot(lx, ls_, color='#7b3f99', lw=1.4, ls='--', zorder=4, label='bank edge (+2.5 m)')
    if TOE:
        tx, ts = zip(*TOE); ax.plot(tx, ts, color='#c0392b', lw=1.2, zorder=4, label='bank toe (+1.6 m)')
    for t, xr in [('596', -40), ('597', -20), ('598', -20), ('599', 0), ('600', 20)]:
        pass
    ax.plot([0, 0], [-30, 25], color='#2a7fa3', lw=0.7, ls=':', zorder=3); ax.text(0.5, -29, 'transect 599', fontsize=6, color='#2a7fa3')
    ax.axvspan(G.FRONT[0], G.FRONT[1], ymin=0, ymax=1, color='#0d7377', alpha=0.05, zorder=1)
    ax.text((G.FRONT[0] + G.FRONT[1]) / 2, 23.5, f'461 OPEN FRONTAGE ≈ {G.FRONT[1] - G.FRONT[0]:.0f} m', ha='center', fontsize=7, color=ACC, weight='bold')
    ax.annotate('LOW LAWN +2.6 to +2.9 m\n(overwash entry)', xy=(-13, 6), xytext=(-33, 14), fontsize=6.5, color='#c0392b',
                arrowprops=dict(arrowstyle='->', color='#c0392b', lw=0.7))
    ax.annotate('ACTIVE SCARP 0.5-1.4 m\nroots & irrigation pipe exposed\n(photos, Nov 2026)', xy=(2, 0.5), xytext=(-30, -12), fontsize=6.5,
                color=INK, arrowprops=dict(arrowstyle='->', color=INK, lw=0.7))
    ax.annotate('UNAUTHORISED BOULDERS\nscattered on beach', xy=(4, -6), xytext=(14, -27), fontsize=6.5, color=INK,
                arrowprops=dict(arrowstyle='->', color=INK, lw=0.7))
    base_features(ax)
    ax.legend(loc='lower left', fontsize=6.5, frameon=True)
    pdf.savefig(fig); fig.savefig(os.path.join(ROOT, 'img', 'sheet_C-101.png'), dpi=110); plt.close(fig)


def sheet_grading(pdf):
    fig = sheet('Grading plan', 'C-201', f'Berm +2.0 m, dune crest +{CREST:.1f} m, fill depth shaded')
    ax = plan_axes(fig)
    fd = np.ma.masked_less(FILL, 0.03)
    im = ax.imshow(fd, extent=(XS[0], XS[-1], SS[-1], SS[0]), cmap=plt.cm.YlOrBr, vmin=0, vmax=2.0, alpha=0.85, zorder=1)
    for lev, seg in contour_paths(E, np.arange(0, 4.01, 0.5)):
        ax.plot(seg[:, 0], seg[:, 1], color='#9a9a9a', lw=0.5, ls='--', zorder=2)
    for lev, seg in contour_paths(np.where(FILL > 0.02, P, np.nan), np.arange(0, 4.01, 0.25)):
        major = abs(lev % 1) < 1e-6
        ax.plot(seg[:, 0], seg[:, 1], color='#8a3b12' if major else '#b86a3a', lw=1.0 if major else 0.5, zorder=3)
        if len(seg) > 25 and (major or abs(lev % 0.5) < 1e-6):
            m = seg[len(seg) // 3]; ax.text(m[0], m[1], f'{lev:+.2f}'.rstrip('0').rstrip('.'), fontsize=5.5, color='#8a3b12',
                                            bbox=dict(fc='white', ec='none', pad=0.2), zorder=4)
    for seg in daylight(P, E):
        ax.plot(seg[:, 0], seg[:, 1], color='#2f7d4a', lw=1.3, zorder=4)
    cr = crest_line(); ax.plot(*zip(*cr), color='#2f7a3a', lw=2.0, ls='-.', zorder=5)
    be = berm_edge(); ax.plot(*zip(*be), color='#b7791f', lw=1.2, ls=(0, (6, 3)), zorder=5)
    ax.add_patch(Rectangle((G.PATH_X - 0.8, -22), 1.6, 31, fc='#f3ecd9', ec='#8b6a4a', lw=0.8, zorder=4))
    ax.text(G.PATH_X, -23, 'SAND PATH\n1.6 m, crest +2.95', ha='center', fontsize=6, va='bottom')
    for x, s in TREES:
        ax.add_patch(plt.Circle((x, s), 2.5, fc='#2f7a3a', alpha=0.35, ec='#2f7a3a', zorder=5)); ax.text(x, s, 'KOU', ha='center', va='center', fontsize=5.5)
    for name, x in SECTIONS.items():
        ax.plot([x, x], [-25, 12], color='#c0392b', lw=0.8, ls=(0, (10, 3, 2, 3)), zorder=6)
        for yy in (-25.5, 12.8):
            ax.text(x, yy, name, ha='center', va='center', fontsize=8, weight='bold', color='white',
                    bbox=dict(boxstyle='circle', fc='#c0392b', ec='none'), zorder=7)
    # spot elevations
    for x in (-15, -5, 5):
        i = int((x - XS[0]) / G.STEP)
        for s_off, lab in ((1.0 + G.CREST / 2, 'crest'),):
            s = C[i] + s_off; ax.plot(x + 1.5, s, 'k+', ms=4, zorder=7); ax.text(x + 2, s, f'+{CREST:.2f}', fontsize=5.5, zorder=7)
    base_features(ax, True)
    cax = fig.add_axes([0.06, 0.08, 0.15, 0.012]); cb = fig.colorbar(im, cax=cax, orientation='horizontal'); cb.set_label('fill depth (m)', fontsize=6); cb.ax.tick_params(labelsize=6)
    ax.text(-39, 23, f'Beach fill (seaward of bank face): {beach_m3 / YD3:,.0f} yd³   Dune fill (landward): {dune_m3 / YD3:,.0f} yd³   Berm width {BERM_W:.1f} m',
            fontsize=7, weight='bold', color=INK, bbox=dict(fc='white', ec=INK, lw=0.5))
    pdf.savefig(fig); fig.savefig(os.path.join(ROOT, 'img', 'sheet_C-201.png'), dpi=110); plt.close(fig)


def sheet_sections(pdf):
    fig = sheet('Sections A-E', 'C-301', 'Existing (2023 lidar) vs designed; vertical exaggeration 2x')
    n = len(SECTIONS)
    for k, (name, x) in enumerate(SECTIONS.items()):
        ax = fig.add_axes([0.05, 0.08 + (n - 1 - k) * 0.18, 0.73, 0.15])
        i = int(round((x - XS[0]) / G.STEP))
        e, p = E[:, i], P[:, i]
        ax.fill_between(SS, -1.5, e, color='#c9b48a', alpha=0.9, lw=0)
        ax.fill_between(SS, e, p, where=p > e + 0.01, color='#e8d6a8', hatch='....', edgecolor='#b89f6c', lw=0)
        ax.plot(SS, e, color='#6b5a40', lw=0.9, ls='--', label='existing 2023')
        ax.plot(SS, p, color=INK, lw=1.4, label='designed')
        for z, lab, col in ((MHHW, 'MHHW +0.35', '#2a7fa3'), (RECORD, 'record still water +0.76', '#2a7fa3'),
                            (SLR2100, 'MHHW + 0.98 m SLR (2100)', '#7b3f99'),
                            (STORM_TYPICAL, 'runup: typical winter max +3.30', '#c0392b'), (STORM_RECORD, 'runup: record winter (2019-20) +3.56', '#c0392b')):
            ax.axhline(z, color=col, lw=0.6, ls=':'); ax.text({0.35: -29.5, 0.76: -21, SLR2100: -12, STORM_TYPICAL: -29.5, STORM_RECORD: -14}.get(z, -29.5), z + 0.05, lab, fontsize=5.5, color=col)
        ax.set_xlim(-30, 25); ax.set_ylim(-1.0, 5.0); ax.set_aspect(2.0 * 1)
        ax.set_yticks(range(-1, 6)); ax.tick_params(labelsize=6); ax.grid(color='#e3e8e5', lw=0.4)
        ax.set_ylabel('m MSL', fontsize=6)
        ax.text(-29.5, 4.4, f'SECTION {name}   (x = {x:+.1f} m)', fontsize=8, weight='bold', color='#c0392b')
        # house where present
        if -4 <= x <= 16.5:
            ax.add_patch(Rectangle((10.2 if x > 5 else 10.8, 3.3), 12, 2.4, fc='#f4f4f0', ec=INK, lw=0.7)); ax.text(16, 4.4, 'house', fontsize=6, ha='center')
        crest_s = C[i] + 1.0 + G.CREST / 2
        if p.max() - e.max() > 0.05 or (p - e).max() > 0.1:
            ax.annotate(f'crest +{CREST:.1f}', xy=(crest_s, CREST), xytext=(crest_s + 3, CREST + 0.9), fontsize=6, arrowprops=dict(arrowstyle='-', lw=0.5))
        if k == 0:
            ax.legend(loc='upper right', fontsize=6, ncol=2)
    ax.set_xlabel('s, metres inland from today\'s bank edge on transect 599', fontsize=7)
    pdf.savefig(fig); fig.savefig(os.path.join(ROOT, 'img', 'sheet_C-301.png'), dpi=110); plt.close(fig)


PLANT_ZONES = [
    ('Z1 Dune face, lower', 'ʻAkiʻaki plugs @ 0.45 m + pōhuehue 1-gal @ 1.5 m', '#a9c46a', 2.0, 2.7),
    ('Z2 Dune face, upper', 'ʻAkiʻaki + nanea 1-gal @ 1.2 m', '#8fae4a', 2.7, CREST - 0.15),
    ('Z3 Dune crest', 'Naupaka kahakai 3-gal @ 1.5 m', '#2f7f3a', CREST - 0.15, CREST + 0.01),
    ('Z4 Back slope', 'Hinahina & ʻilima 1-gal @ 0.9 m', '#b8c4bd', None, None),
]


def zone_mask(z):
    fillm = FILL > 0.03
    face = S < (np.interp(X[0], XS, C)[None, :] + 1.0)
    if z == 0: return fillm & (P >= 2.08) & (P < 2.7) & face
    if z == 1: return fillm & (P >= 2.7) & (P < CREST - 0.15) & face
    if z == 2: return fillm & (P >= CREST - 0.15)
    return fillm & (P < CREST - 0.15) & ~face


def plant_quantities():
    cell = G.STEP ** 2
    path = np.abs(X - G.PATH_X) < 0.8
    out = []
    spacing = [(0.45, 1.5), (0.45, 1.2), (1.5, None), (0.9, None)]
    for z in range(4):
        a = float((zone_mask(z) & ~path).sum() * cell)
        sp = spacing[z]
        q = [round(a / (sp[0] ** 2))] + ([round(a / (sp[1] ** 2))] if sp[1] else [])
        out.append({'zone': PLANT_ZONES[z][0], 'area_m2': round(a), 'plants': PLANT_ZONES[z][1], 'qty': q})
    return out


def sheet_planting(pdf, pq):
    fig = sheet('Planting plan', 'L-101', 'Native coastal species by zone')
    ax = plan_axes(fig)
    hillshade(ax, P)
    path = np.abs(X - G.PATH_X) < 0.8
    for z, (name, _, col, *_r) in enumerate(PLANT_ZONES):
        m = zone_mask(z) & ~path
        ax.contourf(XS, SS, m.astype(float), levels=[0.5, 1.5], colors=[col], alpha=0.75, zorder=2)
    for x, s in TREES:
        ax.add_patch(plt.Circle((x, s), 2.5, fc='#2f7a3a', alpha=0.6, ec=INK, lw=0.5, zorder=5)); ax.text(x, s, 'KOU', ha='center', va='center', fontsize=6, color='white')
    ax.add_patch(Rectangle((G.PATH_X - 0.8, -18), 1.6, 27, fc='#f3ecd9', ec='#8b6a4a', lw=0.8, zorder=4))
    for s in np.arange(-16, 9, 1.5):
        for dx in (-0.95, 0.95):
            ax.plot(G.PATH_X + dx, s, 'o', ms=2, color='#8b6a4a', zorder=6)
    ax.text(G.PATH_X + 1.4, -17, 'rope & post edging @ 1.5 m', fontsize=5.5)
    ax.text(-1, 6.8, 'movable loungers (no fixed structures in setback)', fontsize=6, color=MUTED)
    base_features(ax, True)
    tab = fig.add_axes([0.05, 0.07, 0.42, 0.13]); tab.axis('off')
    rows = [[q['zone'], q['plants'], f"{q['area_m2']} m²", ' + '.join(str(v) for v in q['qty'])] for q in pq] + [['Trees', 'Kou 15-gal', '-', '2']]
    t = tab.table(cellText=rows, colLabels=['Zone', 'Species & spacing', 'Area', 'Qty'], loc='center', cellLoc='left', colWidths=[0.2, 0.5, 0.12, 0.18])
    t.auto_set_font_size(False); t.set_fontsize(6.5); t.scale(1, 1.25)
    for k, (_, _, col, *_r) in enumerate(PLANT_ZONES):
        t[(k + 1, 0)].set_facecolor(col)
    pdf.savefig(fig); fig.savefig(os.path.join(ROOT, 'img', 'sheet_L-101.png'), dpi=110); plt.close(fig)


def sheet_details(pdf):
    fig = sheet('Typical section and details', 'C-501')
    ax = fig.add_axes([0.05, 0.50, 0.73, 0.44])
    face0 = 1.0 - (CREST - G.ZB) * G.FORE
    u = np.linspace(face0 - BERM_W - 8, 9, 400)
    z = np.where(u < face0 - BERM_W, G.ZB - (face0 - BERM_W - u) * 0.1,
        np.where(u < face0, G.ZB, np.where(u < 1.0, G.ZB + (u - face0) / G.FORE,
        np.where(u < 1.0 + G.CREST, CREST, np.maximum(2.85, CREST - (u - 1.0 - G.CREST) / G.BACK)))))
    ex = np.where(u < -0.6, 1.45 + 0.09 * (u + 0.6), np.where(u < 0, 1.45 + (2.85 - 1.45) * (u + 0.6) / 0.6, 2.85))
    ax.fill_between(u, -0.5, ex, color='#c9b48a'); ax.fill_between(u, ex, z, where=z > ex, color='#e8d6a8', hatch='....', edgecolor='#b89f6c')
    ax.plot(u, ex, '--', color='#6b5a40', lw=1); ax.plot(u, z, color=INK, lw=1.6)
    ax.set_ylim(-0.5, 5); ax.set_xlim(u[0], u[-1]); ax.set_aspect(1.5); ax.grid(color='#e3e8e5', lw=0.4)
    ax.set_title('TYPICAL SECTION (vertical exaggeration 1.5x)', fontsize=9, loc='left', weight='bold')
    dims = [((face0 - BERM_W, face0), G.ZB + 0.25, f'BERM {BERM_W:.1f} m @ +2.0'), ((face0, 1.0), G.ZB + 1.25, f'DUNE FACE 1:{G.FORE:.0f}'),
            ((1.0, 1.0 + G.CREST), CREST + 0.35, f'CREST {G.CREST} m @ +{CREST:.1f}'), ((1.0 + G.CREST, 1.0 + G.CREST + (CREST - 2.85) * G.BACK), CREST + 0.9, f'BACK SLOPE 1:{G.BACK:.0f}')]
    for (a, b), y, t in dims:
        ax.annotate('', xy=(a, y), xytext=(b, y), arrowprops=dict(arrowstyle='<->', lw=0.6)); ax.text((a + b) / 2, y + 0.08, t, ha='center', fontsize=6.5)
    ax.text(-0.3, 1.0, "TODAY'S\nSCARP", fontsize=6.5, ha='right'); ax.text(u[0] + 0.5, 0.1, 'existing beach (dashed)', fontsize=6.5, color='#6b5a40')
    for k, (zz, lab) in enumerate(((MHHW, 'MHHW +0.35'), (SLR2100, '2100 MHHW +1.33'))):
        ax.axhline(zz, color='#2a7fa3', lw=0.6, ls=':'); ax.text(u[0] + 0.5, zz + 0.07, lab, fontsize=6, color='#2a7fa3')
    # detail panels
    d1 = fig.add_axes([0.05, 0.07, 0.22, 0.36]); d1.set_title('DETAIL 1 · PATH THROUGH DUNE', fontsize=8, loc='left', weight='bold')
    d1.plot([0, 2, 3.6, 5.6], [2.0, 2.95, 2.95, 2.95], color=INK, lw=1.5)
    for xp in (2.2, 3.4): d1.plot([xp, xp], [2.95, 3.75], color='#8b6a4a', lw=3); d1.plot([2.2, 3.4], [3.6, 3.6], color='#8b6a4a', lw=0.8)
    d1.text(2.8, 3.85, '1.6 m', ha='center', fontsize=6.5); d1.text(0.2, 2.3, 'max slope 1:6', fontsize=6.5)
    d1.text(0.1, 1.55, 'Posts: recycled-plastic or naturally\nrot-resistant timber, 100 mm,\n1.2 m long, 0.8 m exposed, @ 1.5 m.\n19 mm manila rope. Path surface:\nbeach sand, no paving.', fontsize=6, va='top')
    d1.set_xlim(0, 5.6); d1.set_ylim(0.2, 4.2); d1.axis('off')
    d2 = fig.add_axes([0.30, 0.07, 0.22, 0.36]); d2.set_title('DETAIL 2 · SAND FENCE (temporary)', fontsize=8, loc='left', weight='bold')
    for xp in np.arange(0.5, 5.5, 0.15): d2.plot([xp, xp], [2.0, 3.2], color='#8b6a4a', lw=1.2)
    d2.plot([0.3, 5.5], [2.0, 2.0], color=INK); d2.text(0.3, 1.6, 'Wood slat fence, 1.2 m high, 50% porosity,\nset at the berm/dune toe parallel to shore,\nremoved when plants hold the surface\n(1-2 years).', fontsize=6, va='top')
    d2.set_xlim(0, 5.8); d2.set_ylim(0.2, 4.2); d2.axis('off')
    d3 = fig.add_axes([0.55, 0.07, 0.23, 0.36]); d3.set_title('DETAIL 3 · PLANTING', fontsize=8, loc='left', weight='bold')
    for k, (yy, lab) in enumerate(((3.6, 'ʻAkiʻaki plugs, triangular grid @ 0.45 m'), (2.8, 'Pōhuehue / nanea 1-gal @ 1.2-1.5 m'),
                                   (2.0, 'Naupaka 3-gal @ 1.5 m on crest'), (1.2, 'Drip line @ 0.6 m, 12-18 months'))):
        for xp in np.arange(0.4, 2.4, 0.45 if k == 0 else 0.9): d3.plot(xp, yy, 'o', ms=3 if k == 0 else 5, color=['#8fae4a', '#3f8a3a', '#2f7f3a', '#2a7fa3'][k])
        d3.text(2.6, yy, lab, fontsize=6, va='center')
    d3.set_xlim(0, 7); d3.set_ylim(0.6, 4.2); d3.axis('off')
    pdf.savefig(fig); fig.savefig(os.path.join(ROOT, 'img', 'sheet_C-501.png'), dpi=110); plt.close(fig)


def sheet_quantities(pdf, pq):
    fig = sheet('Quantities, sequence and maintenance', 'C-601')
    ax = fig.add_axes([0.05, 0.52, 0.72, 0.42]); ax.axis('off')
    o = design['optimal']; o.setdefault('topUps', {'events': 0, 'importedYd3': 0, 'backpassedYd3': 0})
    rows = [['Beach-compatible sand, beach & dune face (OCCL)', f'{beach_m3 / YD3:,.0f} yd³', f'{beach_m3:,.0f} m³'],
            ['Beach-compatible sand, lawn dune (County)', f'{dune_m3 / YD3:,.0f} yd³', f'{dune_m3:,.0f} m³'],
            ['Truckloads (15 yd³)', f'{(beach_m3 + dune_m3) / YD3 / 15:,.0f}', ''],
            ['Planted area', f"{sum(q['area_m2'] for q in pq):,} m²", ''],
            ['Plants (plugs + containers)', f"{sum(sum(q['qty']) for q in pq):,}", '+ 2 kou trees'],
            ['Rope-and-post edging', '2 x 26 m', '36 posts'],
            ['Sand fence (temporary)', f'{G.FRONT[1] - G.FRONT[0]:.0f} m', ''],
            ['Top-up policy', o['design'].get('trigger') and f"when berm sand < {o['design']['trigger']} m³/m" or f"every {o['design'].get('interval')} yr", f"{o['design']['topUpYd3']} yd³ per event"],
            ['Expected top-ups in 50 years (central case)', f"{o['topUps']['events']}", f"{o['topUps']['importedYd3']:,} yd³ imported, {o['topUps']['backpassedYd3']:,} yd³ recycled"]]
    t = ax.table(cellText=rows, colLabels=['QUANTITY', 'AMOUNT', 'NOTE'], loc='upper left', cellLoc='left', colWidths=[0.5, 0.2, 0.3])
    t.auto_set_font_size(False); t.set_fontsize(8); t.scale(1, 1.6)
    seq = ['CONSTRUCTION SEQUENCE (calm season, about 6-8 weeks)',
           '1. Pre-construction survey; stake limits of work and the certified shoreline; archaeological monitor on site.',
           '2. Protect lawn haul route with mats; cut and cap exposed irrigation; remove debris from the scarp face.',
           '3. Place and shape the lawn dune (landward of the shoreline) to crest +%.1f m; track-walk lightly.' % CREST,
           '4. Place beach sand against the bank from the west end eastward; shape the 1:3 dune face and +2.0 m berm.',
           '5. Install sand fence at the berm/dune toe; set path posts and rope; surface the path with beach sand.',
           '6. Install drip irrigation; plant from crest down to the face; plant kou trees on the lawn.',
           '7. As-built survey and photo report to OCCL and the County.',
           '',
           'MONITORING & MAINTENANCE',
           '- Owner: fixed-point photos and tape measurements monthly in winter and after big swells; drone or phone survey each spring.',
           '- Engineer: profile survey and report every 3 years, or when a trigger is reached.',
           '- Top up early if the berm is narrower than 4 m or a new scarp taller than 0.5 m forms.',
           '- Recycle sand that has drifted along the beach (with OCCL approval) before buying new sand.']
    for k, s in enumerate(seq):
        fig.text(0.05, 0.46 - k * 0.028, s, fontsize=8, weight='bold' if s.isupper() or s.endswith('weeks)') else 'normal', color=INK)
    pdf.savefig(fig); fig.savefig(os.path.join(ROOT, 'img', 'sheet_C-601.png'), dpi=110); plt.close(fig)


def grids_for_3d():
    k = 2                                   # 1 m grid for the web model
    sl = (slice(None, None, k), slice(None, None, k))
    return {'x': XS[::k].round(2).tolist(), 's': SS[::k].round(2).tolist(),
            'existing': np.round(E[sl], 2).tolist(), 'designed': np.round(P[sl], 2).tolist(),
            'control': np.round(C[::k], 2).tolist(), 'front': list(G.FRONT), 'path_x': G.PATH_X, 'crest': CREST,
            'house': HOUSE, 'tower': TOWER, 'wall': [list(p) for p in WALL[::2]], 'wall_toe': [list(p) for p in WALL_TOE[::2]], 'trees': TREES}


if __name__ == '__main__':
    pq = plant_quantities()
    write_dxf(os.path.join(ROOT, 'cad', 'Laulea_living_shoreline_concept.dxf'))
    with PdfPages(os.path.join(ROOT, 'cad', 'Laulea_living_shoreline_concept.pdf')) as pdf:
        sheet_cover(pdf); sheet_existing(pdf); sheet_grading(pdf); sheet_sections(pdf)
        sheet_planting(pdf, pq); sheet_details(pdf); sheet_quantities(pdf, pq)
    out = {'berm_width_m': round(BERM_W, 1), 'crest': CREST, 'beach_fill_yd3': round(beach_m3 / YD3), 'dune_fill_yd3': round(dune_m3 / YD3),
           'cut_m3': round(float(CUT.sum() * G.STEP ** 2), 1), 'planting': pq, 'grid': grids_for_3d()}
    json.dump(out, open(os.path.join(ROOT, 'data', 'grading.json'), 'w'))
    print('berm', round(BERM_W, 1), 'm; beach', round(beach_m3 / YD3), 'yd3; dune', round(dune_m3 / YD3), 'yd3; planting', pq)
