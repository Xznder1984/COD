/**
 * Operation: Urban Assault — multiplayer server.
 *
 * Serves the built client and runs an authoritative game loop: it owns the enemies,
 * the wave director, damage and scoring. Clients send their transform and fire
 * requests; this server decides what was actually hit.
 *
 *     npm run serve:mp        (or)  python3 run.py --mp
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import {
  MAP_HALF,
  BUILDINGS,
  PERIMETER,
  SPAWN_POINTS,
  staticColliders,
  resolveCircle,
  lineOfSight,
  buildNavGrid,
  findPath,
  nearestWalkable,
} from '../src/shared/mapdata.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const PORT = Number(process.env.PORT || 8080);
const TICK_HZ = 20;
const TICK_DT = 1 / TICK_HZ;
const SNAPSHOT_EVERY = 2;

const MAX_PLAYERS = 8;
const MAX_ENEMIES = 14;
const PLAYER_RADIUS = 0.4;
const PLAYER_HEIGHT = 1.8;
const SPAWN_PROTECT = 2.5;

const ENEMY = {
  hp: { scout: 60, assault: 100, heavy: 160 },
  speed: { scout: 3.4, assault: 2.5, heavy: 2.0 },
  damage: { scout: 7, assault: 10, heavy: 15 },
  fireInterval: { scout: 0.85, assault: 1.25, heavy: 1.6 },
  accuracy: { scout: 0.28, assault: 0.22, heavy: 0.18 },
  preferredRange: { scout: 9, assault: 13, heavy: 10 },
  radius: { scout: 0.4, assault: 0.42, heavy: 0.55 },
};

// ---------------------------------------------------------------- geometry

const nav = buildNavGrid(2.5);
const flatBoxes = staticColliders();

/** 3D boxes for bullet occlusion, built once. */
const worldBoxes = [];
for (const b of BUILDINGS) {
  const [w, h, d] = b.size;
  worldBoxes.push({
    min: [b.pos[0] - w / 2, 0, b.pos[1] - d / 2],
    max: [b.pos[0] + w / 2, h, b.pos[1] + d / 2],
  });
}
for (const p of PERIMETER) {
  const [w, h, d] = p.size;
  worldBoxes.push({
    min: [p.pos[0] - w / 2, 0, p.pos[1] - d / 2],
    max: [p.pos[0] + w / 2, h, p.pos[1] + d / 2],
  });
}

function rayBox(ox, oy, oz, dx, dy, dz, box) {
  let tmin = 0;
  let tmax = Infinity;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-8) {
      if (o[a] < box.min[a] || o[a] > box.max[a]) return null;
      continue;
    }
    const inv = 1 / d[a];
    let t1 = (box.min[a] - o[a]) * inv;
    let t2 = (box.max[a] - o[a]) * inv;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmax < tmin) return null;
  }
  return tmin;
}

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const mx = ox - cx, my = oy - cy, mz = oz - cz;
  const b = mx * dx + my * dy + mz * dz;
  const c = mx * mx + my * my + mz * mz - r * r;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}

/** Nearest static geometry along a ray. Returns distance or Infinity. */
function rayWorld(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  for (let i = 0; i < worldBoxes.length; i++) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, worldBoxes[i]);
    if (t !== null && t < best) best = t;
  }
  return best;
}

// ---------------------------------------------------------------- state

let nextId = 1;
const players = new Map();
const enemies = new Map();

const game = {
  wave: 0,
  waveActive: false,
  spawnQueue: 0,
  waveDelay: 6,
  tick: 0,
  time: 0,
  totalKills: 0,
};

function send(ws, type, data) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ t: type, ...data }));
  }
}

function broadcast(type, data) {
  const msg = JSON.stringify({ t: type, ...data });
  for (const p of players.values()) {
    if (p.ws.readyState === 1) p.ws.send(msg);
  }
}

function eventTo(ws, type, data) {
  send(ws, 'event', { e: { type, ...data } });
}

function freeSpawn() {
  const taken = [];
  for (const p of players.values()) taken.push(p);
  for (let i = 0; i < 60; i++) {
    const [sx, sz] = SPAWN_POINTS[(Math.random() * SPAWN_POINTS.length) | 0];
    const jx = sx + (Math.random() - 0.5) * 3;
    const jz = sz + (Math.random() - 0.5) * 3;
    let clear = true;
    for (const t of taken) {
      if ((t.x - jx) ** 2 + (t.z - jz) ** 2 < 100) { clear = false; break; }
    }
    if (clear) {
      const spot = nearestWalkable(nav, jx, jz);
      return spot;
    }
  }
  return nearestWalkable(nav, 0, 0);
}

function addPlayer(ws, name) {
  const id = nextId++;
  const spot = freeSpawn();
  const p = {
    id,
    ws,
    name: String(name || 'Operator').slice(0, 16),
    x: spot.x,
    y: 0,
    z: spot.z,
    yaw: 0,
    pitch: 0,
    hp: 100,
    alive: true,
    kills: 0,
    deaths: 0,
    damageTaken: 0,
    lastFire: 0,
    invulnUntil: game.time + SPAWN_PROTECT,
    inputAt: game.time,
  };
  players.set(id, p);
  return p;
}

// ---------------------------------------------------------------- enemies

function spawnEnemy(variant) {
  const v = variant || (Math.random() < 0.3 ? 'heavy' : Math.random() < 0.6 ? 'scout' : 'assault');
  const spot = freeSpawn();
  const e = {
    id: nextId++,
    variant: v,
    x: spot.x,
    z: spot.z,
    yaw: 0,
    hp: ENEMY.hp[v],
    maxHp: ENEMY.hp[v],
    alive: true,
    targetId: null,
    fireTimer: 0.6 + Math.random(),
    path: null,
    pathIndex: 0,
    repathAt: 0,
    strafe: Math.random() < 0.5 ? 1 : -1,
    strafeTimer: 1 + Math.random() * 2,
    hitFlashUntil: 0,
    deathAt: 0,
  };
  enemies.set(e.id, e);
  return e;
}

function nearestPlayer(x, z, exclude) {
  let best = null;
  let bd = Infinity;
  for (const p of players.values()) {
    if (!p.alive || p.id === exclude) continue;
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function updateEnemy(e, dt) {
  if (!e.alive) {
    if (game.time - e.deathAt > 2.5) enemies.delete(e.id);
    return;
  }

  const target = nearestPlayer(e.x, e.z);
  e.targetId = target ? target.id : null;

  if (!target) {
    e.fireTimer = 0.6;
    return;
  }

  const dx = target.x - e.x;
  const dz = target.z - e.z;
  const dist = Math.hypot(dx, dz) || 1;
  const los = lineOfSight(e.x, e.z, target.x, target.z, flatBoxes);

  // Face the target (or drift while pathing).
  const wantYaw = Math.atan2(dx, dz);
  let diff = wantYaw - e.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  e.yaw += diff * Math.min(1, dt * 7);

  e.strafeTimer -= dt;
  if (e.strafeTimer <= 0) {
    e.strafe *= -1;
    e.strafeTimer = 1.2 + Math.random() * 2.2;
  }

  const pref = ENEMY.preferredRange[e.variant];
  let moveX = 0;
  let moveZ = 0;

  if (los && dist < 34) {
    // In range: hold a band and strafe.
    const closing = (dist - pref) / Math.max(pref, 1);
    moveX += (dx / dist) * closing;
    moveZ += (dz / dist) * closing;
    moveX += (-dz / dist) * e.strafe * 0.8;
    moveZ += (dx / dist) * e.strafe * 0.8;

    e.fireTimer -= dt;
    if (e.fireTimer <= 0) {
      e.fireTimer = ENEMY.fireInterval[e.variant] * (0.75 + Math.random() * 0.5);
      if (game.time > target.invulnUntil) {
        const hitChance = ENEMY.accuracy[e.variant] * (1 - Math.min(0.45, dist / 70));
        if (Math.random() < hitChance) {
          damagePlayer(target, ENEMY.damage[e.variant], e);
        }
      }
      broadcast('fx', { k: 'enemyFire', id: e.id, x: e.x, y: 1.2, z: e.z });
    }
  }

  // Repath periodically toward the target when we can't see them.
  if (!los || game.time > e.repathAt) {
    e.repathAt = game.time + 0.9;
    const path = findPath(nav, { x: e.x, z: e.z }, { x: target.x, z: target.z });
    if (path && path.length > 1) {
      e.path = path;
      e.pathIndex = 1;
    }
  }

  if (e.path && e.pathIndex < e.path.length) {
    const wp = e.path[e.pathIndex];
    const wx = wp.x - e.x;
    const wz = wp.z - e.z;
    const wd = Math.hypot(wx, wz);
    if (wd < 0.7) {
      e.pathIndex++;
    } else {
      moveX += wx / wd * 1.2;
      moveZ += wz / wd * 1.2;
    }
  }

  const mag = Math.hypot(moveX, moveZ);
  if (mag > 0.001) {
    const sp = ENEMY.speed[e.variant] * dt;
    e.x += (moveX / mag) * sp;
    e.z += (moveZ / mag) * sp;
    resolveCircle(e, ENEMY.radius[e.variant] + 0.1, flatBoxes);
    e.x = Math.max(-MAP_HALF + 1, Math.min(MAP_HALF - 1, e.x));
    e.z = Math.max(-MAP_HALF + 1, Math.min(MAP_HALF - 1, e.z));
  }
}

function damagePlayer(p, amount, from) {
  if (!p.alive || game.time < p.invulnUntil) return;
  p.hp -= amount;
  p.damageTaken += amount;
  eventTo(p.ws, 'damage', {
    amount,
    fromX: from ? from.x : p.x,
    fromZ: from ? from.z : p.z,
    hp: Math.max(0, p.hp),
  });
  if (p.hp <= 0) {
    p.hp = 0;
    p.alive = false;
    p.deaths++;
    broadcast('event', { e: { type: 'playerDown', id: p.id, name: p.name } });
    broadcast('killfeed', {
      killer: from ? 'Hostiles' : 'Unknown',
      victim: p.name,
      headshot: false,
    });
  }
}

function hurtEnemy(e, amount, shooter, headshot) {
  if (!e.alive) return false;
  e.hp -= amount;
  e.hitFlashUntil = game.time + 0.12;
  broadcast('fx', { k: 'impact', x: e.x, y: headshot ? 1.62 : 0.95, z: e.z, blood: true });
  if (e.hp > 0) return false;

  e.alive = false;
  e.deathAt = game.time;
  shooter.kills++;
  game.totalKills++;
  broadcast('killfeed', {
    killer: shooter.name,
    victim: 'Hostile ' + e.variant,
    headshot: !!headshot,
  });
  broadcast('event', { e: { type: 'enemyDown', id: e.id, by: shooter.id } });
  return true;
}

// ---------------------------------------------------------------- waves

function startWave() {
  game.wave++;
  game.waveActive = true;
  const budget = Math.min(MAX_ENEMIES, 3 + game.wave);
  game.spawnQueue = budget;
  game.waveTotal = budget;
  broadcast('event', { e: { type: 'wave', wave: game.wave, total: budget } });
}

function updateWaves(dt) {
  if (!game.waveActive) {
    if (players.size > 0) {
      game.waveDelay -= dt;
      if (game.waveDelay <= 0) startWave();
    }
    return;
  }

  if (game.spawnQueue > 0) {
    game.spawnTimer = (game.spawnTimer || 0) - dt;
    if (game.spawnTimer <= 0) {
      game.spawnTimer = 0.55;
      game.spawnQueue--;
      spawnEnemy();
    }
  }

  let alive = 0;
  for (const e of enemies.values()) if (e.alive) alive++;
  if (game.spawnQueue === 0 && alive === 0) {
    game.waveActive = false;
    game.waveDelay = 8;
    broadcast('event', { e: { type: 'waveClear', wave: game.wave } });
  }
}

// ---------------------------------------------------------------- networking

function snapshot() {
  const playersOut = [];
  for (const p of players.values()) {
    playersOut.push({
      id: p.id, name: p.name, x: round2(p.x), y: round2(p.y), z: round2(p.z),
      yaw: round3(p.yaw), pitch: round3(p.pitch), hp: p.hp, alive: p.alive,
      kills: p.kills, deaths: p.deaths,
    });
  }
  const enemiesOut = [];
  for (const e of enemies.values()) {
    if (!e.alive) continue;
    enemiesOut.push({
      id: e.id, v: e.variant, x: round2(e.x), z: round2(e.z), yaw: round3(e.yaw),
      hp: e.hp, maxHp: e.maxHp, flash: game.time < e.hitFlashUntil ? 1 : 0,
    });
  }
  return {
    t: 'snapshot',
    tick: game.tick,
    time: round3(game.time),
    players: playersOut,
    enemies: enemiesOut,
    wave: game.wave,
    waveActive: game.waveActive,
    remaining: game.spawnQueue + enemiesOut.length,
    totalKills: game.totalKills,
  };
}

const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;

function handleMessage(p, raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return; }

  switch (m.t) {
    case 'state': {
      p.x = Number(m.x) || 0;
      p.y = Number(m.y) || 0;
      p.z = Number(m.z) || 0;
      p.yaw = Number(m.yaw) || 0;
      p.pitch = Number(m.pitch) || 0;
      if (Number.isFinite(m.hp)) p.hp = Math.max(0, Math.min(100, m.hp));
      p.inputAt = game.time;
      break;
    }
    case 'shoot': {
      if (!p.alive || game.time - p.lastFire < 0.05) return;
      p.lastFire = game.time;
      const ox = Number(m.ox), oy = Number(m.oy), oz = Number(m.oz);
      const dx = Number(m.dx), dy = Number(m.dy), dz = Number(m.dz);
      if (![ox, oy, oz, dx, dy, dz].every(Number.isFinite)) return;
      const len = Math.hypot(dx, dy, dz) || 1;
      const nx = dx / len, ny = dy / len, nz = dz / len;
      const maxDist = 220;

      let bestT = rayWorld(ox, oy, oz, nx, ny, nz, maxDist);
      let hitEnemy = null;
      let headshot = false;

      for (const e of enemies.values()) {
        if (!e.alive) continue;
        const tBody = raySphere(ox, oy, oz, nx, ny, nz, e.x, 0.95, e.z, ENEMY.radius[e.variant]);
        const tHead = raySphere(ox, oy, oz, nx, ny, nz, e.x, 1.62, e.z, 0.18);
        let t = -1;
        if (tHead >= 0 && (tBody < 0 || tHead <= tBody + 0.3)) { t = tHead; headshot = true; }
        else if (tBody >= 0) { t = tBody; headshot = false; }
        if (t >= 0 && t < bestT) { bestT = t; hitEnemy = e; }
      }

      const damage = (Number(m.damage) || 25) * (headshot ? 2 : 1);
      if (process.env.MP_DEBUG) {
        console.log(`[shoot] from ${p.name} org=${ox.toFixed(1)},${oy.toFixed(1)},${oz.toFixed(1)} worldHit=${bestT === maxDist ? 'none' : bestT.toFixed(1)} enemy=${hitEnemy ? hitEnemy.id + '/' + hitEnemy.variant : 'none'} head=${headshot} enemies=${enemies.size}`);
      }
      if (hitEnemy) {
        hurtEnemy(hitEnemy, damage, p, headshot);
      } else if (bestT < maxDist) {
        broadcast('fx', { k: 'impact', x: ox + nx * bestT, y: oy + ny * bestT, z: oz + nz * bestT });
      }
      break;
    }
    case 'respawn': {
      if (p.alive) break;
      const spot = freeSpawn();
      p.x = spot.x;
      p.z = spot.z;
      p.hp = 100;
      p.alive = true;
      p.invulnUntil = game.time + SPAWN_PROTECT;
      eventTo(p.ws, 'respawned', {});
      break;
    }
    case 'ping': {
      p.ws.send(JSON.stringify({ t: 'pong', c: m.c }));
      break;
    }
  }
}

// ---------------------------------------------------------------- http

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      online: true,
      players: players.size,
      enemies: [...enemies.values()].filter((e) => e.alive).length,
      wave: game.wave,
      kills: game.totalKills,
    }));
    return;
  }
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  const filePath = path.join(DIST, rel);
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  serveFile(res, filePath);
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  if (process.env.MP_DEBUG) console.log(`[ws] connection from ${req.socket.remoteAddress}`);
  if (players.size >= MAX_PLAYERS) {
    ws.send(JSON.stringify({ t: 'full' }));
    ws.close();
    return;
  }
  let player = null;

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t === 'join') {
      if (process.env.MP_DEBUG) console.log(`[ws] join from ${m.name}`);
      player = addPlayer(ws, m.name);
      send(ws, 'welcome', {
        id: player.id,
        tick: game.tick,
        wave: game.wave,
        players: [...players.values()].map((p) => ({ id: p.id, name: p.name })),
      });
      broadcast('join', { id: player.id, name: player.name });
      return;
    }
    if (player) handleMessage(player, raw);
  });

  ws.on('close', () => {
    if (process.env.MP_DEBUG) console.log(`[ws] closed (joined=${!!player})`);
    if (player) {
      broadcast('leave', { id: player.id, name: player.name });
      players.delete(player.id);
    }
  });

  ws.on('error', () => {});
});

// ---------------------------------------------------------------- loop

setInterval(() => {
  game.tick++;
  game.time += TICK_DT;

  for (const e of enemies.values()) updateEnemy(e, TICK_DT);
  updateWaves(TICK_DT);

  if (game.tick % SNAPSHOT_EVERY === 0) {
    const snap = JSON.stringify(snapshot());
    for (const p of players.values()) {
      if (p.ws.readyState === 1) p.ws.send(snap);
    }
  }
}, TICK_DT * 1000);

// ---------------------------------------------------------------- go

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('No build found in dist/. Run `npm run build` first.');
  process.exit(1);
}

function localAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return '127.0.0.1';
}

server.listen(PORT, '0.0.0.0', () => {
  const lan = localAddress();
  console.log('');
  console.log('  Operation: Urban Assault — multiplayer server');
  console.log('');
  console.log(`  This machine:  http://localhost:${PORT}/`);
  console.log(`  Other devices: http://${lan}:${PORT}/`);
  console.log('');
  console.log(`  Up to ${MAX_PLAYERS} players. Ctrl+C to stop.`);
  console.log('');
});