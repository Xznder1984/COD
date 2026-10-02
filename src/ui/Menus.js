export class Menus {
  constructor(uiOverlay) {
    this.uiOverlay = uiOverlay;
    this.activeMenu = null;

    this.onDeploy = null;
    this.onResume = null;
    this.onRestart = null;

    this._buildStartScreen();
    this._buildPauseScreen();
    this._buildGameOverScreen();
    this._buildWaveTransition();
  }

  _buildStartScreen() {
    this.startScreen = document.createElement('div');
    this.startScreen.id = 'start-screen';
    this.startScreen.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #0a0a0a 100%);
      z-index: 100;
      font-family: 'Rajdhani', 'Segoe UI', Arial, sans-serif;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      position: absolute;
      top: 40px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 12px;
      font-weight: 700;
      color: rgba(255,255,255,0.4);
      letter-spacing: 6px;
      text-transform: uppercase;
    `;
    header.textContent = 'TACTICAL OPERATIONS';

    const title = document.createElement('h1');
    title.style.cssText = `
      font-size: 90px;
      font-weight: 900;
      color: #fff;
      letter-spacing: 14px;
      text-transform: uppercase;
      margin-bottom: 8px;
      text-shadow: 0 0 60px rgba(255,200,0,0.4), 0 4px 8px rgba(0,0,0,0.5);
    `;
    title.textContent = 'OPERATION';

    const subtitle = document.createElement('h2');
    subtitle.style.cssText = `
      font-size: 22px;
      font-weight: 400;
      color: #888;
      letter-spacing: 8px;
      text-transform: uppercase;
      margin-bottom: 60px;
    `;
    subtitle.textContent = 'Urban Assault';

    const deployBtn = document.createElement('button');
    deployBtn.style.cssText = `
      padding: 20px 80px;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: 5px;
      text-transform: uppercase;
      color: #fff;
      background: rgba(255, 200, 0, 0.1);
      border: 2px solid #ffc800;
      cursor: pointer;
      transition: all 0.25s;
      margin-bottom: 50px;
      clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px);
    `;
    deployBtn.textContent = 'DEPLOY';
    deployBtn.onmouseenter = () => { deployBtn.style.background = '#ffc800'; deployBtn.style.color = '#000'; deployBtn.style.transform = 'scale(1.05)'; };
    deployBtn.onmouseleave = () => { deployBtn.style.background = 'rgba(255, 200, 0, 0.1)'; deployBtn.style.color = '#fff'; deployBtn.style.transform = 'scale(1)'; };
    deployBtn.onclick = () => { if (this.onDeploy) this.onDeploy(); };

    const controls = document.createElement('div');
    controls.style.cssText = `
      display: grid;
      grid-template-columns: auto auto;
      gap: 10px 30px;
      font-size: 14px;
      color: rgba(255,255,255,0.5);
      letter-spacing: 2px;
    `;
    const controlItems = [
      ['WASD', 'Move'],
      ['MOUSE', 'Look'],
      ['LMB', 'Fire'],
      ['RMB', 'Aim'],
      ['R', 'Reload'],
      ['SHIFT', 'Sprint'],
      ['SPACE', 'Jump'],
      ['ESC', 'Pause'],
    ];
    for (const [key, action] of controlItems) {
      const keyEl = document.createElement('span');
      keyEl.style.cssText = 'font-weight: 700; color: #ffc800; text-align: right;';
      keyEl.textContent = key;
      const actionEl = document.createElement('span');
      actionEl.textContent = action;
      controls.appendChild(keyEl);
      controls.appendChild(actionEl);
    }

    const footer = document.createElement('div');
    footer.style.cssText = `
      position: absolute;
      bottom: 30px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 11px;
      color: rgba(255,255,255,0.3);
      letter-spacing: 3px;
      text-transform: uppercase;
    `;
    footer.textContent = 'v1.0.0 | BUILD 2026.10.01';

    this.startScreen.appendChild(header);
    this.startScreen.appendChild(title);
    this.startScreen.appendChild(subtitle);
    this.startScreen.appendChild(deployBtn);
    this.startScreen.appendChild(controls);
    this.startScreen.appendChild(footer);
    this.uiOverlay.appendChild(this.startScreen);
  }

  _buildPauseScreen() {
    this.pauseScreen = document.createElement('div');
    this.pauseScreen.id = 'pause-screen';
    this.pauseScreen.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.88);
      backdrop-filter: blur(8px);
      z-index: 90;
      font-family: 'Rajdhani', 'Segoe UI', Arial, sans-serif;
    `;

    const title = document.createElement('h2');
    title.style.cssText = `
      font-size: 48px;
      font-weight: 700;
      color: #fff;
      letter-spacing: 10px;
      text-transform: uppercase;
      margin-bottom: 50px;
    `;
    title.textContent = 'PAUSED';

    const resumeBtn = this._createMenuButton('RESUME', () => { if (this.onResume) this.onResume(); });
    const restartBtn = this._createMenuButton('RESTART', () => { if (this.onRestart) this.onRestart(); });
    const quitBtn = this._createMenuButton('QUIT', () => { this.showStart(); });

    this.pauseScreen.appendChild(title);
    this.pauseScreen.appendChild(resumeBtn);
    this.pauseScreen.appendChild(restartBtn);
    this.pauseScreen.appendChild(quitBtn);
    this.uiOverlay.appendChild(this.pauseScreen);
  }

  _buildGameOverScreen() {
    this.gameOverScreen = document.createElement('div');
    this.gameOverScreen.id = 'game-over-screen';
    this.gameOverScreen.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.92);
      backdrop-filter: blur(8px);
      z-index: 95;
      font-family: 'Rajdhani', 'Segoe UI', Arial, sans-serif;
    `;

    const title = document.createElement('h2');
    title.style.cssText = `
      font-size: 64px;
      font-weight: 900;
      color: #ff3333;
      letter-spacing: 12px;
      text-transform: uppercase;
      margin-bottom: 30px;
      text-shadow: 0 0 40px rgba(255, 51, 51, 0.4);
    `;
    title.textContent = 'K.I.A.';

    this.finalScore = document.createElement('div');
    this.finalScore.style.cssText = `
      font-size: 32px;
      font-weight: 700;
      color: #fff;
      letter-spacing: 4px;
      margin-bottom: 10px;
    `;

    this.finalWaves = document.createElement('div');
    this.finalWaves.style.cssText = `
      font-size: 20px;
      font-weight: 400;
      color: rgba(255,255,255,0.6);
      letter-spacing: 4px;
      margin-bottom: 50px;
    `;

    const restartBtn = this._createMenuButton('REDEPLOY', () => { if (this.onRestart) this.onRestart(); });

    this.gameOverScreen.appendChild(title);
    this.gameOverScreen.appendChild(this.finalScore);
    this.gameOverScreen.appendChild(this.finalWaves);
    this.gameOverScreen.appendChild(restartBtn);
    this.uiOverlay.appendChild(this.gameOverScreen);
  }

  _buildWaveTransition() {
    this.waveTransition = document.createElement('div');
    this.waveTransition.id = 'wave-transition';
    this.waveTransition.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      z-index: 80;
      pointer-events: none;
      font-family: 'Rajdhani', 'Segoe UI', Arial, sans-serif;
      opacity: 0;
      transition: opacity 0.4s ease-in-out;
    `;

    this.waveTransitionText = document.createElement('div');
    this.waveTransitionText.style.cssText = `
      font-size: 56px;
      font-weight: 900;
      color: #ffc800;
      letter-spacing: 12px;
      text-transform: uppercase;
      text-shadow: 0 0 40px rgba(255,200,0,0.6);
    `;

    this.waveTransitionSub = document.createElement('div');
    this.waveTransitionSub.style.cssText = `
      font-size: 20px;
      font-weight: 400;
      color: rgba(255,255,255,0.7);
      letter-spacing: 8px;
      text-transform: uppercase;
      margin-top: 10px;
    `;

    this.waveTransition.appendChild(this.waveTransitionText);
    this.waveTransition.appendChild(this.waveTransitionSub);
    this.uiOverlay.appendChild(this.waveTransition);

    this._waveTransitionTimeout = null;
  }

  _createMenuButton(text, onClick) {
    const btn = document.createElement('button');
    btn.style.cssText = `
      padding: 18px 60px;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 5px;
      text-transform: uppercase;
      color: #fff;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.3);
      cursor: pointer;
      transition: all 0.2s;
      margin: 8px;
      min-width: 260px;
      clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
    `;
    btn.textContent = text;
    btn.onmouseenter = () => { btn.style.borderColor = '#ffc800'; btn.style.color = '#ffc800'; btn.style.background = 'rgba(255, 200, 0, 0.1)'; };
    btn.onmouseleave = () => { btn.style.borderColor = 'rgba(255,255,255,0.3)'; btn.style.color = '#fff'; btn.style.background = 'rgba(255,255,255,0.05)'; };
    btn.onclick = onClick;
    return btn;
  }

  showStart() {
    this.hideAll();
    this.startScreen.style.display = 'flex';
    this.activeMenu = 'start';
  }

  showPause() {
    this.hideAll();
    this.pauseScreen.style.display = 'flex';
    this.activeMenu = 'pause';
  }

  showGameOver(score, waves) {
    this.hideAll();
    this.finalScore.textContent = `KILLS: ${score}`;
    this.finalWaves.textContent = `WAVES SURVIVED: ${waves}`;
    this.gameOverScreen.style.display = 'flex';
    this.activeMenu = 'gameover';
  }

  showWaveTransition(wave) {
    if (this._waveTransitionTimeout) {
      clearTimeout(this._waveTransitionTimeout);
    }

    this.waveTransitionText.textContent = `WAVE ${wave}`;
    this.waveTransitionSub.textContent = 'INCOMING';
    this.waveTransition.style.opacity = '1';

    this._waveTransitionTimeout = setTimeout(() => {
      this.waveTransition.style.opacity = '0';
    }, 2500);
  }

  hideAll() {
    this.startScreen.style.display = 'none';
    this.pauseScreen.style.display = 'none';
    this.gameOverScreen.style.display = 'none';
    this.waveTransition.style.opacity = '0';
    this.activeMenu = null;
  }
}
