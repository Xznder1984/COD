import { sleep, openBrowser, openPage, bootGame, stats, collectErrors, reportErrors } from './harness.mjs';

const browser = await openBrowser();
const page = await openPage(browser);
const errors = collectErrors(page);

const check = (label, ok, extra = '') =>
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);

let failures = 0;
const assert = (label, ok, extra) => {
  if (!ok) failures++;
  check(label, ok, extra);
};

await bootGame(page);

assert('game starts from the lobby in solo mode',
  await page.evaluate(() => {
    const lobby = document.getElementById('lobby');
    const lobbyHidden = !lobby || getComputedStyle(lobby).display === 'none';
    const boot = document.getElementById('boot-screen');
    const bootHidden = !boot || getComputedStyle(boot).display === 'none';
    return window.__game.gameState === 'playing' && window.__game.mode === 'solo'
      && lobbyHidden && bootHidden;
  }));

await sleep(6000);
let s = await stats(page);
assert('wave spawns enemies', s.wave >= 1 && s.hp > 0, `wave=${s.wave} hp=${s.hp}`);

const before = await page.evaluate(() => {
  const p = window.__game.playerController.getPosition();
  return { x: p.x, z: p.z };
});
await page.keyboard.down('KeyW');
await sleep(1400);
await page.keyboard.up('KeyW');
await sleep(300);
const after = await page.evaluate(() => {
  const p = window.__game.playerController.getPosition();
  return { x: p.x, z: p.z };
});
const moved = Math.hypot(after.x - before.x, after.z - before.z);
assert('player moves with WASD', moved > 1.5, `moved=${moved.toFixed(2)}m`);

const py = await page.evaluate(() => window.__game.playerController.position.y);
assert('player grounded (not ejected by collider)', py > 1.0 && py < 2.6, `y=${py.toFixed(2)}`);

await page.keyboard.down('Space');
await sleep(200);
const jumpY = await page.evaluate(() => window.__game.playerController.position.y);
await page.keyboard.up('Space');
assert('player jumps', jumpY > py + 0.2, `y=${jumpY.toFixed(2)}`);
await sleep(1500);

for (const [key, want] of [['Digit3', 'sniper'], ['Digit1', 'rifle'], ['Digit2', 'smg'], ['Digit1', 'rifle']]) {
  await page.keyboard.press(key);
  await sleep(1300);
  s = await stats(page);
  assert(`weapon switch ${key} -> ${want}`, s.weapon === want, `weapon=${s.weapon}`);
}

await page.mouse.down({ button: 'right' });
await sleep(700);
const ads = await page.evaluate(() => window.__game.weaponSystem.isAds);
await page.mouse.up({ button: 'right' });
await sleep(400);
assert('ADS engages', ads === true);

const ammoBefore = await page.evaluate(() => window.__game.weaponSystem.getCurrentWeapon().ammo);
await page.mouse.down({ button: 'left' });
await sleep(900);
await page.mouse.up({ button: 'left' });
await sleep(300);
const ammoAfter = await page.evaluate(() => window.__game.weaponSystem.getCurrentWeapon().ammo);
assert('firing consumes ammo', ammoAfter < ammoBefore, `${ammoBefore} -> ${ammoAfter}`);

await page.keyboard.press('KeyR');
await sleep(3200);
const ammoReloaded = await page.evaluate(() => window.__game.weaponSystem.getCurrentWeapon().ammo);
assert('reload refills magazine', ammoReloaded > ammoAfter, `${ammoAfter} -> ${ammoReloaded}`);

// bootGame made the player immortal for the earlier checks; restore real damage
await page.evaluate(() => {
  const h = window.__game.playerHealth;
  delete h.takeDamage;
  h.takeDamage = Object.getPrototypeOf(h).takeDamage;
  h.takeDamage(200);
});
await sleep(1500);
s = await stats(page);
assert('player dies at 0 hp', s.hp === 0 && !s.alive, `state=${s.state}`);
assert('game over screen shown', await page.evaluate(() =>
  [...document.querySelectorAll('button')].some((b) => /REDEPLOY/i.test(b.textContent)) &&
  /KIA|WAVES SURVIVED/i.test(document.body.innerText)));

const redeploy = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /REDEPLOY/i.test(x.textContent));
  if (b) { b.click(); return true; }
  return false;
});
assert('redeploy button present', redeploy);
await sleep(2500);
s = await stats(page);
assert('redeploy restarts cleanly', s.alive && s.hp === 100 && s.wave === 0, JSON.stringify(s));

await page.evaluate(() => { window.__game.menus.showPause(); window.__game.gameState = 'paused'; });
await sleep(600);
assert('pause menu renders', await page.evaluate(() => /RESUME/i.test(document.body.innerText)));
await page.evaluate(() => { window.__game.menus.hideAll(); window.__game.gameState = 'playing'; });
await sleep(400);

const tiers = [];
for (let i = 0; i < 5; i++) {
  await page.keyboard.press('KeyP');
  await sleep(700);
  tiers.push((await stats(page)).tier);
}
assert('quality cycles through tiers', new Set(tiers).size >= 4, tiers.join(' > '));

console.log('\nfinal: ' + JSON.stringify(await stats(page)));
const errCount = reportErrors(errors);
console.log(`\n${failures === 0 && errCount === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILED, ${errCount} ERRORS`}`);

await page.close();
await browser.disconnect();
process.exit(failures === 0 && errCount === 0 ? 0 : 1);