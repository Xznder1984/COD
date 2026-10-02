import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAP_HALF, MAP_SIZE, WALL_HEIGHT, BUILDINGS, PERIMETER, SPAWN_POINTS } from '../shared/mapdata.js';
const CHUNK_COUNT = 3;
const TILE = 3;
const FLOOR_HEIGHT = 4;
const WINDOW_SPACING = 3.6;
const STREET_WIDTH = 10;

const BAND_NEAR = 0;
const BAND_FAR = 1;

const SEG_RING = [6, 8, 14];
const SEG_LOW = [5, 6, 10];
const SEG_GROUND = [3, 5, 8];
const SEG_CIRCLE = [12, 20, 32];
const AC_COUNT = [0, 2, 3];
const DEBRIS_PER_PILE = [2, 4, 6];
const TILE_PITCH = 3;

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
  q.buildingDetail = clampInt(q.buildingDetail, 0, 2, 0);
  q.textureSize = clampInt(q.textureSize, 64, 1024, 256);
  return q;
}

const _scratchColor = new THREE.Color();

function autoUvScale(geometry) {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const u = Math.max(1, Math.min(24, Math.round((box.max.x - box.min.x) / TILE)));
  const v = Math.max(1, Math.min(24, Math.round((box.max.y - box.min.y) / TILE)));
  return [u, v];
}

function tint(color) {
  return _scratchColor.setHex(color === undefined ? 0xffffff : color);
}

function bakeGeometry(source, matrix, color, uvX, uvY) {
  const geo = source.clone();

  if (!geo.index) {
    const n = geo.attributes.position.count;
    const array = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) array[i] = i;
    geo.setIndex(new THREE.BufferAttribute(array, 1));
  }

  if (!geo.attributes.normal) geo.computeVertexNormals();

  if (!geo.attributes.uv) {
    const n = geo.attributes.position.count;
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  }

  for (const name in geo.attributes) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
  }

  if (uvX !== 1 || uvY !== 1) {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvX, uv.getY(i) * uvY);
    uv.needsUpdate = true;
  }

  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  geo.applyMatrix4(matrix);
  return geo;
}

export function mergeParts(parts) {
  const geos = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const uv = autoUvScale(part.geometry);
    geos.push(bakeGeometry(part.geometry, part.matrix || new THREE.Matrix4(), tint(part.color), uv[0], uv[1]));
  }
  const merged = mergeGeometries(geos, false);
  for (let i = 0; i < geos.length; i++) geos[i].dispose();
  if (!merged) return null;
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

export function createWorldMaterials(quality, assetFactory, seedBase) {
  const base = seedBase === undefined ? 400 : seedBase;
  const af = assetFactory;
  const size = Math.max(64, Math.min(512, quality.textureSize));
  const pd = quality.propDetail;
  const bd = quality.buildingDetail;
  const lambert = pd === 0;

  const texture = (name, seed) => {
    if (af && typeof af[name] === 'function') return af[name](size, seed);
    return null;
  };

  const normalTexture = (seed, strength) => {
    if (!lambert && bd >= 1 && af && typeof af.normalMapFromHeight === 'function') {
      return af.normalMapFromHeight(Math.min(size, 256), seed, strength);
    }
    return null;
  };

  const fallback = (type, color, roughness, metalness) => {
    if (!af || typeof af.createMaterial !== 'function') {
      return new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    }
    const mat = af.createMaterial(type, { seed: base, color, roughness, metalness, repeat: [1, 1] });
    mat.color.setRGB(1, 1, 1);
    mat.vertexColors = true;
    if (lambert) {
      const flat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, map: mat.map || null });
      mat.dispose();
      return flat;
    }
    return mat;
  };

  const surface = (map, normal, roughness, metalness, fallbackType, fallbackColor) => {
    const params = { color: 0xffffff, vertexColors: true };
    if (map) {
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(1, 1);
      params.map = map;
    }
    if (lambert) return new THREE.MeshLambertMaterial(params);
    if (normal) {
      normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
      normal.repeat.set(1, 1);
      params.normalMap = normal;
      params.normalScale = new THREE.Vector2(1, 1);
    }
    params.roughness = roughness;
    params.metalness = metalness;
    if (!map && !normal && fallbackType) return fallback(fallbackType, fallbackColor, roughness, metalness);
    return new THREE.MeshStandardMaterial(params);
  };

  return {
    stone: surface(texture('concreteTexture', base + 1), normalTexture(base + 1, 2), 0.92, 0.05, 'concrete', 0x9a9588),
    metal: surface(texture('metalTexture', base + 2), normalTexture(base + 2, 1), 0.45, 0.7, 'metal', 0x6a6a72),
    wood: surface(texture('woodTexture', base + 3), normalTexture(base + 3, 1.2), 0.8, 0.0, 'wood', 0x7a5a2a),
    fabric: lambert
      ? new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true })
      : new THREE.MeshStandardMaterial({
          color: 0xffffff,
          vertexColors: true,
          roughness: 0.99,
          metalness: 0.0,
          envMapIntensity: 0.65,
        }),
    glass: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.1,
      metalness: 0.9,
      envMapIntensity: 1.7,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    }),
    decal: new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      side: THREE.DoubleSide,
    }),
  };
}

const AO_CELL = 2.5;
const AO_HEIGHT = 2.0;

function buildOcclusionGrid(statics, mapHalf) {
  const dim = Math.ceil((mapHalf * 2) / AO_CELL) + 1;
  const grid = new Uint8Array(dim * dim);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();

  for (let i = 0; i < statics.length; i++) {
    const mesh = statics[i].mesh;
    if (!mesh.geometry) continue;
    mesh.updateMatrixWorld(true);
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
    if (box.max.y - box.min.y < AO_HEIGHT) continue;

    const x0 = Math.max(0, Math.floor((box.min.x + mapHalf) / AO_CELL));
    const x1 = Math.min(dim - 1, Math.floor((box.max.x + mapHalf) / AO_CELL));
    const z0 = Math.max(0, Math.floor((box.min.z + mapHalf) / AO_CELL));
    const z1 = Math.min(dim - 1, Math.floor((box.max.z + mapHalf) / AO_CELL));
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        v.set(-mapHalf + (x + 0.5) * AO_CELL, 0, -mapHalf + (z + 0.5) * AO_CELL);
        if (v.x >= box.min.x && v.x <= box.max.x && v.z >= box.min.z && v.z <= box.max.z) {
          grid[z * dim + x] = 1;
        }
      }
    }
  }
  return { grid, dim, mapHalf };
}

function sampleAo(occ, x, z) {
  const cx = Math.floor((x + occ.mapHalf) / AO_CELL);
  const cz = Math.floor((z + occ.mapHalf) / AO_CELL);
  if (cx < 0 || cz < 0 || cx >= occ.dim || cz >= occ.dim) return 0;

  let hits = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= occ.dim || nz >= occ.dim) continue;
      if (occ.grid[nz * occ.dim + nx]) hits++;
    }
  }
  return hits / 9;
}

function applyVertexAO(geometry, occ) {
  const pos = geometry.attributes.position;
  const col = geometry.attributes.color;
  if (!pos || !col) return;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    let ao = 1;

    if (y < 1.5) {
      const t = Math.max(0, Math.min(1, y / 1.5));
      ao *= 0.7 + 0.3 * (t * t * (3 - 2 * t));
    }

    const occ01 = sampleAo(occ, x, z);
    if (occ01 > 0) {
      const above = Math.max(0, Math.min(1, y / 7));
      ao *= 1 - 0.22 * occ01 * (1 - above * 0.65);
    }

    if (ao < 0.999) {
      col.setXYZ(i, col.getX(i) * ao, col.getY(i) * ao, col.getZ(i) * ao);
    }
  }
  col.needsUpdate = true;
}

export function mergeStaticMeshes(scene, statics, options = {}) {
  const mapHalf = options.mapHalf !== undefined ? options.mapHalf : MAP_HALF;
  const chunkCount = Math.max(0, options.chunkCount !== undefined ? options.chunkCount : CHUNK_COUNT);
  const step = (mapHalf * 2) / Math.max(1, chunkCount);
  const bandCull = options.bandCull || [40];
  const chunkBands = options.chunkBands || [BAND_NEAR, BAND_FAR];
  const buckets = new Map();
  const groups = new Map();
  const aoEnabled = options.ao !== false;
  let occ = null;

  for (let i = 0; i < statics.length; i++) {
    const entry = statics[i];
    const mesh = entry.mesh;
    const material = mesh.material;
    if (!mesh.geometry || !material || Array.isArray(material)) continue;
    if (material.visible === false) continue;

    mesh.updateMatrixWorld(true);

    const band = entry.band === BAND_NEAR ? BAND_NEAR : BAND_FAR;
    let chunkKey = 'flat';
    let cx = 0;
    let cz = 0;
    if (!entry.flat && chunkCount > 0 && chunkBands.indexOf(band) !== -1) {
      cx = Math.min(chunkCount - 1, Math.max(0, Math.floor((mesh.matrixWorld.elements[12] + mapHalf) / step)));
      cz = Math.min(chunkCount - 1, Math.max(0, Math.floor((mesh.matrixWorld.elements[14] + mapHalf) / step)));
      chunkKey = cx + ':' + cz;
    }

    const cast = options.castShadow === false ? false : entry.cast === true;
    const key = material.uuid + '|' + (cast ? 1 : 0) + '|' + band + '|' + chunkKey;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material, cast, band, chunkKey, geos: [], sources: [] };
      buckets.set(key, bucket);

      let group = groups.get(chunkKey + '|' + band);
      if (!group) {
        group = { chunkKey, band, cx, cz, meshes: [] };
        groups.set(chunkKey + '|' + band, group);
      }
      group.meshes.push(key);
    }

    const uv = autoUvScale(mesh.geometry);
    bucket.geos.push(bakeGeometry(mesh.geometry, mesh.matrixWorld, tint(entry.color), uv[0], uv[1]));
    bucket.sources.push(mesh);
  }

  if (aoEnabled) occ = buildOcclusionGrid(statics, mapHalf);

  const lods = [];

  for (const group of groups.values()) {
    const cull = bandCull[group.band] !== undefined ? bandCull[group.band] : bandCull[0];
    const container = new THREE.Group();
    container.matrixAutoUpdate = false;

    for (const key of group.meshes) {
      const bucket = buckets.get(key);
      const merged = mergeGeometries(bucket.geos, false);
      for (let i = 0; i < bucket.geos.length; i++) bucket.geos[i].dispose();
      if (merged && occ) applyVertexAO(merged, occ);

      if (!merged) {
        for (let i = 0; i < bucket.sources.length; i++) {
          const source = bucket.sources[i];
          source.material = bucket.material;
          source.castShadow = bucket.cast;
          source.receiveShadow = true;
          source.userData.cullDistance = cull;
          container.add(source);
        }
        continue;
      }

      merged.computeBoundingSphere();
      merged.computeBoundingBox();

      const mesh = new THREE.Mesh(merged, bucket.material);
      mesh.castShadow = bucket.cast;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.userData.cullDistance = cull;
      mesh.userData.cullDistanceSq = cull * cull;
      container.add(mesh);
    }

    if (container.children.length === 0) continue;

    const worldChunk = group.chunkKey !== 'flat';

    if (!worldChunk || cull <= 0) {
      scene.add(container);
      continue;
    }

    const lod = new THREE.LOD();
    lod.position.set(-mapHalf + (group.cx + 0.5) * step, 0, -mapHalf + (group.cz + 0.5) * step);
    lod.matrixAutoUpdate = false;
    lod.updateMatrix();
    lod.addLevel(container, 0);
    lod.addLevel(new THREE.Object3D(), cull, 0.08);
    lod.userData.cullDistance = cull;
    lod.userData.cullDistanceSq = cull * cull;
    lod.userData.chunk = [group.cx, group.cz];
    scene.add(lod);
    lods.push(lod);
  }

  buckets.clear();
  groups.clear();

  return lods;
}

export class Level {
  constructor(scene, physics, assetFactory, quality) {
    this.scene = scene;
    this.physics = physics;
    this.assetFactory = assetFactory;
    this.quality = normalizeQuality(pickQuality(quality));
    this.spawnPoints = [];
    this.coverPositions = [];
    this.coverObjects = [];
    this.objectivePositions = [];
    this.colliders = [];
    this.bounds = { minX: -MAP_HALF, maxX: MAP_HALF, minZ: -MAP_HALF, maxZ: MAP_HALF };
    this._statics = [];
    this._culled = [];

    this.pd = this.quality.propDetail;
    this.bd = this.quality.buildingDetail;
    this.castShadow = this.quality.shadowsEnabled;
    this.bandCull = [
      24 + this.pd * 11 + (this.castShadow ? 4 : 0),
      95 + this.pd * 22,
    ];

    this._buildMaterials();
    this._createColliderResources();

    this._createGround();
    this._createPerimeterWalls();
    this._createBuildings();
    this._createStreets();
    this._createCoverObjects();
    this._createDebris();
    this._createPlaza();
    this._createAlleyways();
    this._createElevatedPositions();
    this._generateSpawnPoints();
    this._generateCoverPositions();

    this._culled = mergeStaticMeshes(this.scene, this._statics, {
      mapHalf: MAP_HALF,
      chunkCount: CHUNK_COUNT,
      bandCull: this.bandCull,
      chunkBands: [BAND_NEAR],
      castShadow: this.castShadow,
    });
    this._statics.length = 0;
  }

  _buildMaterials() {
    this.mat = createWorldMaterials(this.quality, this.assetFactory, 400);
  }

  _createColliderResources() {
    this._colliderGeometry = new THREE.BoxGeometry(1, 1, 1);
    this._colliderMaterial = new THREE.MeshBasicMaterial({ visible: false });
  }

  _addCollider(mesh, scale, x, y, z, ry) {
    mesh.position.set(x, y, z);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    if (ry) mesh.rotation.y = ry;
    this.scene.add(mesh);
    this.physics.addCollider(mesh);
    this.colliders.push(mesh);
  }

  _push(mesh, material, color, cast, receive, band, flat) {
    mesh.material = material;
    this._statics.push({
      mesh,
      material,
      color: color === undefined ? 0xffffff : color,
      cast: cast === true && this.castShadow,
      receive: receive !== false,
      band: band === BAND_NEAR ? BAND_NEAR : BAND_FAR,
      flat: flat === true,
    });
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

  _createGround() {
    const seg = SEG_GROUND[this.pd];
    const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, seg, seg);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const dist = Math.sqrt(x * x + y * y);
      const noise = Math.sin(x * 0.25) * Math.cos(y * 0.25) * 0.12
        + Math.sin(x * 0.7 + 1.5) * Math.cos(y * 0.6) * 0.06;
      pos.setZ(i, noise * Math.min(dist / 20, 1) * 0.3);
    }
    geo.computeVertexNormals();

    const ground = new THREE.Mesh(geo, this.mat.stone);
    ground.rotation.x = -Math.PI / 2;
    ground.name = 'ground';
    this._push(ground, this.mat.stone, 0x59564c, false, true, BAND_FAR, true);

    const collider = new THREE.Mesh(this._colliderGeometry, this._colliderMaterial);
    this._addCollider(collider, [MAP_SIZE, 0.4, MAP_SIZE], 0, -0.2, 0, 0);
  }

  _createPerimeterWalls() {
    const wallDefs = PERIMETER;

    for (const def of wallDefs) {
      const [x, z] = def.pos;
      const [w, h, d] = def.size;

      const wall = new THREE.Mesh(this._box(w, h, d), this.mat.stone);
      wall.position.set(x, h / 2, z);
      this._push(wall, this.mat.stone, 0x8a8578, true, true, BAND_FAR, false);

      const collider = new THREE.Mesh(this._colliderGeometry, this._colliderMaterial);
      this._addCollider(collider, [w, h, d], x, h / 2, z, 0);

      this._addWallDetails(x, z, w, h, d);
    }
  }

  _addWallDetails(x, z, w, h, d) {
    const horizontal = w > d;

    const trim = new THREE.Mesh(this._box(w + 0.2, 0.26, d + 0.2), this.mat.metal);
    trim.position.set(x, h + 0.13, z);
    this._push(trim, this.mat.metal, 0x5a5a52, true, true, BAND_FAR, false);

    const base = new THREE.Mesh(this._box(w + 0.15, 0.4, d + 0.15), this.mat.stone);
    base.position.set(x, 0.2, z);
    this._push(base, this.mat.stone, 0x7a7568, false, true, BAND_FAR, false);

    const span = horizontal ? w : d;
    const count = Math.max(2, Math.floor(span / 16));
    for (let i = 0; i < count; i++) {
      const t = ((i + 0.5) / count - 0.5);
      const sign = new THREE.Mesh(this._plane(1.5, 1), this.mat.decal);
      const offset = (horizontal ? d : w) / 2 + 0.05;
      if (horizontal) {
        sign.position.set(x + t * span * 0.82, h * 0.62, z + (z < 0 ? offset : -offset));
        sign.rotation.y = z < 0 ? 0 : Math.PI;
      } else {
        sign.position.set(x + (x < 0 ? offset : -offset), h * 0.62, z + t * span * 0.82);
        sign.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      }
      this._push(sign, this.mat.decal, 0xb89a3a, false, false, BAND_NEAR, false);
    }

    if (this.pd === 0) return;

    const pipe = new THREE.Mesh(this._cyl(0.09, 0.09, h * 0.9, SEG_LOW[this.pd]), this.mat.metal);
    if (horizontal) {
      pipe.position.set(x, h * 0.45, z + (z < 0 ? -d / 2 - 0.2 : d / 2 + 0.2));
    } else {
      pipe.position.set(x + (x < 0 ? -w / 2 - 0.2 : w / 2 + 0.2), h * 0.45, z);
    }
    this._push(pipe, this.mat.metal, 0x4a4a42, true, true, BAND_FAR, false);
  }

  _createBuildings() {
    for (const config of BUILDINGS) {
      this._createBuilding(config);
    }
  }

  _createBuilding(config) {
    const [width, height, depth] = config.size;
    const [x, z] = config.pos;
    const body = new THREE.Mesh(this._box(width, height, depth), this.mat.stone);
    body.position.set(x, height / 2, z);
    const bodyTint = config.style === 'metal' ? 0x6e6e78 : 0x9a9588;
    this._push(body, this.mat.stone, bodyTint, true, true, BAND_FAR, false);

    const collider = new THREE.Mesh(this._colliderGeometry, this._colliderMaterial);
    this._addCollider(collider, [width, height, depth], x, height / 2, z, 0);

    this._addFacadeShell(width, height, depth, x, z);

    this._addWindows(width, height, depth, x, z);
    this._addRoofDetails(width, height, depth, x, z);
    this._addDoorway(width, height, depth, x, z);

    if (this.bd >= 1) this._addArchitecturalDetails(width, height, depth, x, z);
    if (this.bd >= 2) this._addBalcony(width, height, depth, x, z);
  }

  _addFacadeShell(width, height, depth, x, z) {
    const stone = this.mat.stone;
    const metal = this.mat.metal;
    const h = height;

    const plinth = new THREE.Mesh(this._box(width + 0.5, 0.9, depth + 0.5), stone);
    plinth.position.set(x, 0.45, z);
    this._push(plinth, stone, 0x6f6a5e, false, true, BAND_FAR, false);

    const band = new THREE.Mesh(this._box(width + 0.34, 0.3, depth + 0.34), stone);
    band.position.set(x, 3.15, z);
    this._push(band, stone, 0x7a7568, false, true, BAND_FAR, false);

    const parapetH = this.bd >= 1 ? 1.05 : 0.7;
    const pt = 0.26;
    const roofY = h + parapetH / 2;
    const spans = [
      [width + 0.4, pt, 0, (depth + 0.4) / 2 - pt / 2],
      [width + 0.4, pt, 0, -(depth + 0.4) / 2 + pt / 2],
      [pt, width * 0 + pt, (width + 0.4) / 2 - pt / 2, 0],
      [pt, width * 0 + pt, -(width + 0.4) / 2 + pt / 2, 0],
    ];
    for (let i = 0; i < 4; i++) {
      const [sx, sy, dx, dz] = spans[i];
      const w = i < 2 ? sx : pt;
      const d = i < 2 ? pt : sx;
      const parapet = new THREE.Mesh(this._box(w, parapetH, d), stone);
      parapet.position.set(x + dx, roofY, z + dz);
      this._push(parapet, stone, 0x847f72, true, true, BAND_FAR, false);
    }

    const capA = new THREE.Mesh(this._box(width + 0.6, 0.16, depth + 0.6), stone);
    capA.position.set(x, h + parapetH + 0.08, z);
    this._push(capA, stone, 0x8e897c, false, true, BAND_FAR, false);

    const pilW = 0.42;
    for (let i = 0; i < 4; i++) {
      const sx = i < 2 ? -1 : 1;
      const sz = i % 2 === 0 ? -1 : 1;
      const pil = new THREE.Mesh(this._box(pilW, h, pilW), stone);
      pil.position.set(
        x + sx * (width / 2 - pilW / 4),
        h / 2,
        z + sz * (depth / 2 - pilW / 4)
      );
      this._push(pil, stone, 0x847f72, false, true, BAND_FAR, false);
    }

    if (this.bd >= 1) {
      const pipe = new THREE.Mesh(this._box(0.16, h * 0.92, 0.16), metal);
      pipe.position.set(x - width / 2 + 0.55, h * 0.46, z + depth / 2 + 0.1);
      this._push(pipe, metal, 0x4c4c4c, false, true, BAND_FAR, false);
    }
  }

  _addWindows(width, height, depth, ox, oz) {
    const floors = Math.max(1, Math.floor((height - 3) / FLOOR_HEIGHT));
    const glassy = this.bd >= 1;
    const ww = 1.3;
    const wh = 1.7;

    for (let floor = 0; floor < floors; floor++) {
      const y = 2.6 + floor * FLOOR_HEIGHT;

      for (let x = -width / 2 + 2.6; x < width / 2 - 1.4; x += WINDOW_SPACING) {
        this._addWindow(ox + x, y, oz + depth / 2 + 0.04, 0, ww, wh, glassy);
        this._addWindow(ox + x, y, oz - depth / 2 - 0.04, Math.PI, ww, wh, glassy);
      }

      for (let z = -depth / 2 + 2.6; z < depth / 2 - 1.4; z += WINDOW_SPACING) {
        this._addWindow(ox + width / 2 + 0.04, y, oz + z, Math.PI / 2, ww, wh, glassy);
        this._addWindow(ox - width / 2 - 0.04, y, oz + z, -Math.PI / 2, ww, wh, glassy);
      }
    }
  }

  _addWindow(x, y, z, ry, w, h, glassy) {
    const nx = Math.sin(ry);
    const nz = Math.cos(ry);

    const reveal = new THREE.Mesh(this._box(w + 0.26, h + 0.26, 0.18), this.mat.metal);
    reveal.position.set(x - nx * 0.07, y, z - nz * 0.07);
    reveal.rotation.y = ry;
    this._push(reveal, this.mat.metal, 0x33333a, false, true, BAND_FAR, false);

    const glass = new THREE.Mesh(this._plane(w, h), this.mat.glass);
    glass.position.set(x, y, z);
    glass.rotation.y = ry;
    this._push(glass, glassy ? this.mat.glass : this.mat.stone, glassy ? 0x62748c : 0x3c4550, false, false, BAND_FAR, false);

    const sill = new THREE.Mesh(this._box(w + 0.46, 0.14, 0.3), this.mat.stone);
    sill.position.set(x - nx * 0.04, y - h / 2 - 0.11, z - nz * 0.04);
    sill.rotation.y = ry;
    this._push(sill, this.mat.stone, 0x8a8578, false, true, BAND_FAR, false);

    const lintel = new THREE.Mesh(this._box(w + 0.46, 0.12, 0.26), this.mat.stone);
    lintel.position.set(x - nx * 0.02, y + h / 2 + 0.09, z - nz * 0.02);
    lintel.rotation.y = ry;
    this._push(lintel, this.mat.stone, 0x827d70, false, true, BAND_FAR, false);

    if (this.bd < 1) return;

    const mullion = new THREE.Mesh(this._box(0.06, h, 0.1), this.mat.metal);
    mullion.position.set(x - nx * 0.02, y, z - nz * 0.02);
    mullion.rotation.y = ry;
    this._push(mullion, this.mat.metal, 0x2f2f2f, false, false, BAND_FAR, false);
  }

  _addRoofDetails(width, height, depth, ox, oz) {
    const acCount = AC_COUNT[this.bd];
    for (let i = 0; i < acCount; i++) {
      const ax = ox + (Math.random() - 0.5) * (width - 5);
      const az = oz + (Math.random() - 0.5) * (depth - 5);

      const ac = new THREE.Mesh(this._box(2, 1.2, 1.6), this.mat.metal);
      ac.position.set(ax, height + 0.85, az);
      this._push(ac, this.mat.metal, 0x7a7a82, true, true, BAND_FAR, false);

      if (this.bd < 2) continue;

      const fan = new THREE.Mesh(this._cyl(0.6, 0.6, 0.14, SEG_LOW[this.bd]), this.mat.metal);
      fan.position.set(ax, height + 1.5, az);
      this._push(fan, this.mat.metal, 0x6a6a72, false, false, BAND_FAR, false);
    }

    if (this.bd < 1) return;

    const antenna = new THREE.Mesh(this._cyl(0.08, 0.13, 6, SEG_LOW[this.pd]), this.mat.metal);
    antenna.position.set(ox + (Math.random() - 0.5) * (width - 4), height + 3.2, oz + (Math.random() - 0.5) * (depth - 4));
    this._push(antenna, this.mat.metal, 0x4a4a4a, true, false, BAND_FAR, false);

    const tip = new THREE.Mesh(this._sph(0.22, SEG_LOW[this.pd]), this.mat.decal);
    tip.position.set(antenna.position.x, height + 6.2, antenna.position.z);
    this._push(tip, this.mat.decal, 0xff2222, false, false, BAND_FAR, false);

    const crossA = new THREE.Mesh(this._box(1.6, 0.06, 0.06), this.mat.metal);
    crossA.position.set(antenna.position.x, height + 4.4, antenna.position.z);
    this._push(crossA, this.mat.metal, 0x4a4a4a, false, false, BAND_FAR, false);

    const crossB = new THREE.Mesh(this._box(0.06, 0.06, 1.6), this.mat.metal);
    crossB.position.set(antenna.position.x, height + 4.4, antenna.position.z);
    this._push(crossB, this.mat.metal, 0x4a4a4a, false, false, BAND_FAR, false);

    const pipeCount = this.bd >= 2 ? 3 : 1;
    for (let i = 0; i < pipeCount; i++) {
      const pipe = new THREE.Mesh(this._cyl(0.1, 0.1, height * 0.6, SEG_LOW[this.pd]), this.mat.metal);
      pipe.position.set(ox + (Math.random() - 0.5) * (width - 2), height * 0.3, oz + depth / 2 + 0.22);
      this._push(pipe, this.mat.metal, 0x5a5a52, true, true, BAND_FAR, false);
    }
  }

  _addDoorway(width, height, depth, ox, oz) {
    if (this.bd < 1) return;

    const doorWidth = 2.1;
    const doorHeight = 2.4;
    const front = oz + depth / 2;

    const recess = new THREE.Mesh(this._box(doorWidth + 0.9, doorHeight + 0.5, 0.55), this.mat.stone);
    recess.position.set(ox, doorHeight / 2, front + 0.18);
    this._push(recess, this.mat.stone, 0x6a6558, false, true, BAND_FAR, false);

    const door = new THREE.Mesh(this._box(doorWidth, doorHeight, 0.18), this.mat.metal);
    door.position.set(ox, doorHeight / 2, front + 0.34);
    this._push(door, this.mat.metal, 0x4a4a42, true, true, BAND_FAR, false);

    const step = new THREE.Mesh(this._box(doorWidth + 1.6, 0.22, 1.6), this.mat.stone);
    step.position.set(ox, 0.11, front + 0.9);
    this._push(step, this.mat.stone, 0x7a7568, false, true, BAND_FAR, false);

    if (this.bd < 2) return;

    const awning = new THREE.Mesh(this._box(doorWidth + 1.1, 0.12, 1.3), this.mat.metal);
    awning.position.set(ox, doorHeight + 0.5, front + 0.8);
    awning.rotation.x = 0.18;
    this._push(awning, this.mat.metal, 0x3a3a32, true, true, BAND_FAR, false);

    const handle = new THREE.Mesh(this._cyl(0.05, 0.05, 0.35, SEG_LOW[this.pd]), this.mat.metal);
    handle.rotation.z = Math.PI / 2;
    handle.position.set(ox + doorWidth / 2 - 0.3, doorHeight / 2, front + 0.46);
    this._push(handle, this.mat.metal, 0x8a8a8a, false, false, BAND_FAR, false);
  }

  _addArchitecturalDetails(width, height, depth, ox, oz) {
    const floors = Math.max(1, Math.floor(height / FLOOR_HEIGHT));

    for (let floor = 1; floor < floors; floor++) {
      const band = new THREE.Mesh(this._box(width + 0.3, 0.2, depth + 0.3), this.mat.stone);
      band.position.set(ox, floor * FLOOR_HEIGHT, oz);
      this._push(band, this.mat.stone, 0x8a8578, true, true, BAND_FAR, false);
    }

    if (this.bd >= 2) {
      const corners = [
        [width / 2 + 0.1, depth / 2 + 0.1],
        [width / 2 + 0.1, -depth / 2 - 0.1],
        [-width / 2 - 0.1, depth / 2 + 0.1],
        [-width / 2 - 0.1, -depth / 2 - 0.1],
      ];
      for (const [cx, cz] of corners) {
        const corner = new THREE.Mesh(this._box(0.38, height, 0.38), this.mat.stone);
        corner.position.set(ox + cx, height / 2, oz + cz);
        this._push(corner, this.mat.stone, 0x7a7568, true, true, BAND_FAR, false);
      }

      const stains = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < stains; i++) {
        const stain = new THREE.Mesh(this._plane(1.6 + Math.random() * 2.4, 3 + Math.random() * 4), this.mat.decal);
        stain.position.set(
          ox + (Math.random() - 0.5) * (width - 3),
          2 + Math.random() * (height - 4),
          oz + depth / 2 + 0.05
        );
        this._push(stain, this.mat.decal, 0x3a352a, false, false, BAND_NEAR, false);
      }
    }

    const vents = this.bd >= 2 ? 2 : 1;
    for (let i = 0; i < vents; i++) {
      const vent = new THREE.Mesh(this._box(0.85, 0.62, 0.16), this.mat.metal);
      vent.position.set(
        ox + (Math.random() - 0.5) * (width - 3),
        1.5 + Math.random() * (height - 3),
        oz + depth / 2 + 0.09
      );
      this._push(vent, this.mat.metal, 0x5a5a52, false, true, BAND_NEAR, false);
    }
  }

  _addBalcony(width, height, depth, ox, oz) {
    if (height < 12) return;

    const y = FLOOR_HEIGHT * 3;
    if (y > height - 3) return;

    const bw = Math.min(4.4, width * 0.4);
    const bd = 1.6;
    const front = oz + depth / 2;

    const floor = new THREE.Mesh(this._box(bw, 0.16, bd), this.mat.metal);
    floor.position.set(ox, y, front + bd / 2);
    this._push(floor, this.mat.metal, 0x4a4a42, true, true, BAND_FAR, false);

    const railingH = 1;
    const rail = new THREE.Mesh(this._box(bw, railingH, 0.07), this.mat.metal);
    rail.position.set(ox, y + railingH / 2 + 0.08, front + bd);
    this._push(rail, this.mat.metal, 0x3a3a3a, true, true, BAND_FAR, false);

    for (const side of [-1, 1]) {
      const sideRail = new THREE.Mesh(this._box(0.07, railingH, bd), this.mat.metal);
      sideRail.position.set(ox + side * bw / 2, y + railingH / 2 + 0.08, front + bd / 2);
      this._push(sideRail, this.mat.metal, 0x3a3a3a, true, true, BAND_FAR, false);
    }
  }

  _createStreets() {
    const street = new THREE.Mesh(this._plane(MAP_SIZE, STREET_WIDTH), this.mat.stone);
    street.rotation.x = -Math.PI / 2;
    street.position.set(0, 0.03, 0);
    this._push(street, this.mat.stone, 0x33322e, false, true, BAND_FAR, true);

    const cross = new THREE.Mesh(this._plane(STREET_WIDTH, MAP_SIZE), this.mat.stone);
    cross.rotation.x = -Math.PI / 2;
    cross.rotation.z = Math.PI / 2;
    cross.position.set(0, 0.032, 0);
    this._push(cross, this.mat.stone, 0x33322e, false, true, BAND_FAR, true);

    this._addRoadMarkings();
    this._addCurbs();
    this._addSidewalks();
  }

  _addRoadMarkings() {
    const dashGeo = this._plane(4, 0.22);
    for (let i = -32; i <= 32; i += 8) {
      const h = new THREE.Mesh(dashGeo, this.mat.decal);
      h.rotation.x = -Math.PI / 2;
      h.position.set(i, 0.05, 0);
      this._push(h, this.mat.decal, 0xbbaa77, false, false, BAND_FAR, true);

      const v = new THREE.Mesh(dashGeo, this.mat.decal);
      v.rotation.x = -Math.PI / 2;
      v.rotation.z = Math.PI / 2;
      v.position.set(0, 0.05, i);
      this._push(v, this.mat.decal, 0xbbaa77, false, false, BAND_FAR, true);
    }

    const lineGeo = this._plane(MAP_SIZE, 0.16);
    for (const offset of [4.8, -4.8]) {
      const h = new THREE.Mesh(lineGeo, this.mat.decal);
      h.rotation.x = -Math.PI / 2;
      h.position.set(0, 0.045, offset);
      this._push(h, this.mat.decal, 0x8f8f7e, false, false, BAND_FAR, true);

      const v = new THREE.Mesh(lineGeo, this.mat.decal);
      v.rotation.x = -Math.PI / 2;
      v.rotation.z = Math.PI / 2;
      v.position.set(offset, 0.045, 0);
      this._push(v, this.mat.decal, 0x8f8f7e, false, false, BAND_FAR, true);
    }
  }

  _addCurbs() {
    const half = STREET_WIDTH / 2;
    const w = 0.35;
    const h = 0.2;
    const defs = [
      { pos: [0, half + w / 2], size: [MAP_SIZE, h, w] },
      { pos: [0, -half - w / 2], size: [MAP_SIZE, h, w] },
      { pos: [half + w / 2, 0], size: [w, h, MAP_SIZE] },
      { pos: [-half - w / 2, 0], size: [w, h, MAP_SIZE] },
    ];

    for (const def of defs) {
      const curb = new THREE.Mesh(this._box(def.size[0], def.size[1], def.size[2]), this.mat.stone);
      curb.position.set(def.pos[0], h / 2, def.pos[1]);
      this._push(curb, this.mat.stone, 0x7a7568, false, true, BAND_FAR, true);
    }
  }

  _addSidewalks() {
    const half = STREET_WIDTH / 2;
    const w = 3;
    const h = 0.16;
    const defs = [
      { pos: [0, half + w / 2 + 0.35], size: [MAP_SIZE, h, w] },
      { pos: [0, -half - w / 2 - 0.35], size: [MAP_SIZE, h, w] },
      { pos: [half + w / 2 + 0.35, 0], size: [w, h, MAP_SIZE] },
      { pos: [-half - w / 2 - 0.35, 0], size: [w, h, MAP_SIZE] },
    ];

    for (const def of defs) {
      const walk = new THREE.Mesh(this._box(def.size[0], def.size[1], def.size[2]), this.mat.stone);
      walk.position.set(def.pos[0], h / 2, def.pos[1]);
      this._push(walk, this.mat.stone, 0x8a8578, false, true, BAND_FAR, true);
    }
  }

  _createCoverObjects() {
    this._createConcreteBarriers();
    this._createSandbagWalls();
    this._createBurntCars();
  }

  _createConcreteBarriers() {
    const positions = [
      [12, 9], [-12, -9], [19, -13], [-19, 13],
      [8, -19], [-8, 19], [24, 8], [-24, -8],
    ];

    for (const [x, z] of positions) {
      const rot = Math.random() * Math.PI;

      const base = new THREE.Mesh(this._box(3, 0.36, 0.95), this.mat.stone);
      base.position.set(x, 0.18, z);
      base.rotation.y = rot;
      this._push(base, this.mat.stone, 0x8a8578, true, true, BAND_FAR, false);

      const body = new THREE.Mesh(this._box(2.7, 1.2, 0.58), this.mat.stone);
      body.position.set(x, 0.96, z);
      body.rotation.y = rot;
      this._push(body, this.mat.stone, 0x9a9588, true, true, BAND_FAR, false);

      const stripe = new THREE.Mesh(this._box(2.74, 0.26, 0.6), this.mat.decal);
      stripe.position.set(x, 1.26, z);
      stripe.rotation.y = rot;
      this._push(stripe, this.mat.decal, 0xaa3322, false, false, BAND_FAR, false);

      const collider = new THREE.Mesh(this._colliderGeometry, this._colliderMaterial);
      this._addCollider(collider, [3, 1.6, 0.95], x, 0.7, z, rot);

      this.coverObjects.push({ x, z, width: 3 });
    }
  }

  _createSandbagWalls() {
    const positions = [
      [15, 0, 0.3], [-15, 0, -0.3], [0, 15, 0.1], [0, -15, -0.1],
    ];
    const rows = this.pd === 0 ? 4 : 5;

    for (const [x, z, rot] of positions) {
      for (let row = 0; row < rows; row++) {
        const bags = 7 - row;
        for (let i = 0; i < bags; i++) {
          const bag = new THREE.Mesh(this._sph(0.35, SEG_LOW[this.pd]), this.mat.fabric);
          bag.scale.set(1.3, 0.55, 0.9);
          bag.position.set(
            x + (i - (bags - 1) / 2) * 0.72 + (Math.random() - 0.5) * 0.14,
            0.22 + row * 0.35,
            z + (Math.random() - 0.5) * 0.14
          );
          bag.rotation.y = rot + (Math.random() - 0.5) * 0.3;
          this._push(bag, this.mat.fabric, 0x6b6a52, this.pd > 0, true, BAND_FAR, false);
        }
      }

      const collider = new THREE.Mesh(this._colliderGeometry, this._colliderMaterial);
      this._addCollider(collider, [4.6, 1.7, 1.1], x, 0.8, z, rot);
      this.coverObjects.push({ x, z, width: 4.6 });
    }
  }

  _createBurntCars() {
    const cars = [
      { pos: [13, 6], rot: 0.4, tint: 0x1a1a1a },
      { pos: [-13, -6], rot: -0.3, tint: 0x24211f },
      { pos: [6, 19], rot: 1.2, tint: 0x1c1c1c },
      { pos: [-7, -20], rot: -1.1, tint: 0x282420 },
    ];

    for (const car of cars) {
      this._createCar(car);
    }
  }

  _createCar({ pos, rot, tint: bodyTint }) {
    const [x, z] = pos;
    const glassy = this.pd > 0;

    const body = new THREE.Mesh(this._box(4.4, 1.0, 2), this.mat.metal);
    body.position.set(x, 0.7, z);
    body.rotation.y = rot;
    this._push(body, this.mat.metal, bodyTint, true, true, BAND_FAR, false);

    const cabin = new THREE.Mesh(this._box(2.4, 0.8, 1.8), this.mat.metal);
    cabin.position.set(x, 1.6, z);
    cabin.rotation.y = rot;
    this._push(cabin, this.mat.metal, bodyTint, true, true, BAND_FAR, false);

    const wheelGeo = this._cyl(0.38, 0.38, 0.3, SEG_LOW[this.pd]);
    for (const [wx, wz] of [[1.5, 1], [1.5, -1], [-1.5, 1], [-1.5, -1]]) {
      const wheel = new THREE.Mesh(wheelGeo, this.mat.decal);
      wheel.rotation.order = 'YXZ';
      wheel.rotation.x = Math.PI / 2;
      wheel.rotation.y = rot;
      wheel.position.set(x + wx * Math.cos(rot) + wz * Math.sin(rot), 0.35, z - wx * Math.sin(rot) + wz * Math.cos(rot));
      this._push(wheel, this.mat.decal, 0x121212, true, false, BAND_FAR, false);
    }

    if (glassy) {
      const hood = new THREE.Mesh(this._box(1.2, 0.15, 1.8), this.mat.metal);
      hood.position.set(x + 1.6 * Math.cos(rot), 1.25, z - 1.6 * Math.sin(rot));
      hood.rotation.y = rot;
      this._push(hood, this.mat.metal, bodyTint, true, true, BAND_FAR, false);

      const trunk = new THREE.Mesh(this._box(1.0, 0.14, 1.7), this.mat.metal);
      trunk.position.set(x - 1.7 * Math.cos(rot), 1.2, z + 1.7 * Math.sin(rot));
      trunk.rotation.y = rot;
      this._push(trunk, this.mat.metal, bodyTint, true, true, BAND_FAR, false);

      const windshield = new THREE.Mesh(this._plane(1.7, 0.65), this.mat.glass);
      windshield.position.set(x + 0.9 * Math.cos(rot), 1.6, z - 0.9 * Math.sin(rot));
      windshield.rotation.set(-0.2, rot + Math.PI / 2, 0);
      this._push(windshield, this.mat.glass, 0x101418, false, false, BAND_FAR, false);

      const rear = new THREE.Mesh(this._plane(1.5, 0.55), this.mat.glass);
      rear.position.set(x - 1.5 * Math.cos(rot), 1.6, z + 1.5 * Math.sin(rot));
      rear.rotation.set(0.15, rot - Math.PI / 2, 0);
      this._push(rear, this.mat.glass, 0x101418, false, false, BAND_FAR, false);
    }

    const front = new THREE.Mesh(this._box(0.2, 0.36, 1.9), this.mat.metal);
    front.position.set(x + 2.3 * Math.cos(rot), 0.45, z - 2.3 * Math.sin(rot));
    front.rotation.y = rot;
    this._push(front, this.mat.metal, 0x2a2a2a, true, true, BAND_FAR, false);

    const rearBumper = new THREE.Mesh(this._box(0.2, 0.36, 1.9), this.mat.metal);
    rearBumper.position.set(x - 2.3 * Math.cos(rot), 0.45, z + 2.3 * Math.sin(rot));
    rearBumper.rotation.y = rot;
    this._push(rearBumper, this.mat.metal, 0x2a2a2a, true, true, BAND_FAR, false);

    const collider = new THREE.Mesh(this._colliderGeometry, this._colliderMaterial);
    this._addCollider(collider, [4.6, 2, 2.2], x, 1, z, rot);
    this.coverObjects.push({ x, z, width: 4.6 });
  }

  _createDebris() {
    const piles = [
      [9, 11], [-10, -10], [19, 9], [-19, -9],
      [11, -21], [-12, 22], [26, -16], [-26, 16],
      [17, 24], [-16, -25],
    ];
    const per = DEBRIS_PER_PILE[this.pd];

    for (const [x, z] of piles) {
      for (let i = 0; i < per; i++) {
        const size = 0.24 + Math.random() * 0.8;
        const chunk = new THREE.Mesh(this._box(size, size * 0.55, size * 0.8), this.mat.stone);
        chunk.position.set(
          x + (Math.random() - 0.5) * 3,
          size * 0.3,
          z + (Math.random() - 0.5) * 3
        );
        chunk.rotation.set(Math.random() * 0.7, Math.random() * Math.PI, Math.random() * 0.7);
        this._push(chunk, this.mat.stone, 0x6a6558, false, true, BAND_NEAR, false);
      }

      if (this.pd === 0) continue;

      const rebar = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < rebar; i++) {
        const bar = new THREE.Mesh(this._cyl(0.02, 0.02, 0.9 + Math.random() * 0.7, 4), this.mat.metal);
        bar.position.set(x + (Math.random() - 0.5) * 2.2, 0.4, z + (Math.random() - 0.5) * 2.2);
        bar.rotation.set(Math.random() * 0.9 - 0.45, Math.random() * Math.PI, Math.random() * 0.9 - 0.45);
        this._push(bar, this.mat.metal, 0x4a3020, false, false, BAND_NEAR, false);
      }
    }
  }

  _createPlaza() {
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(12, SEG_CIRCLE[this.pd]), this.mat.stone);
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.y = 0.035;
    this._push(plaza, this.mat.stone, 0x7a7568, false, true, BAND_FAR, true);

    if (this.pd >= 1) {
      const tileGeo = this._plane(TILE_PITCH, TILE_PITCH);
      for (let x = -9; x <= 9; x += TILE_PITCH) {
        for (let z = -9; z <= 9; z += TILE_PITCH) {
          if (x * x + z * z > 100) continue;
          const tile = new THREE.Mesh(tileGeo, this.mat.decal);
          tile.rotation.x = -Math.PI / 2;
          tile.position.set(x, 0.042, z);
          this._push(tile, this.mat.decal, 0x8f8b7c, false, false, BAND_FAR, true);
        }
      }
    }

    const base = new THREE.Mesh(this._cyl(2.5, 2.8, 0.7, SEG_RING[this.pd]), this.mat.stone);
    base.position.set(0, 0.35, 0);
    this._push(base, this.mat.stone, 0x8a8578, true, true, BAND_FAR, false);

    const water = new THREE.Mesh(new THREE.CircleGeometry(2.2, SEG_CIRCLE[this.pd]), this.mat.decal);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.7, 0);
    this._push(water, this.mat.decal, 0x2f5464, false, false, BAND_FAR, false);

    const pillar = new THREE.Mesh(this._cyl(0.34, 0.5, 2.5, SEG_LOW[this.pd]), this.mat.stone);
    pillar.position.set(0, 1.75, 0);
    this._push(pillar, this.mat.stone, 0x8a8578, true, true, BAND_FAR, false);

    if (this.pd >= 1) {
      const broken = new THREE.Mesh(this._box(1.2, 0.4, 1.2), this.mat.stone);
      broken.position.set(0.4, 3.2, 0.3);
      broken.rotation.set(0.3, 0.7, 0.2);
      this._push(broken, this.mat.stone, 0x8a8578, true, true, BAND_FAR, false);
    }

    const collider = new THREE.Mesh(this._colliderGeometry, this._colliderMaterial);
    this._addCollider(collider, [5.4, 1.4, 5.4], 0, 0.7, 0, 0);

    const benches = [
      { pos: [5.5, 0], rot: 0 },
      { pos: [-5.5, 0], rot: Math.PI },
      { pos: [0, 5.5], rot: Math.PI / 2 },
      { pos: [0, -5.5], rot: -Math.PI / 2 },
    ];

    for (const bench of benches) {
      const [bx, bz] = bench.pos;
      const seat = new THREE.Mesh(this._box(2.2, 0.1, 0.55), this.mat.wood);
      seat.position.set(bx, 0.48, bz);
      seat.rotation.y = bench.rot;
      this._push(seat, this.mat.wood, 0x5a4a3a, true, true, BAND_FAR, false);

      const back = new THREE.Mesh(this._box(2.2, 0.55, 0.08), this.mat.wood);
      back.position.set(bx - Math.sin(bench.rot) * 0.25, 0.78, bz - Math.cos(bench.rot) * 0.25);
      back.rotation.set(-0.18, bench.rot, 0);
      this._push(back, this.mat.wood, 0x5a4a3a, true, true, BAND_FAR, false);

      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(this._box(0.08, 0.48, 0.45), this.mat.metal);
        leg.position.set(
          bx + side * 0.9 * Math.cos(bench.rot),
          0.24,
          bz - side * 0.9 * Math.sin(bench.rot)
        );
        leg.rotation.y = bench.rot;
        this._push(leg, this.mat.metal, 0x3a3a3a, true, true, BAND_FAR, false);
      }
    }
  }

  _createAlleyways() {
    const alleyLength = 16;
    const alleyWidth = 3;
    const defs = [
      { pos: [-8, -24], rot: 0 },
      { pos: [9, 24], rot: 0 },
    ];

    for (const def of defs) {
      const [x, z] = def.pos;
      const alley = new THREE.Mesh(this._plane(alleyWidth, alleyLength), this.mat.stone);
      alley.rotation.x = -Math.PI / 2;
      alley.rotation.z = def.rot;
      alley.position.set(x, 0.04, z);
      this._push(alley, this.mat.stone, 0x6a6558, false, true, BAND_FAR, true);

      for (const side of [-1, 1]) {
        const offset = side * (alleyWidth / 2 + 0.18);
        const wall = new THREE.Mesh(this._box(0.36, 4, alleyLength), this.mat.stone);
        wall.position.set(x + offset, 2, z);
        wall.rotation.y = def.rot;
        this._push(wall, this.mat.stone, 0x7a7568, true, true, BAND_FAR, false);

        const collider = new THREE.Mesh(this._colliderGeometry, this._colliderMaterial);
        this._addCollider(collider, [0.36, 4, alleyLength], x + offset, 2, z, def.rot);
      }
    }
  }

  _createElevatedPositions() {
    const defs = [
      { pos: [0, -18], size: [6, 4], height: 3 },
      { pos: [0, 18], size: [6, 4], height: 3 },
      { pos: [-18, 0], size: [4, 6], height: 3 },
    ];

    for (const def of defs) {
      const [x, z] = def.pos;
      const [w, d] = def.size;
      const h = def.height;

      const platform = new THREE.Mesh(this._box(w, 0.3, d), this.mat.metal);
      platform.position.set(x, h, z);
      this._push(platform, this.mat.metal, 0x4a4a42, true, true, BAND_FAR, false);

      if (this.pd >= 1) {
        const supportGeo = this._cyl(0.1, 0.12, h, SEG_LOW[this.pd]);
        for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
          const support = new THREE.Mesh(supportGeo, this.mat.metal);
          support.position.set(x + sx * (w / 2 - 0.3), h / 2, z + sz * (d / 2 - 0.3));
          this._push(support, this.mat.metal, 0x4a4a42, true, true, BAND_FAR, false);
        }

        const railH = 1;
        const railX = new THREE.Mesh(this._box(w, railH, 0.06), this.mat.metal);
        railX.position.set(x, h + railH / 2 + 0.15, z + d / 2);
        this._push(railX, this.mat.metal, 0x3a3a3a, true, true, BAND_FAR, false);

        const railZ = new THREE.Mesh(this._box(0.06, railH, d), this.mat.metal);
        railZ.position.set(x + w / 2, h + railH / 2 + 0.15, z);
        this._push(railZ, this.mat.metal, 0x3a3a3a, true, true, BAND_FAR, false);
      }

      const collider = new THREE.Mesh(this._colliderGeometry, this._colliderMaterial);
      this._addCollider(collider, [w, 0.3, d], x, h, z, 0);
      this.coverObjects.push({ x, z, width: Math.max(w, d) });
    }
  }

  _generateSpawnPoints() {
    this.spawnPoints = SPAWN_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z));
  }

  _generateCoverPositions() {
    const raw = [
      [12, 9], [-12, -9], [19, -13], [-19, 13],
      [8, -19], [-8, 19], [24, 8], [-24, -8],
      [15, 0], [-15, 0], [0, 15], [0, -15],
      [13, 6], [-13, -6],
    ];
    this.coverPositions = raw.map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.objectivePositions = [
      { x: -20, z: -24 },
      { x: 23, z: 22 },
      { x: 0, z: 0 },
    ];
  }

  getSpawnPoints() {
    return this.spawnPoints;
  }

  getCoverPositions() {
    return this.coverPositions;
  }

  getBounds() {
    return this.bounds;
  }

  update(dt, cameraPosition) {
    if (!cameraPosition) return;

    const x = cameraPosition.x;
    const y = cameraPosition.y;
    const z = cameraPosition.z;

    for (let i = 0; i < this._culled.length; i++) {
      const lod = this._culled[i];
      const cullSq = lod.userData.cullDistanceSq;
      const dx = lod.position.x - x;
      const dz = lod.position.z - z;
      const visible = (dx * dx + dz * dz + y * y) < cullSq;
      if (lod.visible !== visible) lod.visible = visible;
    }
  }
}