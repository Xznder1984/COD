import fs from 'fs';
import { sleep, openBrowser, openPage, bootGame, stats, collectErrors, reportErrors } from './harness.mjs';

const TAG = process.env.TAG || 'shot';
const VIEWS = {
  'menu': null,
  'street': { x: 0, z: 12, yaw: Math.PI, pitch: 0.0 },
  'plaza': { x: 0, z: 20, yaw: Math.PI, pitch: 0.04 },
  'open': { x: 0, z: -26, yaw: 0, pitch: 0.03 },
  'alley': { x: -20, z: -18, yaw: Math.PI * 0.75, pitch: 0.0 },
  'corner': { x: 22, z: 20, yaw: Math.PI * 1.3, pitch: 0.0 },
  'sky': { x: 0, z: 0, yaw: 0, pitch: 0.62 },
  'ground': { x: 0, z: 0, yaw: 0, pitch: -0.7 },
};
const only = process.env.VIEWS ? process.env.VIEWS.split(',') : Object.keys(VIEWS);
const OUT = 'shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await openBrowser();
const page = await openPage(browser, 1024, 576);
const errors = collectErrors(page);

await page.goto(process.env.GAME_URL || 'http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await sleep(5000);

for (const name of only) {
  const v = VIEWS[name];
  if (v === undefined) continue;
  if (v === null) {
    await page.screenshot({ path: `${OUT}/${TAG}-${name}.png` });
    console.log('captured', name);
    continue;
  }
  if (name !== 'menu') {
    if (i === 0) {
      const solo = await page.$('#btn-solo');
      if (solo) await solo.click();
      else {
        const b = await page.$('#deploy-btn');
        if (b) await b.click();
      }
      await sleep(2200);
    }
    await page.evaluate(() => {
      const g = window.__game;
      g.playerHealth.takeDamage = () => {};
      g.playerHealth.health = 100;
    });
  }
  await page.evaluate((v) => {
    const g = window.__game;
    g.playerController.position.set(v.x, 1.75, v.z);
    g.playerController.yaw = v.yaw;
    g.playerController.pitch = v.pitch;
    g.playerController.velocity.set(0, 0, 0);
  }, v);
  await sleep(1000);
  await page.screenshot({ path: `${OUT}/${TAG}-${name}.png` });
  console.log('captured', name);
}

console.log(JSON.stringify(await stats(page)));
reportErrors(errors, 4);
await page.close();
await browser.disconnect();