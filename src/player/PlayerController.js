import * as THREE from 'three';

const WALK_SPEED = 4;
const SPRINT_SPEED = 7;
const CROUCH_SPEED = 2;
const SLIDE_SPEED = 9;
const JUMP_FORCE = 6;
const GRAVITY = -18;
const STANDING_HEIGHT = 1.7;
const CROUCHING_HEIGHT = 1.0;
const SLIDE_HEIGHT = 0.6;
const MOUSE_SENSITIVITY = 0.002;
const PITCH_LIMIT = Math.PI / 2 - 0.05;
const LEAN_ANGLE = 0.10;
const LEAN_OFFSET = 0.28;
const BOB_FREQUENCY = 8.5;
const BOB_AMPLITUDE = 0.025;
const STRAFE_TILT = 0.05;
const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.12;
const LANDING_DIP_SPEED = 0.12;
const LANDING_DIP_SPRING = 18;
const LANDING_DIP_DAMPING = 8;
const SPRINT_FOV_KICK = 12;
const ADS_FOV_ZOOM = 0.75;
const IDLE_BREATH_FREQUENCY = 1.8;
const IDLE_BREATH_AMPLITUDE = 0.008;
const DAMAGE_SHAKE_INTENSITY = 0.08;
const DAMAGE_SHAKE_DECAY = 6;
const LANDING_RECOVERY_TIME = 0.25;
const WEAPON_SWAY_AMOUNT = 0.015;
const WEAPON_SWAY_SPEED = 6;
const BASE_FOV = 75;

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

export class PlayerController {
  constructor(camera, input, physics, audio, quality) {
    this.camera = camera;
    this.input = input;
    this.physics = physics;
    this.audio = audio;
    this.quality = Object.assign({}, DEFAULT_QUALITY, quality || {});

    this.position = new THREE.Vector3(0, STANDING_HEIGHT, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;

    this.isGrounded = true;
    this.isSprintingState = false;
    this.isCrouchingState = false;
    this.isMovingState = false;
    this.isSlidingState = false;
    this.isADSState = false;

    this.currentHeight = STANDING_HEIGHT;
    this.targetHeight = STANDING_HEIGHT;

    this.bobTime = 0;
    this.bobOffset = new THREE.Vector3();
    this.footstepTimer = 0;
    this._lastBobPhase = 0;

    this.leanInput = 0;
    this.currentLean = 0;
    this.currentLeanOffset = 0;

    this.strafeTilt = 0;
    this.targetStrafeTilt = 0;

    this.recoilPitch = 0;
    this.recoilRecovery = 0;

    this._coyoteTimer = 0;
    this._jumpBufferTimer = 0;
    this._wasJumpPressed = false;

    this._landingDip = 0;
    this._landingDipVelocity = 0;
    this._landingRecoveryTimer = 0;

    this._damageShake = 0;
    this._damageShakeTime = 0;

    this._idleBreathTime = 0;

    this._sprintFovKick = 0;
    this._adsFovZoom = 0;

    this._weaponSwayX = 0;
    this._weaponSwayY = 0;
    this._lastYaw = 0;
    this._lastPitch = 0;

    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._moveDir = new THREE.Vector3();
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');

    this._stepNoise = null;
    this._lastStepTime = 0;

    this._sharedPosition = this.position;
    this._sharedDirection = new THREE.Vector3();
    this._sharedSway = { x: 0, y: 0 };
    this._hSpeed = 0;
  }

  update(dt) {
    this._handleMouseLook();
    this._handleMovement(dt);
    this._handleSprintCrouch(dt);
    this._handleJump(dt);
    this._handleLean(dt);
    this._handleADS(dt);
    this._updateCamera(dt);
    this._updateFootsteps(dt);
  }

  _handleMouseLook() {
    const { dx, dy } = this.input.consumeMouseDelta();
    this.yaw -= dx * MOUSE_SENSITIVITY;
    this.pitch -= dy * MOUSE_SENSITIVITY;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
  }

  _handleMovement(dt) {
    this._forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    this._moveDir.set(0, 0, 0);

    if (this.input.isKeyDown('KeyW')) this._moveDir.add(this._forward);
    if (this.input.isKeyDown('KeyS')) this._moveDir.sub(this._forward);
    if (this.input.isKeyDown('KeyD')) this._moveDir.add(this._right);
    if (this.input.isKeyDown('KeyA')) this._moveDir.sub(this._right);

    this.isMovingState = this._moveDir.lengthSq() > 0;

    if (this.isMovingState) {
      this._moveDir.normalize();
    }

    let speed = WALK_SPEED;
    if (this.isSprintingState) speed = SPRINT_SPEED;
    if (this.isCrouchingState) speed = CROUCH_SPEED;
    if (this.isSlidingState) speed = SLIDE_SPEED;

    const targetVelX = this._moveDir.x * speed;
    const targetVelZ = this._moveDir.z * speed;

    const accel = this.isGrounded ? (this.isSlidingState ? 2 : 14) : 5;
    this.velocity.x = THREE.MathUtils.damp(this.velocity.x, targetVelX, accel, dt);
    this.velocity.z = THREE.MathUtils.damp(this.velocity.z, targetVelZ, accel, dt);

    if (this.isSlidingState) {
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, this._moveDir.x * SLIDE_SPEED, 1.5, dt);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, this._moveDir.z * SLIDE_SPEED, 1.5, dt);
    }

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    this._hSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);

    const p = this.position;
    this.physics.resolveCollision(p, 0.4);
    this.physics.resolveCollision(p, 0.4);

    if (this._hSpeed > 0.5) {
      this.targetStrafeTilt = -this._moveDir.dot(this._right) * STRAFE_TILT;
    } else {
      this.targetStrafeTilt = 0;
    }
    this.strafeTilt = THREE.MathUtils.damp(this.strafeTilt, this.targetStrafeTilt, 8, dt);

    const yawDelta = this.yaw - this._lastYaw;
    const pitchDelta = this.pitch - this._lastPitch;
    this._weaponSwayX = THREE.MathUtils.damp(this._weaponSwayX, -yawDelta * WEAPON_SWAY_AMOUNT, WEAPON_SWAY_SPEED, dt);
    this._weaponSwayY = THREE.MathUtils.damp(this._weaponSwayY, pitchDelta * WEAPON_SWAY_AMOUNT, WEAPON_SWAY_SPEED, dt);
    this._lastYaw = this.yaw;
    this._lastPitch = this.pitch;
  }

  _handleSprintCrouch(dt) {
    const wantSprint = this.input.isKeyDown('ShiftLeft') || this.input.isKeyDown('ShiftRight');
    const wantCrouch = this.input.isKeyDown('KeyC') || this.input.isKeyDown('ControlLeft');

    if (wantSprint && wantCrouch && this.isSprintingState && !this.isSlidingState) {
      this.isSlidingState = true;
      this.targetHeight = SLIDE_HEIGHT;
    }

    if (this.isSlidingState) {
      if (this._hSpeed < 2 || !wantCrouch) {
        this.isSlidingState = false;
        this.targetHeight = wantCrouch ? CROUCHING_HEIGHT : STANDING_HEIGHT;
      }
    }

    this.isCrouchingState = wantCrouch && !this.isSlidingState;
    this.isSprintingState = wantSprint && !wantCrouch && this.isMovingState && !this.isSlidingState;

    if (!this.isSlidingState) {
      this.targetHeight = this.isCrouchingState ? CROUCHING_HEIGHT : STANDING_HEIGHT;
    }

    this.currentHeight = THREE.MathUtils.damp(this.currentHeight, this.targetHeight, 10, dt);
  }

  _handleJump(dt) {
    const jumpPressed = this.input.isKeyDown('Space');

    if (this.input.wasPressed('Space')) {
      this._jumpBufferTimer = JUMP_BUFFER;
    }

    if (this._jumpBufferTimer > 0) {
      this._jumpBufferTimer -= dt;
    }

    if (this.isGrounded) {
      this._coyoteTimer = COYOTE_TIME;
    } else {
      this._coyoteTimer -= dt;
    }

    if (this._jumpBufferTimer > 0 && this._coyoteTimer > 0) {
      this.velocity.y = JUMP_FORCE;
      this.isGrounded = false;
      this._coyoteTimer = 0;
      this._jumpBufferTimer = 0;
      this.isSlidingState = false;
    }

    if (!jumpPressed && this.velocity.y > 2) {
      this.velocity.y = 2;
    }

    this.velocity.y += GRAVITY * dt;
    this.position.y += this.velocity.y * dt;

    const groundY = this.physics.groundCheck(this.position, this.currentHeight);
    const floorY = groundY + this.currentHeight;

    if (this.position.y <= floorY) {
      const fallSpeed = -this.velocity.y;
      if (!this.isGrounded && fallSpeed > 3) {
        this._landingDipVelocity -= fallSpeed * LANDING_DIP_SPEED;
        this._landingRecoveryTimer = LANDING_RECOVERY_TIME;
        this._playLandingThud(fallSpeed);
      }
      this.position.y = floorY;
      this.velocity.y = 0;
      this.isGrounded = true;
    } else {
      this.isGrounded = false;
    }

    if (this._landingRecoveryTimer > 0) {
      this._landingRecoveryTimer -= dt;
    }
  }

  _handleLean(dt) {
    let target = 0;
    if (this.input.isKeyDown('KeyQ')) target = -1;
    if (this.input.isKeyDown('KeyE')) target = 1;

    this.leanInput = target;
    this.currentLean = THREE.MathUtils.damp(this.currentLean, this.leanInput, 10, dt);
    this.currentLeanOffset = THREE.MathUtils.damp(this.currentLeanOffset, this.leanInput * LEAN_OFFSET, 10, dt);
  }

  _handleADS(dt) {
    const wantADS = this.input.isMouseDown && this.input.isMouseDown(2);
    this.isADSState = wantADS;
    this._adsFovZoom = THREE.MathUtils.damp(this._adsFovZoom, wantADS ? ADS_FOV_ZOOM : 0, 12, dt);
  }

  _updateCamera(dt) {
    const hSpeed = this._hSpeed;

    if (this.isGrounded && hSpeed > 0.5) {
      const speedRatio = hSpeed / SPRINT_SPEED;
      const bobSpeed = this.isSprintingState ? BOB_FREQUENCY * 1.3 : BOB_FREQUENCY;
      this.bobTime += dt * bobSpeed;
      const bobAmount = (this.isSprintingState ? BOB_AMPLITUDE * 1.3 : BOB_AMPLITUDE) * speedRatio;
      this.bobOffset.y = Math.sin(this.bobTime) * bobAmount;
      this.bobOffset.x = Math.sin(this.bobTime * 0.5) * bobAmount * 0.5;
    } else {
      this.bobOffset.x = THREE.MathUtils.damp(this.bobOffset.x, 0, 8, dt);
      this.bobOffset.y = THREE.MathUtils.damp(this.bobOffset.y, 0, 8, dt);
    }

    this._idleBreathTime += dt;
    const idleBreath = Math.sin(this._idleBreathTime * IDLE_BREATH_FREQUENCY) * IDLE_BREATH_AMPLITUDE;

    this._landingDipVelocity += -this._landingDip * LANDING_DIP_SPRING * dt;
    this._landingDipVelocity *= Math.exp(-LANDING_DIP_DAMPING * dt);
    this._landingDip += this._landingDipVelocity * dt;

    this._damageShakeTime += dt;
    this._damageShake = Math.max(0, this._damageShake - dt * DAMAGE_SHAKE_DECAY);

    this.recoilPitch = THREE.MathUtils.damp(this.recoilPitch, 0, 12, dt);

    this._sprintFovKick = THREE.MathUtils.damp(this._sprintFovKick, this.isSprintingState ? SPRINT_FOV_KICK : 0, 6, dt);

    const shakeX = (Math.random() - 0.5) * this._damageShake * DAMAGE_SHAKE_INTENSITY;
    const shakeY = (Math.random() - 0.5) * this._damageShake * DAMAGE_SHAKE_INTENSITY;

    this._euler.set(
      this.pitch + this.recoilPitch + shakeX,
      this.yaw + shakeY,
      this.currentLean * LEAN_ANGLE + this.strafeTilt
    );
    this.camera.quaternion.setFromEuler(this._euler);

    const sprintLower = this.isSprintingState ? 0.12 : 0;
    const crouchDrop = STANDING_HEIGHT - this.currentHeight;
    const adsLower = this._adsFovZoom * 0.05;

    this.camera.position.set(
      this.position.x + this.bobOffset.x * Math.cos(this.yaw) + this.currentLeanOffset * Math.cos(this.yaw),
      this.position.y - crouchDrop - sprintLower - adsLower + this.bobOffset.y + idleBreath + this._landingDip,
      this.position.z - this.bobOffset.x * Math.sin(this.yaw) - this.currentLeanOffset * Math.sin(this.yaw)
    );

    const targetFOV = BASE_FOV + this._sprintFovKick - this._adsFovZoom * 20;
    if (Math.abs(this.camera.fov - targetFOV) > 0.1) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFOV, 10, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  _updateFootsteps(dt) {
    const hSpeed = this._hSpeed;

    if (this.isGrounded && hSpeed > 0.5) {
      const bobPhase = Math.sin(this.bobTime);
      if (this._lastBobPhase > 0 && bobPhase <= 0) {
        this._playFootstep(hSpeed);
      }
      this._lastBobPhase = bobPhase;
    }
  }

  _playFootstep(speed) {
    if (!this.audio.initialized) return;
    if (!this._stepNoise) {
      this._stepNoise = this.audio.generateNoise(0.08, 0.3);
    }
    const volume = this.isSprintingState ? 0.5 : this.isCrouchingState ? 0.1 : 0.3;
    const pitch = 0.9 + Math.random() * 0.2;
    this.audio.playSound(this._stepNoise, { volume, pitch });
  }

  _playLandingThud(fallSpeed) {
    if (!this.audio.initialized) return;
    const noise = this.audio.generateNoise(0.15, Math.min(0.6, fallSpeed * 0.05));
    if (noise) {
      this.audio.playSound(noise, { volume: Math.min(0.7, fallSpeed * 0.06), pitch: 0.5 + Math.random() * 0.2 });
    }
  }

  getPosition() {
    return this._sharedPosition;
  }

  getDirection() {
    return this._sharedDirection.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }

  isSprinting() {
    return this.isSprintingState;
  }

  isCrouching() {
    return this.isCrouchingState;
  }

  isMoving() {
    return this.isMovingState;
  }

  isADS() {
    return this.isADSState;
  }

  getSprintFovKick() {
    return this._sprintFovKick;
  }

  getWeaponSway() {
    this._sharedSway.x = this._weaponSwayX;
    this._sharedSway.y = this._weaponSwayY;
    return this._sharedSway;
  }

  isLandingRecovery() {
    return this._landingRecoveryTimer > 0;
  }

  takeDamage(amount, direction) {
    this.recoilPitch += (Math.random() - 0.5) * 0.04;
    this._damageShake = 1;
    this._damageShakeTime = 0;
    if (direction) {
      const pushForce = 2;
      this.velocity.x += direction.x * pushForce;
      this.velocity.z += direction.z * pushForce;
    }
  }

  addRecoil(amount) {
    this.recoilPitch += amount;
  }
}
