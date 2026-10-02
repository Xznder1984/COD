import * as THREE from 'three';

function createCanvas(width, height) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

function noise2D(x, y, seed = 0) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 43.12) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const a = noise2D(ix, iy, seed);
  const b = noise2D(ix + 1, iy, seed);
  const c = noise2D(ix, iy + 1, seed);
  const d = noise2D(ix + 1, iy + 1, seed);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x, y, octaves, seed) {
  let val = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += amp * smoothNoise(x * freq, y * freq, seed + i);
    amp *= 0.5;
    freq *= 2;
  }
  return val;
}

export class AssetFactory {
  constructor() {
    this.cache = new Map();
  }

  concreteTexture(size = 512, seed = 42) {
    const key = `concrete_${size}_${seed}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x * 0.02, y * 0.02, 6, seed);
        const n2 = fbm(x * 0.1, y * 0.1, 4, seed + 100);
        const crack = smoothNoise(x * 0.05, y * 0.05, seed + 200) > 0.7 ? 0.7 : 1.0;
        const val = Math.floor((n * 0.6 + n2 * 0.4) * 200 * crack + 30);
        const idx = (y * size + x) * 4;
        imageData.data[idx] = val;
        imageData.data[idx + 1] = val;
        imageData.data[idx + 2] = val * 0.95;
        imageData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    this.cache.set(key, tex);
    return tex;
  }

  metalTexture(size = 512, seed = 7) {
    const key = `metal_${size}_${seed}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x * 0.01, y * 0.05, 4, seed);
        const scratch = smoothNoise(x * 0.3, y * 0.01, seed + 50) > 0.8 ? 0.6 : 1.0;
        const val = Math.floor(n * 180 * scratch + 40);
        const idx = (y * size + x) * 4;
        imageData.data[idx] = val;
        imageData.data[idx + 1] = val + 5;
        imageData.data[idx + 2] = val + 10;
        imageData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    this.cache.set(key, tex);
    return tex;
  }

  woodTexture(size = 512, seed = 13) {
    const key = `wood_${size}_${seed}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const ring = Math.sin((x + fbm(x * 0.01, y * 0.01, 3, seed) * 50) * 0.1) * 0.5 + 0.5;
        const grain = fbm(x * 0.005, y * 0.1, 4, seed + 10);
        const val = Math.floor(ring * 100 + grain * 80 + 40);
        const idx = (y * size + x) * 4;
        imageData.data[idx] = val + 30;
        imageData.data[idx + 1] = val * 0.7;
        imageData.data[idx + 2] = val * 0.4;
        imageData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    this.cache.set(key, tex);
    return tex;
  }

  camoTexture(size = 512, seed = 99) {
    const key = `camo_${size}_${seed}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(size, size);
    const colors = [
      [87, 96, 68], [62, 73, 53], [107, 110, 88], [45, 52, 40], [130, 125, 100]
    ];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x * 0.015, y * 0.015, 5, seed);
        const colorIdx = Math.floor(n * colors.length) % colors.length;
        const c = colors[colorIdx];
        const variation = fbm(x * 0.1, y * 0.1, 3, seed + 200) * 30 - 15;
        const idx = (y * size + x) * 4;
        imageData.data[idx] = c[0] + variation;
        imageData.data[idx + 1] = c[1] + variation;
        imageData.data[idx + 2] = c[2] + variation;
        imageData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    this.cache.set(key, tex);
    return tex;
  }

  normalMapFromHeight(size = 512, seed = 42, strength = 2) {
    const key = `normal_${size}_${seed}_${strength}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(size, size);
    const heightData = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        heightData[y * size + x] = fbm(x * 0.02, y * 0.02, 6, seed);
      }
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const left = heightData[y * size + ((x - 1 + size) % size)];
        const right = heightData[y * size + ((x + 1) % size)];
        const up = heightData[((y - 1 + size) % size) * size + x];
        const down = heightData[((y + 1) % size) * size + x];
        const dx = (right - left) * strength;
        const dy = (down - up) * strength;
        const len = Math.sqrt(dx * dx + dy * dy + 1);
        const idx = (y * size + x) * 4;
        imageData.data[idx] = Math.floor(((-dx / len) * 0.5 + 0.5) * 255);
        imageData.data[idx + 1] = Math.floor(((-dy / len) * 0.5 + 0.5) * 255);
        imageData.data[idx + 2] = Math.floor((1 / len * 0.5 + 0.5) * 255);
        imageData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    this.cache.set(key, tex);
    return tex;
  }

  roughnessMap(size = 256, seed = 42, base = 0.5, variation = 0.3) {
    const key = `rough_${size}_${seed}_${base}_${variation}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x * 0.05, y * 0.05, 4, seed);
        const val = Math.floor((base + (n - 0.5) * variation) * 255);
        const idx = (y * size + x) * 4;
        imageData.data[idx] = val;
        imageData.data[idx + 1] = val;
        imageData.data[idx + 2] = val;
        imageData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    this.cache.set(key, tex);
    return tex;
  }

  createMaterial(type, options = {}) {
    const opts = { repeat: [1, 1], ...options };
    switch (type) {
      case 'concrete': {
        const map = this.concreteTexture(512, opts.seed || 42);
        map.repeat.set(opts.repeat[0], opts.repeat[1]);
        const normalMap = this.normalMapFromHeight(512, opts.seed || 42, 2);
        normalMap.repeat.set(opts.repeat[0], opts.repeat[1]);
        const roughnessMap = this.roughnessMap(256, opts.seed || 42, 0.8, 0.2);
        roughnessMap.repeat.set(opts.repeat[0], opts.repeat[1]);
        return new THREE.MeshStandardMaterial({
          map, normalMap, roughnessMap,
          roughness: 0.9, metalness: 0.05,
          color: opts.color || 0xaaaaaa,
        });
      }
      case 'metal': {
        const map = this.metalTexture(512, opts.seed || 7);
        map.repeat.set(opts.repeat[0], opts.repeat[1]);
        const normalMap = this.normalMapFromHeight(512, opts.seed || 7, 1);
        normalMap.repeat.set(opts.repeat[0], opts.repeat[1]);
        const roughnessMap = this.roughnessMap(256, opts.seed || 7, 0.3, 0.3);
        roughnessMap.repeat.set(opts.repeat[0], opts.repeat[1]);
        return new THREE.MeshStandardMaterial({
          map, normalMap, roughnessMap,
          roughness: 0.35, metalness: 0.85,
          color: opts.color || 0x888899,
        });
      }
      case 'wood': {
        const map = this.woodTexture(512, opts.seed || 13);
        map.repeat.set(opts.repeat[0], opts.repeat[1]);
        const normalMap = this.normalMapFromHeight(512, opts.seed || 13, 1.5);
        normalMap.repeat.set(opts.repeat[0], opts.repeat[1]);
        return new THREE.MeshStandardMaterial({
          map, normalMap,
          roughness: 0.7, metalness: 0.0,
          color: opts.color || 0x8B6914,
        });
      }
      case 'camo': {
        const map = this.camoTexture(512, opts.seed || 99);
        map.repeat.set(opts.repeat[0], opts.repeat[1]);
        const normalMap = this.normalMapFromHeight(512, opts.seed || 99, 0.5);
        normalMap.repeat.set(opts.repeat[0], opts.repeat[1]);
        return new THREE.MeshStandardMaterial({
          map, normalMap,
          roughness: 0.85, metalness: 0.0,
          color: 0xffffff,
        });
      }
      case 'ground': {
        const map = this.concreteTexture(512, opts.seed || 77);
        map.repeat.set(opts.repeat[0] * 10, opts.repeat[1] * 10);
        const normalMap = this.normalMapFromHeight(512, opts.seed || 77, 3);
        normalMap.repeat.set(opts.repeat[0] * 10, opts.repeat[1] * 10);
        return new THREE.MeshStandardMaterial({
          map, normalMap,
          roughness: 0.95, metalness: 0.0,
          color: opts.color || 0x8B7355,
        });
      }
      default:
        return new THREE.MeshStandardMaterial({ color: 0x888888 });
    }
  }
}
