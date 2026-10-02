import * as THREE from 'three';
import { EnemyAnimations } from './EnemyAnimations.js';

const STATE = {
  IDLE: 'IDLE',
  PATROL: 'PATROL',
  ALERT: 'ALERT',
  COMBAT: 'COMBAT',
  TAKE_COVER: 'TAKE_COVER',
  FLANK: 'FLANK',
  SUPPRESS: 'SUPPRESS',
  RETREAT: 'RETREAT',
  MELEE: 'MELEE',
  INVESTIGATE: 'INVESTIGATE',
  DEAD: 'DEAD',
};

const DETECTION_RANGE = 45;
const ATTACK_RANGE = 35;
const FLANK_RANGE = 22;
const ALERT_DURATION = 3.5;
const BURST_PAUSE = [0.95, 2.3];
const BURST_LENGTH = [3, 5];
const COVER_PEEK_TIME = [0.8, 2.0];
const REACTION_TIME = [0.38, 0.85];
const SUPPRESSION_THRESHOLD = 0.3;
const RETREAT_HEALTH = 0.25;
const MELEE_RANGE = 2.0;
const GRENADE_RANGE = [8, 25];
const GRENADE_COOLDOWN = [8, 15];
const INVESTIGATE_DURATION = 5.0;
const SQUAD_ALERT_RADIUS_SQ = 20 * 20;
const SQUAD_COMMS_INTERVAL = 0.5;
const MAX_SQUAD_TRACK = 3;
const MAX_SQUAD_MEMBERS = 4;
const LOS_INTERVAL_NEAR = 0.14;
const LOS_INTERVAL_FAR = 0.4;
const LOS_PLAYER_MOVE_SQ = 1.5 * 1.5;
const LOS_SELF_MOVE_SQ = 2 * 2;
const LOS_MAX_STALE = 1.2;
const CAMP_TIME = 2.5;
const PATROL_IDLE_MIN = 1.5;
const TURN_RATE = 8;
const TURN_RATE_AIM = 5;
const WAYPOINT_REACH = 0.6;
const DEATH_REMOVE_TIME = 2.4;
const DEATH_REMOVE_TIME_LOW = 1.5;

const LOD_INTERVALS = [1, 3, 8];
const ANIM_INTERVALS = [1, 2, 4];
const AI_STARVATION_TIME = 0.25;
const FREEZE_ON_SQ = 64 * 64;
const FREEZE_OFF_SQ = 56 * 56;
const SQUAD_REBUILD_INTERVAL = 0.6;

const DEFAULT_QUALITY = {
  propDetail: 1,
  maxEnemies: 8,
  enemyLodDistance: 30,
  shadowsEnabled: true,
  maxParticles: 400,
};

const PART_NAMES = ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'weapon'];

let ENEMY_ID = 0;

export class EnemyAI {
  constructor(enemy, level, pathfinding, quality, parts) {
    this.enemy = enemy;
    this.level = level;
    this.pathfinding = pathfinding;
    this.quality = { ...DEFAULT_QUALITY, ...(quality || {}) };
    this.animations = new EnemyAnimations(this.quality);
    this.id = ENEMY_ID++;
    this.squadId = this.id;

    this.state = STATE.IDLE;
    this.health = this._getVariantHealth();
    this.maxHealth = this.health;
    this.position = enemy.position.clone();
    this.velocity = new THREE.Vector3();
    this.targetPosition = null;
    this.path = [];
    this.pathIndex = 0;
    this.pathPending = false;
    this.pathTag = 0;
    this.straightTarget = new THREE.Vector3();
    this.hasStraightTarget = false;

    this.stateTimer = 0;
    this.alertTimer = 0;
    this.burstCount = 0;
    this.burstTimer = 0;
    this.pauseTimer = 0;
    this.isBursting = false;
    this.coverPeekTimer = 0;
    this.isPeeking = false;
    this.deathTimer = 0;
    this.frozen = false;

    this.detectionLevel = 0;
    this.lastKnownPlayerPos = new THREE.Vector3();
    this.flankDirection = 1;
    this.accuracy = this._getVariantAccuracy();
    this.aggression = this._getVariantAggression();
    this.moveSpeed = this._getVariantSpeed();

    this.shootCooldown = 0;
    this.damageReactionTimer = 0;
    this.playerCampTimer = 0;
    this.reactionTimer = 0;
    this.suppressionLevel = 0;
    this.isCrouching = false;
    this.isSprinting = false;
    this.meleeTimer = 0;
    this.reloadTimer = 0;
    this.isReloading = false;
    this.consecutiveHits = 0;
    this.lastDamageTime = 0;
    this.preferredRange = this._getVariantPreferredRange();
    this.strafeTimer = 0;
    this.strafeDirection = 1;
    this.isStrafing = false;
    this.grenadeCooldown = GRENADE_COOLDOWN[0] + Math.random() * (GRENADE_COOLDOWN[1] - GRENADE_COOLDOWN[0]);
    this.investigateTimer = 0;
    this.investigatePosition = new THREE.Vector3();
    this.squadMembers = [];
    this.lastAlertTime = 0;
    this.isAlerting = false;
    this.leanDirection = 0;
    this.peekTimer = 0;

    this.lodBand = 0;
    this.renderBand = -1;
    this.decoHidden = false;
    this.updateInterval = LOD_INTERVALS[0];
    this.animInterval = ANIM_INTERVALS[0];
    this._frameAccum = 0;
    this._aiAccum = 0;
    this._animAccum = 0;
    this._losAccum = LOS_INTERVAL_NEAR;
    this._canSee = false;
    this._distToPlayer = 999;
    this._time = 0;
    this._commsAccum = 0;
    this._patrolRoll = 1.5 + Math.random() * 2.5;
    this._rootYOffset = 0;
    this._culled = false;
    this._coarse = false;
    this._losPlayerX = 0;
    this._losPlayerZ = 0;
    this._losSelfX = 0;
    this._losSelfZ = 0;
    this._losStamp = 0;
    this._losValid = false;
    this._stagger = Math.random();

    this._tmpVec = new THREE.Vector3();
    this._tmpVec2 = new THREE.Vector3();
    this._tmpVec3 = new THREE.Vector3();
    this._alertResetTimer = 0;

    this._parts = parts || this._resolveParts();
    this._animState = {
      isMoving: false,
      isAiming: false,
      isShooting: false,
      isDead: false,
      isCrouching: false,
      isSprinting: false,
      isReloading: false,
      isMeleeing: false,
      moveSpeed: 1,
      position: this.position,
    };
    this._rotations = this.animations.rig;
  }

  _resolveParts() {
    const parts = {};
    for (let i = 0; i < PART_NAMES.length; i++) {
      parts[PART_NAMES[i]] = this.enemy.getObjectByName(PART_NAMES[i]) || null;
    }
    return parts;
  }

  _getVariantHealth() {
    const v = this.enemy.userData?.variant || 'assault';
    return v === 'heavy' ? 250 : v === 'scout' ? 70 : 120;
  }

  _getVariantAccuracy() {
    const v = this.enemy.userData?.variant || 'assault';
    return v === 'heavy' ? 0.21 : v === 'scout' ? 0.38 : 0.27;
  }

  _getVariantAggression() {
    const v = this.enemy.userData?.variant || 'assault';
    return v === 'heavy' ? 0.85 : v === 'scout' ? 0.55 : 0.7;
  }

  _getVariantSpeed() {
    const v = this.enemy.userData?.variant || 'assault';
    return v === 'heavy' ? 1.8 : v === 'scout' ? 4.5 : 3.2;
  }

  _getVariantPreferredRange() {
    const v = this.enemy.userData?.variant || 'assault';
    return v === 'heavy' ? 15 : v === 'scout' ? 30 : 20;
  }

  setQuality(quality) {
    if (!quality) return;
    this.quality = { ...this.quality, ...quality };
    this.animations.setQuality(this.quality);
  }

  setLODBand(band) {
    const next = band < 0 ? 0 : band > 2 ? 2 : band;
    if (next === this.lodBand) return;
    this.lodBand = next;
    this.updateInterval = LOD_INTERVALS[next];
    this.animInterval = ANIM_INTERVALS[next];
    this._frameAccum = this.updateInterval;
    this._aiAccum = 0;
    this._losAccum = this._losInterval;
  }

  get _losInterval() {
    return this.lodBand === 0 ? LOS_INTERVAL_NEAR : LOS_INTERVAL_FAR;
  }

  setCulled(culled) {
    if (culled === this._culled) return;
    this._culled = culled;

    if (culled) {
      this.velocity.set(0, 0, 0);
      this.path.length = 0;
      this.pathIndex = 0;
      this.pathPending = false;
      this.hasStraightTarget = false;
      this.pathfinding.cancelRequests(this);
      this.enemy.visible = false;
      return;
    }

    this.enemy.visible = this.renderBand < 2;
    this._frameAccum = this.updateInterval;
    this._aiAccum = 0;
    this._animAccum = 0;
    this._losAccum = this._losInterval * this._stagger;
    this._losValid = false;
    if (this.state === STATE.PATROL || this.state === STATE.INVESTIGATE || this.state === STATE.TAKE_COVER ||
        this.state === STATE.FLANK || this.state === STATE.RETREAT) {
      if (this.hasStraightTarget) this._requestPath(this.straightTarget, this.pathTag);
    } else if (this.state === STATE.COMBAT || this.state === STATE.ALERT) {
      this._requestPath(this.lastKnownPlayerPos, 0);
    }
  }

  isCulled() {
    return this._culled;
  }

  updateCull(distSq) {
    if (this._culled) {
      if (distSq < FREEZE_OFF_SQ) this.setCulled(false);
      return;
    }
    if (distSq > FREEZE_ON_SQ) this.setCulled(true);
  }

  cull() {
    this.pathfinding.cancelRequests(this);
    this.state = STATE.DEAD;
    this.frozen = true;
    this._culled = true;
    this.velocity.set(0, 0, 0);
    this.path.length = 0;
    this.pathIndex = 0;
    this.pathPending = false;
    this.enemy.visible = false;
    this.deathTimer = DEATH_REMOVE_TIME_LOW;
  }

  update(dt, playerPosition, playerAlive) {
    if (this.state === STATE.DEAD) {
      this.updateDeath(dt);
      return;
    }

    this._time += dt;
    if (this._culled) return;

    this.stateTimer += dt;
    this.shootCooldown -= dt;
    this.damageReactionTimer -= dt;
    this.suppressionLevel -= dt * 0.5;
    if (this.suppressionLevel < 0) this.suppressionLevel = 0;
    this.reactionTimer -= dt;
    if (this.reactionTimer < 0) this.reactionTimer = 0;
    this.grenadeCooldown -= dt;

    if (this._alertResetTimer > 0) {
      this._alertResetTimer -= dt;
      if (this._alertResetTimer <= 0) this.isAlerting = false;
    }

    const dx = this.position.x - playerPosition.x;
    const dz = this.position.z - playerPosition.z;
    this._distToPlayer = Math.sqrt(dx * dx + dz * dz + 1);

    this._frameAccum++;
    this._aiAccum += dt;

    if (this._frameAccum >= this.updateInterval || this._aiAccum >= AI_STARVATION_TIME) {
      const step = this._aiAccum;
      this._aiAccum = 0;
      this._frameAccum = 0;
      this._simulate(step, playerPosition, playerAlive);
    }

    this._integrateMovement(dt, playerPosition);
    this._updateAnimation(dt);
  }

  _simulate(dt, playerPosition, playerAlive) {
    this._coarse = this.lodBand === 2;
    this._updateLineOfSight(dt, playerPosition, playerAlive);

    if (this._canSee) {
      const d = this._distToPlayer;
      const detectionSpeed = d < 10 ? 4 : d < 20 ? 2.5 : 1.5;
      this.detectionLevel = Math.min(this.detectionLevel + dt * detectionSpeed, 1);
      this.lastKnownPlayerPos.copy(playerPosition);
      this._commsAccum += dt;
      if (this._commsAccum >= SQUAD_COMMS_INTERVAL) {
        this._commsAccum = 0;
        this._alertSquad(playerPosition);
      }
    } else {
      this.detectionLevel = Math.max(this.detectionLevel - dt * 0.25, 0);
    }

    this._updateState(dt, playerPosition);
    this._updateCombat(dt, playerPosition);
    this._updateSteeringHints(dt);
  }

  _updateLineOfSight(dt, playerPosition, playerAlive) {
    this._losAccum += dt;
    const interval = this._losInterval;
    if (this._losAccum < interval) return;

    if (!playerAlive || this._distToPlayer > DETECTION_RANGE) {
      this._canSee = false;
      this._losAccum = -interval * this._stagger;
      return;
    }

    const pdx = playerPosition.x - this._losPlayerX;
    const pdz = playerPosition.z - this._losPlayerZ;
    const sdx = this.position.x - this._losSelfX;
    const sdz = this.position.z - this._losSelfZ;
    const movedSq = pdx * pdx + pdz * pdz;
    const selfSq = sdx * sdx + sdz * sdz;

    if (this._losValid && movedSq < LOS_PLAYER_MOVE_SQ && selfSq < LOS_SELF_MOVE_SQ &&
        this._time - this._losStamp < LOS_MAX_STALE) {
      return;
    }

    if (!this.pathfinding.claimLosCheck()) {
      this._losAccum = interval * 0.5;
      return;
    }

    this._canSee = this._checkLineOfSight(playerPosition, playerAlive);
    this._losAccum = -interval * this._stagger;
    this._losStamp = this._time;
    this._losValid = true;
    this._losPlayerX = playerPosition.x;
    this._losPlayerZ = playerPosition.z;
    this._losSelfX = this.position.x;
    this._losSelfZ = this.position.z;
  }

  _checkLineOfSight(playerPosition, playerAlive) {
    if (!playerAlive) return false;
    if (this._distToPlayer > DETECTION_RANGE) return false;
    const from = this._tmpVec.set(this.position.x, this.position.y + 1.5, this.position.z);
    const to = this._tmpVec2.set(playerPosition.x, playerPosition.y + 1.5, playerPosition.z);
    return this.pathfinding.hasLineOfSight(from, to);
  }

  _updateSteeringHints(dt) {
    if (this.pathfinding.isStuck(this.squadId, this.position, dt)) {
      this.pathfinding.clearStuck(this.squadId);
      this._requestPath(this.lastKnownPlayerPos, 2);
      return;
    }
    if (this.pathIndex < this.path.length) return;
    if (this.hasStraightTarget) this._tryRecalc(this.straightTarget, this.pathTag);
  }

  _alertSquad(playerPosition) {
    if (this.isAlerting) return;
    this.isAlerting = true;
    this.lastAlertTime = this._time;
    this._alertResetTimer = SQUAD_COMMS_INTERVAL;

    const members = this.squadMembers;
    const limit = members.length < MAX_SQUAD_TRACK ? members.length : MAX_SQUAD_TRACK;
    const px = this.position.x;
    const pz = this.position.z;

    for (let i = 0; i < limit; i++) {
      const member = members[i];
      if (member === this || member.state === STATE.DEAD) continue;
      const mx = member.position.x - px;
      const mz = member.position.z - pz;
      if (mx * mx + mz * mz > SQUAD_ALERT_RADIUS_SQ) continue;

      if (member.detectionLevel < 0.7) member.detectionLevel = 0.7;
      member.lastKnownPlayerPos.copy(playerPosition);
      if (member.state === STATE.IDLE || member.state === STATE.PATROL) {
        member._transitionTo(STATE.ALERT);
      }
    }
  }

  _updateState(dt, playerPosition) {
    const canSee = this._canSee;
    const distToPlayer = this._distToPlayer;

    switch (this.state) {
      case STATE.IDLE:
        if (canSee && this.detectionLevel > 0.4) {
          this.reactionTimer = REACTION_TIME[0] + Math.random() * (REACTION_TIME[1] - REACTION_TIME[0]);
          this._transitionTo(STATE.COMBAT);
        } else if (this.detectionLevel > 0.15) {
          this._transitionTo(STATE.ALERT);
        } else if (this.stateTimer > this._patrolRoll) {
          this._patrolRoll = PATROL_IDLE_MIN + Math.random() * 2.5;
          this._transitionTo(STATE.PATROL);
        }
        break;

      case STATE.PATROL:
        if (canSee && this.detectionLevel > 0.4) {
          this.reactionTimer = REACTION_TIME[0] + Math.random() * (REACTION_TIME[1] - REACTION_TIME[0]);
          this._transitionTo(STATE.COMBAT);
        } else if (this.detectionLevel > 0.15) {
          this._transitionTo(STATE.ALERT);
        } else if (this.pathIndex >= this.path.length) {
          this._transitionTo(STATE.IDLE);
          this.stateTimer = 0;
        }
        break;

      case STATE.ALERT:
        if (canSee && this.detectionLevel > 0.6) {
          this._transitionTo(STATE.COMBAT);
        } else if (this.stateTimer > ALERT_DURATION) {
          if (this.detectionLevel > 0.1) {
            this.investigatePosition.copy(this.lastKnownPlayerPos);
            this._transitionTo(STATE.INVESTIGATE);
          } else {
            this._transitionTo(STATE.PATROL);
          }
        }
        break;

      case STATE.INVESTIGATE:
        if (canSee && this.detectionLevel > 0.5) {
          this._transitionTo(STATE.COMBAT);
        } else if (this.stateTimer > INVESTIGATE_DURATION || this.pathIndex >= this.path.length) {
          this._transitionTo(STATE.PATROL);
        }
        break;

      case STATE.COMBAT:
        if (!canSee) {
          this._transitionTo(STATE.ALERT);
        } else if (this.health < this.maxHealth * RETREAT_HEALTH && this.damageReactionTimer > 0) {
          this._transitionTo(STATE.RETREAT);
        } else if (this.health < this.maxHealth * 0.4 && this.damageReactionTimer > 0) {
          this._transitionTo(STATE.TAKE_COVER);
        } else if (distToPlayer < FLANK_RANGE && this._isPlayerCamping(dt, playerPosition)) {
          this._transitionTo(STATE.FLANK);
        } else if (distToPlayer < MELEE_RANGE && this.aggression > 0.7) {
          this._transitionTo(STATE.MELEE);
        } else if (this.suppressionLevel > SUPPRESSION_THRESHOLD) {
          this._transitionTo(STATE.SUPPRESS);
        }
        break;

      case STATE.TAKE_COVER:
        if (this.pathIndex >= this.path.length) {
          if (canSee) {
            this._transitionTo(STATE.COMBAT);
          } else if (this.stateTimer > 4) {
            this._transitionTo(STATE.PATROL);
          }
        }
        break;

      case STATE.FLANK:
        if (this.pathIndex >= this.path.length) {
          this._transitionTo(STATE.COMBAT);
        } else if (!canSee && this.stateTimer > 3.5) {
          this._transitionTo(STATE.ALERT);
        }
        break;

      case STATE.SUPPRESS:
        if (this.suppressionLevel <= 0) {
          this._transitionTo(STATE.COMBAT);
        } else if (!canSee && this.stateTimer > 2) {
          this._transitionTo(STATE.ALERT);
        }
        break;

      case STATE.RETREAT:
        if (this.pathIndex >= this.path.length) {
          this._transitionTo(STATE.TAKE_COVER);
        } else if (this.health > this.maxHealth * 0.5) {
          this._transitionTo(STATE.COMBAT);
        }
        break;

      case STATE.MELEE:
        if (distToPlayer > MELEE_RANGE * 1.5 || !canSee || this.meleeTimer <= 0) {
          this._transitionTo(STATE.COMBAT);
        }
        break;
    }
  }

  _transitionTo(newState) {
    this.state = newState;
    this.stateTimer = 0;
    this.isBursting = false;
    this.burstCount = 0;
    this.pauseTimer = 0;
    this.isStrafing = false;
    this.hasStraightTarget = false;

    switch (newState) {
      case STATE.PATROL: {
        const point = this.pathfinding.getPatrolPoint(this._tmpVec3);
        this.straightTarget.copy(point);
        this._requestPath(point, 0);
        this.isSprinting = false;
        this.isCrouching = false;
        break;
      }
      case STATE.ALERT:
        this.alertTimer = 0;
        this.isSprinting = false;
        break;
      case STATE.COMBAT:
        this.isSprinting = false;
        this.isCrouching = false;
        this.strafeTimer = 0;
        break;
      case STATE.TAKE_COVER: {
        const cover = this.pathfinding.getCoverPosition(this.lastKnownPlayerPos, this.position);
        if (cover) {
          this.straightTarget.copy(cover);
          this._requestPath(cover, 1);
        }
        this.isCrouching = true;
        break;
      }
      case STATE.FLANK: {
        this.flankDirection = Math.random() > 0.5 ? 1 : -1;
        const flankTarget = this._computeFlankPosition(this._tmpVec3);
        this.straightTarget.copy(flankTarget);
        this._requestPath(flankTarget, 3);
        this.isSprinting = true;
        break;
      }
      case STATE.SUPPRESS:
        this.isBursting = true;
        this.burstCount = 10 + Math.floor(Math.random() * 10);
        this.burstTimer = 0;
        break;
      case STATE.RETREAT: {
        const retreatPos = this._computeRetreatPosition(this._tmpVec3);
        this.straightTarget.copy(retreatPos);
        this._requestPath(retreatPos, 4);
        this.isSprinting = true;
        break;
      }
      case STATE.MELEE:
        this.meleeTimer = 0.8;
        this.animations.triggerMelee();
        break;
      case STATE.INVESTIGATE:
        this.straightTarget.copy(this.investigatePosition);
        this._requestPath(this.investigatePosition, 5);
        this.isSprinting = false;
        this.isCrouching = false;
        break;
    }
  }

  _requestPath(target, tag) {
    this.pathTag = tag;
    this.straightTarget.set(target.x, 0, target.z);
    this.hasStraightTarget = true;
    this.pathPending = this.pathfinding.requestPath(
      this,
      this.position.x,
      this.position.z,
      target.x,
      target.z,
      tag
    );
    if (!this.pathPending) {
      this.path = this.pathfinding.findPath(this.position, target);
      this.pathIndex = 0;
    }
  }

  onPathResolved(path, tag) {
    this.pathPending = false;
    if (this.state === STATE.DEAD) return;
    if (tag !== this.pathTag && tag !== 2) return;
    this.path = path;
    this.pathIndex = 0;
  }

  _tryRecalc(target, tag) {
    if (this.pathPending) return;
    if (this.pathfinding.shouldRecalculatePath(this.squadId, target, this._time, false)) {
      this._requestPath(target, tag);
    }
  }

  _computeFlankPosition(out) {
    const toPlayer = this._tmpVec.copy(this.lastKnownPlayerPos).sub(this.position).normalize();
    const perpendicular = this._tmpVec2.set(-toPlayer.z, 0, toPlayer.x).multiplyScalar(this.flankDirection * 10);
    return out.copy(this.lastKnownPlayerPos).add(perpendicular);
  }

  _computeRetreatPosition(out) {
    const away = this._tmpVec.copy(this.position).sub(this.lastKnownPlayerPos).normalize();
    return out.copy(this.position).add(away.multiplyScalar(15));
  }

  _isPlayerCamping(dt, playerPosition) {
    if (this._distToPlayer < 12) {
      this.playerCampTimer += dt;
      return this.playerCampTimer > CAMP_TIME;
    }
    this.playerCampTimer = 0;
    return false;
  }

  _integrateMovement(dt, playerPosition) {
    const target = this._nextWaypoint();

    if (target) {
      const dir = this._tmpVec.set(target.x - this.position.x, 0, target.z - this.position.z);
      const distSq = dir.lengthSq();

      if (distSq < WAYPOINT_REACH * WAYPOINT_REACH) {
        this.pathIndex++;
      } else {
        const dist = Math.sqrt(distSq);
        dir.multiplyScalar(1 / dist);

        let speed = this.state === STATE.COMBAT ? this.moveSpeed * 0.4 : this.moveSpeed;
        if (this.isSprinting) speed *= 1.4;
        if (this.isCrouching) speed *= 0.5;

        const avoidance = this.pathfinding.getAvoidanceDirection(this.position);
        if (avoidance.x !== 0 || avoidance.z !== 0) {
          dir.x += avoidance.x * 0.5;
          dir.z += avoidance.z * 0.5;
        }

        if (this.squadMembers.length > 0 && !this._coarse) {
          const separation = this.pathfinding.getSeparationFromSquad(this.position, this.squadMembers, this);
          if (separation.x !== 0 || separation.z !== 0) {
            dir.x += separation.x * 0.3;
            dir.z += separation.z * 0.3;
          }
        }

        const invLen = 1 / Math.sqrt(dir.lengthSq() + 1e-6);
        const vx = dir.x * invLen * speed;
        const vz = dir.z * invLen * speed;
        this.velocity.set(vx, 0, vz);
        this.position.x += vx * dt;
        this.position.z += vz * dt;

        this._rotateTowards(Math.atan2(dir.x, dir.z), TURN_RATE, dt);
      }
    } else {
      this.velocity.set(0, 0, 0);

      if (this.state === STATE.COMBAT || this.state === STATE.ALERT) {
        if (!this._coarse) {
          const ang = Math.atan2(playerPosition.x - this.position.x, playerPosition.z - this.position.z);
          this._rotateTowards(ang, TURN_RATE_AIM, dt);
          if (this.state === STATE.COMBAT && this._canSee) this._updateStrafing(dt, playerPosition);
        }
      } else if (this.state === STATE.IDLE) {
        this.enemy.rotation.y += Math.sin(this.stateTimer * 0.4) * dt * 0.25;
      }
    }

    this.enemy.position.set(this.position.x, this.position.y + this._rootYOffset, this.position.z);
  }

  _nextWaypoint() {
    if (this.pathIndex < this.path.length) return this.path[this.pathIndex];
    if (this.hasStraightTarget) return this.straightTarget;
    return null;
  }

  _updateStrafing(dt, playerPosition) {
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeDirection = this.strafeDirection > 0 ? -1 : 1;
      this.strafeTimer = 0.8 + Math.random() * 1.2;
      this.isStrafing = Math.random() > 0.3;
    }

    if (!this.isStrafing) return;

    const dx = playerPosition.x - this.position.x;
    const dz = playerPosition.z - this.position.z;
    const inv = 1 / Math.sqrt(dx * dx + dz * dz + 1e-6);
    const strafeSpeed = this.moveSpeed * 0.3;
    this.position.x += -dz * inv * strafeSpeed * dt;
    this.position.z += dx * inv * strafeSpeed * dt;
  }

  _rotateTowards(targetAngle, rate, dt) {
    let diff = targetAngle - this.enemy.rotation.y;
    if (diff > Math.PI) diff -= Math.PI * 2;
    else if (diff < -Math.PI) diff += Math.PI * 2;
    this.enemy.rotation.y += diff * Math.min(rate * dt, 1);
  }

  _updateCombat(dt, playerPosition) {
    const state = this.state;
    if (state !== STATE.COMBAT && state !== STATE.TAKE_COVER && state !== STATE.SUPPRESS) return;
    if (!this._canSee && state !== STATE.SUPPRESS) return;
    if (this.reactionTimer > 0) return;

    if (state === STATE.TAKE_COVER) {
      this.coverPeekTimer -= dt;
      if (this.coverPeekTimer <= 0) {
        this.isPeeking = !this.isPeeking;
        this.coverPeekTimer = COVER_PEEK_TIME[0] + Math.random() * (COVER_PEEK_TIME[1] - COVER_PEEK_TIME[0]);
        this.leanDirection = this.isPeeking ? (Math.random() > 0.5 ? 1 : -1) : 0;
        this.animations.triggerLean(this.leanDirection);
      }
      if (!this.isPeeking) return;
    }

    if (this.shootCooldown > 0) return;

    if (this.isReloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this.isReloading = false;
      return;
    }

    const distToPlayer = this._distToPlayer;

    if (this.grenadeCooldown <= 0 && distToPlayer > GRENADE_RANGE[0] && distToPlayer < GRENADE_RANGE[1]) {
      if (this.onGrenade) this.onGrenade(this, playerPosition);
      this.grenadeCooldown = GRENADE_COOLDOWN[0] + Math.random() * (GRENADE_COOLDOWN[1] - GRENADE_COOLDOWN[0]);
      return;
    }

    if (!this.isBursting) {
      this.pauseTimer -= dt;
      if (this.pauseTimer <= 0) {
        this.isBursting = true;
        this.burstCount = Math.floor(BURST_LENGTH[0] + Math.random() * (BURST_LENGTH[1] - BURST_LENGTH[0]));
        this.burstTimer = 0;
      }
    } else {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this._shoot(playerPosition, distToPlayer);
        this.burstCount--;
        this.burstTimer = 0.07 + Math.random() * 0.05;

        if (this.burstCount <= 0) {
          this.isBursting = false;
          this.pauseTimer = BURST_PAUSE[0] + Math.random() * (BURST_PAUSE[1] - BURST_PAUSE[0]);

          if (Math.random() < 0.3) {
            this.isReloading = true;
            this.reloadTimer = 2.0 + Math.random() * 0.5;
            this.animations.triggerReload();
          }
        }
      }
    }
  }

  _shoot(playerPosition, distToPlayer) {
    this.animations.triggerRecoil();
    const distMod = 1 - (distToPlayer / ATTACK_RANGE) * 0.4;
    const suppressionMod = 1 - this.suppressionLevel * 0.5;
    const hit = Math.random() < this.accuracy * distMod * suppressionMod;
    if (this.onShoot) this.onShoot(this, playerPosition, hit);
  }

  _updateAnimation(dt) {
    if (this.animInterval > 1) {
      this._animAccum += dt;
      if (this._animAccum < 1 / 30) return;
      dt = this._animAccum;
      this._animAccum = 0;
    }

    const s = this._animState;
    const isMoving = this.pathIndex < this.path.length || this.hasStraightTarget;
    const isAiming = this.state === STATE.COMBAT || this.state === STATE.TAKE_COVER;
    const isShooting = this.isBursting && this.shootCooldown <= 0;

    s.isMoving = isMoving;
    s.isAiming = isAiming;
    s.isShooting = isShooting;
    s.isDead = false;
    s.isCrouching = this.isCrouching;
    s.isSprinting = this.isSprinting && isMoving;
    s.isReloading = this.isReloading;
    s.isMeleeing = this.state === STATE.MELEE;
    s.moveSpeed = this.moveSpeed / 3;

    const rig = this.animations.update(dt, s);
    this._applyRig(rig);
  }

  _applyRig(rig) {
    const p = this._parts;
    const head = p.head;
    if (head) head.rotation.copy(rig.head);
    const torso = p.torso;
    if (torso) torso.rotation.copy(rig.torso);
    const leftArm = p.leftArm;
    if (leftArm) leftArm.rotation.copy(rig.leftArm);
    const rightArm = p.rightArm;
    if (rightArm) rightArm.rotation.copy(rig.rightArm);
    const leftLeg = p.leftLeg;
    if (leftLeg) leftLeg.rotation.copy(rig.leftLeg);
    const rightLeg = p.rightLeg;
    if (rightLeg) rightLeg.rotation.copy(rig.rightLeg);
    const weapon = p.weapon;
    if (weapon) weapon.rotation.copy(rig.weapon);

    this.enemy.rotation.x = rig.root.x;
    this.enemy.rotation.z = rig.root.z;
    this._rootYOffset = rig.rootOffset.y;
  }

  updateDeath(dt) {
    this.deathTimer += dt;
    if (this.frozen) return;
    if (this._culled) return;

    const s = this._animState;
    s.isMoving = false;
    s.isAiming = false;
    s.isShooting = false;
    s.isDead = true;
    s.isCrouching = false;
    s.isSprinting = false;
    s.isReloading = false;
    s.isMeleeing = false;
    s.moveSpeed = 0;

    const rig = this.animations.update(dt, s);
    this._applyRig(rig);

    if (this.animations.deathProgress >= 1) {
      this.frozen = true;
      this.velocity.set(0, 0, 0);
      this.path.length = 0;
      this.pathIndex = 0;
      this.pathPending = false;
      this.enemy.visible = false;
    }
  }

  takeDamage(amount, direction) {
    if (this.state === STATE.DEAD) return;

    this.health -= amount;
    this.damageReactionTimer = 2.5;
    this.suppressionLevel = Math.min(this.suppressionLevel + 0.4, 1.0);
    this.consecutiveHits++;
    this.lastDamageTime = this._time;

    this.animations.triggerHitReaction(direction);

    if (this.onHit) this.onHit(this, amount);

    if (this.health <= 0) {
      this._die(direction);
      return;
    }

    this.detectionLevel = 1;
    this.lastKnownPlayerPos.set(
      this.position.x + direction.x * 12,
      this.position.y,
      this.position.z + direction.z * 12
    );

    if (this.state === STATE.IDLE || this.state === STATE.PATROL) {
      this._transitionTo(STATE.COMBAT);
    } else if (this.state === STATE.COMBAT) {
      if (this.health < this.maxHealth * 0.3) {
        this._transitionTo(STATE.TAKE_COVER);
      } else if (this.consecutiveHits > 3) {
        this._transitionTo(STATE.RETREAT);
      }
    }
  }

  setSquad(members) {
    this.squadMembers = members.length > MAX_SQUAD_MEMBERS ? members.slice(0, MAX_SQUAD_MEMBERS) : members;
  }

  _die(direction) {
    this.state = STATE.DEAD;
    this.deathTimer = 0;
    this.frozen = false;
    this.velocity.set(0, 0, 0);
    this.path.length = 0;
    this.pathIndex = 0;
    this.pathPending = false;
    this.squadMembers = [];
    this.animations.triggerDeath(direction);
    this.pathfinding.cancelRequests(this);
    if (this._culled) this.setCulled(false);
  }

  isAlive() {
    return this.state !== STATE.DEAD;
  }

  shouldRemove() {
    const limit = this.quality.propDetail <= 0 ? DEATH_REMOVE_TIME_LOW : DEATH_REMOVE_TIME;
    return this.state === STATE.DEAD && this.deathTimer > limit;
  }

  isFrozen() {
    return this.frozen;
  }

  getDeathProgress() {
    return this.animations.deathProgress;
  }

  getPosition() {
    return this.position;
  }

  getGroup() {
    return this.enemy;
  }

  attachModel(group, parts) {
    this.enemy = group;
    if (parts) this._parts = parts;
    this.decoHidden = false;
    this.renderBand = -1;
  }

  getState() {
    return this.state;
  }

  getLODBand() {
    return this.lodBand;
  }

  getHealth() {
    return this.health;
  }

  getMaxHealth() {
    return this.maxHealth;
  }
}
