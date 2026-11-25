// Design optimisation with value engineering and Monte Carlo reliability.
//
// 1. Screen: every combination of lawn-dune height, initial beach sand,
//    top-up volume, top-up policy (fixed interval or monitoring trigger) and
//    sand backpassing, run through the calibrated model (central parameters,
//    50 real-winter years with sea-level rise to +0.98 m by 2100).
// 2. Reliability: the cheapest screened designs are re-run across N Monte
//    Carlo parameter sets. Each set samples the uncertain inputs and is
//    re-calibrated to a sampled long-term retreat rate; sets that cannot
//    reproduce it are rejected (joint calibration).
// 3. Choose the cheapest design whose bank stays within 2 m of today's
//    position through 2076 in >= 90% of accepted sets, and compare it with
//    the earlier (fixed-interval, no value engineering) design.
//
// Usage: node shoreline-sim/tools/optimize.js  -> data/design.json
const fs = require('fs');
const path = require('path');
const M = require('../model.js');
const data = require('../data/winters.json');

const YD3 = 0.764555, FT = 3.28084;
const full = data.seasons.filter((s) => s.coverage > 0.9);
const FRONT = 30;               // m, 461's open frontage (2023 lidar)
const RATE = 0.49;              // m/yr measured long-term retreat (UH/USGS transect 599)
const YEARS = 50, DISCOUNT = 0.03, N_MC = Number(process.env.N_MC || 100);
const DUNE_YD3 = { 0.4: 141, 0.6: 180, 0.8: 226 };   // lawn-dune fill from grading.py (crest +3.3/+3.5/+3.7)
const MAX_INITIAL = 1500;       // yd3: 1,500 yd3 already gives an 11 m berm on this frontage (grading.py)

const central = { scarpFactor: M.calibrateScarp({}, { vegetation: 0.3 }, full, RATE) };

// ---- cost model (2026 USD, small Maui job; [low, high]) ----
const C = {
  sandPerYd3: [150, 250], backpassPerYd3: [25, 50], sandMobilise: [6000, 12000],
  coirPerLfPerTier: [90, 200], plantsPerM2: [35, 80], irrigation: [3000, 8000], sandFence: [2000, 5000],
  accessPath: [2500, 7000], pipeReroute: [1000, 3000], survey: [10000, 25000], engineering: [25000, 60000],
  permitting: [20000, 55000], archMonitor: [3000, 10000], contingency: 0.2,
  plantCarePerYr: [2000, 5000], monitoringPro: [2000, 5000], monitoringOwner: [700, 1800], proCheckEvery: 3,
  topUpReport: [3000, 8000],
};

function capital(d, i) {
  const sandYd3 = d.initialYd3 + DUNE_YD3[d.crestRaise];
  const plantedArea = FRONT * 11;
  const items = {
    'Certified shoreline & beach survey': C.survey[i],
    'Coastal engineering & construction observation': C.engineering[i],
    'Permits, sand testing & environmental reports': C.permitting[i],
    'Archaeological monitoring': C.archMonitor[i],
    'Compatible sand (beach + dune), delivered & placed': sandYd3 * C.sandPerYd3[i] + C.sandMobilise[i],
    'Native planting': plantedArea * C.plantsPerM2[i],
    'Establishment irrigation': C.irrigation[i],
    'Sand fencing': C.sandFence[i],
    'Beach access path & dune crossover': C.accessPath[i],
    'Remove / reroute exposed irrigation': C.pipeReroute[i],
  };
  const sub = Object.values(items).reduce((a, b) => a + b, 0);
  items['Contingency (20%)'] = sub * C.contingency;
  return { items, total: sub * (1 + C.contingency), sandYd3, plantedArea };
}

// cost of the life cycle given the top-up events the model actually triggered
function lifeCycle(d, proj, i) {
  let v = capital(d, i).total, events = 0, imported = 0, backpassed = 0;
  proj.forEach((r, y) => {
    if (y === 0) return;
    const df = Math.pow(1 + DISCOUNT, -y);
    const ownerMon = d.ownerMonitoring;
    const mon = ownerMon ? (C.monitoringOwner[i] + (y % C.proCheckEvery === 0 ? C.monitoringPro[i] : 0)) : C.monitoringPro[i];
    v += (C.plantCarePerYr[i] + mon) * df;
    if (r.topUp) {
      const imp = r.topUp.imported / YD3, bp = r.topUp.backpassed / YD3;
      v += (imp * C.sandPerYd3[i] + bp * C.backpassPerYd3[i] + C.sandMobilise[i] + C.topUpReport[i]) * df;
      events++; imported += imp; backpassed += bp;
    }
  });
  return { npv: v, events, imported, backpassed };
}

function designFor(d) {
  return { vegetation: 1, nourishVolume: d.initialYd3 * YD3, nourishLength: FRONT, crestRaise: d.crestRaise };
}
function run(d, site, proj = {}) {
  return M.project(site, designFor(d), full, {
    years: YEARS, slr2100: 0.98, renourishEvery: d.interval || 0, trigger: d.trigger || 0, minGap: 2,
    backpassFrac: d.backpass || 0, topUpVolume: d.topUpYd3 * YD3, ...proj });
}
function evaluate(d, site = central, proj = {}) {
  const p = run(d, site, proj);
  const lo = lifeCycle(d, p, 0), hi = lifeCycle(d, p, 1);
  return { r2076: p.at(-1).retreat, p, npvLow: lo.npv, npvHigh: hi.npv, events: lo.events, imported: lo.imported, backpassed: lo.backpassed };
}

// ---- 1. deterministic screen ----
const cands = [];
for (const crestRaise of [0.8])   // crest +3.7 m: clears the record winter runup (+3.56 m) today; raise later with sea level
  for (const initialYd3 of [1000, 1250, 1500])
    for (const topUpYd3 of [250, 400, 499, 750])
      for (const pol of [...[2, 3, 4].map((n) => ({ interval: n })), ...[8, 10, 12, 15].map((t) => ({ trigger: t }))]) {
        // backpassing is tested in the value-engineering ladder; it lowers reliability, so it is not searched here
        const ownerMonitoring = !!pol.trigger;                       // owner monitoring pairs with a survey trigger
        cands.push({ crestRaise, initialYd3, topUpYd3, ...pol, backpass: 0, ownerMonitoring });
      }
const screened = cands.map((d) => ({ d, ...evaluate(d) })).filter((r) => r.r2076 <= 1.0);
screened.sort((a, b) => (a.npvLow + a.npvHigh) - (b.npvLow + b.npvHigh));
console.log('screened', cands.length, 'pass central case', screened.length);

// ---- 2. Monte Carlo parameter sets (joint calibration) ----
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const r = rng(20261125);
const U = (a, b) => a + (b - a) * r();
const N = (m, sd) => m + sd * Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
const tri = (a, m, b) => { const u = r(), f = (m - a) / (b - a); return u < f ? a + Math.sqrt(u * (b - a) * (m - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - m)); };
const sets = [];
let rejected = 0;
while (sets.length < N_MC && sets.length + rejected < N_MC * 3) {
  const site = {
    reefTransmission: U(0.42, 0.52), Cs: 1.7e-4 * Math.exp(N(0, 0.45)), cellLoss: U(0.15, 0.35),
    recoveryRate: U(0.03, 0.08), profileLoss: U(0.2, 0.4), foreshoreSlope: U(0.075, 0.105), naturalBermMax: U(4, 8),
    waveScale: N(1, 0.05),
  };
  const rate = Math.min(0.9, Math.max(0.2, N(RATE, 0.23)));
  const f = M.calibrateScarp(site, { vegetation: 0.3 }, full, rate);
  const check = M.project({ ...site, scarpFactor: f }, { vegetation: 0.3 }, full, { years: 9, slr2100: 0 }).at(-1).retreat / 9;
  if (Math.abs(check - rate) > 0.05) { rejected++; continue; }
  const order = Array.from({ length: YEARS }, () => Math.floor(r() * full.length));
  sets.push({ site: { ...site, scarpFactor: f }, rate, slr2100: tri(0.6, 0.98, 1.6), order });
}
console.log('Monte Carlo sets', sets.length, 'rejected', rejected);

function reliability(d, n) {
  let ok = 0, safe = 0; const r76 = [];
  const use = n ? sets.slice(0, n) : sets;
  for (const s of use) {
    const v = run(d, s.site, { slr2100: s.slr2100, order: s.order }).at(-1).retreat;
    r76.push(v); if (v <= 2) ok++; if (v < 11) safe++;
  }
  r76.sort((a, b) => a - b);
  return { pWithin2m: ok / use.length, pHouseSafe: safe / use.length, median: r76[Math.floor(r76.length / 2)], p90: r76[Math.floor(r76.length * 0.9)] };
}

// ---- 3. choose ----
const mid = (x) => x.npvLow + x.npvHigh;
// quick reliability on 30 futures for every screened design, then confirm the best on all of them
const quick = screened.map((x) => ({ ...x, q: reliability(x.d, 30).pWithin2m }));
const promising = quick.filter((x) => x.q >= 0.87).sort((a, b) => mid(a) - mid(b)).slice(0, 10);
console.log('quick-screened', quick.length, 'promising', promising.length);
const shortlist = (promising.length ? promising : quick.sort((a, b) => b.q - a.q).slice(0, 6)).map((x) => ({ ...x, rel: reliability(x.d) }));
const reliable = shortlist.filter((x) => x.rel.pWithin2m >= 0.9).sort((a, b) => mid(a) - mid(b));
const rec = reliable[0] || shortlist.sort((a, b) => b.rel.pWithin2m - a.rel.pWithin2m)[0];
console.log('recommended', JSON.stringify(rec.d), 'P(within 2 m)', rec.rel.pWithin2m, 'npv', Math.round(rec.npvLow), Math.round(rec.npvHigh));

// earlier design (v1), re-run on the corrected 30 m frontage for a fair comparison
const v1 = { crestRaise: 0.6, initialYd3: 1500, topUpYd3: 250, interval: 3, backpass: 0, ownerMonitoring: false };
const v1e = { ...evaluate(v1), d: v1 }; v1e.rel = reliability(v1);

function describe(x, label) {
  const capL = capital(x.d, 0), capH = capital(x.d, 1);
  return {
    label, design: x.d,
    retreat2076: +x.r2076.toFixed(2), reliability: x.rel,
    trajectory: x.p.map((q) => ({ year: q.year, retreat: +q.retreat.toFixed(2), buffer: +q.buffer.toFixed(1), topUp: !!q.topUp })),
    topUps: { events: x.events, importedYd3: Math.round(x.imported), backpassedYd3: Math.round(x.backpassed) },
    sandFirstYd3: Math.round(capL.sandYd3), duneYd3: DUNE_YD3[x.d.crestRaise], plantedAreaM2: capL.plantedArea,
    capital: { low: Math.round(capL.total), high: Math.round(capH.total),
               items: Object.keys(capL.items).map((k) => ({ item: k, low: Math.round(capL.items[k]), high: Math.round(capH.items[k]) })) },
    npv50: { low: Math.round(x.npvLow), high: Math.round(x.npvHigh) },
  };
}

// value-engineering ladder: start from v1 and add one measure at a time
const ladder = [];
const step = (name, d) => { const e = { ...evaluate(d), d }; e.rel = reliability(d); ladder.push({ name, d, npvLow: Math.round(e.npvLow), npvHigh: Math.round(e.npvHigh), pWithin2m: e.rel.pWithin2m, events: e.events }); };
step('Earlier design: 1,500 yd³ + 250 yd³ every 3 yr', v1);
step('+ Top up on a survey trigger instead of a clock', { ...v1, interval: 0, trigger: rec.d.trigger || 12 });
step('+ Owner-led monitoring, engineer check every 3 yr', { ...v1, interval: 0, trigger: rec.d.trigger || 12, ownerMonitoring: true });
step('Tested, not adopted: recycle drifted sand (30%)', { ...v1, interval: 0, trigger: rec.d.trigger || 12, ownerMonitoring: true, backpass: 0.3 });
step('+ Right-size sand volumes (recommended)', rec.d);

const noneP = M.project(central, { vegetation: 0.3 }, full, { years: YEARS, slr2100: 0.98 });
const noneRel = reliability({ crestRaise: 0, initialYd3: 0, topUpYd3: 0, interval: 0 });
const result = {
  generated: new Date().toISOString().slice(0, 10),
  assumptions: { frontageM: FRONT, calibrationRate: RATE, reefWindow: [0.42, 0.52], years: YEARS, discount: DISCOUNT, costs: C,
                 maxInitialYd3: MAX_INITIAL, mcSets: sets.length, mcRejected: rejected, target: 'bank within 2 m of today through 2076 in >= 90% of Monte Carlo futures' },
  screened: cands.length, passCentral: screened.length,
  doNothing: { trajectory: noneP.map((q) => ({ year: q.year, retreat: +q.retreat.toFixed(2) })), houseYear: (noneP.find((q) => q.retreat >= 11) || {}).year || null, reliability: noneRel },
  optimal: describe(rec, 'Recommended (value-engineered)'),
  earlier: describe(v1e, 'Earlier design on the corrected frontage'),
  ladder,
  shortlist: shortlist.slice(0, 12).map((x) => ({ d: x.d, npvLow: Math.round(x.npvLow), npvHigh: Math.round(x.npvHigh), pWithin2m: x.rel.pWithin2m, pHouseSafe: x.rel.pHouseSafe })),
};
fs.writeFileSync(path.join(__dirname, '..', 'data', 'design.json'), JSON.stringify(result, null, 1));
console.log('ladder'); ladder.forEach((l) => console.log(' ', l.name.padEnd(52), l.npvLow, l.npvHigh, 'P', l.pWithin2m.toFixed(2), 'events', l.events));
console.log('do nothing house year', result.doNothing.houseYear, 'P(house safe)', noneRel.pHouseSafe);
