import fs from 'fs';
import { sleep, openBrowser, openPage, bootGame, collectErrors, reportErrors } from './harness.mjs';

const SEGMENTS = Number(process.env.SEGMENTS || 8);
const SECONDS = Number(process.env.SECONDS || 20);
const OUT = 'shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await openBrowser();
const page = await openPage(browser);
const errors = collectErrors(page);

await bootGame(page);

/** Aims at the nearest living enemy and fires a burst. */
async function engage(seconds) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const hasTarget = await page.evaluate(() => {
      const g = window.__game;
      const list = g.enemyManager.getEnemies().filter((e) => e.isAlive());
      if (!list.length) return false;
      const p = g.playerController.getPosition();
      let best = null, bd = Infinity;
      for (const e of list) {
        const ep = e.getPosition();
        const d = (ep.x - p.x) ** 2 + (ep.z - p.z) ** 2;
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) return false;
      const ep = best.getPosition();
      const dx = ep.x - p.x, dz = ep.z - p.z;
      g.playerController.yaw = Math.atan2(-dx, -dz);
      g.playerController.pitch = Math.atan2((ep.y + 1.0) - p.y, Math.max(0.5, Math.hypot(dx, dz)));
      return true;
    });
    if (hasTarget) {
      await page.mouse.down({ button: 'left' });
      await sleep(320);
      await page.mouse.up({ button: 'left' });
    } else {
      await sleep(250);
    }
    await sleep(160);
  }
}

const sample = async (label) => {
  const s = await page.evaluate(() => {
    const g = window.__game;
    const m = performance.memory;
    return {
      fps: +g.perf.currentFps.toFixed(1),
      tier: g.perf.tier,
      scale: +g.perf.adaptiveScale.toFixed(2),
      res: `${g.perf.getRenderWidth()}x${g.perf.getRenderHeight()}`,
      calls: g.engine.getDrawCalls(),
      tris: g.engine.getTriangles(),
      wave: g.wave,
      kills: g.kills,
      enemies: g.enemyManager.enemies.length,
      heapMB: m ? +(m.usedJSHeapSize / 1048576).toFixed(1) : null,
      sceneKids: g.engine.scene.children.length,
    };
  });
  console.log(label.padEnd(9), JSON.stringify(s));
  return s;
};

const samples = [];
samples.push(await sample('boot'));
for (let i = 1; i <= SEGMENTS; i++) {
  await engage(SECONDS);
  samples.push(await sample(`t=${i * SECONDS}s`));
  if (i === Math.ceil(SEGMENTS / 2)) await page.screenshot({ path: `${OUT}/soak-mid.png` });
}
await page.screenshot({ path: `${OUT}/soak-end.png` });

const fps = samples.map((s) => s.fps);
const worst = Math.min(...fps);
const best = Math.max(...fps);
const finalWave = samples[samples.length - 1].wave;
const totalKills = samples[samples.length - 1].kills;
const heap = samples.map((s) => s.heapMB).filter((v) => v != null);
const heapDrift = heap.length > 2 ? heap[heap.length - 1] - heap[0] : 0;

console.log(`\nfps range      ${worst.toFixed(1)} - ${best.toFixed(1)}`);
console.log(`progress       wave ${finalWave}, ${totalKills} kills`);
console.log(`heap drift     ${heapDrift > 0 ? '+' : ''}${heapDrift.toFixed(1)} MB`);
console.log(`final tier     ${samples[samples.length - 1].tier} at ${samples[samples.length - 1].res}`);

const errCount = reportErrors(errors);
const ok = errCount === 0 && worst >= 24;
console.log(ok ? '\nSOAK OK' : '\nSOAK DEGRADED');
await page.close();
await browser.disconnect();
process.exit(ok ? 0 : 1);