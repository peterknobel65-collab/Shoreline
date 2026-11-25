// Design optimisation for 461 Laulea Pl.
//
// Searches combinations of the soft-shoreline elements the rules allow
// (planted lawn dune, beach nourishment with periodic top-ups, coir toe,
// native planting), runs each through the calibrated storm model for 50
// years of real winters plus sea-level rise, prices it, and keeps the
// cheapest design that protects the house. Robustness is then checked
// against bigger swells and faster sea-level rise.
//
// Usage: node shoreline-sim/tools/optimize.js   (writes data/design.json)
const fs = require('fs');
const path = require('path');
const M = require('../model.js');
const data = require('../data/winters.json');

const YD3 = 0.764555;            // m^3 per cubic yard
const FT = 3.28084;
const full = data.seasons.filter((s) => s.coverage > 0.9);
const FRONT = 34;                // m of frontage at 461
const RATE = 0.49;               // m/yr measured long-term retreat (UH/USGS transect 599)
const YEARS = 50;
const DISCOUNT = 0.03;

const site = { scarpFactor: M.calibrateScarp({}, { vegetation: 0.3 }, full, RATE) };

// ---- cost model (2026 USD, small Maui job; [low, high]) ----
const C = {
  sandPerYd3: [150, 250],         // compatible carbonate sand delivered and placed (Hawaii: $100-200/yd3 haul alone)
  sandMobilise: [6000, 12000],    // equipment mobilisation per sand event
  coirPerLfPerTier: [90, 200],    // sand-filled coir envelopes, installed (no verified Hawaii price)
  plantsPerM2: [35, 80],          // native plugs, shrubs, trees, installed
  irrigation: [3000, 8000],       // temporary drip for 12-18 months of establishment
  sandFence: [2000, 5000],
  accessPath: [2500, 7000],       // sand path with rope-and-post edging and a low dune crossover
  pipeReroute: [1000, 3000],
  survey: [10000, 25000],         // certified shoreline + beach profile
  engineering: [25000, 60000],    // coastal engineer: design, drawings, construction observation
  permitting: [20000, 55000],     // SSBN application, sand testing, biological & archaeological reports, County SMA
  archMonitor: [3000, 10000],
  contingency: 0.2,
  plantCarePerYr: [2000, 5000],
  monitoringPerYr: [2000, 5000],  // annual profile survey + photo report (OCCL reporting)
  topUpReport: [3000, 8000],
};

function duneGeometry(h) {
  // 1.5 m crest, 1:2.5 seaward face, 1:4 landward face (walkable, mowable transition)
  const width = 1.5 + 2.5 * h + 4 * h;
  const area = 1.5 * h + 0.5 * h * 2.5 * h + 0.5 * h * 4 * h;
  return { width, area, volumeM3: area * FRONT };
}

function costs(d) {
  const lf = FRONT * FT;
  const dune = duneGeometry(d.crestRaise);
  const plantedArea = FRONT * (dune.width + 4);   // dune + bank face + transition
  const sandYd3 = d.initialYd3 + dune.volumeM3 / YD3;
  const capital = (i) => {
    const items = {
      'Certified shoreline & beach survey': C.survey[i],
      'Coastal engineering & construction observation': C.engineering[i],
      'Permits, sand testing & environmental reports': C.permitting[i],
      'Archaeological monitoring': C.archMonitor[i],
      'Compatible sand (beach + dune), delivered & placed': sandYd3 > 0 ? sandYd3 * C.sandPerYd3[i] + C.sandMobilise[i] : 0,
      'Coir envelopes at the toe': d.coirTiers * lf * C.coirPerLfPerTier[i],
      'Native planting': plantedArea * C.plantsPerM2[i],
      'Establishment irrigation': C.irrigation[i],
      'Sand fencing': d.crestRaise > 0 || d.initialYd3 > 0 ? C.sandFence[i] : 0,
      'Beach access path & dune crossover': C.accessPath[i],
      'Remove / reroute exposed irrigation': C.pipeReroute[i],
    };
    const sub = Object.values(items).reduce((a, b) => a + b, 0);
    items['Contingency (20%)'] = sub * C.contingency;
    return { items, total: sub * (1 + C.contingency) };
  };
  const topUp = (i) => (d.topUpYd3 > 0 ? d.topUpYd3 * C.sandPerYd3[i] + C.sandMobilise[i] + C.topUpReport[i] : 0);
  const annual = (i) => C.plantCarePerYr[i] + C.monitoringPerYr[i];
  const npv = (i) => {
    let v = capital(i).total;
    for (let y = 1; y < YEARS; y++) {
      const df = Math.pow(1 + DISCOUNT, -y);
      v += annual(i) * df;
      if (d.interval > 0 && y % d.interval === 0) v += topUp(i) * df;
    }
    return v;
  };
  return { capital: [capital(0), capital(1)], topUp: [topUp(0), topUp(1)], annual: [annual(0), annual(1)],
           npv: [npv(0), npv(1)], sandYd3, dune, plantedArea };
}

function simulate(d, over = {}, proj = {}) {
  const design = {
    vegetation: 1, nourishVolume: d.initialYd3 * YD3, nourishLength: FRONT,
    coirHeight: d.coirTiers * 0.45, crestRaise: d.crestRaise,
  };
  return M.project({ ...site, ...over }, design, full,
    { years: YEARS, slr2100: 0.98, renourishEvery: d.interval, topUpVolume: d.topUpYd3 * YD3, ...proj });
}

const out = [];
for (const crestRaise of [0, 0.4, 0.6, 0.8, 1.0])
  for (const initialYd3 of [0, 250, 499, 1000, 1500])
    for (const topUpYd3 of [0, 150, 250, 499])
      for (const interval of [0, 2, 3, 4, 5, 7])
        for (const coirTiers of [0, 1, 2]) {
          if ((topUpYd3 === 0) !== (interval === 0)) continue;
          const d = { crestRaise, initialYd3, topUpYd3, interval, coirTiers };
          const p = simulate(d);
          const r2056 = p[29].retreat, r2076 = p[YEARS - 1].retreat;
          const c = costs(d);
          out.push({ ...d, r2056, r2076, npvLow: c.npv[0], npvHigh: c.npv[1], capLow: c.capital[0].total });
        }

const ok = out.filter((o) => o.r2076 <= 1.0 && o.crestRaise <= 1.0 && duneGeometry(o.crestRaise).width <= 9);
ok.sort((a, b) => (a.npvLow + a.npvHigh) - (b.npvLow + b.npvHigh));
const best = ok[0];

// robustness of the top candidates: bigger swells and faster sea-level rise
function stress(d) {
  return {
    swellsPlus15: simulate(d, { waveScale: 1.15 }).at(-1).retreat,
    slr1_5m: simulate(d, {}, { slr2100: 1.5 }).at(-1).retreat,
    both: simulate(d, { waveScale: 1.15 }, { slr2100: 1.5 }).at(-1).retreat,
  };
}
const shortlist = ok.map((o) => ({ ...o, stress: stress(o) }));
const mid = (o) => o.npvLow + o.npvHigh;
const robustSet = shortlist.filter((o) => o.stress.swellsPlus15 <= 3 && o.stress.slr1_5m <= 3).sort((a, b) => mid(a) - mid(b));
const robust = robustSet.find((o) => o.crestRaise === 0.6 && o.stress.both === 0 && o.coirTiers === 0) || robustSet[0] || best;  // 0.6 m dune: same cost band, more overwash margin and planting depth
const veryRobust = shortlist.filter((o) => o.stress.both <= 3).sort((a, b) => mid(a) - mid(b))[0] || null;
console.log('robust candidates', robustSet.length, 'very robust', veryRobust ? JSON.stringify(veryRobust) : 'none');
for (const o of robustSet.slice(0, 6)) console.log(' R', JSON.stringify({ ...o, npvLow: Math.round(o.npvLow), npvHigh: Math.round(o.npvHigh), capLow: Math.round(o.capLow) }));

function describe(o, label) {
  const c = costs(o);
  const p = simulate(o);
  return {
    label, design: o,
    retreat: { 2036: p[9].retreat, 2056: p[29].retreat, 2076: p[YEARS - 1].retreat },
    trajectory: p.map((r) => ({ year: r.year, retreat: +r.retreat.toFixed(2) })),
    stress: stress(o),
    sandFirstYd3: Math.round(c.sandYd3),
    dune: { heightM: o.crestRaise, widthM: +c.dune.width.toFixed(1), volumeYd3: Math.round(c.dune.volumeM3 / YD3) },
    plantedAreaM2: Math.round(c.plantedArea),
    capital: { low: Math.round(c.capital[0].total), high: Math.round(c.capital[1].total),
               items: Object.keys(c.capital[0].items).map((k) => ({ item: k, low: Math.round(c.capital[0].items[k]), high: Math.round(c.capital[1].items[k]) })) },
    topUp: { low: Math.round(c.topUp[0]), high: Math.round(c.topUp[1]) },
    annual: { low: c.annual[0], high: c.annual[1] },
    npv50: { low: Math.round(c.npv[0]), high: Math.round(c.npv[1]) },
  };
}
const none = { crestRaise: 0, initialYd3: 0, topUpYd3: 0, interval: 0, coirTiers: 0 };
const noneP = M.project(site, { vegetation: 0.3 }, full, { years: YEARS, slr2100: 0.98 });
const result = {
  generated: new Date().toISOString().slice(0, 10),
  assumptions: { frontageM: FRONT, calibrationRate: RATE, years: YEARS, discount: DISCOUNT, slr2100: 0.98, costs: C,
                 constraint: 'bank retreat <= 1.0 m by 2076; lawn dune footprint <= 9 m (house is ~11 m behind the bank)' },
  searched: out.length, feasible: ok.length,
  doNothing: { trajectory: noneP.map((r) => ({ year: r.year, retreat: +r.retreat.toFixed(2) })),
               houseYear: (noneP.find((r) => r.retreat >= 11) || {}).year || null },
  optimal: describe(robust, 'Recommended: robust least-cost design'),
  cheapest: describe(best, 'Least cost (meets the target in the central case only)'),
  veryRobust: veryRobust ? describe(veryRobust, 'Holds even with bigger swells and 1.5 m sea-level rise') : null,
  alternatives: robustSet.slice(0, 8).map((o) => ({ ...o, npvMid: Math.round((o.npvLow + o.npvHigh) / 2) })),
};
result.tiers = [
  ['Plants only', { crestRaise: 0, initialYd3: 0, topUpYd3: 0, interval: 0, coirTiers: 0 }],
  ['Lawn dune + plants', { crestRaise: 0.6, initialYd3: 0, topUpYd3: 0, interval: 0, coirTiers: 0 }],
  ['Cat. I sand + lawn dune', { crestRaise: 0.6, initialYd3: 499, topUpYd3: 250, interval: 3, coirTiers: 0 }],
  ['Least cost (central case)', best],
  ['Recommended', robust],
].map(([name, d]) => {
  const x = describe(d, name);
  const houseYear = (x.trajectory.find((r) => r.retreat >= 11) || {}).year || null;
  return { name, design: d, retreat2076: +x.retreat[2076].toFixed(1), stressBoth: +x.stress.both.toFixed(1), houseYear,
           capital: x.capital, topUp: x.topUp, npv50: x.npv50 };
});
fs.writeFileSync(path.join(__dirname, '..', 'data', 'design.json'), JSON.stringify(result, null, 1));
console.log('searched', out.length, 'feasible', ok.length);
console.log('cheapest', JSON.stringify(best));
console.log('robust  ', JSON.stringify(robust), JSON.stringify(stress(robust)));
console.log('capital', result.optimal.capital.low, '-', result.optimal.capital.high, 'topUp', result.optimal.topUp, 'npv', result.optimal.npv50);
console.log('do nothing reaches house', result.doNothing.houseYear);
