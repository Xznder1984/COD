import * as THREE from 'three';

const DEFAULT_QUALITY = {
  name: 'medium',
  propDetail: 1,
  textureSize: 256,
  shadowsEnabled: true,
  decalLimit: 12,
  casingLimit: 10,
  tracerSegments: 3,
  maxParticles: 900,
  maxEnemies: 8,
  physicsSteps: 1,
  maxLights: 3,
};

const CCD_STEP = 0.5;
const SKIP_FIRST_RAY_STEP = 1.5;
const HIT_POOL_SIZE = 16;
const _up = new THREE.Vector3(0, 1, 0);

export class Ballistics {
  constructor(physics, quality) {
    this.physics = physics;
    this.quality = Object.assign({}, DEFAULT_QUALITY, quality || {});
    this.physicsSteps = Math.max(1, this.quality.physicsSteps | 0 || 1);
    this.gravity = -9.81;

    const detail = this.quality.propDetail | 0;
    this.maxBullets = detail >= 2 ? 40 : (detail === 1 ? 28 : 16);
    this.tracerLengthScale = Math.max(1, this.quality.tracerSegments | 0 || 1) * 0.8 + 0.4;

    this._tempDir = new THREE.Vector3();
    this._tempLook = new THREE.Vector3();
    this._oc = new THREE.Vector3();
    this._enemyProvider = null;
    this._enemies = [];
    this._enemyScratch = { dist: 0, enemy: null, head: false, x: 0, y: 0, z: 0 };
    this._tracerMat = new THREE.MeshBasicMaterial({
      color: 0xffcc44,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this._tracerGeo = new THREE.BoxGeometry(0.004, 0.004, 1);

    this.bullets = [];
    this._pool = [];
    this._free = [];

    for (let i = 0; i < this.maxBullets; i++) {
      const tracer = new THREE.Mesh(this._tracerGeo, this._tracerMat);
      tracer.visible = false;
      tracer.frustumCulled = false;
      this._pool.push({
        id: i,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        spawn: new THREE.Vector3(),
        tracer,
        damage: 0,
        maxRange: 200,
        distanceTraveled: 0,
        penetrationDepth: 0,
        energy: 0,
        alive: false,
        steps: 0,
        age: 0,
      });
      this._free.push(i);
    }

    this._hits = [];
    this._hitPool = [];
    for (let i = 0; i < HIT_POOL_SIZE; i++) {
      this._hitPool.push({
        point: new THREE.Vector3(),
        normal: new THREE.Vector3(),
        object: null,
        damage: 0,
        distance: 0,
        bullet: null,
      });
    }
  }

  fire(origin, direction, speed, damage, maxRange = 200) {
    let b;
    if (this._free.length > 0) {
      b = this._pool[this._free.pop()];
      this.bullets.push(b);
    } else {
      b = this.bullets.shift();
      if (!b) return null;
      this.bullets.push(b);
    }

    const velocityVar = 0.98 + Math.random() * 0.04;
    b.position.copy(origin);
    b.spawn.copy(origin);
    b.velocity.copy(direction).normalize().multiplyScalar(speed * velocityVar);
    b.damage = damage;
    b.maxRange = maxRange;
    b.distanceTraveled = 0;
    b.penetrationDepth = 0;
    b.energy = speed * speed;
    b.alive = true;
    b.steps = 0;
    b.age = 0;
    if (b.tracer) b.tracer.visible = false;
    return b;
  }

  setEnemyProvider(fn) {
    this._enemyProvider = fn;
  }

  _raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
    const mx = ox - cx;
    const my = oy - cy;
    const mz = oz - cz;
    const b = mx * dx + my * dy + mz * dz;
    const c = mx * mx + my * my + mz * mz - r * r;
    if (c > 0 && b > 0) return -1;
    const disc = b * b - c;
    if (disc < 0) return -1;
    const sq = Math.sqrt(disc);
    let t = -b - sq;
    if (t < 0) t = 0;
    return t;
  }

  _findEnemyHit(origin, dir, maxDist) {
    if (!this._enemyProvider) return null;
    const list = this._enemyProvider();
    if (!list || list.length === 0) return null;

    const ox = origin.x, oy = origin.y, oz = origin.z;
    const dx = dir.x, dy = dir.y, dz = dir.z;

    let bestT = maxDist;
    let bestEnemy = null;
    let bestHead = false;
    let bx = 0, by = 0, bz = 0;

    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || !e.isAlive()) continue;
      const p = e.getPosition();
      if (!p) continue;
      const ex = p.x, ey = p.y, ez = p.z;

      const tBody = this._raySphere(ox, oy, oz, dx, dy, dz, ex, ey + 0.95, ez, 0.42);
      const tHead = this._raySphere(ox, oy, oz, dx, dy, dz, ex, ey + 1.62, ez, 0.17);

      let t = -1;
      let head = false;
      if (tHead >= 0 && (tBody < 0 || tHead <= tBody + 0.35)) {
        t = tHead;
        head = true;
      } else if (tBody >= 0) {
        t = tBody;
      }

      if (t >= 0 && t < bestT) {
        bestT = t;
        bestEnemy = e;
        bestHead = head;
        bx = ox + dx * t;
        by = oy + dy * t;
        bz = oz + dz * t;
      }
    }

    if (!bestEnemy) return null;
    const s = this._enemyScratch;
    s.dist = bestT;
    s.enemy = bestEnemy;
    s.head = bestHead;
    s.x = bx;
    s.y = by;
    s.z = bz;
    return s;
  }

  update(dt) {
    const bullets = this.bullets;
    const pool = this._pool;
    const free = this._free;
    const hits = this._hits;
    hits.length = 0;

    const maxSteps = this.physicsSteps;
    let write = 0;

    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];

      b.age += dt;
      b.velocity.y += this.gravity * dt;

      const speed = b.velocity.length();
      const stepLen = speed * dt;
      if (speed > 0.00001) this._tempDir.copy(b.velocity).multiplyScalar(1 / speed);
      else this._tempDir.set(0, 0, -1);

      let substeps = Math.ceil(stepLen / CCD_STEP);
      if (substeps > maxSteps) substeps = maxSteps;
      if (substeps < 1) substeps = 1;
      const substepLen = stepLen / substeps;

      let skipRay = b.steps === 0 && stepLen <= SKIP_FIRST_RAY_STEP;
      b.steps++;

      let killed = false;

      for (let s = 0; s < substeps; s++) {
        const worldHit = skipRay ? null : this.physics.raycast(b.position, this._tempDir, substepLen + 0.01);
        skipRay = false;

        const eHit = this._findEnemyHit(b.position, this._tempDir, substepLen + 0.01);

        if (eHit && (!worldHit || eHit.dist <= worldHit.distance)) {
          if (hits.length < this._hitPool.length) {
            const rec = this._hitPool[hits.length];
            rec.point.set(eHit.x, eHit.y, eHit.z);
            rec.normal.set(0, 0, 1);
            rec.object = null;
            rec.enemy = eHit.enemy;
            rec.isHeadshot = eHit.head;
            rec.damage = this._calculateDamage(b) * (eHit.head ? 2.0 : 1.0);
            rec.distance = b.distanceTraveled + eHit.dist;
            rec.bullet = b;
            hits.push(rec);
          }
          b.alive = false;
          if (b.tracer) b.tracer.visible = false;
          killed = true;
          break;
        }

        if (worldHit) {
          const mat = worldHit.object.material;
          const isMetal = mat && mat.metalness > 0.5;

          if (isMetal && b.penetrationDepth < 3 && b.energy > 10000) {
            const penetrationChance = Math.min(0.8, b.energy / 50000);
            if (Math.random() < penetrationChance) {
              b.penetrationDepth++;
              b.damage *= 0.7;
              b.energy *= 0.6;
              b.velocity.multiplyScalar(0.7);
              b.position.copy(worldHit.point).addScaledVector(this._tempDir, 0.01);
              continue;
            }
          }

          if (!isMetal && Math.random() < 0.2) {
            const normal = worldHit.face ? worldHit.face.normal : _up;
            b.velocity.reflect(normal).multiplyScalar(0.3);
            b.damage *= 0.5;
            b.energy *= 0.3;
            b.position.copy(worldHit.point).addScaledVector(this._tempDir, 0.01);
            continue;
          }

          if (hits.length < this._hitPool.length) {
            const rec = this._hitPool[hits.length];
            rec.point.copy(worldHit.point);
            if (worldHit.face) rec.normal.copy(worldHit.face.normal);
            else rec.normal.copy(_up);
            rec.object = worldHit.object;
            rec.enemy = null;
            rec.isHeadshot = false;
            rec.damage = this._calculateDamage(b);
            rec.distance = b.distanceTraveled + worldHit.distance;
            rec.bullet = b;
            hits.push(rec);
          }

          b.alive = false;
          if (b.tracer) b.tracer.visible = false;
          killed = true;
          break;
        }

        b.position.addScaledVector(this._tempDir, substepLen);
        b.distanceTraveled += substepLen;
      }

      if (killed) continue;

      if (b.distanceTraveled >= b.maxRange || b.position.y < -10) {
        b.alive = false;
        if (b.tracer) b.tracer.visible = false;
        continue;
      }

      if (b.tracer) {
        b.tracer.visible = true;
        b.tracer.position.copy(b.position);
        b.tracer.lookAt(this._tempLook.copy(b.position).add(b.velocity));
        const len = Math.min(stepLen * 3, 2) * this.tracerLengthScale;
        b.tracer.scale.set(1, 1, len);
      }

      bullets[write++] = b;
    }

    for (let i = write; i < bullets.length; i++) {
      const b = bullets[i];
      if (b.alive) continue;
      b.tracer.visible = false;
      if (free.length < pool.length) free.push(b.id);
    }
    bullets.length = write;

    return hits;
  }

  _calculateDamage(bullet) {
    const falloffStart = bullet.maxRange * 0.3;
    const falloffEnd = bullet.maxRange * 0.8;

    if (bullet.distanceTraveled < falloffStart) {
      return bullet.damage;
    }

    if (bullet.distanceTraveled > falloffEnd) {
      return bullet.damage * 0.5;
    }

    const t = (bullet.distanceTraveled - falloffStart) / (falloffEnd - falloffStart);
    return bullet.damage * (1 - t * 0.5);
  }

  getActiveBullets() {
    return this.bullets;
  }

  getTracers() {
    const out = this._tracerOut || (this._tracerOut = []);
    out.length = 0;
    for (let i = 0; i < this.bullets.length; i++) {
      const t = this.bullets[i].tracer;
      if (t && this.bullets[i].alive) out.push(t);
    }
    return out;
  }

  clear() {
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      b.alive = false;
      if (b.tracer) b.tracer.visible = false;
    }
    this.bullets.length = 0;
    this._free.length = 0;
    for (let i = 0; i < this._pool.length; i++) this._free.push(i);
    this._hits.length = 0;
  }
}
