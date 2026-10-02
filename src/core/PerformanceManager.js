const TIERS = {
  ultra: {
    name: 'ultra',
    maxPixelRatio: 2.0,
    renderScale: 1.0,
    shadowMapSize: 2048,
    shadowsEnabled: true,
    shadowUpdateInterval: 1,
    ssaoEnabled: true,
    bloomEnabled: true,
    grainEnabled: true,
    anisotropy: 4,
    textureSize: 512,
    maxParticles: 4000,
    maxEnemies: 16,
    physicsSteps: 1,
    tracerSegments: 6,
    decalLimit: 40,
    casingLimit: 24,
    maxLights: 6,
    cloudLayers: 5,
    dustParticles: 0,
    enemyLodDistance: 45,
    propDetail: 2,
    buildingDetail: 2,
  },
  high: {
    name: 'high',
    maxPixelRatio: 1.5,
    renderScale: 0.85,
    shadowMapSize: 1024,
    shadowsEnabled: true,
    shadowUpdateInterval: 2,
    ssaoEnabled: false,
    bloomEnabled: true,
    grainEnabled: true,
    anisotropy: 2,
    textureSize: 512,
    maxParticles: 2000,
    maxEnemies: 12,
    physicsSteps: 1,
    tracerSegments: 4,
    decalLimit: 24,
    casingLimit: 16,
    maxLights: 4,
    cloudLayers: 3,
    dustParticles: 0,
    enemyLodDistance: 35,
    propDetail: 1,
    buildingDetail: 1,
  },
  medium: {
    name: 'medium',
    maxPixelRatio: 1.0,
    renderScale: 0.7,
    shadowMapSize: 512,
    shadowsEnabled: true,
    shadowUpdateInterval: 3,
    ssaoEnabled: false,
    bloomEnabled: true,
    grainEnabled: false,
    anisotropy: 1,
    textureSize: 256,
    maxParticles: 900,
    maxEnemies: 8,
    physicsSteps: 1,
    tracerSegments: 3,
    decalLimit: 12,
    casingLimit: 10,
    maxLights: 3,
    cloudLayers: 2,
    dustParticles: 0,
    enemyLodDistance: 28,
    propDetail: 1,
    buildingDetail: 0,
  },
  low: {
    name: 'low',
    maxPixelRatio: 1.0,
    renderScale: 0.7,
    shadowMapSize: 1024,
    shadowsEnabled: true,
    shadowUpdateInterval: 3,
    ssaoEnabled: false,
    bloomEnabled: false,
    grainEnabled: false,
    anisotropy: 1,
    textureSize: 256,
    maxParticles: 400,
    maxEnemies: 6,
    physicsSteps: 1,
    tracerSegments: 2,
    decalLimit: 6,
    casingLimit: 6,
    maxLights: 2,
    cloudLayers: 1,
    dustParticles: 0,
    enemyLodDistance: 22,
    propDetail: 0,
    buildingDetail: 0,
  },
  potato: {
    name: 'potato',
    maxPixelRatio: 1.0,
    renderScale: 0.55,
    shadowMapSize: 512,
    shadowsEnabled: true,
    shadowUpdateInterval: 6,
    ssaoEnabled: false,
    bloomEnabled: false,
    grainEnabled: false,
    anisotropy: 1,
    textureSize: 128,
    maxParticles: 150,
    maxEnemies: 4,
    physicsSteps: 1,
    tracerSegments: 1,
    decalLimit: 0,
    casingLimit: 4,
    maxLights: 1,
    cloudLayers: 1,
    dustParticles: 0,
    enemyLodDistance: 18,
    propDetail: 0,
    buildingDetail: 0,
  },
};

const TIER_ORDER = ['potato', 'low', 'medium', 'high', 'ultra'];

export class PerformanceManager {
  constructor() {
    this.tier = 'medium';
    this.settings = { ...TIERS.medium };
    this.targetFps = 60;
    this.minFps = 24;
    this.currentFps = 60;
    this.adaptiveScale = 1.0;
    this.minScale = 0.55;
    this.maxScale = 1.0;
    this.enabled = true;
    this.frameSamples = [];
    this.sampleSize = 30;
    this._cooldown = 0;
    this._lastAdjust = 0;
    this._slowFrames = 0;
    this._fastFrames = 0;
    this._gpuName = 'unknown';
    this._cpuCores = navigator.hardwareConcurrency || 4;
    this._isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    this._onChange = null;
    this._benchmarkFrames = 0;
    this._benchmarkTime = 0;
    this._benchmarkDone = false;
  }

  setOnChange(fn) {
    this._onChange = fn;
  }

  detectTier() {
    let tierName = 'high';

    const gl = this._probeGL();
    if (gl) {
      this._gpuName = gl;
      const lower = gl.toLowerCase();

      const isSoftware = lower.includes('swiftshader') || lower.includes('llvmpipe') || lower.includes('software');
      const isIntel = lower.includes('intel');
      const isApple = lower.includes('apple');
      const isAMD = lower.includes('amd') || lower.includes('radeon');
      const isNVIDIA = lower.includes('nvidia') || lower.includes('geforce');

      if (isSoftware) {
        tierName = 'potato';
      } else if (isIntel) {
        tierName = 'low';
        if (lower.includes('uhd graphics 610') || lower.includes('uhd graphics 620') ||
            lower.includes('uhd graphics 630')) tierName = 'low';
        if (lower.includes('iris plus') || lower.includes('iris pro')) tierName = 'medium';
      } else if (isApple) {
        tierName = 'high';
      } else if (isAMD) {
        tierName = 'high';
        if (lower.includes('vega') || lower.includes('rx 6') || lower.includes('rx 5')) tierName = 'ultra';
      } else if (isNVIDIA) {
        tierName = 'ultra';
        if (lower.includes('gtx 10') || lower.includes('rtx') || lower.includes('quadro')) tierName = 'ultra';
      }
    }

    if (this._isMobile) tierName = 'low';

    if (this._cpuCores <= 2) {
      const idx = TIER_ORDER.indexOf(tierName);
      tierName = TIER_ORDER[Math.max(1, idx - 1)];
    } else if (this._cpuCores <= 4 && TIER_ORDER.indexOf(tierName) > 2) {
      tierName = TIER_ORDER[2];
    }

    this.setTier(tierName);
    return tierName;
  }

  _probeGL() {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!ctx) return null;
      const ext = ctx.getExtension('WEBGL_debug_renderer_info');
      let renderer = '';
      if (ext) {
        renderer = ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL);
      }
      if (!renderer) renderer = ctx.getParameter(ctx.RENDERER);
      const lose = ctx.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return renderer || null;
    } catch (e) {
      return null;
    }
  }

  setTier(name) {
    if (!TIERS[name]) return;
    this.tier = name;
    this.settings = { ...TIERS[name] };
    this.adaptiveScale = 1.0;
    this.frameSamples.length = 0;
    this._slowFrames = 0;
    this._fastFrames = 0;
    this._cooldown = 2.0;
    if (this._onChange) this._onChange(this.settings);
  }

  stepDown() {
    const idx = TIER_ORDER.indexOf(this.tier);
    if (idx > 0) {
      this.setTier(TIER_ORDER[idx - 1]);
      return true;
    }
    return false;
  }

  stepUp() {
    const idx = TIER_ORDER.indexOf(this.tier);
    if (idx < TIER_ORDER.length - 1) {
      this.setTier(TIER_ORDER[idx + 1]);
      return true;
    }
    return false;
  }

  setTargetFps(fps) {
    this.targetFps = fps;
  }

  recordFrame(dt) {
    if (dt <= 0 || dt > 1) return;
    this.frameSamples.push(dt);
    if (this.frameSamples.length > this.sampleSize) {
      this.frameSamples.shift();
    }

    let sum = 0;
    for (let i = 0; i < this.frameSamples.length; i++) sum += this.frameSamples[i];
    const avg = sum / this.frameSamples.length;
    this.currentFps = 1 / avg;

    if (!this.enabled) return;
    if (this.frameSamples.length < 8) return;

    this._cooldown -= dt;
    if (this._cooldown > 0) return;

    const targetDt = 1 / this.targetFps;
    const floorDt = 1 / this.minFps;

    if (avg > floorDt) {
      this._slowFrames++;
      this._fastFrames = 0;
    } else if (avg <= targetDt * 0.94) {
      this._fastFrames++;
      this._slowFrames = 0;
    } else {
      this._slowFrames = 0;
      this._fastFrames = 0;
    }

    if (this._slowFrames >= 3) {
      if (this.adaptiveScale > this.minScale) {
        this.adaptiveScale = Math.max(this.minScale, this.adaptiveScale * 0.88);
        this._onScaleChange();
      } else if (this.stepDown()) {
        if (this._onChange) this._onChange(this.settings);
      }
      this._slowFrames = 0;
      this._cooldown = 1.6;
    } else if (this._fastFrames >= 18) {
      if (this.adaptiveScale < this.maxScale) {
        this.adaptiveScale = Math.min(this.maxScale, this.adaptiveScale * 1.1);
        this._onScaleChange();
      }
      this._fastFrames = 0;
      this._cooldown = 2.5;
    }
  }

  _onScaleChange() {
    if (this._onChange) this._onChange(this.settings, this.adaptiveScale);
  }

  getEffectivePixelRatio() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.settings.maxPixelRatio);
    return dpr * this.settings.renderScale * this.adaptiveScale;
  }

  getRenderWidth() {
    return Math.max(320, Math.floor(window.innerWidth * this.getEffectivePixelRatio()));
  }

  getRenderHeight() {
    return Math.max(180, Math.floor(window.innerHeight * this.getEffectivePixelRatio()));
  }

  getStats() {
    return {
      fps: this.currentFps,
      tier: this.tier,
      scale: this.adaptiveScale,
      pixelRatio: this.getEffectivePixelRatio(),
      width: this.getRenderWidth(),
      height: this.getRenderHeight(),
      gpu: this._gpuName,
      cores: this._cpuCores,
    };
  }
}

export { TIERS, TIER_ORDER };
