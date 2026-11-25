/*
 * Shoreline storm-response model for a scarped, reef-fronted pocket beach.
 *
 * One cross-shore "column" in front of the house is stepped hour by hour
 * through real (or synthetic) offshore waves and measured water levels:
 *
 *   offshore waves (Hs, Tp, direction)
 *     -> refraction to the shore normal (Snell, straight contours)
 *     -> reef / rock-bench transmission (calibration factor)
 *     -> wave runup R2% (Stockdon et al. 2006)
 *     -> total water level  TWL = still water level + sea-level rise + R2%
 *     -> storm-impact regime (Sallenger 2000): swash / collision / overwash
 *     -> dune/scarp erosion by wave impact (Larson, Erikson & Hanson 2004)
 *          dV/dt = 4 Cs (TWL - z_toe)^2 / T          [m^3 per m of shore]
 *        acting first on any sand buffer in front of the scarp (natural berm
 *        or placed nourishment), then on protective toe layers, then on the
 *        scarp itself; scarp retreat = eroded volume / scarp height.
 *     -> alongshore spreading of placed sand inside the pocket beach
 *        (Pelnard-Considere diffusion, first-mode decay)
 *     -> calm-weather natural berm recovery.
 *
 * Every coefficient is exposed so it can be calibrated against measured
 * scarp positions at this site. Units: metres, seconds, degrees true.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShoreModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var g = 9.81;

  var DEFAULT_SITE = {
    shoreNormal: 350,       // deg true the beach faces (UH/USGS transects 596-600 run 170 deg)
    reefTransmission: 0.47, // share of refracted offshore Hs reaching the beach; joint calibration window 0.42-0.52 (measured retreat + intact lawn)
    foreshoreSlope: 0.09,   // tan(beta) of the beach face (2023 lidar: 0 to +1 m over ~11 m)
    runupCal: 1.0,          // multiplier on Stockdon R2%
    toeElev: 1.5,           // m above MSL, base of the bank (lidar 2023 ~+1.7, lowered since per Nov 2026 photos)
    crestElev: 2.9,         // m above MSL, top edge of the bank at 461 (lidar 2023, transect 599)
    houseDistance: 11,      // m, bank edge to roof edge of the house (imagery Jan 2026 on transect 599)
    pocketLength: 110,      // m, sandy shoreline between the two revetments
    frontageLength: 30,     // m, unarmoured frontage in front of the house (2023 lidar)
    Cs: 1.7e-4,             // Larson et al. (2004) wave-impact coefficient for loose sand
    scarpFactor: 0.1,       // erodibility of the cohesive, rooted scarp relative to sand (calibrated)
    profileLoss: 0.3,       // share of placed sand that settles into the nearshore profile
    naturalBermMax: 6,      // m^3/m, sand in a healthy summer berm in front of toe
    naturalBermStart: 1,    // m^3/m in front of the toe at the start of each winter
    recoveryRate: 0.05,     // m^3/m/day natural berm rebuilding when calm
    calmHs: 0.8,            // m, nearshore Hs below which the berm recovers
    scarpToBuffer: 0.3,     // share of eroded scarp material left as sand at its toe
    nearshorePool: 4,       // m^3/m of sand stored just offshore that can return to the berm
    cellLoss: 0.25,         // share of sand stripped from the beach that leaves the pocket for good
    closureDepth: 4,        // m, active profile height (depth of closure + berm) for spreading
    slr: 0,                 // m, sea-level rise added to measured water levels
    waveScale: 1.0          // multiplier on offshore Hs ("what if swells were bigger")
  };

  var DEFAULT_DESIGN = {
    vegetation: 0.3,        // 0..1 cover x maturity of deep-rooted native dune plants
    vegEffect: 0.4,         // max fractional cut in scarp erosion from roots (collision regime)
    nourishVolume: 0,       // m^3 of compatible sand placed
    nourishLength: 30,      // m of shoreline it is spread along
    coirHeight: 0,          // m, height of coir (coconut-fibre) envelopes at the toe
    coirLifeHours: 40,      // hours of direct wave attack before they are torn open
    bagHeight: 0,           // m, height of temporary geotextile sand bags at the toe
    bagLifeHours: 250,      // hours of direct wave attack before failure
    crestRaise: 0           // m, planted sand dune built on the lawn behind the bank edge
  };

  function extend(base, over) {
    var o = {}, k;
    for (k in base) o[k] = base[k];
    if (over) for (k in over) if (over[k] !== undefined) o[k] = over[k];
    return o;
  }

  /** Refraction coefficient from offshore angle to a shore-normal breaker angle. */
  function refraction(dirFrom, shoreNormal) {
    var th = ((dirFrom - shoreNormal + 540) % 360) - 180;   // -180..180
    var a = Math.abs(th);
    if (a >= 90) return 0.15;                              // wrap-around / diffraction residual
    return Math.max(0.15, Math.sqrt(Math.cos(a * Math.PI / 180)));
  }

  /** Stockdon et al. (2006) 2% exceedance runup, m above still water level. */
  function runupStockdon(H0, T, beta) {
    if (H0 <= 0 || T <= 0) return 0;
    var L0 = g * T * T / (2 * Math.PI);
    var HL = Math.sqrt(H0 * L0);
    var setup = 0.35 * beta * HL;
    var swash = Math.sqrt(H0 * L0 * (0.563 * beta * beta + 0.004));
    return 1.1 * (setup + swash / 2);
  }

  /** Alongshore diffusivity G (m^2/s) from Pelnard-Considere / CERC. */
  function diffusivity(Hb, D) {
    var K = 0.77, kappa = 0.78, s = 2.65, p = 0.4;
    if (Hb <= 0) return 0;
    return K * Math.pow(Hb, 2.5) * Math.sqrt(g / kappa) / (8 * (s - 1) * (1 - p) * D);
  }

  /** Hydrodynamics only, for one hour. */
  function hydro(site, hs, tp, dir, wl) {
    var Kr = refraction(dir, site.shoreNormal);
    var Heff = hs * site.waveScale * Kr * site.reefTransmission;
    var R2 = site.runupCal * runupStockdon(Heff, tp, site.foreshoreSlope);
    return { Kr: Kr, Heff: Heff, R2: R2, twl: wl + site.slr + R2 };
  }

  /**
   * Initial state for a scenario. Placed sand is assumed to be shaped as a
   * wedge against the scarp at the foreshore slope.
   */
  function initState(site, design) {
    var len = Math.max(1, Math.min(design.nourishLength, site.pocketLength));
    var placed = design.nourishVolume * (1 - site.profileLoss);
    return {
      vNat: site.naturalBermStart,
      pool: site.nearshorePool,                // m^3/m stored in the nearshore, can return
      nTotal: placed,                          // m^3 of placed sand still in the pocket (subaerial)
      nFront: placed / len,                    // m^3/m of placed sand in front of the house
      retreat: 0,                              // m of scarp retreat
      scarpLoss: 0,                            // m^3/m of land eroded
      sandLost: 0,                             // m^3/m of buffer sand eroded
      coirUsed: 0, bagUsed: 0,
      hours: 0, missing: 0, collision: 0, overwash: 0,
      maxTwl: -Infinity, maxHs: 0
    };
  }

  /** Advance one hour. Returns the per-hour record (and mutates state). */
  function step(site, design, st, hs, tp, dir, wl) {
    st.hours++;
    if (!(hs >= 0) || !(tp > 0) || !(wl > -9) || !(dir >= 0)) { st.missing++; return null; }
    var h = hydro(site, hs, tp, dir, wl);
    var dtS = 3600;

    // 1. alongshore spreading of placed sand toward the pocket-wide mean
    if (st.nTotal > 0 && design.nourishLength < site.pocketLength) {
      var G = diffusivity(h.Heff, site.closureDepth);
      var lam = Math.PI * Math.PI * G / (site.pocketLength * site.pocketLength);
      var mean = st.nTotal / site.pocketLength;
      st.nFront = mean + (st.nFront - mean) * Math.exp(-lam * dtS);
    }

    var buffer = st.vNat + st.nFront;
    var beta = site.foreshoreSlope;
    var crest = site.crestElev + (design.crestRaise || 0);
    var zToe = Math.min(crest, site.toeElev + Math.sqrt(2 * beta * Math.max(0, buffer)));
    var scarpH = Math.max(0.3, crest - site.toeElev);
    var regime = 0;  // 0 swash, 1 collision, 2 overwash
    var dScarp = 0;

    if (h.twl > zToe) {
      regime = h.twl > crest ? 2 : 1;
      var demand = 4 * site.Cs * Math.pow(h.twl - zToe, 2) * dtS / tp;

      // 2. sand buffer is eroded first (natural berm and placed sand pro rata)
      if (buffer > 0) {
        var take = Math.min(buffer, demand);
        var fN = st.nFront / buffer;
        var effLen = st.nFront > 1e-9 ? Math.min(site.pocketLength, Math.max(design.nourishLength, st.nTotal / st.nFront)) : 0;
        st.nFront -= take * fN;
        st.nTotal = Math.max(0, st.nTotal - take * fN * effLen);
        st.vNat -= take * (1 - fN);
        st.pool += take * (1 - site.cellLoss);
        st.sandLost += take;
        demand -= take;
      }

      // 3. toe protection layers (coir envelopes, temporary sand bags)
      if (demand > 0) {
        var excessBase = h.twl - site.toeElev;
        var layers = [
          { h: design.bagHeight, used: 'bagUsed', life: design.bagLifeHours },
          { h: design.coirHeight, used: 'coirUsed', life: design.coirLifeHours }
        ];
        var shield = 0;
        for (var i = 0; i < layers.length; i++) {
          var L = layers[i];
          if (L.h > 0 && st[L.used] < L.life) { st[L.used] += 1; shield = Math.max(shield, L.h); }
        }
        if (shield > 0) {
          var exc = h.twl - (site.toeElev + shield);
          demand = exc > 0 ? demand * Math.pow(exc / Math.max(1e-6, excessBase), 2) : 0;
        }
      }

      // 4. the scarp itself; roots resist (less once the lawn is overwashed)
      if (demand > 0) {
        var veg = design.vegetation * design.vegEffect * (regime === 2 ? 0.5 : 1);
        dScarp = demand * site.scarpFactor * (1 - veg);
        st.scarpLoss += dScarp;
        st.vNat += dScarp * site.scarpToBuffer;   // slumped material shelters the toe
        st.retreat += dScarp / scarpH;
      }
      if (regime === 1) st.collision++; else st.overwash++;
    } else if (h.Heff < site.calmHs) {
      // 5. calm-weather berm recovery, limited by sand actually stored offshore
      var back = Math.min(site.recoveryRate / 24, st.pool, Math.max(0, site.naturalBermMax - st.vNat));
      st.vNat += back; st.pool -= back;
    }

    if (h.twl > st.maxTwl) st.maxTwl = h.twl;
    if (hs > st.maxHs) st.maxHs = hs;
    return { hs: hs, heff: h.Heff, twl: h.twl, wl: wl + site.slr, zToe: zToe,
             retreat: st.retreat, buffer: st.vNat + st.nFront, regime: regime };
  }

  function unpack(season, i) {
    return {
      hs: season.hs[i] < 0 ? NaN : season.hs[i] / 100,
      tp: season.tp[i] < 0 ? NaN : season.tp[i] / 10,
      dir: season.dir[i] < 0 ? NaN : season.dir[i],
      wl: season.wl[i] <= -9999 ? NaN : season.wl[i] / 1000
    };
  }

  /** Run one season (packed arrays as produced by tools/build_data.py). */
  function runSeason(siteIn, designIn, season, opts) {
    var site = extend(DEFAULT_SITE, siteIn), design = extend(DEFAULT_DESIGN, designIn);
    var st = (opts && opts.state) || initState(site, design);
    var keep = !opts || opts.series !== false;
    var series = keep ? [] : null;
    for (var i = 0; i < season.hs.length; i++) {
      var d = unpack(season, i);
      var r = step(site, design, st, d.hs, d.tp, d.dir, d.wl);
      if (keep) series.push(r);
    }
    return { state: st, series: series, summary: summarize(site, design, st) };
  }

  function summarize(site, design, st) {
    return {
      retreat: st.retreat,
      scarpLoss: st.scarpLoss,
      sandLost: st.sandLost,
      collisionHours: st.collision,
      overwashHours: st.overwash,
      validHours: st.hours - st.missing,
      maxTwl: st.maxTwl,
      bufferLeft: st.vNat + st.nFront,
      placedLeftInFront: st.nFront,
      coirFailed: design.coirHeight > 0 && st.coirUsed >= design.coirLifeHours,
      bagFailed: design.bagHeight > 0 && st.bagUsed >= design.bagLifeHours,
      houseMargin: site.houseDistance - st.retreat
    };
  }

  /** Synthetic design storm: Gaussian swell pulse on top of a spring/king tide. */
  function designStorm(p) {
    p = extend({ hs: 6, tp: 16, dir: 330, hours: 72, peakHour: 36, width: 14,
                 tideRange: 0.75, tideOffset: 0.15, background: 1.5 }, p);
    var s = { name: 'Design storm', hours: p.hours, hs: [], tp: [], dir: [], wl: [] };
    for (var i = 0; i < p.hours; i++) {
      var pulse = Math.exp(-0.5 * Math.pow((i - p.peakHour) / p.width, 2));
      var hs = p.background + (p.hs - p.background) * pulse;
      // mixed semidiurnal tide: M2 + K1 with the high-high near the peak
      var t = i - p.peakHour;
      var wl = p.tideOffset + (p.tideRange / 2) * (0.7 * Math.cos(2 * Math.PI * t / 12.42) +
                                                   0.3 * Math.cos(2 * Math.PI * t / 23.93));
      s.hs.push(Math.round(hs * 100)); s.tp.push(Math.round(p.tp * 10));
      s.dir.push(Math.round(p.dir)); s.wl.push(Math.round(wl * 1000));
    }
    return s;
  }

  /** Sea-level rise above today: linear trend plus acceleration hitting target at 2100. */
  function slrAt(year, target2100, baseYear) {
    baseYear = baseYear || 2026;
    var t = Math.max(0, year - baseYear), T = 2100 - baseYear, a = 0.0025;
    var b = Math.max(0, (target2100 - a * T) / (T * T));
    return a * t + b * t * t;
  }

  /**
   * Multi-decade projection: cycles through the given complete winters, adds
   * rising sea level, lets the natural berm rebuild each summer, and
   * optionally renourishes / replaces toe protection every N years.
   */
  function project(siteIn, designIn, seasons, p) {
    // Top-up policies:
    //   renourishEvery N      fixed interval
    //   trigger T (m^3/m)     adaptive: after the summer survey, top up when the sand in front
    //                         of the bank (berm + placed) is below T, at most once per minGap years
    //   backpassFrac f        share of placed sand that has drifted along the pocket which is
    //                         pushed back in front instead of buying new sand
    // `order` (array of season indices) lets Monte Carlo runs shuffle the winters.
    p = extend({ years: 30, startYear: 2026, slr2100: 0.98, renourishEvery: 0,
                 maintainToe: true, trigger: 0, minGap: 2, backpassFrac: 0, order: null }, p);
    var site = extend(DEFAULT_SITE, siteIn), design = extend(DEFAULT_DESIGN, designIn);
    var st = initState(site, design), out = [], last = 0;
    var len = Math.max(1, Math.min(design.nourishLength, site.pocketLength));
    for (var y = 0; y < p.years; y++) {
      var yr = p.startYear + y, ev = null;
      var s2 = extend(site, { slr: site.slr + slrAt(yr, p.slr2100, p.startYear) });
      if (y > 0) {
        var back = Math.min(st.pool, Math.max(0, site.naturalBermMax - st.vNat));
        st.vNat += back; st.pool -= back;                  // summer berm rebuilding
        if (p.maintainToe) { st.coirUsed = 0; st.bagUsed = 0; }
        var topUp = p.topUpVolume != null ? p.topUpVolume : design.nourishVolume;
        var due = topUp > 0 && (
          (p.renourishEvery > 0 && y % p.renourishEvery === 0) ||
          (p.trigger > 0 && st.vNat + st.nFront < p.trigger && y - last >= p.minGap));
        if (due) {
          // backpass: sand that spread beyond the frontage, pushed back (no new purchase)
          var spread = Math.max(0, st.nTotal - st.nFront * len);
          var bp = Math.min(topUp, spread * p.backpassFrac);
          var imported = topUp - bp;
          st.nTotal += imported * (1 - site.profileLoss);
          st.nFront += (imported * (1 - site.profileLoss) + bp) / len;
          ev = { imported: imported, backpassed: bp };
          last = y;
        }
      }
      var season = seasons[p.order ? p.order[y % p.order.length] : y % seasons.length];
      for (var i = 0; i < season.hs.length; i++) {
        var d = unpack(season, i);
        step(s2, design, st, d.hs, d.tp, d.dir, d.wl);
      }
      out.push({ year: yr, slr: s2.slr, retreat: st.retreat, buffer: st.vNat + st.nFront,
                 margin: site.houseDistance - st.retreat, season: season.name, topUp: ev });
    }
    return out;
  }

  /**
   * Calibrate the scarp erodibility (scarpFactor) so the baseline design
   * reproduces an observed long-term mean scarp retreat per year (m) in a
   * multi-year run (no sea-level rise) cycling through the given winters. Retreat rises monotonically with the factor, so bisection in
   * log space is robust. Sand keeps the published Larson coefficient.
   */
  function calibrateScarp(siteIn, designIn, seasons, targetPerWinter) {
    var lo = Math.log(1e-5), hi = Math.log(20), years = Math.max(6, 3 * seasons.length);
    function mean(lnF) {
      var site = extend(siteIn, { scarpFactor: Math.exp(lnF) });
      var p = project(site, designIn, seasons, { years: years, slr2100: 0 });
      return p[p.length - 1].retreat / years;
    }
    if (!(targetPerWinter > 0)) return Math.exp(lo);
    if (mean(hi) < targetPerWinter) return Math.exp(hi);
    for (var k = 0; k < 30; k++) {
      var mid = 0.5 * (lo + hi);
      if (mean(mid) < targetPerWinter) lo = mid; else hi = mid;
    }
    return Math.exp(0.5 * (lo + hi));
  }

  /**
   * Morphological calibration of wave transmission over the reef: choose the
   * reef factor so the median winter-maximum total water level equals the
   * elevation of the vegetated bank top (vegetation grows up to where the
   * largest waves of a typical year reach). Monotonic, so bisection works.
   */
  function calibrateReef(siteIn, seasons, targetMaxTwl) {
    var lo = 0.1, hi = 1.0;
    function medMax(rt) {
      var site = extend(extend(DEFAULT_SITE, siteIn), { reefTransmission: rt }), mx = [];
      seasons.forEach(function (s) {
        var m = -9;
        for (var i = 0; i < s.hs.length; i++) {
          var d = unpack(s, i);
          if (!(d.hs >= 0) || !(d.wl > -9) || !(d.dir >= 0) || !(d.tp > 0)) continue;
          var t = hydro(site, d.hs, d.tp, d.dir, d.wl).twl; if (t > m) m = t;
        }
        mx.push(m);
      });
      mx.sort(function (a, b) { return a - b; });
      return mx[Math.floor(mx.length / 2)];
    }
    for (var k = 0; k < 30; k++) { var mid = (lo + hi) / 2; if (medMax(mid) < targetMaxTwl) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }

  return {
    calibrateReef: calibrateReef,
    calibrateScarp: calibrateScarp,
    DEFAULT_SITE: DEFAULT_SITE, DEFAULT_DESIGN: DEFAULT_DESIGN,
    refraction: refraction, runupStockdon: runupStockdon, diffusivity: diffusivity,
    hydro: hydro, initState: initState, step: step, runSeason: runSeason,
    designStorm: designStorm, slrAt: slrAt, project: project, extend: extend
  };
});
