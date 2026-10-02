import * as THREE from 'three';
import { createWorldMaterials, mergeParts, mergeStaticMeshes } from './Level.js';

const MAP_HALF = 35;
const CHUNK_COUNT = 3;
const BAND_NEAR = 0;
const BAND_FAR = 1;

const SEG_RING = [6, 8, 14];
const SEG_LOW = [5, 6, 10];
const MAX_EXPLOSIONS = 4;

const DEFAULT_QUALITY = {
  name: 'low',
  shadowsEnabled: true,
  shadowMapSize: 512,
  maxLights: 2,
  propDetail: 0,
  buildingDetail: 0,
  textureSize: 256,
  maxPixelRatio: 0.55,
  cloudLayers: 1,
};

function clampInt(value, min, max, fallback) {
  const n = value | 0;
  if (!Number.isFinite(n)) return fallback;
  return n < min ? min : n > max ? max : n;
}

function isQualityObject(value) {
  if (!value || typeof value !== 'object') return false;
  return 'propDetail' in value || 'buildingDetail' in value || 'shadowMapSize' in value ||
    'textureSize' in value || 'maxLights' in value || 'maxPixelRatio' in value;
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
  q.textureSize = clampInt(q.textureSize, 64, 1024, 256);
  return q;
}

const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3(1, 1, 1);
const _zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

function partMatrix(x, y, z, rx, ry, rz) {
  _position.set(x, y, z);
  _euler.set(rx || 0, ry || 0, rz || 0);
  return new THREE.Matrix4().compose(_position, _quaternion.setFromEuler(_euler), _scale);
}

export class Props {
  constructor(scene, physics, assetFactory, quality) {
    this.scene = scene;
    this.physics = physics;
    this.assetFactory = assetFactory;
    this.quality = normalizeQuality(pickQuality(quality));
    this.barrels = [];
    this.explosions = [];
    this._statics = [];
    this._culled = [];

    this.pd = this.quality.propDetail;
    this.castShadow = this.quality.shadowsEnabled;
    this.bandCull = [
      20 + this.pd * 10 + (this.castShadow ? 4 : 0),
      85 + this.pd * 20,
    ];

    this._buildMaterials();
    this._createColliderResources();
    this._createExplosionResources();

    this._createBarrels();
    this._createCrates();
    this._createSandbags();
    this._createVehicles();
    this._createStreetLights();
    this._createRubble();
    this._createTrashAndPaper();

    this._culled = mergeStaticMeshes(this.scene, this._statics, {
      mapHalf: MAP_HALF,
      chunkCount: CHUNK_COUNT,
      bandCull: this.bandCull,
      chunkBands: [BAND_NEAR],
      castShadow: this.castShadow,
    });
    this._statics.length = 0;

    if (this._barrelMesh) {
      this._barrelMesh.userData.cullDistance = this.bandCull[BAND_FAR];
      this._barrelMesh.userData.cullDistanceSq = this.bandCull[BAND_FAR] * this.bandCull[BAND_FAR];
    }
  }

  _buildMaterials() {
    this.mat = createWorldMaterials(this.quality, this.assetFactory, 400);
  }

  _createColliderResources() {
    this._colliderGeometry = new THREE.BoxGeometry(1, 1, 1);
    this._colliderMaterial = new THREE.MeshBasicMaterial({ visible: false });
  }

  _createExplosionResources() {
    const seg = SEG_LOW[this.pd] + 2;
    this._flashGeometry = new THREE.SphereGeometry(0.7, seg, seg);
    this._smokeGeometry = new THREE.SphereGeometry(0.55, seg, Math.max(3, seg >> 1));
    this._explosionLight = null;

    if (this.quality.maxLights >= 2) {
      this._explosionLight = new THREE.PointLight(0xff8800, 0, 26, 2);
      this._explosionLight.position.set(0, -500, 0);
      this.scene.add(this._explosionLight);
    }
  }

  _push(mesh, material, color, cast, receive, band) {
    mesh.material = material;
    this._statics.push({
      mesh,
      material,
      color: color === undefined ? 0xffffff : color,
      cast: cast === true && this.castShadow,
      receive: receive !== false,
      band: band === BAND_NEAR ? BAND_NEAR : BAND_FAR,
      flat: false,
    });
  }

  _addCollider(mesh, scale, x, y, z, ry) {
    mesh.position.set(x, y, z);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    if (ry) mesh.rotation.y = ry;
    this.scene.add(mesh);
    this.physics.addCollider(mesh);
  }

  _box(w, h, d) {
    return new THREE.BoxGeometry(w, h, d);
  }

  _cyl(rt, rb, h, seg) {
    return new THREE.CylinderGeometry(rt, rb, h, Math.max(4, seg), 1);
  }

  _sph(r, seg) {
    const s = Math.max(4, seg);
    return new THREE.SphereGeometry(r, s, Math.max(3, s >> 1));
  }

  _plane(w, h) {
    return new THREE.PlaneGeometry(w, h);
  }

  _createBarrels() {
    const positions = [
      [8, 12], [8.8, 12.5], [-16, 10],
      [20, -8], [-9, -16], [14, 20],
      [-20, -12], [24, 14], [-28, 6],
      [30, -14], [-4, 28], [4, -28],
    ];

    const bodyParts = [
      { geometry: this._cyl(0.38, 0.38, 1, SEG_RING[this.pd]), matrix: partMatrix(0, 0.5, 0), color: 0xaa2222 },
      { geometry: this._cyl(0.36, 0.38, 0.05, SEG_RING[this.pd]), matrix: partMatrix(0, 1.02, 0), color: 0x8e1d1d },
    ];

    const decalParts = [
      { geometry: this._plane(0.4, 0.22), matrix: partMatrix(0, 0.58, 0.39), color: 0xddaa00 },
      { geometry: this._plane(0.18, 0.18), matrix: partMatrix(0, 0.58, 0.4), color: 0x111111 },
    ];

    if (this.pd >= 1) {
      for (const y of [0.18, 0.5, 0.82]) {
        bodyParts.push({
          geometry: new THREE.TorusGeometry(0.39, 0.04, 4, SEG_RING[this.pd]),
          matrix: partMatrix(0, y, 0, Math.PI / 2, 0, 0),
          color: 0x771111,
        });
      }
      for (let i = 0; i < 3; i++) {
        decalParts.push({
          geometry: this._plane(0.2 + Math.random() * 0.2, 0.14 + Math.random() * 0.18),
          matrix: partMatrix((Math.random() - 0.5) * 0.5, 0.3 + Math.random() * 0.45, 0.37),
          color: 0x4a2a1a,
        });
      }
    }

    const bodyGeometry = mergeParts(bodyParts);
    const decalGeometry = mergeParts(decalParts);
    if (!bodyGeometry) return;

    const count = positions.length;
    const barrelMesh = new THREE.InstancedMesh(bodyGeometry, this.mat.metal, count);
    barrelMesh.castShadow = this.castShadow;
    barrelMesh.receiveShadow = true;
    barrelMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const decalMesh = decalGeometry
      ? new THREE.InstancedMesh(decalGeometry, this.mat.decal, count)
      : null;
    if (decalMesh) {
      decalMesh.castShadow = false;
      decalMesh.receiveShadow = false;
      decalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }

    const matrix = new THREE.Matrix4();

    for (let i = 0; i < count; i++) {
      const [x, z] = positions[i];
      const rot = Math.random() * Math.PI * 2;
      matrix.compose(_position.set(x, 0, z), _quaternion.setFromEuler(_euler.set(0, rot, 0)), _scale);
      barrelMesh.setMatrixAt(i, matrix);
      if (decalMesh) decalMesh.setMatrixAt(i, matrix);

      const collider = new THREE.Mesh(this._colliderGeometry, this._colliderMaterial);
      collider.position.set(x, 0.525, z);
      this.scene.add(collider);
      this.physics.addCollider(collider);

      this.barrels.push({
        mesh: barrelMesh,
        decalMesh,
        instanceIndex: i,
        position: new THREE.Vector3(x, 0.5, z),
        radius: 0.5,
        collider,
      });
    }

    barrelMesh.instanceMatrix.needsUpdate = true;
    barrelMesh.computeBoundingSphere();
    this.scene.add(barrelMesh);
    this._barrelMesh = barrelMesh;

    if (decalMesh) {
      decalMesh.instanceMatrix.needsUpdate = true;
      decalMesh.computeBoundingSphere();
      this.scene.add(decalMesh);
      this._barrelDecalMesh = decalMesh;
    }
  }

  _createCrates() {
    const stacks = [
      { pos: [6, -8], sizes: [1.5, 1.2, 1.1] },
      { pos: [-18, 6], sizes: [1.7, 1.3, 1.2] },
      { pos: [16, 16], sizes: [1.6, 1.4] },
      { pos: [-12, -20], sizes: [1.4, 1.3] },
      { pos: [22, 4], sizes: [1.2, 1.6] },
      { pos: [-24, 20], sizes: [1.8] },
      { pos: [10, 24], sizes: [1.3, 1.2] },
      { pos: [-28, -22], sizes: [1.5, 1.4] },
    ];

    for (const stack of stacks) {
      const [x, z] = stack.pos;
      const rot = Math.random() * Math.PI * 0.4;
      let y = 0;
      let maxSize = 0;

      for (let i = 0; i < stack.sizes.length; i++) {
        const size = stack.sizes[i];
        maxSize = Math.max(maxSize, size);

        const crate = new THREE.Mesh(this._box(size, size, size), this.mat.wood);
        crate.position.set(x, y + size / 2, z);
        crate.rotation.y = rot;
        this._push(crate, this.mat.wood, 0x7a5a2a, this.pd > 0, true, BAND_FAR);

        if (this.pd < 1) {
          y += size;
          continue;
        }

        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const edge = 0.09;
        const edges = [
          { size: [edge, size + 0.02, edge], pos: [size / 2, 0, size / 2] },
          { size: [edge, size + 0.02, edge], pos: [-size / 2, 0, size / 2] },
          { size: [edge, size + 0.02, edge], pos: [size / 2, 0, -size / 2] },
          { size: [edge, size + 0.02, edge], pos: [-size / 2, 0, -size / 2] },
          { size: [size + 0.02, edge, edge], pos: [0, size / 2, size / 2] },
          { size: [size + 0.02, edge, edge], pos: [0, -size / 2, size / 2] },
        ];

        for (const item of edges) {
          const [px, py, pz] = item.pos;
          const bar = new THREE.Mesh(this._box(item.size[0], item.size[1], item.size[2]), this.mat.metal);
          bar.position.set(
            x + px * cos + pz * sin,
            y + size / 2 + py,
            z - px * sin + pz * cos
          );
          bar.rotation.y = rot;
          this._push(bar, this.mat.metal, 0x4a4a42, false, true, BAND_FAR);
        }

        const stencil = new THREE.Mesh(this._plane(size * 0.5, size * 0.32), this.mat.decal);
        stencil.position.set(
          x + Math.sin(rot) * (size / 2 + 0.02),
          y + size * 0.66,
          z + Math.cos(rot) * (size / 2 + 0.02)
        );
        stencil.rotation.y = rot;
        this._push(stencil, this.mat.decal, 0x2a2a2a, false, false, BAND_NEAR);

        y += size;
      }

      const collider = new THREE.Mesh(this._colliderGeometry, this._colliderMaterial);
      this._addCollider(collider, [maxSize + 0.2, y, maxSize + 0.2], x, y / 2, z, rot);
    }
  }

  _createSandbags() {
    const positions = [
      { pos: [12, -10], rot: 0.2 },
      { pos: [-12, 10], rot: -0.2 },
      { pos: [18, 8], rot: 0.5 },
      { pos: [-18, -8], rot: -0.5 },
    ];
    const rows = this.pd === 0 ? 4 : 5;

    for (const entry of positions) {
      const [x, z] = entry.pos;
      for (let row = 0; row < rows; row++) {
        const bags = 8 - row;
        for (let i = 0; i < bags; i++) {
          const bag = new THREE.Mesh(this._sph(0.3, SEG_LOW[this.pd]), this.mat.fabric);
          bag.scale.set(1.4, 0.5, 0.95);
          bag.position.set(
            x + (i - (bags - 1) / 2) * 0.65 + (Math.random() - 0.5) * 0.12,
            0.17 + row * 0.28,
            z + (Math.random() - 0.5) * 0.12
          );
          bag.rotation.y = entry.rot + (Math.random() - 0.5) * 0.4;
          this._push(bag, this.mat.fabric, 0x6b6a52, this.pd > 0, true, BAND_FAR);
        }
      }

      const collider = new THREE.Mesh(this._colliderGeometry, this._colliderMaterial);
      this._addCollider(collider, [4.6, 1.5, 1], x, 0.75, z, entry.rot);
    }
  }

  _createVehicles() {
    const configs = [
      { pos: [-8, 14], rot: 0.8, tint: 0x2a2a2a },
      { pos: [16, -18], rot: -0.6, tint: 0x1a1a1a },
      { pos: [-22, -16], rot: 1.4, tint: 0x3a3a3a },
    ];

    for (const config of configs) {
      this._createVehicle(config);
    }
  }

  _createVehicle({ pos, rot, tint }) {
    const [x, z] = pos;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const at = (lx, ly, lz) => [x + lx * cos + lz * sin, ly, z - lx * sin + lz * cos];

    const body = new THREE.Mesh(this._box(4.6, 1, 2.1), this.mat.metal);
    body.position.set(x, 0.75, z);
    body.rotation.y = rot;
    this._push(body, this.mat.metal, tint, true, true, BAND_FAR);

    const cabin = new THREE.Mesh(this._box(2.5, 0.85, 1.9), this.mat.metal);
    const cabinPos = at(-0.2, 1.65, 0);
    cabin.position.set(cabinPos[0], cabinPos[1], cabinPos[2]);
    cabin.rotation.y = rot;
    this._push(cabin, this.mat.metal, tint, true, true, BAND_FAR);

    const wheelGeo = this._cyl(0.4, 0.4, 0.34, SEG_LOW[this.pd]);
    for (const [wx, wz] of [[1.6, 1.05], [1.6, -1.05], [-1.6, 1.05], [-1.6, -1.05]]) {
      const wheelPos = at(wx, 0.38, wz);
      const wheel = new THREE.Mesh(wheelGeo, this.mat.decal);
      wheel.rotation.order = 'YXZ';
      wheel.rotation.set(Math.PI / 2, rot, 0);
      wheel.position.set(wheelPos[0], wheelPos[1], wheelPos[2]);
      this._push(wheel, this.mat.decal, 0x141414, true, false, BAND_FAR);
    }

    for (const side of [-1, 1]) {
      const bumperPos = at(side * 2.4, 0.5, 0);
      const bumper = new THREE.Mesh(this._box(0.2, 0.4, 2), this.mat.metal);
      bumper.position.set(bumperPos[0], bumperPos[1], bumperPos[2]);
      bumper.rotation.y = rot;
      this._push(bumper, this.mat.metal, 0x2a2a2a, true, true, BAND_FAR);
    }

    if (this.pd >= 1) {
      const hood = new THREE.Mesh(this._box(1.3, 0.18, 1.9), this.mat.metal);
      const hoodPos = at(1.7, 1.3, 0);
      hood.position.set(hoodPos[0], hoodPos[1], hoodPos[2]);
      hood.rotation.y = rot;
      this._push(hood, this.mat.metal, tint, true, true, BAND_FAR);

      const windshield = new THREE.Mesh(this._plane(1.8, 0.7), this.mat.glass);
      const glassPos = at(1.05, 1.65, 0);
      windshield.position.set(glassPos[0], glassPos[1], glassPos[2]);
      windshield.rotation.set(-0.18, rot + Math.PI / 2, 0);
      this._push(windshield, this.mat.glass, 0x0e1216, false, false, BAND_FAR);

      const lampPos = at(2.35, 0.95, 0.7);
      const lamp = new THREE.Mesh(this._box(0.12, 0.2, 0.4), this.mat.decal);
      lamp.position.set(lampPos[0], lampPos[1], lampPos[2]);
      lamp.rotation.y = rot;
      this._push(lamp, this.mat.decal, 0x5a5a52, false, false, BAND_FAR);

      const tailPos = at(-2.35, 0.95, 0.7);
      const tail = new THREE.Mesh(this._box(0.1, 0.18, 0.35), this.mat.decal);
      tail.position.set(tailPos[0], tailPos[1], tailPos[2]);
      tail.rotation.y = rot;
      this._push(tail, this.mat.decal, 0x551111, false, false, BAND_FAR);
    }

    const collider = new THREE.Mesh(this._colliderGeometry, this._colliderMaterial);
    this._addCollider(collider, [4.8, 2.2, 2.3], x, 1, z, rot);
  }

  _createStreetLights() {
    const positions = [
      [7, 7], [-7, -7], [18, 0], [-18, 0], [0, 18], [0, -18],
    ];
    const seg = SEG_LOW[this.pd];

    for (const [x, z] of positions) {
      const base = new THREE.Mesh(this._cyl(0.22, 0.28, 0.45, seg), this.mat.metal);
      base.position.set(x, 0.225, z);
      this._push(base, this.mat.metal, 0x3a3a3a, this.pd > 0, true, BAND_FAR);

      const pole = new THREE.Mesh(this._cyl(0.09, 0.16, 6, seg), this.mat.metal);
      pole.position.set(x, 3.2, z);
      this._push(pole, this.mat.metal, 0x3a3a3a, this.pd > 0, true, BAND_FAR);

      const head = new THREE.Mesh(this._box(0.55, 0.2, 0.35), this.mat.metal);
      head.position.set(x + 1.4, 6, z);
      this._push(head, this.mat.metal, 0x2a2a2a, false, true, BAND_FAR);

      if (this.pd >= 1) {
        const arm = new THREE.Mesh(this._box(1.6, 0.12, 0.12), this.mat.metal);
        arm.position.set(x + 0.7, 6.1, z);
        this._push(arm, this.mat.metal, 0x3a3a3a, true, true, BAND_FAR);

        const glow = new THREE.Mesh(this._plane(2.5, 2), this.mat.decal);
        glow.rotation.x = -Math.PI / 2;
        glow.position.set(x + 1.4, 4.8, z);
        this._push(glow, this.mat.decal, 0xffcc88, false, false, BAND_NEAR);
      }

      const collider = new THREE.Mesh(this._colliderGeometry, this._colliderMaterial);
      this._addCollider(collider, [0.4, 6, 0.4], x, 3, z, 0);
    }
  }

  _createRubble() {
    const piles = [
      [9, -14], [-11, 16], [21, 18], [-21, -18],
      [14, 22], [-14, -22], [26, 0], [-26, 0],
    ];
    const per = this.pd === 0 ? 3 : 6;

    for (const [x, z] of piles) {
      for (let i = 0; i < per; i++) {
        const size = 0.28 + Math.random() * 1;
        const rubble = new THREE.Mesh(this._box(size, size * 0.6, size * 0.85), this.mat.stone);
        rubble.position.set(
          x + (Math.random() - 0.5) * 2.8,
          Math.random() * 0.5,
          z + (Math.random() - 0.5) * 2.8
        );
        rubble.rotation.set(Math.random() * 0.7, Math.random() * Math.PI, Math.random() * 0.7);
        this._push(rubble, this.mat.stone, 0x5a5548, false, true, BAND_NEAR);
      }

      if (this.pd < 1) continue;

      const bars = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < bars; i++) {
        const bar = new THREE.Mesh(this._cyl(0.022, 0.022, 1.1 + Math.random() * 0.9, 4), this.mat.metal);
        bar.position.set(
          x + (Math.random() - 0.5) * 2.2,
          0.5 + Math.random() * 0.35,
          z + (Math.random() - 0.5) * 2.2
        );
        bar.rotation.set(Math.random() * 0.9 - 0.45, Math.random() * Math.PI, Math.random() * 0.9 - 0.45);
        this._push(bar, this.mat.metal, 0x3a2818, false, false, BAND_NEAR);
      }

      const collider = new THREE.Mesh(this._colliderGeometry, this._colliderMaterial);
      this._addCollider(collider, [3.2, 1.1, 3.2], x, 0.55, z, 0);
    }
  }

  _createTrashAndPaper() {
    if (this.pd === 0) return;

    const positions = [
      [3, 5], [-4, -6], [15, 3], [-15, -3],
      [7, -18], [-7, 18], [22, -10], [-22, 10],
      [10, 25], [-10, -25], [30, 15], [-30, -15],
    ];
    const paper = this.mat.decal;

    for (const [x, z] of positions) {
      const count = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const isPaper = Math.random() > 0.35;
        const size = 0.2 + Math.random() * 0.24;
        const item = new THREE.Mesh(this._plane(size, size * (0.7 + Math.random() * 0.3)), paper);
        item.rotation.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.3, 0, Math.random() * Math.PI * 2);
        item.position.set(
          x + (Math.random() - 0.5) * 1.8,
          0.07,
          z + (Math.random() - 0.5) * 1.8
        );
        this._push(item, paper, isPaper ? 0xc8c6b4 : 0x4a4a42, false, false, BAND_NEAR);
      }
    }
  }

  getBarrels() {
    return this.barrels;
  }

  explode(position, radius) {
    const affected = [];
    const radiusSq = radius * radius;

    for (let i = 0; i < this.barrels.length; i++) {
      const barrel = this.barrels[i];
      const dx = barrel.position.x - position.x;
      const dy = barrel.position.y - position.y;
      const dz = barrel.position.z - position.z;
      if (dx * dx + dy * dy + dz * dz < radiusSq) affected.push(barrel);
    }

    for (let i = 0; i < affected.length; i++) {
      const barrel = affected[i];
      this._createExplosionEffect(barrel.position);
      this._hideInstance(barrel.mesh, barrel.instanceIndex);
      if (barrel.decalMesh) this._hideInstance(barrel.decalMesh, barrel.instanceIndex);
      this.physics.removeCollider(barrel.collider);
      this.scene.remove(barrel.collider);
    }

    if (affected.length > 0) {
      this.barrels = this.barrels.filter(b => affected.indexOf(b) === -1);
    }

    return affected.length;
  }

  _hideInstance(mesh, index) {
    if (!mesh) return;
    mesh.setMatrixAt(index, _zeroMatrix);
    mesh.instanceMatrix.needsUpdate = true;
  }

  _createExplosionEffect(position) {
    if (this.explosions.length >= MAX_EXPLOSIONS) {
      this._releaseExplosion(this.explosions[0]);
      this.explosions.shift();
    }

    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const smokeMaterial = new THREE.MeshBasicMaterial({
      color: 0x333333,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });

    const flash = new THREE.Mesh(this._flashGeometry, flashMaterial);
    flash.position.copy(position);
    flash.matrixAutoUpdate = false;
    this.scene.add(flash);

    const smoke = new THREE.Mesh(this._smokeGeometry, smokeMaterial);
    smoke.position.copy(position);
    this.scene.add(smoke);

    if (this._explosionLight) {
      this._explosionLight.position.set(position.x, position.y + 1, position.z);
      this._explosionLight.intensity = 12;
    }

    this.explosions.push({ flash, smoke, life: 0, maxLife: 0.7 });
  }

  _releaseExplosion(effect) {
    this.scene.remove(effect.flash);
    this.scene.remove(effect.smoke);
    effect.flash.material.dispose();
    effect.smoke.material.dispose();
  }

  update(dt, cameraPosition) {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const exp = this.explosions[i];
      exp.life += dt;

      const t = exp.life / exp.maxLife;
      if (t >= 1) {
        this._releaseExplosion(exp);
        this.explosions.splice(i, 1);
        if (this.explosions.length === 0 && this._explosionLight) this._explosionLight.intensity = 0;
        continue;
      }

      const flashScale = 1 + t * 12;
      exp.flash.scale.set(flashScale, flashScale, flashScale);
      exp.flash.updateMatrix();
      exp.flash.material.opacity = 1 - t;

      const smokeScale = 1 + t * 7;
      exp.smoke.scale.set(smokeScale, smokeScale, smokeScale);
      exp.smoke.material.opacity = 0.6 * (1 - t);
      exp.smoke.position.y += dt * 2.5;

      if (this._explosionLight) this._explosionLight.intensity = 12 * (1 - t);
    }

    if (!cameraPosition) return;

    const x = cameraPosition.x;
    const y = cameraPosition.y;
    const z = cameraPosition.z;

    if (this._barrelMesh) {
      const limit = this._barrelMesh.userData.cullDistanceSq;
      const visible = (x * x + y * y + z * z) < limit;
      if (this._barrelMesh.visible !== visible) this._barrelMesh.visible = visible;
      if (this._barrelDecalMesh && this._barrelDecalMesh.visible !== visible) {
        this._barrelDecalMesh.visible = visible;
      }
    }

    for (let i = 0; i < this._culled.length; i++) {
      const lod = this._culled[i];
      const dx = lod.position.x - x;
      const dz = lod.position.z - z;
      const visible = (dx * dx + dz * dz + y * y) < lod.userData.cullDistanceSq;
      if (lod.visible !== visible) lod.visible = visible;
    }
  }
}