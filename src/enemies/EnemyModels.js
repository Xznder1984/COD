import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const SKIN_TONES = [0xc68642, 0x8d5524, 0xe0ac69, 0xf1c27d, 0xffdbac];
const GEAR_COLORS = [0x2d2d2d, 0x3a3a3a, 0x1a1a1a, 0x4a4a3a];
const CAMO_PATTERNS = ['woodland', 'desert', 'urban', 'digital'];

const VARIANTS = ['assault', 'heavy', 'scout'];
const VARIANT_SCALE = { heavy: 1.12, scout: 0.94, assault: 1.0 };
const VARIANT_ARMOR = { heavy: 1.0, scout: 0.3, assault: 0.6 };
const VARIANT_SEED = { heavy: 101, scout: 102, assault: 99 };
const VARIANT_SKIN_INDEX = { heavy: 1, scout: 3, assault: 2 };
const VARIANT_GEAR_INDEX = { heavy: 0, scout: 1, assault: 3 };

const PART_NAMES = ['torso', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'weapon'];

const LOW_SEGMENTS = 6;

const DEFAULT_QUALITY = {
  propDetail: 1,
  shadowsEnabled: true,
  maxEnemies: 8,
  enemyLodDistance: 30,
};

const _geoCache = new Map();
const _matCache = new Map();
const _m4 = new THREE.Matrix4();
const _eulerScratch = new THREE.Euler();

function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function geo(key, factory) {
  let g = _geoCache.get(key);
  if (g === undefined) {
    g = factory();
    g.computeBoundingSphere();
    _geoCache.set(key, g);
  }
  return g;
}

function mat(key, factory) {
  let m = _matCache.get(key);
  if (m === undefined) {
    m = factory();
    _matCache.set(key, m);
  }
  return m;
}

function boxGeo(w, h, d) {
  return geo(`b|${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
}

function sphereGeo(r, ws, hs, phiLength, thetaLength) {
  const key = `s|${r}|${ws}|${hs}|${phiLength || 0}|${thetaLength || 0}`;
  return geo(key, () => new THREE.SphereGeometry(r, ws, hs, 0, phiLength || Math.PI * 2, 0, thetaLength || Math.PI));
}

function cylGeo(rt, rb, h, seg) {
  return geo(`c|${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
}

function torusGeo(r, t, ts, rs, arc) {
  return geo(`t|${r}|${t}|${ts}|${rs}|${arc}`, () => new THREE.TorusGeometry(r, t, ts, rs, arc));
}

function placed(geometry, x, y, z, rx, ry, rz) {
  _eulerScratch.set(rx || 0, ry || 0, rz || 0);
  _m4.makeRotationFromEuler(_eulerScratch);
  _m4.setPosition(x || 0, y || 0, z || 0);
  geometry.applyMatrix4(_m4);
  return geometry;
}

function boxPart(w, h, d, x, y, z, rx, ry, rz) {
  return placed(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
}

function cylPart(rt, rb, h, seg, x, y, z, rx, ry, rz) {
  return placed(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, rx, ry, rz);
}

function merged(key, factory) {
  return geo(key, () => mergeGeometries(factory(), false));
}

function mesh(geometry, material) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

function markDeco(target) {
  target.traverse(child => {
    if (child.isMesh) child.userData.deco = true;
  });
  return target;
}

function clampDetail(value) {
  const d = value | 0;
  return d < 0 ? 0 : d > 2 ? 2 : d;
}

export class EnemyModels {
  constructor(assetFactory, quality) {
    this.assetFactory = assetFactory;
    this.quality = { ...DEFAULT_QUALITY, ...(quality || {}) };
    this.detail = clampDetail(this.quality.propDetail);
    this.shadows = this.quality.shadowsEnabled !== false;
    this.templates = {};
    this._lodInfo = new WeakMap();
    this._instances = new Set();
  }

  setQuality(quality) {
    if (!quality) return;
    const nextDetail = clampDetail(
      quality.propDetail !== undefined ? quality.propDetail : this.quality.propDetail
    );
    const nextShadows = quality.shadowsEnabled !== undefined
      ? quality.shadowsEnabled !== false
      : this.shadows;

    this.quality = { ...this.quality, ...quality };
    this.shadows = nextShadows;

    if (nextDetail !== this.detail) {
      this.detail = nextDetail;
      this.templates = {};
      this._instances.clear();
    }

    if (!this.shadows) {
      const instances = this._instances;
      if (instances.size > 0) {
        instances.forEach(group => {
          group.traverse(child => {
            if (child.isMesh && child.castShadow) child.castShadow = false;
          });
        });
      }
    }
  }

  getTemplate(variant) {
    const key = VARIANTS.indexOf(variant) >= 0 ? variant : 'assault';
    let template = this.templates[key];
    if (!template) {
      template = this._buildSoldier(key);
      this.templates[key] = template;
    }
    return template;
  }

  getModel(variant) {
    const key = VARIANTS.indexOf(variant) >= 0 ? variant : 'assault';
    const clone = this.getTemplate(key).clone(true);
    clone.visible = true;
    clone.userData.variant = key;
    this._instances.add(clone);
    this._register(clone);
    return clone;
  }

  getLODInfo(group) {
    let info = this._lodInfo.get(group);
    if (!info) info = this._register(group);
    return info;
  }

  getParts(group) {
    return this.getLODInfo(group).parts;
  }

  _register(group) {
    const meshes = [];
    const deco = [];
    const parts = {};

    group.traverse(child => {
      if (child.name) parts[child.name] = child;
      if (child.isMesh) {
        meshes.push(child);
        if (child.userData && child.userData.deco) deco.push(child);
      }
    });

    for (let i = 0; i < PART_NAMES.length; i++) {
      if (!parts[PART_NAMES[i]]) parts[PART_NAMES[i]] = null;
    }

    const info = { meshes, deco, parts, meshCount: meshes.length };
    this._lodInfo.set(group, info);
    return info;
  }

  getStats() {
    const built = this.templates;
    const keys = Object.keys(built);
    let meshCount = 0;
    let meshes = 0;
    if (keys.length === 0) {
      meshCount = this.getLODInfo(this.getTemplate('assault')).meshCount;
      meshes = meshCount;
    } else {
      for (let i = 0; i < keys.length; i++) {
        const count = this.getLODInfo(built[keys[i]]).meshCount;
        if (count > meshCount) meshCount = count;
        meshes += count;
      }
    }
    return {
      detail: this.detail,
      meshesPerEnemy: meshCount,
      castShadows: this.shadows,
      sharedGeometries: _geoCache.size,
      sharedMaterials: _matCache.size,
      liveModels: this._instances.size,
      totalMeshes: meshes,
    };
  }

  _getMaterials(variant) {
    const detail = this.detail;

    if (detail === 0) {
      const body = mat('d0|body', () => new THREE.MeshStandardMaterial({
        color: 0x4a4c3a, roughness: 0.92, metalness: 0.02,
      }));
      return { body, camo: body, gear: body, skin: body, boot: body, weapon: body, visor: body, lens: body, pad: body };
    }

    if (detail === 1) {
      return {
        camo: mat('d1|camo', () => new THREE.MeshStandardMaterial({ color: 0x50543e, roughness: 0.88, metalness: 0.04 })),
        gear: mat('d1|gear', () => new THREE.MeshStandardMaterial({ color: 0x2f3128, roughness: 0.8, metalness: 0.1 })),
        weapon: mat('d1|weapon', () => new THREE.MeshStandardMaterial({ color: 0x1d1d1d, roughness: 0.55, metalness: 0.45 })),
      };
    }

    const seed = VARIANT_SEED[variant];
    const pattern = CAMO_PATTERNS[hashStr(variant) % CAMO_PATTERNS.length];
    const camo = mat(`camo|${variant}`, () => this._createCamo(seed, pattern));
    const gearColor = GEAR_COLORS[VARIANT_GEAR_INDEX[variant]];
    const gear = mat(`gear|${variant}`, () => this._createGear(gearColor, 200 + (seed % 17)));
    const skinColor = SKIN_TONES[VARIANT_SKIN_INDEX[variant]];

    return {
      camo,
      gear,
      skin: mat(`skin|${variant}`, () => new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.7, metalness: 0.0 })),
      boot: mat(`boot|${variant}`, () => new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.85, metalness: 0.1 })),
      weapon: mat(`weapon|${variant}`, () => this._createGear(0x1a1a1a, 300 + (seed % 11), 0.4, 0.7)),
      visor: mat(`visor|${variant}`, () => new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.15, metalness: 0.95 })),
      pad: mat(`pad|${variant}`, () => new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.82, metalness: 0.05 })),
      lens: mat(`lens|${variant}`, () => new THREE.MeshStandardMaterial({ color: 0x3366ff, roughness: 0.12, metalness: 0.8 })),
    };
  }

  _createCamo(seed, pattern) {
    if (this.assetFactory && this.assetFactory.createMaterial) {
      return this.assetFactory.createMaterial('camo', { seed, pattern });
    }
    return new THREE.MeshStandardMaterial({ color: 0x556040, roughness: 0.9, metalness: 0.0 });
  }

  _createGear(color, seed, roughness, metalness) {
    if (this.assetFactory && this.assetFactory.createMaterial) {
      return this.assetFactory.createMaterial('metal', { color, seed, roughness, metalness });
    }
    return new THREE.MeshStandardMaterial({ color, roughness, metalness });
  }

  _buildSoldier(variant) {
    const group = this.detail === 0
      ? this._buildMinimal(variant)
      : this.detail === 1
        ? this._buildSimplified(variant)
        : this._buildFull(variant);

    group.name = `enemy_${variant}`;
    group.userData.variant = variant;
    group.userData.armorLevel = VARIANT_ARMOR[variant];
    group.scale.setScalar(VARIANT_SCALE[variant]);

    const shadows = this.shadows;
    group.traverse(child => {
      if (child.isMesh) {
        child.castShadow = shadows && child.userData.cast === true;
        child.receiveShadow = false;
        child.matrixAutoUpdate = true;
      }
    });

    this._register(group);
    return group;
  }

  _buildMinimal(variant) {
    const m = this._getMaterials(variant);

    const group = new THREE.Group();
    const torso = new THREE.Group();
    torso.name = 'torso';
    group.add(torso);

    const bodyGeo = merged('d0|body', () => [
      boxPart(0.4, 0.5, 0.24, 0, 0.24, 0),
      boxPart(0.44, 0.1, 0.22, 0, 0.44, 0),
      boxPart(0.4, 0.09, 0.27, 0, -0.02, 0),
      boxPart(0.19, 0.21, 0.2, 0, 0.64, 0),
      boxPart(0.23, 0.1, 0.24, 0, 0.76, 0),
      boxPart(0.06, 0.1, 0.5, 0.14, 0.3, 0.22),
      cylPart(0.015, 0.015, 0.24, LOW_SEGMENTS, 0.14, 0.33, 0.56, Math.PI / 2, 0, 0),
    ]);
    const body = mesh(bodyGeo, m.body);
    body.position.y = 0;
    body.userData.cast = true;
    torso.add(body);

    const armGeo = merged('d0|arm', () => [
      boxPart(0.12, 0.58, 0.14, 0, -0.29, 0),
      boxPart(0.11, 0.1, 0.13, 0, -0.56, 0.01),
    ]);
    const legGeo = merged('d0|leg', () => [
      boxPart(0.16, 0.66, 0.18, 0, -0.33, 0),
      boxPart(0.17, 0.1, 0.26, 0, -0.7, 0.03),
    ]);

    const leftArm = new THREE.Group();
    leftArm.name = 'leftArm';
    leftArm.position.set(-0.26, 0.44, 0);
    leftArm.rotation.x = -0.25;
    leftArm.rotation.z = -0.12;
    torso.add(leftArm);
    const leftArmMesh = mesh(armGeo, m.body);
    leftArmMesh.position.y = 0;
    leftArm.add(leftArmMesh);

    const rightArm = new THREE.Group();
    rightArm.name = 'rightArm';
    rightArm.position.set(0.26, 0.44, 0);
    rightArm.rotation.x = -0.25;
    rightArm.rotation.z = 0.12;
    torso.add(rightArm);
    rightArm.add(mesh(armGeo, m.body));

    const leftLeg = new THREE.Group();
    leftLeg.name = 'leftLeg';
    leftLeg.position.set(-0.1, -0.02, 0);
    group.add(leftLeg);
    leftLeg.add(mesh(legGeo, m.body));

    const rightLeg = new THREE.Group();
    rightLeg.name = 'rightLeg';
    rightLeg.position.set(0.1, -0.02, 0);
    group.add(rightLeg);
    rightLeg.add(mesh(legGeo, m.body));

    return group;
  }

  _buildSimplified(variant) {
    const m = this._getMaterials(variant);

    const group = new THREE.Group();
    const torso = new THREE.Group();
    torso.name = 'torso';
    group.add(torso);

    const torsoGeo = merged('d1|torso', () => [
      boxPart(0.4, 0.5, 0.24, 0, 0.24, 0),
      boxPart(0.44, 0.38, 0.28, 0, 0.26, 0),
      boxPart(0.5, 0.1, 0.22, 0, 0.45, 0),
      boxPart(0.28, 0.34, 0.14, 0, 0.3, -0.2),
      boxPart(0.4, 0.08, 0.27, 0, -0.02, 0),
    ]);
    const torsoMesh = mesh(torsoGeo, m.camo);
    torsoMesh.userData.cast = true;
    torso.add(torsoMesh);

    const head = new THREE.Group();
    head.name = 'head';
    head.position.y = 0.58;
    torso.add(head);
    const headGeo = merged('d1|head', () => [
      boxPart(0.19, 0.21, 0.2, 0, 0.08, 0),
      boxPart(0.23, 0.1, 0.24, 0, 0.19, 0),
      boxPart(0.16, 0.05, 0.03, 0, 0.07, 0.1),
    ]);
    const headMesh = mesh(headGeo, m.gear);
    headMesh.userData.cast = true;
    head.add(headMesh);

    const armGeo = merged('d1|arm', () => [
      boxPart(0.12, 0.58, 0.14, 0, -0.29, 0),
      boxPart(0.11, 0.1, 0.13, 0, -0.56, 0.01),
    ]);
    const gunArmGeo = merged('d1|gunarm', () => [
      boxPart(0.12, 0.58, 0.14, 0, -0.29, 0),
      boxPart(0.05, 0.09, 0.48, 0, -0.27, 0.26),
      cylPart(0.014, 0.014, 0.28, LOW_SEGMENTS + 2, 0, -0.24, 0.58, Math.PI / 2, 0, 0),
    ]);

    const leftArm = new THREE.Group();
    leftArm.name = 'leftArm';
    leftArm.position.set(-0.26, 0.44, 0);
    leftArm.rotation.x = -0.25;
    leftArm.rotation.z = -0.12;
    torso.add(leftArm);
    leftArm.add(mesh(armGeo, m.camo));

    const rightArm = new THREE.Group();
    rightArm.name = 'rightArm';
    rightArm.position.set(0.26, 0.44, 0);
    rightArm.rotation.x = -0.25;
    rightArm.rotation.z = 0.12;
    torso.add(rightArm);
    rightArm.add(mesh(gunArmGeo, m.weapon));

    const legGeo = merged('d1|leg', () => [
      boxPart(0.16, 0.66, 0.18, 0, -0.33, 0),
      boxPart(0.17, 0.1, 0.26, 0, -0.7, 0.03),
    ]);

    const leftLeg = new THREE.Group();
    leftLeg.name = 'leftLeg';
    leftLeg.position.set(-0.1, -0.02, 0);
    group.add(leftLeg);
    leftLeg.add(mesh(legGeo, m.camo));

    const rightLeg = new THREE.Group();
    rightLeg.name = 'rightLeg';
    rightLeg.position.set(0.1, -0.02, 0);
    group.add(rightLeg);
    rightLeg.add(mesh(legGeo, m.camo));

    return group;
  }

  _buildFull(variant) {
    const m = this._getMaterials(variant);
    const armorLevel = VARIANT_ARMOR[variant];

    const group = new THREE.Group();
    const torso = new THREE.Group();
    torso.name = 'torso';
    group.add(torso);

    const chest = mesh(boxGeo(0.38, 0.48, 0.22), m.camo);
    chest.position.y = 0.24;
    chest.userData.cast = true;
    torso.add(chest);

    const vest = mesh(boxGeo(0.4, 0.36, 0.26), m.gear);
    vest.position.y = 0.26;
    vest.userData.cast = true;
    torso.add(vest);

    if (armorLevel > 0.5) {
      const plateGeo = boxGeo(0.28, 0.2, 0.03);
      const plate = mesh(plateGeo, m.gear);
      plate.position.set(0, 0.28, 0.15);
      plate.userData.cast = true;
      torso.add(plate);

      const plateBack = mesh(plateGeo, m.gear);
      plateBack.position.set(0, 0.28, -0.15);
      torso.add(plateBack);

      const carrierGeo = boxGeo(0.3, 0.12, 0.02);
      for (let i = 0; i < 3; i++) {
        const carrier = mesh(carrierGeo, m.gear);
        carrier.position.set(-0.08 + i * 0.08, 0.18, 0.16);
        torso.add(carrier);
      }
    }

    const pouchGeo = boxGeo(0.07, 0.09, 0.05);
    for (let i = 0; i < 4; i++) {
      const pouch = mesh(pouchGeo, m.gear);
      pouch.position.set(-0.15 + i * 0.1, 0.1, 0.15);
      torso.add(pouch);
    }

    const belt = mesh(boxGeo(0.36, 0.05, 0.24), m.gear);
    torso.add(belt);

    const buckle = mesh(boxGeo(0.06, 0.04, 0.02), m.gear);
    buckle.position.set(0, 0, 0.13);
    torso.add(buckle);

    const shoulderGeo = boxGeo(0.1, 0.07, 0.12);
    const leftShoulder = mesh(shoulderGeo, m.camo);
    leftShoulder.position.set(-0.24, 0.46, 0);
    leftShoulder.userData.cast = true;
    torso.add(leftShoulder);
    const rightShoulder = mesh(shoulderGeo, m.camo);
    rightShoulder.position.set(0.24, 0.46, 0);
    rightShoulder.userData.cast = true;
    torso.add(rightShoulder);

    const shoulderPadGeo = boxGeo(0.11, 0.04, 0.13);
    const leftShoulderPad = mesh(shoulderPadGeo, m.gear);
    leftShoulderPad.position.set(-0.24, 0.5, 0);
    torso.add(leftShoulderPad);
    const rightShoulderPad = mesh(shoulderPadGeo, m.gear);
    rightShoulderPad.position.set(0.24, 0.5, 0);
    torso.add(rightShoulderPad);

    const collar = mesh(cylGeo(0.08, 0.1, 0.06, 6), m.camo);
    collar.position.y = 0.5;
    torso.add(collar);

    const head = new THREE.Group();
    head.name = 'head';
    head.position.y = 0.58;
    torso.add(head);

    const face = mesh(sphereGeo(0.1, 10, 7), m.skin);
    face.position.y = 0.07;
    face.scale.set(0.85, 1.05, 0.9);
    face.userData.cast = true;
    head.add(face);

    const jaw = mesh(boxGeo(0.12, 0.06, 0.1), m.skin);
    jaw.position.set(0, 0.02, 0.02);
    head.add(jaw);

    const nose = mesh(boxGeo(0.025, 0.04, 0.03), m.skin);
    nose.position.set(0, 0.06, 0.09);
    head.add(nose);

    const browGeo = boxGeo(0.03, 0.008, 0.01);
    const leftBrow = mesh(browGeo, m.gear);
    leftBrow.position.set(-0.035, 0.095, 0.085);
    head.add(leftBrow);
    const rightBrow = mesh(browGeo, m.gear);
    rightBrow.position.set(0.035, 0.095, 0.085);
    head.add(rightBrow);

    const eyeGeo = boxGeo(0.025, 0.015, 0.01);
    const leftEye = mesh(eyeGeo, m.visor);
    leftEye.position.set(-0.035, 0.085, 0.085);
    head.add(leftEye);
    const rightEye = mesh(eyeGeo, m.visor);
    rightEye.position.set(0.035, 0.085, 0.085);
    head.add(rightEye);

    const mouth = mesh(boxGeo(0.04, 0.008, 0.01), m.gear);
    mouth.position.set(0, 0.035, 0.088);
    head.add(mouth);

    const helmet = mesh(sphereGeo(0.12, 10, 7, Math.PI * 2, Math.PI * 0.55), m.gear);
    helmet.position.y = 0.09;
    helmet.userData.cast = true;
    head.add(helmet);

    const helmetRim = mesh(torusGeo(0.115, 0.012, 5, 10, Math.PI), m.gear);
    helmetRim.position.y = 0.09;
    helmetRim.rotation.x = Math.PI / 2;
    head.add(helmetRim);

    const railGeo = boxGeo(0.015, 0.02, 0.1);
    const leftRail = mesh(railGeo, m.gear);
    leftRail.position.set(-0.11, 0.1, 0);
    head.add(leftRail);
    const rightRail = mesh(railGeo, m.gear);
    rightRail.position.set(0.11, 0.1, 0);
    head.add(rightRail);

    const visor = mesh(boxGeo(0.14, 0.035, 0.015), m.visor);
    visor.position.set(0, 0.07, 0.095);
    head.add(visor);

    if (armorLevel > 0.4) {
      const mask = mesh(boxGeo(0.12, 0.07, 0.025), m.gear);
      mask.position.set(0, 0.02, 0.09);
      head.add(mask);
      const strap = mesh(boxGeo(0.13, 0.02, 0.1), m.gear);
      strap.position.set(0, 0.04, 0.02);
      head.add(strap);
    }

    const nvgMount = mesh(boxGeo(0.03, 0.04, 0.02), m.gear);
    nvgMount.position.set(0, 0.14, 0.1);
    head.add(nvgMount);

    const nvgArm = mesh(boxGeo(0.008, 0.06, 0.008), m.gear);
    nvgArm.position.set(0, 0.12, 0.11);
    nvgArm.rotation.x = 0.3;
    head.add(nvgArm);

    const earGeo = boxGeo(0.02, 0.04, 0.03);
    const leftEar = mesh(earGeo, m.skin);
    leftEar.position.set(-0.1, 0.06, 0);
    head.add(leftEar);
    const rightEar = mesh(earGeo, m.skin);
    rightEar.position.set(0.1, 0.06, 0);
    head.add(rightEar);

    const neck = mesh(cylGeo(0.035, 0.045, 0.07, 6), m.skin);
    neck.position.y = -0.03;
    head.add(neck);

    const armGeo = boxGeo(0.09, 0.56, 0.11);
    const handGeo = boxGeo(0.05, 0.06, 0.05);
    const padGeo = boxGeo(0.06, 0.06, 0.03);

    const leftArm = new THREE.Group();
    leftArm.name = 'leftArm';
    leftArm.position.set(-0.26, 0.44, 0);
    torso.add(leftArm);
    const leftArmMesh = mesh(armGeo, m.camo);
    leftArmMesh.position.y = -0.28;
    leftArmMesh.userData.cast = true;
    leftArm.add(leftArmMesh);
    const leftHand = mesh(handGeo, m.gear);
    leftHand.position.set(0, -0.57, 0.01);
    leftArm.add(leftHand);
    const leftPad = mesh(padGeo, m.pad);
    leftPad.position.set(0, -0.3, 0.045);
    leftArm.add(leftPad);
    leftArm.rotation.x = -0.25;
    leftArm.rotation.z = -0.12;

    const rightArm = new THREE.Group();
    rightArm.name = 'rightArm';
    rightArm.position.set(0.26, 0.44, 0);
    torso.add(rightArm);
    const rightArmMesh = mesh(armGeo, m.camo);
    rightArmMesh.position.y = -0.28;
    rightArmMesh.userData.cast = true;
    rightArm.add(rightArmMesh);
    const rightHand = mesh(handGeo, m.gear);
    rightHand.position.set(0, -0.57, 0.01);
    rightArm.add(rightHand);
    const rightPad = mesh(padGeo, m.pad);
    rightPad.position.set(0, -0.3, 0.045);
    rightArm.add(rightPad);
    rightArm.rotation.x = -0.25;
    rightArm.rotation.z = 0.12;

    const legGeo = boxGeo(0.15, 0.66, 0.16);
    const bootGeo = boxGeo(0.17, 0.1, 0.26);
    const kneePadGeo = boxGeo(0.08, 0.07, 0.04);

    const leftLeg = new THREE.Group();
    leftLeg.name = 'leftLeg';
    leftLeg.position.set(-0.1, -0.02, 0);
    group.add(leftLeg);
    const leftLegMesh = mesh(legGeo, m.camo);
    leftLegMesh.position.y = -0.32;
    leftLegMesh.userData.cast = true;
    leftLeg.add(leftLegMesh);
    const leftKnee = mesh(kneePadGeo, m.pad);
    leftKnee.position.set(0, -0.32, 0.06);
    leftLeg.add(leftKnee);
    const leftBoot = mesh(bootGeo, m.boot);
    leftBoot.position.set(0, -0.68, 0.03);
    leftBoot.userData.cast = true;
    leftLeg.add(leftBoot);

    const rightLeg = new THREE.Group();
    rightLeg.name = 'rightLeg';
    rightLeg.position.set(0.1, -0.02, 0);
    group.add(rightLeg);
    const rightLegMesh = mesh(legGeo, m.camo);
    rightLegMesh.position.y = -0.32;
    rightLegMesh.userData.cast = true;
    rightLeg.add(rightLegMesh);
    const rightKnee = mesh(kneePadGeo, m.pad);
    rightKnee.position.set(0, -0.32, 0.06);
    rightLeg.add(rightKnee);
    const rightBoot = mesh(bootGeo, m.boot);
    rightBoot.position.set(0, -0.68, 0.03);
    rightBoot.userData.cast = true;
    rightLeg.add(rightBoot);

    const weapon = new THREE.Group();
    weapon.name = 'weapon';
    weapon.position.set(0.12, 0.32, 0.25);
    torso.add(weapon);

    const gunBody = mesh(boxGeo(0.035, 0.07, 0.45), m.weapon);
    gunBody.userData.cast = true;
    weapon.add(gunBody);

    const gunUpper = mesh(boxGeo(0.03, 0.03, 0.4), m.weapon);
    gunUpper.position.set(0, 0.05, 0.02);
    weapon.add(gunUpper);

    const gunBarrel = mesh(cylGeo(0.01, 0.01, 0.22, 6), m.weapon);
    gunBarrel.rotation.x = Math.PI / 2;
    gunBarrel.position.set(0, 0.05, 0.32);
    weapon.add(gunBarrel);

    const muzzle = mesh(cylGeo(0.014, 0.014, 0.04, 6), m.weapon);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0.05, 0.44);
    weapon.add(muzzle);

    const handguard = mesh(boxGeo(0.04, 0.05, 0.2), m.gear);
    handguard.position.set(0, 0.02, 0.15);
    weapon.add(handguard);

    const rail = mesh(boxGeo(0.02, 0.01, 0.35), m.weapon);
    rail.position.set(0, 0.07, 0.05);
    weapon.add(rail);

    const mag = mesh(cylGeo(0.015, 0.015, 0.1, 6), m.gear);
    mag.position.set(0, -0.07, 0.02);
    mag.rotation.x = 0.15;
    mag.rotation.z = 0.1;
    weapon.add(mag);

    const stock = mesh(boxGeo(0.03, 0.06, 0.12), m.weapon);
    stock.position.set(0, -0.01, -0.28);
    weapon.add(stock);

    const sight = mesh(boxGeo(0.015, 0.035, 0.05), m.gear);
    sight.position.set(0, 0.09, 0.05);
    weapon.add(sight);

    const sightLens = mesh(cylGeo(0.012, 0.012, 0.005, 6), m.lens);
    sightLens.rotation.x = Math.PI / 2;
    sightLens.position.set(0, 0.09, 0.078);
    weapon.add(sightLens);

    const grip = mesh(boxGeo(0.025, 0.07, 0.035), m.weapon);
    grip.position.set(0, -0.06, -0.08);
    grip.rotation.x = 0.25;
    weapon.add(grip);

    const foregrip = mesh(boxGeo(0.02, 0.05, 0.025), m.gear);
    foregrip.position.set(0, -0.03, 0.15);
    weapon.add(foregrip);

    const triggerGuard = mesh(torusGeo(0.015, 0.004, 3, 6, Math.PI), m.weapon);
    triggerGuard.position.set(0, -0.045, -0.05);
    triggerGuard.rotation.x = Math.PI / 2;
    weapon.add(triggerGuard);

    const chargingHandle = mesh(boxGeo(0.015, 0.01, 0.03), m.gear);
    chargingHandle.position.set(0, 0.065, -0.1);
    weapon.add(chargingHandle);

    if (variant === 'heavy') {
      const drum = mesh(cylGeo(0.05, 0.05, 0.04, 8), m.gear);
      drum.rotation.z = Math.PI / 2;
      drum.position.set(0, -0.08, 0.02);
      weapon.add(drum);
    } else if (variant === 'scout') {
      const scope = mesh(cylGeo(0.02, 0.02, 0.12, 6), m.gear);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.1, 0);
      weapon.add(scope);
      const scopeLens = mesh(cylGeo(0.018, 0.018, 0.005, 6), m.lens);
      scopeLens.rotation.x = Math.PI / 2;
      scopeLens.position.set(0, 0.1, 0.06);
      weapon.add(scopeLens);
    }

    const backpack = markDeco(new THREE.Group());
    backpack.name = 'backpack';
    backpack.position.set(0, 0.3, -0.18);
    torso.add(backpack);
    const packMain = mesh(boxGeo(0.24, 0.3, 0.1), m.camo);
    packMain.userData.cast = true;
    backpack.add(packMain);
    const packFlap = mesh(boxGeo(0.26, 0.08, 0.12), m.gear);
    packFlap.position.y = 0.12;
    backpack.add(packFlap);
    const strapGeo = boxGeo(0.04, 0.25, 0.02);
    const packStrapL = mesh(strapGeo, m.gear);
    packStrapL.position.set(-0.08, 0, 0.06);
    backpack.add(packStrapL);
    const packStrapR = mesh(strapGeo, m.gear);
    packStrapR.position.set(0.08, 0, 0.06);
    backpack.add(packStrapR);
    const bedroll = mesh(cylGeo(0.04, 0.04, 0.2, 6), m.camo);
    bedroll.rotation.z = Math.PI / 2;
    bedroll.position.y = 0.2;
    backpack.add(bedroll);

    const radio = markDeco(new THREE.Group());
    radio.name = 'radio';
    radio.position.set(-0.18, 0.42, -0.14);
    torso.add(radio);
    const radioBody = mesh(boxGeo(0.06, 0.1, 0.03), m.gear);
    radio.add(radioBody);
    const antenna = mesh(cylGeo(0.003, 0.003, 0.12, 3), m.gear);
    antenna.position.set(0.02, 0.1, 0);
    radio.add(antenna);
    const speaker = mesh(cylGeo(0.015, 0.015, 0.01, 5), m.gear);
    speaker.rotation.x = Math.PI / 2;
    speaker.position.set(0, 0.02, 0.02);
    radio.add(speaker);

    const commsWire = markDeco(mesh(cylGeo(0.004, 0.004, 0.25, 3), m.gear));
    commsWire.name = 'commsWire';
    commsWire.position.set(-0.15, 0.35, -0.1);
    commsWire.rotation.z = 0.3;
    commsWire.rotation.x = -0.2;
    torso.add(commsWire);

    const hydration = markDeco(mesh(cylGeo(0.006, 0.006, 0.3, 3), m.gear));
    hydration.name = 'hydration';
    hydration.position.set(0.15, 0.3, -0.12);
    hydration.rotation.z = -0.2;
    hydration.rotation.x = -0.3;
    torso.add(hydration);

    const holster = markDeco(mesh(boxGeo(0.06, 0.1, 0.04), m.gear));
    holster.name = 'holster';
    holster.position.set(0.2, 0.05, 0.1);
    holster.rotation.z = -0.1;
    torso.add(holster);

    const knife = markDeco(mesh(boxGeo(0.015, 0.08, 0.03), m.gear));
    knife.name = 'knife';
    knife.position.set(-0.2, 0.08, 0.12);
    knife.rotation.z = 0.1;
    torso.add(knife);

    return group;
  }
}
