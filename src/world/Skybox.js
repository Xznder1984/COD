import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const SUN_DIRECTION = new THREE.Vector3(40, 60, -50).normalize();
const SKY_RADIUS = 340;
const HORIZON = 0xa6bccd;

const DOME_SEGMENTS = [[16, 8], [16, 8], [24, 12]];
const CLOUD_PUFFS = [0, 2, 3];
const BIRD_COUNT = [0, 3, 6];
const CULL_RADIUS = [150, 200, 260];

const DEFAULT_QUALITY = {
  name: 'low',
  cloudLayers: 1,
  propDetail: 0,
  buildingDetail: 0,
  shadowsEnabled: false,
  shadowMapSize: 512,
  maxLights: 1,
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
  return 'cloudLayers' in value || 'propDetail' in value || 'textureSize' in value ||
    'buildingDetail' in value || 'shadowMapSize' in value || 'maxPixelRatio' in value;
}

function pickQuality(...candidates) {
  for (let i = 0; i < candidates.length; i++) {
    if (isQualityObject(candidates[i])) return candidates[i];
  }
  return undefined;
}

function normalizeQuality(quality) {
  const q = { ...DEFAULT_QUALITY, ...(pickQuality(quality) || {}) };
  q.propDetail = clampInt(q.propDetail, 0, 2, 0);
  q.buildingDetail = clampInt(q.buildingDetail, 0, 2, 0);
  q.cloudLayers = clampInt(q.cloudLayers, 0, 6, 1);
  q.textureSize = clampInt(q.textureSize, 32, 1024, 256);
  q.maxLights = clampInt(q.maxLights, 0, 8, 1);
  return q;
}

const VERTEX_SHADER = `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  uniform vec3 topColor;
  uniform vec3 midColor;
  uniform vec3 bottomColor;
  uniform vec3 sunDirection;
  uniform vec3 sunColor;
  uniform float sunIntensity;
  varying vec3 vDir;

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    vec3 color;

    if (h > 0.0) {
      float t = pow(h, 0.5);
      color = mix(midColor, topColor, t);
    } else {
      float t = sqrt(-h);
      color = mix(midColor, bottomColor, t);
    }

    float d = max(dot(dir, sunDirection), 0.0);
    float d2 = d * d;
    float disc = smoothstep(0.9982, 0.9993, d);
    float glow = d2 * d2;
    color += sunColor * (disc * 2.2 + glow * 0.30 + d2 * 0.05) * sunIntensity;

    float haze = 1.0 - clamp(h, 0.0, 1.0);
    haze *= haze;
    haze *= haze;
    color = mix(color, midColor, haze * 0.22);

    gl_FragColor = vec4(color, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Skybox {
  constructor(scene, _engine, _physics, quality) {
    this.scene = scene;
    this.quality = normalizeQuality(pickQuality(_engine, _physics, quality));
    this.clouds = [];
    this.birds = [];
    this.birdMesh = null;
    this.cloudMesh = null;
    this.time = 0;
    this._cloudBaseY = 0;
    this._birdAngle = 0;
    this._birdSpeed = 0.12;
    this._birdRadius = 120;
    this._birdHeight = 52;

    this._buildSkyDome();
    this._buildClouds();
    this._buildBirds();
    this._buildFog();
  }

  get detail() {
    return this.quality.propDetail;
  }

  _buildSkyDome() {
    const seg = DOME_SEGMENTS[this.detail];

    this.skyMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        topColor: { value: new THREE.Color(0x1b4f96) },
        midColor: { value: new THREE.Color(HORIZON) },
        bottomColor: { value: new THREE.Color(0x4b4638) },
        sunDirection: { value: SUN_DIRECTION.clone() },
        sunColor: { value: new THREE.Color(0xfff0dd) },
        sunIntensity: { value: 1.0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });

    const geo = new THREE.SphereGeometry(SKY_RADIUS, seg[0], seg[1]);
    this.skyDome = new THREE.Mesh(geo, this.skyMaterial);
    this.skyDome.renderOrder = 900;
    this.skyDome.frustumCulled = false;
    this.skyDome.castShadow = false;
    this.skyDome.receiveShadow = false;
    this.skyDome.matrixAutoUpdate = false;
    this.skyDome.updateMatrix();
    this.scene.add(this.skyDome);
  }

  _buildClouds() {
    const layers = this.detail === 0 ? 0 : this.quality.cloudLayers;
    if (layers <= 0) return;

    const puffs = CLOUD_PUFFS[this.detail];
    const texture = this._createCloudTexture();
    const geos = [];
    const tint = new THREE.Color();

    for (let p = 0; p < puffs; p++) {
      for (let l = 0; l < layers; l++) {
        const size = 70 + Math.random() * 110;
        const depth = size * (0.3 + Math.random() * 0.3);
        const geo = new THREE.PlaneGeometry(size, depth);
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
          -Math.PI / 2 + (Math.random() - 0.5) * 0.12,
          Math.random() * Math.PI * 2,
          0
        ));
        const angle = (p / puffs) * Math.PI * 2 + Math.random() * 0.8;
        const radius = 110 + Math.random() * 130;
        m.compose(
          new THREE.Vector3(Math.cos(angle) * radius, 52 + l * 9 + Math.random() * 14, Math.sin(angle) * radius),
          q,
          new THREE.Vector3(1, 1, 1)
        );
        geo.applyMatrix4(m);
        tint.setRGB(0.92 + Math.random() * 0.08, 0.92 + Math.random() * 0.06, 0.9 + Math.random() * 0.08);
        const count = geo.attributes.position.count;
        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          colors[i * 3] = tint.r;
          colors[i * 3 + 1] = tint.g;
          colors[i * 3 + 2] = tint.b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geos.push(geo);
      }
    }

    const merged = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    if (!merged) return;

    this.cloudMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });

    this.cloudMesh = new THREE.Mesh(merged, this.cloudMaterial);
    this.cloudMesh.renderOrder = 901;
    this.cloudMesh.castShadow = false;
    this.cloudMesh.receiveShadow = false;
    this.cloudMesh.frustumCulled = false;
    this._cloudBaseY = 0;
    this.scene.add(this.cloudMesh);
    this.clouds.push(this.cloudMesh);
  }

  _createCloudTexture() {
    const size = Math.max(64, Math.min(256, this.quality.textureSize));
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    if ('filter' in ctx) ctx.filter = 'blur(' + Math.max(2, size * 0.022).toFixed(1) + 'px)';

    for (let i = 0; i < 12; i++) {
      const cx = size * (0.18 + Math.random() * 0.64);
      const cy = size * (0.32 + Math.random() * 0.36);
      const r = size * (0.09 + Math.random() * 0.16);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.5)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  _buildBirds() {
    const count = BIRD_COUNT[this.detail];
    if (count <= 0) return;

    const geos = [];
    const m = new THREE.Matrix4();
    const rot = new THREE.Euler();

    for (let i = 0; i < count; i++) {
      const wing = new THREE.PlaneGeometry(1.4, 0.34);
      rot.set(0.18, i * 0.9, 0.35);
      m.compose(new THREE.Vector3(-0.7, 0, 0), new THREE.Quaternion().setFromEuler(rot), new THREE.Vector3(1, 1, 1));
      wing.applyMatrix4(m);
      geos.push(wing);

      const wing2 = new THREE.PlaneGeometry(1.4, 0.34);
      rot.set(-0.18, i * 0.9 + Math.PI, -0.35);
      m.compose(new THREE.Vector3(0.7, 0, 0), new THREE.Quaternion().setFromEuler(rot), new THREE.Vector3(1, 1, 1));
      wing2.applyMatrix4(m);
      geos.push(wing2);
    }

    const merged = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    if (!merged) return;

    this.birdMaterial = new THREE.MeshBasicMaterial({
      color: 0x1c1a18,
      side: THREE.DoubleSide,
      fog: false,
    });

    this.birdMesh = new THREE.Mesh(merged, this.birdMaterial);
    this.birdMesh.frustumCulled = false;
    this.birdMesh.castShadow = false;
    this._birdRadius = 95 + Math.random() * 45;
    this._birdHeight = 34 + Math.random() * 18;
    this._birdAngle = Math.random() * Math.PI * 2;
    this.birdMesh.position.set(
      Math.cos(this._birdAngle) * this._birdRadius,
      this._birdHeight,
      Math.sin(this._birdAngle) * this._birdRadius
    );
    this.birdMesh.lookAt(0, this._birdHeight, 0);
    this.scene.add(this.birdMesh);
    this.birds.push(this.birdMesh);
  }

  _buildFog() {
    this.scene.fog = new THREE.FogExp2(HORIZON, 0.003);
  }

  getCullDistance() {
    return CULL_RADIUS[this.detail];
  }

  update(dt, cameraPosition) {
    this.time += dt;

    if (this.cloudMesh) {
      this.cloudMesh.rotation.y += dt * 0.004;
      this.cloudMesh.position.y = this._cloudBaseY + Math.sin(this.time * 0.05) * 3.5;
      this.cloudMesh.position.x = cameraPosition ? cameraPosition.x * 0.35 : 0;
      this.cloudMesh.position.z = cameraPosition ? cameraPosition.z * 0.35 : 0;
    }

    if (this.birdMesh) {
      this._birdAngle += this._birdSpeed * dt;
      const bob = Math.sin(this.time * 0.6) * 2.5;
      this.birdMesh.position.set(
        Math.cos(this._birdAngle) * this._birdRadius,
        this._birdHeight + bob,
        Math.sin(this._birdAngle) * this._birdRadius
      );
      this.birdMesh.rotation.y = -this._birdAngle + Math.PI / 2;
      this.birdMesh.rotation.z = Math.sin(this.time * 2.2) * 0.25;
    }
  }
}