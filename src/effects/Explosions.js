import * as THREE from 'three';

const DEFAULT_QUALITY = {
  maxPixelRatio: 0.7,
  renderScale: 0.7,
  bloomEnabled: false,
  grainEnabled: false,
  shadowsEnabled: false,
  maxParticles: 900,
  maxLights: 3,
  decalLimit: 12,
  name: 'low',
};

const FIREBALL_SEGMENTS_W_LOW = 6;
const FIREBALL_SEGMENTS_H_LOW = 4;
const FIREBALL_SEGMENTS_W_HIGH = 8;
const FIREBALL_SEGMENTS_H_HIGH = 6;
const SHOCKWAVE_SEGMENTS = 16;
const SCORCH_SEGMENTS = 10;

function fireballSegmentsFor(maxParticles) {
  if (maxParticles >= 900) {
    return [FIREBALL_SEGMENTS_W_HIGH, FIREBALL_SEGMENTS_H_HIGH];
  }
  return [FIREBALL_SEGMENTS_W_LOW, FIREBALL_SEGMENTS_H_LOW];
}

const fireballVertexShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fireballFragmentShader = `
  uniform float uTime;
  uniform float uOpacity;
  uniform float uSeed;

  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    vec3 pos = vPosition * 3.0 + uSeed * 10.0 + vec3(uTime * 3.0);
    float n = fract(sin(dot(pos, vec3(12.9898, 78.233, 45.164))) * 43758.5453);

    float facing = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
    float fresnel = facing * facing;

    vec3 color = mix(vec3(0.8, 0.15, 0.0), vec3(1.0, 0.5, 0.1), n);
    color = mix(color, vec3(1.0, 0.95, 0.7), fresnel * 0.55 + n * 0.3);

    float alpha = uOpacity * (0.4 + n * 0.6) * (0.5 + fresnel * 0.5);

    gl_FragColor = vec4(color, alpha);
  }
`;

const shockwaveVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const shockwaveFragmentShader = `
  uniform float uOpacity;

  varying vec2 vUv;

  void main() {
    float dist = length(vUv - 0.5) * 2.0;
    float ring = 1.0 - smoothstep(0.0, 0.3, abs(dist - 0.8));
    float inner = 1.0 - smoothstep(0.0, 0.8, dist);

    vec3 color = vec3(1.0, 0.8, 0.4);
    float alpha = uOpacity * ring * 0.8 + uOpacity * inner * 0.2;

    gl_FragColor = vec4(color, alpha);
  }
`;

class ExplosionPool {
  constructor(scene, geometry, makeMaterial, limit) {
    this.scene = scene;
    this.capacity = limit;
    this.entries = new Array(limit);
    this.inUse = new Uint8Array(limit);
    this.count = 0;
    for (let i = 0; i < limit; i++) {
      const material = makeMaterial();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      scene.add(mesh);
      this.entries[i] = {
        index: i,
        mesh,
        material,
        time: 0,
        duration: 1.6,
        seed: 0,
      };
    }
  }

  acquire() {
    if (this.count < this.capacity) {
      for (let i = 0; i < this.capacity; i++) {
        if (this.inUse[i] === 0) {
          this.inUse[i] = 1;
          this.count++;
          return this.entries[i];
        }
      }
      return this.entries[0];
    }
    let best = 0;
    let bestTime = -1;
    for (let i = 0; i < this.capacity; i++) {
      const e = this.entries[i];
      const age = e.duration > 0 ? e.time / e.duration : 2;
      if (age > bestTime) {
        bestTime = age;
        best = i;
      }
    }
    return this.entries[best];
  }

  release(entry) {
    if (entry === null || entry === undefined) return;
    if (this.inUse[entry.index] === 0) return;
    this.inUse[entry.index] = 0;
    this.count--;
    entry.mesh.visible = false;
  }

  dispose() {
    for (let i = 0; i < this.capacity; i++) {
      const e = this.entries[i];
      this.scene.remove(e.mesh);
      e.material.dispose();
      e.mesh = null;
      e.material = null;
    }
    this.entries.length = 0;
    this.inUse = null;
    this.count = 0;
  }
}

class DebrisPool {
  constructor(scene, geometry, material, limit) {
    this.scene = scene;
    this.capacity = limit;

    this.posX = new Float32Array(limit);
    this.posY = new Float32Array(limit);
    this.posZ = new Float32Array(limit);
    this.rotX = new Float32Array(limit);
    this.rotY = new Float32Array(limit);
    this.rotZ = new Float32Array(limit);
    this.velX = new Float32Array(limit);
    this.velY = new Float32Array(limit);
    this.velZ = new Float32Array(limit);
    this.spinX = new Float32Array(limit);
    this.spinY = new Float32Array(limit);
    this.spinZ = new Float32Array(limit);
    this.size = new Float32Array(limit);
    this.life = new Float32Array(limit);
    this.liveCount = 0;

    this.mesh = new THREE.InstancedMesh(geometry, material, limit);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);

    this._matrix = new THREE.Matrix4();
    this._quat = new THREE.Quaternion();
    this._euler = new THREE.Euler();
    this._scaleVec = new THREE.Vector3(1, 1, 1);
    this._posVec = new THREE.Vector3();
  }

  _writeInstance(idx) {
    this._posVec.set(this.posX[idx], this.posY[idx], this.posZ[idx]);
    this._euler.set(this.rotX[idx], this.rotY[idx], this.rotZ[idx]);
    this._quat.setFromEuler(this._euler);
    this._scaleVec.setScalar(this.size[idx]);
    this._matrix.compose(this._posVec, this._quat, this._scaleVec);
    this.mesh.setMatrixAt(idx, this._matrix);
  }

  spawn(x, y, z, count) {
    if (this.capacity === 0) return;
    if (count > this.capacity - this.liveCount) count = this.capacity - this.liveCount;
    if (count <= 0) return;

    for (let i = 0; i < count; i++) {
      const idx = this.liveCount++;
      this.posX[idx] = x;
      this.posY[idx] = y;
      this.posZ[idx] = z;
      this.rotX[idx] = 0;
      this.rotY[idx] = 0;
      this.rotZ[idx] = 0;
      this.velX[idx] = (Math.random() - 0.5) * 12;
      this.velY[idx] = Math.random() * 10 + 3;
      this.velZ[idx] = (Math.random() - 0.5) * 12;
      this.spinX[idx] = (Math.random() - 0.5) * 15;
      this.spinY[idx] = (Math.random() - 0.5) * 15;
      this.spinZ[idx] = (Math.random() - 0.5) * 15;
      this.size[idx] = Math.random() * 1.5 + 0.5;
      this.life[idx] = 2.0 + Math.random();
      this._writeInstance(idx);
    }

    this.mesh.count = this.liveCount;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt) {
    const total = this.liveCount;
    if (total === 0) return;

    const posX = this.posX, posY = this.posY, posZ = this.posZ;
    const rotX = this.rotX, rotY = this.rotY, rotZ = this.rotZ;
    const velX = this.velX, velY = this.velY, velZ = this.velZ;
    const spinX = this.spinX, spinY = this.spinY, spinZ = this.spinZ;
    const life = this.life, size = this.size;

    let w = 0;
    for (let i = 0; i < total; i++) {
      const l = life[i] - dt;
      if (l <= 0) continue;
      life[i] = l;

      let vy = velY[i] - 15 * dt;
      let x = posX[i] + velX[i] * dt;
      let y = posY[i] + vy * dt;
      let z = posZ[i] + velZ[i] * dt;

      if (y < 0.05) {
        y = 0.05;
        vy *= -0.3;
        velX[i] *= 0.6;
        velZ[i] *= 0.6;
        spinX[i] *= 0.5;
        spinY[i] *= 0.5;
        spinZ[i] *= 0.5;
      }

      const rx = rotX[i] + spinX[i] * dt;
      const ry = rotY[i] + spinY[i] * dt;
      const rz = rotZ[i] + spinZ[i] * dt;

      if (w !== i) {
        posX[w] = x;
        posY[w] = y;
        posZ[w] = z;
        velX[w] = velX[i];
        velY[w] = vy;
        velZ[w] = velZ[i];
        rotX[w] = rx;
        rotY[w] = ry;
        rotZ[w] = rz;
        spinX[w] = spinX[i];
        spinY[w] = spinY[i];
        spinZ[w] = spinZ[i];
        size[w] = size[i];
        life[w] = l;
        this._writeInstance(w);
      } else {
        velY[i] = vy;
        posX[i] = x;
        posY[i] = y;
        posZ[i] = z;
        rotX[i] = rx;
        rotY[i] = ry;
        rotZ[i] = rz;
        this._writeInstance(i);
      }
      w++;
    }

    this.liveCount = w;
    this.mesh.count = w;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
    this.mesh = null;
    this.liveCount = 0;
  }
}

export class Explosions {
  constructor(scene, particleSystem, screenEffects = null, quality = DEFAULT_QUALITY) {
    this.scene = scene;
    this.particleSystem = particleSystem;
    this.screenEffects = screenEffects;
    this.quality = quality;

    const maxParticles = Math.max(0, quality.maxParticles | 0);
    this.particleScale = maxParticles >= 2000 ? 1.0 : maxParticles >= 900 ? 0.7 : maxParticles >= 400 ? 0.45 : 0.25;
    this.maxExplosions = Math.max(2, Math.min(6, Math.round(maxParticles / 220) + 1));
    this.debrisLimit = Math.max(2, Math.min(12, Math.floor(maxParticles / 4)));
    this.enableFlash = maxParticles >= 900;
    this.enableScorch = quality.decalLimit > 0;

    const fireballSegs = fireballSegmentsFor(maxParticles);
    this.fireballGeometry = new THREE.SphereGeometry(1, fireballSegs[0], fireballSegs[1]);
    this.shockwaveGeometry = new THREE.RingGeometry(0.6, 1.0, SHOCKWAVE_SEGMENTS);
    this.scorchGeometry = new THREE.CircleGeometry(1, SCORCH_SEGMENTS);
    this.debrisGeometry = new THREE.BoxGeometry(0.12, 0.08, 0.1);
    this.flashGeometry = new THREE.PlaneGeometry(2, 2);

    this.fireballs = new ExplosionPool(scene, this.fireballGeometry, () => this._makeFireballMaterial(), this.maxExplosions);
    this.shockwaves = new ExplosionPool(scene, this.shockwaveGeometry, () => this._makeShockwaveMaterial(), this.maxExplosions);

    this.scorchPool = this.enableScorch
      ? new ExplosionPool(scene, this.scorchGeometry, () => new THREE.MeshBasicMaterial({
        color: 0x0A0A0A,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }), Math.min(this.maxExplosions, quality.decalLimit))
      : null;

    this.flashPool = this.enableFlash
      ? new ExplosionPool(scene, this.flashGeometry, () => new THREE.MeshBasicMaterial({
        color: 0xFFFFFF,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }), this.maxExplosions)
      : null;

    this.debrisMaterial = new THREE.MeshStandardMaterial({
      color: 0x2A2622,
      roughness: 0.9,
      metalness: 0.1,
    });
    this.debris = new DebrisPool(scene, this.debrisGeometry, this.debrisMaterial, this.debrisLimit);

    this.lights = [];
    const lightCount = Math.max(1, Math.min(3, quality.maxLights | 0));
    for (let i = 0; i < lightCount; i++) {
      const light = new THREE.PointLight(0xFFAA44, 0, 40, 1.2);
      light.visible = true;
      scene.add(light);
      this.lights.push({ light, until: -1 });
    }

    this.activeExplosions = [];
    this.pool = [];

    this._tempVec = new THREE.Vector3();
    this._seed = 0;

    this._optsMain = {
      fire: { spread: 1.5, lifetime: 0.8, size: 0.6 },
      sparks: { spread: 2.0, lifetime: 0.8, size: 0.06 },
      smoke: { spread: 1.2, lifetime: 3.5, size: 1.0 },
      debris: { spread: 2.5, lifetime: 2.0, size: 0.1 },
      dust: { spread: 3.0, lifetime: 4.0, size: 0.4 },
      ember: { spread: 2.0, lifetime: 2.0, size: 0.04 },
    };
    this._optsSecondary = {
      fire: { spread: 1.0, lifetime: 0.5, size: 0.3 },
      sparks: { spread: 1.5, lifetime: 0.4, size: 0.04 },
    };
  }

  _makeFireballMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 1.0 },
        uSeed: { value: 0 },
      },
      vertexShader: fireballVertexShader,
      fragmentShader: fireballFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });
  }

  _makeShockwaveMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 0.8 },
      },
      vertexShader: shockwaveVertexShader,
      fragmentShader: shockwaveFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  setQuality(quality) {
    this.quality = quality;
    const maxParticles = Math.max(0, quality.maxParticles | 0);
    this.particleScale = maxParticles >= 2000 ? 1.0 : maxParticles >= 900 ? 0.7 : maxParticles >= 400 ? 0.45 : 0.25;
    this.enableFlash = maxParticles >= 900;
    this.enableScorch = quality.decalLimit > 0;
    const wanted = Math.max(2, Math.floor(maxParticles / 4));
    this.debrisLimit = Math.min(this.debris.capacity, wanted);
    this.maxExplosions = Math.min(this.maxExplosions, Math.max(2, Math.min(6, Math.round(maxParticles / 220) + 1)));
  }

  explode(position, radius = 3, damage = 50) {
    while (this.activeExplosions.length >= this.maxExplosions) {
      this._retireOldest();
    }

    const x = position.x;
    const y = position.y;
    const z = position.z;

    const entry = this._getFromPool();
    entry.position = x;
    entry.positionY = y;
    entry.positionZ = z;
    entry.radius = radius;
    entry.damage = damage;
    entry.time = 0;
    entry.duration = 1.6;
    entry.seed = this._seed;
    this._seed = (this._seed + 1) % 64;
    entry.active = true;

    const fireball = this.fireballs.acquire();
    fireball.active = true;
    fireball.time = 0;
    fireball.duration = entry.duration;
    fireball.seed = entry.seed;
    fireball.mesh.visible = true;
    fireball.mesh.position.set(x, y, z);
    fireball.mesh.scale.setScalar(0.1);
    entry.fireball = fireball;

    const shockwave = this.shockwaves.acquire();
    shockwave.active = true;
    shockwave.time = 0;
    shockwave.duration = entry.duration;
    shockwave.mesh.visible = true;
    shockwave.mesh.position.set(x, y + 0.05, z);
    shockwave.mesh.rotation.set(-Math.PI / 2, 0, 0);
    shockwave.mesh.scale.setScalar(0.1);
    entry.shockwave = shockwave;

    if (this.scorchPool) {
      const scorch = this.scorchPool.acquire();
      scorch.active = true;
      scorch.time = 0;
      scorch.duration = 4.0;
      scorch.mesh.visible = true;
      scorch.mesh.position.set(x, 0.015, z);
      scorch.mesh.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
      scorch.mesh.scale.setScalar(radius * 1.8);
      entry.scorch = scorch;
    } else {
      entry.scorch = null;
    }

    if (this.flashPool) {
      const flash = this.flashPool.acquire();
      flash.active = true;
      flash.time = 0;
      flash.duration = entry.duration;
      flash.mesh.visible = true;
      flash.mesh.position.set(x, y, z);
      flash.mesh.scale.setScalar(radius * 2);
      if (this.screenEffects && this.screenEffects.camera) {
        flash.mesh.lookAt(this.screenEffects.camera.position);
      }
      entry.flash = flash;
    } else {
      entry.flash = null;
    }

    entry.light = this._acquireLight(x, y, z, radius);

    this._emitParticles(x, y, z, radius);
    this._createDebrisChunks(x, y, z, radius);

    if (this.screenEffects) {
      const camera = this.screenEffects.camera;
      if (camera) {
        const dx = camera.position.x - x;
        const dy = camera.position.y - y;
        const dz = camera.position.z - z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const distFactor = dist < radius * 10 ? 1.0 - dist / (radius * 10) : 0.1;
        this.screenEffects.shake(radius * 0.15 * distFactor, 0.6 * distFactor);
      } else {
        this.screenEffects.shake(radius * 0.15, 0.6);
      }
    }

    this.activeExplosions.push(entry);
  }

  _retireOldest() {
    const list = this.activeExplosions;
    if (list.length === 0) return;
    let idx = 0;
    let best = -1;
    for (let i = 0; i < list.length; i++) {
      const t = list[i].time / list[i].duration;
      if (t > best) {
        best = t;
        idx = i;
      }
    }
    this._cleanup(list[idx]);
    list[idx] = list[list.length - 1];
    list.pop();
  }

  _getFromPool() {
    const pooled = this.pool.pop();
    if (pooled) return pooled;
    return {
      position: 0,
      positionY: 0,
      positionZ: 0,
      radius: 3,
      damage: 50,
      time: 0,
      duration: 1.6,
      seed: 0,
      active: false,
      fireball: null,
      shockwave: null,
      scorch: null,
      flash: null,
      light: null,
    };
  }

  _acquireLight(x, y, z, radius) {
    const lights = this.lights;
    let best = lights[0];
    for (let i = 1; i < lights.length; i++) {
      if (lights[i].until < best.until) best = lights[i];
    }
    best.until = 1;
    best.light.intensity = 600;
    best.light.distance = radius * 10;
    best.light.position.set(x, y + 0.5, z);
    return best;
  }

  _emitParticles(x, y, z, radius) {
    const s = this.particleScale;
    if (s <= 0) return;

    const v = this._tempVec;
    const o = this._optsMain;
    v.set(x, y, z);

    this.particleSystem.emit('fire', v, Math.ceil(30 * s), o.fire);
    this.particleSystem.emit('sparks', v, Math.ceil(50 * s), o.sparks);
    this.particleSystem.emit('smoke', v, Math.ceil(35 * s), o.smoke);
    this.particleSystem.emit('debris', v, Math.ceil(25 * s), o.debris);
    this.particleSystem.emit('dust', v, Math.ceil(20 * s), o.dust);
    this.particleSystem.emit('ember', v, Math.ceil(25 * s), o.ember);

    const secondary = Math.floor(radius * 0.8 * s);
    if (secondary <= 0) return;

    const os = this._optsSecondary;
    const fireCount = Math.max(2, Math.ceil(5 * s));
    const sparkCount = Math.max(2, Math.ceil(8 * s));

    for (let i = 0; i < secondary; i++) {
      v.set(
        x + (Math.random() - 0.5) * radius,
        y + Math.random() * radius * 0.5,
        z + (Math.random() - 0.5) * radius
      );
      this.particleSystem.emit('fire', v, fireCount, os.fire);
      this.particleSystem.emit('sparks', v, sparkCount, os.sparks);
    }
  }

  _createDebrisChunks(x, y, z, radius) {
    const count = Math.min(this.debrisLimit, Math.floor(radius * 4 * this.particleScale));
    if (count <= 0) return;
    this.debris.spawn(x, y, z, count);
  }

  update(dt) {
    const list = this.activeExplosions;
    for (let i = list.length - 1; i >= 0; i--) {
      const exp = list[i];
      exp.time += dt;

      const t = exp.time / exp.duration;
      if (t >= 1.0) {
        this._cleanup(exp);
        list[i] = list[list.length - 1];
        list.pop();
        continue;
      }

      this._updateFireball(exp, t);
      this._updateShockwave(exp, t);
      this._updateLight(exp, t);
      if (exp.scorch) this._updateScorchMark(exp, t);
      if (exp.flash) this._updateFlashFrame(exp, t);
    }

    this.debris.update(dt);
  }

  _updateFireball(exp, t) {
    const mesh = exp.fireball.mesh;
    const expandT = t * 3 < 1 ? t * 3 : 1;
    const fadeT = (t - 0.3) / 0.7;
    const f = t > 0.3 ? fadeT : 0;
    let scale = exp.radius * (0.2 + expandT * 1.8 - f * 0.5);
    if (scale < 0.1) scale = 0.1;
    mesh.scale.setScalar(scale);

    const u = exp.fireball.material.uniforms;
    u.uTime.value = exp.time;
    u.uSeed.value = exp.seed;
    const op = 1.0 - t * 1.8;
    u.uOpacity.value = op > 0 ? op : 0;
  }

  _updateShockwave(exp, t) {
    const mesh = exp.shockwave.mesh;
    mesh.scale.setScalar(exp.radius * 4.0 * t);
    const k = (1.0 - t) * (1.0 - t);
    exp.shockwave.material.uniforms.uOpacity.value = 0.8 * k;
  }

  _updateLight(exp, t) {
    if (!exp.light) return;
    const slot = exp.light;
    const k = (1.0 - t) * (1.0 - t);
    if (k <= 0.002) {
      slot.light.intensity = 0;
      slot.until = 0;
      return;
    }
    const flicker = 1.0 + (Math.random() - 0.5) * 0.4;
    slot.light.intensity = 600 * k * flicker;
  }

  _updateScorchMark(exp, t) {
    exp.scorch.material.opacity = 0.8 * (1.0 - t * 0.2);
  }

  _updateFlashFrame(exp, t) {
    const o = 0.9 - t * 7.2;
    exp.flash.material.opacity = o > 0 ? o : 0;
    if (this.screenEffects && this.screenEffects.camera) {
      exp.flash.mesh.lookAt(this.screenEffects.camera.position);
    }
  }

  _cleanup(exp) {
    if (exp.fireball) {
      this.fireballs.release(exp.fireball);
      exp.fireball = null;
    }
    if (exp.shockwave) {
      this.shockwaves.release(exp.shockwave);
      exp.shockwave = null;
    }
    if (exp.scorch) {
      this.scorchPool.release(exp.scorch);
      exp.scorch = null;
    }
    if (exp.flash) {
      this.flashPool.release(exp.flash);
      exp.flash = null;
    }
    if (exp.light) {
      exp.light.light.intensity = 0;
      exp.light.until = -1;
      exp.light = null;
    }
    exp.active = false;
    this.pool.push(exp);
  }

  getActiveCount() {
    return this.activeExplosions.length;
  }

  dispose() {
    for (let i = 0; i < this.activeExplosions.length; i++) {
      const exp = this.activeExplosions[i];
      if (exp.fireball) this.fireballs.release(exp.fireball);
      if (exp.shockwave) this.shockwaves.release(exp.shockwave);
      if (exp.scorch) this.scorchPool.release(exp.scorch);
      if (exp.flash) this.flashPool.release(exp.flash);
if (exp.light) {
        exp.light.light.intensity = 0;
        exp.light.until = -1;
      }
      exp.active = false;
    }
    this.activeExplosions.length = 0;
    this.pool.length = 0;

    this.fireballs.dispose();
    this.shockwaves.dispose();
    if (this.scorchPool) this.scorchPool.dispose();
    if (this.flashPool) this.flashPool.dispose();
    this.debris.dispose();

    for (let i = 0; i < this.lights.length; i++) {
      this.scene.remove(this.lights[i].light);
      this.lights[i].light = null;
    }
    this.lights.length = 0;

    this.fireballGeometry.dispose();
    this.shockwaveGeometry.dispose();
    this.scorchGeometry.dispose();
    this.debrisGeometry.dispose();
    this.flashGeometry.dispose();

    this.fireballs = null;
    this.shockwaves = null;
    this.scorchPool = null;
    this.flashPool = null;
    this.debris = null;
  }
}