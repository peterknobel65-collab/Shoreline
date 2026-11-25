/*
 * 3D site model of 461 Laulea Pl, before and after the living-shoreline design.
 * Plain three.js (r128, global THREE). Used by the interactive viewer and by
 * tools/render.js for still renders.
 *
 * Axes: x = along the shore (+ east, metres), y = up (metres above mean sea
 * level), z = s = across the shore (+ inland, 0 = today's bank edge at 461).
 * The cross-shore profile follows the August 2023 lidar on transect 599.
 */
(function (root) {
  'use strict';
  var T = root.THREE;

  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function smooth(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  function noise2(x, y) { return Math.sin(x * 1.7 + Math.sin(y * 0.9)) * 0.5 + Math.sin(y * 2.3 + x * 0.4) * 0.5; }

  var WATER = 0.25;     // still water ~ mid tide + set-up

  // ---------- ground ----------
  // Frontage of 461: |x| < 17. 459's rock wall to the east, 463's to the west.
  function bankLine(x) {
    if (x > 19) return -7 - Math.min(6, (x - 19) * 0.6);         // 459 revetment juts seaward
    if (x < -24) return -2.5;                                      // 463 revetment
    if (x < -18) return -2.5 * smooth(-18, -24, x);
    return 0;
  }
  function isRevet(x) { return x > 19 || x < -24; }

  function beachBefore(s) {           // seaward of the bank
    var z = 1.5 + 0.09 * (s + 0.6);
    if (z < -1.1) z = -1.1 + 0.04 * noise2(s, 1);
    return z;
  }

  function height(x, s, mode) {
    var b = bankLine(x), sl = s - b;
    var lawn = 2.9 + 0.03 * Math.max(0, sl) + 0.05 * noise2(x * 0.3, s * 0.3);
    if (isRevet(x)) {
      lawn += 0.4;
      if (sl >= 0) return lawn;
      var face = lawn + sl * 0.55;                                   // ~1:1.8 rock slope
      return Math.max(face, beachBefore(s));
    }
    var after = mode === 'after';
    var w = (x < -18) ? smooth(-24, -18, x) : 1;                    // fade design toward 463's wall
    if (sl >= 0) {
      if (!after) return lawn;
      // planted lawn dune: crest +0.6 m, 1:2.5 seaward, 1.5 m crest, 1:4 landward
      var dz = 0;
      if (sl < 1.5) dz = 0.6 * (sl / 1.5);
      else if (sl < 3.0) dz = 0.6;
      else if (sl < 5.4) dz = 0.6 * (1 - (sl - 3.0) / 2.4);
      var pathGap = Math.exp(-Math.pow((x + 5) / 1.4, 2));          // sand path crossing at x = -5
      return lawn + dz * w * (1 - 0.75 * pathGap) + 0.03 * noise2(x, s);
    }
    var before = beachBefore(s);
    if (sl > -0.6) before = 1.5 + (lawn - 1.5) * smooth(-0.6, 0, sl);    // near-vertical scarp
    else if (sl > -2.2) before += 0.08 * Math.abs(noise2(x * 3, s * 3)); // rubble apron
    if (!after) return before;
    // placed beach sand: vegetated foredune face (1:3) down to a +2.0 m berm, then the beach face
    var top = lawn;
    var fore = sl > -2.7 ? top - (top - 2.0) * (-sl / 2.7) : 2.0 - 0.02 * (-sl - 2.7);
    var berm = sl < -8 ? 2.0 - 0.02 * 5.3 + 0.09 * (sl + 8) : fore;
    var a = Math.max(before, berm);
    return before + (a - before) * w;
  }

  function slopeAt(x, s, mode) {
    var e = 0.25;
    var dx = height(x + e, s, mode) - height(x - e, s, mode);
    var ds = height(x, s + e, mode) - height(x, s - e, mode);
    return Math.sqrt(dx * dx + ds * ds) / (2 * e);
  }

  function groundColor(x, s, y, mode, out) {
    var sl = s - bankLine(x), slope = slopeAt(x, s, mode);
    var c;
    if (y < WATER + 0.05) c = [0.70, 0.66, 0.55];                    // wet sand
    else c = [0.84, 0.78, 0.64];                                      // dry carbonate sand
    if (isRevet(x) && sl < 0.3) c = [0.30, 0.31, 0.32];
    if (sl >= 0 && !isRevet(x)) {
      var lawn = [0.36, 0.55, 0.25];
      if (mode === 'after' && sl < 5.6) lawn = [0.80, 0.75, 0.60];   // sand of the new dune, planted on top
      if (mode === 'after' && Math.abs(x + 5) < 1.2 && sl < 6) lawn = [0.90, 0.85, 0.73];
      c = lawn;
    } else if (sl >= 0) c = [0.36, 0.55, 0.25];
    if (mode !== 'after' && !isRevet(x) && slope > 1.2 && sl > -1 && sl < 0.4) c = [0.27, 0.19, 0.13];   // exposed soil
    if (mode !== 'after' && !isRevet(x) && sl > -2.2 && sl < -0.6) c = [0.62, 0.58, 0.52];               // cobble lag
    if (y < -0.6) c = [0.55, 0.58, 0.50];                                                                  // submerged
    var n = 0.04 * noise2(x * 2.1, s * 1.7);
    out[0] = c[0] + n; out[1] = c[1] + n; out[2] = c[2] + n;
  }

  function terrain(mode) {
    var W = 100, D = 120, nx = 200, nz = 240;
    var g = new T.PlaneGeometry(W, D, nx, nz);
    g.rotateX(-Math.PI / 2);
    var pos = g.attributes.position, col = new Float32Array(pos.count * 3), c = [0, 0, 0];
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), s = pos.getZ(i) - 10;                    // plane spans s -70..50
      var y = height(x, s, mode);
      pos.setXYZ(i, x, y, s);
      groundColor(x, s, y, mode, c);
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    g.computeVertexNormals();
    var m = new T.Mesh(g, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    m.receiveShadow = true;
    return m;
  }

  function water() {
    var g = new T.PlaneGeometry(240, 140, 1, 1); g.rotateX(-Math.PI / 2);
    var m = new T.Mesh(g, new T.MeshStandardMaterial({ color: 0x1b8a9e, transparent: true, opacity: 0.82, roughness: 0.2, metalness: 0.05 }));
    m.position.set(0, WATER, -60);
    var grp = new T.Group(); grp.add(m);
    // surf lines
    var r = rng(7), foam = new T.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, roughness: 0.6 });
    [[-19.5, 0.9, 0.55], [-27, 2.2, 0.4], [-38, 2.8, 0.25]].forEach(function (f) {
      for (var k = 0; k < 14; k++) {
        var len = 6 + r() * 10, gg = new T.BoxGeometry(len, 0.02, f[1] * (0.25 + r() * 0.35));
        var mm = new T.Mesh(gg, foam.clone()); mm.material.opacity = f[2] * (0.6 + r() * 0.4);
        mm.position.set(-60 + k * 9 + r() * 4, WATER + 0.03, f[0] + (r() - 0.5) * 2); mm.rotation.y = (r() - 0.5) * 0.2;
        grp.add(mm);
      }
    });
    // reef patches
    var reef = new T.MeshStandardMaterial({ color: 0x24433f, roughness: 1 });
    for (var k = 0; k < 40; k++) {
      var p = new T.Mesh(new T.CircleGeometry(1 + r() * 3.5, 9), reef); p.rotation.x = -Math.PI / 2;
      p.position.set(-50 + r() * 100, -0.95, -34 - r() * 30); p.scale.set(1, 0.5 + r(), 1); grp.add(p);
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
    inst.castShadow = true; inst.receiveShadow = true;
    return inst;
  }

  function revetments(mode) {
    var r = rng(11), pts = [];
    for (var x = 19.5; x < 50; x += 0.9) for (var k = 0; k < 6; k++) {
      var sl = -k * 1.1 - r() * 0.6, s = bankLine(x) + sl; pts.push([x + r() * 0.6, height(x, s, mode) + 0.2, s]);
    }
    for (var x2 = -50; x2 < -24; x2 += 0.9) for (var k2 = 0; k2 < 4; k2++) {
      var sl2 = -k2 * 1.0 - r() * 0.5, s2 = bankLine(x2) + sl2; pts.push([x2 + r() * 0.6, height(x2, s2, mode) + 0.2, s2]);
    }
    return rocks(pts, 0.45, 0.85, 0x34393b, 3);
  }

  function boulders() {   // unauthorised boulders scattered on the beach today
    var r = rng(21), pts = [];
    for (var i = 0; i < 46; i++) { var x = -16 + r() * 34, s = -2 - r() * 14; pts.push([x, height(x, s, 'before') + 0.1, s]); }
    for (var j = 0; j < 160; j++) { var x2 = -16 + r() * 33, s2 = -0.7 - r() * 1.6; pts.push([x2, height(x2, s2, 'before') + 0.03, s2]); }
    var big = rocks(pts.slice(0, 46), 0.25, 0.6, 0x2b2f31, 5);
    var lag = rocks(pts.slice(46), 0.06, 0.16, 0xb9b09c, 6);
    var g = new T.Group(); g.add(big); g.add(lag);
    var pipe = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 2.6, 8), new T.MeshStandardMaterial({ color: 0xf2f2f2 }));
    pipe.rotation.z = Math.PI / 2; pipe.rotation.y = 0.2; pipe.position.set(3, 2.35, -0.15); g.add(pipe);
    return g;
  }

  function house(x0, s0, w, d, wall, roof, tower) {
    var g = new T.Group(), y0 = 3.3;
    var body = new T.Mesh(new T.BoxGeometry(w, 3, d), new T.MeshStandardMaterial({ color: wall, roughness: 0.8 }));
    body.position.set(x0, y0 + 1.5, s0 + d / 2); body.castShadow = true; body.receiveShadow = true; g.add(body);
    var rf = new T.Mesh(new T.ConeGeometry(1, 1, 4, 1), new T.MeshStandardMaterial({ color: roof, roughness: 0.7, flatShading: true }));
    rf.rotation.y = Math.PI / 4; rf.scale.set(w * 0.78, 2.2, d * 0.78); rf.position.set(x0, y0 + 3 + 1.1, s0 + d / 2); rf.castShadow = true; g.add(rf);
    // windows facing the sea
    var glass = new T.MeshStandardMaterial({ color: 0x223844, roughness: 0.1, metalness: 0.4 });
    for (var k = -2; k <= 2; k++) { var win = new T.Mesh(new T.BoxGeometry(w / 7, 1.7, 0.05), glass); win.position.set(x0 + k * w / 5.5, y0 + 1.6, s0 - 0.03); g.add(win); }
    if (tower) {
      var tw = new T.Mesh(new T.BoxGeometry(3.2, 2.2, 3.2), new T.MeshStandardMaterial({ color: 0xf4f4f0 }));
      tw.position.set(x0, y0 + 4.2, s0 + d / 2 - 1); tw.castShadow = true; g.add(tw);
      var tr = new T.Mesh(new T.ConeGeometry(1, 1, 4), new T.MeshStandardMaterial({ color: roof, flatShading: true }));
      tr.rotation.y = Math.PI / 4; tr.scale.set(2.6, 1.6, 2.6); tr.position.set(x0, y0 + 6.1, s0 + d / 2 - 1); g.add(tr);
      // lanai rail
      var rail = new T.Mesh(new T.BoxGeometry(w * 0.6, 0.9, 0.08), new T.MeshStandardMaterial({ color: 0xffffff }));
      rail.position.set(x0 + w * 0.1, y0 + 0.45, s0 - 1.2); g.add(rail);
    }
    return g;
  }

  function palm(x, s, h, lean, r) {
    var g = new T.Group(), base = height(x, s, 'before');
    var pts = []; for (var i = 0; i <= 8; i++) { var t = i / 8; pts.push(new T.Vector3(x + lean[0] * t * t * h, base + t * h, s + lean[1] * t * t * h)); }
    var curve = new T.CatmullRomCurve3(pts);
    var trunk = new T.Mesh(new T.TubeGeometry(curve, 16, 0.17, 6), new T.MeshStandardMaterial({ color: 0x8d8170, roughness: 1 }));
    trunk.castShadow = true; g.add(trunk);
    var top = pts[pts.length - 1], leaf = new T.MeshStandardMaterial({ color: 0x3f6f2c, roughness: 0.8, side: T.DoubleSide });
    for (var k = 0; k < 13; k++) {
      var a = k / 13 * Math.PI * 2 + r(), fr = new T.Mesh(new T.PlaneGeometry(0.6, 4.6, 1, 6), leaf);
      var p = fr.geometry.attributes.position;
      for (var j = 0; j < p.count; j++) { var yy = p.getY(j) + 2.3; p.setZ(j, 0.11 * yy * yy); p.setX(j, p.getX(j) * (1 - yy / 5.5)); }
      fr.geometry.computeVertexNormals(); fr.geometry.translate(0, 2.3, 0);
      fr.position.copy(top); fr.rotation.set(0, a, 0); fr.rotateX(0.75 + r() * 0.5); fr.castShadow = true; g.add(fr);
    }
    return g;
  }

  function scatter(n, geo, mat, area, seed, opts) {
    opts = opts || {};
    var r = rng(seed), inst = new T.InstancedMesh(geo, mat, n), m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), k = 0;
    for (var tries = 0; k < n && tries < n * 20; tries++) {
      var x = area[0] + r() * (area[1] - area[0]), sl = area[2] + r() * (area[3] - area[2]);
      if (opts.avoidPath && Math.abs(x + 5) < 1.4) continue;
      if (opts.mask && !opts.mask(x, sl)) continue;
      var s = bankLine(x) + sl, y = height(x, s, opts.mode || 'after');
      var sc = (opts.size || 1) * (0.6 + r() * 0.8);
      e.set(0, r() * 6.28, (r() - 0.5) * 0.2); q.setFromEuler(e);
      m.compose(new T.Vector3(x, y + (opts.lift || 0) * sc, s), q, new T.Vector3(sc * (opts.sx || 1), sc * (opts.sy || 1), sc * (opts.sx || 1)));
      inst.setMatrixAt(k++, m);
    }
    inst.count = k; inst.castShadow = !!opts.shadow; inst.receiveShadow = true;
    return inst;
  }

  function planting(mode) {
    var g = new T.Group();
    if (mode !== 'after') {
      g.add(scatter(260, new T.SphereGeometry(0.35, 6, 4), new T.MeshStandardMaterial({ color: 0x4f8a35, roughness: 1 }), [-17, 17, 0.2, 2.5], 31, { mode: 'before', sy: 0.25, lift: 0.02 }));
      return g;
    }
    var front = [-23, 18];
    // ʻakiʻaki grass on the foredune face and berm
    var grass = new T.ConeGeometry(0.07, 0.38, 4); grass.translate(0, 0.19, 0);
    g.add(scatter(6500, grass, new T.MeshStandardMaterial({ color: 0x6f9a3c, roughness: 1 }), [front[0], front[1], -4.2, -0.2], 41, { avoidPath: true, size: 0.9 }));
    // pōhuehue runners with lilac flowers
    g.add(scatter(700, new T.SphereGeometry(0.3, 6, 4), new T.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 1 }), [front[0], front[1], -5.5, 0.8], 42, { avoidPath: true, sy: 0.22, lift: 0.03 }));
    g.add(scatter(500, new T.SphereGeometry(0.06, 6, 4), new T.MeshStandardMaterial({ color: 0xc66bc0, roughness: 0.6 }), [front[0], front[1], -5.0, 0.8], 43, { avoidPath: true, lift: 0.12 }));
    // naupaka kahakai shrubs on the dune crest
    g.add(scatter(150, new T.IcosahedronGeometry(0.75, 1), new T.MeshStandardMaterial({ color: 0x2f7f3a, roughness: 0.85, flatShading: true }), [front[0], front[1], 1.4, 3.4], 44, { avoidPath: true, sy: 0.7, lift: 0.45, shadow: true }));
    // hinahina silver groundcover on the dune back
    g.add(scatter(420, new T.SphereGeometry(0.28, 6, 4), new T.MeshStandardMaterial({ color: 0xb8c4bd, roughness: 1 }), [front[0], front[1], 3.3, 5.4], 45, { avoidPath: true, sy: 0.4, lift: 0.08 }));
    // ʻilima with yellow-orange flowers
    g.add(scatter(160, new T.SphereGeometry(0.38, 7, 5), new T.MeshStandardMaterial({ color: 0x5d8f3c, roughness: 1 }), [front[0], front[1], 3.0, 5.2], 46, { avoidPath: true, sy: 0.7, lift: 0.25 }));
    g.add(scatter(420, new T.SphereGeometry(0.07, 6, 4), new T.MeshStandardMaterial({ color: 0xf2b630, roughness: 0.5 }), [front[0], front[1], 3.0, 5.2], 47, { avoidPath: true, lift: 0.5 }));
    // kou shade trees with orange blossoms
    [[-12, 7.2], [8.5, 7.0]].forEach(function (p, i) {
      var s = bankLine(p[0]) + p[1], y = height(p[0], s, 'after');
      var tr = new T.Mesh(new T.CylinderGeometry(0.18, 0.28, 2.6, 7), new T.MeshStandardMaterial({ color: 0x6b5644 }));
      tr.position.set(p[0], y + 1.3, s); tr.castShadow = true; g.add(tr);
      var r = rng(60 + i);
      for (var k = 0; k < 9; k++) {
        var cl = new T.Mesh(new T.IcosahedronGeometry(1.1 + r() * 0.6, 1), new T.MeshStandardMaterial({ color: 0x2e6b33, flatShading: true }));
        cl.position.set(p[0] + (r() - 0.5) * 3, y + 3.0 + r() * 1.2, s + (r() - 0.5) * 3); cl.castShadow = true; g.add(cl);
      }
      for (var f = 0; f < 40; f++) {
        var fl = new T.Mesh(new T.SphereGeometry(0.09, 5, 4), new T.MeshStandardMaterial({ color: 0xf07a28 }));
        var a = r() * 6.28, rr = 1.4 + r() * 1.2; fl.position.set(p[0] + Math.cos(a) * rr, y + 2.7 + r() * 1.8, s + Math.sin(a) * rr); g.add(fl);
      }
    });
    // sand path: rope-and-post edging
    var post = new T.CylinderGeometry(0.06, 0.06, 0.8, 6), wood = new T.MeshStandardMaterial({ color: 0x8b6a4a });
    for (var sl = -3.5; sl <= 6; sl += 1.5) [-6.3, -3.7].forEach(function (x) {
      var s = bankLine(x) + sl, p = new T.Mesh(post, wood); p.position.set(x, height(x, s, 'after') + 0.4, s); p.castShadow = true; g.add(p);
    });
    // lounge area on the lawn: two chairs and an umbrella
    var chairMat = new T.MeshStandardMaterial({ color: 0xa57c52 }), cloth = new T.MeshStandardMaterial({ color: 0xf3efe6, side: T.DoubleSide });
    [[-1.5, 7.6], [1.0, 7.6]].forEach(function (p) {
      var s = bankLine(p[0]) + p[1], y = height(p[0], s, 'after');
      var seat = new T.Mesh(new T.BoxGeometry(0.7, 0.12, 1.8), chairMat); seat.position.set(p[0], y + 0.35, s); seat.castShadow = true; g.add(seat);
      var back = new T.Mesh(new T.BoxGeometry(0.7, 0.1, 0.8), chairMat); back.position.set(p[0], y + 0.7, s + 0.85); back.rotation.x = -0.9; g.add(back);
    });
    var us = bankLine(0) + 8.4, uy = height(0, us, 'after');
    var pole = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 2.4, 6), wood); pole.position.set(-0.25, uy + 1.2, us); g.add(pole);
    var canopy = new T.Mesh(new T.ConeGeometry(1.5, 0.45, 10, 1, true), cloth); canopy.position.set(-0.25, uy + 2.45, us); canopy.castShadow = true; g.add(canopy);
    return g;
  }

  function hedge() {
    return scatter(220, new T.IcosahedronGeometry(0.65, 1), new T.MeshStandardMaterial({ color: 0x2c6a2f, flatShading: true, roughness: 0.9 }),
      [-17, 17, 9.2, 10.2], 70, { mode: 'before', sy: 1.1, lift: 0.6, shadow: true, mask: function (x) { return Math.abs(x + 5) > 1.6; } });
  }

  function build(mode) {
    T = root.THREE;
    var scene = new T.Scene();
    scene.background = new T.Color(0x9fd0ec);
    if (typeof document !== 'undefined') {
      var cv = document.createElement('canvas'); cv.width = 4; cv.height = 256;
      var cx = cv.getContext('2d'), gr = cx.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, '#3f86c8'); gr.addColorStop(0.55, '#8cc3e8'); gr.addColorStop(1, '#e6f2f6');
      cx.fillStyle = gr; cx.fillRect(0, 0, 4, 256);
      var tex = new T.CanvasTexture(cv); tex.encoding = T.sRGBEncoding;
      scene.userData.sky = tex;
    }
    scene.fog = new T.Fog(0xbfe0f2, 120, 260);
    scene.add(new T.HemisphereLight(0xcfe8ff, 0x6b5a40, 0.9));
    var sun = new T.DirectionalLight(0xfff0d8, 1.3);
    sun.position.set(-40, 60, 25); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    var sc = sun.shadow.camera; sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 200;
    scene.add(sun);
    scene.add(terrain(mode));
    scene.add(water());
    scene.add(revetments(mode));
    if (mode !== 'after') scene.add(boulders());
    scene.add(planting(mode));
    scene.add(hedge());
    scene.add(house(0, 11.5, 15, 11, 0xf2f2ee, 0x2a2e33, true));
    scene.add(house(-33, 10, 16, 12, 0xd9dbd8, 0x5d6366, false));
    scene.add(house(31, 6, 14, 11, 0xe8e2d8, 0x3a3f44, false));
    var r = rng(91);
    [[-14, 1.5, [0.1, -0.35], 10], [-9, 3.5, [-0.05, -0.3], 11], [12, 2.0, [0.15, -0.4], 10.5], [15, 4, [0.05, -0.2], 12],
     [-20, 5, [0.1, -0.25], 9.5], [22, -4, [-0.1, -0.3], 10], [26, -2, [0.05, -0.35], 11]].forEach(function (p) {
      scene.add(palm(p[0], bankLine(p[0]) + p[1], p[3], p[2], r));
    });
    linearize(scene);
    return scene;
  }

  // Colours above are written as sRGB hex; convert to linear for an sRGB renderer.
  function linearize(scene) {
    scene.background.convertSRGBToLinear(); scene.fog.color.convertSRGBToLinear();
    if (scene.userData.sky) scene.background = scene.userData.sky;
    scene.traverse(function (o) {
      var mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      mats.forEach(function (m) { if (!m.userData.lin) { if (m.color) m.color.convertSRGBToLinear(); m.userData.lin = true; } });
      if (o.geometry && o.geometry.attributes.color && !o.geometry.userData.lin) {
        var c = o.geometry.attributes.color.array; for (var i = 0; i < c.length; i++) c[i] = Math.pow(Math.max(0, c[i]), 2.2);
        o.geometry.userData.lin = true;
      }
    });
  }

  var VIEWS = {
    aerial: { pos: [34, 30, -46], target: [0, 2.5, 2] },
    beach: { pos: [-11, 2.4, -15], target: [2, 3.6, 8] },
    dune: { pos: [10, 6.5, 3], target: [-6, 3.0, 1] }
  };

  root.ShoreScene = { build: build, height: height, VIEWS: VIEWS };
})(typeof self !== 'undefined' ? self : this);
