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

export class HUD {
  constructor(uiOverlay, quality) {
    this.uiOverlay = uiOverlay;
    this.quality = Object.assign({}, DEFAULT_QUALITY, quality || {});
    this.container = document.createElement('div');
    this.container.id = 'hud';
    this.container.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      font-family: 'Rajdhani', 'Segoe UI', Arial, sans-serif;
      z-index: 10;
    `;
    this.uiOverlay.appendChild(this.container);

    this._crosshairSpread = 0;
    this._hitMarkerTimer = 0;
    this._damageIndicatorTimer = 0;
    this._damageFlash = 0;
    this._headshotTimer = 0;
    this._damageAngle = 0;
    this._reloadProgress = 0;
    this._reloadActive = false;
    this._killConfirmTimer = 0;
    this._lowAmmoPulse = 0;
    this._onEnemy = false;
    this._visible = true;

    this._cache = {
      spreadPx: -1,
      crossColor: '',
      healthPct: -1,
      healthColor: '',
      healthText: -1,
      healthTextColor: '',
      ammo: -1,
      reserve: -1,
      weaponName: '',
      fireMode: '',
      ammoColor: '',
      wave: -1,
      hostiles: -1,
      progress: -1,
      score: -1,
      reloadVisible: false,
      damageAngle: 0,
      compass: 999,
      objective: 999,
    };

    this._buildCrosshair();
    this._buildHealthBar();
    this._buildAmmoCounter();
    this._buildWaveIndicator();
    this._buildScore();
    this._buildCompass();
    this._buildHitMarker();
    this._buildDamageIndicator();
    this._buildReloadIndicator();
    this._buildKillConfirm();
    this._buildEquipment();
    this._buildKillstreak();
  }

  _buildCrosshair() {
    this.crosshair = document.createElement('div');
    this.crosshair.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 0;
      height: 0;
    `;

    const lineStyle = `
      position: absolute;
      background: #fff;
      box-shadow: 0 0 3px rgba(0,0,0,0.9), 0 0 1px #fff;
    `;

    this.crosshairLines = {};
    const lines = [
      { name: 'top', css: `${lineStyle} width: 2px; height: 9px; left: -1px; top: -18px;` },
      { name: 'bottom', css: `${lineStyle} width: 2px; height: 9px; left: -1px; top: 9px;` },
      { name: 'left', css: `${lineStyle} width: 9px; height: 2px; left: -18px; top: -1px;` },
      { name: 'right', css: `${lineStyle} width: 9px; height: 2px; left: 9px; top: -1px;` },
    ];

    for (const line of lines) {
      const el = document.createElement('div');
      el.style.cssText = line.css;
      this.crosshair.appendChild(el);
      this.crosshairLines[line.name] = el;
    }

    this.crosshairDot = document.createElement('div');
    this.crosshairDot.style.cssText = `
      position: absolute;
      width: 2px;
      height: 2px;
      background: #fff;
      border-radius: 50%;
      left: -1px;
      top: -1px;
      box-shadow: 0 0 3px rgba(0,0,0,0.9);
    `;
    this.crosshair.appendChild(this.crosshairDot);

    this.container.appendChild(this.crosshair);
  }

  _buildHealthBar() {
    this.healthContainer = document.createElement('div');
    this.healthContainer.style.cssText = `
      position: absolute;
      bottom: 40px;
      left: 40px;
      display: flex;
      align-items: center;
      gap: 14px;
    `;

    this.healthLabel = document.createElement('div');
    this.healthLabel.textContent = 'INTEGRITY';
    this.healthLabel.style.cssText = `
      font-size: 10px;
      font-weight: 700;
      color: rgba(255,255,255,0.6);
      letter-spacing: 3px;
      text-transform: uppercase;
    `;

    this.healthNumber = document.createElement('div');
    this.healthNumber.style.cssText = `
      font-size: 28px;
      font-weight: 700;
      color: #fff;
      line-height: 1;
      text-shadow: 0 0 6px rgba(0,0,0,0.5);
      min-width: 40px;
    `;
    this.healthNumber.textContent = '100';

    this.healthBarOuter = document.createElement('div');
    this.healthBarOuter.style.cssText = `
      width: 240px;
      height: 10px;
      background: rgba(0,0,0,0.6);
      border: 1px solid rgba(255,255,255,0.25);
      position: relative;
      clip-path: polygon(0 0, 100% 0, calc(100% - 4px) 100%, 0 100%);
    `;

    this.healthBarInner = document.createElement('div');
    this.healthBarInner.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: #00ff88;
      transition: width 0.15s ease-out, background-color 0.3s;
    `;

    this.healthBarOuter.appendChild(this.healthBarInner);
    this.healthContainer.appendChild(this.healthLabel);
    this.healthContainer.appendChild(this.healthBarOuter);
    this.healthContainer.appendChild(this.healthNumber);
    this.container.appendChild(this.healthContainer);
  }

  _buildAmmoCounter() {
    this.ammoContainer = document.createElement('div');
    this.ammoContainer.style.cssText = `
      position: absolute;
      bottom: 40px;
      right: 40px;
      text-align: right;
    `;

    this.ammoText = document.createElement('div');
    this.ammoText.style.cssText = `
      font-size: 52px;
      font-weight: 700;
      color: #fff;
      letter-spacing: 1px;
      text-shadow: 0 0 6px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.5);
      line-height: 1;
    `;
    this.ammoText.innerHTML = '<span class="ammo-current">30</span><span class="ammo-sep"> / </span><span class="ammo-reserve">240</span>';
    this.ammoCurrentEl = this.ammoText.querySelector('.ammo-current');
    this.ammoReserveEl = this.ammoText.querySelector('.ammo-reserve');

    this.weaponName = document.createElement('div');
    this.weaponName.style.cssText = `
      font-size: 12px;
      font-weight: 600;
      color: rgba(255,255,255,0.55);
      letter-spacing: 4px;
      text-transform: uppercase;
      margin-top: 4px;
    `;
    this.weaponName.textContent = 'M4A1';

    this.fireMode = document.createElement('div');
    this.fireMode.style.cssText = `
      font-size: 10px;
      font-weight: 700;
      color: #ffc800;
      letter-spacing: 3px;
      text-transform: uppercase;
      margin-top: 2px;
    `;
    this.fireMode.textContent = 'AUTO';

    this.ammoContainer.appendChild(this.ammoText);
    this.ammoContainer.appendChild(this.weaponName);
    this.ammoContainer.appendChild(this.fireMode);
    this.container.appendChild(this.ammoContainer);
  }

  _buildWaveIndicator() {
    this.waveContainer = document.createElement('div');
    this.waveContainer.style.cssText = `
      position: absolute;
      top: 50px;
      left: 50%;
      transform: translateX(-50%);
      text-align: center;
    `;

    this.waveText = document.createElement('div');
    this.waveText.style.cssText = `
      font-size: 28px;
      font-weight: 700;
      color: #fff;
      letter-spacing: 6px;
      text-transform: uppercase;
      text-shadow: 0 0 8px rgba(0,0,0,0.6);
    `;
    this.waveText.textContent = 'WAVE 1';

    this.waveProgressOuter = document.createElement('div');
    this.waveProgressOuter.style.cssText = `
      width: 200px;
      height: 4px;
      background: rgba(0,0,0,0.5);
      margin: 6px auto 0;
      position: relative;
    `;

    this.waveProgressInner = document.createElement('div');
    this.waveProgressInner.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 0%;
      height: 100%;
      background: #ffc800;
      transition: width 0.3s ease-out;
    `;

    this.waveProgressOuter.appendChild(this.waveProgressInner);

    this.enemyCount = document.createElement('div');
    this.enemyCount.style.cssText = `
      font-size: 12px;
      font-weight: 600;
      color: rgba(255,255,255,0.55);
      letter-spacing: 3px;
      margin-top: 4px;
    `;
    this.enemyCount.textContent = '0 HOSTILES';

    this.waveContainer.appendChild(this.waveText);
    this.waveContainer.appendChild(this.waveProgressOuter);
    this.waveContainer.appendChild(this.enemyCount);
    this.container.appendChild(this.waveContainer);
  }

  _buildScore() {
    this.scoreContainer = document.createElement('div');
    this.scoreContainer.style.cssText = `
      position: absolute;
      top: 50px;
      right: 40px;
      text-align: right;
    `;

    this.scoreLabel = document.createElement('div');
    this.scoreLabel.style.cssText = `
      font-size: 10px;
      font-weight: 700;
      color: rgba(255,255,255,0.6);
      letter-spacing: 3px;
      text-transform: uppercase;
    `;
    this.scoreLabel.textContent = 'CONFIRMED KILLS';

    this.scoreValue = document.createElement('div');
    this.scoreValue.style.cssText = `
      font-size: 42px;
      font-weight: 700;
      color: #fff;
      line-height: 1;
      text-shadow: 0 0 6px rgba(0,0,0,0.5);
    `;
    this.scoreValue.textContent = '0';

    this.scoreContainer.appendChild(this.scoreLabel);
    this.scoreContainer.appendChild(this.scoreValue);
    this.container.appendChild(this.scoreContainer);
  }

  _buildCompass() {
    this.compassContainer = document.createElement('div');
    this.compassContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 50%;
      transform: translateX(-50%);
      width: 500px;
      height: 36px;
      overflow: hidden;
      background: linear-gradient(to bottom, rgba(0,0,0,0.5), transparent);
      border-bottom: 1px solid rgba(255,255,255,0.1);
    `;

    this.compassStrip = document.createElement('div');
    this.compassStrip.style.cssText = `
      position: absolute;
      top: 0;
      height: 100%;
      white-space: nowrap;
    `;

    const directions = [
      { label: 'N', angle: 0 },
      { label: 'NE', angle: 45 },
      { label: 'E', angle: 90 },
      { label: 'SE', angle: 135 },
      { label: 'S', angle: 180 },
      { label: 'SW', angle: 225 },
      { label: 'W', angle: 270 },
      { label: 'NW', angle: 315 },
    ];

    for (const dir of directions) {
      const el = document.createElement('span');
      el.textContent = dir.label;
      el.style.cssText = `
        display: inline-block;
        width: 62px;
        text-align: center;
        font-size: 13px;
        font-weight: 700;
        color: ${dir.label.length === 1 ? '#fff' : 'rgba(255,255,255,0.45)'};
        letter-spacing: 2px;
        line-height: 36px;
      `;
      this.compassStrip.appendChild(el);

      const tick = document.createElement('span');
      tick.style.cssText = `
        display: inline-block;
        width: 62px;
        text-align: center;
        font-size: 8px;
        color: rgba(255,255,255,0.25);
        line-height: 36px;
      `;
      tick.textContent = '|';
      this.compassStrip.appendChild(tick);
    }

    this.objectiveMarker = document.createElement('div');
    this.objectiveMarker.style.cssText = `
      position: absolute;
      top: 2px;
      width: 0;
      height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-top: 8px solid #ffc800;
      transform: translateX(-50%);
      display: none;
    `;

    this.compassContainer.appendChild(this.compassStrip);
    this.compassContainer.appendChild(this.objectiveMarker);
    this.container.appendChild(this.compassContainer);
  }

  _buildHitMarker() {
    this.hitMarker = document.createElement('div');
    this.hitMarker.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 0;
      height: 0;
      opacity: 0;
      pointer-events: none;
    `;

    const lineStyle = `
      position: absolute;
      width: 4px;
      height: 12px;
      background: #fff;
      box-shadow: 0 0 4px rgba(0,0,0,0.8);
    `;

    const lines = [
      { css: `${lineStyle} transform: rotate(45deg); left: -10px; top: -18px;` },
      { css: `${lineStyle} transform: rotate(-45deg); left: 6px; top: -18px;` },
      { css: `${lineStyle} transform: rotate(-45deg); left: -10px; top: 6px;` },
      { css: `${lineStyle} transform: rotate(45deg); left: 6px; top: 6px;` },
    ];

    for (const line of lines) {
      const el = document.createElement('div');
      el.style.cssText = line.css;
      this.hitMarker.appendChild(el);
    }

    this.container.appendChild(this.hitMarker);
  }

  _buildDamageIndicator() {
    this.damageIndicator = document.createElement('div');
    this.damageIndicator.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      width: 0;
      height: 0;
      opacity: 0;
      pointer-events: none;
    `;

    this.damageArc = document.createElement('div');
    this.damageArc.style.cssText = `
      position: absolute;
      width: 180px;
      height: 180px;
      border-radius: 50%;
      border: 5px solid transparent;
      border-top-color: rgba(255, 30, 30, 0.9);
      border-right-color: rgba(255, 30, 30, 0.5);
      left: -90px;
      top: -90px;
      transform: rotate(0deg);
    `;

    this.damageArrow = document.createElement('div');
    this.damageArrow.style.cssText = `
      position: absolute;
      width: 0;
      height: 0;
      border-left: 8px solid transparent;
      border-right: 8px solid transparent;
      border-bottom: 14px solid rgba(255, 30, 30, 0.9);
      left: -8px;
      top: -100px;
      transform: rotate(0deg);
    `;

    this.damageIndicator.appendChild(this.damageArc);
    this.damageIndicator.appendChild(this.damageArrow);
    this.container.appendChild(this.damageIndicator);
  }

  _buildReloadIndicator() {
    this.reloadIndicator = document.createElement('div');
    this.reloadIndicator.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 60px;
      height: 60px;
      opacity: 0;
      pointer-events: none;
    `;

    this.reloadCircle = document.createElement('div');
    this.reloadCircle.style.cssText = `
      width: 100%;
      height: 100%;
      border-radius: 50%;
      border: 3px solid rgba(255,255,255,0.15);
      border-top-color: #ffc800;
      animation: hud-reload-spin 0.7s linear infinite;
    `;

    this.reloadText = document.createElement('div');
    this.reloadText.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 12px;
      font-weight: 700;
      color: #ffc800;
      letter-spacing: 1px;
    `;
    this.reloadText.textContent = 'R';

    this.reloadIndicator.appendChild(this.reloadCircle);
    this.reloadIndicator.appendChild(this.reloadText);
    this.container.appendChild(this.reloadIndicator);

    if (!document.getElementById('hud-reload-style')) {
      const style = document.createElement('style');
      style.id = 'hud-reload-style';
      style.textContent = `
        @keyframes hud-reload-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes hud-hitmarker {
          0% { opacity: 1; transform: translate(-50%, -50%) scale(1.4); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(0.7); }
        }
        @keyframes hud-damage {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes hud-killconfirm {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
          15% { opacity: 1; transform: translate(-50%, -50%) scale(1.2); }
          30% { transform: translate(-50%, -50%) scale(1); }
          80% { opacity: 1; }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
        }
        @keyframes hud-lowammo {
          0%, 100% { color: #ff3333; }
          50% { color: rgba(255, 51, 51, 0.4); }
        }
      `;
      document.head.appendChild(style);
    }
  }

  _buildKillConfirm() {
    this.killConfirm = document.createElement('div');
    this.killConfirm.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      display: flex;
      align-items: center;
      gap: 12px;
      opacity: 0;
      pointer-events: none;
    `;

    this.killConfirmIcon = document.createElement('div');
    this.killConfirmIcon.style.cssText = `
      width: 32px;
      height: 32px;
      background: #ffc800;
      clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
      box-shadow: 0 0 12px rgba(255, 200, 0, 0.5);
    `;

    this.killConfirmText = document.createElement('div');
    this.killConfirmText.style.cssText = `
      font-size: 20px;
      font-weight: 700;
      color: #ffc800;
      letter-spacing: 5px;
      text-transform: uppercase;
      text-shadow: 0 0 10px rgba(255, 200, 0, 0.4);
    `;
    this.killConfirmText.textContent = 'ENEMY DOWN';

    this.killConfirm.appendChild(this.killConfirmIcon);
    this.killConfirm.appendChild(this.killConfirmText);
    this.container.appendChild(this.killConfirm);
  }

  _buildEquipment() {
    this.equipmentContainer = document.createElement('div');
    this.equipmentContainer.style.cssText = `
      position: absolute;
      bottom: 110px;
      right: 40px;
      display: flex;
      gap: 10px;
    `;

    this.grenadeIndicator = document.createElement('div');
    this.grenadeIndicator.style.cssText = `
      width: 40px;
      height: 40px;
      background: rgba(0,0,0,0.5);
      border: 1px solid rgba(255,255,255,0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      color: #fff;
      font-weight: 700;
      flex-direction: column;
    `;
    this.grenadeIndicator.innerHTML = '<span>2</span><span style="font-size:8px;color:rgba(255,255,255,0.5);letter-spacing:1px;">FRAG</span>';

    this.equipmentContainer.appendChild(this.grenadeIndicator);
    this.container.appendChild(this.equipmentContainer);
  }

  _buildKillstreak() {
    this.killstreakContainer = document.createElement('div');
    this.killstreakContainer.style.cssText = `
      position: absolute;
      top: 110px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 10px;
      opacity: 0;
      transition: opacity 0.3s;
    `;

    this.killstreakIcon = document.createElement('div');
    this.killstreakIcon.style.cssText = `
      width: 20px;
      height: 20px;
      background: #ffc800;
      clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
    `;

    this.killstreakText = document.createElement('div');
    this.killstreakText.style.cssText = `
      font-size: 18px;
      font-weight: 700;
      color: #ffc800;
      letter-spacing: 4px;
      text-transform: uppercase;
      text-shadow: 0 0 8px rgba(255, 200, 0, 0.4);
    `;

    this.killstreakContainer.appendChild(this.killstreakIcon);
    this.killstreakContainer.appendChild(this.killstreakText);
    this.container.appendChild(this.killstreakContainer);
  }

  update(dt, playerHealth, weaponSystem, wave, score) {
    if (!this._visible) return;
    this._updateCrosshair(dt, weaponSystem);
    this._updateHealth(playerHealth);
    this._updateAmmo(weaponSystem, dt);
    this._updateWave(wave);
    this._updateScore(score);
    this._updateHitMarker(dt);
    this._updateDamageIndicator(dt);
    this._updateDamageFlash(dt);
    this._updateHeadshot(dt);
    this._updateReloadIndicator();
    this._updateKillConfirm(dt);
  }

  _updateCrosshair(dt, weaponSystem) {
    const targetSpread = weaponSystem && (weaponSystem.isFiring || weaponSystem.isMoving) ? 20 : 0;
    const blend = dt * 12 < 1 ? dt * 12 : 1;
    this._crosshairSpread += (targetSpread - this._crosshairSpread) * blend;

    const s = Math.round(this._crosshairSpread * 4) / 4;
    if (s !== this._cache.spreadPx) {
      this._cache.spreadPx = s;
      this.crosshairLines.top.style.top = `${-18 - s}px`;
      this.crosshairLines.bottom.style.top = `${9 + s}px`;
      this.crosshairLines.left.style.left = `${-18 - s}px`;
      this.crosshairLines.right.style.left = `${9 + s}px`;
    }

    const color = this._onEnemy ? '#ff3333' : '#fff';
    if (color !== this._cache.crossColor) {
      this._cache.crossColor = color;
      this.crosshairLines.top.style.background = color;
      this.crosshairLines.bottom.style.background = color;
      this.crosshairLines.left.style.background = color;
      this.crosshairLines.right.style.background = color;
      this.crosshairDot.style.background = color;
    }
  }

  _updateHealth(health) {
    if (!health) return;
    const raw = typeof health === 'number' ? health : (health.health !== undefined ? health.health : health.getHealth());
    const pct = Math.max(0, Math.min(100, raw));
    const quantised = Math.round(pct * 2) / 2;
    const color = pct <= 25 ? '#ff3333' : (pct <= 50 ? '#ffaa00' : '#00ff88');

    if (quantised !== this._cache.healthPct) {
      this._cache.healthPct = quantised;
      this.healthBarInner.style.width = `${quantised}%`;
    }
    if (color !== this._cache.healthColor) {
      this._cache.healthColor = color;
      this.healthBarInner.style.backgroundColor = color;
    }

    if (this.healthNumber) {
      const shown = Math.ceil(pct);
      if (shown !== this._cache.healthText) {
        this._cache.healthText = shown;
        this.healthNumber.textContent = shown;
        this.healthNumber.style.color = color;
      } else if (color !== this._cache.healthTextColor) {
        this.healthNumber.style.color = color;
      }
    }
    this._cache.healthTextColor = color;
  }

  _updateAmmo(weaponSystem, dt) {
    if (!weaponSystem) return;
    const c = this._cache;
    let current = weaponSystem.currentAmmo;
    let reserve = weaponSystem.reserveAmmo;
    let name = weaponSystem.weaponName;
    let mode = weaponSystem.fireMode;

    const state = weaponSystem.state;
    const active = state && weaponSystem.currentType ? state[weaponSystem.currentType] : null;
    if (active) {
      if (current === undefined) current = active.ammo;
      if (reserve === undefined) reserve = active.reserve;
      if (!name) name = active.name;
      if (!mode) mode = active.fireMode;
    }
    if (current === undefined) current = 0;
    if (reserve === undefined) reserve = 0;

    if (current !== c.ammo) {
      c.ammo = current;
      if (this.ammoCurrentEl) this.ammoCurrentEl.textContent = current;
    }
    if (reserve !== c.reserve) {
      c.reserve = reserve;
      if (this.ammoReserveEl) this.ammoReserveEl.textContent = reserve;
    }
    if (name && name !== c.weaponName) {
      c.weaponName = name;
      this.weaponName.textContent = name;
    }
    if (mode && mode !== c.fireMode) {
      c.fireMode = mode;
      this.fireMode.textContent = mode;
    }

    const currentEl = this.ammoCurrentEl;
    if (!currentEl) return;

    let ammoColor = '#fff';
    if (current <= 6 && current > 0) {
      this._lowAmmoPulse += dt * 4;
      ammoColor = `rgba(255, 51, 51, ${(0.5 + Math.sin(this._lowAmmoPulse) * 0.5).toFixed(2)})`;
    } else if (current === 0) {
      ammoColor = '#ff3333';
    }
    if (ammoColor !== c.ammoColor) {
      c.ammoColor = ammoColor;
      currentEl.style.color = ammoColor;
    }
  }

  _updateWave(wave) {
    if (!wave) return;
    const c = this._cache;
    const number = typeof wave === 'number' ? wave : (wave.number || 1);
    if (number !== c.wave) {
      c.wave = number;
      this.waveText.textContent = `WAVE ${number}`;
    }

    const remaining = typeof wave === 'number' ? 0 : (wave.enemiesRemaining || 0);
    if (remaining !== c.hostiles) {
      c.hostiles = remaining;
      this.enemyCount.textContent = `${remaining} HOSTILES`;
    }

    const total = typeof wave === 'number' ? 0 : (wave.enemiesTotal || 0);
    if (total && this.waveProgressInner) {
      const progress = Math.round(((total - remaining) / total) * 200) / 2;
      if (progress !== c.progress) {
        c.progress = progress;
        this.waveProgressInner.style.width = `${progress}%`;
      }
    }
  }

  _updateScore(score) {
    if (score === this._cache.score) return;
    this._cache.score = score;
    this.scoreValue.textContent = score || 0;
  }

  _updateHitMarker(dt) {
    if (this._hitMarkerTimer > 0) {
      this._hitMarkerTimer -= dt;
      if (this._hitMarkerTimer <= 0) {
        this.hitMarker.style.opacity = '0';
      }
    }
  }

  _updateDamageIndicator(dt) {
    if (this._damageIndicatorTimer > 0) {
      this._damageIndicatorTimer -= dt;
      const opacity = Math.min(1, this._damageIndicatorTimer / 0.5);
      this.damageIndicator.style.opacity = opacity;
      if (this._damageIndicatorTimer <= 0) {
        this.damageIndicator.style.opacity = '0';
      }
    }
  }

  _updateReloadIndicator() {
    const active = this._reloadActive;
    if (active === this._cache.reloadVisible) return;
    this._cache.reloadVisible = active;
    this.reloadIndicator.style.opacity = active ? '1' : '0';
  }

  _updateKillConfirm(dt) {
    if (this._killConfirmTimer > 0) {
      this._killConfirmTimer -= dt;
      if (this._killConfirmTimer <= 0) {
        this.killConfirm.style.opacity = '0';
      }
    }
  }

  showHitMarker(kill) {
    this._hitMarkerTimer = 0.25;
    this.hitMarker.style.opacity = '1';
    this.hitMarker.style.animation = 'none';
    this.hitMarker.offsetHeight;
    this.hitMarker.style.animation = 'hud-hitmarker 0.25s ease-out forwards';

    const color = kill ? '#ff3333' : '#fff';
    for (const child of this.hitMarker.children) {
      child.style.backgroundColor = color;
    }

    if (kill) {
      this._killConfirmTimer = 1.2;
      this.killConfirm.style.animation = 'none';
      this.killConfirm.offsetHeight;
      this.killConfirm.style.animation = 'hud-killconfirm 1.2s ease-out forwards';
    }
  }

  showDamageDirection(angle) {
    this._damageAngle = angle;
    this._damageIndicatorTimer = 0.8;
    this.damageIndicator.style.transform = `rotate(${angle}rad)`;
    this.damageArc.style.transform = `rotate(${angle}rad)`;
    this.damageArrow.style.transform = `rotate(${angle}rad)`;
    this.damageIndicator.style.opacity = '1';
  }

  flashDamage(intensity = 1) {
    const v = Math.max(0, Math.min(1, intensity));
    if (!this._damageFlashEl) {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:40;background:radial-gradient(ellipse at center, rgba(150,0,0,0) 35%, rgba(170,10,10,0.55) 80%, rgba(90,0,0,0.9) 100%);opacity:0;';
      this.container.appendChild(el);
      this._damageFlashEl = el;
      this._damageFlashValue = -1;
    }
    this._damageFlash = v;
  }

  _updateDamageFlash(dt) {
    if (!this._damageFlashEl) return;
    if (this._damageFlash > 0) this._damageFlash -= dt * 1.8;
    if (this._damageFlash < 0) this._damageFlash = 0;
    const v = Math.round(this._damageFlash * 50) / 50;
    if (v === this._damageFlashValue) return;
    this._damageFlashValue = v;
    this._damageFlashEl.style.opacity = String(v);
  }

  setNetInfo(info) {
    if (!info) return;
    const label = info.mode === 'mp'
      ? `MP · ${info.ping}ms · SERVER`
      : 'SOLO';
    const key = 'netmode';
    if (this._cache[key] === label) return;
    this._cache[key] = label;
    let el = document.getElementById('hud-netmode');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hud-netmode';
      el.style.cssText = 'position:absolute;top:26px;left:50%;transform:translateX(-50%);font:10px ui-monospace,Menlo,monospace;letter-spacing:2px;color:#7fe08a;background:rgba(0,0,0,.5);padding:3px 9px;border-radius:2px;pointer-events:none;';
      this.container.appendChild(el);
    }
    el.textContent = label;
    el.style.color = info.mode === 'mp' ? '#7fe08a' : '#7a8496';
  }

  showHeadshot() {
    this._headshotTimer = 0.7;
  }

  _updateHeadshot(dt) {
    if (!this._headshotTimer) return;
    this._headshotTimer -= dt;
    if (this._headshotTimer <= 0) {
      this._headshotTimer = 0;
      if (this._headshotEl) this._headshotEl.style.opacity = '0';
      return;
    }
    if (!this._headshotEl) {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;top:calc(50% + 34px);left:50%;transform:translateX(-50%);font:700 10px ui-monospace,Menlo,monospace;letter-spacing:2px;color:#ffd24a;text-shadow:0 0 8px rgba(0,0,0,0.9);opacity:0;pointer-events:none;';
      el.textContent = 'HEADSHOT';
      this.container.appendChild(el);
      this._headshotEl = el;
    }
    this._headshotEl.style.opacity = String(Math.min(1, this._headshotTimer * 3));
  }

  showReloadProgress(progress) {
    this._reloadActive = progress > 0 && progress < 1;
    this._reloadProgress = progress;
  }

  setCompassRotation(angle) {
    const deg = angle * (180 / Math.PI);
    const offset = Math.round(-(deg / 360) * 496);
    if (offset === this._cache.compass) return;
    this._cache.compass = offset;
    this.compassStrip.style.transform = `translateX(${offset}px)`;
  }

  setObjectiveMarker(angle) {
    if (!this.objectiveMarker) return;
    const deg = angle * (180 / Math.PI);
    const offset = Math.round(-(deg / 360) * 496);
    if (offset === this._cache.objective) return;
    this._cache.objective = offset;
    this.objectiveMarker.style.display = 'block';
    this.objectiveMarker.style.left = `${250 + offset}px`;
  }

  setCrosshairOnEnemy(onEnemy) {
    this._onEnemy = onEnemy;
  }

  showKillstreak(count) {
    if (count >= 3) {
      this.killstreakText.textContent = `${count} KILL STREAK`;
      this.killstreakContainer.style.opacity = '1';
      setTimeout(() => {
        this.killstreakContainer.style.opacity = '0';
      }, 2000);
    }
  }

  show() {
    if (this._visible) return;
    this._visible = true;
    this.container.style.display = 'block';
  }

  hide() {
    if (!this._visible) return;
    this._visible = false;
    this.container.style.display = 'none';
  }
}
