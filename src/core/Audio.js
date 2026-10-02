export class Audio {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.initialized = false;
    this.listener = { position: null, forward: null, up: null };
  }

  init() {
    if (this.initialized) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) {
        this.unavailable = true;
        return;
      }
      this.ctx = new Ctx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.5;
      this.masterGain.connect(this.ctx.destination);
      this.initialized = true;
    } catch (e) {
      this.unavailable = true;
      this.initialized = false;
    }
  }

  resume() {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  updateListener(position, forward, up) {
    if (!this.initialized) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = position.x;
      l.positionY.value = position.y;
      l.positionZ.value = position.z;
      l.forwardX.value = forward.x;
      l.forwardY.value = forward.y;
      l.forwardZ.value = forward.z;
      l.upX.value = up.x;
      l.upY.value = up.y;
      l.upZ.value = up.z;
    } else {
      l.setPosition(position.x, position.y, position.z);
      l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  playSound(buffer, { volume = 1, pitch = 1, position = null, refDistance = 5, maxDistance = 100 } = {}) {
    if (!this.initialized || !buffer) return;
    try {
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = pitch;

      const gainNode = this.ctx.createGain();
      gainNode.gain.value = volume;

      if (position) {
        const panner = this.ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = refDistance;
        panner.maxDistance = maxDistance;
        panner.rolloffFactor = 1;
        panner.positionX.value = position.x;
        panner.positionY.value = position.y;
        panner.positionZ.value = position.z;
        source.connect(gainNode);
        gainNode.connect(panner);
        panner.connect(this.masterGain);
      } else {
        source.connect(gainNode);
        gainNode.connect(this.masterGain);
      }
      source.start();
    } catch (e) {
    }
  }

  generateNoise(duration = 1, volume = 0.5) {
    if (!this.initialized) return null;
    try {
      const sampleRate = this.ctx.sampleRate;
      const length = Math.max(1, Math.floor(sampleRate * duration));
      const buffer = this.ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * volume;
      }
      return buffer;
    } catch (e) {
      return null;
    }
  }

  generateTone(freq, duration, type = 'sine', volume = 0.3) {
    if (!this.initialized) return null;
    try {
      const sampleRate = this.ctx.sampleRate;
      const length = Math.max(1, Math.floor(sampleRate * duration));
      const buffer = this.ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        let val;
        switch (type) {
          case 'square': val = Math.sign(Math.sin(2 * Math.PI * freq * t)); break;
          case 'sawtooth': val = 2 * (freq * t - Math.floor(freq * t + 0.5)); break;
          case 'triangle': val = 2 * Math.abs(2 * (freq * t - Math.floor(freq * t + 0.5))) - 1; break;
          default: val = Math.sin(2 * Math.PI * freq * t);
        }
        const envelope = Math.exp(-3 * t / duration);
        data[i] = val * envelope * volume;
      }
      return buffer;
    } catch (e) {
      return null;
    }
  }
}
