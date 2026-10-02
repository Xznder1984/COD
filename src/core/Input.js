export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = {};
    this._justPressed = new Set();
    this.mouse = { x: 0, y: 0, dx: 0, dy: 0, buttons: [false, false, false] };
    this._mouseJustPressed = [false, false, false];
    this.isPointerLocked = false;
    this.sensitivity = 0.0022;
    this.sensitivityScale = 1.0;
    this.invertY = false;

    this._onKeyDown = (e) => {
      if (!this.keys[e.code]) this._justPressed.add(e.code);
      this.keys[e.code] = true;
      if (e.code === 'Tab') e.preventDefault();
    };
    this._onKeyUp = (e) => { this.keys[e.code] = false; };
    this._onMouseMove = (e) => {
      if (!this.isPointerLocked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    };
    this._onMouseDown = (e) => {
      if (!this.mouse.buttons[e.button]) this._mouseJustPressed[e.button] = true;
      this.mouse.buttons[e.button] = true;
    };
    this._onMouseUp = (e) => { this.mouse.buttons[e.button] = false; };
    this._onPointerLockChange = () => {
      this.isPointerLocked = document.pointerLockElement === this.canvas;
    };

    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
  }

  requestPointerLock() {
    this.canvas.requestPointerLock();
  }

  exitPointerLock() {
    document.exitPointerLock();
  }

  isKeyDown(code) { return !!this.keys[code]; }
  isMouseDown(button = 0) { return this.mouse.buttons[button]; }

  wasPressed(code) { return this._justPressed.has(code); }
  wasMousePressed(button = 0) { return this._mouseJustPressed[button]; }

  setSensitivityScale(scale) {
    this.sensitivityScale = Math.max(0.05, Math.min(20, Number(scale) || 1));
  }

  consumeMouseDelta() {
    const s = this.sensitivity * this.sensitivityScale;
    const dx = this.mouse.dx * s;
    const dy = this.mouse.dy * s * (this.invertY ? -1 : 1);
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    return { dx, dy };
  }

  resetFrame() {
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this._justPressed.clear();
    this._mouseJustPressed[0] = false;
    this._mouseJustPressed[1] = false;
    this._mouseJustPressed[2] = false;
  }
}
