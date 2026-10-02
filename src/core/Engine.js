import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    exposure: { value: 1.4 },
    contrast: { value: 1.06 },
    saturation: { value: 1.06 },
    shadowTint: { value: new THREE.Color(0.78, 0.88, 1.06) },
    shadowLift: { value: 0.035 },
    shadowAmount: { value: 0.45 },
    highlightTint: { value: new THREE.Color(1.03, 1.0, 0.95) },
    vignette: { value: 0.34 },
    damage: { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float exposure;
    uniform float contrast;
    uniform float saturation;
    uniform float vignette;
    uniform float damage;
    uniform vec3 shadowTint;
    uniform float shadowLift;
    uniform float shadowAmount;
    uniform vec3 highlightTint;
    varying vec2 vUv;

    vec3 aces(vec3 x) {
      return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    }

    vec3 toSRGB(vec3 c) {
      return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,
                 step(vec3(0.0031308), c));
    }

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;

      c = aces(c * exposure);
      c = toSRGB(c);

      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));

      c = mix(vec3(l), c, saturation);
      c = (c - 0.5) * contrast + 0.5;

      float sm = 1.0 - smoothstep(0.0, 0.6, l);
      c = mix(c, c * shadowTint + shadowLift, sm * shadowAmount);

      float hm = smoothstep(0.55, 1.0, l);
      c = mix(c, c * highlightTint, hm * 0.16);

      vec2 d = vUv - 0.5;
      c *= clamp(1.0 - dot(d, d) * vignette * 2.4, 0.0, 1.0);

      if (damage > 0.001) {
        float e = smoothstep(0.15, 0.72, dot(d, d) * 2.0);
        c = mix(c, vec3(0.42, 0.02, 0.02), e * damage);
      }

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

export class Engine {
  constructor(canvas, performanceManager) {
    this.canvas = canvas;
    this.perf = performanceManager;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      alpha: false,
    });

    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xa6bccd);
    this.scene.fog = new THREE.FogExp2(0xa6bccd, 0.0062);

    this.camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.08, 420);
    this.camera.position.set(0, 1.7, 0);
    this.scene.add(this.camera);
    this.baseFov = 78;

    this.clock = new THREE.Clock();
    this.deltaTime = 0;
    this.elapsedTime = 0;
    this.frameCount = 0;
    this._shadowTimer = 0;
    this._usePost = true;
    this._damageLevel = 0;
    this._baseExposure = 1.4;
    this._lastBloomState = this.perf.settings.bloomEnabled;
    this.vignetteEl = null;

    this._buildVignetteDom();
    this._buildEnvironment();
    this._buildViewmodelLight();
    this._buildComposer();
    this._applySize();
    this._setupResize();
  }

  _buildEnvironment() {
    if (this._envRT) return;
    try {
      const w = 32;
      const h = 16;
      const data = new Uint8Array(w * h * 4);
      const top = new THREE.Color(0x3f6ea8);
      const horizon = new THREE.Color(0xcbb69a);
      const ground = new THREE.Color(0x5a4c3e);
      const sunDir = new THREE.Vector3(40, 60, -50).normalize();
      const c = new THREE.Color();
      const dir = new THREE.Vector3();

      for (let y = 0; y < h; y++) {
        const v = (y + 0.5) / h;
        const theta = v * Math.PI;
        for (let x = 0; x < w; x++) {
          const u = (x + 0.5) / w;
          const phi = u * Math.PI * 2;
          dir.set(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));

          if (dir.y >= 0) {
            c.copy(horizon).lerp(top, Math.pow(dir.y, 0.55));
          } else {
            c.copy(horizon).lerp(ground, Math.min(1, -dir.y * 1.6));
          }

          const sun = Math.max(0, dir.dot(sunDir));
          if (sun > 0) {
            const s = Math.pow(sun, 220) * 9 + Math.pow(sun, 9) * 0.5;
            c.r = Math.min(1, c.r + s);
            c.g = Math.min(1, c.g + s * 0.97);
            c.b = Math.min(1, c.b + s * 0.88);
          }

          const i = (y * w + x) * 4;
          data[i] = Math.round(c.r * 255);
          data[i + 1] = Math.round(c.g * 255);
          data[i + 2] = Math.round(c.b * 255);
          data[i + 3] = 255;
        }
      }

      const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;

      const pmrem = new THREE.PMREMGenerator(this.renderer);
      pmrem.compileEquirectangularShader();
      this._envRT = pmrem.fromEquirectangular(tex);
      this.scene.environment = this._envRT.texture;
      this.scene.environmentIntensity = 0.85;
      tex.dispose();
      pmrem.dispose();
    } catch (e) {
      this.scene.environment = null;
    }
  }

  _buildViewmodelLight() {
    const key = new THREE.DirectionalLight(0xfff4e6, 1.35);
    key.position.set(0.35, 0.55, 1.0);
    key.layers.set(2);
    this.camera.add(key);
    key.position.set(0.35, 0.55, 1.0);
    this.viewmodelLight = key;

    const fill = new THREE.DirectionalLight(0xa8c8e8, 0.7);
    fill.position.set(-0.7, 0.1, 0.85);
    fill.layers.set(2);
    this.camera.add(fill);
    fill.position.set(-0.7, 0.1, 0.85);
    this.viewmodelFill = fill;
  }

  registerViewmodel(root) {
    if (!root) return;
    root.traverse((o) => {
      if (o.isMesh) o.layers.enable(2);
    });
  }

  _buildVignetteDom() {
    const el = document.createElement('div');
    el.id = 'engine-vignette';
    el.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5;opacity:0;transition:opacity 90ms linear;background:radial-gradient(ellipse at center, rgba(0,0,0,0) 42%, rgba(0,0,0,0.55) 88%, rgba(0,0,0,0.85) 100%)';
    const parent = this.canvas.parentElement || document.body;
    parent.appendChild(el);
    this.vignetteEl = el;
  }

  _buildComposer() {
    const s = this.perf.settings;
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
      this.bloomPass = null;
      this.gradePass = null;
      this.renderPass = null;
    }

    this._usePost = true;
    this.composer = new EffectComposer(this.renderer);
    this.composer.renderToScreen = true;

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    if (s.bloomEnabled) {
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(this._w || 640, this._h || 480),
        0.3, 0.8, 0.85
      );
      this.composer.addPass(this.bloomPass);
    } else {
      this.bloomPass = null;
    }

    this.gradePass = new ShaderPass(GradeShader);
    this.gradePass.material.toneMapped = false;
    this.gradePass.material.depthTest = false;
    this.gradePass.material.depthWrite = false;
    this.gradePass.renderToScreen = true;
    this.gradePass.uniforms.exposure.value = this._baseExposure;
    this.composer.addPass(this.gradePass);

    this._lastBloomState = s.bloomEnabled;
    if (this.vignetteEl) this.vignetteEl.style.display = 'none';
  }

  _applySize() {
    const w = this.perf.getRenderWidth();
    const h = this.perf.getRenderHeight();
    this._w = w;
    this._h = h;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setSize(w, h);
      if (this.bloomPass) this.bloomPass.setSize(w, h);
    }
  }

  onQualityChange(settings, scale) {
    const needsRebuild = settings.bloomEnabled !== this._lastBloomState;
    this._lastBloomState = settings.bloomEnabled;
    if (needsRebuild) {
      this._buildComposer();
      this._applySize();
    } else {
      this._applySize();
    }
    this.renderer.shadowMap.enabled = settings.shadowsEnabled;
    if (!settings.shadowsEnabled) {
      this.scene.traverse((o) => { if (o.isMesh && o.userData.wasShadowCaster) o.castShadow = false; });
    }
    this.renderer.shadowMap.needsUpdate = true;
  }

  setDamageIntensity(v) {
    this._damageLevel = v;
    if (this.gradePass && this.gradePass.uniforms) {
      this.gradePass.uniforms.damage.value = v;
    }
  }

  setExposure(v) {
    if (this.gradePass && this.gradePass.uniforms) {
      this.gradePass.uniforms.exposure.value = this._baseExposure * v;
    } else {
      this.renderer.toneMappingExposure = this._baseExposure * v;
    }
  }

  _setupResize() {
    this._resizeHandler = () => {
      this._applySize();
    };
    window.addEventListener('resize', this._resizeHandler);
  }

  update() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.deltaTime = dt;
    this.elapsedTime = this.clock.elapsedTime;
    this.frameCount++;

    this.renderer.info.reset();
    this.perf.recordFrame(dt);

    const s = this.perf.settings;
    this._shadowTimer += dt;
    if (s.shadowsEnabled) {
      if (this._shadowTimer >= s.shadowUpdateInterval) {
        this._shadowTimer = 0;
        this.renderer.shadowMap.needsUpdate = true;
      }
    }

    this._damageLevel *= Math.exp(-5.5 * dt);
    if (this._usePost && this.gradePass && this.gradePass.uniforms) {
      this.gradePass.uniforms.damage.value = this._damageLevel;
    }
    if (this.vignetteEl && this.vignetteEl.style.display !== 'none') {
      const v = this._damageLevel;
      this.vignetteEl.style.opacity = v > 0.02 ? String(Math.min(0.72, v * 0.8)) : '0';
    }

    return dt;
  }

  render() {
    if (this._usePost && this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  getDelta() { return this.deltaTime; }
  getElapsed() { return this.elapsedTime; }

  getDrawCalls() { return this.renderer.info.render.calls; }
  getTriangles() { return this.renderer.info.render.triangles; }
}
