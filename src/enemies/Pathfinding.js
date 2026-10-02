import * as THREE from 'three';

const _losDir = new THREE.Vector3();
const _avoidanceVec = new THREE.Vector3();
const _separationVec = new THREE.Vector3();
const _toObsVec = new THREE.Vector3();
const _diffVec = new THREE.Vector3();
const _patrolVec = new THREE.Vector3();
const _coverOut = new THREE.Vector3();
const _directVec = new THREE.Vector3();

const WAYPOINT_RADIUS = 2.5;
const CONNECTION_RADIUS = 10;
const GRID_SIZE = 8;
const MAX_WAYPOINTS = 300;
const PATH_SMOOTHING_ITERATIONS = 3;
const OBSTACLE_RADIUS = 1.2;
const COVER_PROXIMITY = 2.0;
const STUCK_THRESHOLD = 0.3;
const STUCK_TIME = 1.5;
const PATH_RECALC_INTERVAL = 1.0;
const RECALC_MOVE_THRESHOLD = 4.0;
const SEPARATION_RADIUS = 1.5;
const SEPARATION_STRENGTH = 2.0;
const MAX_QUEUE = 24;
const FRAME_TIMEOUT = 0.2;
const REQUEST_DEDUPE_WINDOW = 0.2;
const UNVISITED = 0;
const OPEN = 1;
const CLOSED = 2;

const EXPANSIONS_BY_DETAIL = [700, 1100, 1500];
const SEARCHES_BY_DETAIL = [1, 2, 2];
const LOS_BUDGET_BY_DETAIL = [2, 3, 4];

const DEFAULT_QUALITY = {
  propDetail: 1,
  maxEnemies: 8,
  enemyLodDistance: 30,
};

class IntHeap {
  constructor(capacity) {
    this.nodes = new Int32Array(capacity);
    this.prios = new Float32Array(capacity);
    this.size = 0;
  }

  clear() {
    this.size = 0;
  }

  _grow() {
    const cap = this.nodes.length * 2;
    const nodes = new Int32Array(cap);
    const prios = new Float32Array(cap);
    nodes.set(this.nodes);
    prios.set(this.prios);
    this.nodes = nodes;
    this.prios = prios;
  }

  push(node, prio) {
    if (this.size >= this.nodes.length) this._grow();
    let i = this.size++;
    this.nodes[i] = node;
    this.prios[i] = prio;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prios[parent] <= this.prios[i]) break;
      const tn = this.nodes[parent];
      const tp = this.prios[parent];
      this.nodes[parent] = this.nodes[i];
      this.prios[parent] = this.prios[i];
      this.nodes[i] = tn;
      this.prios[i] = tp;
      i = parent;
    }
  }

  pop() {
    if (this.size === 0) return -1;
    const top = this.nodes[0];
    this.size--;
    if (this.size > 0) {
      this.nodes[0] = this.nodes[this.size];
      this.prios[0] = this.prios[this.size];
      let i = 0;
      while (true) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.size && this.prios[left] < this.prios[smallest]) smallest = left;
        if (right < this.size && this.prios[right] < this.prios[smallest]) smallest = right;
        if (smallest === i) break;
        const tn = this.nodes[smallest];
        const tp = this.prios[smallest];
        this.nodes[smallest] = this.nodes[i];
        this.prios[smallest] = this.prios[i];
        this.nodes[i] = tn;
        this.prios[i] = tp;
        i = smallest;
      }
    }
    return top;
  }
}

export class Pathfinding {
  constructor(level, quality) {
    this.level = level;
    this.quality = { ...DEFAULT_QUALITY, ...(quality || {}) };
    this.waypoints = [];
    this.obstacles = [];
    this._stuckPositions = new Map();
    this._lastPathCalc = new Map();
    this._lastPathTarget = new Map();

    this.maxExpansions = EXPANSIONS_BY_DETAIL[1];
    this.expansionsPerCall = EXPANSIONS_BY_DETAIL[1];
    this.maxSearchesPerFrame = SEARCHES_BY_DETAIL[1];
    this.losBudgetPerFrame = LOS_BUDGET_BY_DETAIL[1];
    this.searchesThisFrame = 0;
    this.expansionsThisFrame = 0;
    this.losThisFrame = 0;
    this.losDeferred = 0;
    this.searchesTotal = 0;
    this.deferredSearches = 0;
    this.requestsTotal = 0;
    this.requestsDropped = 0;
    this._lastFrameTime = -1;

    this._applyBudget();

    this._queue = [];
    this._queueEntries = [];
    for (let i = 0; i < MAX_QUEUE; i++) {
      this._queueEntries.push({ owner: null, sx: 0, sz: 0, ex: 0, ez: 0, tag: 0, active: false, stamp: -1 });
    }

    this._buildGraph();
    this._allocateSearchBuffers();
  }

  _applyBudget() {
    const detail = this.quality.propDetail < 0 ? 0 : this.quality.propDetail > 2 ? 2 : this.quality.propDetail | 0;
    this.maxExpansions = EXPANSIONS_BY_DETAIL[detail];
    this.expansionsPerCall = EXPANSIONS_BY_DETAIL[detail];
    this.maxSearchesPerFrame = SEARCHES_BY_DETAIL[detail];
    this.losBudgetPerFrame = LOS_BUDGET_BY_DETAIL[detail];
  }

  setQuality(quality) {
    if (!quality) return;
    this.quality = { ...this.quality, ...quality };
    this._applyBudget();
  }

  claimLosCheck() {
    if (this.losThisFrame < this.losBudgetPerFrame) {
      this.losThisFrame++;
      return true;
    }
    this.losDeferred++;
    return false;
  }

  _allocateSearchBuffers() {
    const n = Math.max(2, this.waypoints.length);
    this._wx = new Float32Array(n);
    this._wz = new Float32Array(n);
    this._gs = new Float32Array(n);
    this._fs = new Float32Array(n);
    this._came = new Int32Array(n);
    this._state = new Uint8Array(n);
    this._heap = new IntHeap(n * 2 + 8);
    for (let i = 0; i < n; i++) {
      this._wx[i] = this.waypoints[i].x;
      this._wz[i] = this.waypoints[i].z;
    }
  }

  _buildGraph() {
    const covers = this.level.coverPositions || [];
    const spawns = this.level.spawnPoints || [];
    const bounds = this.level.bounds || { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };

    for (let i = 0; i < covers.length; i++) {
      this._addWaypoint(new THREE.Vector3(covers[i].x, 0, covers[i].z));
    }

    for (let i = 0; i < spawns.length; i++) {
      this._addWaypoint(new THREE.Vector3(spawns[i].x, 0, spawns[i].z));
    }

    if (this.waypoints.length < 20) this._generateGrid(bounds);

    this._cacheCovers(covers);
    this._generateConnections();
  }

  _cacheCovers(covers) {
    this._coverXZ = new Float32Array(covers.length * 2);
    for (let i = 0; i < covers.length; i++) {
      this._coverXZ[i * 2] = covers[i].x;
      this._coverXZ[i * 2 + 1] = covers[i].z;
    }
    this._coverCount = covers.length;
  }

  _generateGrid(bounds) {
    const dx = (bounds.maxX - bounds.minX) / GRID_SIZE;
    const dz = (bounds.maxZ - bounds.minZ) / GRID_SIZE;

    for (let i = 0; i <= GRID_SIZE; i++) {
      for (let j = 0; j <= GRID_SIZE; j++) {
        if (this.waypoints.length >= MAX_WAYPOINTS) return;
        this._addWaypoint(new THREE.Vector3(bounds.minX + i * dx, 0, bounds.minZ + j * dz));
      }
    }
  }

  _addWaypoint(pos) {
    if (this.waypoints.length >= MAX_WAYPOINTS) return;
    this.waypoints.push(pos);
  }

  _generateConnections() {
    const n = this.waypoints.length;
    const wx = this._wx || new Float32Array(n);
    const wz = this._wz || new Float32Array(n);
    for (let i = 0; i < n; i++) {
      wx[i] = this.waypoints[i].x;
      wz[i] = this.waypoints[i].z;
    }
    this._wx = wx;
    this._wz = wz;

    const maxRadiusSq = CONNECTION_RADIUS * CONNECTION_RADIUS;
    const counts = new Int32Array(n);
    let total = 0;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = wx[i] - wx[j];
        const dz = wz[i] - wz[j];
        if (dx * dx + dz * dz < maxRadiusSq) {
          counts[i]++;
          counts[j]++;
          total++;
        }
      }
    }

    const offsets = new Int32Array(n + 1);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      offsets[i] = acc;
      acc += counts[i];
    }
    offsets[n] = acc;

    const neighbors = new Int32Array(total);
    const costs = new Float32Array(total);
    const cursor = new Int32Array(n);

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = wx[i] - wx[j];
        const dz = wz[i] - wz[j];
        const d2 = dx * dx + dz * dz;
        if (d2 >= maxRadiusSq) continue;
        const dist = Math.sqrt(d2);
        const a = offsets[i] + cursor[i]++;
        neighbors[a] = j;
        costs[a] = dist;
        const b = offsets[j] + cursor[j]++;
        neighbors[b] = i;
        costs[b] = dist;
      }
    }

    this._offsets = offsets;
    this._neighbors = neighbors;
    this._edgeCost = costs;
  }

  _findNearestWaypoint(pos) {
    const n = this.waypoints.length;
    const wx = this._wx;
    const wz = this._wz;
    const x = pos.x;
    const z = pos.z;
    let minDist = Infinity;
    let nearest = 0;

    for (let i = 0; i < n; i++) {
      const dx = wx[i] - x;
      const dz = wz[i] - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < minDist) {
        minDist = d2;
        nearest = i;
      }
    }
    return nearest;
  }

  beginFrame(now) {
    this.searchesThisFrame = 0;
    this.expansionsThisFrame = 0;
    this.losThisFrame = 0;
    this._lastFrameTime = now !== undefined ? now : this._now();
  }

  _now() {
    return (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) / 1000;
  }

  _autoFrame() {
    const now = this._now();
    if (this._lastFrameTime < 0 || now - this._lastFrameTime > FRAME_TIMEOUT) {
      this.beginFrame(now);
    }
  }

  findPath(start, end) {
    this._autoFrame();

    if (this.waypoints.length === 0) return [end.clone()];

    if (this.searchesThisFrame >= this.maxSearchesPerFrame) {
      this.deferredSearches++;
      return this._directPath(start.x, start.z, end.x, end.z);
    }

    this.searchesThisFrame++;
    return this._searchPath(start.x, start.z, end.x, end.z);
  }

  _directPath(sx, sz, ex, ez) {
    return [new THREE.Vector3(ex, 0, ez)];
  }

  _searchPath(sx, sz, ex, ez) {
    const startIdx = this._findNearestWaypoint(_patrolVec.set(sx, 0, sz));
    const endIdx = this._findNearestWaypoint(_patrolVec.set(ex, 0, ez));

    if (startIdx === endIdx) return [this.waypoints[endIdx].clone()];

    const indices = this._astar(startIdx, endIdx);
    this.searchesTotal++;
    if (indices.length === 0) return this._directPath(sx, sz, ex, ez);

    const world = new Array(indices.length);
    for (let i = 0; i < indices.length; i++) world[i] = this.waypoints[indices[i]].clone();
    return this._smoothPath(world);
  }

  _astar(startIdx, endIdx) {
    const wx = this._wx;
    const wz = this._wz;
    const gs = this._gs;
    const fs = this._fs;
    const came = this._came;
    const state = this._state;
    const offsets = this._offsets;
    const neighbors = this._neighbors;
    const costs = this._edgeCost;
    const heap = this._heap;
    const n = this.waypoints.length;

    state.fill(UNVISITED);
    came[startIdx] = -1;
    heap.clear();

    const ex = wx[endIdx];
    const ez = wz[endIdx];

    const sdx = wx[startIdx] - ex;
    const sdz = wz[startIdx] - ez;
    const startH = Math.sqrt(sdx * sdx + sdz * sdz);
    gs[startIdx] = 0;
    fs[startIdx] = startH;
    state[startIdx] = OPEN;
    heap.push(startIdx, startH);

    let expanded = 0;
    let bestIdx = startIdx;
    let bestH = startH;

    while (heap.size > 0 && expanded < this.maxExpansions) {
      const current = heap.pop();
      if (current < 0) break;
      if (state[current] === CLOSED) continue;
      state[current] = CLOSED;
      expanded++;

      if (current === endIdx) {
        this.expansionsThisFrame += expanded;
        return this._reconstruct(came, current);
      }

      const hx = wx[current] - ex;
      const hz = wz[current] - ez;
      const h = Math.sqrt(hx * hx + hz * hz);
      if (h < bestH) {
        bestH = h;
        bestIdx = current;
      }

      const base = gs[current];
      const from = offsets[current];
      const to = offsets[current + 1];

      for (let e = from; e < to; e++) {
        const nb = neighbors[e];
        if (state[nb] === CLOSED) continue;
        const tentative = base + costs[e];
        if (state[nb] === UNVISITED || tentative < gs[nb]) {
          came[nb] = current;
          gs[nb] = tentative;
          const dx = wx[nb] - ex;
          const dz = wz[nb] - ez;
          const f = tentative + Math.sqrt(dx * dx + dz * dz);
          fs[nb] = f;
          state[nb] = OPEN;
          heap.push(nb, f);
        }
      }
    }

    this.expansionsThisFrame += expanded;
    return this._reconstruct(came, bestIdx);
  }

  _reconstruct(cameFrom, current) {
    const out = [];
    let guard = 0;
    while (current >= 0 && guard++ < 512) {
      out.push(current);
      current = cameFrom[current];
    }
    out.reverse();
    return out;
  }

  _smoothPath(path) {
    if (path.length <= 2) return path;

    let current = path;
    for (let iter = 0; iter < PATH_SMOOTHING_ITERATIONS; iter++) {
      const smoothed = [current[0]];
      const last = current.length - 1;
      for (let i = 1; i < last; i++) {
        const prev = smoothed[smoothed.length - 1];
        const curr = current[i];
        const next = current[i + 1];
        const dPrevCurr = prev.distanceTo(curr);
        const dCurrNext = curr.distanceTo(next);
        const dPrevNext = prev.distanceTo(next);
        if (dPrevNext < dPrevCurr + dCurrNext * 0.8) continue;
        smoothed.push(curr);
      }
      smoothed.push(current[last]);
      current = smoothed;
    }

    return current;
  }

  requestPath(owner, startX, startZ, endX, endZ, tag) {
    this._autoFrame();
    this.requestsTotal++;

    const now = this._lastFrameTime;

    for (let i = this._queue.length - 1; i >= 0; i--) {
      if (this._queue[i].owner === owner) {
        const entry = this._queue[i];
        if (tag !== 2 && entry.tag === tag && now - entry.stamp < REQUEST_DEDUPE_WINDOW) {
          this.requestsDropped++;
          return true;
        }
        entry.sx = startX;
        entry.sz = startZ;
        entry.ex = endX;
        entry.ez = endZ;
        entry.tag = tag;
        entry.stamp = now;
        return true;
      }
    }

    if (this._queue.length >= MAX_QUEUE) {
      this.requestsDropped++;
      return false;
    }

    let entry = null;
    for (let i = 0; i < this._queueEntries.length; i++) {
      if (!this._queueEntries[i].active) {
        entry = this._queueEntries[i];
        break;
      }
    }
    if (!entry) {
      this.requestsDropped++;
      return false;
    }

    entry.active = true;
    entry.owner = owner;
    entry.sx = startX;
    entry.sz = startZ;
    entry.ex = endX;
    entry.ez = endZ;
    entry.tag = tag;
    entry.stamp = now;
    this._queue.push(entry);
    return true;
  }

  cancelRequests(owner) {
    for (let i = this._queue.length - 1; i >= 0; i--) {
      const queued = this._queue[i].owner;
      if (queued === owner || (owner && queued && queued.squadId === owner)) {
        this._queue[i].active = false;
        this._queue[i].owner = null;
        this._queue.splice(i, 1);
      }
    }
  }

  processQueue() {
    if (this._queue.length === 0) return;

    let budget = this.expansionsPerCall;

    while (this._queue.length > 0 && budget > 0) {
      if (this.searchesThisFrame >= this.maxSearchesPerFrame) return;
      if (this.expansionsThisFrame >= this.expansionsPerCall) return;

      const entry = this._queue[0];
      this._queue.shift();
      entry.active = false;
      const owner = entry.owner;

      if (owner && !owner.isAlive()) {
        entry.owner = null;
        continue;
      }

      const before = this.expansionsThisFrame;
      const path = this.findPath(
        _patrolVec.set(entry.sx, 0, entry.sz),
        _patrolVec.set(entry.ex, 0, entry.ez)
      );
      budget -= this.expansionsThisFrame - before;

      if (owner && owner.onPathResolved) owner.onPathResolved(path, entry.tag);
      entry.owner = null;
    }
  }

  getQueueLength() {
    return this._queue.length;
  }

  getRandomPatrolPoint() {
    return this.getPatrolPoint(new THREE.Vector3());
  }

  getPatrolPoint(out) {
    const n = this.waypoints.length;
    if (n === 0) return out.set(0, 0, 0);
    const wp = this.waypoints[Math.floor(Math.random() * n)];
    out.set(
      wp.x + (Math.random() - 0.5) * WAYPOINT_RADIUS,
      0,
      wp.z + (Math.random() - 0.5) * WAYPOINT_RADIUS
    );
    return out;
  }

  getCoverPosition(threatPosition, selfPosition) {
    const n = this.waypoints.length;
    if (n === 0) return null;

    const wx = this._wx;
    const wz = this._wz;
    const tx = threatPosition.x;
    const tz = threatPosition.z;
    const selfX = selfPosition ? selfPosition.x : 0;
    const selfZ = selfPosition ? selfPosition.z : 0;

    let best = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < n; i++) {
      const dx = wx[i] - tx;
      const dz = wz[i] - tz;
      const distToThreat = Math.sqrt(dx * dx + dz * dz);
      if (distToThreat < 5 || distToThreat > 40) continue;
      if (!this._hasCoverFrom(wx[i], wz[i])) continue;

      const sx = wx[i] - selfX;
      const sz = wz[i] - selfZ;
      const distToSelf = selfPosition ? Math.sqrt(sx * sx + sz * sz) : 0;
      const score = distToThreat * 0.5 - distToSelf * 0.3 + 10;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }

    if (best < 0) return null;
    return _coverOut.set(wx[best], 0, wz[best]).clone();
  }

  _hasCoverFrom(x, z) {
    const limit = COVER_PROXIMITY * COVER_PROXIMITY;
    for (let i = 0; i < this._coverCount; i++) {
      const dx = this._coverXZ[i * 2] - x;
      const dz = this._coverXZ[i * 2 + 1] - z;
      if (dx * dx + dz * dz < limit) return true;
    }
    return false;
  }

  hasLineOfSight(from, to) {
    const count = this._coverCount;
    if (count === 0) return true;

    const dir = _losDir.copy(to).sub(from);
    const dist = dir.length();
    if (dist < 0.001) return true;
    const invDist = 1 / dist;
    const dx = dir.x * invDist;
    const dz = dir.z * invDist;
    const limit = OBSTACLE_RADIUS * OBSTACLE_RADIUS;
    const cover = this._coverXZ;

    for (let i = 0; i < count; i++) {
      const ox = cover[i * 2] - from.x;
      const oz = cover[i * 2 + 1] - from.z;
      const proj = ox * dx + oz * dz;
      if (proj <= 0 || proj >= dist) continue;
      const cx = ox - dx * proj;
      const cz = oz - dz * proj;
      if (cx * cx + cz * cz < limit) return false;
    }
    return true;
  }

  addObstacle(position, radius) {
    this.obstacles.push({ position: position.clone(), radius });
  }

  removeObstacle(position) {
    const kept = [];
    for (let i = 0; i < this.obstacles.length; i++) {
      if (this.obstacles[i].position.distanceTo(position) > 0.1) kept.push(this.obstacles[i]);
    }
    this.obstacles = kept;
  }

  getAvoidanceDirection(position) {
    const avoidance = _avoidanceVec.set(0, 0, 0);
    for (let i = 0; i < this.obstacles.length; i++) {
      const obs = this.obstacles[i];
      _toObsVec.copy(obs.position).sub(position);
      const dist = _toObsVec.length();
      if (dist < obs.radius + 2) {
        const strength = 1 - (dist / (obs.radius + 2));
        avoidance.add(_toObsVec.normalize().multiplyScalar(-strength));
      }
    }
    return avoidance;
  }

  getSeparationDirection(position, enemyPositions) {
    const separation = _separationVec.set(0, 0, 0);
    for (let i = 0; i < enemyPositions.length; i++) {
      const otherPos = enemyPositions[i];
      if (otherPos === position) continue;
      const dx = position.x - otherPos.x;
      const dz = position.z - otherPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= SEPARATION_RADIUS * SEPARATION_RADIUS || d2 < 1e-6) continue;
      const dist = Math.sqrt(d2);
      const strength = (1 - dist / SEPARATION_RADIUS) * SEPARATION_STRENGTH;
      separation.x += (dx / dist) * strength;
      separation.z += (dz / dist) * strength;
    }
    return separation;
  }

  getSeparationFromSquad(position, squadMembers, self) {
    const separation = _separationVec.set(0, 0, 0);
    for (let i = 0; i < squadMembers.length; i++) {
      const other = squadMembers[i];
      if (other === self || !other.isAlive()) continue;
      const otherPos = other.position;
      const dx = position.x - otherPos.x;
      const dz = position.z - otherPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= SEPARATION_RADIUS * SEPARATION_RADIUS || d2 < 1e-6) continue;
      const dist = Math.sqrt(d2);
      const strength = (1 - dist / SEPARATION_RADIUS) * SEPARATION_STRENGTH;
      separation.x += (dx / dist) * strength;
      separation.z += (dz / dist) * strength;
    }
    return separation;
  }

  isStuck(enemyId, position, dt) {
    const last = this._stuckPositions.get(enemyId);
    if (!last) {
      this._stuckPositions.set(enemyId, { x: position.x, z: position.z, time: 0 });
      return false;
    }

    const dx = position.x - last.x;
    const dz = position.z - last.z;
    if (dx * dx + dz * dz < STUCK_THRESHOLD * STUCK_THRESHOLD) {
      last.time += dt;
      if (last.time > STUCK_TIME) {
        last.time = 0;
        last.x = position.x;
        last.z = position.z;
        return true;
      }
    } else {
      last.time = 0;
      last.x = position.x;
      last.z = position.z;
    }
    return false;
  }

  shouldRecalculatePath(enemyId, targetPosition, now, force) {
    if (force) {
      this._lastPathCalc.set(enemyId, now);
      this._storeTarget(enemyId, targetPosition);
      return true;
    }

    const lastCalc = this._lastPathCalc.get(enemyId);
    if (lastCalc === undefined) {
      this._lastPathCalc.set(enemyId, now);
      this._storeTarget(enemyId, targetPosition);
      return true;
    }

    if (now - lastCalc < PATH_RECALC_INTERVAL) return false;

    let moved = true;
    if (targetPosition) {
      const prev = this._lastPathTarget.get(enemyId);
      if (prev) {
        const dx = targetPosition.x - prev.x;
        const dz = targetPosition.z - prev.z;
        moved = dx * dx + dz * dz > RECALC_MOVE_THRESHOLD * RECALC_MOVE_THRESHOLD;
      }
    }

    if (!moved) {
      this._lastPathCalc.set(enemyId, now);
      return false;
    }

    this._lastPathCalc.set(enemyId, now);
    this._storeTarget(enemyId, targetPosition);
    return true;
  }

  _storeTarget(enemyId, targetPosition) {
    if (!targetPosition) return;
    const existing = this._lastPathTarget.get(enemyId);
    if (existing) {
      existing.x = targetPosition.x;
      existing.z = targetPosition.z;
    } else {
      this._lastPathTarget.set(enemyId, { x: targetPosition.x, z: targetPosition.z });
    }
  }

  clearStuck(enemyId) {
    this._stuckPositions.delete(enemyId);
  }

  forget(enemyId, owner) {
    this._stuckPositions.delete(enemyId);
    this._lastPathCalc.delete(enemyId);
    this._lastPathTarget.delete(enemyId);
    if (owner) this.cancelRequests(owner);
  }

  clearAll() {
    for (let i = this._queue.length - 1; i >= 0; i--) {
      this._queue[i].active = false;
      this._queue[i].owner = null;
    }
    this._queue.length = 0;
    this._stuckPositions.clear();
    this._lastPathCalc.clear();
    this._lastPathTarget.clear();
  }

  getStats() {
    return {
      waypoints: this.waypoints.length,
      searchesThisFrame: this.searchesThisFrame,
      maxSearchesPerFrame: this.maxSearchesPerFrame,
      expansionsPerFrame: this.expansionsPerCall,
      losThisFrame: this.losThisFrame,
      losBudget: this.losBudgetPerFrame,
      queue: this._queue.length,
      searchesTotal: this.searchesTotal,
      deferred: this.deferredSearches,
      losDeferred: this.losDeferred,
      requests: this.requestsTotal,
      requestsDeduped: this.requestsDropped,
    };
  }
}
