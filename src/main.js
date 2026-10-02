import * as THREE from 'three';
import { Engine } from './core/Engine.js';
import { Input } from './core/Input.js';
import { Physics } from './core/Physics.js';
import { Audio } from './core/Audio.js';
import { AssetFactory } from './core/AssetFactory.js';
import { PerformanceManager } from './core/PerformanceManager.js';
import { Skybox } from './world/Skybox.js';
import { Lighting } from './world/Lighting.js';
import { Level } from './world/Level.js';
import { Props } from './world/Props.js';
import { WeaponSystem } from './weapons/WeaponSystem.js';
import { EnemyManager } from './enemies/EnemyManager.js';
import { ParticleSystem } from './effects/ParticleSystem.js';
import { Explosions } from './effects/Explosions.js';
import { ScreenEffects } from './effects/ScreenEffects.js';
import { PlayerController } from './player/PlayerController.js';
import { PlayerHealth } from './player/PlayerHealth.js';
import { FirstPersonArms } from './player/FirstPersonArms.js';
import { HUD } from './ui/HUD.js';
import { KillFeed } from './ui/KillFeed.js';
import { Minimap } from './ui/Minimap.js';
import { Menus } from './ui/Menus.js';
import { Lobby, describeConnectivity } from './ui/Lobby.js';
import { Network, defaultServerUrl, probeServer } from './net/Network.js';
import { NetGame } from './net/NetGame.js';

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.uiOverlay = document.getElementById('ui-overlay');

    this.perf = new PerformanceManager();
    const tierName = this.perf.detectTier();
    const q = this.perf.settings;

    this.engine = new Engine(this.canvas, this.perf);
    this.input = new Input(this.canvas);
    this.physics = new Physics();
    this.audio = new Audio();
    this.assetFactory = new AssetFactory();

    this.perf.setOnChange((settings, scale) => {
      this.engine.onQualityChange(settings, scale);
      this._applyQualityToModules();
      const badge = document.getElementById('tier-badge');
      if (badge) badge.textContent = (this.perf.enabled ? settings.name : settings.name) + ' · AUTO';
    });

    this.skybox = new Skybox(this.engine.scene, this.engine, this.physics, q);
    this.lighting = new Lighting(this.engine.scene, this.engine, this.physics, q);
    this.level = new Level(this.engine.scene, this.physics, this.assetFactory, q);
    this.props = new Props(this.engine.scene, this.physics, this.assetFactory, q);

    this.particleSystem = new ParticleSystem(this.engine.scene, q);
    this.explosions = new Explosions(this.engine.scene, this.particleSystem, q);
    this.screenEffects = new ScreenEffects(this.engine.camera, this.engine, q);

    this.playerController = new PlayerController(
      this.engine.camera, this.input, this.physics, this.audio, q
    );
    this.playerHealth = new PlayerHealth();
    this.firstPersonArms = new FirstPersonArms(
      this.engine.scene, this.engine.camera, this.assetFactory, q
    );

    this.weaponSystem = new WeaponSystem(
      this.engine.scene, this.engine.camera, this.physics,
      this.input, this.assetFactory, this.audio, q
    );

    this.enemyManager = new EnemyManager(
      this.engine.scene, this.physics, this.level,
      this.assetFactory, this.audio, q
    );

    this.network = new Network();
    this.netGame = new NetGame(this.engine.scene, this.enemyManager.models, this.assetFactory);
    this.netGame.addRoot(this.engine.scene);
    this.lobby = new Lobby(this.uiOverlay);

    this.hud = new HUD(this.uiOverlay, q);
    this.killFeed = new KillFeed(this.uiOverlay, q);
    this.minimap = new Minimap(this.uiOverlay, this.level, q);
    this.menus = new Menus(this.uiOverlay);

    this.score = 0;
    this.kills = 0;
    this.wave = 0;
    this.waveDelay = 0;
    this.isWaveActive = false;
    this.gameState = 'menu';
    this.mode = 'solo';
    this._upVec = new THREE.Vector3(0, 1, 0);
    this._camPos = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._waveInfo = { number: 0, enemiesRemaining: 0, enemiesTotal: 0 };

    this.weaponSystem.enemyProvider = () => this.enemyManager.getEnemies();

    this.engine.registerViewmodel(this.weaponSystem.weaponRig);
    this.engine.registerViewmodel(this.firstPersonArms.armsGroup);

    this.spawnPoint = this._findFreeSpawn();

    this._buildPerfOverlay();
    this._setupNetplay();
    this._setupCallbacks();
    this._setupMenuHandlers();
    this._prewarm();

    const badge = document.getElementById('tier-badge');
    if (badge) badge.textContent = tierName.toUpperCase();

    this.engine.renderer.setAnimationLoop(() => this._update());
  }

  _findFreeSpawn() {
    const V = this.playerController.position;
    const test = V.clone();
    const bounds = this.level.bounds || 30;
    for (let ring = 0; ring <= 8; ring++) {
      const r = ring * 4;
      const steps = ring === 0 ? 1 : Math.max(8, ring * 6);
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (Math.abs(x) > bounds || Math.abs(z) > bounds) continue;
        test.set(x, 1.7, z);
        if (!this.physics.checkCollision(test, 0.55)) {
          return { x, z };
        }
      }
    }
    return { x: 0, z: 0 };
  }

  _prewarm() {
    try {
      for (const t of ['concrete', 'metal', 'wood', 'camo', 'ground']) {
        this.assetFactory.createMaterial(t, { repeat: [1, 1], seed: 42 });
      }
    } catch (e) {}

    try {
      const m = this.enemyManager.models;
      if (m && typeof m.getModel === 'function') m.getModel('assault');
    } catch (e) {}

    try {
      const wm = this.weaponSystem.models;
      if (wm && typeof wm.getWeaponModel === 'function') {
        for (const t of ['rifle', 'smg', 'sniper', 'pistol']) wm.getWeaponModel(t);
      }
    } catch (e) {}
  }


  _applyQualityToModules() {
    const q = this.perf.settings;
    for (const m of [this.skybox, this.lighting, this.props, this.particleSystem,
      this.explosions, this.weaponSystem, this.enemyManager,
      this.minimap, this.firstPersonArms]) {
      if (m && typeof m.setQuality === 'function') {
        try { m.setQuality(q); } catch (e) {}
      }
    }
  }

  _buildPerfOverlay() {
    const el = document.createElement('div');
    el.id = 'perf-overlay';
    el.style.cssText = 'position:absolute;top:6px;left:50%;transform:translateX(-50%);font:11px ui-monospace,Menlo,monospace;color:#8f8;background:rgba(0,0,0,0.55);padding:3px 9px;border-radius:3px;pointer-events:none;z-index:60;letter-spacing:0.5px';
    this.uiOverlay.appendChild(el);
    this.perfOverlay = el;
    this._perfTimer = 0;
  }

  _updatePerfOverlay(dt) {
    this._perfTimer += dt;
    if (this._perfTimer < 0.4) return;
    this._perfTimer = 0;
    const s = this.perf.getStats();
    this.perfOverlay.textContent =
      `${s.fps.toFixed(0)} fps · ${s.tier} · ${s.width}x${s.height} · ${s.scale.toFixed(2)}x · ${this.engine.getDrawCalls()} calls`;
  }

  _playerDamage(base) {
    const t = this.engine.elapsedTime;
    const hits = this._recentHitTimes;
    while (hits.length && t - hits[0] > 0.5) hits.shift();
    hits.push(t);
    const shooters = hits.length;
    const waveScale = 0.38 + (this.wave - 1) * 0.12;
    const pressure = Math.min(1, 1.9 / (1 + (shooters - 1) * 0.8));
    return base * waveScale * pressure;
  }

  _setupCallbacks() {
    this._scratchDir = new THREE.Vector3();
    this._recentHitTimes = [];

    this.playerHealth.onDeath = () => {
      this.gameState = 'dead';
      this.menus.showGameOver(this.score, this.wave);
      this.input.exitPointerLock();
    };

    this.playerHealth.onDamage = (amount, direction) => {
      this.screenEffects.damageFlash(direction);
      this.screenEffects.shake(0.5, 0.4);
      this.hud.showDamageDirection(direction ? Math.atan2(direction.x, direction.z) : 0);
      this.hud.flashDamage(0.8);
      if (this.audio.initialized) {
        const noise = this.audio.generateNoise(0.1, 0.3);
        if (noise) this.audio.playSound(noise, { volume: 0.4, pitch: 0.6 + Math.random() * 0.2 });
      }
    };

    this.enemyManager.onEnemyShoot = (enemy, targetPos, hit) => {
      if (hit && this.playerHealth.isAlive()) {
        const damage = this._playerDamage(6 + Math.random() * 5);
        this._scratchDir.subVectors(this.playerController.getPosition(), enemy.getPosition());
        if (this._scratchDir.lengthSq() > 1e-6) this._scratchDir.normalize();
        this.playerHealth.takeDamage(damage, this._scratchDir);
        this.playerController.takeDamage(damage, this._scratchDir);
      }
      if (this.audio.initialized) {
        const noise = this.audio.generateNoise(0.08, 0.3);
        if (noise) this.audio.playSound(noise, { volume: 0.25, pitch: 0.7 + Math.random() * 0.3 });
      }
    };

    this.weaponSystem.onEnemyHit = (enemy, damage, wasAlive, isHeadshot) => {
      this._scratchDir.subVectors(enemy.getPosition(), this.playerController.getPosition());
      if (this._scratchDir.lengthSq() > 1e-6) this._scratchDir.normalize();
      this.enemyManager.damageEnemy(enemy, damage, this._scratchDir);
      const isKill = wasAlive && !enemy.isAlive();
      this.hud.showHitMarker(isKill);
      if (this.audio.initialized) {
        const noise = this.audio.generateNoise(0.05, 0.2);
        if (noise) this.audio.playSound(noise, { volume: 0.35, pitch: 1.2 + Math.random() * 0.3 });
      }
    };

    this.enemyManager.onEnemyHit = (enemy, amount) => {
      if (this.audio.initialized) {
        const noise = this.audio.generateNoise(0.08, 0.25);
        if (noise) this.audio.playSound(noise, { volume: 0.3, pitch: 0.8 + Math.random() * 0.4 });
      }
    };

    this.enemyManager.onEnemyDeath = (enemy) => {
      if (this.audio.initialized) {
        const noise = this.audio.generateNoise(0.2, 0.4);
        if (noise) this.audio.playSound(noise, { volume: 0.4, pitch: 0.5 + Math.random() * 0.3 });
      }
    };

    this.enemyManager.onEnemyKilled = (enemy) => {
      this.kills++;
      this.score += 100;
      this.hud.showHitMarker(true);
      this.killFeed.addKill('You', 'Enemy', this.weaponSystem.getCurrentWeapon().type, false);
      this.particleSystem.emit('blood', enemy.getPosition(), 20, {
        velocity: 3, spread: 1, lifetime: 0.8, size: 0.05,
      });
      if (this.audio.initialized) {
        const noise = this.audio.generateNoise(0.15, 0.4);
        if (noise) this.audio.playSound(noise, { volume: 0.5, pitch: 0.5 + Math.random() * 0.2 });
      }
    };

    this.enemyManager.onWaveComplete = () => {
      this.isWaveActive = false;
      this.waveDelay = 8;
      this.menus.showWaveTransition(this.wave + 1);
      this._refillAmmo();
    };
  }

  _setupMenuHandlers() {
    this.menus.onDeploy = () => this._deploy();
    this.menus.onResume = () => this._resumeGame();
    this.menus.onRestart = () => this._restartGame();

    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' && this.gameState === 'playing') {
        this._cycleQuality();
      }
    });
  }

  _cycleQuality() {
    const order = ['potato', 'low', 'medium', 'high', 'ultra'];
    const i = order.indexOf(this.perf.tier);
    const next = order[(i + 1) % order.length];
    this.perf.enabled = false;
    this.perf.setTier(next);
    this._applyQualityToModules();
    const badge = document.getElementById('tier-badge');
    if (badge) badge.textContent = next.toUpperCase();
  }

  _startGame(mode) {
    if (mode) this.mode = mode;
    if (this.mode === 'mp') {
      this.playerHealth.health = 100;
      this.playerHealth.alive = true;
      this.gameState = 'playing';
      this.input.requestPointerLock();
      return;
    }
    this.gameState = 'playing';
    this.score = 0;
    this.kills = 0;
    this.wave = 0;
    this.isWaveActive = false;
    this.waveDelay = 5;
    this.playerHealth.reset();
    this.playerHealth.health = 100;
    this.playerController.position.set(this.spawnPoint.x, 1.7, this.spawnPoint.z);
    this.playerController.velocity.set(0, 0, 0);
    this.input.requestPointerLock();
  }

  _refillAmmo() {
    for (const type of this.weaponSystem.inventory) {
      const s = this.weaponSystem.state[type];
      if (s) {
        s.reserve = s.maxReserve || s.reserve;
      }
    }
  }

  _resumeGame() {
    this.gameState = 'playing';
    this.input.requestPointerLock();
  }

  _restartGame() {
    if (this.mode === 'mp') {
      this.network.respawn();
      return;
    }
    this.enemyManager.clearAll();
    this.weaponSystem.state.ammo = {};
    this._startGame();
  }

  _setupNetplay() {
    const conn = describeConnectivity();
    this.lobby.setNetwork(conn.state, conn.detail);
    this._refreshServerStatus();

    window.addEventListener('online', () => {
      const c = describeConnectivity();
      this.lobby.setNetwork(c.state, c.detail);
      this._refreshServerStatus();
    });
    window.addEventListener('offline', () => {
      this.lobby.setNetwork('offline', 'offline — multiplayer unavailable, solo works');
    });

    this.network
      .on('welcome', () => {
        this.lobby.setBusy(false);
        this._enterNetplay();
      })
      .on('snapshot', () => {})
      .on('event', (e) => this._onNetEvent(e))
      .on('killfeed', (k) => {
        this.killFeed.addKill(k.killer, k.victim, 'rifle', k.headshot);
        this.hud.showHitMarker(true);
      })
      .on('status', () => {
        this.lobby.setBusy(this.network.connecting);
        if (!this.network.connected && this.lobby.visible) {
          this.lobby.setError(this.network.lastError || '');
        }
      })
      .on('disconnect', () => {
        this._leaveNetplay();
        this.gameState = 'menu';
        this.lobby.show();
      });

    this.lobby.onSolo = () => {
      this.audio.init();
      this.audio.resume();
      this.lobby.hide();
      this.menus.hideAll();
      this._startGame('solo');
    };

    this._wireQualityButtons();

    this.lobby.onJoin = (name) => {
      this.lobby.setBusy(true);
      this.lobby.setError('');
      this.pendingName = name;
      this.network.connect(defaultServerUrl(), name);
    };

    this.lobby.show();
    this.gameState = 'menu';
  }

  _wireQualityButtons() {
    const row = document.getElementById('quality-row');
    if (!row) return;
    const buttons = Array.from(row.querySelectorAll('button'));
    const mark = (name) => buttons.forEach((b) => b.classList.toggle('active', b.dataset.tier === name));
    mark(this.perf.tier);
    for (const b of buttons) {
      b.addEventListener('click', () => {
        this.perf.enabled = false;
        this.perf.setTier(b.dataset.tier);
        this._applyQualityToModules();
        mark(b.dataset.tier);
        const badge = document.getElementById('tier-badge');
        if (badge) badge.textContent = b.dataset.tier.toUpperCase();
      });
    }
  }

  async _refreshServerStatus() {
    const info = await probeServer(defaultServerUrl());
    if (info) {
      this.lobby.setNetwork('online',
        `server online — ${info.players} player${info.players === 1 ? '' : 's'}, wave ${info.wave}`);
      this.lobby.btnJoin.disabled = false;
    } else {
      const conn = describeConnectivity();
      this.lobby.setNetwork(conn.state, conn.detail);
      this.lobby.btnJoin.disabled = false;
    }
  }

  _enterNetplay() {
    this.mode = 'mp';
    this.netGame.clear();
    this.enemyManager.clearAll();
    // The server owns hit registration, so local enemy probing must be off or every
    // client would disagree with the authoritative result.
    this.weaponSystem.enemyProvider = null;
    this.weaponSystem.ballistics.setEnemyProvider(null);
    this.lobby.hide();
    this._startGame('mp');
  }

  _leaveNetplay() {
    this.mode = 'solo';
    this.netGame.clear();
    this.weaponSystem.enemyProvider = () => this.enemyManager.getEnemies();
    this.weaponSystem.ballistics.setEnemyProvider(() => this.enemyManager.getEnemies());
    this.wave = 0;
    this.kills = 0;
    this.score = 0;
  }

  _onNetEvent(e) {
    if (!e) return;
    switch (e.type) {
      case 'damage':
        this.playerHealth.health = Math.max(1, e.hp);
        this.screenEffects.damageFlash({ x: e.fromX - this.playerController.getPosition().x, z: e.fromZ - this.playerController.getPosition().z });
        this.screenEffects.shake(0.45, 0.35);
        break;
      case 'playerDown':
        this.playerHealth.health = 0;
        this.playerHealth.alive = false;
        this.gameState = 'dead';
        this.input.exitPointerLock();
        this.menus.showGameOver(this.kills, this.network.wave);
        break;
      case 'respawned':
        this.playerHealth.health = 100;
        this.playerHealth.alive = true;
        this.gameState = 'playing';
        break;
      case 'wave':
        this.wave = e.wave;
        this._waveTotal = e.total;
        break;
      case 'waveClear':
        this.menus.showWaveTransition(e.wave + 1);
        break;
    }
  }

  _updateNetplay(dt) {
    const net = this.network;
    const p = this.playerController;
    const firing = this.weaponSystem.state && this.weaponSystem.state.firing;

    net.tick(dt, {
      x: p.position.x, y: p.position.y, z: p.position.z,
      yaw: p.yaw, pitch: p.pitch, hp: this.playerHealth.getHealth(),
    }, firing);

    const list = net.sample(dt);
    this.netGame.update(dt, list);
    this.netGame.syncPlayers(net.players, net.selfId);

    if (firing) {
      this.engine.camera.getWorldPosition(this._camPos);
      this.engine.camera.getWorldDirection(this._camDir);
      const w = this.weaponSystem.getCurrentWeapon();
      const dmg = w.stats ? w.stats.damage : 25;
      net.shoot(this._camPos, this._camDir, dmg);
    }

    this.wave = net.wave;
    this.kills = 0;
    for (const pl of net.players.values()) if (pl.id === net.selfId) this.kills = pl.kills;
    this._waveInfo.number = net.wave;
    this._waveInfo.enemiesRemaining = net.remaining;
    this._waveInfo.enemiesTotal = this._waveTotal || net.remaining;
    this.hud.setNetInfo({ ping: net.ping, mode: 'mp', server: true });
  }

  _update() {
    const dt = this.engine.update();

    if (this.gameState === 'playing') {
      if (this.mode === 'mp') this._updateNetplay(dt);
      else this._updateGame(dt);
    } else if (this.mode === 'mp' && this.network.connected) {
      // keep remote players moving while paused or dead
      this._updateNetplay(dt * 0.5);
    }

    this.skybox.update(dt);
    this.lighting.update(dt, this.playerController.getPosition());
    this.particleSystem.update(dt);
    this.explosions.update(dt);
    this.screenEffects.update(dt, this.playerHealth.getHealth(), this.playerHealth.getMaxHealth());

    if (this.weaponSystem.currentModel) this.engine.registerViewmodel(this.weaponSystem.currentModel);
    this.engine.setDamageIntensity(this.screenEffects.getDamageIntensity());
    this.input.resetFrame();
    this.engine.render();
    this._updatePerfOverlay(dt);
  }

  _updateGame(dt) {
    this.playerController.update(dt);
    this.playerHealth.update(dt);

    const playerPos = this.playerController.getPosition();
    const playerDir = this.playerController.getDirection();

    this.audio.updateListener(playerPos, playerDir, this._upVec);

    this.weaponSystem.update(dt);
    this.firstPersonArms.update(dt, this.weaponSystem.weaponRig, {
      isMoving: this.playerController.isMovingState,
      isSprinting: this.playerController.isSprintingState,
      isAds: this.weaponSystem.state.isAds,
      isReloading: this.weaponSystem.state.isReloading,
      isSwitching: this.weaponSystem.state.switching,
      isFiring: this.weaponSystem.state.firing,
      moveSpeed: this.playerController.velocity.length(),
    });

    this.enemyManager.update(dt, playerPos, this.playerHealth.isAlive());

    if (!this.isWaveActive && this.waveDelay > 0) {
      this.waveDelay -= dt;
      if (this.waveDelay <= 0) {
        this._startNextWave();
      }
    }

    if (this.isWaveActive && this.enemyManager.getAliveCount() === 0 && this.enemyManager.spawnQueue === 0) {
      this.isWaveActive = false;
      this.waveDelay = 8;
      this.menus.showWaveTransition(this.wave + 1);
      this._refillAmmo();
    }

    const camOffset = this.screenEffects.getCameraOffset();
    this.engine.camera.position.add(camOffset);

    this._waveInfo.number = this.wave;
    this._waveInfo.enemiesRemaining = this.enemyManager.getAliveCount() + this.enemyManager.spawnQueue;
    this._waveInfo.enemiesTotal = this._waveTotal || this._waveInfo.enemiesRemaining;
    this.hud.update(dt, this.playerHealth, this.weaponSystem, this._waveInfo, this.score);
    this.minimap.update(dt, playerPos, playerDir, this.enemyManager.getEnemies());
  }

  _startNextWave() {
    this.wave++;
    this.isWaveActive = true;
    const count = Math.min(3 + this.wave, this.perf.settings.maxEnemies);
    this._waveTotal = count;
    const difficulty = 1 + (this.wave - 1) * 0.15;
    this.enemyManager.spawnWave(count, difficulty);
    if (this.audio.initialized) {
      const noise = this.audio.generateNoise(0.3, 0.5);
      if (noise) this.audio.playSound(noise, { volume: 0.4, pitch: 0.4 });
    }
  }
}

const game = new Game();
if (typeof window !== 'undefined') window.__game = game;
export default game;
