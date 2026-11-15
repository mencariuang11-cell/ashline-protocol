// Keyboard and mouse state plus pointer lock. The simulation reads `keys` (a Set of
// KeyboardEvent codes), edge-triggered `pressed` for one-shot actions, and the look
// deltas accumulated since the last frame. Menus opt out by phase, not by input flags.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set();
  let lookX = 0;
  let lookY = 0;
  let firing = false;
  let aiming = false;
  let locked = false;

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    keys.add(event.code);
    pressed.add(event.code);
    if (['Space', 'ControlLeft', 'ControlRight', 'Tab'].includes(event.code)) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => { keys.clear(); firing = false; aiming = false; });

  canvas.addEventListener('mousedown', (event) => {
    if (!locked) return;
    if (event.button === 0) firing = true;
    if (event.button === 2) aiming = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) firing = false;
    if (event.button === 2) aiming = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) { firing = false; aiming = false; }
    onLockChange(locked);
  });
  document.addEventListener('mousemove', (event) => {
    if (!locked) return;
    lookX += event.movementX || 0;
    lookY += event.movementY || 0;
  });

  return {
    keys,
    get locked() { return locked; },
    get firing() { return firing; },
    get aiming() { return aiming; },
    set firing(value) { firing = value; },
    takeLook() {
      const taken = { x: lookX, y: lookY };
      lookX = 0;
      lookY = 0;
      return taken;
    },
    wasPressed(code) {
      return pressed.has(code);
    },
    endFrame() {
      pressed.clear();
    },
    requestLock() {
      try {
        const result = canvas.requestPointerLock({ unadjustedMovement: true });
        if (result && result.catch) result.catch(() => { try { canvas.requestPointerLock(); } catch { /* headless */ } });
      } catch {
        try { canvas.requestPointerLock(); } catch { /* pointer lock unavailable */ }
      }
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
  };
}
