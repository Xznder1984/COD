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

const TAU = Math.PI * 2;
const MOVE_EPSILON = 0.35;
const YAW_EPSILON = 0.02;
const IDLE_REFRESH = 0.5;

export class Minimap {
  constructor(uiOverlay, level, quality) {
    this.uiOverlay = uiOverlay;
    this.level = level;
    this.quality = Object.assign({}, DEFAULT_QUALITY, quality || {});
    this.size = 220;
    this.range = 60;

    const detail = Math.max(0, this.quality.propDetail | 0);
    this.resolution = detail === 0 ? 1 : 2;
    this.redrawInterval = detail === 0 ? 1 / 12 : 1 / 15;
    this._accum = 0;
    this._idleAccum = 0;
    this._lastX = NaN;
    this._lastZ = NaN;
    this._lastYaw = NaN;
    this._lastEnemyCount = -1;
    this._visible = true;

    this.container = document.createElement('div');
    this.container.id = 'minimap';
    this.container.style.cssText = `
      position: absolute;
      top: 40px;
      left: 40px;
      width: ${this.size}px;
      height: ${this.size}px;
      background: rgba(0, 0, 0, 0.75);
      border: 2px solid rgba(255, 255, 255, 0.2);
      overflow: hidden;
      z-index: 12;
      clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px));
    `;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.size * this.resolution;
    this.canvas.height = this.size * this.resolution;
    this.canvas.style.cssText = `
      width: 100%;
      height: 100%;
      display: block;
    `;

    this.ctx = this.canvas.getContext('2d');
    this.container.appendChild(this.canvas);
    this.uiOverlay.appendChild(this.container);

    this.northIndicator = document.createElement('div');
    this.northIndicator.style.cssText = `
      position: absolute;
      top: 6px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 11px;
      font-weight: 700;
      color: #ffc800;
      letter-spacing: 2px;
      font-family: 'Rajdhani', 'Segoe UI', Arial, sans-serif;
      z-index: 2;
      text-shadow: 0 0 4px rgba(0,0,0,0.8);
    `;
    this.northIndicator.textContent = 'N';
    this.container.appendChild(this.northIndicator);

    this.rangeCircle = document.createElement('div');
    this.rangeCircle.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: ${this.size * 0.75}px;
      height: ${this.size * 0.75}px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 50%;
      pointer-events: none;
    `;
    this.container.appendChild(this.rangeCircle);

    this._half = this.canvas.width / 2;
    this._scale = this.size / this.range;
    this._gridSize = 22 * this.resolution;
    this._buildStaticPath();
  }

  _buildStaticPath() {
    const half = this._half;
    const gridSize = this._gridSize;

    this._conePath = new Path2D();
    this._conePath.moveTo(0, -20);
    this._conePath.lineTo(-15, 0);
    this._conePath.lineTo(0, 0);
    this._conePath.lineTo(15, 0);
    this._conePath.closePath();

    this._arrowPath = new Path2D();
    this._arrowPath.moveTo(0, -12);
    this._arrowPath.lineTo(-7, 10);
    this._arrowPath.lineTo(0, 5);
    this._arrowPath.lineTo(7, 10);
    this._arrowPath.closePath();

    this._ringPath = new Path2D();
    this._ringPath.arc(0, 0, 8, 0, TAU);

    this._gridPath = new Path2D();
    for (let x = -half; x <= half; x += gridSize) {
      this._gridPath.moveTo(x, -half);
      this._gridPath.lineTo(x, half);
    }
    for (let y = -half; y <= half; y += gridSize) {
      this._gridPath.moveTo(-half, y);
      this._gridPath.lineTo(half, y);
    }
  }

  update(dt, playerPosition, playerDirection, enemies) {
    if (!this._visible) return;

    this._idleAccum += dt;
    this._accum += dt;
    if (this._accum < this.redrawInterval) return;
    this._accum = 0;

    const dx = playerPosition.x - this._lastX;
    const dz = playerPosition.z - this._lastZ;
    const dyaw = Math.abs(playerDirection - this._lastYaw);
    const enemyCount = enemies ? enemies.length : 0;
    const moved = dx * dx + dz * dz > MOVE_EPSILON * MOVE_EPSILON;
    const turned = dyaw > YAW_EPSILON;
    const rosterChanged = enemyCount !== this._lastEnemyCount;

    if (this._lastX === this._lastX && !moved && !turned && !rosterChanged && this._idleAccum < IDLE_REFRESH) {
      return;
    }
    this._idleAccum = 0;
    this._lastX = playerPosition.x;
    this._lastZ = playerPosition.z;
    this._lastYaw = playerDirection;
    this._lastEnemyCount = enemyCount;

    this._draw(playerPosition, playerDirection, enemies);
  }

  _strokeRing(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.stroke(this._ringPath);
    ctx.restore();
  }

  _draw(playerPosition, playerDirection, enemies) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const half = this._half;
    const scale = this._scale;
    const cull = (half - 8) * (half - 8);

    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(-playerDirection);

    if (this.level && this.level.coverObjects) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      const cover = this.level.coverObjects;
      for (let i = 0; i < cover.length; i++) {
        const obj = cover[i];
        const cx = (obj.x - playerPosition.x) * scale;
        const cy = (obj.z - playerPosition.z) * scale;
        const size = (obj.width || 2) * scale;
        ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
      }
    }

    if (this.level && this.level.objectivePositions) {
      const objectives = this.level.objectivePositions;
      ctx.fillStyle = '#ffc800';
      ctx.strokeStyle = 'rgba(255, 200, 0, 0.5)';
      ctx.lineWidth = 2;
      for (let i = 0; i < objectives.length; i++) {
        const obj = objectives[i];
        const cx = (obj.x - playerPosition.x) * scale;
        const cy = (obj.z - playerPosition.z) * scale;
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, TAU);
        ctx.fill();
        this._strokeRing(ctx, cx, cy);
      }
    }

    if (enemies && enemies.length > 0) {
      ctx.fillStyle = '#ff3333';
      ctx.strokeStyle = 'rgba(255, 51, 51, 0.4)';
      ctx.lineWidth = 1;
      for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        if (!enemy.alive) continue;
        const ex = (enemy.position.x - playerPosition.x) * scale;
        const ey = (enemy.position.z - playerPosition.z) * scale;

        if (ex * ex + ey * ey > cull) continue;

        ctx.beginPath();
        ctx.arc(ex, ey, 5, 0, TAU);
        ctx.fill();
        this._strokeRing(ctx, ex, ey);

        if (enemy.direction) {
          const dirX = Math.sin(enemy.direction) * 12;
          const dirY = -Math.cos(enemy.direction) * 12;
          ctx.strokeStyle = 'rgba(255, 51, 51, 0.6)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex + dirX, ey + dirY);
          ctx.stroke();
        }
      }
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.fill(this._conePath);

    ctx.fillStyle = '#fff';
    ctx.fill(this._arrowPath);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.stroke(this._arrowPath);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.stroke(this._gridPath);

    ctx.restore();
  }

  show() {
    if (this._visible) return;
    this._visible = true;
    this.container.style.display = 'block';
    this._accum = 0;
  }

  hide() {
    if (!this._visible) return;
    this._visible = false;
    this.container.style.display = 'none';
  }
}
