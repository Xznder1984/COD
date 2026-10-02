import * as THREE from 'three';

const _ray = new THREE.Ray();
const _box = new THREE.Box3();
const _sphere = new THREE.Sphere();
const _v = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();
const _hitNormal = new THREE.Vector3();

export class Physics {
  constructor(options = {}) {
    this.colliders = [];
    this._meshes = [];
    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;
    this.gravity = -20;

    this.cellSize = options.cellSize || 8;
    this._grid = new Map();
    this._gridDirty = true;

    this.boxOnly = options.boxOnly || false;
    this._queryIds = new Set();
    this._candidates = [];
    this._scratchRay = new THREE.Ray();
  }

  _key(cx, cz) {
    return cx * 73856093 ^ cz * 19349663;
  }

  addCollider(mesh) {
    mesh.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(mesh);
    const entry = { mesh, box, cellKeys: null, id: this.colliders.length };
    this.colliders.push(entry);
    this._meshes.push(mesh);
    this._insert(entry);
    return entry;
  }

  _insert(entry) {
    const cs = this.cellSize;
    const inv = 1 / cs;
    const minX = Math.floor(entry.box.min.x * inv);
    const maxX = Math.floor(entry.box.max.x * inv);
    const minZ = Math.floor(entry.box.min.z * inv);
    const maxZ = Math.floor(entry.box.max.z * inv);
    const keys = [];
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const k = this._key(cx, cz);
        keys.push(k);
        let cell = this._grid.get(k);
        if (!cell) {
          cell = [];
          this._grid.set(k, cell);
        }
        cell.push(entry);
      }
    }
    entry.cellKeys = keys;
  }

  removeCollider(mesh) {
    const idx = this.colliders.findIndex((c) => c.mesh === mesh);
    if (idx === -1) return;
    const entry = this.colliders[idx];
    for (const k of entry.cellKeys) {
      const cell = this._grid.get(k);
      if (!cell) continue;
      const i = cell.indexOf(entry);
      if (i !== -1) cell.splice(i, 1);
    }
    this.colliders.splice(idx, 1);
    this._meshes = this.colliders.map((c) => c.mesh);
    for (let i = 0; i < this.colliders.length; i++) this.colliders[i].id = i;
  }

  clearColliders() {
    this.colliders.length = 0;
    this._meshes.length = 0;
    this._grid.clear();
  }

  _collectCells(origin, dir, far) {
    const out = this._candidates;
    out.length = 0;
    const seen = this._queryIds;
    seen.clear();

    const cs = this.cellSize;
    const inv = 1 / cs;
    let cx = Math.floor(origin.x * inv);
    let cz = Math.floor(origin.z * inv);

    const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
    const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

    const absX = dir.x < 0 ? -dir.x : dir.x;
    const absZ = dir.z < 0 ? -dir.z : dir.z;

    const deltaX = stepX !== 0 ? cs / absX : Infinity;
    const deltaZ = stepZ !== 0 ? cs / absZ : Infinity;

    // Distance along the ray to the first cell boundary. Must divide by the
    // MAGNITUDE of the direction component, otherwise a negative dir.x yields a
    // negative tMax and the traversal over-advances on that axis (missing cells).
    let tMaxX = stepX !== 0
      ? (stepX > 0 ? (cx + 1) * cs - origin.x : origin.x - cx * cs) / absX
      : Infinity;
    let tMaxZ = stepZ !== 0
      ? (stepZ > 0 ? (cz + 1) * cs - origin.z : origin.z - cz * cs) / absZ
      : Infinity;

    const maxSteps = 512;
    for (let i = 0; i < maxSteps; i++) {
      const cell = this._grid.get(this._key(cx, cz));
      if (cell) {
        for (let j = 0; j < cell.length; j++) {
          const e = cell[j];
          if (!seen.has(e.id)) {
            seen.add(e.id);
            out.push(e);
          }
        }
      }
      if (tMaxX > far && tMaxZ > far) break;
      if (tMaxX < tMaxZ) {
        cx += stepX;
        tMaxX += deltaX;
      } else {
        cz += stepZ;
        tMaxZ += deltaZ;
      }
      if (stepX === 0 && stepZ === 0) break;
      if (tMaxX > far && tMaxZ > far) break;
    }
    return out;
  }

  raycast(origin, direction, far = 200) {
    const cands = this._collectCells(origin, direction, far);
    if (cands.length === 0) return null;

    _ray.origin.copy(origin);
    _ray.direction.copy(direction);

    let bestT = Infinity;
    let best = null;
    let bestNormalX = 0, bestNormalY = 1, bestNormalZ = 0;

    for (let i = 0; i < cands.length; i++) {
      const e = cands[i];
      const box = e.box;
      if (!_ray.intersectsBox(box)) continue;

      const t = this._rayBoxEntry(_ray, box);
      if (t === null || t < 0 || t > far || t >= bestT) continue;

      if (this.boxOnly) {
        bestT = t;
        best = e;
        _box.getCenter(_hitPoint);
        bestNormalX = 0; bestNormalY = 1; bestNormalZ = 0;
        continue;
      }

      this.raycaster.set(origin, direction);
      this.raycaster.near = 0;
      this.raycaster.far = t + 0.01;
      const hits = this.raycaster.intersectObject(e.mesh, true);
      if (hits.length === 0) continue;
      const h = hits[0];
      if (h.distance < bestT) {
        bestT = h.distance;
        best = e;
        if (h.face) {
          bestNormalX = h.face.normal.x;
          bestNormalY = h.face.normal.y;
          bestNormalZ = h.face.normal.z;
        }
      }
    }

    if (!best) return null;

    const point = new THREE.Vector3().copy(direction).multiplyScalar(bestT).add(origin);
    const normal = new THREE.Vector3(bestNormalX, bestNormalY, bestNormalZ);
    return {
      distance: bestT,
      point,
      normal,
      object: best.mesh,
      collider: best,
    };
  }

  _rayBoxEntry(ray, box) {
    let tmin = 0;
    let tmax = Infinity;
    const o = ray.origin;
    const d = ray.direction;

    let inv = 1 / d.x;
    let t1 = (box.min.x - o.x) * inv;
    let t2 = (box.max.x - o.x) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmax < tmin) return null;

    inv = 1 / d.y;
    t1 = (box.min.y - o.y) * inv;
    t2 = (box.max.y - o.y) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmax < tmin) return null;

    inv = 1 / d.z;
    t1 = (box.min.z - o.z) * inv;
    t2 = (box.max.z - o.z) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmax < tmin) return null;

    return tmin;
  }

  raycastAll(origin, direction, far = 200) {
    const single = this.raycast(origin, direction, far);
    return single ? [single] : [];
  }

  _nearby(position, radius) {
    const out = this._candidates;
    out.length = 0;
    const seen = this._queryIds;
    seen.clear();
    const cs = this.cellSize;
    const inv = 1 / cs;
    const minX = Math.floor((position.x - radius) * inv);
    const maxX = Math.floor((position.x + radius) * inv);
    const minZ = Math.floor((position.z - radius) * inv);
    const maxZ = Math.floor((position.z + radius) * inv);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const cell = this._grid.get(this._key(cx, cz));
        if (!cell) continue;
        for (let j = 0; j < cell.length; j++) {
          const e = cell[j];
          if (!seen.has(e.id)) {
            seen.add(e.id);
            out.push(e);
          }
        }
      }
    }
    return out;
  }

  checkCollision(position, radius = 0.4) {
    const near = this._nearby(position, radius);
    _sphere.center.copy(position);
    _sphere.radius = radius;
    for (let i = 0; i < near.length; i++) {
      if (_sphere.intersectsBox(near[i].box)) return near[i];
    }
    return null;
  }

  resolveCollision(position, radius = 0.4) {
    const near = this._nearby(position, radius + 0.5);
    _sphere.center.copy(position);
    _sphere.radius = radius;
    let hit = false;
    for (let i = 0; i < near.length; i++) {
      const box = near[i].box;
      if (!_sphere.intersectsBox(box)) continue;
      _box.copy(box).clampPoint(position, _v);
      const dx = position.x - _v.x;
      const dy = position.y - _v.y;
      const dz = position.z - _v.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < radius * radius) {
        hit = true;
        const dist = Math.sqrt(distSq);
        if (dist > 1e-5) {
          const push = (radius - dist) / dist;
          position.x += dx * push;
          position.y += dy * push;
          position.z += dz * push;
        } else {
          position.y = box.max.y + radius;
        }
        _sphere.center.copy(position);
      }
    }
    return position;
  }

  groundCheck(position, height = 1.7) {
    const ox = position.x;
    const oy = position.y + 0.5;
    const oz = position.z;
    const dir = _v.set(0, -1, 0);
    const hit = this.raycast({ x: ox, y: oy, z: oz }, dir, height + 0.5);
    return hit ? hit.point.y : 0;
  }

  setBoxOnly(v) {
    this.boxOnly = v;
  }
}
