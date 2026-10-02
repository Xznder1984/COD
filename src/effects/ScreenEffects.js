import * as THREE from 'three';

const DEFAULT_QUALITY = {
  maxPixelRatio: 0.7,
  renderScale: 0.7,
  bloomEnabled: false,
  grainEnabled: false,
  shadowsEnabled: false,
  name: 'low',
};

const SHAKE_AXIS_Y = 0.92;
const SHAKE_AXIS_Z = 0.55;
const SHAKE_ROT_SCALE = 0.025;
const SHAKE_ROT_SPREAD = 0.6;

export class ScreenEffects {
  constructor(camera, engine, quality = DEFAULT_QUALITY) {
    this.camera = camera;
    this.engine = engine;
    this.quality = quality;
    this.lean = quality.name === 'potato' || quality.name === 'low';

    this.shakeIntensity = 0;
    this.shakeDuration = 0;
    this.shakeTime = 0;
    this.cameraOffsetMainMustReset = new THREE.Vector3();
    this.shakeRotation = new THREE.Euler();
    this.isADS = false;
    this._shakeActive = false;

    this.damageIntensity = 0;
    this.damageDirection = new THREE.Vector3();
    this.damageFadeSpeed = 2.0;
    this.damageDirectionAlpha = 0;
    this.damageDirectionAngle = 0;

    this.hitMarkerTime = this.hitMarkerDuration = 0.15;
    this.hitMarkerKill = false;
    this.hitMarkerScale = 1.0;
    this.hitMarkerHeadshot = false;

    this.lowHealthPulse = 0;
    this.baseFov = camera.fov;
    this.targetFov = this.baseFov;
    this.currentFov = this.baseFov;
    this.fovEasing = 0;
    this.sprintFovKick = 0;
    this._fovDirty = true;

    this.breathSway = new THREE.Vector2();
    this.breathSpeed = 1.2;
    this.breathAmount = 0.002;

    this.weaponBob = new THREE.Vector2();
    this.weaponBobSpeed = 0;
    this.weaponBobAmount = 0;

    this.weaponSway = new THREE.Vector2();
    this.weaponSwayTarget = new THREE.Vector2();
    this.weaponSwaySmoothing = 8;

    this.landDip = 0;
    this.landDipVelocity = 0;
    this.landDipSpring = 150;
    this.landDipDamping = 12;

    this.strafeTilt = 0;
    this.strafeTiltTarget = 0;

    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.recoilRecoverySpeed = 8;

    this.footstepTimer = 0;
    this.footstepInterval = 0.4;
    this.footstepIntensity = 0;

    this._noiseSeed = Math.random() * 1000;
    this._noiseJitter = 0;
    this._noiseValue = 0;
    this._recoil = { pitch: 0, yaw: 0 };
    this._elapsed = 0;
  }

  shake(intensity, duration) {
    const adsFactor = this.isADS ? 0.3 : 1.0;
    const scaled = intensity * adsFactor;
    if (scaled > this.shakeIntensity) this.shakeIntensity = scaled;
    if (duration > this.shakeDuration || this.shakeTime >= this.shakeDuration) {
      this.shakeDuration = duration;
      this.shakeTime = 0;
    }
    this._shakeActive = true;
  }

  damageFlash(direction) {
    this.damageIntensity = 1.0;
    if (direction) {
      this.damageDirection.copy(direction);
      this.damageDirectionAngle = Math.atan2(direction.x, direction.z);
    }
    this.damageDirectionAlpha = 1.0;
    this.shake(0.15, 0.2);
  }

  hitMarker(kill, headshot = false) {
    this.hitMarkerTime = 0;
    this.hitMarkerKill = kill;
    this.hitMarkerHeadshot = headshot;
    this.hitMarkerScale = kill ? 1.5 : 1.0;
  }

  setADS(adsFactor) {
    this.isADS = adsFactor > 0;
    this.targetFov = this.baseFov * (1.0 - adsFactor * 0.25);
    this.fovEasing = 0;
    this._fovDirty = true;
  }

  setSprinting(sprinting) {
    this.sprintFovKick = sprinting ? 5 : 0;
    this.targetFov = this.baseFov + this.sprintFovKick;
    this.fovEasing = 0;
    this._fovDirty = true;
  }

  addRecoil(pitch, yaw) {
    this.recoilPitch += pitch;
    this.recoilYaw += yaw;
  }

  onLand(impactVelocity) {
    this.landDipVelocity -= impactVelocity * 0.01;
    this.shake(impactVelocity * 0.02, 0.15);
  }

  setStrafeTilt(tilt) {
    this.strafeTiltTarget = tilt * 0.02;
  }

  setWeaponBob(speed) {
    this.weaponBobSpeed = speed;
    const amt = speed * 0.2;
    this.weaponBobAmount = (amt > 1 ? 1 : amt) * 0.003;
  }

  setWeaponSway(mouseDeltaX, mouseDeltaY) {
    this.weaponSwayTarget.x = mouseDeltaX * 0.001;
    this.weaponSwayTarget.y = mouseDeltaY * 0.001;
  }

  onFootstep() {
    const amt = this.weaponBobSpeed * 0.2;
    this.footstepIntensity = (amt > 1 ? 1 : amt) * 0.03;
  }

  update(dt, health, maxHealth) {
    this._elapsed = this.engine ? this.engine.getElapsed() : (this._elapsed += dt);

    this._updateShake(dt);
    this._updateDamage(dt);

    if (this.hitMarkerTime < this.hitMarkerDuration) {
      this.hitMarkerTime += dt;
      if (this.hitMarkerTime > this.hitMarkerDuration) this.hitMarkerTime = this.hitMarkerDuration;
    }

    this._updateLowHealth(health, maxHealth);
    this._updateFOV(dt);

    if (!this.lean) {
      this._updateBreathing();
      this._updateWeaponBob();
    }

    this._updateWeaponSway(dt);
    this._updateLandDip(dt);
    this._updateStrafeTilt(dt);
    this._updateRecoil(dt);
    this._updateFootsteps(dt);
  }

  _updateShake(dt) {
    if (!this._shakeActive) {
      this.cameraOffsetMainMustReset.set(0, 0, 0);
      this.shakeRotation.set(0, 0, 0);
      return;
    }

    this.shakeTime += dt;
    if (this.shakeTime >= this.shakeDuration || this.shakeIntensity <= 0) {
      this.shakeIntensity = 0;
      this.cameraOffsetMainMustReset.set(0, 0, 0);
      this.shakeRotation.set(0, 0, 0);
      this._shakeActive = false;
      return;
    }

    const t = this.shakeTime / this.shakeDuration;
    const decay = 1.0 - t * t;
    const intensity = this.shakeIntensity * decay;

    const n = this._noiseOnce(this._elapsed * 40);

    this.cameraOffsetMainMustReset.set(
      n * intensity,
      n * SHAKE_AXIS_Y * intensity,
      n * SHAKE_AXIS_Z * intensity
    );

    const rotBase = this._noiseJitter * intensity * SHAKE_ROT_SCALE;
    this.shakeRotation.set(
      rotBase,
      rotBase * SHAKE_ROT_SPREAD,
      rotBase * SHAKE_ROT_SPREAD * SHAKE_AXIS_Z
    );
  }

  _updateDamage(dt) {
    if (this.damageIntensity > 0) {
      this.damageIntensity -= dt * this.damageFadeSpeed;
      if (this.damageIntensity < 0) this.damageIntensity = 0;
    }
    if (this.damageDirectionAlpha > 0) {
      this.damageDirectionAlpha -= dt * 1.5;
      if (this.damageDirectionAlpha < 0) this.damageDirectionAlpha = 0;
    }
  }

  _updateLowHealth(health, maxHealth) {
    if (maxHealth <= 0) {
      this.lowHealthPulse = 0;
      return;
    }
    const ratio = health / maxHealth;
    if (ratio < 0.3) {
      const k = 1.0 - ratio / 0.3;
      const speed = 3.0 + k * 4.0;
      this.lowHealthPulse = (Math.sin(this._elapsed * speed) * 0.5 + 0.5) * k;
    } else {
      this.lowHealthPulse = 0;
    }
  }

  _updateFOV(dt) {
    this.fovEasing += dt * 8;
    if (this.fovEasing > 1.0) this.fovEasing = 1.0;

    const target = this.targetFov - this.baseFov;
    const inv = 1.0 - this.fovEasing;
    const eased = 1.0 - inv * inv * inv;
    this.currentFov = this.baseFov + target * eased;

    if (Math.abs(this.currentFov - this.camera.fov) > 0.01) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }
  }

  _updateBreathing() {
    const time = this._elapsed * this.breathSpeed;
    this.breathSway.x = Math.sin(time) * this.breathAmount;
    this.breathSway.y = Math.cos(time * 0.5) * this.breathAmount * 0.5;
  }

  _updateWeaponBob() {
    const time = this._elapsed * 8;
    this.weaponBob.x = Math.sin(time) * this.weaponBobAmount;
    this.weaponBob.y = (Math.cos(time) < 0 ? -Math.cos(time) : Math.cos(time)) * this.weaponBobAmount * 0.5;
  }

  _updateWeaponSway(dt) {
    let smoothing = dt * this.weaponSwaySmoothing;
    if (smoothing > 1) smoothing = 1;
    const dx = (this.weaponSwayTarget.x - this.weaponSway.x) * smoothing;
    const dy = (this.weaponSwayTarget.y - this.weaponSway.y) * smoothing;
    this.weaponSway.x += dx;
    this.weaponSway.y += dy;
    this.weaponSwayTarget.multiplyScalar(0.9);
  }

  _updateLandDip(dt) {
    const force = -this.landDipSpring * this.landDip - this.landDipDamping * this.landDipVelocity;
    this.landDipVelocity += force * dt;
    this.landDip += this.landDipVelocity * dt;
  }

  _updateStrafeTilt(dt) {
    let k = dt * 10;
    if (k > 1) k = 1;
    this.strafeTilt += (this.strafeTiltTarget - this.strafeTilt) * k;
  }

  _updateRecoil(dt) {
    let recovery = dt * this.recoilRecoverySpeed;
    if (recovery > 1) recovery = 1;
    const keep = 1.0 - recovery;
    this.recoilPitch *= keep;
    this.recoilYaw *= keep;
  }

  _updateFootsteps(dt) {
    if (this.weaponBobSpeed > 1.0) {
      this.footstepTimer += dt;
      if (this.footstepTimer >= this.footstepInterval) {
        this.footstepTimer = 0;
        this.onFootstep();
      }
    }
    if (this.footstepIntensity > 0) {
      this.footstepIntensity -= dt * 8;
      if (this.footstepIntensity < 0) this.footstepIntensity = 0;
    }
  }

  _noiseOnce(t) {
    const seed = this._noiseSeed;
    const jitter = Math.random() - 0.5;
    this._noiseJitter = jitter;
    this._noiseValue = Math.sin(t + seed) * 0.4 +
      Math.sin(t * 2.3 + seed * 1.1) * 0.25 +
      Math.sin(t * 4.7 + seed * 2.3) * 0.15 +
      jitter * 0.1;
    return this._noiseValue;
  }

getCameraOffset() {
    return this.cameraOffsetMainMustReset;
  }

getCameraOffsetMainMustReset() {
    return this.cameraOffsetMainMustReset;
  }

applyCameraOffset(camera) {
    camera.position.add(this.cameraOffsetMainMustReset);
  }

resetCameraOffset(camera) {
    camera.position.sub(this.cameraOffsetMainMustReset);
  }

clearCameraOffset() {
    this.cameraOffsetMainMustReset.set(0, 0, 0);
    this.shakeRotation.set(0, 0, 0);
  }

  getCameraRotation() {
    return this.shakeRotation;
  }

  getCameraRoll() {
    return this.strafeTilt;
  }

  getDamageIntensity() {
    return this.damageIntensity;
  }

  getDamageDirection() {
    return this.damageDirection;
  }

  getDamageDirectionAlpha() {
    return this.damageDirectionAlpha;
  }

  getDamageDirectionAngle() {
    return this.damageDirectionAngle;
  }

  getLowHealthPulse() {
    return this.lowHealthPulse;
  }

  getHitMarkerAlpha() {
    if (this.hitMarkerTime >= this.hitMarkerDuration) return 0;
    return 1.0 - this.hitMarkerTime / this.hitMarkerDuration;
  }

  getHitMarkerScale() {
    const t = this.hitMarkerTime / this.hitMarkerDuration;
    return this.hitMarkerScale * (1.0 + t * 0.5);
  }

  getHitMarkerRotation() {
    return this.hitMarkerKill ? Math.PI / 4 : 0;
  }

  isHitMarkerKill() {
    return this.hitMarkerKill;
  }

  isHitMarkerHeadshot() {
    return this.hitMarkerHeadshot;
  }

  getBreathSway() {
    return this.breathSway;
  }

  getWeaponBob() {
    return this.weaponBob;
  }

  getWeaponSway() {
    return this.weaponSway;
  }

  getLandDip() {
    return this.landDip;
  }

  getStrafeTilt() {
    return this.strafeTilt;
  }

  getRecoil() {
    this._recoil.pitch = this.recoilPitch;
    this._recoil.yaw = this.recoilYaw;
    return this._recoil;
  }

  getFootstepIntensity() {
    return this.footstepIntensity;
  }

  dispose() {
    this.cameraOffsetMainMustReset.set(0, 0, 0);
    this.shakeRotation.set(0, 0, 0);
    this.damageIntensity = 0;
    this.hitMarkerTime = 0;
    this.lowHealthPulse = 0;
    this._shakeActive = false;
  }
}