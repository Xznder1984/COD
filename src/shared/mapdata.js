/**
 * Map layout shared by the client and the multiplayer server.
 *
 * Deliberately free of any Three.js import so the Node server can read it directly.
 * The client builds the visual level from this; the server uses it for collision,
 * navigation and spawn placement. If you move a building here, both sides follow.
 */

export const MAP_HALF = 35;
export const MAP_SIZE = MAP_HALF * 2;
export const WALL_HEIGHT = 5.5;
export const STREET_WIDTH = 10;

/** Axis-aligned boxes: [minX, minZ, maxX, maxZ] on the ground plane. */
export const BUILDINGS = [
  { pos: [-20, -24], size: [13, 20, 12], style: 'concrete' },
  { pos: [20, -25], size: [12, 16, 13], style: 'metal' },
  { pos: [-24, 20], size: [14, 22, 12], style: 'concrete' },
  { pos: [23, 22], size: [12, 18, 11], style: 'concrete' },
  { pos: [-27, -2], size: [10, 14, 13], style: 'concrete' },
  { pos: [27, -4], size: [11, 19, 12], style: 'metal' },
  { pos: [-10, 27], size: [10, 11, 9], style: 'concrete' },
  { pos: [11, 27], size: [9, 13, 10], style: 'metal' },
];

/** Perimeter walls, as boxes. */
export const PERIMETER = [
  { pos: [0, -MAP_HALF], size: [MAP_SIZE, WALL_HEIGHT, 0.9] },
  { pos: [0, MAP_HALF], size: [MAP_SIZE, WALL_HEIGHT, 0.9] },
  { pos: [-MAP_HALF, 0], size: [0.9, WALL_HEIGHT, MAP_SIZE] },
  { pos: [MAP_HALF, 0], size: [0.9, WALL_HEIGHT, MAP_SIZE] },
];

export const SPAWN_POINTS = [
  [-28, -28], [28, -28], [-28, 28], [28, 28],
  [-28, 0], [28, 0], [0, -30], [0, 30],
  [-15, -15], [15, 15], [-15, 15], [15, -15],
  [-20, -8], [20, 8],
];

/** Flat boxes the player and enemies collide with, in XZ. */
export function staticColliders() {
  const boxes = [];
  for (const b of BUILDINGS) {
    const [w, , d] = b.size;
    boxes.push([b.pos[0] - w / 2, b.pos[1] - d / 2, b.pos[0] + w / 2, b.pos[1] + d / 2]);
  }
  for (const p of PERIMETER) {
    const [w, , d] = p.size;
    boxes.push([p.pos[0] - w / 2, p.pos[1] - d / 2, p.pos[0] + w / 2, p.pos[1] + d / 2]);
  }
  return boxes;
}

export function insideAny(x, z, pad = 0, boxes = staticColliders()) {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (x > b[0] - pad && x < b[2] + pad && z > b[1] - pad && z < b[3] + pad) return true;
  }
  return false;
}

/** Push a circle of `radius` out of any solid box it overlaps. Mutates {x, z}. */
export function resolveCircle(p, radius, boxes) {
  if (!Number.isFinite(radius) || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return p;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const cx = Math.max(b[0], Math.min(p.x, b[2]));
    const cz = Math.max(b[1], Math.min(p.z, b[3]));
    const dx = p.x - cx;
    const dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    const d = Math.sqrt(d2);
    if (d > 1e-4) {
      p.x = cx + (dx / d) * radius;
      p.z = cz + (dz / d) * radius;
    } else {
      // Centre is inside the box: eject along the shallowest axis.
      const left = p.x - b[0];
      const right = b[2] - p.x;
      const back = p.z - b[1];
      const front = b[3] - p.z;
      const m = Math.min(left, right, back, front);
      if (m === left) p.x = b[0] - radius;
      else if (m === right) p.x = b[2] + radius;
      else if (m === back) p.z = b[1] - radius;
      else p.z = b[3] + radius;
    }
  }
  return p;
}

/** Cheap line-of-sight test against the static boxes, in 2D. */
export function lineOfSight(ax, az, bx, bz, boxes) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return true;
  const steps = Math.ceil(len / 0.75);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (insideAny(ax + dx * t, az + dz * t, 0, boxes)) return false;
  }
  return true;
}

/**
 * Navigation grid over open ground. The server steers enemies cell to cell so they
 * path around buildings instead of grinding along walls.
 */
export function buildNavGrid(cell = 2.5) {
  const dim = Math.ceil((MAP_HALF * 2) / cell);
  const boxes = staticColliders();
  const walkable = new Uint8Array(dim * dim);
  for (let cz = 0; cz < dim; cz++) {
    for (let cx = 0; cx < dim; cx++) {
      const x = -MAP_HALF + (cx + 0.5) * cell;
      const z = -MAP_HALF + (cz + 0.5) * cell;
      walkable[cz * dim + cx] = insideAny(x, z, 0.7, boxes) ? 0 : 1;
    }
  }
  return { dim, cell, walkable, boxes };
}

/** Nearest walkable cell centre to a point, searched outward. */
export function nearestWalkable(grid, x, z) {
  const { dim, cell, walkable } = grid;
  const toCell = (v) => Math.max(0, Math.min(dim - 1, Math.floor((v + MAP_HALF) / cell)));
  const cx = toCell(x);
  const cz = toCell(z);
  if (walkable[cz * dim + cx]) {
    return { x: -MAP_HALF + (cx + 0.5) * cell, z: -MAP_HALF + (cz + 0.5) * cell };
  }
  for (let r = 1; r < dim; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= dim || nz >= dim) continue;
        if (walkable[nz * dim + nx]) {
          return { x: -MAP_HALF + (nx + 0.5) * cell, z: -MAP_HALF + (nz + 0.5) * cell };
        }
      }
    }
  }
  return { x: 0, z: 0 };
}

/** A* across the navigation grid. Returns an array of {x, z} waypoints, or null. */
export function findPath(grid, from, to) {
  const { dim, cell, walkable } = grid;
  const idx = (cx, cz) => cz * dim + cx;
  const start = nearestWalkable(grid, from.x, from.z);
  const goal = nearestWalkable(grid, to.x, to.z);
  const sx = Math.max(0, Math.min(dim - 1, Math.floor((start.x + MAP_HALF) / cell)));
  const sz = Math.max(0, Math.min(dim - 1, Math.floor((start.z + MAP_HALF) / cell)));
  const gx = Math.max(0, Math.min(dim - 1, Math.floor((goal.x + MAP_HALF) / cell)));
  const gz = Math.max(0, Math.min(dim - 1, Math.floor((goal.z + MAP_HALF) / cell)));

  const startI = idx(sx, sz);
  const goalI = idx(gx, gz);
  if (startI === goalI) return [goal];

  const gScore = new Float32Array(dim * dim).fill(Infinity);
  const cameFrom = new Int32Array(dim * dim).fill(-1);
  const open = [startI];
  const inOpen = new Uint8Array(dim * dim);
  const closed = new Uint8Array(dim * dim);
  gScore[startI] = 0;
  inOpen[startI] = 1;

  const h = (i) => {
    const cx = i % dim;
    const cz = (i / dim) | 0;
    return Math.abs(cx - gx) + Math.abs(cz - gz);
  };

  let guard = 0;
  while (open.length && guard++ < 4000) {
    let best = 0;
    let bestF = Infinity;
    for (let i = 0; i < open.length; i++) {
      const f = gScore[open[i]] + h(open[i]);
      if (f < bestF) { bestF = f; best = i; }
    }
    const current = open.splice(best, 1)[0];
    inOpen[current] = 0;
    if (current === goalI) {
      const out = [];
      let n = current;
      while (n !== -1) {
        const cx = n % dim;
        const cz = (n / dim) | 0;
        out.unshift({ x: -MAP_HALF + (cx + 0.5) * cell, z: -MAP_HALF + (cz + 0.5) * cell });
        n = cameFrom[n];
      }
      return out;
    }
    closed[current] = 1;

    const cx = current % dim;
    const cz = (current / dim) | 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= dim || nz >= dim) continue;
        const ni = idx(nx, nz);
        if (!walkable[ni] || closed[ni]) continue;
        if (dx && dz && (!walkable[idx(cx + dx, cz)] || !walkable[idx(cx, cz + dz)])) continue;
        const tentative = gScore[current] + (dx && dz ? 1.414 : 1);
        if (tentative < gScore[ni]) {
          cameFrom[ni] = current;
          gScore[ni] = tentative;
          if (!inOpen[ni]) { open.push(ni); inOpen[ni] = 1; }
        }
      }
    }
  }
  return null;
}