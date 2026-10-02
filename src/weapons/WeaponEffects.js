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

const _look = new THREE.Vector3();
const _vel = new THREE.Vector3();

export class WeaponEffects {
  constructor(scene, assetFactory, quality) {
    this.scene = scene;
    this.assetFactory = assetFactory;
    this.quality = Object.assign({}, DEFAULT_QUALITY, quality || {});

    const detail = Math.max(0, this.quality.propDetail | 0);
    this.detail = detail;
    this.impactBudget = Math.min(
      detail >= 2 ? 40 : (detail === 1 ? 22 : 10),
      Math.max(4, (this.quality.maxParticles | 0) >> 3)
    );
    this.decalLimit = Math.max(0, this.quality.decalLimit | 0);
    this.casingLimit = Math.max(0, this.quality.casingLimit | 0);
    this.tracerLimit = detail >= 2 ? 8 : (detail === 1 ? 5 : 3);
    this.flashPoolSize = detail >= 1 ? 3 : 2;
    this.smokePuffs = detail >= 1 ? 2 : 1;
    this.impactLightCount = Math.max(0, Math.min(3, (this.quality.maxLights | 0) - 2));

    this._muzzleLightLife = 0;

    this._flashTexture = this._createFlashTexture();
    this._smokeTexture = this._createSmokeTexture();
    this._sparkTexture = this._createSparkTexture();

    this._casingGeo = new THREE.BoxGeometry(0.008, 0.008, 0.02);
    this._casingMat = new THREE.MeshStandardMaterial({
      color: 0xc8a84b, metalness: 0.95, roughness: 0.2,
    });
    this._decalGeo = new THREE.CircleGeometry(0.015, detail >= 1 ? 8 : 5);
    this._decalMat = new THREE.MeshBasicMaterial({
      color: 0x1a1a1a,
      transparent: true,
      opacity: 0.8,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this._tracerMat = new THREE.MeshBasicMaterial({
      color: 0xffcc44,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this._tracerGeo = new THREE.BoxGeometry(0.003, 0.003, 1);
    this._tracerGlowMat = new THREE.SpriteMaterial({
      map: this._sparkTexture,
      color: 0xffcc44,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.6,
    });

    this._muzzleLight = new THREE.PointLight(0xff8830, 0, 15, 2);
    this._muzzleLight.position.set(0, -100, 0);
    this.scene.add(this._muzzleLight);

    this.impactLights = [];
    for (let i = 0; i < this.impactLightCount; i++) {
      const l = new THREE.PointLight(0xffaa33, 0, 5, 2);
      l.position.set(0, -100, 0);
      this.scene.add(l);
      this.impactLights.push({ light: l, life: 0, maxLife: 0.12, active: false });
    }

    this._buildFlashPool();
    this._buildImpactPool();
    this._buildDecalPool();
    this._buildCasingPool();
    this._buildTracerPool();
  }

  _buildFlashPool() {
    this.muzzleFlashes = [];
    for (let i = 0; i < this.flashPoolSize; i++) {
      const flashMat = new THREE.SpriteMaterial({
        map: this._flashTexture,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0,
      });
      const smokeMat = new THREE.SpriteMaterial({
        map: this._smokeTexture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const smoke2Mat = new THREE.SpriteMaterial({
        map: this._smokeTexture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });

      const sprite = new THREE.Sprite(flashMat);
      sprite.visible = false;
      sprite.scale.set(0.35, 0.35, 0.35);
      this.scene.add(sprite);

      const smoke = new THREE.Sprite(smokeMat);
      smoke.visible = false;
      smoke.scale.set(0.15, 0.15, 0.15);
      this.scene.add(smoke);

      const smoke2 = new THREE.Sprite(smoke2Mat);
      smoke2.visible = false;
      smoke2.scale.set(0.1, 0.1, 0.1);
      this.scene.add(smoke2);

      this.muzzleFlashes.push({
        sprite, smoke, smoke2,
        life: 0,
        maxLife: 0.1,
        dirX: 0, dirY: 0, dirZ: 0,
        active: false,
      });
    }
  }

  _buildImpactPool() {
    this.impacts = [];
    for (let i = 0; i < this.impactBudget; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this._sparkTexture,
        color: 0xffaa33,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.scene.add(sprite);
      this.impacts.push({
        sprite,
        mat,
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0.25,
        gravity: -10,
        baseScale: 0.05,
        active: false,
      });
    }
  }

  _buildDecalPool() {
    this.decals = [];
    this._decalCursor = 0;
    for (let i = 0; i < this.decalLimit; i++) {
      const mesh = new THREE.Mesh(this._decalGeo, this._decalMat);
      mesh.visible = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.scene.add(mesh);
      this.decals.push({ mesh, life: 0, maxLife: 15, active: false });
    }
  }

  _buildCasingPool() {
    this.casings = [];
    this._casingCursor = 0;
    for (let i = 0; i < this.casingLimit; i++) {
      const mesh = new THREE.Mesh(this._casingGeo, this._casingMat);
      mesh.visible = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.scene.add(mesh);
      this.casings.push({
        mesh,
        velocity: new THREE.Vector3(),
        angularVel: new THREE.Vector3(),
        life: 0,
        maxLife: 2.5,
        stillTime: 0,
        bounced: false,
        active: false,
      });
    }
  }

  _buildTracerPool() {
    this.tracers = [];
    this._tracerCursor = 0;
    for (let i = 0; i < this.tracerLimit; i++) {
      const mesh = new THREE.Mesh(this._tracerGeo, this._tracerMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);

      let glow = null;
      if (this.detail >= 1) {
        glow = new THREE.Sprite(this._tracerGlowMat);
        glow.visible = false;
        glow.scale.set(0.08, 0.08, 0.08);
        this.scene.add(glow);
      }
      this.tracers.push({ mesh, glow, life: 0, maxLife: 0.08, active: false });
    }
  }

  _createFlashTexture() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,220,1)');
    grad.addColorStop(0.15, 'rgba(255,220,100,0.95)');
    grad.addColorStop(0.35, 'rgba(255,150,40,0.7)');
    grad.addColorStop(0.6, 'rgba(255,80,10,0.3)');
    grad.addColorStop(1, 'rgba(255,40,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const x = 64 + Math.cos(angle) * 30;
      const y = 64 + Math.sin(angle) * 30;
      const spike = ctx.createRadialGradient(x, y, 0, x, y, 18);
      spike.addColorStop(0, 'rgba(255,230,120,0.9)');
      spike.addColorStop(0.5, 'rgba(255,150,30,0.5)');
      spike.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.fillStyle = spike;
      ctx.fillRect(0, 0, 128, 128);
    }
    return new THREE.CanvasTexture(c);
  }

  _createSmokeTexture() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(200,200,200,0.7)');
    grad.addColorStop(0.4, 'rgba(170,170,170,0.4)');
    grad.addColorStop(0.7, 'rgba(140,140,140,0.15)');
    grad.addColorStop(1, 'rgba(120,120,120,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  _createSparkTexture() {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,220,1)');
    grad.addColorStop(0.2, 'rgba(255,200,80,0.9)');
    grad.addColorStop(0.5, 'rgba(255,120,20,0.5)');
    grad.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  }

  _takeFlash() {
    const pool = this.muzzleFlashes;
    for (let i = 0; i < pool.length; i++) {
      if (!pool[i].active) return pool[i];
    }
    let oldest = pool[0];
    for (let i = 1; i < pool.length; i++) {
      if (pool[i].life > oldest.life) oldest = pool[i];
    }
    return oldest;
  }

  muzzleFlash(position, direction) {
    const f = this._takeFlash();
    f.active = true;
    f.life = 0;
    f.maxLife = 0.1;
    f.dirX = direction.x;
    f.dirY = direction.y;
    f.dirZ = direction.z;

    this._muzzleLight.position.copy(position);
    this._muzzleLight.intensity = 12;
    this._muzzleLightLife = 0.1;

    f.sprite.position.copy(position);
    f.sprite.scale.set(0.35, 0.35, 0.35);
    f.sprite.material.opacity = 1;
    f.sprite.material.rotation = Math.random() * Math.PI * 2;
    f.sprite.visible = true;

    f.smoke.position.copy(position).addScaledVector(direction, 0.08);
    f.smoke.scale.set(0.15, 0.15, 0.15);
    f.smoke.material.opacity = 0.6;
    f.smoke.visible = true;

    if (this.smokePuffs > 1) {
      f.smoke2.position.copy(position).addScaledVector(direction, 0.2);
      f.smoke2.scale.set(0.1, 0.1, 0.1);
      f.smoke2.material.opacity = 0.4;
      f.smoke2.visible = true;
    } else {
      f.smoke2.visible = false;
    }
  }

  _spawnImpact(slot, position, normal, tex, color, additive, size, speed, normalPush, lifeBase, lifeVar, gravity) {
    slot.active = true;
    slot.life = 0;
    slot.maxLife = lifeBase + Math.random() * lifeVar;
    slot.gravity = gravity;
    slot.baseScale = size;

    const mat = slot.mat;
    if (mat.map !== tex) {
      mat.map = tex;
      mat.needsUpdate = true;
    }
    if (mat.color.getHex() !== color) mat.color.setHex(color);
    const blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    if (mat.blending !== blending) {
      mat.blending = blending;
      mat.needsUpdate = true;
    }
    mat.opacity = 1;

    const sp = slot.sprite;
    sp.visible = true;
    sp.position.copy(position).addScaledVector(normal, 0.01);
    sp.scale.set(size, size, size);
    slot.velocity.set(
      (Math.random() - 0.5) * 4 * speed,
      Math.random() * 4 * speed,
      (Math.random() - 0.5) * 4 * speed
    ).addScaledVector(normal, normalPush);
  }

  _takeImpact() {
    const pool = this.impacts;
    for (let i = 0; i < pool.length; i++) {
      if (!pool[i].active) return pool[i];
    }
    let oldest = pool[0];
    for (let i = 1; i < pool.length; i++) {
      if (pool[i].life > oldest.life) oldest = pool[i];
    }
    return oldest;
  }

  impactEffect(position, normal, materialType) {
    if (materialType === 'flesh') {
      const count = this.detail >= 2 ? 14 : (this.detail >= 1 ? 9 : 5);
      for (let i = 0; i < count; i++) {
        const slot = this._takeImpact();
        this._spawnImpact(slot, position, normal, this._smokeTexture,
          i % 3 === 0 ? 0x8a0f12 : 0xc21a1e, false,
          0.04 + Math.random() * 0.05, 1.2, 2.6, 0.7, 0.55, -9);
      }
      return;
    }

    const isMetal = materialType === 'metal';
    const tex = isMetal ? this._sparkTexture : this._smokeTexture;
    const color = isMetal ? 0xffaa33 : 0xaa9977;
    const particleCount = this.detail >= 2 ? 12 : (this.detail >= 1 ? 8 : 4);

    for (let i = 0; i < particleCount; i++) {
      const slot = this._takeImpact();
      const size = isMetal ? 0.05 + Math.random() * 0.05 : 0.06 + Math.random() * 0.06;
      this._spawnImpact(slot, position, normal, tex, color, isMetal, size, 1, 2.5,
        isMetal ? 0.25 : 0.5, isMetal ? 0.2 : 0.4, isMetal ? -10 : -4);
    }

    if (!isMetal && this.detail >= 1) {
      const smokeCount = this.detail >= 2 ? 4 : 2;
      for (let i = 0; i < smokeCount; i++) {
        const slot = this._takeImpact();
        const size = 0.08 + Math.random() * 0.08;
        this._spawnImpact(slot, position, normal, this._smokeTexture, 0x887766, false,
          size, 0.5, 1.5, 0.6, 0.5, -1.5);
      }
    }

    if (this.impactLights.length > 0) {
      let light = null;
      for (let i = 0; i < this.impactLights.length; i++) {
        if (!this.impactLights[i].active) {
          light = this.impactLights[i];
          break;
        }
      }
      if (!light) light = this.impactLights[0];
      light.active = true;
      light.life = 0;
      light.light.color.setHex(isMetal ? 0xffaa33 : 0xffcc88);
      light.light.position.copy(position).addScaledVector(normal, 0.1);
      light.light.intensity = 4;
    }

    if (this.decalLimit > 0) {
      const d = this.decals[this._decalCursor];
      this._decalCursor = (this._decalCursor + 1) % this.decalLimit;
      d.active = true;
      d.life = 0;
      d.mesh.visible = true;
      d.mesh.position.copy(position).addScaledVector(normal, 0.005);
      d.mesh.lookAt(_look.copy(position).add(normal));
      const decalSize = isMetal ? 0.012 + Math.random() * 0.008 : 0.018 + Math.random() * 0.01;
      const s = decalSize / 0.015;
      d.mesh.scale.set(s, s, 1);
      d.mesh.rotation.z = Math.random() * Math.PI * 2;
    }
  }

  ejectCasing(position, rightDirection) {
    if (this.casingLimit === 0) return;
    const c = this.casings[this._casingCursor];
    this._casingCursor = (this._casingCursor + 1) % this.casingLimit;

    c.active = true;
    c.life = 0;
    c.stillTime = 0;
    c.bounced = false;
    c.mesh.visible = true;
    c.mesh.position.copy(position);
    c.mesh.rotation.set(Math.random(), Math.random(), Math.random());
    c.velocity.set(
      rightDirection.x * (1.5 + Math.random()),
      2 + Math.random() * 0.5,
      rightDirection.z * (1.5 + Math.random())
    );
    c.angularVel.set(
      Math.random() * 25 - 12,
      Math.random() * 25 - 12,
      Math.random() * 25 - 12
    );
  }

  createTracer(from, to) {
    if (this.tracerLimit === 0) return;
    const t = this.tracers[this._tracerCursor];
    this._tracerCursor = (this._tracerCursor + 1) % this.tracerLimit;

    _vel.subVectors(to, from);
    const len = _vel.length();
    if (len < 0.1) return;

    t.active = true;
    t.life = 0;
    t.mesh.visible = true;
    t.mesh.position.copy(from).addScaledVector(_vel, 0.5);
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, len);

    if (t.glow) {
      t.glow.visible = true;
      t.glow.position.copy(from);
      t.glow.scale.set(0.08, 0.08, 0.08);
    }
  }

  update(dt) {
    if (this._muzzleLightLife > 0) {
      this._muzzleLightLife -= dt;
      this._muzzleLight.intensity = this._muzzleLightLife > 0 ? 12 * (this._muzzleLightLife / 0.1) : 0;
    }

    for (let i = 0; i < this.muzzleFlashes.length; i++) {
      const f = this.muzzleFlashes[i];
      if (!f.active) continue;
      f.life += dt;
      const t = f.life / f.maxLife;
      if (t >= 1) {
        f.active = false;
        f.sprite.visible = false;
        f.smoke.visible = false;
        f.smoke2.visible = false;
        continue;
      }
      f.sprite.material.opacity = 1 - t;
      f.sprite.material.rotation = Math.random() * Math.PI * 2;
      const s = 0.35 * (1 - t * 0.3);
      f.sprite.scale.set(s, s, s);
      f.smoke.position.x += f.dirX * dt * 0.8;
      f.smoke.position.y += f.dirY * dt * 0.8;
      f.smoke.position.z += f.dirZ * dt * 0.8;
      f.smoke.material.opacity = 0.6 * (1 - t);
      const ss = 0.15 * (1 + t * 0.5);
      f.smoke.scale.set(ss, ss, ss);
      if (f.smoke2.visible) {
        f.smoke2.position.x += f.dirX * dt * 0.5;
        f.smoke2.position.y += f.dirY * dt * 0.5;
        f.smoke2.position.z += f.dirZ * dt * 0.5;
        f.smoke2.material.opacity = 0.4 * (1 - t);
      }
    }

    for (let i = 0; i < this.impactLights.length; i++) {
      const l = this.impactLights[i];
      if (!l.active) continue;
      l.life += dt;
      if (l.life >= l.maxLife) {
        l.active = false;
        l.light.intensity = 0;
        continue;
      }
      l.light.intensity = 4 * (1 - l.life / l.maxLife);
    }

    for (let i = 0; i < this.impacts.length; i++) {
      const p = this.impacts[i];
      if (!p.active) continue;
      p.life += dt;
      const t = p.life / p.maxLife;
      if (t >= 1) {
        p.active = false;
        p.sprite.visible = false;
        p.mat.opacity = 0;
        continue;
      }
      p.velocity.y += p.gravity * dt;
      p.sprite.position.addScaledVector(p.velocity, dt);
      p.mat.opacity = 1 - t;
    }

    for (let i = 0; i < this.casings.length; i++) {
      const c = this.casings[i];
      if (!c.active) continue;
      c.life += dt;
      if (c.life >= c.maxLife) {
        c.active = false;
        c.mesh.visible = false;
        continue;
      }
      c.velocity.y -= 9.81 * dt;
      c.mesh.position.addScaledVector(c.velocity, dt);
      c.mesh.rotation.x += c.angularVel.x * dt;
      c.mesh.rotation.y += c.angularVel.y * dt;
      c.mesh.rotation.z += c.angularVel.z * dt;

      if (c.mesh.position.y < 0.01) {
        c.mesh.position.y = 0.01;
        if (!c.bounced) {
          c.velocity.y = Math.abs(c.velocity.y) * 0.35;
          c.velocity.x *= 0.6;
          c.velocity.z *= 0.6;
          c.bounced = true;
          c.stillTime = 0;
        } else {
          c.velocity.set(0, 0, 0);
          c.angularVel.set(0, 0, 0);
          c.stillTime += dt;
          if (c.stillTime > 2) {
            c.active = false;
            c.mesh.visible = false;
          }
        }
      }
    }

    for (let i = 0; i < this.tracers.length; i++) {
      const t = this.tracers[i];
      if (!t.active) continue;
      t.life += dt;
      if (t.life >= t.maxLife) {
        t.active = false;
        t.mesh.visible = false;
        if (t.glow) t.glow.visible = false;
      }
    }

    for (let i = 0; i < this.decals.length; i++) {
      const d = this.decals[i];
      if (!d.active) continue;
      d.life += dt;
      if (d.life >= d.maxLife) {
        d.active = false;
        d.mesh.visible = false;
      }
    }
  }

  clear() {
    for (let i = 0; i < this.muzzleFlashes.length; i++) {
      const f = this.muzzleFlashes[i];
      f.active = false;
      f.sprite.visible = false;
      f.smoke.visible = false;
      f.smoke2.visible = false;
    }
    this._muzzleLight.intensity = 0;

    for (let i = 0; i < this.impactLights.length; i++) {
      this.impactLights[i].active = false;
      this.impactLights[i].light.intensity = 0;
    }

    for (let i = 0; i < this.impacts.length; i++) {
      this.impacts[i].active = false;
      this.impacts[i].sprite.visible = false;
      this.impacts[i].mat.opacity = 0;
    }

    for (let i = 0; i < this.casings.length; i++) {
      this.casings[i].active = false;
      this.casings[i].mesh.visible = false;
    }

    for (let i = 0; i < this.tracers.length; i++) {
      this.tracers[i].active = false;
      this.tracers[i].mesh.visible = false;
      if (this.tracers[i].glow) this.tracers[i].glow.visible = false;
    }

    for (let i = 0; i < this.decals.length; i++) {
      this.decals[i].active = false;
      this.decals[i].mesh.visible = false;
    }

    this._decalCursor = 0;
    this._casingCursor = 0;
    this._tracerCursor = 0;
  }
}
