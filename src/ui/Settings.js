/**
 * Settings panel.
 *
 * Opens over the pause menu (Esc) and from the gear in the HUD. Every control writes
 * straight through to the live system, and the whole set persists to localStorage so
 * it survives a reload. Sensible defaults mean it is also usable with no settings file.
 */

const KEY = 'cua.settings.v1';

export const DEFAULTS = {
  sensitivity: 1.0,
  invertY: false,
  fov: 78,
  quality: 'auto',
  renderScale: 1.0,
  adaptive: true,
  masterVolume: 0.5,
  showStats: true,
};

const CSS = `
#settings {
  position:absolute; inset:0; z-index:130; pointer-events:auto;
  display:none; align-items:center; justify-content:center;
  background:rgba(4,6,10,.82); backdrop-filter:blur(3px);
  font-family:'Segoe UI',system-ui,sans-serif; color:#e8ecf2;
}
#settings.open { display:flex; }
#settings .panel {
  width:min(520px,92vw); max-height:88vh; overflow-y:auto;
  background:#0c1017; border:1px solid #222a38; padding:22px 24px 20px;
}
#settings h2 {
  margin:0 0 4px; font-size:15px; font-weight:800; letter-spacing:4px; text-transform:uppercase;
}
#settings .sub { font-size:10px; letter-spacing:2px; color:#6f7a8c; text-transform:uppercase; margin-bottom:18px; }
#settings .group { margin-bottom:18px; }
#settings .group > .label {
  font-size:10px; letter-spacing:2px; color:#6f7a8c; text-transform:uppercase;
  border-bottom:1px solid #1a212c; padding-bottom:6px; margin-bottom:12px;
}
#settings .row {
  display:flex; align-items:center; justify-content:space-between;
  gap:14px; padding:7px 0;
}
#settings .row .name { font-size:13px; color:#cfd7e3; flex:1; }
#settings .row .name small { display:block; font-size:10px; color:#6b7686; margin-top:2px; letter-spacing:.4px; }
#settings .row output {
  font:12px ui-monospace,Menlo,monospace; color:#ffc800;
  min-width:56px; text-align:right; flex:none;
}
#settings input[type=range] {
  width:190px; flex:none; -webkit-appearance:none; appearance:none;
  height:3px; background:#232b38; outline:none; cursor:pointer;
}
#settings input[type=range]::-webkit-slider-thumb {
  -webkit-appearance:none; appearance:none; width:13px; height:13px;
  background:#ffc800; cursor:pointer; border-radius:50%;
}
#settings input[type=range]::-moz-range-thumb {
  width:13px; height:13px; background:#ffc800; cursor:pointer; border:0; border-radius:50%;
}
#settings select {
  background:#0b0e14; border:1px solid #2a3242; color:#e8ecf2;
  padding:6px 9px; font-size:12px; outline:none; cursor:pointer; min-width:130px;
}
#settings select:focus { border-color:#ffc800; }
#settings .toggle {
  width:42px; height:22px; background:#232b38; border:1px solid #2a3242;
  position:relative; cursor:pointer; flex:none; transition:background .15s;
}
#settings .toggle::after {
  content:''; position:absolute; top:2px; left:2px; width:16px; height:16px;
  background:#6b7686; transition:transform .15s, background .15s;
}
#settings .toggle.on { background:#3a3212; border-color:#ffc800; }
#settings .toggle.on::after { transform:translateX(20px); background:#ffc800; }
#settings .actions { display:flex; gap:9px; margin-top:4px; }
#settings .actions button {
  flex:1; padding:11px; font-size:11px; font-weight:700; letter-spacing:2px;
  text-transform:uppercase; background:#111722; color:#cfd7e3;
  border:1px solid #2a3242; cursor:pointer;
}
#settings .actions button:hover { border-color:#ffc800; color:#ffc800; }
#settings .actions button.primary { background:#ffc800; color:#08090c; border-color:#ffc800; }
#settings .note { font-size:10px; color:#5d6775; line-height:1.6; margin-top:12px; letter-spacing:.3px; }
`;

export class Settings {
  constructor(uiOverlay) {
    this.uiOverlay = uiOverlay;
    this.open = false;
    this.values = { ...DEFAULTS, ...this._load() };
    this.onChange = null;
    this.onClose = null;
    this.onOpen = null;
    this._rows = {};

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'settings';
    el.innerHTML = `
      <div class="panel">
        <h2>Settings</h2>
        <div class="sub">Operation: Urban Assault</div>

        <div class="group">
          <div class="label">Controls</div>
          <div class="row">
            <div class="name">Mouse sensitivity<small>Scales your look speed</small></div>
            <input type="range" id="s-sens" min="0.1" max="5" step="0.05" />
            <output id="o-sens"></output>
          </div>
          <div class="row">
            <div class="name">Invert vertical</div>
            <div class="toggle" id="s-invert"></div>
          </div>
        </div>

        <div class="group">
          <div class="label">Graphics</div>
          <div class="row">
            <div class="name">Quality preset<small>Higher tiers add detail and effects</small></div>
            <select id="s-quality">
              <option value="auto">Auto</option>
              <option value="potato">Potato</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="ultra">Ultra</option>
            </select>
          </div>
          <div class="row">
            <div class="name">Render scale<small>Internal resolution multiplier</small></div>
            <input type="range" id="s-scale" min="0.5" max="1" step="0.05" />
            <output id="o-scale"></output>
          </div>
          <div class="row">
            <div class="name">Adaptive resolution<small>Drop resolution to hold framerate</small></div>
            <div class="toggle" id="s-adaptive"></div>
          </div>
          <div class="row">
            <div class="name">Field of view</div>
            <input type="range" id="s-fov" min="60" max="110" step="1" />
            <output id="o-fov"></output>
          </div>
          <div class="row">
            <div class="name">Show performance stats</div>
            <div class="toggle" id="s-stats"></div>
          </div>
        </div>

        <div class="group">
          <div class="label">Audio</div>
          <div class="row">
            <div class="name">Master volume</div>
            <input type="range" id="s-vol" min="0" max="1" step="0.05" />
            <output id="o-vol"></output>
          </div>
        </div>

        <div class="actions">
          <button id="s-reset">Reset Defaults</button>
          <button id="s-close" class="primary">Close</button>
        </div>
        <div class="note">Settings save automatically. Press Esc to return to the game.</div>
      </div>`;
    this.el = el;
    uiOverlay.appendChild(el);

    this._bindRange('sens', 'sensitivity', 2);
    this._bindRange('scale', 'renderScale', 2, (v) => {
      this.perfEnabled = this.values.adaptive;
      return v;
    });
    this._bindRange('fov', 'fov', 0);
    this._bindRange('vol', 'masterVolume', 2);
    this._bindToggle('invert', 'invertY');
    this._bindToggle('adaptive', 'adaptive');
    this._bindToggle('stats', 'showStats');

    const q = el.querySelector('#s-quality');
    q.onchange = () => { this.values.quality = q.value; this._emit(); this._save(); };
    this._quality = q;

    el.querySelector('#s-close').onclick = () => this._dismiss();
    el.querySelector('#s-reset').onclick = () => this.reset();
    el.addEventListener('click', (e) => { if (e.target === el) this._dismiss(); });

    this._render();
  }

  _bindRange(name, key, digits, transform) {
    const input = this.el.querySelector(`#s-${name}`);
    const out = this.el.querySelector(`#o-${name}`);
    this._rows[key] = { input, out, digits, transform };
    input.oninput = () => {
      let v = parseFloat(input.value);
      if (transform) v = transform(v);
      this.values[key] = v;
      this._emit();
      this._save();
    };
  }

  _bindToggle(name, key) {
    const el = this.el.querySelector(`#s-${name}`);
    el.onclick = () => {
      this.values[key] = !this.values[key];
      this._emit();
      this._save();
      this._render();
    };
    this._rows[key] = { toggle: el };
  }

  _render() {
    for (const [key, row] of Object.entries(this._rows)) {
      const v = this.values[key];
      if (row.input) {
        row.input.value = String(v);
        row.out.textContent = key === 'fov' ? `${v}°` : `${Number(v).toFixed(row.digits)}`;
      }
      if (row.toggle) row.toggle.classList.toggle('on', !!v);
    }
    this._quality.value = this.values.quality;
  }

  _emit() {
    if (this.onChange) this.onChange(this.values);
  }

  _save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.values)); } catch (e) {}
  }

  _load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  reset() {
    this.values = { ...DEFAULTS };
    this._render();
    this._emit();
    this._save();
  }

  /** Apply the stored settings to the live systems. */
  apply(systems) {
    const v = this.values;
    const { input, perf, engine, audio, overlay, lobby } = systems;

    if (input) {
      input.setSensitivityScale(v.sensitivity);
      input.invertY = !!v.invertY;
    }
    if (perf) {
      if (v.quality === 'auto') {
        perf.enabled = true;
      } else {
        perf.enabled = false;
        perf.setTier(v.quality);
      }
      perf.adaptive = !!v.adaptive;
      if (typeof perf.setRenderScale === 'function') perf.setRenderScale(v.renderScale);
    }
    if (engine && typeof engine.setFov === 'function') engine.setFov(v.fov);
    if (audio && audio.masterGain) audio.masterGain.gain.value = v.masterVolume;
    if (overlay) overlay.style.display = v.showStats ? '' : 'none';
    if (lobby) lobby.setNetwork(lobby._lastState || 'local', lobby._lastText || '');
    this._render();
  }

  show() {
    this._render();
    this.el.classList.add('open');
    this.open = true;
    if (this.onOpen) this.onOpen();
  }

  /** Hide and let the game know, so it can resume from whichever path was used. */
  _dismiss() {
    if (!this.open) return;
    this.hide();
    if (this.onClose) this.onClose();
  }

  hide() {
    this.el.classList.remove('open');
    this.open = false;
  }

  toggle() {
    if (this.open) this._dismiss();
    else this.show();
  }
}
