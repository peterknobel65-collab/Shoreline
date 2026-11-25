// Run with:  node --test shoreline-sim/test
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../model.js');
const data = require('../data/winters.json');
const full = data.seasons.filter((s) => s.coverage > 0.9);

test('Stockdon runup matches a hand calculation', () => {
  // H0 = 2 m, T = 12 s, beta = 0.1: L0 = 224.8 m, sqrt(H0 L0) = 21.20
  // setup = 0.35*0.1*21.20 = 0.742 ; swash = sqrt(449.6*0.00963)=2.081 ; R2 = 1.1*(0.742+1.040)
  assert.ok(Math.abs(M.runupStockdon(2, 12, 0.1) - 1.960) < 0.01);
  assert.equal(M.runupStockdon(0, 12, 0.1), 0);
});

test('refraction: shore-normal waves unchanged, offshore-directed waves tiny', () => {
  assert.ok(Math.abs(M.refraction(10, 10) - 1) < 1e-9);
  assert.ok(M.refraction(330, 10) < 1 && M.refraction(330, 10) > 0.8);
  assert.equal(M.refraction(190, 10), 0.15);
});

test('dataset is real and plausible', () => {
  assert.ok(full.length >= 3);
  for (const s of data.seasons) {
    assert.equal(s.hs.length, s.hours);
    assert.ok(s.hs_max > 3 && s.hs_max < 10);
  }
});

test('placed sand never increases on its own (mass is conserved or lost)', () => {
  const r = M.runSeason({}, { nourishVolume: 500, nourishLength: 30 }, full[0], { series: false });
  const placed = 500 * (1 - M.DEFAULT_SITE.profileLoss);
  assert.ok(r.state.nTotal <= placed + 1e-6);
  assert.ok(r.state.nFront >= 0);
});

test('more protection never means more retreat', () => {
  const site = { scarpFactor: M.calibrateScarp({}, { vegetation: 0.3 }, full, 0.3) };
  const run = (d) => M.project(site, d, full, { years: 20 }).at(-1).retreat;
  const none = run({ vegetation: 0.3 });
  const plants = run({ vegetation: 1 });
  const sand = run({ vegetation: 1, nourishVolume: 400, nourishLength: 110 });
  const bigSand = run({ vegetation: 1, nourishVolume: 2300, nourishLength: 110 });
  assert.ok(plants <= none, `plants ${plants} vs none ${none}`);
  assert.ok(sand <= plants, `sand ${sand} vs plants ${plants}`);
  assert.ok(bigSand <= sand, `bigSand ${bigSand} vs sand ${sand}`);
});

test('higher sea level and bigger waves mean more retreat', () => {
  const site = { scarpFactor: 0.02 };
  const base = M.runSeason(site, {}, full[0], { series: false }).summary.retreat;
  const slr = M.runSeason({ ...site, slr: 0.3 }, {}, full[0], { series: false }).summary.retreat;
  const big = M.runSeason({ ...site, waveScale: 1.3 }, {}, full[0], { series: false }).summary.retreat;
  assert.ok(slr > base && big > base);
});

test('calibration reproduces the target retreat rate', () => {
  const f = M.calibrateScarp({}, { vegetation: 0.3 }, full, 0.3);
  const years = 3 * full.length;
  const p = M.project({ scarpFactor: f }, { vegetation: 0.3 }, full, { years, slr2100: 0 });
  assert.ok(Math.abs(p.at(-1).retreat / years - 0.3) < 0.02);
});
