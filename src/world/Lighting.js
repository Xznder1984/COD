import * as THREE from 'three';

const SUN_OFFSET = new THREE.Vector3(40, 60, -50);
const SHADOW_EXTENT = 48;
const SHADOW_MIN = 8;
const SHADOW_MAX = 180;

const FILL_LIGHT_COUNT = [0, 1, 2];
const FILL_POSITIONS = [
  { pos: [18, 7, 18], color: 0xffddaa, intensity: 0.32, dist: 42 },
  { pos: [-18, 7, -18], color: 0xffddaa, intensity: 0.32, dist: 42 },
  { pos: [4, 7, -22], color: 0xc8d8ff, intensity: 0.26, dist: 38 },
  { pos: [-4, 7, 22], color: 0xffc890, intensity: 0.26, dist: 38 },
];

const DEFAULT_QUALITY = {
  name: 'low',
  shadowsEnabled: true,
  shadowMapSize: 512,
  maxLights: 2,
  propDetail: 0,
  buildingDetail: 0,
  dustParticles: 0,
  cloudLayers: 1,
  textureSize: 256,
  maxPixelRatio: 0.55,
};

function clampInt(value, min, max, fallback) {
  const n = value | 0;
  if (!Number.isFinite(n)) return fallback;
  return n < min ? min : n > max ? max : n;
}

function isQualityObject(value) {
  if (!value || typeof value !== 'object') return false;
  return 'maxLights' in value || 'shadowMapSize' in value || 'shadowsEnabled' in value ||
    'propDetail' in value || 'dustParticles' in value || 'buildingDetail' in value;
}

function pickQuality(...candidates) {
  for (let i = 0; i < candidates.length; i++) {
    if (isQualityObject(candidates[i])) return candidates[i];
  }
  return undefined;
}

function normalizeQuality(quality) {
  const q = { ...DEFAULT_QUALITY, ...(pickQuality(quality) || {}) };
  q.shadowsEnabled = q.shadowsEnabled !== false;
  q.shadowMapSize = clampInt(q.shadowMapSize, 256, 2048, 512);
  q.maxLights = clampInt(q.maxLights, 0, 8, 2);
  q.propDetail = clampInt(q.propDetail, 0, 2, 0);
  q.dustParticles = clampInt(q.dustParticles, 0, 4000, 0);
  return q;
}

export class Lighting {
  constructor(scene, _engine, _physics, quality) {
    this.scene = scene;
    this.quality = normalizeQuality(pickQuality(_engine, _physics, quality));
    this.maxLights = this.quality.maxLights;
    this.time = 0;
    this.fillLights = [];
    this.dust = null;

    this._buildSun();
    this._buildHemisphere();
    this._buildFillLights();
    this._buildDust();
  }

  get shadowsEnabled() {
    return this.quality.shadowsEnabled;
  }

  _buildSun() {
    this.sun = new THREE.DirectionalLight(0xfff7ec, 2.85);
    this.sun.position.copy(SUN_OFFSET);
    this.sun.castShadow = this.quality.shadowsEnabled;

    const size = this.quality.shadowMapSize;
    this.sun.shadow.mapSize.width = size;
    this.sun.shadow.mapSize.height = size;
    this.sun.shadow.camera.near = SHADOW_MIN;
    this.sun.shadow.camera.far = SHADOW_MAX;
    this.sun.shadow.camera.left = -SHADOW_EXTENT;
    this.sun.shadow.camera.right = SHADOW_EXTENT;
    this.sun.shadow.camera.top = SHADOW_EXTENT;
    this.sun.shadow.camera.bottom = -SHADOW_EXTENT;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.camera.updateProjectionMatrix();

    this.sunTarget = new THREE.Object3D();
    this.sunTarget.matrixAutoUpdate = false;
    this.scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;
    this.scene.add(this.sun);
  }

  _buildHemisphere() {
    this.hemi = new THREE.HemisphereLight(0xa8c8e6, 0x93826a, 1.6);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0x7c8896, 0.82);
    this.scene.add(this.ambient);
  }

  _buildFillLights() {
    const budget = Math.min(this.maxLights, FILL_LIGHT_COUNT[this.quality.propDetail]);
    if (budget <= 0) return;

    for (let i = 0; i < budget && i < FILL_POSITIONS.length; i++) {
      const { pos, color, intensity, dist } = FILL_POSITIONS[i];
      const light = new THREE.PointLight(color, intensity, dist, 2);
      light.position.set(pos[0], pos[1], pos[2]);
      light.userData.baseIntensity = intensity;
      this.fillLights.push(light);
      this.scene.add(light);
    }
  }

  _buildDust() {
    const count = this.quality.dustParticles;
    if (count <= 0) return;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 70;
      positions[i * 3 + 1] = Math.random() * 14;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 70;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xc4a882,
      size: 0.16,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.dust = new THREE.Points(geometry, material);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  setQuality(quality) {
    const q = normalizeQuality(pickQuality(quality));
    this.quality = q;
    this.maxLights = q.maxLights;

    const size = q.shadowMapSize;
    if (this.sun.shadow.mapSize.width !== size) {
      this.sun.shadow.mapSize.width = size;
      this.sun.shadow.mapSize.height = size;
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }

    this.sun.castShadow = q.shadowsEnabled;

    const budget = Math.min(q.maxLights, FILL_LIGHT_COUNT[q.propDetail]);
    while (this.fillLights.length > budget) {
      const light = this.fillLights.pop();
      this.scene.remove(light);
      light.dispose();
    }
    while (this.fillLights.length < budget && this.fillLights.length < FILL_POSITIONS.length) {
      const { pos, color, intensity, dist } = FILL_POSITIONS[this.fillLights.length];
      const light = new THREE.PointLight(color, intensity, dist, 2);
      light.position.set(pos[0], pos[1], pos[2]);
      light.userData.baseIntensity = intensity;
      this.fillLights.push(light);
      this.scene.add(light);
    }
  }

  update(dt, playerPosition) {
    this.time += dt;

    if (playerPosition) {
      this.sunTarget.position.copy(playerPosition);
      this.sunTarget.updateMatrix();
      this.sunTarget.updateMatrixWorld();
      if (this.sun.castShadow) {
        this.sun.position.set(
          playerPosition.x + SUN_OFFSET.x,
          playerPosition.y + SUN_OFFSET.y,
          playerPosition.z + SUN_OFFSET.z
        );
      }
    }

    if (this.fillLights.length > 0) {
      const flicker = Math.sin(this.time * 12) * 0.015 + Math.sin(this.time * 19) * 0.008;
      for (let i = 0; i < this.fillLights.length; i++) {
        this.fillLights[i].intensity = this.fillLights[i].userData.baseIntensity + flicker;
      }
    }

    if (this.dust) {
      this.dust.rotation.y += dt * 0.01;
    }
  }
}