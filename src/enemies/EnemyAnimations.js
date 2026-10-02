import * as THREE from 'three';

const DEFAULT_QUALITY = {
  propDetail: 1,
  maxEnemies: 8,
  enemyLodDistance: 30,
};

const PI = Math.PI;
const RECOIL_DECAY_RATE = 9;
const HIT_DECAY_RATE = 4;
const BLEND_RATE = 6;

const ST_DEATH = 0;
const ST_MELEE = 1;
const ST_RELOAD = 2;
const ST_SHOOT = 3;
const ST_AIM = 4;
const ST_SPRINT = 5;
const ST_CROUCH_WALK = 6;
const ST_WALK = 7;
const ST_RUN = 8;
const ST_CROUCH_IDLE = 9;
const ST_IDLE = 10;

const PART_KEYS = ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'weapon'];
const PART_COUNT = PART_KEYS.length;

const _rig = {};
const _prevRig = {};
for (let i = 0; i < PART_COUNT; i++) {
  _rig[PART_KEYS[i]] = new THREE.Euler();
  _prevRig[PART_KEYS[i]] = new THREE.Euler();
}
_rig.root = new THREE.Euler();
_prevRig.root = new THREE.Euler();
_rig.rootOffset = new THREE.Vector3();
_prevRig.rootOffset = new THREE.Vector3();

export class EnemyAnimations {
  constructor(quality) {
    this.quality = { ...DEFAULT_QUALITY, ...(quality || {}) };

    this.time = 0;
    this.stateTime = 0;
    this.currentState = ST_IDLE;
    this.previousState = ST_IDLE;
    this.blendFactor = 0;
    this.recoilAmount = 0;
    this.deathProgress = 0;
    this.deathDirection = new THREE.Vector3();
    this.idleSeed = Math.random() * 1000;
    this.hitReactionTimer = 0;
    this.hitReactionDirection = new THREE.Vector3();
    this.reloadTimer = 0;
    this.isReloading = false;
    this.meleeTimer = 0;
    this.isMeleeing = false;
    this.leanAmount = 0;
    this.leanDirection = 0;

    this.hasPrev = false;
  }

  setQuality(quality) {
    if (!quality) return;
    this.quality = { ...this.quality, ...quality };
  }

  get rig() {
    return _rig;
  }

  update(dt, state) {
    this.time += dt;
    this.stateTime += dt;

    const next = this._resolveState(state);

    if (next === ST_DEATH) {
      const p = this.deathProgress + dt * 1.2;
      this.deathProgress = p > 1 ? 1 : p;
    }

    if (next !== this.previousState) {
      this._capturePrev();
      this.previousState = next;
      this.stateTime = 0;
      this.blendFactor = 0;
      this.hasPrev = true;
    }
    this.currentState = next;

    this.blendFactor += dt * BLEND_RATE;
    if (this.blendFactor > 1) this.blendFactor = 1;

    if (this.recoilAmount > 0) {
      this.recoilAmount -= dt * RECOIL_DECAY_RATE * (0.6 + this.recoilAmount);
      if (this.recoilAmount < 0) this.recoilAmount = 0;
    }
    if (this.hitReactionTimer > 0) {
      this.hitReactionTimer -= dt * HIT_DECAY_RATE;
      if (this.hitReactionTimer < 0) this.hitReactionTimer = 0;
    }

    this._computeRotations(state);

    if (this.hasPrev && this.blendFactor < 1) this._blendRig(this.blendFactor);

    return _rig;
  }

  _resolveState(state) {
    if (state.isDead) return ST_DEATH;
    if (state.isMeleeing) return ST_MELEE;
    if (state.isReloading) return ST_RELOAD;
    if (state.isShooting) return ST_SHOOT;
    if (state.isAiming) return ST_AIM;
    if (state.isMoving) {
      if (state.isCrouching) return ST_CROUCH_WALK;
      if (state.isSprinting) return ST_SPRINT;
      return state.moveSpeed < 2.0 ? ST_WALK : ST_RUN;
    }
    return state.isCrouching ? ST_CROUCH_IDLE : ST_IDLE;
  }

  _capturePrev() {
    for (let i = 0; i < PART_COUNT; i++) {
      const key = PART_KEYS[i];
      const e = _rig[key];
      _prevRig[key].set(e.x, e.y, e.z, e.order);
    }
    const rc = _rig.root;
    const rp = _prevRig.root;
    rp.set(rc.x, rc.y, rc.z, rc.order);
    _prevRig.rootOffset.copy(_rig.rootOffset);
  }

  _blendRig(t) {
    for (let i = 0; i < PART_COUNT; i++) {
      const key = PART_KEYS[i];
      const c = _rig[key];
      const p = _prevRig[key];
      c.x = p.x + (c.x - p.x) * t;
      c.y = p.y + (c.y - p.y) * t;
      c.z = p.z + (c.z - p.z) * t;
    }
    const cr = _rig.root;
    const pr = _prevRig.root;
    cr.x = pr.x + (cr.x - pr.x) * t;
    cr.z = pr.z + (cr.z - pr.z) * t;
    const o = _rig.rootOffset;
    const po = _prevRig.rootOffset;
    o.x = po.x + (o.x - po.x) * t;
    o.y = po.y + (o.y - po.y) * t;
    o.z = po.z + (o.z - po.z) * t;
  }

  triggerRecoil() {
    this.recoilAmount = 1.0;
  }

  triggerDeath(direction) {
    this.deathDirection.copy(direction).normalize();
    this.deathProgress = 0;
  }

  triggerHitReaction(direction) {
    this.hitReactionTimer = 1.0;
    this.hitReactionDirection.copy(direction).normalize();
  }

  triggerReload() {
    this.isReloading = true;
    this.reloadTimer = 2.0 + Math.random() * 0.5;
  }

  triggerMelee() {
    this.isMeleeing = true;
    this.meleeTimer = 0.6;
  }

  triggerLean(direction) {
    this.leanAmount = 1.0;
    this.leanDirection = direction;
  }

  _computeRotations(state) {
    const r = _rig;
    for (let i = 0; i < PART_COUNT; i++) r[PART_KEYS[i]].set(0, 0, 0);
    r.root.set(0, 0, 0);
    r.rootOffset.set(0, 0, 0);

    const t = this.time;
    const seed = this.idleSeed;

    switch (this.currentState) {
      case ST_WALK:
        this._applyGait(t, 9 * (state.moveSpeed || 1) * 0.55, state.moveSpeed || 1, 0.4, 0.2, 0.015, 0.04, 0.03, 0.08, 0.05);
        break;
      case ST_RUN:
        this._applyGait(t, 9 * (state.moveSpeed || 1), state.moveSpeed || 1, 0.65, 0.45, 0.045, 0.12, 0.06, 0.15, 0.1);
        break;
      case ST_SPRINT:
        this._applyGait(t, 9 * (state.moveSpeed || 1) * 1.3, state.moveSpeed || 1, 0.85, 0.6, 0.06, 0.25, 0.08, 0.3, 0.12);
        break;
      case ST_CROUCH_IDLE:
        this._applyCrouchIdle(t, seed);
        break;
      case ST_CROUCH_WALK:
        this._applyCrouchWalk(t, 9 * (state.moveSpeed || 1) * 0.6, state.moveSpeed || 1);
        break;
      case ST_AIM:
        this._applyAimPose(t, seed, 0);
        break;
      case ST_SHOOT:
        this._applyAimPose(t, seed, this.recoilAmount);
        break;
      case ST_RELOAD:
        this._applyReload();
        break;
      case ST_MELEE:
        this._applyMelee();
        break;
      case ST_DEATH:
        this._applyDeath();
        break;
      default:
        this._applyIdle(t, seed);
        break;
    }

    if (this.hitReactionTimer > 0) this._applyHitReaction(this.hitReactionTimer);
  }

  _applyIdle(t, seed) {
    const r = _rig;
    const a = t * 1.8 + seed;
    const b = t * 0.6 + seed;
    const breath = Math.sin(a) * 0.025;
    const sway = Math.sin(b) * 0.02;
    const micro = breath * sway * 12.8;

    r.torso.x = breath * 0.4;
    r.torso.y = sway;
    r.torso.z = micro * 0.3;
    r.head.x = breath * 1.6;
    r.head.y = sway * 5.0;
    r.head.z = micro * 0.2;

    r.leftArm.x = -0.25 + breath * 0.35;
    r.leftArm.z = -0.12 + sway * 0.5;
    r.leftArm.y = micro * 0.2;
    r.rightArm.x = -0.25 + breath * 0.35;
    r.rightArm.z = 0.12 - sway * 0.5;
    r.rightArm.y = -micro * 0.2;

    r.leftLeg.z = -0.02;
    r.rightLeg.z = 0.02;

    r.weapon.x = sway * 0.4;
    r.weapon.z = breath * 0.25;
    r.weapon.y = micro * 0.15;

    r.rootOffset.y = breath * 0.01;
  }

  _applyGait(t, freq, speed, legAmp, armAmp, bounceAmp, lean, twist, weaponDip, weaponRoll) {
    const r = _rig;
    const phase = t * freq;
    const swing = Math.sin(phase);
    const half = Math.sin(phase * 0.5);
    const bounce = (swing < 0 ? -swing : swing) * bounceAmp;

    const legSwing = swing * legAmp * speed;
    const armPump = swing * armAmp * speed;
    const counter = swing * legAmp * 0.03;
    const twistHalf = swing * twist;

    r.torso.x = lean;
    r.torso.y = twistHalf;
    r.torso.z = twistHalf * 0.5;
    r.head.x = -lean * 0.65;
    r.head.y = half * 0.12;
    r.head.z = swing * 0.02;

    r.leftArm.x = -0.25 + armPump;
    r.leftArm.z = -0.12;
    r.leftArm.y = counter;
    r.rightArm.x = -0.25 - armPump;
    r.rightArm.z = 0.12;
    r.rightArm.y = -counter;

    r.leftLeg.x = legSwing;
    r.leftLeg.z = -0.02;
    r.rightLeg.x = -legSwing;
    r.rightLeg.z = 0.02;

    r.weapon.x = -weaponDip + bounce * 0.4;
    r.weapon.z = swing * weaponRoll;
    r.weapon.y = half * weaponRoll * 0.6;

    r.rootOffset.y = bounce;
  }

  _applyCrouchIdle(t, seed) {
    const r = _rig;
    const breath = Math.sin(t * 1.8 + seed) * 0.02;
    const sway = Math.sin(t * 0.6 + seed) * 0.015;

    r.torso.x = 0.35 + breath * 0.3;
    r.torso.y = sway;
    r.head.x = -0.2 + breath * 1.5;
    r.head.y = sway * 5.3;

    r.leftArm.x = -0.5 + breath * 0.3;
    r.leftArm.z = -0.15;
    r.rightArm.x = -0.5 + breath * 0.3;
    r.rightArm.z = 0.15;

    r.leftLeg.x = -1.2;
    r.leftLeg.z = -0.15;
    r.rightLeg.x = -1.2;
    r.rightLeg.z = 0.15;

    r.weapon.x = sway * 0.3;
    r.weapon.z = breath * 0.2;

    r.rootOffset.y = -0.25;
  }

  _applyCrouchWalk(t, freq, speed) {
    const r = _rig;
    const phase = t * freq;
    const swing = Math.sin(phase);
    const half = Math.sin(phase * 0.5);
    const bounce = (swing < 0 ? -swing : swing) * 0.02;

    r.torso.x = 0.35;
    r.torso.y = swing * 0.04;
    r.head.x = -0.2;
    r.head.y = half * 0.08;

    r.leftArm.x = -0.5 + swing * 0.25 * speed;
    r.leftArm.z = -0.15;
    r.rightArm.x = -0.5 - swing * 0.25 * speed;
    r.rightArm.z = 0.15;

    r.leftLeg.x = -1.2 + swing * 0.4 * speed;
    r.rightLeg.x = -1.2 - swing * 0.4 * speed;

    r.weapon.x = -0.1 + bounce * 0.3;
    r.weapon.z = swing * 0.04;

    r.rootOffset.y = -0.25 + bounce;
  }

  _applyAimPose(t, seed, recoil) {
    const r = _rig;
    const steady = Math.sin(t * 2.2 + seed) * 0.01;
    const breath = steady * 0.8;
    const lean = this.leanAmount * this.leanDirection;

    r.torso.x = 0.02 + recoil * 0.1;
    r.torso.y = recoil * 0.04 + lean * 0.3;
    r.torso.z = steady * 0.3 + lean * 0.5;
    r.head.x = -0.02 + recoil * 0.03;
    r.head.y = -lean * 0.2;
    r.head.z = steady * 0.2 + lean * 0.3;

    r.leftArm.x = -1.15 + steady + recoil * 0.12;
    r.leftArm.z = -0.25;
    r.leftArm.y = breath * 0.3;
    r.rightArm.x = -1.05 + steady + recoil * 0.18;
    r.rightArm.z = 0.18;
    r.rightArm.y = -breath * 0.3;

    r.leftLeg.x = 0.08;
    r.leftLeg.z = -0.03;
    r.rightLeg.x = -0.04;
    r.rightLeg.z = 0.03;

    r.weapon.x = steady * 0.5 + recoil * 0.18;
    r.weapon.z = breath * 0.3;
    r.weapon.y = steady * 0.2 + recoil * 0.05;
  }

  _applyReload() {
    const r = _rig;
    const progress = 1 - (this.reloadTimer / 2.5);
    const magOut = progress > 0.2 && progress < 0.4;
    const magIn = progress > 0.5 && progress < 0.7;
    const bolt = progress > 0.8;

    r.torso.x = 0.15;
    r.torso.y = -0.1;
    r.head.x = 0.15;
    r.head.y = -0.15;

    if (magOut) {
      r.rightArm.x = -0.8;
      r.rightArm.z = 0.3;
      r.rightArm.y = -0.2;
    } else if (magIn) {
      r.rightArm.x = -1.0;
      r.rightArm.z = 0.25;
      r.rightArm.y = -0.15;
    } else {
      r.rightArm.x = -1.05;
      r.rightArm.z = 0.18;
    }

    r.leftArm.x = -1.15;
    r.leftArm.z = -0.25;

    if (bolt) {
      r.rightArm.x = -0.9;
      r.rightArm.z = 0.35;
    }

    r.leftLeg.x = 0.08;
    r.rightLeg.x = -0.04;

    r.weapon.x = 0.15;
    r.weapon.y = -0.05;
    r.weapon.z = 0.1;
  }

  _applyMelee() {
    const r = _rig;
    const progress = 1 - (this.meleeTimer / 0.6);
    const swing = Math.sin(progress * PI);

    r.torso.x = -0.1 + swing * 0.3;
    r.torso.y = swing * 0.4;
    r.head.x = -0.1;

    r.rightArm.x = -0.5 - swing * 1.2;
    r.rightArm.z = 0.3 + swing * 0.4;
    r.leftArm.x = -0.3;
    r.leftArm.z = -0.2;

    r.leftLeg.x = 0.15;
    r.rightLeg.x = -0.1;

    r.weapon.x = -swing * 0.5;
    r.weapon.z = swing * 0.3;
  }

  _applyDeath() {
    const r = _rig;
    const p = this.deathProgress;
    const inv = 1 - p;
    const ease = 1 - inv * inv * inv * inv;
    const dir = this.deathDirection;

    if (Math.abs(dir.x) > Math.abs(dir.z)) {
      r.root.x = (dir.x > 0 ? -1 : 1) * ease * PI * 0.45;
    } else {
      r.root.z = (dir.z > 0 ? 1 : -1) * ease * PI * 0.45;
    }

    const arc = p * PI;
    const flinch = Math.sin(arc);
    const fade = 1 - p;
    const secondary = flinch * (1 - 2 * p);
    const limbFlail = 2 * flinch * flinch * fade;

    r.torso.x = ease * 0.35 + flinch * 0.2;
    r.torso.y = ease * 0.15 + secondary * 0.3;
    r.head.x = ease * 0.5 + flinch * 0.3;
    r.head.z = ease * 0.25 + secondary * 0.4;
    r.head.y = ease * 0.1 + secondary * 0.2;

    r.leftArm.x = -0.25 - ease * 1.4 + limbFlail * 0.5;
    r.leftArm.z = -0.12 - ease * 0.9 + limbFlail * 0.3;
    r.leftArm.y = ease * 0.3 + limbFlail * 0.2;
    r.rightArm.x = -0.25 - ease * 1.1 - limbFlail * 0.4;
    r.rightArm.z = 0.12 + ease * 0.7 - limbFlail * 0.3;
    r.rightArm.y = -ease * 0.2 - limbFlail * 0.2;

    r.leftLeg.x = ease * 0.5 + limbFlail * 0.3;
    r.leftLeg.z = -ease * 0.2 + limbFlail * 0.2;
    r.rightLeg.x = -ease * 0.35 - limbFlail * 0.25;
    r.rightLeg.z = ease * 0.15 - limbFlail * 0.15;

    r.weapon.x = -ease * 0.6 + limbFlail * 0.4;
    r.weapon.y = ease * 0.2 + limbFlail * 0.25;
    r.weapon.z = ease * 0.4 + limbFlail * 0.3;

    r.rootOffset.y = -ease * 0.35;
  }

  _applyHitReaction(amount) {
    const r = _rig;
    const dir = this.hitReactionDirection;
    const flinch = amount * 0.4;

    r.torso.x += flinch * 0.3;
    r.torso.y += dir.x * flinch * 0.2;
    r.head.x += flinch * 0.4;
    r.head.z += dir.z * flinch * 0.2;
  }

  reset() {
    this.time = 0;
    this.stateTime = 0;
    this.recoilAmount = 0;
    this.deathProgress = 0;
    this.currentState = ST_IDLE;
    this.previousState = ST_IDLE;
    this.blendFactor = 0;
    this.hitReactionTimer = 0;
    this.isReloading = false;
    this.isMeleeing = false;
    this.leanAmount = 0;
    this.deathDirection.set(0, 0, 0);
    this.hasPrev = false;
  }
}
