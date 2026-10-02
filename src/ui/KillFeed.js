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

const FADE_TIME = 0.25;

export class KillFeed {
  constructor(uiOverlay, quality) {
    this.uiOverlay = uiOverlay;
    this.quality = Object.assign({}, DEFAULT_QUALITY, quality || {});
    this.container = document.createElement('div');
    this.container.id = 'kill-feed';
    this.container.style.cssText = `
      position: absolute;
      top: 100px;
      right: 40px;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
      pointer-events: none;
      z-index: 15;
    `;
    this.uiOverlay.appendChild(this.container);

    this.entries = [];
    this.maxVisible = 5;
    this.nextId = 0;
    this.lifeTime = this.quality.propDetail === 0 ? 3.2 : 4.0;
    this._visible = true;
    this._raf = 0;
  }

  addKill(killerName, victimName, weaponType, isHeadshot, isMultiKill) {
    const entry = {
      id: this.nextId++,
      killerName,
      victimName,
      weaponType,
      isHeadshot,
      isMultiKill,
      element: null,
      timer: 0,
      state: 'in',
      animated: false,
    };

    entry.element = this._createEntryElement(entry);
    this.container.appendChild(entry.element);
    this.entries.push(entry);

    if (this.entries.length > this.maxVisible) {
      const oldest = this.entries.shift();
      if (oldest.element && oldest.element.parentNode) {
        oldest.element.parentNode.removeChild(oldest.element);
      }
    }

    this._animateEntry(entry);
  }

  _createEntryElement(entry) {
    const el = document.createElement('div');
    el.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;
      background: rgba(0, 0, 0, 0.75);
      border-right: 3px solid ${entry.isHeadshot ? '#ffc800' : 'rgba(255,255,255,0.35)'};
      font-family: 'Rajdhani', 'Segoe UI', Arial, sans-serif;
      font-size: 16px;
      color: #fff;
      white-space: nowrap;
      transition: opacity 0.25s ease-out, transform 0.25s ease-out;
      transform: translateX(30px);
    `;

    const killer = document.createElement('span');
    killer.style.cssText = 'font-weight: 700; color: #4da6ff;';
    killer.textContent = entry.killerName;

    const weapon = document.createElement('span');
    weapon.style.cssText = `
      font-size: 11px;
      color: rgba(255,255,255,0.5);
      letter-spacing: 2px;
      text-transform: uppercase;
      background: rgba(255,255,255,0.08);
      padding: 2px 6px;
    `;
    weapon.textContent = entry.weaponType || '';

    const separator = document.createElement('span');
    separator.style.cssText = 'color: rgba(255,255,255,0.3); font-size: 14px;';
    separator.textContent = entry.isHeadshot ? ' [HS] ' : ' > ';

    const victim = document.createElement('span');
    victim.style.cssText = 'font-weight: 700; color: #ff6b6b;';
    victim.textContent = entry.victimName;

    if (entry.isMultiKill) {
      const multiKill = document.createElement('span');
      multiKill.style.cssText = `
        font-size: 11px;
        font-weight: 700;
        color: #ffc800;
        letter-spacing: 1px;
        text-transform: uppercase;
        background: rgba(255, 200, 0, 0.15);
        padding: 2px 6px;
        border: 1px solid rgba(255, 200, 0, 0.3);
      `;
      multiKill.textContent = 'MULTI-KILL';
      el.appendChild(multiKill);
    }

    el.appendChild(killer);
    el.appendChild(weapon);
    el.appendChild(separator);
    el.appendChild(victim);

    return el;
  }

  _animateEntry(entry) {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      const list = this.entries;
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (item.animated || item.state !== 'in') continue;
        item.animated = true;
        if (item.element) {
          item.element.style.opacity = '1';
          item.element.style.transform = 'translateX(0)';
        }
      }
    });
  }

  update(dt) {
    if (!this._visible || this.entries.length === 0) return;

    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      entry.timer += dt;

      if (entry.timer <= this.lifeTime) continue;

      if (entry.state === 'in') {
        entry.state = 'out';
        entry.timer = this.lifeTime;
        entry.element.style.opacity = '0';
        entry.element.style.transform = 'translateX(30px)';
        continue;
      }

      if (entry.timer >= this.lifeTime + FADE_TIME) {
        if (entry.element && entry.element.parentNode) {
          entry.element.parentNode.removeChild(entry.element);
        }
        this.entries.splice(i, 1);
      }
    }
  }

  clear() {
    for (let i = 0; i < this.entries.length; i++) {
      const element = this.entries[i].element;
      if (element && element.parentNode) {
        element.parentNode.removeChild(element);
      }
    }
    this.entries.length = 0;
  }

  show() {
    this._visible = true;
    this.container.style.display = 'flex';
  }

  hide() {
    this._visible = false;
    this.container.style.display = 'none';
  }
}
