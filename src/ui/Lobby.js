/**
 * Pre-game lobby: pick a callsign, check whether a server is reachable, and choose
 * solo or multiplayer. Also surfaces the browser's own online/offline state, since a
 * localhost game needs no internet at all.
 */

const CSS = `
#lobby {
  position:absolute; inset:0; z-index:120;
  pointer-events:auto;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  background:linear-gradient(150deg,#08090c 0%,#111621 55%,#08090c 100%);
  font-family:'Segoe UI',system-ui,sans-serif; color:#e8ecf2; gap:0;
}
#lobby .card {
  width:min(440px,88vw); border:1px solid #232a38; background:rgba(14,18,26,.82);
  padding:30px 30px 26px; display:flex; flex-direction:column; gap:15px;
}
#lobby h1 { margin:0; font-size:23px; font-weight:800; letter-spacing:5px; text-transform:uppercase; }
#lobby .sub { margin:-10px 0 4px; font-size:11px; letter-spacing:3px; color:#6f7a8c; text-transform:uppercase; }
#lobby label { font-size:10px; letter-spacing:2px; color:#6f7a8c; text-transform:uppercase; }
#lobby input { pointer-events:auto;
  width:100%; box-sizing:border-box; padding:11px 12px; font-size:15px;
  background:#0b0e14; border:1px solid #2a3242; color:#e8ecf2; outline:none;
  letter-spacing:1px;
}
#lobby input:focus { border-color:#ffc800; }
#lobby .row { display:flex; gap:9px; }
#lobby button { pointer-events:auto;
  flex:1; padding:12px 10px; font-size:12px; font-weight:700; letter-spacing:2px;
  text-transform:uppercase; background:#111722; color:#cfd7e3;
  border:1px solid #2a3242; cursor:pointer; transition:background .15s,color .15s,border-color .15s;
}
#lobby button:hover:not(:disabled) { border-color:#ffc800; color:#ffc800; }
#lobby button:disabled { opacity:.45; cursor:not-allowed; }
#lobby button.primary { background:#ffc800; color:#08090c; border-color:#ffc800; }
#lobby button.primary:hover:not(:disabled) { background:#ffd84d; color:#08090c; }
#lobby .status { font-size:11px; letter-spacing:1.5px; color:#6f7a8c; display:flex; gap:8px; align-items:center; }
#lobby .dot { width:7px; height:7px; border-radius:50%; background:#3c4657; flex:none; }
#lobby .dot.on { background:#57d17a; box-shadow:0 0 7px #57d17a; }
#lobby .dot.off { background:#e0564a; }
#lobby .dot.warn { background:#e0b44a; }
#lobby .hint { font-size:10px; line-height:1.7; color:#58616f; letter-spacing:.6px; }
#lobby .hint b { color:#8b95a5; font-weight:600; }
#lobby .err { font-size:11px; color:#e0564a; letter-spacing:1px; min-height:14px; }
#quality-row { display:flex; gap:5px; align-items:center; font-size:10px; letter-spacing:2px; color:#6f7a8c; text-transform:uppercase; }
#quality-row button { padding:6px 9px; font-size:10px; letter-spacing:1px; }
#quality-row button.active { background:#ffc800; color:#08090c; border-color:#ffc800; }
`;

export class Lobby {
  constructor(uiOverlay) {
    this.overlay = uiOverlay;
    this.visible = false;
    this.onSolo = null;
    this.onJoin = null;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'lobby';
    el.innerHTML = `
      <div class="card">
        <h1>Operation</h1>
        <div class="sub">Urban Assault</div>
        <label for="callsign">Callsign</label>
        <input id="callsign" maxlength="16" autocomplete="off" spellcheck="false" />
        <div class="row">
          <button id="btn-solo" class="primary">Play Solo</button>
          <button id="btn-join">Join Server</button>
        </div>
        <div class="status"><span class="dot" id="net-dot"></span><span id="net-text">checking network</span></div>
        <div class="err" id="net-err"></div>
        <div id="quality-row">
          <span>Quality</span>
          <button data-tier="potato">Potato</button>
          <button data-tier="low">Low</button>
          <button data-tier="medium">Med</button>
          <button data-tier="high">High</button>
          <button data-tier="ultra">Ultra</button>
        </div>
        <div class="hint">
          <b>WASD</b> move &nbsp; <b>Mouse</b> look &nbsp; <b>LMB</b> fire &nbsp; <b>RMB</b> aim &nbsp; <b>R</b> reload<br>
          <b>1-4</b> weapons &nbsp; <b>Shift</b> sprint &nbsp; <b>Ctrl</b> crouch &nbsp; <b>Space</b> jump &nbsp; <b>P</b> quality
        </div>
      </div>`;
    this.el = el;
    uiOverlay.appendChild(el);

    this.input = el.querySelector('#callsign');
    this.btnSolo = el.querySelector('#btn-solo');
    this.btnJoin = el.querySelector('#btn-join');
    this.dot = el.querySelector('#net-dot');
    this.text = el.querySelector('#net-text');
    this.err = el.querySelector('#net-err');

    const saved = (() => { try { return localStorage.getItem('callsign') || ''; } catch (e) { return ''; } })();
    this.input.value = saved || 'Operator';

    this.btnSolo.onclick = () => { this._remember(); if (this.onSolo) this.onSolo(); };
    this.btnJoin.onclick = () => { this._remember(); if (this.onJoin) this.onJoin(this.input.value.trim() || 'Operator'); };
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.btnJoin.click();
      e.stopPropagation();
    });

    this.hide();
  }

  _remember() {
    try { localStorage.setItem('callsign', this.input.value); } catch (e) {}
  }

  show() {
    this.el.style.display = 'flex';
    this.visible = true;
    this.setBusy(false);
    this.err.textContent = '';
    setTimeout(() => this.input.focus(), 50);
  }

  hide() {
    this.el.style.display = 'none';
    this.visible = false;
  }

  setBusy(busy) {
    this.btnJoin.disabled = busy;
    this.btnJoin.textContent = busy ? 'Connecting' : 'Join Server';
  }

  setError(msg) {
    this.err.textContent = msg || '';
  }

  /** Update the connectivity indicator. */
  setNetwork(state, detail) {
    this.dot.className = 'dot ' + (state === 'online' ? 'on' : state === 'local' ? 'warn' : 'off');
    this.text.textContent = detail || state;
  }
}

/**
 * Decide whether this machine can reach the internet. A game served from localhost
 * does not need it, so the lobby says so rather than implying something is broken.
 */
export function describeConnectivity() {
  const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  const host = typeof location !== 'undefined' ? location.hostname : '';
  const isLocal = host === '' || host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!online) {
    return { online: false, isLocal, state: 'offline', detail: 'offline — multiplayer unavailable, solo works' };
  }
  if (isLocal) {
    return { online: true, isLocal, state: 'local', detail: 'no internet needed — running on localhost' };
  }
  return { online: true, isLocal: false, state: 'online', detail: 'online' };
}