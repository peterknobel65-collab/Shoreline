/*
 * 3D site model of 461 Laulea Pl, built on the 2023 USGS lidar.
 * Plain three.js r128 (global THREE). Call ShoreScene.setGrid(gradingJson.grid)
 * before build(). Used by the interactive viewer and by tools/render.js.
 *
 * Axes: x = along shore (+ toward 459), y = up (m above mean sea level),
 * z = s = across shore (+ inland, 0 = today's bank edge on transect 599).
 * build(mode, opts): mode 'before' | 'after'; opts.storm = total water level
 * of a big-swell high tide (m) to show how far the runup reaches.
 */
(function (root) {
  'use strict';
  var T = root.THREE, GRID = null;

  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function noise2(x, y) { return Math.sin(x * 1.7 + Math.sin(y * 0.9)) * 0.5 + Math.sin(y * 2.3 + x * 0.4) * 0.5; }

  function setGrid(g) { GRID = g; GRID.dx = g.x[1] - g.x[0]; GRID.ds = g.s[1] - g.s[0]; }

  function gridAt(arr, x, s) {
    var g = GRID, nx = g.x.length, ns = g.s.length;
    var fx = clamp((x - g.x[0]) / g.dx, 0, nx - 1.001), fs = clamp((s - g.s[0]) / g.ds, 0, ns - 1.001);
    var i = Math.floor(fx), j = Math.floor(fs), a = fx - i, b = fs - j;
    return arr[j][i] * (1 - a) * (1 - b) + arr[j][i + 1] * a * (1 - b) + arr[j + 1][i] * (1 - a) * b + arr[j + 1][i + 1] * a * b;
  }
  function controlAt(x) {
    var g = GRID, f = clamp((x - g.x[0]) / g.dx, 0, g.x.length - 1.001), i = Math.floor(f), a = f - i;
    return g.control[i] * (1 - a) + g.control[i + 1] * a;
  }

  // ground height; outside the lidar window it blends to open sea / flat lawn
  function height(x, s, mode) {
    var arr = mode === 'after' ? GRID.designed : GRID.existing;
    var z = gridAt(arr, x, s);
    var s0 = GRID.s[0], s1 = GRID.s[GRID.s.length - 1], x0 = GRID.x[0], x1 = GRID.x[GRID.x.length - 1];
    if (s < s0) z = z + (-1.3 - z) * smooth(s0, s0 - 25, s);
    if (s > s1) z = z + (3.2 - z) * smooth(s1, s1 + 10, s);
    if (x < x0 || x > x1) { var d = x < x0 ? x0 - x : x - x1; z += 0.02 * noise2(x, s) * Math.min(1, d / 5); }
    return z;
  }
  function fillAt(x, s) { return gridAt(GRID.designed, x, s) - gridAt(GRID.existing, x, s); }
  function inFront(x) { return x > GRID.front[0] - 2 && x < GRID.front[1] + 2; }
  function wallDist(x, s) {
    var w = GRID.wall, best = 99;
    for (var k = 0; k < w.length; k++) { var d = Math.hypot(w[k][0] - x, w[k][1] - s); if (d < best) best = d; }
    return best;
  }

  // ---------- ground ----------
  function groundColor(x, s, y, mode, slope) {
    var c, grass = [0.36, 0.55, 0.25], dry = [0.86, 0.80, 0.66], wet = [0.70, 0.65, 0.54];
    c = y < 0.45 ? wet : dry;
    if (y > 2.45 && s > -6 && !(mode === 'after' && fillAt(x, s) > 0.03)) c = grass;
    if (y > 2.45 && s > -6 && mode === 'after' && fillAt(x, s) > 0.03) c = [0.80, 0.74, 0.58];
    if (wallDist(x, s) < 2.2 && x > 10) c = [0.24, 0.25, 0.26];
    if (mode !== 'after' && slope > 0.9 && y > 1.3 && y < 2.9 && inFront(x)) c = [0.28, 0.20, 0.14];
    if (mode !== 'after' && inFront(x) && s > controlAt(x) - 3.2 && s < controlAt(x) - 1.0 && y > 1.2 && y < 1.9) c = [0.63, 0.59, 0.53];
    if (y < -0.4) c = [0.52, 0.56, 0.48];
    var n = 0.035 * noise2(x * 2.1, s * 1.7);
    return [c[0] + n, c[1] + n, c[2] + n];
  }

  function terrain(mode) {
    var W = 150, D = 130, nx = 300, nz = 260;
    var g = new T.PlaneGeometry(W, D, nx, nz); g.rotateX(-Math.PI / 2);
    var pos = g.attributes.position, col = new Float32Array(pos.count * 3);
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), s = pos.getZ(i) - 25;
      pos.setXYZ(i, x, height(x, s, mode), s);
    }
    g.computeVertexNormals();
    var nrm = g.attributes.normal;
    for (var k = 0; k < pos.count; k++) {
      var ny = nrm.getY(k), slope = Math.sqrt(Math.max(0, 1 - ny * ny)) / Math.max(0.05, ny);
      var c = groundColor(pos.getX(k), pos.getZ(k), pos.getY(k), mode, slope);
      col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
    }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    var m = new T.Mesh(g, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    m.receiveShadow = true; return m;
  }

  // first s (from the sea) where ground reaches level z, searching s in [sa, sb]
  function reach(x, z, mode, sa, sb, stepS) {
    for (var s = sa; s <= sb; s += stepS) if (height(x, s, mode) >= z) return s;
    return null;
  }

  function water(level, mode, storm) {
    var grp = new T.Group();
    var sea = new T.Mesh(new T.PlaneGeometry(400, 220, 1, 1), new T.MeshStandardMaterial({ color: 0x1b8a9e, transparent: true, opacity: 0.8, roughness: 0.18 }));
    sea.rotation.x = -Math.PI / 2; sea.position.set(0, level, -110 + 25); grp.add(sea);
    var foamMat = new T.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, roughness: 0.7, side: T.DoubleSide });
    // shore break and swash: a strip from the still waterline up to the runup limit
    var top = storm || level + 0.5, verts = [], idx = [], k = 0, r = rng(5);
    for (var x = -70; x <= 70; x += 0.5) {
      var a = reach(x, level, mode, -60, 25, 0.25), b = reach(x, top, mode, a == null ? -60 : a, 25, 0.25);
      if (a == null) continue;
      if (b == null) b = a + 1;
      if (storm) { var edge = reach(x, 2.45, mode, a, 25, 0.25); if (edge != null && b > edge + 4) b = edge + 4; }
      var jit = (r() - 0.5) * 0.6;
      verts.push(x, height(x, a - 1.5, mode) + 0.04, a - 1.5, x, height(x, b + jit, mode) + 0.04, b + jit);
      if (k > 0) idx.push(2 * k - 2, 2 * k - 1, 2 * k, 2 * k - 1, 2 * k + 1, 2 * k);
      k++;
    }
    var gg = new T.BufferGeometry(); gg.setAttribute('position', new T.Float32BufferAttribute(verts, 3)); gg.setIndex(idx); gg.computeVertexNormals();
    var swash = new T.Mesh(gg, foamMat.clone()); swash.material.opacity = storm ? 0.92 : 0.55; grp.add(swash);
    // breaking waves on the reef
    var lines = storm ? [[-20, 1.8, 0.9], [-28, 2.6, 0.75], [-40, 3.2, 0.6], [-55, 3.2, 0.45]] : [[-22, 0.8, 0.5], [-34, 1.6, 0.4], [-48, 2.2, 0.3]];
    lines.forEach(function (l) {
      for (var j = 0; j < 22; j++) {
        var len = 4 + r() * 9, m = new T.Mesh(new T.BoxGeometry(len, 0.03 + (storm ? 0.25 : 0.05) * r(), l[1] * (0.3 + r() * 0.5)), foamMat.clone());
        m.material.opacity = l[2] * (0.6 + r() * 0.4); m.position.set(-90 + j * 8.5 + r() * 4, level + 0.05, l[0] + (r() - 0.5) * 3); m.rotation.y = (r() - 0.5) * 0.25;
        grp.add(m);
      }
    });
    var reef = new T.MeshStandardMaterial({ color: 0x24433f, roughness: 1 });
    for (var q = 0; q < 45; q++) {
      var p = new T.Mesh(new T.CircleGeometry(1 + r() * 3.5, 9), reef); p.rotation.x = -Math.PI / 2;
      p.position.set(-70 + r() * 140, -1.15, -36 - r() * 40); p.scale.set(1, 0.5 + r(), 1); grp.add(p);
    }
    return grp;
  }

  // ---------- objects ----------
  function rocks(points, sizeMin, sizeMax, color, seed) {
    var r = rng(seed), geo = new T.DodecahedronGeometry(1, 0), mat = new T.MeshStandardMaterial({ color: color, roughness: 0.9, flatShading: true });
    var inst = new T.InstancedMesh(geo, mat, points.length), m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler();
    points.forEach(function (p, i) {
      var sz = sizeMin + r() * (sizeMax - sizeMin);
      e.set(r() * 3, r() * 3, r() * 3); q.setFromEuler(e);
      m.compose(new T.Vector3(p[0], p[1], p[2]), q, new T.Vector3(sz, sz * (0.6 + r() * 0.3), sz * (0.8 + r() * 0.3)));
      inst.setMatrixAt(i, m);
    });
    inst.castShadow = true; inst.receiveShadow = true; return inst;
  }

  function wall459(mode) {
    var r = rng(11), pts = [], w = GRID.wall, t = GRID.wall_toe;
    for (var k = 0; k < w.length; k++) {
      var crest = w[k], toe = t[Math.min(k, t.length - 1)];
      for (var f = 0; f <= 1.0001; f += 0.2) {
        var x = crest[0] + (toe[0] - crest[0]) * f + (r() - 0.5) * 0.8, s = crest[1] + (toe[1] - crest[1]) * f - 0.6 + (r() - 0.5) * 0.8;
        pts.push([x, height(x, s, mode) + 0.25, s]);
      }
    }
    for (var x2 = 41; x2 < 70; x2 += 1.0) for (var k2 = 0; k2 < 4; k2++) { var s2 = -30 - k2 * 1.2; pts.push([x2, height(x2, s2, mode) + 0.2, s2]); }
    return rocks(pts, 0.5, 0.95, 0x33383a, 3);
  }

  function boulders() {
    var r = rng(21), pts = [], lag = [];
    for (var i = 0; i < 48; i++) { var x = -18 + r() * 28, s = controlAt(x) - 3 - r() * 13; pts.push([x, height(x, s, 'before') + 0.1, s]); }
    for (var j = 0; j < 200; j++) { var x2 = -18 + r() * 28, s2 = controlAt(x2) - 1.2 - r() * 2.0; lag.push([x2, height(x2, s2, 'before') + 0.03, s2]); }
    var g = new T.Group(); g.add(rocks(pts, 0.25, 0.6, 0x2b2f31, 5)); g.add(rocks(lag, 0.06, 0.16, 0xb9b09c, 6));
    var pipe = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 2.6, 8), new T.MeshStandardMaterial({ color: 0xf2f2f2 }));
    pipe.rotation.z = Math.PI / 2; pipe.rotation.y = 0.2; pipe.position.set(-2, 2.25, controlAt(-2) - 0.7); g.add(pipe);
    return g;
  }

  function hipRoof(cx, cz, w, d, h, y, color) {
    // proper hip roof: ridge along the longer side
    var geo = new T.BufferGeometry(), hw = w / 2 + 0.6, hd = d / 2 + 0.6, r = Math.max(0, (w - d) / 2);
    var v = [-hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd, -r, h, 0, r, h, 0];
    var f = [0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 3, 3, 5, 4, 3, 4, 0];
    geo.setAttribute('position', new T.Float32BufferAttribute(v, 3)); geo.setIndex(f); geo.computeVertexNormals();
    var m = new T.Mesh(geo, new T.MeshStandardMaterial({ color: color, roughness: 0.75, flatShading: true, side: T.DoubleSide }));
    m.position.set(cx, y, cz); m.castShadow = true; return m;
  }

  function house461() {
    var g = new T.Group(), h = GRID.house, y0 = 3.3;
    var xs = h.map(function (p) { return p[0]; }), ss = h.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), s0 = Math.min.apply(null, ss), s1 = Math.max.apply(null, ss);
    var w = x1 - x0, d = s1 - s0, cx = (x0 + x1) / 2, cz = (s0 + s1) / 2;
    var wallMat = new T.MeshStandardMaterial({ color: 0xf3f3ef, roughness: 0.85 });
    var pad = new T.Mesh(new T.BoxGeometry(w + 0.6, 0.5, d + 0.6), new T.MeshStandardMaterial({ color: 0xd8d4cb })); pad.position.set(cx, y0 - 0.2, cz); g.add(pad);
    // two wings with a lanai between, board-and-batten white walls
    [[x0 + 3.2, 6.4], [x1 - 3.5, 7.0]].forEach(function (wing, k) {
      var b = new T.Mesh(new T.BoxGeometry(wing[1], 3.0, d - 1.0), wallMat); b.position.set(wing[0], y0 + 1.5, cz + 0.5); b.castShadow = true; b.receiveShadow = true; g.add(b);
      g.add(hipRoof(wing[0], cz + 0.5, wing[1], d - 1.0, 2.0, y0 + 3.0, 0x2a2e33));
      for (var bb = -wing[1] / 2 + 0.3; bb < wing[1] / 2; bb += 0.45) {
        var batten = new T.Mesh(new T.BoxGeometry(0.05, 2.9, 0.06), wallMat); batten.position.set(wing[0] + bb, y0 + 1.5, s0 + 0.97); g.add(batten);
      }
      var glass = new T.Mesh(new T.BoxGeometry(wing[1] * 0.55, 1.9, 0.06), new T.MeshStandardMaterial({ color: 0x1f3440, roughness: 0.08, metalness: 0.5 }));
      glass.position.set(wing[0], y0 + 1.5, s0 + 0.96); g.add(glass);
    });
    var mid = new T.Mesh(new T.BoxGeometry(w - 13.4, 3.0, d - 3), wallMat); mid.position.set(cx + 0.2, y0 + 1.5, cz + 1.5); mid.castShadow = true; g.add(mid);
    g.add(hipRoof(cx + 0.2, cz + 1.5, w - 13.4, d - 3, 1.6, y0 + 3.0, 0x2a2e33));
    var glassWall = new T.Mesh(new T.BoxGeometry(w - 14, 2.4, 0.06), new T.MeshStandardMaterial({ color: 0x1f3440, roughness: 0.08, metalness: 0.5 }));
    glassWall.position.set(cx + 0.2, y0 + 1.3, s0 + 2.97); g.add(glassWall);
    // lanai deck and white railing toward the sea
    var deck = new T.Mesh(new T.BoxGeometry(w - 13.4, 0.15, 2.0), new T.MeshStandardMaterial({ color: 0xb08a60 })); deck.position.set(cx + 0.2, y0 + 0.08, s0 + 2.0); g.add(deck);
    var railMat = new T.MeshStandardMaterial({ color: 0xffffff });
    var rail = new T.Mesh(new T.BoxGeometry(w - 13.4, 0.06, 0.06), railMat); rail.position.set(cx + 0.2, y0 + 1.0, s0 + 1.05); g.add(rail);
    for (var p = -(w - 13.4) / 2; p <= (w - 13.4) / 2; p += 0.9) { var post = new T.Mesh(new T.BoxGeometry(0.06, 1.0, 0.06), railMat); post.position.set(cx + 0.2 + p, y0 + 0.5, s0 + 1.05); g.add(post); }
    // white gable tower
    var t = GRID.tower, tx = (t[0][0] + t[1][0]) / 2, tz = (t[0][1] + t[2][1]) / 2;
    var tw = new T.Mesh(new T.BoxGeometry(3.4, 2.4, 3.4), wallMat); tw.position.set(tx, y0 + 4.4, tz); tw.castShadow = true; g.add(tw);
    g.add(hipRoof(tx, tz, 3.4, 3.4, 1.7, y0 + 5.6, 0x2a2e33));
    var tg = new T.Mesh(new T.BoxGeometry(2.0, 1.2, 0.05), new T.MeshStandardMaterial({ color: 0x1f3440, metalness: 0.5, roughness: 0.1 })); tg.position.set(tx, y0 + 4.4, tz - 1.73); g.add(tg);
    // solar panels on the east wing roof
    var pv = new T.Mesh(new T.BoxGeometry(4.5, 0.05, 2.6), new T.MeshStandardMaterial({ color: 0x14202c, metalness: 0.6, roughness: 0.3 }));
    pv.position.set(x1 - 3.5, y0 + 4.05, cz + 3.0); pv.rotation.x = 0.45; g.add(pv);
    return g;
  }

  function simpleHouse(cx, cz, w, d, wall, roof) {
    var g = new T.Group(), y0 = 3.5;
    var b = new T.Mesh(new T.BoxGeometry(w, 3, d), new T.MeshStandardMaterial({ color: wall, roughness: 0.85 })); b.position.set(cx, y0 + 1.5, cz); b.castShadow = true; g.add(b);
    g.add(hipRoof(cx, cz, w, d, 2.2, y0 + 3, roof)); return g;
  }

  function palm(x, s, h, lean, r, mode) {
    var g = new T.Group(), base = height(x, s, mode);
    var pts = []; for (var i = 0; i <= 8; i++) { var t = i / 8; pts.push(new T.Vector3(x + lean[0] * t * t * h, base + t * h, s + lean[1] * t * t * h)); }
    var trunk = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 20, 0.17, 7), new T.MeshStandardMaterial({ color: 0x8d8170, roughness: 1 }));
    trunk.castShadow = true; g.add(trunk);
    var top = pts[pts.length - 1], leaf = new T.MeshStandardMaterial({ color: 0x3f6f2c, roughness: 0.8, side: T.DoubleSide });
    for (var k = 0; k < 14; k++) {
      var a = k / 14 * Math.PI * 2 + r() * 0.3, fr = new T.Mesh(new T.PlaneGeometry(0.6, 4.6, 1, 6), leaf);
      var p = fr.geometry.attributes.position;
      for (var j = 0; j < p.count; j++) { var yy = p.getY(j) + 2.3; p.setZ(j, 0.11 * yy * yy); p.setX(j, p.getX(j) * (1 - yy / 5.5)); }
      fr.geometry.computeVertexNormals(); fr.geometry.translate(0, 2.3, 0);
      fr.position.copy(top); fr.rotation.set(0, a, 0); fr.rotateX(0.75 + r() * 0.5); fr.castShadow = true; g.add(fr);
    }
    for (var c = 0; c < 5; c++) { var nut = new T.Mesh(new T.SphereGeometry(0.16, 6, 5), new T.MeshStandardMaterial({ color: 0x6b7a2c })); nut.position.set(top.x + (r() - 0.5) * 0.5, top.y - 0.3, top.z + (r() - 0.5) * 0.5); g.add(nut); }
    return g;
  }

  function scatter(n, geo, mat, test, seed, opts) {
    opts = opts || {};
    var r = rng(seed), inst = new T.InstancedMesh(geo, mat, n), m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), k = 0;
    var bx = opts.box || [GRID.front[0] - 3, GRID.front[1] + 3, -12, 10];
    for (var tries = 0; k < n && tries < n * 40; tries++) {
      var x = bx[0] + r() * (bx[1] - bx[0]), s = bx[2] + r() * (bx[3] - bx[2]);
      if (!test(x, s)) continue;
      var y = height(x, s, opts.mode || 'after'), sc = (opts.size || 1) * (0.6 + r() * 0.8);
      e.set((r() - 0.5) * (opts.tilt || 0.2), r() * 6.28, (r() - 0.5) * (opts.tilt || 0.2)); q.setFromEuler(e);
      m.compose(new T.Vector3(x, y + (opts.lift || 0) * sc, s), q, new T.Vector3(sc * (opts.sx || 1), sc * (opts.sy || 1), sc * (opts.sx || 1)));
      inst.setMatrixAt(k++, m);
    }
    inst.count = k; inst.castShadow = !!opts.shadow; inst.receiveShadow = true; return inst;
  }

  // planting zones from the designed surface (same rules as the planting plan, sheet L-101)
  function zone(x, s) {
    if (Math.abs(x - GRID.path_x) < 0.9) return -1;
    var f = fillAt(x, s); if (f < 0.03) return -1;
    var z = gridAt(GRID.designed, x, s), u = s - controlAt(x), cr = GRID.crest;
    if (u < 1.0 && z >= 2.08 && z < 2.7) return 1;
    if (u < 1.0 && z >= 2.7 && z < cr - 0.15) return 2;
    if (z >= cr - 0.15) return 3;
    if (u >= 1.0) return 4;
    return -1;
  }

  function planting(mode) {
    var g = new T.Group();
    if (mode !== 'after') {
      g.add(scatter(320, new T.SphereGeometry(0.35, 6, 4), new T.MeshStandardMaterial({ color: 0x4f8a35, roughness: 1 }),
        function (x, s) { return height(x, s, 'before') > 2.4 && s > controlAt(x) && s < controlAt(x) + 3; }, 31, { mode: 'before', sy: 0.25, lift: 0.02 }));
      return g;
    }
    var grass = new T.ConeGeometry(0.06, 0.36, 4); grass.translate(0, 0.18, 0);
    g.add(scatter(9000, grass, new T.MeshStandardMaterial({ color: 0x7aa043, roughness: 1 }), function (x, s) { var z = zone(x, s); return z === 1 || z === 2; }, 41, { size: 0.9, tilt: 0.5 }));
    g.add(scatter(900, new T.SphereGeometry(0.3, 6, 4), new T.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 1 }), function (x, s) { return zone(x, s) === 1; }, 42, { sy: 0.22, lift: 0.03 }));
    g.add(scatter(700, new T.SphereGeometry(0.06, 6, 4), new T.MeshStandardMaterial({ color: 0xc66bc0, roughness: 0.6 }), function (x, s) { return zone(x, s) === 1; }, 43, { lift: 0.12 }));
    g.add(scatter(300, new T.SphereGeometry(0.06, 6, 4), new T.MeshStandardMaterial({ color: 0xf2d33a, roughness: 0.6 }), function (x, s) { return zone(x, s) === 2; }, 48, { lift: 0.2 }));
    g.add(scatter(190, new T.IcosahedronGeometry(0.75, 1), new T.MeshStandardMaterial({ color: 0x2f7f3a, roughness: 0.85, flatShading: true }), function (x, s) { return zone(x, s) === 3; }, 44, { sy: 0.7, lift: 0.45, shadow: true }));
    g.add(scatter(160, new T.SphereGeometry(0.05, 5, 4), new T.MeshStandardMaterial({ color: 0xffffff }), function (x, s) { return zone(x, s) === 3; }, 49, { lift: 1.0 }));
    g.add(scatter(520, new T.SphereGeometry(0.28, 6, 4), new T.MeshStandardMaterial({ color: 0xb8c4bd, roughness: 1 }), function (x, s) { return zone(x, s) === 4; }, 45, { sy: 0.4, lift: 0.08 }));
    g.add(scatter(200, new T.SphereGeometry(0.38, 7, 5), new T.MeshStandardMaterial({ color: 0x5d8f3c, roughness: 1 }), function (x, s) { return zone(x, s) === 4; }, 46, { sy: 0.7, lift: 0.25 }));
    g.add(scatter(520, new T.SphereGeometry(0.07, 6, 4), new T.MeshStandardMaterial({ color: 0xf2b630, roughness: 0.5 }), function (x, s) { return zone(x, s) === 4; }, 47, { lift: 0.5 }));
    // kou trees
    GRID.trees.forEach(function (p, i) {
      var y = height(p[0], p[1], 'after'), r = rng(60 + i);
      var tr = new T.Mesh(new T.CylinderGeometry(0.18, 0.3, 2.6, 7), new T.MeshStandardMaterial({ color: 0x6b5644 })); tr.position.set(p[0], y + 1.3, p[1]); tr.castShadow = true; g.add(tr);
      for (var k = 0; k < 10; k++) {
        var cl = new T.Mesh(new T.IcosahedronGeometry(1.1 + r() * 0.6, 1), new T.MeshStandardMaterial({ color: 0x2e6b33, flatShading: true }));
        cl.position.set(p[0] + (r() - 0.5) * 3.2, y + 3.0 + r() * 1.3, p[1] + (r() - 0.5) * 3.2); cl.castShadow = true; g.add(cl);
      }
      for (var f = 0; f < 45; f++) {
        var fl = new T.Mesh(new T.SphereGeometry(0.09, 5, 4), new T.MeshStandardMaterial({ color: 0xf07a28 }));
        var a = r() * 6.28, rr = 1.4 + r() * 1.3; fl.position.set(p[0] + Math.cos(a) * rr, y + 2.7 + r() * 1.9, p[1] + Math.sin(a) * rr); g.add(fl);
      }
    });
    // rope-and-post path edging
    var wood = new T.MeshStandardMaterial({ color: 0x8b6a4a }), rope = new T.MeshStandardMaterial({ color: 0xcdb48a });
    [-0.95, 0.95].forEach(function (dx) {
      var x = GRID.path_x + dx, prev = null;
      for (var s = controlAt(x) - 6; s <= controlAt(x) + 7; s += 1.5) {
        var y = height(x, s, 'after'), p = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 0.8, 6), wood); p.position.set(x, y + 0.4, s); p.castShadow = true; g.add(p);
        var cur = new T.Vector3(x, y + 0.7, s);
        if (prev) { var len = prev.distanceTo(cur), rp = new T.Mesh(new T.CylinderGeometry(0.015, 0.015, len, 4), rope); rp.position.copy(prev).add(cur).multiplyScalar(0.5); rp.lookAt(cur); rp.rotateX(Math.PI / 2); g.add(rp); }
        prev = cur;
      }
    });
    // lounge lawn: loungers, umbrella, side table
    var chairMat = new T.MeshStandardMaterial({ color: 0xa57c52 }), cloth = new T.MeshStandardMaterial({ color: 0xf3efe6, side: T.DoubleSide });
    [[-1.2, 7.4], [1.3, 7.4]].forEach(function (p) {
      var y = height(p[0], p[1], 'after');
      var seat = new T.Mesh(new T.BoxGeometry(0.7, 0.12, 1.8), chairMat); seat.position.set(p[0], y + 0.35, p[1]); seat.castShadow = true; g.add(seat);
      var back = new T.Mesh(new T.BoxGeometry(0.7, 0.1, 0.8), chairMat); back.position.set(p[0], y + 0.7, p[1] + 0.85); back.rotation.x = -0.9; g.add(back);
      var cush = new T.Mesh(new T.BoxGeometry(0.62, 0.06, 1.7), new T.MeshStandardMaterial({ color: 0x2f6f7a })); cush.position.set(p[0], y + 0.44, p[1]); g.add(cush);
    });
    var uy = height(0, 8.6, 'after');
    var pole = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 2.4, 6), wood); pole.position.set(0.05, uy + 1.2, 8.6); g.add(pole);
    var canopy = new T.Mesh(new T.ConeGeometry(1.6, 0.45, 12, 1, true), cloth); canopy.position.set(0.05, uy + 2.45, 8.6); canopy.castShadow = true; g.add(canopy);
    var table = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 0.5, 12), wood); table.position.set(0.05, uy + 0.25, 7.6); g.add(table);
    return g;
  }

  function hedge(mode) {
    return scatter(260, new T.IcosahedronGeometry(0.65, 1), new T.MeshStandardMaterial({ color: 0x2c6a2f, flatShading: true, roughness: 0.9 }),
      function (x, s) { return Math.abs(x - GRID.path_x) > 1.6 && s > 8.4 && s < 9.6; }, 70,
      { mode: mode, box: [-20, 18, 8.4, 9.6], sy: mode === 'after' ? 0.55 : 1.1, lift: mode === 'after' ? 0.25 : 0.6, shadow: true });   // after: hedge trimmed to ~1 m to open the view
  }

  // Colours above are sRGB hex; convert to linear for an sRGB renderer.
  function linearize(scene) {
    scene.fog.color.convertSRGBToLinear();
    scene.traverse(function (o) {
      var mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      mats.forEach(function (m) { if (!m.userData.lin) { if (m.color) m.color.convertSRGBToLinear(); m.userData.lin = true; } });
      if (o.geometry && o.geometry.attributes.color && !o.geometry.userData.lin) {
        var c = o.geometry.attributes.color.array; for (var i = 0; i < c.length; i++) c[i] = Math.pow(Math.max(0, c[i]), 2.2);
        o.geometry.userData.lin = true;
      }
    });
  }

  function sky(storm) {
    if (typeof document === 'undefined') return new T.Color(0x9fd0ec);
    var cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
    var cx = cv.getContext('2d'), gr = cx.createLinearGradient(0, 0, 0, 256);
    if (storm) { gr.addColorStop(0, '#6f8796'); gr.addColorStop(0.6, '#b3c3cb'); gr.addColorStop(1, '#dde4e6'); }
    else { gr.addColorStop(0, '#3f86c8'); gr.addColorStop(0.55, '#8cc3e8'); gr.addColorStop(1, '#e6f2f6'); }
    cx.fillStyle = gr; cx.fillRect(0, 0, 512, 256);
    var r = rng(storm ? 9 : 3);
    for (var k = 0; k < (storm ? 40 : 14); k++) {
      var x = r() * 512, y = 40 + r() * 120, w = 30 + r() * 80;
      cx.fillStyle = storm ? 'rgba(235,240,242,0.35)' : 'rgba(255,255,255,0.55)';
      for (var j = 0; j < 6; j++) { cx.beginPath(); cx.ellipse(x + j * w / 6, y + (r() - 0.5) * 8, w / 4, w / 9, 0, 0, 6.3); cx.fill(); }
    }
    var tex = new T.CanvasTexture(cv); tex.encoding = T.sRGBEncoding; return tex;
  }

  function build(mode, opts) {
    T = root.THREE; opts = opts || {};
    var scene = new T.Scene(), storm = opts.storm || 0;
    scene.background = sky(storm);
    scene.fog = new T.Fog(storm ? 0xc3cdd2 : 0xbfe0f2, 110, 280);
    scene.add(new T.HemisphereLight(0xcfe8ff, 0x6b5a40, storm ? 1.1 : 0.9));
    var sun = new T.DirectionalLight(0xfff0d8, storm ? 0.55 : 1.3);
    sun.position.set(-40, 60, 25); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    var sc = sun.shadow.camera; sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 200;
    scene.add(sun);
    scene.add(terrain(mode));
    scene.add(water(storm ? 0.75 : 0.25, mode, storm));
    scene.add(wall459(mode));
    if (mode !== 'after') scene.add(boulders());
    scene.add(planting(mode));
    scene.add(hedge(mode));
    scene.add(house461());
    scene.add(simpleHouse(-31, 14, 15, 11, 0xd9dbd8, 0x5d6366));
    scene.add(simpleHouse(30, 4, 14, 11, 0xe8e2d8, 0x3a3f44));
    var r = rng(91);
    [[-15, -0.5, [0.15, -0.35], 10], [-10, 1.5, [-0.05, -0.3], 11], [8, -2.5, [0.15, -0.4], 10.5], [11, 1, [0.05, -0.2], 12],
     [-22, 3, [0.1, -0.25], 9.5], [18, -8, [-0.1, -0.3], 10], [22, -12, [0.05, -0.35], 11], [-3, 6.5, [0.02, -0.15], 12.5]].forEach(function (p) {
      scene.add(palm(p[0], p[1], p[3], p[2], r, mode));
    });
    linearize(scene);
    return scene;
  }

  // eye: camera height above the ground at its x/s (so it never sits inside new sand)
  var VIEWS = {
    beach: { pos: [-13, 0, -19], eye: 1.7, target: [1, 3.4, 6], fov: 55 },
    aerial: { pos: [36, 32, -44], target: [-2, 2.5, 0], fov: 45 },
    dune: { pos: [-5, 0, 3.5], eye: 1.7, target: [-16, 3.0, -3], fov: 60 },
    lanai: { pos: [6, 5.0, 11.3], target: [-3, 2.4, -14], fov: 62 },
    storm: { pos: [-26, 9, -26], target: [-2, 2.2, 2], fov: 46 }
  };
  function camera(view, mode, aspect) {
    var v = VIEWS[view], p = v.pos.slice();
    if (v.eye) p[1] = height(p[0], p[2], mode) + v.eye;
    var cam = new T.PerspectiveCamera(v.fov, aspect || 1.6, 0.1, 600);
    cam.position.set(p[0], p[1], p[2]); cam.lookAt(new T.Vector3(v.target[0], v.target[1], v.target[2]));
    return cam;
  }

  root.ShoreScene = { setGrid: setGrid, build: build, height: height, VIEWS: VIEWS, camera: camera };
})(typeof self !== 'undefined' ? self : this);
