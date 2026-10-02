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

export class WeaponModels {
  constructor(assetFactory, quality) {
    this.assetFactory = assetFactory;
    this.quality = Object.assign({}, DEFAULT_QUALITY, quality || {});
    this.detail = Math.max(0, Math.min(2, this.quality.propDetail | 0));
    this.segments = this.detail === 0 ? 6 : (this.detail === 1 ? 10 : 14);
    this.bevelSegments = this.detail === 1 ? 1 : 2;
    this._geoCache = new Map();
    this.models = {};
    this.muzzlePositions = {};
    this._zeroMuzzle = new THREE.Vector3();
    this._buildMaterials();
    this._buildRifle();
    this._buildSMG();
    this._buildSniper();
    this._buildPistol();
  }

  _createNormalMap(size, scale) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    const imageData = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const nx = Math.sin(x * 0.1 * scale) * 0.5 + 0.5;
        const ny = Math.sin(y * 0.1 * scale) * 0.5 + 0.5;
        imageData.data[i] = nx * 255;
        imageData.data[i + 1] = ny * 255;
        imageData.data[i + 2] = 255;
        imageData.data[i + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  _createRoughnessMap(size, base, variation) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    const imageData = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const noise = (Math.random() - 0.5) * variation;
        const val = Math.max(0, Math.min(1, base + noise)) * 255;
        imageData.data[i] = val;
        imageData.data[i + 1] = val;
        imageData.data[i + 2] = val;
        imageData.data[i + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  _buildMaterials() {
    this.mats = {};

    if (this.detail === 0) {
      this.mats.gunmetal = new THREE.MeshStandardMaterial({ color: 0x4e4e58, metalness: 0.62, roughness: 0.34, envMapIntensity: 1.5 });
      this.mats.polymer = new THREE.MeshStandardMaterial({ color: 0x44444e, metalness: 0.08, roughness: 0.68, envMapIntensity: 1.3 });
      this.mats.wood = new THREE.MeshStandardMaterial({ color: 0x6d4726, metalness: 0.0, roughness: 0.58, envMapIntensity: 1.2 });
      this.mats.rubber = new THREE.MeshStandardMaterial({ color: 0x2e2e34, metalness: 0.0, roughness: 0.88, envMapIntensity: 1.2 });
      this.mats.brass = new THREE.MeshStandardMaterial({ color: 0xc8a84b, metalness: 0.95, roughness: 0.2 });
      this.mats.sightGlass = new THREE.MeshStandardMaterial({
        color: 0x3388ff, metalness: 0.9, roughness: 0.05, transparent: true, opacity: 0.6,
      });
      this.mats.darkMetal = this.mats.gunmetal;
      this.mats.sight = this.mats.gunmetal;
      this.mats.wornMetal = this.mats.gunmetal;
      this.mats.railCover = this.mats.polymer;
      this.mats.polymerLight = this.mats.polymer;
      this.mats.gripTexture = this.mats.polymer;
      return;
    }

    const size = Math.max(64, Math.min(512, this.quality.textureSize | 0));
    const normalMap = this._createNormalMap(size, 1.5);
    const fineNormalMap = this._createNormalMap(size, 3.0);
    const roughMap = this._createRoughnessMap(size, 0.4, 0.15);
    const polymerRoughMap = this._createRoughnessMap(size, 0.7, 0.2);

    this.mats.gunmetal = new THREE.MeshStandardMaterial({
      color: 0x50505c, metalness: 0.66, roughness: 0.3, envMapIntensity: 1.5,
      normalMap: fineNormalMap, normalScale: new THREE.Vector2(0.3, 0.3),
      roughnessMap: roughMap,
    });
    this.mats.darkMetal = new THREE.MeshStandardMaterial({
      color: 0x3c3c46, metalness: 0.6, roughness: 0.36, envMapIntensity: 1.5,
      normalMap: fineNormalMap, normalScale: new THREE.Vector2(0.25, 0.25),
      roughnessMap: roughMap,
    });
    this.mats.polymer = new THREE.MeshStandardMaterial({
      color: 0x44444e, metalness: 0.08, roughness: 0.68, envMapIntensity: 1.3,
      normalMap: normalMap, normalScale: new THREE.Vector2(0.5, 0.5),
      roughnessMap: polymerRoughMap,
    });
    this.mats.polymerLight = new THREE.MeshStandardMaterial({
      color: 0x54545e, metalness: 0.05, roughness: 0.63, envMapIntensity: 1.3,
      normalMap: normalMap, normalScale: new THREE.Vector2(0.4, 0.4),
      roughnessMap: polymerRoughMap,
    });
    this.mats.wood = new THREE.MeshStandardMaterial({
      color: 0x6d4726, metalness: 0.0, roughness: 0.58, envMapIntensity: 1.2,
      normalMap: normalMap, normalScale: new THREE.Vector2(0.6, 0.6),
    });
    this.mats.woodDark = new THREE.MeshStandardMaterial({
      color: 0x4d3117, metalness: 0.0, roughness: 0.55, envMapIntensity: 1.2,
      normalMap: normalMap, normalScale: new THREE.Vector2(0.5, 0.5),
    });
    this.mats.rubber = new THREE.MeshStandardMaterial({
      color: 0x2e2e34, metalness: 0.0, roughness: 0.88, envMapIntensity: 1.2,
      normalMap: normalMap, normalScale: new THREE.Vector2(0.8, 0.8),
    });
    this.mats.brass = new THREE.MeshStandardMaterial({
      color: 0xc8a84b, metalness: 0.95, roughness: 0.2,
      normalMap: fineNormalMap, normalScale: new THREE.Vector2(0.2, 0.2),
    });
    this.mats.sight = new THREE.MeshStandardMaterial({
      color: 0x2b2b33, metalness: 0.55, roughness: 0.22, envMapIntensity: 1.5,
      normalMap: fineNormalMap, normalScale: new THREE.Vector2(0.15, 0.15),
    });
    this.mats.sightGlass = new THREE.MeshStandardMaterial({
      color: 0x3388ff, metalness: 0.9, roughness: 0.05,
      transparent: true, opacity: 0.6,
    });
    this.mats.wornMetal = new THREE.MeshStandardMaterial({
      color: 0x3a3a3e, metalness: 0.8, roughness: 0.45,
      normalMap: fineNormalMap, normalScale: new THREE.Vector2(0.35, 0.35),
      roughnessMap: roughMap,
    });
    this.mats.gripTexture = new THREE.MeshStandardMaterial({
      color: 0x252528, metalness: 0.0, roughness: 0.85,
      normalMap: normalMap, normalScale: new THREE.Vector2(0.7, 0.7),
    });
    this.mats.railCover = new THREE.MeshStandardMaterial({
      color: 0x333336, metalness: 0.05, roughness: 0.75,
      normalMap: normalMap, normalScale: new THREE.Vector2(0.4, 0.4),
    });
  }

  _boxGeo(w, h, d) {
    const k = `b|${w}|${h}|${d}`;
    let g = this._geoCache.get(k);
    if (!g) {
      g = new THREE.BoxGeometry(w, h, d);
      this._geoCache.set(k, g);
    }
    return g;
  }

  _cylGeo(rTop, rBot, h, seg) {
    const k = `c|${rTop}|${rBot}|${h}|${seg}`;
    let g = this._geoCache.get(k);
    if (!g) {
      g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
      this._geoCache.set(k, g);
    }
    return g;
  }

  _bevelGeo(w, h, d, bevel) {
    const k = `e|${w}|${h}|${d}|${bevel}|${this.bevelSegments}`;
    let g = this._geoCache.get(k);
    if (g) return g;
    const shape = new THREE.Shape();
    const hw = w / 2 - bevel;
    const hh = h / 2 - bevel;
    shape.moveTo(-hw, -h / 2);
    shape.lineTo(hw, -h / 2);
    shape.lineTo(w / 2, -hh);
    shape.lineTo(w / 2, hh);
    shape.lineTo(hw, h / 2);
    shape.lineTo(-hw, h / 2);
    shape.lineTo(-w / 2, hh);
    shape.lineTo(-w / 2, -hh);
    shape.closePath();
    g = new THREE.ExtrudeGeometry(shape, {
      depth: d - bevel * 2,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: this.bevelSegments,
    });
    g.translate(0, 0, -(d - bevel * 2) / 2);
    this._geoCache.set(k, g);
    return g;
  }

  _finish(mesh) {
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    return mesh;
  }

  _box(w, h, d, mat, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(this._boxGeo(w, h, d), mat);
    mesh.position.set(x, y, z);
    return this._finish(mesh);
  }

  _cyl(rTop, rBot, h, mat, x = 0, y = 0, z = 0, rotX = 0, rotZ = 0) {
    const mesh = new THREE.Mesh(this._cylGeo(rTop, rBot, h, this.segments), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rotX;
    mesh.rotation.z = rotZ;
    return this._finish(mesh);
  }

  _bevelBox(w, h, d, bevel, mat, x = 0, y = 0, z = 0) {
    if (this.detail === 0 || bevel <= 0) return this._box(w, h, d, mat, x, y, z);
    const mesh = new THREE.Mesh(this._bevelGeo(w, h, d, bevel), mat);
    mesh.position.set(x, y, z);
    return this._finish(mesh);
  }

  _loop(count, fn) {
    for (let i = 0; i < count; i++) fn(i);
  }

  _buildRifle() {
    const g = new THREE.Group();
    const m = this.mats;
    const d = this.detail;

    g.add(this._bevelBox(0.042, 0.055, 0.26, 0.003, m.gunmetal, 0, 0, 0));

    if (d >= 1) {
      g.add(this._bevelBox(0.038, 0.02, 0.24, 0.002, m.gunmetal, 0, 0.035, 0.01));
    }
    g.add(this._box(0.03, 0.008, 0.24, m.darkMetal, 0, d === 0 ? 0.04 : 0.048, 0.01));
    if (d >= 2) {
      this._loop(14, (i) => g.add(this._box(0.03, 0.004, 0.006, m.darkMetal, 0, 0.054, -0.1 + i * 0.016)));
    }

    g.add(this._cyl(0.007, 0.007, 0.24, m.darkMetal, 0, 0.005, -0.24, Math.PI / 2));
    if (d >= 1) {
      g.add(this._cyl(0.011, 0.011, 0.015, m.gunmetal, 0, 0.005, -0.13, Math.PI / 2));
      g.add(this._box(0.015, 0.02, 0.02, m.darkMetal, 0, 0.012, -0.28));
      g.add(this._cyl(0.002, 0.002, 0.12, m.darkMetal, 0, 0.02, -0.22, Math.PI / 2));
    }
    g.add(this._cyl(0.011, 0.011, 0.045, m.gunmetal, 0, 0.005, -0.38, Math.PI / 2));
    if (d >= 2) {
      this._loop(3, (i) => g.add(this._box(0.013, 0.008, 0.003, m.darkMetal, 0, 0.005, -0.365 - i * 0.012)));
    }

    g.add(this._bevelBox(0.038, 0.045, 0.2, 0.002, m.polymer, 0, -0.002, -0.22));
    if (d >= 2) {
      this._loop(7, (i) => g.add(this._box(0.04, 0.003, 0.01, m.darkMetal, 0, 0.014, -0.15 - i * 0.022)));
      this._loop(4, (i) => g.add(this._box(0.042, 0.006, 0.018, m.railCover, 0, -0.026, -0.16 - i * 0.024)));
    }

    if (d >= 1) {
      g.add(this._box(0.005, 0.01, 0.16, m.darkMetal, -0.022, 0.008, -0.2));
      g.add(this._box(0.005, 0.01, 0.16, m.darkMetal, 0.022, 0.008, -0.2));
      g.add(this._box(0.028, 0.008, 0.16, m.darkMetal, 0, -0.026, -0.2));
    }
    if (d >= 2) {
      this._loop(8, (i) => {
        g.add(this._box(0.006, 0.004, 0.005, m.darkMetal, -0.022, 0.014, -0.27 + i * 0.02));
        g.add(this._box(0.006, 0.004, 0.005, m.darkMetal, 0.022, 0.014, -0.27 + i * 0.02));
        g.add(this._box(0.03, 0.004, 0.005, m.darkMetal, 0, -0.031, -0.27 + i * 0.02));
      });
    }

    if (d >= 1) {
      g.add(this._box(0.012, 0.015, 0.012, m.darkMetal, 0, 0.055, -0.3));
    }
    g.add(this._box(0.004, 0.02, 0.004, m.sight, 0, 0.07, -0.3));
    if (d >= 2) {
      g.add(this._box(0.002, 0.018, 0.008, m.darkMetal, -0.006, 0.068, -0.3));
      g.add(this._box(0.002, 0.018, 0.008, m.darkMetal, 0.006, 0.068, -0.3));
    }

    if (d >= 1) {
      g.add(this._box(0.02, 0.012, 0.015, m.darkMetal, 0, 0.055, 0.08));
    }
    g.add(this._box(0.022, 0.018, 0.008, m.sight, 0, 0.065, 0.08));
    if (d >= 2) {
      g.add(this._box(0.006, 0.008, 0.01, m.darkMetal, 0, 0.068, 0.08));
    }

    g.add(this._box(0.018, 0.006, 0.025, m.darkMetal, 0, 0.028, 0.1));
    if (d >= 2) {
      g.add(this._box(0.008, 0.004, 0.008, m.darkMetal, 0, 0.028, 0.115));
    }

    const ejectionPort = this._box(0.002, 0.018, 0.05, m.darkMetal, 0.022, 0.008, -0.02);
    g.add(ejectionPort);
    if (d >= 1) {
      g.add(this._box(0.004, 0.015, 0.012, m.gunmetal, 0.024, 0.012, 0.01));
      g.add(this._cyl(0.004, 0.004, 0.008, m.darkMetal, 0.023, 0.015, 0.04, 0, Math.PI / 2));
      g.add(this._cyl(0.006, 0.006, 0.015, m.darkMetal, -0.023, -0.01, 0.03, 0, Math.PI / 2));
      g.add(this._box(0.004, 0.012, 0.008, m.darkMetal, -0.028, -0.01, 0.03));
      g.add(this._box(0.004, 0.008, 0.015, m.darkMetal, -0.023, -0.005, -0.01));
      g.add(this._cyl(0.005, 0.005, 0.006, m.darkMetal, -0.023, -0.02, 0.02, 0, Math.PI / 2));
      g.add(this._bevelBox(0.032, 0.035, 0.055, 0.002, m.gunmetal, 0, -0.045, 0.02));
    }

    const magazine = this._bevelBox(0.026, 0.09, 0.04, 0.002, m.polymer, 0, -0.1, 0.02);
    magazine.rotation.x = 0.08;
    g.add(magazine);

    const magBase = this._box(0.03, 0.006, 0.045, m.rubber, 0, -0.148, 0.025);
    magBase.rotation.x = 0.08;
    g.add(magBase);

    const grip = this._bevelBox(0.026, 0.08, 0.03, 0.003, m.polymer, 0, -0.065, 0.09);
    grip.rotation.x = -0.35;
    g.add(grip);

    if (d >= 2) {
      this._loop(4, (i) => {
        const groove = this._box(0.028, 0.002, 0.028, m.gripTexture, 0, -0.04 - i * 0.018, 0.078 + i * 0.008);
        groove.rotation.x = -0.35;
        g.add(groove);
      });
    }

    g.add(this._box(0.005, 0.005, 0.045, m.gunmetal, 0, -0.04, 0.05));
    if (d >= 1) {
      g.add(this._box(0.005, 0.022, 0.005, m.gunmetal, 0, -0.05, 0.072));
    }
    const trigger = this._box(0.005, 0.018, 0.006, m.darkMetal, 0, -0.04, 0.055);
    trigger.rotation.x = 0.2;
    g.add(trigger);

    g.add(this._bevelBox(0.032, 0.06, 0.16, 0.003, m.polymer, 0, -0.008, 0.22));
    g.add(this._box(0.035, 0.07, 0.012, m.rubber, 0, -0.008, 0.305));
    if (d >= 1) {
      g.add(this._box(0.028, 0.012, 0.09, m.polymerLight, 0, 0.028, 0.24));
      g.add(this._box(0.008, 0.004, 0.02, m.darkMetal, -0.018, -0.02, 0.2));
      g.add(this._cyl(0.003, 0.003, 0.012, m.darkMetal, 0, -0.018, -0.32, 0, Math.PI / 2));
      g.add(this._cyl(0.003, 0.003, 0.012, m.darkMetal, 0, -0.018, 0.28, 0, Math.PI / 2));
    }

    if (d >= 1) {
      const foregrip = this._bevelBox(0.02, 0.05, 0.025, 0.002, m.polymer, 0, -0.055, -0.2);
      foregrip.rotation.x = -0.15;
      g.add(foregrip);
      g.add(this._box(0.02, 0.008, 0.06, m.darkMetal, 0, 0.056, 0.02));
      g.add(this._cyl(0.012, 0.012, 0.035, m.darkMetal, 0, 0.075, 0.02));
      g.add(this._cyl(0.01, 0.01, 0.002, m.sightGlass, 0, 0.075, 0.002, Math.PI / 2));
    } else {
      g.add(this._box(0.02, 0.016, 0.036, m.darkMetal, 0, 0.062, 0.02));
    }

    g.userData.magazine = magazine;
    g.userData.magBase = magBase;
    g.userData.ejectionPort = ejectionPort;

    this.models.rifle = g;
    this.muzzlePositions.rifle = new THREE.Vector3(0, 0.005, -0.41);
  }

  _buildSMG() {
    const g = new THREE.Group();
    const m = this.mats;
    const d = this.detail;

    g.add(this._bevelBox(0.038, 0.05, 0.18, 0.002, m.gunmetal, 0, 0, 0));
    g.add(this._box(0.024, 0.008, 0.14, m.darkMetal, 0, 0.03, -0.02));
    if (d >= 2) {
      this._loop(10, (i) => g.add(this._box(0.024, 0.003, 0.005, m.darkMetal, 0, 0.035, -0.08 + i * 0.014)));
    }

    g.add(this._cyl(0.006, 0.006, 0.18, m.darkMetal, 0, 0.003, -0.19, Math.PI / 2));
    g.add(this._cyl(0.009, 0.009, 0.025, m.gunmetal, 0, 0.003, -0.29, Math.PI / 2));
    g.add(this._bevelBox(0.032, 0.038, 0.12, 0.002, m.polymer, 0, -0.003, -0.16));
    if (d >= 2) {
      this._loop(5, (i) => g.add(this._box(0.034, 0.003, 0.008, m.darkMetal, 0, 0.01, -0.12 - i * 0.02)));
    }

    if (d >= 1) {
      g.add(this._box(0.01, 0.012, 0.01, m.darkMetal, 0, 0.045, -0.22));
    }
    g.add(this._box(0.003, 0.018, 0.003, m.sight, 0, 0.058, -0.22));
    if (d >= 1) {
      g.add(this._box(0.018, 0.01, 0.012, m.darkMetal, 0, 0.045, 0.06));
    }
    g.add(this._box(0.018, 0.015, 0.006, m.sight, 0, 0.055, 0.06));

    if (d >= 1) {
      g.add(this._bevelBox(0.028, 0.03, 0.035, 0.002, m.gunmetal, 0, -0.038, 0.01));
    }

    const magazine = this._bevelBox(0.02, 0.1, 0.026, 0.002, m.polymer, 0, -0.1, 0.015);
    magazine.rotation.x = 0.15;
    g.add(magazine);

    const magBase = this._box(0.024, 0.005, 0.03, m.rubber, 0, -0.152, 0.02);
    magBase.rotation.x = 0.15;
    g.add(magBase);

    const grip = this._bevelBox(0.022, 0.065, 0.026, 0.003, m.polymer, 0, -0.055, 0.07);
    grip.rotation.x = -0.3;
    g.add(grip);

    if (d >= 2) {
      this._loop(3, (i) => {
        const groove = this._box(0.024, 0.002, 0.024, m.gripTexture, 0, -0.035 - i * 0.015, 0.06 + i * 0.007);
        groove.rotation.x = -0.3;
        g.add(groove);
      });
    }

    g.add(this._box(0.004, 0.004, 0.035, m.gunmetal, 0, -0.035, 0.04));
    const trigger = this._box(0.004, 0.015, 0.005, m.darkMetal, 0, -0.035, 0.045);
    trigger.rotation.x = 0.15;
    g.add(trigger);

    if (d >= 1) {
      g.add(this._box(0.018, 0.018, 0.12, m.darkMetal, 0, 0.008, 0.15));
      g.add(this._box(0.006, 0.006, 0.09, m.darkMetal, -0.01, 0.008, 0.22));
      g.add(this._box(0.006, 0.006, 0.09, m.darkMetal, 0.01, 0.008, 0.22));
    }
    g.add(this._box(0.03, 0.045, 0.01, m.rubber, 0, 0.003, 0.27));

    g.add(this._box(0.012, 0.005, 0.018, m.darkMetal, 0, 0.022, -0.06));
    const ejectionPort = this._box(0.002, 0.012, 0.035, m.darkMetal, 0.02, 0.005, -0.03);
    g.add(ejectionPort);
    if (d >= 1) {
      g.add(this._cyl(0.005, 0.005, 0.012, m.darkMetal, -0.02, -0.008, 0.02, 0, Math.PI / 2));
      const foregrip = this._bevelBox(0.018, 0.045, 0.022, 0.002, m.polymer, 0, -0.05, -0.14);
      foregrip.rotation.x = -0.1;
      g.add(foregrip);
    } else {
      g.add(this._box(0.018, 0.045, 0.022, m.polymer, 0, -0.05, -0.14));
    }

    g.userData.magazine = magazine;
    g.userData.magBase = magBase;
    g.userData.ejectionPort = ejectionPort;

    this.models.smg = g;
    this.muzzlePositions.smg = new THREE.Vector3(0, 0.003, -0.31);
  }

  _buildSniper() {
    const g = new THREE.Group();
    const m = this.mats;
    const d = this.detail;

    g.add(this._bevelBox(0.042, 0.055, 0.28, 0.003, m.gunmetal, 0, 0, 0));
    g.add(this._cyl(0.008, 0.01, 0.45, m.darkMetal, 0, 0.008, -0.38, Math.PI / 2));
    if (d >= 2) {
      this._loop(8, (i) => g.add(this._box(0.02, 0.002, 0.4, m.darkMetal, 0, 0.008, -0.2 - i * 0.05)));
    }
    g.add(this._cyl(0.013, 0.013, 0.055, m.gunmetal, 0, 0.008, -0.62, Math.PI / 2));
    if (d >= 2) {
      this._loop(4, (i) => g.add(this._box(0.015, 0.007, 0.003, m.darkMetal, 0, 0.008, -0.605 - i * 0.01)));
    }

    g.add(this._cyl(0.016, 0.016, 0.2, m.darkMetal, 0, 0.065, -0.05, Math.PI / 2));
    g.add(this._cyl(0.02, 0.02, 0.028, m.gunmetal, 0, 0.065, -0.16, Math.PI / 2));
    g.add(this._cyl(0.018, 0.018, 0.022, m.gunmetal, 0, 0.065, 0.06, Math.PI / 2));
    if (d >= 1) {
      g.add(this._cyl(0.018, 0.018, 0.002, m.sightGlass, 0, 0.065, -0.175, Math.PI / 2));
      g.add(this._cyl(0.016, 0.016, 0.002, m.sightGlass, 0, 0.065, 0.072, Math.PI / 2));
      g.add(this._box(0.01, 0.025, 0.035, m.darkMetal, -0.013, 0.042, -0.05));
      g.add(this._box(0.01, 0.025, 0.035, m.darkMetal, 0.013, 0.042, -0.05));
      g.add(this._cyl(0.019, 0.019, 0.008, m.darkMetal, 0, 0.065, -0.12, Math.PI / 2));
      g.add(this._cyl(0.019, 0.019, 0.008, m.darkMetal, 0, 0.065, 0.02, Math.PI / 2));
      g.add(this._cyl(0.007, 0.007, 0.018, m.gunmetal, 0, 0.088, -0.05));
      g.add(this._cyl(0.007, 0.007, 0.018, m.gunmetal, 0.025, 0.065, -0.05, 0, Math.PI / 2));
      g.add(this._cyl(0.005, 0.005, 0.055, m.darkMetal, 0.028, 0.008, 0.05, 0, Math.PI / 2));
      g.add(this._cyl(0.009, 0.009, 0.012, m.gunmetal, 0.058, 0.008, 0.05, 0, Math.PI / 2));
    }

    g.add(this._bevelBox(0.038, 0.075, 0.32, 0.004, m.wood, 0, -0.012, 0.26));
    g.add(this._bevelBox(0.042, 0.045, 0.28, 0.003, m.wood, 0, -0.018, -0.24));
    g.add(this._box(0.038, 0.038, 0.018, m.woodDark, 0, -0.018, -0.385));
    if (d >= 1) {
      g.add(this._box(0.032, 0.018, 0.11, m.woodDark, 0, 0.032, 0.26));
    }
    g.add(this._box(0.042, 0.09, 0.018, m.rubber, 0, -0.012, 0.425));

    const grip = this._bevelBox(0.026, 0.07, 0.028, 0.003, m.woodDark, 0, -0.06, 0.1);
    grip.rotation.x = -0.4;
    g.add(grip);

    g.add(this._box(0.005, 0.005, 0.045, m.gunmetal, 0, -0.045, 0.06));
    const trigger = this._box(0.005, 0.018, 0.006, m.darkMetal, 0, -0.045, 0.065);
    trigger.rotation.x = 0.2;
    g.add(trigger);

    if (d >= 1) {
      g.add(this._bevelBox(0.032, 0.025, 0.045, 0.002, m.gunmetal, 0, -0.05, -0.02));
    }
    const magazine = this._bevelBox(0.026, 0.035, 0.035, 0.002, m.darkMetal, 0, -0.075, -0.02);
    g.add(magazine);

    if (d >= 1) {
      g.add(this._cyl(0.003, 0.003, 0.14, m.darkMetal, -0.018, -0.09, -0.36, 0.3));
      g.add(this._cyl(0.003, 0.003, 0.14, m.darkMetal, 0.018, -0.09, -0.36, 0.3));
      g.add(this._box(0.045, 0.012, 0.025, m.gunmetal, 0, -0.04, -0.36));
      g.add(this._cyl(0.003, 0.003, 0.01, m.darkMetal, 0, -0.035, -0.34, 0, Math.PI / 2));
      g.add(this._cyl(0.003, 0.003, 0.01, m.darkMetal, 0, -0.035, 0.38, 0, Math.PI / 2));
    }

    g.userData.magazine = magazine;
    g.userData.ejectionPort = null;

    this.models.sniper = g;
    this.muzzlePositions.sniper = new THREE.Vector3(0, 0.008, -0.65);
  }

  _buildPistol() {
    const g = new THREE.Group();
    const m = this.mats;
    const d = this.detail;

    g.add(this._bevelBox(0.028, 0.03, 0.13, 0.002, m.polymer, 0, -0.008, 0));
    g.add(this._bevelBox(0.03, 0.032, 0.15, 0.002, m.gunmetal, 0, 0.018, -0.01));
    if (d >= 2) {
      this._loop(6, (i) => g.add(this._box(0.032, 0.002, 0.004, m.darkMetal, 0, 0.018, 0.04 + i * 0.008)));
    }

    g.add(this._cyl(0.005, 0.005, 0.025, m.darkMetal, 0, 0.018, -0.095, Math.PI / 2));
    g.add(this._cyl(0.007, 0.007, 0.006, m.gunmetal, 0, 0.018, -0.108, Math.PI / 2));
    g.add(this._box(0.003, 0.01, 0.003, m.sight, 0, 0.038, -0.075));
    g.add(this._box(0.018, 0.008, 0.005, m.sight, 0, 0.038, 0.055));
    const ejectionPort = this._box(0.002, 0.01, 0.025, m.darkMetal, 0.016, 0.022, -0.025);
    g.add(ejectionPort);

    const grip = this._bevelBox(0.026, 0.08, 0.028, 0.003, m.polymer, 0, -0.06, 0.04);
    grip.rotation.x = -0.25;
    g.add(grip);

    if (d >= 1) {
      const gripPanelL = this._box(0.002, 0.06, 0.022, m.rubber, -0.014, -0.06, 0.04);
      gripPanelL.rotation.x = -0.25;
      g.add(gripPanelL);
      const gripPanelR = this._box(0.002, 0.06, 0.022, m.rubber, 0.014, -0.06, 0.04);
      gripPanelR.rotation.x = -0.25;
      g.add(gripPanelR);
    }
    if (d >= 2) {
      this._loop(5, (i) => {
        const groove = this._box(0.028, 0.002, 0.026, m.gripTexture, 0, -0.035 - i * 0.012, 0.028 + i * 0.006);
        groove.rotation.x = -0.25;
        g.add(groove);
      });
    }

    g.add(this._box(0.004, 0.004, 0.035, m.polymer, 0, -0.035, 0.01));
    if (d >= 1) {
      g.add(this._box(0.004, 0.018, 0.004, m.polymer, 0, -0.042, 0.028));
    }
    const trigger = this._box(0.004, 0.015, 0.005, m.darkMetal, 0, -0.035, 0.015);
    trigger.rotation.x = 0.15;
    g.add(trigger);

    if (d >= 1) {
      g.add(this._box(0.006, 0.012, 0.006, m.darkMetal, 0, 0.025, 0.058));
      g.add(this._box(0.02, 0.015, 0.008, m.polymer, 0, -0.015, 0.055));
      g.add(this._box(0.004, 0.008, 0.015, m.darkMetal, -0.016, -0.005, 0.035));
      g.add(this._cyl(0.005, 0.005, 0.006, m.darkMetal, -0.016, -0.025, 0.028, 0, Math.PI / 2));
      g.add(this._box(0.005, 0.006, 0.018, m.darkMetal, -0.016, 0.008, 0.018));
      g.add(this._box(0.018, 0.005, 0.045, m.darkMetal, 0, -0.025, -0.035));
    }
    if (d >= 2) {
      this._loop(3, (i) => g.add(this._box(0.02, 0.003, 0.003, m.darkMetal, 0, -0.022, -0.02 - i * 0.012)));
    }

    g.userData.magazine = null;
    g.userData.ejectionPort = ejectionPort;

    this.models.pistol = g;
    this.muzzlePositions.pistol = new THREE.Vector3(0, 0.018, -0.115);
  }

  getWeaponModel(type) {
    return this.models[type] || null;
  }

  getMuzzlePosition(type) {
    return this.muzzlePositions[type] || this._zeroMuzzle;
  }
}
