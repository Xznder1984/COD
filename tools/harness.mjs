import puppeteer from 'puppeteer';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const TARGET = process.env.GAME_URL || 'http://127.0.0.1:3000/';

const DEBUG_PORT = process.env.BROWSER_DEBUG_PORT || '9222';
const LAUNCH_ARGS = [
  '--no-sandbox',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-sync',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-component-update',
  '--password-store=basic',
  '--use-mock-keychain',
  '--mute-audio',
];

export function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/AudioContext/.test(m.text())) errors.push(m.text());
  });
  page.on('requestfailed', (r) => {
    if (!/favicon/.test(r.url())) errors.push(`REQFAIL ${r.url()} ${r.failure()?.errorText}`);
  });
  return errors;
}

export function reportErrors(errors, limit = 8) {
  const uniq = [...new Set(errors)];
  console.log(`\nerrors: ${uniq.length}`);
  for (const e of uniq.slice(0, limit)) console.log('  ! ' + String(e).slice(0, 260));
  return uniq.length;
}

/**
 * Connects to a Chrome already listening on the debug port, launching one first if
 * nothing is there. Reusing a single browser keeps this usable on machines where a
 * cold Chrome start takes tens of seconds.
 */
export async function openBrowser() {
  const endpoint = `http://127.0.0.1:${DEBUG_PORT}`;
  try {
    const res = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) return await puppeteer.connect({ browserURL: endpoint, protocolTimeout: 300000 });
  } catch (e) {}

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [...LAUNCH_ARGS, `--remote-debugging-port=${DEBUG_PORT}`],
    defaultViewport: { width: 1024, height: 576 },
    protocolTimeout: 300000,
  });
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try {
      const r = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) break;
    } catch (e) {}
  }
  return browser;
}

export async function openPage(browser, width = 1024, height = 576) {
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  return page;
}

/**
 * Boots the game into solo mode and returns once the first wave is under way.
 * The boot flow now starts at the lobby, so prefer "Play Solo" and fall back to the
 * old deploy button in case the lobby is absent.
 */
export async function bootGame(page, { immortal = true } = {}) {
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(5000);

  const solo = await page.$('#btn-solo');
  if (solo) {
    await solo.click();
  } else {
    const boot = await page.$('#deploy-btn');
    if (boot) await boot.click();
  }
  await sleep(2000);

  if (immortal) {
    await page.evaluate(() => {
      const g = window.__game;
      g.playerHealth.takeDamage = () => {};
      g.playerHealth.health = 100;
    });
  }
}

export function stats(page) {
  return page.evaluate(() => {
    const g = window.__game;
    return {
      fps: +g.perf.currentFps.toFixed(1),
      tier: g.perf.tier,
      res: `${g.perf.getRenderWidth()}x${g.perf.getRenderHeight()}`,
      calls: g.engine.getDrawCalls(),
      tris: g.engine.getTriangles(),
      wave: g.wave,
      kills: g.kills,
      weapon: g.weaponSystem.currentType,
      ammo: g.weaponSystem.getCurrentWeapon().ammo,
      hp: +g.playerHealth.getHealth().toFixed(0),
      alive: g.playerHealth.isAlive(),
      state: g.gameState,
    };
  });
}