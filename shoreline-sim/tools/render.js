// Still renders of the 3D site model (before / after) using headless Chromium.
// Usage: node shoreline-sim/tools/render.js <path-to-three.min.js>
// Writes shoreline-sim/img/render_<view>_<mode>.jpg
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const THREE_JS = process.argv[2];
const SCENE_JS = path.join(__dirname, '..', 'render', 'scene.js');
const OUT = path.join(__dirname, '..', 'img');

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.setContent('<body style="margin:0"><canvas id="c" width="1600" height="1000"></canvas></body>');
  await page.addScriptTag({ content: fs.readFileSync(THREE_JS, 'utf8') });
  await page.addScriptTag({ content: fs.readFileSync(SCENE_JS, 'utf8') });
  for (const view of ['aerial', 'beach', 'dune']) {
    for (const mode of ['before', 'after']) {
      const data = await page.evaluate(([view, mode]) => {
        const T = THREE, canvas = document.getElementById('c');
        const r = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
        r.setSize(1600, 1000, false); r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
        r.outputEncoding = T.sRGBEncoding; r.toneMapping = T.NoToneMapping;
        const scene = ShoreScene.build(mode), v = ShoreScene.VIEWS[view];
        const cam = new T.PerspectiveCamera(view === 'beach' ? 55 : 45, 1.6, 0.1, 500);
        cam.position.set(...v.pos); cam.lookAt(new T.Vector3(...v.target));
        r.render(scene, cam);
        const url = canvas.toDataURL('image/jpeg', 0.86);
        r.dispose();
        return url;
      }, [view, mode]);
      const file = path.join(OUT, `render_${view}_${mode}.jpg`);
      fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
      console.log('wrote', file);
    }
  }
  await browser.close();
})();
