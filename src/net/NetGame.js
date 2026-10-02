/**
 * Visual representation of the server's world.
 *
 * The server decides what exists and where it is; this class keeps a matching set of
 * meshes and slides them toward the latest authoritative positions. Nothing here
 * affects gameplay — every transform is overwritten by server state each frame.
 */

import * as THREE from 'three';

const _v = new THREE.Vector3();

export class NetGame {
  constructor(scene, enemyModels, assetFactory) {
    this.scene = scene;
    this.enemyModels = enemyModels;
    this.assetFactory = assetFactory;
    this.enemies = new Map();
    this.remotePlayers = new Map();
    this.time = 0;
  }

  addRoot(scene) {
    this.root = new THREE.Group();
    this.root.name = 'netplay';
    scene.add(this.root);
    return this.root;
  }

  _spawnEnemy(entry) {
    const model = this.enemyModels.getModel(entry.v);
    model.position.set(entry.x, 0, entry.z);
    model.rotation.y = entry.yaw;
    if (this.root) this.root.add(model);
    const rec = {
      id: entry.id,
      variant: entry.v,
      group: model,
      x: entry.x,
      z: entry.z,
      yaw: entry.yaw,
      targetX: entry.x,
      targetZ: entry.z,
      targetYaw: entry.yaw,
      hp: entry.hp,
      maxHp: entry.maxHp || entry.hp,
      flash: 0,
      dying: 0,
      baseMaterials: null,
    };
    this.enemies.set(entry.id, rec);
    return rec;
  }

  _despawnEnemy(rec) {
    if (rec.group.parent) rec.group.parent.remove(rec.group);
    rec.group.traverse((o) => {
      if (o.isMesh && o.geometry && o.geometry.dispose && o.userData.ownGeometry) o.geometry.dispose();
    });
    this.enemies.delete(rec.id);
  }

  /** Reconcile against a snapshot list, then ease everyone toward it. */
  update(dt, list) {
    this.time += dt;
    const seen = new Set();

    for (const e of list) {
      seen.add(e.id);
      let rec = this.enemies.get(e.id);
      if (!rec) rec = this._spawnEnemy(e);
      rec.targetX = e.x;
      rec.targetZ = e.z;
      let d = e.yaw - rec.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      rec.targetYaw = rec.yaw + d;
      rec.hp = e.hp;
      rec.maxHp = e.maxHp;
      if (e.flash) rec.flash = 0.12;
    }

    for (const id of [...this.enemies.keys()]) {
      if (!seen.has(id)) this._despawnEnemy(this.enemies.get(id));
    }

    const k = Math.min(1, dt * 14);
    for (const rec of this.enemies.values()) {
      if (rec.flash > 0) rec.flash -= dt;
      rec.x += (rec.targetX - rec.x) * k;
      rec.z += (rec.targetZ - rec.z) * k;
      let d = rec.targetYaw - rec.yaw;
      rec.yaw += d * Math.min(1, dt * 10);
      rec.group.position.set(rec.x, 0, rec.z);
      rec.group.rotation.y = rec.yaw;
      // Subtle hit reaction so damage reads even though the model is shared.
      const bob = rec.flash > 0 ? Math.sin(rec.flash * 60) * 0.04 : 0;
      rec.group.position.y = bob;
    }

    for (const rec of this.remotePlayers.values()) {
      rec.group.position.set(rec.x, rec.y || 0, rec.z);
      rec.group.rotation.y = rec.yaw;
    }
  }

  /** Spawn/refresh models for other connected players. */
  syncPlayers(players, selfId) {
    const seen = new Set();
    for (const p of players.values()) {
      if (p.id === selfId) continue;
      seen.add(p.id);
      let rec = this.remotePlayers.get(p.id);
      if (!rec) {
        const group = this.enemyModels.getModel('assault');
        if (this.root) this.root.add(group);
        rec = { id: p.id, name: p.name, group, x: p.x, y: 0, z: p.z, yaw: 0, targetX: p.x, targetYaw: 0 };
        this.remotePlayers.set(p.id, rec);
      }
      rec.name = p.name;
      rec.x = p.x;
      rec.y = p.y || 0;
      rec.z = p.z;
      rec.targetYaw = p.yaw;
      rec.yaw = p.yaw;
      rec.hp = p.hp;
      rec.alive = p.alive;
      rec.kills = p.kills;
      rec.deaths = p.deaths;
    }
    for (const id of [...this.remotePlayers.keys()]) {
      if (!seen.has(id)) {
        const rec = this.remotePlayers.get(id);
        if (rec.group.parent) rec.group.parent.remove(rec.group);
        this.remotePlayers.delete(id);
      }
    }
  }

  clear() {
    for (const id of [...this.enemies.keys()]) this._despawnEnemy(this.enemies.get(id));
    for (const rec of this.remotePlayers.values()) {
      if (rec.group.parent) rec.group.parent.remove(rec.group);
    }
    this.remotePlayers.clear();
  }

  get aliveCount() {
    let n = 0;
    for (const rec of this.enemies.values()) n++;
    return n;
  }

  /** Nearest enemy to a point, for the crosshair's enemy-detection highlight. */
  nearestEnemy(x, z) {
    let best = null;
    let bd = Infinity;
    for (const rec of this.enemies.values()) {
      const d = (rec.x - x) ** 2 + (rec.z - z) ** 2;
      if (d < bd) { bd = d; best = rec; }
    }
    return best;
  }

  /** Muzzle position for an enemy, used for tracer effects. */
  muzzleOf(rec) {
    return _v.set(rec.x, 1.25, rec.z);
  }
}