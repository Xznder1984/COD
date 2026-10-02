import * as THREE from 'three';
import { EnemyModels } from './EnemyModels.js';
import { EnemyAI } from './EnemyAI.js';
import { Pathfinding } from './Pathfinding.js';

const HARD_MAX_ENEMIES = 20;
const MAX_WAVE_QUEUE = 40;
const SPAWN_INTERVAL = 0.4;
const WAVE_SCALING = {
  health: 0.12,
  accuracy: 0.06,
  aggression: 0.08,
  speed: 0.08,
};
const LOD_NEAR = 12;
const LOD_MID = 30;
const FRUSTUM_CULL_DISTANCE = 20;
const SQUAD_SIZE = 4;
const SQUAD_REBUILD_INTERVAL = 0.6;
const ALIVE_RECHECK_INTERVAL = 1.0;

const DEFAULT_QUALITY = {
  maxEnemies: 8,
  enemyLodDistance: 30,
  propDetail: 1,
  shadowsEnabled: true,
  maxParticles: 400,
};

function normalizeQuality(quality) {
  const q = { ...DEFAULT_QUALITY, ...(quality || {}) };
  let max = q.maxEnemies | 0;
  if (!(max > 0)) max = DEFAULT_QUALITY.maxEnemies;
  q.maxEnemies = max > HARD_MAX_ENEMIES ? HARD_MAX_ENEMIES : max;
  let lod = q.enemyLodDistance | 0;
  if (!(lod > 0)) lod = DEFAULT_QUALITY.enemyLodDistance;
  q.enemyLodDistance = lod;
  q.propDetail = q.propDetail < 0 ? 0 : q.propDetail > 2 ? 2 : q.propDetail | 0;
  return q;
}

export class EnemyManager {
  constructor(scene, physics, level, assetFactory, audio, quality) {
    this.scene = scene;
    this.physics = physics;
    this.level = level;
    this.assetFactory = assetFactory;
    this.audio = audio;
    this.quality = normalizeQuality(quality);

    this.models = new EnemyModels(assetFactory, this.quality);
    this.pathfinding = new Pathfinding(level, this.quality);
    this.enemies = [];
    this.pool = [];
    this.wave = 0;
    this.spawnQueue = 0;
    this.spawnTimer = 0;
    this.difficulty = 1.0;
    this.updateIndex = 0;

    this.onEnemyKilled = null;
    this.onEnemyShoot = null;
    this.onWaveComplete = null;
    this.onGrenade = null;

    this._aliveCount = 0;
    this._squadDirty = true;
    this._squadTimer = 0;
    this._squads = [];
    this._recheckTimer = 0;
    this._camera = null;
    this._frustum = new THREE.Frustum();
    this._projScreenMatrix = new THREE.Matrix4();
    this._hasFrustum = false;
    this._hiddenCount = 0;
    this._simSteps = 0;
    this._culledCount = 0;
    this._deadCount = 0;
  }

  setQuality(quality) {
    if (!quality) return;
    const prevDetail = this.quality.propDetail;
    this.quality = normalizeQuality(quality);
    this.models.setQuality(this.quality);
    this.pathfinding.setQuality(this.quality);
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) list[i].setQuality(this.quality);
    if (this.quality.propDetail !== prevDetail) {
      this.pool.length = 0;
      this._rebuildModels();
    }
    this._squadDirty = true;
    this._enforceCap();
  }

  _rebuildModels() {
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const ai = list[i];
      const old = ai.getGroup();
      if (!old || !old.userData.variant) continue;
      const next = this.models.getModel(old.userData.variant);
      next.position.copy(old.position);
      next.rotation.copy(old.rotation);
      next.scale.copy(old.scale);
      next.visible = old.visible;
      this.scene.add(next);
      this.scene.remove(old);
      ai.attachModel(next, this.models.getLODInfo(next).parts);
    }
  }

  getMaxEnemies() {
    return this.quality.maxEnemies;
  }

  spawnWave(count, difficulty) {
    this.wave++;
    this.difficulty = difficulty;
    const requested = count > 0 ? count | 0 : 0;
    const pending = this.spawnQueue + requested;
    this.spawnQueue = pending > MAX_WAVE_QUEUE ? MAX_WAVE_QUEUE : pending;
    this.spawnTimer = 0;
  }

  update(dt, playerPosition, playerAlive) {
    this._processSpawnQueue(dt);
    this.pathfinding.beginFrame();
    this._updateFrustum();

    const px = playerPosition.x;
    const pz = playerPosition.z;
    const nearSq = LOD_NEAR * LOD_NEAR;
    const farLimit = this.quality.enemyLodDistance < LOD_MID ? this.quality.enemyLodDistance : LOD_MID;
    const farSq = farLimit * farLimit;
    const frustumSq = FRUSTUM_CULL_DISTANCE * FRUSTUM_CULL_DISTANCE;
    const hasFrustum = this._hasFrustum;
    let simSteps = 0;
    let culledCount = 0;
    let deadCount = 0;

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const ai = this.enemies[i];

      if (!ai.isAlive()) {
        deadCount++;
        ai.updateDeath(dt);
        if (ai.shouldRemove()) this._removeEnemy(i);
        continue;
      }

      const pos = ai.getPosition();
      const dx = pos.x - px;
      const dz = pos.z - pz;
      const distSq = dx * dx + dz * dz;

      ai.updateCull(distSq);
      if (ai.isCulled()) {
        culledCount++;
        continue;
      }

      const band = distSq < nearSq ? 0 : distSq < farSq ? 1 : 2;
      ai.setLODBand(band);

      let renderBand = band < 2 ? band : 1;
      if (distSq > frustumSq && hasFrustum) {
        if (!this._frustum.containsPoint(pos)) renderBand = 2;
      }
      if (renderBand !== ai.renderBand) {
        ai.renderBand = renderBand;
        this._applyRenderBand(ai, renderBand);
      }

      ai.update(dt, playerPosition, playerAlive);
      simSteps++;
    }

    this._simSteps = simSteps;
    this._culledCount = culledCount;
    this._deadCount = deadCount;
    this.updateIndex++;

    this._assignSquads(dt);
    this.pathfinding.processQueue();
    this._recheckAlive(dt);
  }

  _updateFrustum() {
    const camera = this.scene.userData.camera;
    if (!camera) {
      this._hasFrustum = false;
      return;
    }
    this._camera = camera;
    this._projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._projScreenMatrix);
    this._hasFrustum = true;
  }

  _applyRenderBand(ai, band) {
    const group = ai.getGroup();
    if (!group) return;

    if (band === 2) {
      if (group.visible) {
        group.visible = false;
        this._hiddenCount++;
      }
      return;
    }

    if (!group.visible) {
      group.visible = true;
      if (this._hiddenCount > 0) this._hiddenCount--;
    }

    if (band === 1) {
      const deco = this.models.getLODInfo(group).deco;
      for (let i = 0; i < deco.length; i++) deco[i].visible = false;
    } else if (ai.decoHidden) {
      const deco = this.models.getLODInfo(group).deco;
      for (let i = 0; i < deco.length; i++) deco[i].visible = true;
    }

    ai.decoHidden = band === 1;
  }

  _assignSquads(dt) {
    if (!this._squadDirty) return;
    this._squadTimer -= dt;
    if (this._squadTimer > 0) return;
    this._squadTimer = SQUAD_REBUILD_INTERVAL;
    this._squadDirty = false;

    const list = this.enemies;
    const squads = this._squads;
    let squadCount = Math.ceil(list.length / SQUAD_SIZE);
    if (squads.length < squadCount) {
      for (let i = squads.length; i < squadCount; i++) squads.push([]);
    }

    for (let s = 0; s < squads.length; s++) squads[s].length = 0;

    for (let i = 0; i < list.length; i++) {
      squads[Math.floor(i / SQUAD_SIZE)].push(list[i]);
    }

    for (let s = 0; s < squads.length; s++) {
      const squad = squads[s];
      const members = squad.length;
      for (let i = 0; i < members; i++) squad[i].setSquad(squad);
    }
  }

  _enforceCap() {
    const list = this.enemies;
    let alive = 0;
    for (let i = 0; i < list.length; i++) {
      if (list[i].isAlive()) alive++;
    }

    const cap = this.quality.maxEnemies;
    if (alive > cap) {
      let excess = alive - cap;
      for (let i = 0; i < list.length && excess > 0; i++) {
        const ai = list[i];
        if (!ai.isAlive()) continue;
        ai.cull();
        excess--;
        alive--;
      }
    }

    this._aliveCount = alive;
  }

  _recheckAlive(dt) {
    this._recheckTimer -= dt;
    if (this._recheckTimer > 0) return;
    this._recheckTimer = ALIVE_RECHECK_INTERVAL;
    let alive = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      if (this.enemies[i].isAlive()) alive++;
    }
    this._aliveCount = alive;
  }

  _processSpawnQueue(dt) {
    if (this.spawnQueue <= 0) return;

    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;

    if (this._aliveCount >= this.quality.maxEnemies) {
      this.spawnTimer = SPAWN_INTERVAL;
      return;
    }

    this.spawnTimer = SPAWN_INTERVAL;
    this.spawnQueue--;

    const spawnPoints = this.level.spawnPoints || [];
    if (spawnPoints.length === 0) return;

    const sp = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
    const variant = this._pickVariant();
    const model = this._getFromPool(variant) || this.models.getModel(variant);

    model.position.set(sp.x, 0, sp.z);
    model.visible = true;
    this.scene.add(model);

    const parts = this.models.getLODInfo(model).parts;
    const ai = new EnemyAI(model, this.level, this.pathfinding, this.quality, parts);
    ai.position.set(sp.x, 0, sp.z);
    ai.accuracy = Math.min(ai.accuracy + (this.difficulty - 1) * WAVE_SCALING.accuracy, 0.95);
    ai.aggression = Math.min(ai.aggression + (this.difficulty - 1) * WAVE_SCALING.aggression, 1.0);
    ai.moveSpeed = ai.moveSpeed * (1 + (this.difficulty - 1) * WAVE_SCALING.speed);
    ai.health = ai.health * (1 + (this.difficulty - 1) * WAVE_SCALING.health);
    ai.maxHealth = ai.health;

    ai.onShoot = (enemy, targetPos, hit) => {
      if (this.onEnemyShoot) this.onEnemyShoot(enemy, targetPos, hit);
    };

    ai.onGrenade = (enemy, targetPos) => {
      if (this.onGrenade) this.onGrenade(enemy, targetPos);
    };

    this.enemies.push(ai);
    this._aliveCount++;
    this._squadDirty = true;
  }

  _getFromPool(variant) {
    const pool = this.pool;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].userData.variant === variant) return pool.splice(i, 1)[0];
    }
    return null;
  }

  _returnToPool(model) {
    const limit = this.quality.maxEnemies > 4 ? this.quality.maxEnemies : 6;
    if (this.pool.length >= limit) return;
    model.visible = false;
    this.pool.push(model);
  }

  _pickVariant() {
    const roll = Math.random();
    if (this.difficulty > 2 && roll < 0.2) return 'heavy';
    if (roll < 0.3) return 'scout';
    return 'assault';
  }

  _removeEnemy(index) {
    const ai = this.enemies[index];
    if (ai.isAlive() && this._aliveCount > 0) this._aliveCount--;
    const group = ai.getGroup();
    this.pathfinding.forget(ai.squadId, ai);
    this.pathfinding.cancelRequests(ai);
    if (group) {
      this.scene.remove(group);
      this._returnToPool(group);
    }
    this.enemies.splice(index, 1);
    this._squadDirty = true;
  }

  damageEnemy(enemy, damage, direction) {
    const wasAlive = enemy.isAlive();
    enemy.takeDamage(damage, direction);

    if (wasAlive && !enemy.isAlive()) {
      if (this._aliveCount > 0) this._aliveCount--;
      this._squadDirty = true;
      if (this.onEnemyKilled) this.onEnemyKilled(enemy);
    }
  }

  getEnemies() {
    return this.enemies;
  }

  getAliveCount() {
    return this._aliveCount;
  }

  getWave() {
    return this.wave;
  }

  isWaveComplete() {
    return this.spawnQueue === 0 && this._aliveCount === 0;
  }

  getStats() {
    const modelStats = this.models.getStats();
    return {
      alive: this._aliveCount,
      max: this.quality.maxEnemies,
      spawning: this.spawnQueue,
      detail: this.quality.propDetail,
      hidden: this._hiddenCount,
      culled: this._culledCount,
      dead: this._deadCount,
      simulating: this._simSteps,
      lodDistance: this.quality.enemyLodDistance,
      drawCallsPerEnemy: modelStats.meshesPerEnemy,
      estimatedEnemyDrawCalls: modelStats.meshesPerEnemy * (this._simSteps + this._deadCount),
      models: modelStats,
      pathfinding: this.pathfinding.getStats(),
    };
  }

  clearAll() {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      this._removeEnemy(i);
    }
    this.spawnQueue = 0;
    this.wave = 0;
    this._aliveCount = 0;
    this._hiddenCount = 0;
    this._culledCount = 0;
    this._deadCount = 0;
    this._simSteps = 0;
    this._squadDirty = true;
    this.pathfinding.clearAll();
  }
}
