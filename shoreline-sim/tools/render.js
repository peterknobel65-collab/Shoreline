// Still renders of the 3D site model (before / after, plus a storm view).
// Usage: node shoreline-sim/tools/render.js <path-to-three.min.js> [stormTWL]
// Needs data/grading.json (tools/cad.py). Writes shoreline-sim/img/render_<view>_<mode>.jpg
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const THREE_JS = process.argv[2];
const STORM = Number(process.argv[3] || 3.3);
const ROOT = path.join(__dirname, '..');
const grid = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'grading.json'), 'utf8')).grid;

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error(m.text()); });
  await page.setContent('<body style="margin:0"><canvas id="c" width="1600" height="1000"></canvas></body>');
  await page.addScriptTag({ content: fs.readFileSync(THREE_JS, 'utf8') });
  await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'render', 'scene.js'), 'utf8') });
  await page.evaluate((g) => ShoreScene.setGrid(g), grid);
  for (const view of ['beach', 'aerial', 'dune', 'lanai']) {
    for (const mode of ['before', 'after']) {
      const data = await page.evaluate(([view, mode, storm]) => {
        const T = THREE, canvas = document.getElementById('c');
        const r = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
        r.setSize(1600, 1000, false); r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
        r.outputEncoding = T.sRGBEncoding;
        const scene = ShoreScene.build(mode, view === 'storm' ? { storm } : {});
        const cam = ShoreScene.camera(view, mode, 1.6);
        r.render(scene, cam);
        const url = canvas.toDataURL('image/jpeg', 0.86);
        r.dispose();
        return url;
      }, [view, mode, STORM]);
      const file = path.join(ROOT, 'img', `render_${view}_${mode}.jpg`);
      fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
      console.log('wrote', path.basename(file));
    }
  }
  await browser.close();
})();
