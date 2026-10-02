/**
 * Multiplayer client.
 *
 * Owns the WebSocket link and the snapshot buffers. The server is authoritative for
 * enemies, damage and scoring; this side sends its transform and fire requests, and
 * interpolates everything it receives so movement looks smooth despite a 10Hz feed.
 */

const SEND_HZ = 20;
const INTERP_DELAY = 0.12;

export class Network {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.connecting = false;
    this.selfId = null;
    this.players = new Map();
    this.enemyBuffer = [];
    this.wave = 0;
    this.waveActive = false;
    this.remaining = 0;
    this.totalKills = 0;
    this.serverTime = 0;
    this.ping = 0;
    this.lastError = '';
    this.latency = false;

    this._sendTimer = 0;
    this._pingTimer = 0;
    this._pingSent = 0;
    this._onWelcome = null;
    this._onSnapshot = null;
    this._onEvent = null;
    this._onKillfeed = null;
    this._onFx = null;
    this._onStatus = null;
    this._onDisconnect = null;
  }

  on(name, fn) {
    this['_on' + name.charAt(0).toUpperCase() + name.slice(1)] = fn;
    return this;
  }

  get online() {
    return this.connected;
  }

  connect(url, name) {
    if (this.connecting || this.connected) return;
    this.connecting = true;
    this.lastError = '';

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this.connecting = false;
      this.lastError = String(e && e.message ? e.message : e);
      if (this._onStatus) this._onStatus(this);
      return;
    }

    ws.onopen = () => {
      this.connecting = false;
      this.connected = true;
      ws.send(JSON.stringify({ t: 'join', name }));
      if (this._onStatus) this._onStatus(this);
    };

    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.t) {
        case 'welcome':
          this.selfId = m.id;
          this.wave = m.wave || 0;
          this.players.clear();
          for (const p of m.players || []) {
            if (p.id !== this.selfId) this.players.set(p.id, { id: p.id, name: p.name, x: 0, y: 0, z: 0, yaw: 0, hp: 100, alive: true, kills: 0, deaths: 0, targetX: 0, targetZ: 0, targetYaw: 0 });
          }
          if (this._onWelcome) this._onWelcome(m);
          break;
        case 'snapshot':
          this._applySnapshot(m);
          if (this._onSnapshot) this._onSnapshot(m);
          break;
        case 'event':
          if (this._onEvent) this._onEvent(m.e);
          break;
        case 'killfeed':
          if (this._onKillfeed) this._onKillfeed(m);
          break;
        case 'fx':
          if (this._onFx) this._onFx(m);
          break;
        case 'pong':
          this.ping = Math.round(performance.now() - this._pingSent);
          break;
        case 'full':
          this.lastError = 'server is full';
          this.disconnect();
          break;
      }
    };

    ws.onerror = () => {
      this.lastError = this.lastError || 'connection failed';
    };

    ws.onclose = () => {
      const was = this.connected;
      this.connecting = false;
      this.connected = false;
      this.ws = null;
      this.enemyBuffer.length = 0;
      if (was && this._onDisconnect) this._onDisconnect();
      if (this._onStatus) this._onStatus(this);
    };

    this.ws = ws;
  }

  disconnect() {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
    }
    this.ws = null;
    this.connected = false;
    this.enemyBuffer.length = 0;
    if (this._onStatus) this._onStatus(this);
  }

  _applySnapshot(m) {
    this.serverTime = m.time;
    this.wave = m.wave;
    this.waveActive = m.waveActive;
    this.remaining = m.remaining;
    this.totalKills = m.totalKills;

    for (const p of m.players) {
      if (p.id === this.selfId) continue;
      let e = this.players.get(p.id);
      if (!e) {
        e = { id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, hp: 100, alive: true };
        this.players.set(p.id, e);
      }
      e.targetX = p.x;
      e.targetY = p.y !== undefined ? p.y : 0;
      e.targetZ = p.z;
      // take the short way round rather than unwinding thousands of radians
      let d = p.yaw - e.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      e.targetYaw = e.yaw + d;
      e.name = p.name;
      e.hp = p.hp;
      e.alive = p.alive;
      e.kills = p.kills;
      e.deaths = p.deaths;
    }
    for (const id of [...this.players.keys()]) {
      if (!m.players.some((p) => p.id === id)) this.players.delete(id);
    }

    this.enemyBuffer.push({ t: m.time, list: m.enemies });
    if (this.enemyBuffer.length > 12) this.enemyBuffer.shift();
  }

  /** Advance interpolation and return smoothed enemy + player transforms. */
  sample(dt) {
    const renderTime = this.serverTime - INTERP_DELAY;
    let frame = null;
    for (let i = this.enemyBuffer.length - 1; i >= 0; i--) {
      if (this.enemyBuffer[i].t <= renderTime) { frame = this.enemyBuffer[i]; break; }
    }
    if (!frame && this.enemyBuffer.length) frame = this.enemyBuffer[0];

    const a = Math.min(1, dt * 10);

    for (const p of this.players.values()) {
      p.x += (p.targetX - p.x) * a;
      p.y += ((p.targetY || 0) - p.y) * a;
      p.z += (p.targetZ - p.z) * a;
      let d = p.targetYaw - p.yaw;
      p.yaw += d * Math.min(1, dt * 10);
    }

    return frame ? frame.list : [];
  }

  tick(dt, localPlayer, firing) {
    if (!this.connected || !this.ws || this.ws.readyState !== 1) return;

    this._sendTimer += dt;
    if (this._sendTimer >= 1 / SEND_HZ) {
      this._sendTimer = 0;
      this._send({
        t: 'state',
        x: localPlayer.x, y: localPlayer.y, z: localPlayer.z,
        yaw: localPlayer.yaw, pitch: localPlayer.pitch,
        hp: localPlayer.hp,
      });
      if (firing) this._send({ t: 'firing', on: true });
    }

    this._pingTimer += dt;
    if (this._pingTimer >= 2) {
      this._pingTimer = 0;
      this._pingSent = performance.now();
      this._send({ t: 'ping', c: 1 });
    }
  }

  shoot(origin, direction, damage) {
    if (!this.connected || !this.ws) return;
    this._send({
      t: 'shoot',
      ox: origin.x, oy: origin.y, oz: origin.z,
      dx: direction.x, dy: direction.y, dz: direction.z,
      damage,
    });
  }

  respawn() {
    if (this.connected) this._send({ t: 'respawn' });
  }

  _send(obj) {
    try {
      this.ws.send(JSON.stringify(obj));
    } catch (e) {}
  }
}

/** Same-origin websocket URL for the page's current host. */
export function defaultServerUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

/** Probe the server's status endpoint; used to detect online/offline. */
export async function probeServer(url) {
  const httpUrl = url.replace(/^ws/, 'http').replace(/\/ws$/, '/api/status');
  try {
    const res = await fetch(httpUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error('status ' + res.status);
    return await res.json();
  } catch (e) {
    return null;
  }
}