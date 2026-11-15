// ASHLINE PROTOCOL — boot and the one loop. A fixed 60 Hz simulation (player, bots,
// rounds, grenades) feeds rendering at display rate. Everything the player does —
// firing, reloading, buying, throwing, planting — is wired here from input edges to
// the modules that own it. ?shot=<name>&seed=<n> stages a deterministic frame for
// screenshots and sets window.__shotReady, exactly like the kit's starter does.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { buildMap, SITE } from './map.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createState, PHASE } from './state.js';
import { createPlayer } from './player.js';
import { createLoadout, SHOP_ORDER } from './weapons.js';
import { createSquad } from './bots.js';
import { createEffects } from './effects.js';
import { createHud } from './hud.js';
import { createRounds } from './rounds.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed * 7919 + 13);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 26, 78);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const audio = createAudio();
const map = buildMap(scene);
const effects = createEffects(scene, map.colliders);
const state = createState();
const player = createPlayer(map.colliders);
const loadout = createLoadout(camera, audio);
const squad = createSquad(scene, map);

let playing = false;
let started = false;
let deadAt = -99;

const hud = createHud({
  state,
  loadout,
  colliders: map.colliders,
  onBuy(id) {
    if (state.phase !== PHASE.BUY) return;
    if (loadout.buy(state, id)) { audio.buy(); hud.refreshBuy(); }
    else audio.denied();
  },
  onPlay() {
    audio.unlock();
    if (state.phase === PHASE.MATCH_END) rounds.startMatch();
    started = true;
    hud.hideMenu();
    input.requestLock();
  },
});

const camDir = new THREE.Vector3(0, 0, -1);
const rounds = createRounds({
  scene, map, state, player, loadout, squad, effects, audio, hud,
  getPlayerDir: () => camDir,
});
const input = createInput(renderer.domElement, (locked) => {
  if (shot) return;
  if (locked) {
    playing = true;
    started = true;
    rounds.setUiActive(true);
    hud.hideMenu();
  } else {
    playing = false;
    if (started && state.phase !== PHASE.MATCH_END) hud.showMenu('paused');
    if (state.phase === PHASE.MATCH_END) hud.showMenu('match-end', state.stats);
  }
});

const EMPTY_KEYS = new Set();
const eyePos = new THREE.Vector3();
const aimDir = new THREE.Vector3();
const shakeVec = new THREE.Vector3();
let grenadeCooldown = 0;
let fovCurrent = 74;

function syncCamera() {
  const body = player.body;
  if (!body.alive && state.time - deadAt > 0.9 && (state.phase === PHASE.LIVE || state.phase === PHASE.PLANTED)) {
    // spectate the first living teammate
    const mate = squad.bots.find((b) => b.alive && b.team === 'breakers');
    if (mate) {
      camera.position.set(mate.position.x + Math.sin(mate.yaw) * 4.5, 4.6, mate.position.z + Math.cos(mate.yaw) * 4.5);
      camera.lookAt(mate.position.x - Math.sin(mate.yaw) * 6, 1.2, mate.position.z - Math.cos(mate.yaw) * 6);
      camera.getWorldDirection(camDir);
      return;
    }
  }
  effects.shakeOffset(shakeVec, state.time);
  camera.position.set(body.position.x + shakeVec.x, body.position.y + body.eye + shakeVec.y, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  camera.getWorldDirection(camDir);
}

function playerShoot() {
  const def = loadout.def();
  const body = player.body;
  eyePos.set(body.position.x, body.position.y + body.eye, body.position.z);
  aimDir.copy(camDir);
  const spread = loadout.spread(player.groundSpeed(), body.crouching, !body.onGround);
  const result = rounds.combat.playerFire(rounds.playerProxy, eyePos, aimDir, def, spread, random);
  state.stats.shots += def.pellets;
  audio.shot(def.sound);
  if (result && result.victim) {
    state.stats.hits += 1;
    hud.hitmarker(result.killed);
    audio.hit(result.head);
  }
  player.recoil(def.kick + random() * 0.004, (random() * 2 - 1) * 0.0035);
  if (!def.auto) input.firing = false;
}

function throwSelected() {
  const type = state.grenadeSel;
  if (loadout.grenades[type] <= 0 || grenadeCooldown > 0) return;
  loadout.grenades[type] -= 1;
  grenadeCooldown = 0.55;
  const body = player.body;
  eyePos.set(body.position.x, body.position.y + body.eye, body.position.z);
  aimDir.copy(camDir);
  aimDir.y += 0.12;
  aimDir.normalize();
  effects.throwGrenade(type, eyePos.addScaledVector(camDir, 0.5), aimDir, rounds.playerProxy);
  audio.throwWhoosh();
}

function frameActions() {
  if (!playing || hud.menuVisible()) return;
  if (input.wasPressed('KeyR')) loadout.startReload();
  if (state.phase !== PHASE.BUY && input.wasPressed('Digit1') && loadout.primary) loadout.switchTo(loadout.primary);
  if (state.phase !== PHASE.BUY && input.wasPressed('Digit2')) loadout.switchTo('sidearm');
  if (input.wasPressed('KeyQ')) {
    const order = ['shard', 'flare', 'veil'];
    const next = order[(order.indexOf(state.grenadeSel) + 1) % order.length];
    state.grenadeSel = next;
  }
  if (input.wasPressed('KeyG')) throwSelected();
  if (state.phase === PHASE.BUY) {
    if (input.wasPressed('KeyB')) hud.showBuy(!hud.buyVisible);
    for (let i = 0; i < SHOP_ORDER.length; i += 1) {
      if (hud.buyVisible && input.wasPressed(`Digit${i + 1}`)) buyById(SHOP_ORDER[i]);
    }
  }
}
function buyById(id) {
  if (loadout.buy(state, id)) { audio.buy(); hud.refreshBuy(); }
  else audio.denied();
}

function step(dt) {
  grenadeCooldown = Math.max(0, grenadeCooldown - dt);
  const phase = state.phase;
  const canAct = playing && !hud.menuVisible() && player.body.alive &&
    (phase === PHASE.LIVE || phase === PHASE.PLANTED);
  rounds.update(dt, canAct || phase === PHASE.BUY ? input.keys : EMPTY_KEYS);
  const moveKeys = playing && !hud.menuVisible() && player.body.alive && phase !== PHASE.BUY && phase !== PHASE.MATCH_END
    ? input.keys : EMPTY_KEYS;
  const weaponSpeed = { sidearm: 1, scatter: 0.96, smg: 0.98, carbine: 0.95, longbow: 0.9 }[loadout.current] || 1;
  player.step(dt, moveKeys, weaponSpeed);
  if (player.body.stepDistance > 2.6 && player.body.alive) {
    player.body.stepDistance = 0;
    if (playing) audio.step();
  }
  if (!player.body.alive && deadAt < 0) deadAt = state.time;
  if (player.body.alive) deadAt = -99;
  syncCamera();
  if (canAct && input.firing && loadout.tryFire()) playerShoot();
  if (canAct && loadout.ammoState().mag === 0) loadout.startReload();
  loadout.step(dt, player.groundSpeed(), input.firing);
  // zoom: the Longbow's scope trades field of view for precision
  const wantFov = input.aiming && loadout.def().zoom ? loadout.def().zoom : 74;
  fovCurrent += (wantFov - fovCurrent) * Math.min(1, dt * 11);
  if (Math.abs(fovCurrent - camera.fov) > 0.05) {
    camera.fov = fovCurrent;
    camera.updateProjectionMatrix();
  }
  hud.setScope(input.aiming && loadout.def().zoom > 0 && fovCurrent < 45);
  effects.update(dt);
  map.update(dt);
}

let accumulator = 0;
let lastTime = performance.now();
let frozen = false;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    if (playing && !hud.menuVisible()) {
      const look = input.takeLook();
      const sens = loadout.def().zoom && input.aiming ? 0.45 : 1;
      player.look(look.x * sens, look.y * sens);
    }
    frameActions();
    input.endFrame();
    if (playing && !hud.menuVisible()) {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= FIXED_STEP && steps < 5) {
        step(FIXED_STEP);
        accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (accumulator > FIXED_STEP * 5) accumulator = 0;
    } else {
      syncCamera();
    }
    hud.update(player.body, rounds.combatants);
  }
  renderer.render(scene, camera);
}

// ---------- screenshot staging ----------
function stageShot(name) {
  started = true;
  playing = false;
  rounds.setUiActive(false);
  hud.hideMenu();
  hud.showBuy(false);
  state.round = 8;
  state.score.breakers = 4;
  state.score.wardens = 3;
  state.playerMoney = 2350;
  const body = player.body;
  const bots = squad.bots;
  const place = (bot, x, z, yaw) => {
    bot.position.set(x, 0, z);
    bot.yaw = yaw;
    bot.mesh.position.copy(bot.position);
    bot.mesh.rotation.y = yaw;
  };
  loadout.owned.add('carbine');
  loadout.primary = 'carbine';
  loadout.switchTo('carbine');
  if (name === 'buy') {
    state.phase = PHASE.BUY;
    state.phaseTime = 9;
    state.playerMoney = 4350;
    loadout.armor = 1;
    loadout.grenades.shard = 1;
    body.position.set(0, 0, 24.8);
    body.yaw = 0;
    place(bots[3], -3.4, 24.5, 0.4);
    place(bots[1], 3.6, 25, -0.3);
    hud.showBuy(true);
  } else if (name === 'site') {
    state.phase = PHASE.PLANTED;
    state.phaseTime = 12.4;
    state.spike.planted = true;
    state.spike.position = new THREE.Vector3(3.1, 0, -16.8);
    effects.setSpikeMode('planted', state.spike.position);
    body.position.set(7.6, 0, -11.6);
    body.yaw = 0.62;
    body.pitch = -0.03;
    body.hp = 84;
    place(bots[4], 3.3, -15.6, 2.6);          // a Warden on the defuse
    place(bots[0], 8.6, -19.5, -1.2);         // teammate covering the pad
    place(bots[6], -6.5, -13.5, 1.9);         // Warden pushing the west lane
    effects.burst(new THREE.Vector3(3.1, 0.6, -16.8), PALETTE.warden, 6, 1.2, 0.5, 3);
  } else if (name === 'duel') {
    state.phase = PHASE.LIVE;
    state.phaseTime = 41;
    body.position.set(-20, 0, 9);
    body.yaw = 0.06;
    body.hp = 58;
    place(bots[7], -19.2, -7.5, Math.PI - 0.15);
    place(bots[2], -16.5, 12, 0.2);
    effects.addSmoke(new THREE.Vector3(-20, 0, -1));
    for (let i = 0; i < 26; i += 1) effects.update(FIXED_STEP);
    const foe = bots[7];
    foe.target = rounds.playerProxy;
    rounds.combat.botFire(foe, rounds.playerProxy, 16);
    body.hp = 58;
  } else {
    // cover: a mid-lane firefight over the furnace
    state.phase = PHASE.LIVE;
    state.phaseTime = 47;
    body.position.set(-5.5, 0, 9.0);
    body.yaw = -0.08;
    body.hp = 72;
    place(bots[8], -4.4, -4.0, Math.PI + 0.1);
    place(bots[1], -8.6, 11.5, 0.2);
    place(bots[5], 5.5, -3, Math.PI - 0.4);
    eyePos.set(body.position.x, body.position.y + body.eye, body.position.z);
    syncCamera();
    aimDir.copy(camDir);
    rounds.combat.playerFire(rounds.playerProxy, eyePos, aimDir, loadout.def(), 0.001, random);
    hud.hitmarker(false);
    body.hp = 72;
  }
  effects.update(0.001);   // settle tracer opacity and flashes for the frozen frame
  hud.banner('', '', 0);   // clear the boot banner so the staged frame is clean
  hud.update(body, rounds.combatants);
  let painted = 0;
  const paint = () => {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 3) {
      window.__shotReady = true;
      frozen = true;
    }
  };
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

rounds.startMatch();
rounds.setUiActive(false);
hud.showBuy(false);
hud.showMenu('start');
syncCamera();
if (shot) stageShot(shot);
else requestAnimationFrame(frame);
