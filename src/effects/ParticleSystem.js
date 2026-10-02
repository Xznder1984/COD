import * as THREE from 'three';

const DEFAULT_QUALITY = {
  maxParticles: 900,
  dustParticles: 0,
  maxPixelRatio: 0.7,
  renderScale: 0.7,
  bloomEnabled: false,
  grainEnabled: false,
  shadowsEnabled: true,
};

function createParticleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.25, 'rgba(255, 255, 255, 0.85)');
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.4)');
  gradient.addColorStop(0.75, 'rgba(255, 255, 255, 0.1)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createFireTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(255, 255, 220, 1)');
  gradient.addColorStop(0.15, 'rgba(255, 220, 80, 0.9)');
  gradient.addColorStop(0.35, 'rgba(255, 140, 20, 0.6)');
  gradient.addColorStop(0.6, 'rgba(255, 60, 0, 0.25)');
  gradient.addColorStop(1, 'rgba(200, 20, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createSmokeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(220, 220, 220, 0.7)');
  gradient.addColorStop(0.4, 'rgba(180, 180, 180, 0.4)');
  gradient.addColorStop(0.7, 'rgba(140, 140, 140, 0.15)');
  gradient.addColorStop(1, 'rgba(100, 100, 100, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const PARTICLE_TEXTURES = {
  default: createParticleTexture(),
  fire: createFireTexture(),
  smoke: createSmokeTexture(),
};

const GROUND_MODE_NONE = 0;
const GROUND_MODE_BOUNCE = 1;
const GROUND_MODE_SPLATTER = 2;

function finalize(config) {
  const out = {
    blending: config.blending,
    texture: config.texture || 'default',
    color: config.color,
    colorEnd: config.colorEnd,
    colorVariation: config.colorVariation,
    size: config.size,
    sizeVariation: config.sizeVariation,
    lifetime: config.lifetime,
    lifetimeVariation: config.lifetimeVariation,
    gravity: config.gravity,
    drag: config.drag,
    dragRate: -Math.log(config.drag),
    spread: config.spread,
    vx: config.velocity.x,
    vy: config.velocity.y,
    vz: config.velocity.z,
    velocityVariation: config.velocityVariation,
    turbulence: config.turbulence,
    rotationSpeed: config.rotationSpeed,
    windX: config.wind ? config.wind.x : 0,
    windZ: config.wind ? config.wind.z : 0,
    expandRate: config.expand ? 2.0 : 0,
    sizeK0: 1,
    sizeK1: 0,
    groundMode: GROUND_MODE_NONE,
  };

  if (config.bounce) out.groundMode = GROUND_MODE_BOUNCE;
  if (config.splatter) out.groundMode = GROUND_MODE_SPLATTER;

  const curve = config.sizeCurve;
  if (curve) {
    out.sizeK0 = curve(0);
    out.sizeK1 = curve(1) - curve(0);
  }

  out.cr = out.color.r;
  out.cg = out.color.g;
  out.cb = out.color.b;
  out.er = out.colorEnd.r;
  out.eg = out.colorEnd.g;
  out.eb = out.colorEnd.b;

  return out;
}

const PARTICLE_TYPES = {
  blood: finalize({
    color: new THREE.Color(0x8B0000),
    colorEnd: new THREE.Color(0x1A0000),
    colorVariation: 0.2,
    size: 0.1,
    sizeVariation: 0.5,
    lifetime: 0.6,
    lifetimeVariation: 0.3,
    gravity: -12.0,
    drag: 0.96,
    spread: 1.0,
    velocity: new THREE.Vector3(0, 2, 0),
    velocityVariation: 2.0,
    blending: THREE.NormalBlending,
    splatter: true,
    turbulence: 0.5,
    rotationSpeed: 0,
    sizeCurve: (t) => 1.0 - t * 0.3,
    texture: 'default',
  }),
  dust: finalize({
    color: new THREE.Color(0xC4A882),
    colorEnd: new THREE.Color(0x8B7355),
    colorVariation: 0.2,
    size: 0.15,
    sizeVariation: 0.6,
    lifetime: 2.5,
    lifetimeVariation: 0.8,
    gravity: -0.3,
    drag: 0.95,
    spread: 0.5,
    velocity: new THREE.Vector3(0, 0.5, 0),
    velocityVariation: 0.5,
    blending: THREE.NormalBlending,
    wind: new THREE.Vector3(0.5, 0, 0.2),
    turbulence: 0.3,
    rotationSpeed: 2,
    sizeCurve: (t) => 0.5 + (1 - t) * 1.0,
    texture: 'default',
  }),
  sparks: finalize({
    color: new THREE.Color(0xFFDD44),
    colorEnd: new THREE.Color(0xFF4400),
    colorVariation: 0.3,
    size: 0.04,
    sizeVariation: 0.3,
    lifetime: 0.4,
    lifetimeVariation: 0.5,
    gravity: -12.0,
    drag: 0.99,
    spread: 1.0,
    velocity: new THREE.Vector3(0, 3, 0),
    velocityVariation: 4.0,
    blending: THREE.AdditiveBlending,
    turbulence: 0.2,
    rotationSpeed: 0,
    sizeCurve: (t) => 1.0 - t * 0.5,
    texture: 'default',
  }),
  smoke: finalize({
    color: new THREE.Color(0x666666),
    colorEnd: new THREE.Color(0x222222),
    colorVariation: 0.15,
    size: 0.5,
    sizeVariation: 0.5,
    lifetime: 3.0,
    lifetimeVariation: 0.6,
    gravity: 0.8,
    drag: 0.97,
    spread: 0.3,
    velocity: new THREE.Vector3(0, 1.5, 0),
    velocityVariation: 0.5,
    blending: THREE.NormalBlending,
    expand: true,
    turbulence: 0.4,
    rotationSpeed: 1,
    sizeCurve: (t) => 0.3 + (1 - t) * 2.5,
    texture: 'smoke',
  }),
  debris: finalize({
    color: new THREE.Color(0x555555),
    colorEnd: new THREE.Color(0x222222),
    colorVariation: 0.2,
    size: 0.06,
    sizeVariation: 0.7,
    lifetime: 1.5,
    lifetimeVariation: 0.5,
    gravity: -15.0,
    drag: 0.995,
    spread: 1.0,
    velocity: new THREE.Vector3(0, 5, 0),
    velocityVariation: 3.0,
    blending: THREE.NormalBlending,
    bounce: true,
    turbulence: 0.1,
    rotationSpeed: 8,
    sizeCurve: (t) => 1.0,
    texture: 'default',
  }),
  muzzleSmoke: finalize({
    color: new THREE.Color(0xDDDDDD),
    colorEnd: new THREE.Color(0x888888),
    colorVariation: 0.1,
    size: 0.2,
    sizeVariation: 0.4,
    lifetime: 0.6,
    lifetimeVariation: 0.3,
    gravity: 0.5,
    drag: 0.92,
    spread: 0.4,
    velocity: new THREE.Vector3(0, 1, 0),
    velocityVariation: 0.8,
    blending: THREE.NormalBlending,
    expand: true,
    turbulence: 0.6,
    rotationSpeed: 3,
    sizeCurve: (t) => 0.3 + (1 - t) * 1.5,
    texture: 'smoke',
  }),
  fire: finalize({
    color: new THREE.Color(0xFFAA00),
    colorEnd: new THREE.Color(0xFF2200),
    colorVariation: 0.3,
    size: 0.3,
    sizeVariation: 0.5,
    lifetime: 0.5,
    lifetimeVariation: 0.4,
    gravity: 2.0,
    drag: 0.94,
    spread: 0.8,
    velocity: new THREE.Vector3(0, 2, 0),
    velocityVariation: 1.5,
    blending: THREE.AdditiveBlending,
    turbulence: 0.8,
    rotationSpeed: 4,
    sizeCurve: (t) => 0.3 + (1 - t) * 1.5,
    texture: 'fire',
  }),
  ember: finalize({
    color: new THREE.Color(0xFFCC44),
    colorEnd: new THREE.Color(0xFF3300),
    colorVariation: 0.2,
    size: 0.03,
    sizeVariation: 0.4,
    lifetime: 1.5,
    lifetimeVariation: 0.6,
    gravity: -2.0,
    drag: 0.98,
    spread: 1.0,
    velocity: new THREE.Vector3(0, 4, 0),
    velocityVariation: 3.0,
    blending: THREE.AdditiveBlending,
    turbulence: 1.0,
    rotationSpeed: 0,
    sizeCurve: (t) => 1.0 - t * 0.3,
    texture: 'fire',
  }),
  muzzleFlash: finalize({
    color: new THREE.Color(0xFFFFCC),
    colorEnd: new THREE.Color(0xFF8800),
    colorVariation: 0.1,
    size: 0.15,
    sizeVariation: 0.3,
    lifetime: 0.08,
    lifetimeVariation: 0.2,
    gravity: 0,
    drag: 1.0,
    spread: 0.5,
    velocity: new THREE.Vector3(0, 0, 0),
    velocityVariation: 0.5,
    blending: THREE.AdditiveBlending,
    turbulence: 0,
    rotationSpeed: 0,
    sizeCurve: (t) => 1.0 - t * 0.8,
    texture: 'fire',
  }),
  tracer: finalize({
    color: new THREE.Color(0xFFDD88),
    colorEnd: new THREE.Color(0xFF6600),
    colorVariation: 0.1,
    size: 0.02,
    sizeVariation: 0.2,
    lifetime: 0.15,
    lifetimeVariation: 0.3,
    gravity: 0,
    drag: 1.0,
    spread: 0.1,
    velocity: new THREE.Vector3(0, 0, 0),
    velocityVariation: 0.1,
    blending: THREE.AdditiveBlending,
    turbulence: 0,
    rotationSpeed: 0,
    sizeCurve: (t) => 1.0,
    texture: 'default',
  }),
  shellCasing: finalize({
    color: new THREE.Color(0xDAA520),
    colorEnd: new THREE.Color(0x8B6914),
    colorVariation: 0.1,
    size: 0.03,
    sizeVariation: 0.2,
    lifetime: 1.0,
    lifetimeVariation: 0.3,
    gravity: -12.0,
    drag: 0.99,
    spread: 0.3,
    velocity: new THREE.Vector3(2, 3, 0),
    velocityVariation: 1.0,
    blending: THREE.NormalBlending,
    bounce: true,
    turbulence: 0.1,
    rotationSpeed: 15,
    sizeCurve: (t) => 1.0,
    texture: 'default',
  }),
  bloodMist: finalize({
    color: new THREE.Color(0xAA0000),
    colorEnd: new THREE.Color(0x330000),
    colorVariation: 0.15,
    size: 0.06,
    sizeVariation: 0.5,
    lifetime: 0.4,
    lifetimeVariation: 0.3,
    gravity: -8.0,
    drag: 0.95,
    spread: 1.2,
    velocity: new THREE.Vector3(0, 1, 0),
    velocityVariation: 1.5,
    blending: THREE.NormalBlending,
    turbulence: 0.3,
    rotationSpeed: 0,
    sizeCurve: (t) => 0.5 + (1 - t) * 1.0,
    texture: 'default',
  }),
  glass: finalize({
    color: new THREE.Color(0xCCDDFF),
    colorEnd: new THREE.Color(0x6688AA),
    colorVariation: 0.1,
    size: 0.04,
    sizeVariation: 0.6,
    lifetime: 1.2,
    lifetimeVariation: 0.4,
    gravity: -14.0,
    drag: 0.99,
    spread: 1.2,
    velocity: new THREE.Vector3(0, 4, 0),
    velocityVariation: 3.0,
    blending: THREE.NormalBlending,
    bounce: true,
    turbulence: 0.1,
    rotationSpeed: 12,
    sizeCurve: (t) => 1.0,
    texture: 'default',
  }),
  water: finalize({
    color: new THREE.Color(0x4488CC),
    colorEnd: new THREE.Color(0x224466),
    colorVariation: 0.15,
    size: 0.05,
    sizeVariation: 0.4,
    lifetime: 0.5,
    lifetimeVariation: 0.3,
    gravity: -16.0,
    drag: 0.98,
    spread: 0.8,
    velocity: new THREE.Vector3(0, 3, 0),
    velocityVariation: 2.0,
    blending: THREE.NormalBlending,
    splatter: true,
    turbulence: 0.2,
    rotationSpeed: 0,
    sizeCurve: (t) => 1.0 - t * 0.5,
    texture: 'default',
  }),
  rain: finalize({
    color: new THREE.Color(0xAABBDD),
    colorEnd: new THREE.Color(0x667788),
    colorVariation: 0.1,
    size: 0.02,
    sizeVariation: 0.2,
    lifetime: 1.0,
    lifetimeVariation: 0.2,
    gravity: -20.0,
    drag: 1.0,
    spread: 0.05,
    velocity: new THREE.Vector3(0, -15, 0),
    velocityVariation: 1.0,
    blending: THREE.NormalBlending,
    turbulence: 0,
    rotationSpeed: 0,
    sizeCurve: (t) => 1.0,
    texture: 'default',
  }),
  snow: finalize({
    color: new THREE.Color(0xFFFFFF),
    colorEnd: new THREE.Color(0xCCDDEE),
    colorVariation: 0.05,
    size: 0.04,
    sizeVariation: 0.5,
    lifetime: 4.0,
    lifetimeVariation: 1.0,
    gravity: -1.5,
    drag: 0.99,
    spread: 0.3,
    velocity: new THREE.Vector3(0, -0.5, 0),
    velocityVariation: 0.3,
    blending: THREE.NormalBlending,
    turbulence: 0.8,
    rotationSpeed: 2,
    sizeCurve: (t) => 1.0 - t * 0.3,
    texture: 'default',
  }),
  trail: finalize({
    color: new THREE.Color(0xFFAA44),
    colorEnd: new THREE.Color(0xFF4400),
    colorVariation: 0.2,
    size: 0.08,
    sizeVariation: 0.3,
    lifetime: 0.3,
    lifetimeVariation: 0.3,
    gravity: 0,
    drag: 1.0,
    spread: 0.2,
    velocity: new THREE.Vector3(0, 0, 0),
    velocityVariation: 0.2,
    blending: THREE.AdditiveBlending,
    turbulence: 0,
    rotationSpeed: 0,
    sizeCurve: (t) => 1.0 - t * 0.5,
    texture: 'fire',
  }),
};

const SIN_LUT_SIZE = 512;
const SIN_LUT_SCALE = SIN_LUT_SIZE / (Math.PI * 2);
const SIN_LUT = new Float32Array(SIN_LUT_SIZE);
for (let i = 0; i < SIN_LUT_SIZE; i++) SIN_LUT[i] = Math.sin(i / SIN_LUT_SCALE);

const vertexShader = `
  attribute vec3 aColor;
  attribute vec2 aSizeLife;

  uniform float uMaxPointSize;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = aColor;
    vAlpha = min(aSizeLife.y * 2.0, 1.0);

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float attenuation = 300.0 / max(-mvPosition.z, 0.001);
    gl_PointSize = min(aSizeLife.x * attenuation, uMaxPointSize);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
  uniform sampler2D uTexture;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec4 tex = texture2D(uTexture, gl_PointCoord);
    if (vAlpha < 0.01) discard;
    gl_FragColor = vec4(vColor * tex.rgb, vAlpha * tex.a);
  }
`;

const DRAG_RATES = [];
for (const typeKey in PARTICLE_TYPES) {
  const cfg = PARTICLE_TYPES[typeKey];
  let idx = -1;
  for (let i = 0; i < DRAG_RATES.length; i++) {
    if (DRAG_RATES[i] === cfg.dragRate) {
      idx = i;
      break;
    }
  }
  if (idx < 0) {
    idx = DRAG_RATES.length;
    DRAG_RATES.push(cfg.dragRate);
  }
  cfg.dragIdx = idx;
}
const DRAG_LUT = new Float32Array(DRAG_RATES.length);
const HAS_PARTIAL_UPLOAD = typeof THREE.BufferAttribute.prototype.addUpdateRange === 'function';

class ParticleSubSystem {
  constructor(scene, blending, capacity, maxPointSize) {
    this.capacity = capacity;
    this.activeCount = 0;
    this.freeCount = capacity;
    this.emitCap = 64;
    this.time = 0;
    this.dirty = false;

    const cap = capacity;

    this.posX = new Float32Array(cap);
    this.posY = new Float32Array(cap);
    this.posZ = new Float32Array(cap);
    this.velX = new Float32Array(cap);
    this.velY = new Float32Array(cap);
    this.velZ = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.baseSize = new Float32Array(cap);
    this.sizeK0 = new Float32Array(cap);
    this.sizeK1 = new Float32Array(cap);
    this.expandRate = new Float32Array(cap);
    this.sizeMul = new Float32Array(cap);
    this.gravity = new Float32Array(cap);
    this.dragIdx = new Uint8Array(cap);
    this.turbulence = new Float32Array(cap);
    this.windX = new Float32Array(cap);
    this.windZ = new Float32Array(cap);
    this.colR = new Float32Array(cap);
    this.colG = new Float32Array(cap);
    this.colB = new Float32Array(cap);
    this.colER = new Float32Array(cap);
    this.colEG = new Float32Array(cap);
    this.colEB = new Float32Array(cap);
    this.groundMode = new Uint8Array(cap);

    this.order = new Int32Array(cap);
    this.free = new Int32Array(cap);
    for (let i = 0; i < cap; i++) {
      this.order[i] = i;
      this.free[i] = cap - 1 - i;
    }

    this.attrPos = new Float32Array(cap * 3);
    this.attrColor = new Float32Array(cap * 3);
    this.attrSizeLife = new Float32Array(cap * 2);

    this.geometry = new THREE.BufferGeometry();
    this.aPosition = new THREE.BufferAttribute(this.attrPos, 3);
    this.aColor = new THREE.BufferAttribute(this.attrColor, 3);
    this.aSizeLife = new THREE.BufferAttribute(this.attrSizeLife, 2);

    this.aPosition.setUsage(THREE.DynamicDrawUsage);
    this.aColor.setUsage(THREE.DynamicDrawUsage);
    this.aSizeLife.setUsage(THREE.DynamicDrawUsage);

    this.geometry.setAttribute('position', this.aPosition);
    this.geometry.setAttribute('aColor', this.aColor);
    this.geometry.setAttribute('aSizeLife', this.aSizeLife);
    this.geometry.setDrawRange(0, 0);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: blending,
      uniforms: {
        uTexture: { value: PARTICLE_TEXTURES.default },
        uMaxPointSize: { value: maxPointSize },
      },
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  setMaxPointSize(v) {
    this.material.uniforms.uMaxPointSize.value = v;
  }

  emit(cfg, px, py, pz, count, oVx, oVy, oVz, oSpread, oLifetime, oSize) {
    const cap = this.capacity;
    if (cap === 0) return;

    let n = count | 0;
    if (n <= 0) return;
    const emitCap = this.emitCap;
    if (emitCap > 0 && n > emitCap) n = emitCap;
    if (n > cap) n = cap;

    const vSpread = cfg.velocityVariation * (oSpread !== undefined ? oSpread : cfg.spread);
    const lifeBase = oLifetime !== undefined ? oLifetime : cfg.lifetime;
    const sizeBase = oSize !== undefined ? oSize : cfg.size;
    const vx0 = oVx !== undefined ? oVx : cfg.vx;
    const vy0 = oVy !== undefined ? oVy : cfg.vy;
    const vz0 = oVz !== undefined ? oVz : cfg.vz;

    const posX = this.posX, posY = this.posY, posZ = this.posZ;
    const velX = this.velX, velY = this.velY, velZ = this.velZ;
    const life = this.life, maxLife = this.maxLife;
    const baseSize = this.baseSize, sizeK0 = this.sizeK0, sizeK1 = this.sizeK1;
    const expandRate = this.expandRate, sizeMul = this.sizeMul;
    const gravity = this.gravity, dragIdx = this.dragIdx;
    const turbulence = this.turbulence, windX = this.windX, windZ = this.windZ;
    const colR = this.colR, colG = this.colG, colB = this.colB;
    const colER = this.colER, colEG = this.colEG, colEB = this.colEB;
    const groundMode = this.groundMode;
    const order = this.order, free = this.free;

    const cr = cfg.cr, cg = cfg.cg, cb = cfg.cb;
    const er = cfg.er, eg = cfg.eg, eb = cfg.eb;
    const gm = cfg.groundMode;
    const exp = cfg.expandRate;
    const g = cfg.gravity;
    const dr = cfg.dragIdx;
    const tb = cfg.turbulence;
    const wx = cfg.windX, wz = cfg.windZ;
    const k0 = cfg.sizeK0, k1 = cfg.sizeK1;
    const cvar = cfg.colorVariation;
    const svar = cfg.sizeVariation;
    const lvar = cfg.lifetimeVariation;

    let fc = this.freeCount;
    let ac = this.activeCount;

    for (let i = 0; i < n; i++) {
      let s;
      if (fc > 0) {
        fc--;
        s = free[fc];
      } else {
        if (ac === 0) break;
        s = order[0];
        ac--;
        order[0] = order[ac];
        order[ac] = s;
      }

      posX[s] = px + (Math.random() - 0.5) * 0.1;
      posY[s] = py + (Math.random() - 0.5) * 0.1;
      posZ[s] = pz + (Math.random() - 0.5) * 0.1;

      velX[s] = vx0 + (Math.random() - 0.5) * vSpread;
      velY[s] = vy0 + (Math.random() - 0.5) * vSpread;
      velZ[s] = vz0 + (Math.random() - 0.5) * vSpread;

      const colorVar = 1.0 + (Math.random() - 0.5) * cvar;
      colR[s] = cr * colorVar;
      colG[s] = cg * colorVar;
      colB[s] = cb * colorVar;
      colER[s] = er * colorVar;
      colEG[s] = eg * colorVar;
      colEB[s] = eb * colorVar;

      baseSize[s] = sizeBase * (1.0 + (Math.random() - 0.5) * svar);
      sizeK0[s] = k0;
      sizeK1[s] = k1;
      expandRate[s] = exp;
      sizeMul[s] = 1;

      const ml = lifeBase * (1.0 + (Math.random() - 0.5) * lvar);
      maxLife[s] = ml;
      life[s] = ml;

      gravity[s] = g;
      dragIdx[s] = dr;
      turbulence[s] = tb;
      windX[s] = wx;
      windZ[s] = wz;
      groundMode[s] = gm;

      order[ac++] = s;
    }

    this.freeCount = fc;
    this.activeCount = ac;
    this.dirty = true;
  }

  update(dt) {
    this.time += dt;
    const order = this.order;
    const total = this.activeCount;
    if (total === 0) {
      if (this.dirty) this._flush();
      return;
    }

    const dragCount = DRAG_RATES.length;
    for (let i = 0; i < dragCount; i++) {
      DRAG_LUT[i] = Math.exp(-DRAG_RATES[i] * dt);
    }

    const time = this.time;
    const t3 = time * 3;
    const t25 = time * 2.5;

    const posX = this.posX, posY = this.posY, posZ = this.posZ;
    const velX = this.velX, velY = this.velY, velZ = this.velZ;
    const life = this.life, maxLife = this.maxLife;
    const baseSize = this.baseSize, sizeK0 = this.sizeK0, sizeK1 = this.sizeK1;
    const expandRate = this.expandRate, sizeMul = this.sizeMul;
    const gravity = this.gravity, dragIdx = this.dragIdx;
    const turbulence = this.turbulence, windX = this.windX, windZ = this.windZ;
    const colR = this.colR, colG = this.colG, colB = this.colB;
    const colER = this.colER, colEG = this.colEG, colEB = this.colEB;
    const groundMode = this.groundMode;
    const free = this.free;
    const dragLut = DRAG_LUT;
    const sinLut = SIN_LUT;
    const lutMask = SIN_LUT_SIZE - 1;

    const outPos = this.attrPos;
    const outCol = this.attrColor;
    const outSizeLife = this.attrSizeLife;

    const expandStep = dt * 2.0;
    const sizeStretch = dt * 0.04;

    let w = 0;
    let freeCount = this.freeCount;

    for (let i = 0; i < total; i++) {
      const s = order[i];
      let l = life[s] - dt;
      if (l <= 0) {
        free[freeCount++] = s;
        continue;
      }
      life[s] = l;

      let vx = velX[s];
      let vy = velY[s] + gravity[s] * dt;
      let vz = velZ[s];

      const dragF = dragLut[dragIdx[s]];
      vx *= dragF;
      vy *= dragF;
      vz *= dragF;

      const tb = turbulence[s];
      if (tb !== 0) {
        const py = posY[s];
        const px = posX[s];
        let a = (t3 + py * 2) % SIN_LUT_SIZE;
        if (a < 0) a += SIN_LUT_SIZE;
        vx += sinLut[(a | 0) & lutMask] * tb * dt;
        let b = (t25 + px * 2) % SIN_LUT_SIZE;
        if (b < 0) b += SIN_LUT_SIZE;
        vz += sinLut[(b | 0) & lutMask] * tb * dt;
      }

      const wxa = windX[s];
      const wza = windZ[s];
      if (wxa !== 0) vx += wxa * dt;
      if (wza !== 0) vz += wza * dt;

      velX[s] = vx;
      velY[s] = vy;
      velZ[s] = vz;

      let y = posY[s] + vy * dt;
      const x = posX[s] + vx * dt;
      const z = posZ[s] + vz * dt;

      if (y < 0.02) {
        const mode = groundMode[s];
        y = 0.02;
        if (mode === GROUND_MODE_BOUNCE) {
          vy *= -0.4;
          velX[s] = vx * 0.7;
          velZ[s] = vz * 0.7;
          velY[s] = vy;
        } else if (mode === GROUND_MODE_SPLATTER) {
          l = l < 0.3 ? l : 0.3;
          life[s] = l;
          velX[s] = 0;
          velY[s] = 0;
          velZ[s] = 0;
        } else {
          velY[s] = 0;
          velX[s] = vx * 0.9;
          velZ[s] = vz * 0.9;
        }
      }

      posX[s] = x;
      posY[s] = y;
      posZ[s] = z;

      const ml = maxLife[s];
      const t = ml > 0 ? l / ml : 0;

      let size = baseSize[s] * (sizeK0[s] + sizeK1[s] * t);
      const er = expandRate[s];
      if (er !== 0) {
        const m = sizeMul[s] * (1.0 + er * expandStep);
        sizeMul[s] = m;
        size *= m;
      }

      const speed2 = vx * vx + vy * vy + vz * vz;

      const o3 = w * 3;
      const o2 = w * 2;
      outPos[o3] = x;
      outPos[o3 + 1] = y;
      outPos[o3 + 2] = z;
      outCol[o3] = colER[s] + (colR[s] - colER[s]) * t;
      outCol[o3 + 1] = colEG[s] + (colG[s] - colEG[s]) * t;
      outCol[o3 + 2] = colEB[s] + (colB[s] - colEB[s]) * t;
      outSizeLife[o2] = size * (1.0 + Math.sqrt(speed2) * sizeStretch);
      outSizeLife[o2 + 1] = t;

      order[w++] = s;
    }

    this.activeCount = w;
    this.freeCount = freeCount;
    this.dirty = true;
    this._flush();
  }

  _flush() {
    const w = this.activeCount;
    this.geometry.setDrawRange(0, w);
    if (w > 0) {
      if (HAS_PARTIAL_UPLOAD) {
        this.aPosition.clearUpdateRanges();
        this.aPosition.addUpdateRange(0, w * 3);
        this.aColor.clearUpdateRanges();
        this.aColor.addUpdateRange(0, w * 3);
        this.aSizeLife.clearUpdateRanges();
        this.aSizeLife.addUpdateRange(0, w * 2);
      }
      this.aPosition.needsUpdate = true;
      this.aColor.needsUpdate = true;
      this.aSizeLife.needsUpdate = true;
    }
    this.dirty = false;
  }

  setTexture(textureName) {
    const tex = PARTICLE_TEXTURES[textureName] || PARTICLE_TEXTURES.default;
    const current = this.material.uniforms.uTexture.value;
    if (current !== tex) this.material.uniforms.uTexture.value = tex;
  }

  trimTo(count) {
    const total = this.activeCount;
    if (count >= total) return;
    const drop = total - count;
    if (drop <= 0) return;
    const order = this.order, free = this.free;
    let fc = this.freeCount;
    for (let i = 0; i < drop; i++) free[fc++] = order[i];
    let w = 0;
    for (let i = drop; i < total; i++) order[w++] = order[i];
    this.freeCount = fc;
    this.activeCount = w;
    this.dirty = true;
    this._flush();
  }

  clear() {
    this.activeCount = 0;
    this.freeCount = this.capacity;
    for (let i = 0; i < this.capacity; i++) {
      this.order[i] = i;
      this.free[i] = this.capacity - 1 - i;
    }
    this.geometry.setDrawRange(0, 0);
  }

  dispose(scene) {
    scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class ParticleSystem {
  constructor(scene, quality = DEFAULT_QUALITY) {
    this.scene = scene;
    this.quality = quality;

    const cap = Math.max(0, quality.maxParticles | 0);
    const additiveCap = cap > 1 ? Math.max(1, Math.floor(cap * 0.45)) : cap;
    const normalCap = cap - additiveCap;
    this.additiveCapacity = additiveCap;
    this.normalCapacity = normalCap;
    this.maxParticles = additiveCap + normalCap;
    this.budget = this.maxParticles;

    const maxPointSize = Math.max(16, Math.min(96, Math.round(96 * (quality.renderScale || 0.7) + 24)));
    this.maxPointSize = maxPointSize;

    this.additiveSystem = new ParticleSubSystem(scene, THREE.AdditiveBlending, additiveCap, maxPointSize);
    this.normalSystem = new ParticleSubSystem(scene, THREE.NormalBlending, normalCap, maxPointSize);

    this.emitCap = 1;
    this.dustCap = 1;
    this._applyBudget(quality);
    this.activeCount = 0;
  }

  _applyBudget(quality) {
    const requested = Math.max(0, quality.maxParticles | 0);
    const cap = Math.min(requested, this.maxParticles);
    this.budget = cap;
    this.emitCap = Math.max(1, Math.floor(cap * 0.12));
    this.dustCap = quality.dustParticles > 0 ? this.emitCap : Math.max(4, Math.floor(this.emitCap * 0.5));
    const mps = Math.max(16, Math.min(96, Math.round(96 * (quality.renderScale || 0.7) + 24)));
    this.additiveSystem.setMaxPointSize(mps);
    this.normalSystem.setMaxPointSize(mps);
    const additiveWant = Math.min(this.additiveCapacity, Math.floor(cap * 0.45));
    const normalWant = Math.min(this.normalCapacity, cap - additiveWant);
    this.additiveBudget = additiveWant;
    this.normalBudget = normalWant;
    this.additiveSystem.trimTo(additiveWant);
    this.normalSystem.trimTo(normalWant);
    this.activeCount = this.additiveSystem.activeCount + this.normalSystem.activeCount;
  }

  setQuality(quality) {
    this.quality = quality;
    this._applyBudget(quality);
  }

  emit(type, position, count, options) {
    const cfg = PARTICLE_TYPES[type];
    if (!cfg) return;

    const additive = cfg.blending === THREE.AdditiveBlending;
    const system = additive ? this.additiveSystem : this.normalSystem;
    if (system.capacity === 0) return;

    const budget = additive ? this.additiveBudget : this.normalBudget;
    const avail = budget - system.activeCount;
    if (avail <= 0) return;
    if (count > avail) count = avail;
    if (count <= 0) return;

    system.setTexture(cfg.texture);
    system.emitCap = type === 'dust' || type === 'snow' || type === 'rain'
      ? this.dustCap
      : this.emitCap;

    let oVx;
    let oVy;
    let oVz;
    let oSpread;
    let oLifetime;
    let oSize;

    if (options) {
      const ov = options.velocity;
      if (typeof ov === 'number') {
        oVy = ov;
        oVx = 0;
        oVz = 0;
      } else if (ov) {
        oVx = ov.x;
        oVy = ov.y;
        oVz = ov.z;
      }
      if (options.spread !== undefined) oSpread = options.spread;
      if (options.lifetime !== undefined) oLifetime = options.lifetime;
      if (options.size !== undefined) oSize = options.size;
    }

    system.emit(cfg, position.x, position.y, position.z, count, oVx, oVy, oVz, oSpread, oLifetime, oSize);
  }

  update(dt) {
    this.additiveSystem.update(dt);
    this.normalSystem.update(dt);
    this.activeCount = this.additiveSystem.activeCount + this.normalSystem.activeCount;
  }

  getActiveCount() {
    return this.activeCount;
  }

  getBudget() {
    return this.budget;
  }

  clear() {
    this.additiveSystem.clear();
    this.normalSystem.clear();
    this.activeCount = 0;
  }

  dispose() {
    this.additiveSystem.dispose(this.scene);
    this.normalSystem.dispose(this.scene);
  }
}