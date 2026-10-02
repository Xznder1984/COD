import * as THREE from 'three';
import { WeaponModels } from './WeaponModels.js';
import { WeaponAnimations } from './WeaponAnimations.js';
import { Ballistics } from './Ballistics.js';
import { WeaponEffects } from './WeaponEffects.js';

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

const SLOT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];

const WEAPON_STATS = {
  rifle: {
    name: 'M4A1', magSize: 30, reserve: 800, rpm: 600, damage: 25,
    spread: 0.02, auto: true, reloadTime: 2.2, bulletSpeed: 880,
    recoilAmount: 0.028, adsFov: 55,
    recoilPattern: { pitch: 1.0, yaw: 0.3, climb: 0.8 },
  },
  smg: {
    name: 'MP5', magSize: 32, reserve: 960, rpm: 750, damage: 18,
    spread: 0.03, auto: true, reloadTime: 2.0, bulletSpeed: 400,
    recoilAmount: 0.018, adsFov: 58,
    recoilPattern: { pitch: 0.6, yaw: 0.5, climb: 0.4 },
  },
  sniper: {
    name: 'AWP', magSize: 5, reserve: 50, rpm: 60, damage: 100,
    spread: 0.001, auto: false, reloadTime: 3.0, bulletSpeed: 950,
    recoilAmount: 0.06, adsFov: 20,
    recoilPattern: { pitch: 2.0, yaw: 0.1, climb: 1.5 },
  },
  pistol: {
    name: 'M-1911', magSize: 12, reserve: 120, rpm: 300, damage: 30,
    spread: 0.015, auto: false, reloadTime: 1.5, bulletSpeed: 370,
    recoilAmount: 0.025, adsFov: 60,
    recoilPattern: { pitch: 0.8, yaw: 0.4, climb: 0.6 },
  },
};

export class WeaponSystem {
  constructor(scene, camera, physics, input, assetFactory, audio, quality, engine) {
    this.engine = engine || null;
    this.scene = scene;
    this.camera = camera;
    this.physics = physics;
    this.input = input;
    this.audio = audio;
    this.quality = Object.assign({}, DEFAULT_QUALITY, quality || {});

    this.models = new WeaponModels(assetFactory, this.quality);
    this.animations = new WeaponAnimations(this.quality);
    this.ballistics = new Ballistics(physics, this.quality);
    this.ballistics.setEnemyProvider(() => (this.enemyProvider ? this.enemyProvider() : null));
    this.effects = new WeaponEffects(scene, assetFactory, this.quality);

    this.weaponRig = new THREE.Group();
    this.camera.add(this.weaponRig);

    this.inventory = ['rifle', 'smg', 'sniper', 'pistol'];
    this.currentIndex = 0;
    this.currentType = 'rifle';

    this.state = {};
    for (const type of this.inventory) {
      const stats = WEAPON_STATS[type];
      this.state[type] = {
        type,
        name: stats.name,
        fireMode: stats.auto ? 'AUTO' : 'SEMI',
        magSize: stats.magSize,
        maxReserve: stats.reserve,
        ammo: stats.magSize,
        reserve: stats.reserve,
        reloading: false,
        reloadTimer: 0,
        switching: false,
        switchTimer: 0,
        firing: false,
        lastFireTime: 0,
        spread: 0,
        boltTimer: 0,
        shotsFired: 0,
      };
    }

    this.onEnemyHit = null;
    this._switchTarget = null;
    this._queuedSwitch = null;

    this.currentModel = null;
    for (const type of this.inventory) {
      const m = this.models.getWeaponModel(type);
      if (m) m.visible = false;
    }
    this._equipModel(this.currentType);

    // ADS narrows the FOV; the hip-fire value comes from the engine so a settings
    // change is respected instead of being overwritten every frame.
    this.baseFov = camera.fov;
    this.currentFov = this.baseFov;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.recoilRecovery = 0;
    this._cameraShake = 0;
    this._shakeOffset = new THREE.Vector3();

    this.isAds = false;
    this.isSprinting = false;
    this.isMoving = false;
    this.moveSpeed = 0;

    this._prevFire = false;
    this._prevReload = false;
    this._prevDigit = [false, false, false, false];
    this._tempVec = new THREE.Vector3();
    this._tempDir = new THREE.Vector3();
    this._rightDir = new THREE.Vector3();
    this._muzzleWorld = new THREE.Vector3();
    this._tracerEnd = new THREE.Vector3();
    this._animState = {
      isMoving: false,
      isSprinting: false,
      isAds: false,
      isReloading: false,
      isSwitching: false,
      isFiring: false,
      moveSpeed: 0,
      weaponType: 'rifle',
    };
    this._now = 0;
    this._onWheel = (e) => {
      const dir = e.deltaY > 0 ? 1 : -1;
      this._switchWeapon((this.currentIndex + dir + this.inventory.length) % this.inventory.length);
    };
    window.addEventListener('wheel', this._onWheel);
  }

  _equipModel(type) {
    const model = this.models.getWeaponModel(type);
    if (this.currentModel) {
      this.currentModel.visible = false;
      if (this.weaponRig.children.indexOf(this.currentModel) !== -1) {
        this.weaponRig.remove(this.currentModel);
      }
    }
    this.currentModel = model;
    if (!model) return;
    model.visible = true;
    this.weaponRig.add(model);
  }

  _switchWeapon(index) {
    if (this._switchTarget || this.state[this.currentType].reloading) {
      // A switch is mid-flight: remember the request instead of dropping it, so
      // mashing slot keys always lands on the weapon the player last asked for.
      if (index !== this.currentIndex || this._switchTarget) this._queuedSwitch = index;
      return;
    }
    if (index === this.currentIndex) {
      this._queuedSwitch = null;
      return;
    }

    this._queuedSwitch = null;
    this.currentIndex = index;
    const type = this.inventory[index];
    const target = this.state[type];
    target.switching = true;
    target.switchTimer = 0;
    this._switchTarget = target;
    this.animations.startSwitch();
  }

  _startReload() {
    const s = this.state[this.currentType];
    const stats = WEAPON_STATS[this.currentType];
    if (s.reloading || this._switchTarget) return;
    if (s.ammo >= stats.magSize) return;
    if (s.reserve <= 0) return;

    s.reloading = true;
    s.reloadTimer = 0;
    this.animations.startReload();
  }

  _fire() {
    const s = this.state[this.currentType];
    const stats = WEAPON_STATS[this.currentType];

    if (s.ammo <= 0) {
      this._startReload();
      return;
    }

    s.ammo--;
    s.lastFireTime = this._now;
    s.firing = true;
    s.shotsFired++;

    const spread = this._getCurrentSpread();
    const dir = this.getAimDirection();
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();

    const muzzlePos = this._getMuzzleWorldPosition();
    this.ballistics.fire(muzzlePos, dir, stats.bulletSpeed, stats.damage);

    this.effects.muzzleFlash(muzzlePos, dir);
    this.effects.createTracer(muzzlePos, this._tracerEnd.copy(muzzlePos).addScaledVector(dir, 50));

    this._rightDir.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.effects.ejectCasing(muzzlePos, this._rightDir);

    const pattern = stats.recoilPattern;
    const firstShotMult = s.shotsFired === 1 ? 0.5 : 1;
    this.recoilPitch += stats.recoilAmount * pattern.pitch * (0.8 + Math.random() * 0.4) * firstShotMult;
    this.recoilYaw += stats.recoilAmount * pattern.yaw * (Math.random() - 0.5) * 0.5;
    this.recoilRecovery = 1;
    this._cameraShake = Math.min(this._cameraShake + 0.5, 1.5);
    this.animations.triggerRecoil();

    s.spread = Math.min(s.spread + 0.3, 1);

    if (this.audio && this.audio.initialized) {
      const noise = this.audio.generateNoise(0.12, 0.5);
      if (noise) this.audio.playSound(noise, { volume: 0.7, pitch: 0.7 + Math.random() * 0.3 });
      const crack = this.audio.generateNoise(0.03, 0.6);
      if (crack) this.audio.playSound(crack, { volume: 0.5, pitch: 1.5 + Math.random() * 0.5 });
    }

    if (s.ammo <= 0) {
      this._startReload();
    }
  }

  _getCurrentSpread() {
    const stats = WEAPON_STATS[this.currentType];
    const s = this.state[this.currentType];
    let spread = stats.spread;

    if (this.isAds) {
      spread *= 0.3;
    }
    if (this.isMoving) {
      spread *= 1.5;
    }
    if (this.isSprinting) {
      spread *= 2;
    }

    spread *= (1 + s.spread * 2);
    return spread;
  }

  _getMuzzleWorldPosition() {
    const muzzleLocal = this.models.getMuzzlePosition(this.currentType);
    this._muzzleWorld.copy(muzzleLocal);
    this.currentModel.updateMatrixWorld();
    this.currentModel.localToWorld(this._muzzleWorld);
    return this._muzzleWorld;
  }

  getAimDirection() {
    this._tempDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    return this._tempDir;
  }

  getCurrentWeapon() {
    const s = this.state[this.currentType];
    return {
      type: this.currentType,
      ammo: s.ammo,
      reserve: s.reserve,
      model: this.currentModel,
      group: this.currentModel,
      stats: WEAPON_STATS[this.currentType],
    };
  }

  update(dt) {
    const s = this.state[this.currentType];
    const stats = WEAPON_STATS[this.currentType];

    this._now = performance.now() * 0.001;

    const pending = this._switchTarget;
    const switching = pending !== null;

    const adsDown = this.input.isMouseDown(2);
    this.isAds = adsDown && !s.reloading && !switching;
    this.isSprinting = this.input.isKeyDown('ShiftLeft') && this.isMoving && !this.isAds;

    if (switching) {
      pending.switchTimer += dt;
      if (pending.switchTimer >= 0.4 && this.currentType !== pending.type) {
        this.currentType = pending.type;
        this._equipModel(pending.type);
      }
      if (pending.switchTimer >= 0.8) {
        pending.switching = false;
        pending.switchTimer = 0;
        this._switchTarget = null;
        if (this._queuedSwitch !== null) {
          const queued = this._queuedSwitch;
          this._queuedSwitch = null;
          this._switchWeapon(queued);
        }
      }
    }

    if (s.reloading) {
      s.reloadTimer += dt;
      if (s.reloadTimer >= stats.reloadTime) {
        const needed = stats.magSize - s.ammo;
        const available = needed < s.reserve ? needed : s.reserve;
        s.ammo += available;
        s.reserve -= available;
        s.reloading = false;
        s.reloadTimer = 0;
      }
    }

    if (this.input.wasPressed('KeyR')) {
      this._startReload();
    }

    for (let i = 0; i < 4; i++) {
      if (this.input.wasPressed(SLOT_KEYS[i])) {
        this._switchWeapon(i);
      }
    }

    const fireButton = this.input.isMouseDown(0);
    const prevFire = this._prevFire;
    const fireInterval = 60 / stats.rpm;

    if (fireButton && !s.reloading && !switching) {
      if (stats.auto) {
        if (this._now - s.lastFireTime >= fireInterval) {
          this._fire();
        }
      } else if (!prevFire) {
        if (this._now - s.lastFireTime >= fireInterval) {
          this._fire();
        }
      }
    }

    if (this.currentType === 'sniper' && !fireButton && prevFire) {
      s.boltTimer = 0.5;
    }
    if (s.boltTimer > 0) {
      s.boltTimer -= dt;
    }

    s.spread = s.spread - dt * 1.2 > 0 ? s.spread - dt * 1.2 : 0;
    s.firing = false;

    this.recoilRecovery = Math.max(0, this.recoilRecovery - dt * 4);
    const recoilScale = this.recoilRecovery * this.recoilRecovery;
    this.recoilPitch *= 1 - dt * 5 > 0 ? 1 - dt * 5 : 0;
    this.recoilYaw *= 1 - dt * 5 > 0 ? 1 - dt * 5 : 0;

    this._cameraShake = Math.max(0, this._cameraShake - dt * 3);

    // ADS narrows the FOV. The Engine resolves the final value from the hip FOV plus
    // whatever modifiers register, so we never write camera.fov directly.
    const adsScale = stats.adsFov / 78;
    const targetScale = this.isAds ? adsScale : 1;
    const prevScale = this.adsScale === undefined ? 1 : this.adsScale;
    this.adsScale = prevScale + (targetScale - prevScale) * Math.min(dt * 12, 1);
    this._adsScale = this.adsScale;

    this.camera.rotation.x += this.recoilPitch * recoilScale * 0.35;
    this.camera.rotation.y += this.recoilYaw * recoilScale * 0.35;

    const animState = this._animState;
    animState.isMoving = this.isMoving;
    animState.isSprinting = this.isSprinting;
    animState.isAds = this.isAds;
    animState.isReloading = s.reloading;
    animState.isSwitching = switching;
    animState.isFiring = fireButton && this._now - s.lastFireTime < 0.05;
    animState.moveSpeed = this.moveSpeed;
    animState.weaponType = this.currentType;

    const anim = this.animations.update(dt, animState);

    this.weaponRig.position.copy(anim.position);
    this.weaponRig.rotation.copy(anim.rotation);

    if (this.isAds) {
      this.weaponRig.position.x *= 0.3;
      this.weaponRig.position.y *= 0.5;
    }

    const hits = this.ballistics.update(dt);
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];

      if (hit.enemy) {
        if (this.onEnemyHit) {
          this.onEnemyHit(hit.enemy, hit.damage, hit.enemy.isAlive(), hit.isHeadshot);
        }
        this.effects.impactEffect(hit.point, hit.normal, 'flesh');
        continue;
      }

      const mat = hit.object ? hit.object.material : null;
      const matType = mat && mat.metalness > 0.5 ? 'metal' : 'concrete';
      this.effects.impactEffect(hit.point, hit.normal, matType);
    }

    this.effects.update(dt);

    this._prevFire = fireButton;
  }

  setMovementState(isMoving, moveSpeed) {
    this.isMoving = isMoving;
    this.moveSpeed = moveSpeed;
  }

  dispose() {
    window.removeEventListener('wheel', this._onWheel);
    this.effects.clear();
    this.ballistics.clear();
    this.camera.remove(this.weaponRig);
  }
}
