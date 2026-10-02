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

const ARM_OFFSET_RIGHT = new THREE.Vector3(0.20, -0.18, -0.35);
const ARM_OFFSET_LEFT = new THREE.Vector3(-0.20, -0.18, -0.35);
const RIGHT_TARGET = new THREE.Vector3(0.04, -0.015, -0.08);
const LEFT_TARGET = new THREE.Vector3(-0.07, -0.035, -0.12);
const RIGHT_TARGET_ADS = new THREE.Vector3(0.02, -0.01, -0.06);
const LEFT_TARGET_ADS = new THREE.Vector3(-0.05, -0.025, -0.10);
const NO_FRONT_GRIP = { pistol: true };

export class FirstPersonArms {
  constructor(scene, camera, assetFactory, quality) {
    this.scene = scene;
    this.camera = camera;
    this.assetFactory = assetFactory;
    this.quality = Object.assign({}, DEFAULT_QUALITY, quality || {});

    const detail = Math.max(0, this.quality.propDetail | 0);
    this.detail = detail;
    this.segments = detail === 0 ? 6 : (detail === 1 ? 8 : 10);
    this.fingerCount = detail === 0 ? 3 : 4;
    this.showFingertips = detail >= 1;

    this.armsGroup = new THREE.Group();
    this.rightArm = null;
    this.leftArm = null;
    this.rightHand = null;
    this.leftHand = null;
    this.leftArmVisible = true;

    this._buildArms();
    this.camera.add(this.armsGroup);

    this._time = 0;
    this._recoilOffset = 0;
    this._reloadDip = 0;
    this._sprintRaise = 0;
    this._adsBlend = 0;
  }

  _buildArms() {
    const camoMat = this.assetFactory.createMaterial('camo', { seed: 99 });
    const gloveMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.85, metalness: 0.15 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xc4956a, roughness: 0.66, metalness: 0.0, envMapIntensity: 1.1 });

    this._geo = {
      upperArm: new THREE.CylinderGeometry(0.032, 0.038, 0.26, this.segments),
      elbow: new THREE.SphereGeometry(0.032, this.segments, this.segments - 2),
      forearm: new THREE.CylinderGeometry(0.026, 0.030, 0.24, this.segments),
      wrist: new THREE.CylinderGeometry(0.023, 0.026, 0.04, this.segments),
      palm: new THREE.BoxGeometry(0.048, 0.058, 0.028),
      knuckle: new THREE.BoxGeometry(0.046, 0.014, 0.026),
      finger: new THREE.CylinderGeometry(0.005, 0.006, 0.042, this.detail === 0 ? 4 : 6),
      fingertip: this.showFingertips ? new THREE.SphereGeometry(0.005, 4, 4) : null,
      thumb: new THREE.CylinderGeometry(0.006, 0.007, 0.038, this.detail === 0 ? 4 : 6),
    };

    this.rightArm = this._buildSingleArm(camoMat, gloveMat, skinMat, true);
    this.leftArm = this._buildSingleArm(camoMat, gloveMat, skinMat, false);

    this.rightArm.position.copy(ARM_OFFSET_RIGHT);
    this.leftArm.position.copy(ARM_OFFSET_LEFT);

    this.rightArm.rotation.set(-0.25, -0.12, 0.08);
    this.leftArm.rotation.set(-0.25, 0.12, -0.08);

    this.armsGroup.add(this.rightArm);
    this.armsGroup.add(this.leftArm);
  }

  _part(geo, mat) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    return mesh;
  }

  _buildSingleArm(camoMat, gloveMat, skinMat, isRight) {
    const arm = new THREE.Group();
    const geo = this._geo;

    const upperArm = this._part(geo.upperArm, camoMat);
    upperArm.position.y = -0.13;
    arm.add(upperArm);

    if (this.detail >= 1) {
      const elbow = this._part(geo.elbow, skinMat);
      elbow.position.y = -0.26;
      arm.add(elbow);
    }

    const forearm = this._part(geo.forearm, camoMat);
    forearm.position.y = -0.38;
    arm.add(forearm);

    const wrist = this._part(geo.wrist, gloveMat);
    wrist.position.y = -0.50;
    arm.add(wrist);

    const hand = this._buildHand(gloveMat, skinMat, isRight);
    hand.position.y = -0.55;
    arm.add(hand);

    if (isRight) {
      this.rightHand = hand;
    } else {
      this.leftHand = hand;
    }

    return arm;
  }

  _buildHand(gloveMat, skinMat, isRight) {
    const hand = new THREE.Group();
    const geo = this._geo;

    hand.add(this._part(geo.palm, gloveMat));
    hand.add(this._part(geo.knuckle, gloveMat));

    for (let i = 0; i < this.fingerCount; i++) {
      const finger = this._part(geo.finger, gloveMat);
      const xOff = (i - (this.fingerCount - 1) / 2) * 0.011;
      finger.position.set(xOff, 0.048, -0.007);
      finger.rotation.x = -0.25;
      hand.add(finger);

      if (geo.fingertip) {
        const fingertip = this._part(geo.fingertip, skinMat);
        fingertip.position.set(xOff, 0.068, -0.013);
        hand.add(fingertip);
      }
    }

    const thumb = this._part(geo.thumb, gloveMat);
    thumb.position.set(isRight ? -0.028 : 0.028, 0.009, -0.009);
    thumb.rotation.z = isRight ? 0.45 : -0.45;
    thumb.rotation.x = -0.18;
    hand.add(thumb);

    return hand;
  }

  update(dt, weaponGroup, animationState) {
    this._time += dt;

    const isSprinting = animationState && animationState.isSprinting;
    const isADS = animationState && animationState.isAds;
    const isReloading = animationState && animationState.isReloading;
    const weaponType = animationState && animationState.weaponType;

    if (weaponType && NO_FRONT_GRIP[weaponType] === true) {
      if (this.leftArmVisible) {
        this.leftArm.visible = false;
        this.leftArmVisible = false;
      }
    } else if (!this.leftArmVisible) {
      this.leftArm.visible = true;
      this.leftArmVisible = true;
    }

    const bobSpeed = isSprinting ? 10 : 7;
    const bobAmount = isSprinting ? 0.012 : 0.006;
    const bobX = Math.sin(this._time * bobSpeed) * bobAmount;
    const bobY = Math.abs(Math.cos(this._time * bobSpeed)) * bobAmount;

    this._recoilOffset = THREE.MathUtils.damp(this._recoilOffset, 0, 15, dt);
    this._reloadDip = THREE.MathUtils.damp(this._reloadDip, isReloading ? 1 : 0, 8, dt);
    this._sprintRaise = THREE.MathUtils.damp(this._sprintRaise, isSprinting ? 1 : 0, 8, dt);
    this._adsBlend = THREE.MathUtils.damp(this._adsBlend, isADS ? 1 : 0, 12, dt);

    const reloadDipAmount = this._reloadDip * 0.12;
    const sprintRaiseAmount = this._sprintRaise * 0.08;
    const adsRaiseAmount = this._adsBlend * 0.06;

    const sway = animationState && animationState.weaponSway;
    const swayX = sway ? sway.x : 0;
    const swayY = sway ? sway.y : 0;

    const rightArm = this.rightArm;
    const leftArm = this.leftArm;
    const baseY = ARM_OFFSET_RIGHT.y - reloadDipAmount - sprintRaiseAmount + adsRaiseAmount;

    rightArm.position.set(
      ARM_OFFSET_RIGHT.x + bobX + swayX,
      baseY + bobY,
      ARM_OFFSET_RIGHT.z + this._recoilOffset
    );
    leftArm.position.set(
      ARM_OFFSET_LEFT.x + bobX + swayX,
      baseY + bobY,
      ARM_OFFSET_LEFT.z + this._recoilOffset
    );

    const armRotX = -0.25 + this._recoilOffset * 2 - reloadDipAmount * 0.4 + this._adsBlend * 0.15;
    rightArm.rotation.x = armRotX + (isSprinting ? 0.25 : 0);
    leftArm.rotation.x = armRotX + (isSprinting ? 0.25 : 0);
    rightArm.rotation.z = 0.08 + (isSprinting ? 0.18 : 0);
    leftArm.rotation.z = -0.08 + (isSprinting ? -0.18 : 0);

    if (weaponGroup) {
      const rightTarget = isADS ? RIGHT_TARGET_ADS : RIGHT_TARGET;
      const leftTarget = isADS ? LEFT_TARGET_ADS : LEFT_TARGET;
      this.rightHand.position.lerp(rightTarget, 10 * dt);
      this.leftHand.position.lerp(leftTarget, 10 * dt);
    }
  }

  setVisible(bool) {
    this.armsGroup.visible = bool;
  }

  triggerRecoil() {
    this._recoilOffset = 0.025;
  }

  triggerReload() {
    this._reloadDip = 1;
  }
}
