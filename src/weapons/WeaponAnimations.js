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

export class WeaponAnimations {
  constructor(quality) {
    this.quality = Object.assign({}, DEFAULT_QUALITY, quality || {});
    this.lowDetail = (this.quality.propDetail | 0) === 0;

    this.time = 0;
    this.bobPhase = 0;
    this.recoilOffset = new THREE.Vector3();
    this.recoilRotation = new THREE.Euler();
    this.recoilRecovery = 0;
    this.recoilAccum = 0;
    this.adsBlend = 0;
    this.reloadPhase = 0;
    this.switchPhase = 0;
    this.isSwitching = false;
    this.isReloading = false;
    this.switchDirection = 1;
    this.basePosition = new THREE.Vector3(0.12, -0.12, -0.25);
    this.adsPosition = new THREE.Vector3(0, -0.06, -0.15);
    this.sprintPosition = new THREE.Vector3(0.15, -0.18, -0.2);
    this.sprintRotation = new THREE.Euler(0.3, 0.4, 0.2);
    this._tempVec = new THREE.Vector3();
    this._adsVec = new THREE.Vector3();
    this._tempEuler = new THREE.Euler();
    this._breathPhase = 0;
    this._swayX = 0;
    this._swayY = 0;
    this._lastMouseX = 0;
    this._lastMouseY = 0;
    this._recoilClimb = 0;
    this._recoilSide = 0;
    this._springVel = 0;
    this._springPos = 0;
    this._weaponSpecific = {
      rifle: { bobFreq: 1.0, bobAmp: 1.0, recoilMult: 1.0, adsSpeed: 1.0, climbRate: 0.6, sideRate: 0.3 },
      smg: { bobFreq: 1.3, bobAmp: 0.7, recoilMult: 0.6, adsSpeed: 1.2, climbRate: 0.4, sideRate: 0.5 },
      sniper: { bobFreq: 0.6, bobAmp: 1.4, recoilMult: 2.0, adsSpeed: 0.6, climbRate: 1.2, sideRate: 0.1 },
      pistol: { bobFreq: 1.1, bobAmp: 0.8, recoilMult: 0.8, adsSpeed: 1.4, climbRate: 0.5, sideRate: 0.4 },
    };
    this._outPosition = new THREE.Vector3();
    this._outRotation = new THREE.Euler();
  }

  update(dt, state) {
    this.time += dt;
    const {
      isMoving, isSprinting, isAds, isReloading,
      isSwitching, isFiring, moveSpeed, weaponType
    } = state;

    this.isReloading = isReloading;
    this.isSwitching = isSwitching;

    const ws = this._weaponSpecific[weaponType] || this._weaponSpecific.rifle;

    if (isSwitching) {
      this.switchPhase += dt * 3.5 * ws.adsSpeed;
      if (this.switchPhase >= 1) {
        this.switchPhase = 0;
        this.isSwitching = false;
      }
    }

    if (isReloading) {
      this.reloadPhase += dt * 0.8;
      if (this.reloadPhase >= 1) {
        this.reloadPhase = 0;
        this.isReloading = false;
      }
    }

    const targetAds = isAds ? 1 : 0;
    const adsSpeed = 12 * ws.adsSpeed;
    this.adsBlend += (targetAds - this.adsBlend) * Math.min(dt * adsSpeed, 1);
    const inv = 1 - this.adsBlend;
    this.adsBlend = 1 - inv * inv * inv;

    if (isMoving || isSprinting) {
      this.bobPhase += dt * moveSpeed * (isSprinting ? 3.5 : 2.5) * ws.bobFreq;
    }

    if (isFiring) {
      this.recoilRecovery = 1;
      this.recoilAccum = this.recoilAccum + 0.15 < 1 ? this.recoilAccum + 0.15 : 1;
      this._recoilClimb = Math.min(this._recoilClimb + ws.climbRate * dt * 8, 1);
      this._recoilSide += (Math.random() - 0.5) * ws.sideRate * dt * 10;
      this._recoilSide = _clamp(this._recoilSide, -0.3, 0.3);
    }

    this.recoilRecovery = Math.max(0, this.recoilRecovery - dt * 8);
    this.recoilAccum = Math.max(0, this.recoilAccum - dt * 1.5);
    this._recoilClimb = Math.max(0, this._recoilClimb - dt * 2);
    this._recoilSide *= 1 - dt * 4 < 0 ? 0 : (1 - dt * 4);

    const recoilAmount = this.recoilRecovery * this.recoilRecovery;
    const climbAmount = this._recoilClimb * this._recoilClimb;

    this._springVel += (-this._springPos * 120 - this._springVel * 12) * dt;
    this._springPos += this._springVel * dt;

    this._swayX += (0 - this._swayX) * Math.min(dt * 8, 1);
    this._swayY += (0 - this._swayY) * Math.min(dt * 8, 1);

    const pos = this._tempVec.copy(this.basePosition);
    const rot = this._tempEuler;
    rot.set(0, 0, 0);

    if (isMoving && !isSprinting) {
      const bobFreq = this.bobPhase;
      const bobAmp = 0.008 * ws.bobAmp;
      pos.y += Math.sin(bobFreq * 2) * bobAmp;
      pos.x += Math.cos(bobFreq) * bobAmp * 0.6;
      rot.z += Math.cos(bobFreq) * 0.02;
      rot.x += Math.sin(bobFreq * 2) * 0.015;
    }

    if (isSprinting) {
      pos.y += Math.sin(this.bobPhase * 2) * 0.015;
      pos.x += Math.cos(this.bobPhase) * 0.01;
      rot.x += 0.15;
      rot.y += 0.2;
      rot.z += 0.1;
    }

    const idleSway = Math.sin(this.time * 1.5) * 0.003;
    const idleSwayY = Math.cos(this.time * 1.2) * 0.002;
    pos.y += idleSway;
    pos.x += idleSwayY;
    rot.z += idleSway * 0.5;
    rot.x += idleSwayY * 0.3;
    rot.y += this._swayX;
    rot.x += this._swayY;

    if (!this.lowDetail) {
      this._breathPhase += dt * 1.2;
      const breathAmp = isAds ? 2.5 : 1.0;
      pos.y += Math.cos(this._breathPhase * 0.7) * 0.0015 * breathAmp;
      pos.x += Math.sin(this._breathPhase) * 0.002 * breathAmp;
    }

    if (this.adsBlend > 0.001) {
      pos.lerp(this._adsVec.copy(this.adsPosition), this.adsBlend);
      rot.x *= 1 - this.adsBlend;
      rot.y *= 1 - this.adsBlend;
      rot.z *= 1 - this.adsBlend;
    }

    if (isReloading) {
      const rp = this.reloadPhase;
      let reloadTilt = 0;
      let magDrop = 0;
      let magInsert = 0;
      let chargeHandle = 0;

      if (rp < 0.25) {
        const t = rp / 0.25;
        reloadTilt = Math.sin(t * HALF_PI) * 0.35;
        magDrop = Math.sin(t * HALF_PI);
      } else if (rp < 0.45) {
        reloadTilt = 0.35;
        magDrop = 1;
      } else if (rp < 0.65) {
        const t = (rp - 0.45) / 0.2;
        reloadTilt = 0.35;
        magDrop = 1 - t;
        magInsert = Math.sin(t * HALF_PI);
      } else if (rp < 0.85) {
        const t = (rp - 0.65) / 0.2;
        reloadTilt = 0.35 * (1 - t);
        magInsert = 1 - t;
        chargeHandle = Math.sin(t * Math.PI);
      }

      rot.z += reloadTilt;
      rot.x += reloadTilt * 0.3;
      pos.y -= magDrop * 0.05;
      pos.x += magDrop * 0.02;
      pos.y -= magInsert * 0.03;
      pos.x -= magInsert * 0.015;
      rot.x -= chargeHandle * 0.15;
      pos.z += chargeHandle * 0.02;
    }

    if (isSwitching) {
      const sp = this.switchPhase;
      const rising = sp < 0.5;
      const t = rising ? sp / 0.5 : (sp - 0.5) / 0.5;
      const k = rising ? t : (1 - t);
      pos.y -= k * 0.3;
      rot.x -= k * 0.5;
      rot.z += k * 0.3;
    }

    const accumMult = 1 + this.recoilAccum * 0.5;
    const rm = ws.recoilMult * accumMult;
    pos.z += recoilAmount * 0.04 * rm;
    pos.y += recoilAmount * 0.015 * rm + climbAmount * 0.025 * ws.recoilMult;
    rot.x -= recoilAmount * 0.12 * rm + climbAmount * 0.08 * ws.recoilMult;
    rot.z += recoilAmount * 0.03 * rm + this._recoilSide * 0.02;
    pos.x += this._springPos * 0.003;

    this._outPosition.copy(pos);
    this._outRotation.set(rot.x, rot.y, rot.z);

    return { position: this._outPosition, rotation: this._outRotation };
  }

  triggerRecoil() {
    this.recoilRecovery = 1;
    this._springVel -= 2;
  }

  startReload() {
    this.isReloading = true;
    this.reloadPhase = 0;
  }

  startSwitch() {
    this.isSwitching = true;
    this.switchPhase = 0;
  }

  addSway(deltaX, deltaY) {
    this._swayX = _clamp(this._swayX + deltaX * 0.001, -0.05, 0.05);
    this._swayY = _clamp(this._swayY + deltaY * 0.001, -0.05, 0.05);
  }
}

const HALF_PI = Math.PI * 0.5;

function _clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}
