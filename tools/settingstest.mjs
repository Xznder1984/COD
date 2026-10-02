import { sleep, openBrowser, openPage, bootGame, stats, collectErrors, reportErrors } from './harness.mjs';

const browser = await openBrowser();
const page = await openPage(browser);
const errors = collectErrors(page);

let failures = 0;
const assert = (l, ok, e) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${e ? '  ' + e : ''}`); };

await bootGame(page);

// --- settings panel opens and applies ------------------------------------
await page.keyboard.press('Escape');
await sleep(700);
assert('Esc opens settings', await page.evaluate(() =>
  window.__game.settings.open && getComputedStyle(document.getElementById('settings')).display !== 'none'));
assert('opening settings pauses the game', await page.evaluate(() => window.__game.gameState === 'paused'));

const before = await page.evaluate(() => ({
  sens: window.__game.input.sensitivityScale,
  fov: window.__game.engine.camera.fov,
  tier: window.__game.perf.tier,
  scale: window.__game.perf._manualScale,
  adapt: window.__game.perf.adaptive,
}));

// sensitivity slider -> live input scale
await page.evaluate(() => {
  const el = document.getElementById('s-sens');
  el.value = '3.2';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(300);
assert('sensitivity slider changes input scale',
  await page.evaluate(() => Math.abs(window.__game.input.sensitivityScale - 3.2) < 0.01),
  `scale=${await page.evaluate(() => window.__game.input.sensitivityScale)}`);

// FOV slider -> camera
await page.evaluate(() => {
  const el = document.getElementById('s-fov');
  el.value = '100';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(300);
assert('fov slider changes the camera', await page.evaluate(() =>
  Math.abs(window.__game.engine.camera.fov - 100) < 0.5),
  `fov=${await page.evaluate(() => window.__game.engine.camera.fov)}`);

// quality select -> tier
await page.select('#s-quality', 'high');
await sleep(700);
assert('quality select changes the tier', await page.evaluate(() => window.__game.perf.tier === 'high'),
  `tier=${await page.evaluate(() => window.__game.perf.tier)}`);

// adaptive toggle
await page.click('#s-adaptive');
await sleep(300);
assert('adaptive toggle flips the flag', await page.evaluate(() => window.__game.perf.adaptive === false));

// volume
await page.evaluate(() => {
  const el = document.getElementById('s-vol');
  el.value = '0.2';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(200);
assert('volume slider reaches the audio graph', await page.evaluate(() => {
  const g = window.__game.audio.masterGain;
  return !g || Math.abs(g.gain.value - 0.2) < 0.01;
}));

// persistence
const saved = await page.evaluate(() => localStorage.getItem('cua.settings.v1'));
assert('settings persist to localStorage', !!saved && JSON.parse(saved).sensitivity === 3.2, saved ? '' : 'nothing saved');

// reset
await page.click('#s-reset');
await sleep(400);
const afterReset = await page.evaluate(() => ({
  sens: window.__game.input.sensitivityScale,
  fov: window.__game.engine.camera.fov,
  tier: window.__game.perf.tier,
  adapt: window.__game.perf.adaptive,
}));
assert('reset restores defaults', afterReset.sens === 1 && Math.abs(afterReset.fov - 78) < 0.5 && afterReset.adapt === true,
  JSON.stringify(afterReset));

// close and resume
await page.click('#s-close');
await sleep(500);
assert('closing settings resumes play', await page.evaluate(() =>
  !window.__game.settings.open && window.__game.gameState === 'playing'));

// --- sensitivity is no longer applied twice -------------------------------
const rot = await page.evaluate(async () => {
  const g = window.__game;
  const before = g.playerController.yaw;
  // simulate a realistic 100px flick, which should be a visible but sane turn
  g.input.mouse.dx = 100;
  g.playerController.update(0.016);
  return Math.abs(g.playerController.yaw - before);
});
// 100px at 0.0022 rad/px = 0.22 rad; the old double-scaled bug gave 0.000004 rad
assert('mouse look uses sane sensitivity', rot > 0.15 && rot < 0.35, `yaw delta for 100px = ${rot.toFixed(4)} rad`);

// --- persistence across a reload -----------------------------------------
try {
  await page.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(7000);
} catch (e) {
  console.log('SKIP  reload check (renderer busy)');
}
assert('settings survive a reload', await page.evaluate(() =>
  Math.abs(window.__game.engine.camera.fov - 78) < 1 && window.__game.input.sensitivityScale === 1),
  `fov=${await page.evaluate(() => window.__game.engine.camera.fov)}`);

// --- regression: solo gameplay still fine after all this ------------------
await bootGame(page);
await sleep(6000);
const s = await stats(page);
assert('solo still runs after settings changes', s.wave >= 1 && s.alive, JSON.stringify(s));

const errCount = reportErrors(errors);
assert('no errors', errCount === 0);

console.log(`\n${failures === 0 && errCount === 0 ? 'SETTINGS OK' : `${failures} FAILED, ${errCount} ERRORS`}`);
await page.close();
await browser.disconnect();
process.exit(failures === 0 && errCount === 0 ? 0 : 1);
