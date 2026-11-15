// Weapons and the buy catalog. Five original guns and three grenades, one sidearm you
// always carry and one primary slot. Accuracy is the heart of it: spread is smallest
// standing still and crouched, grows while moving or airborne, and blooms with each
// shot before it settles — so the game rewards stopping, aiming and firing in bursts.
// Roster (full derived table below): P9 Sidearm (free) · Mule Scattergun ($1,100) ·
// Raptor-9 SMG ($1,400) · VK-7 Carbine ($2,700) · Longbow DMR ($4,200, scoped).
// Armour: Kevlar Vest $650, Vest + Helmet $1,000. Grenades: Shard $300,
// Flare $200, Veil $300.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  sidearm: { id: 'sidearm', name: 'P9 Sidearm', slot: 'sidearm', price: 0, damage: 26, headMult: 3.2, rpm: 360, mag: 12, reserve: 48, reload: 1.3, spreadStill: 0.006, spreadMove: 0.030, falloffFrom: 18, falloffTo: 46, pellets: 1, auto: false, kick: 0.010, sound: 'pistol', zoom: 0 },
  scatter: { id: 'scatter', name: 'Mule Scattergun', slot: 'primary', price: 1100, damage: 9, headMult: 2.0, rpm: 66, mag: 6, reserve: 24, reload: 2.6, spreadStill: 0.045, spreadMove: 0.060, falloffFrom: 6, falloffTo: 20, pellets: 8, auto: false, kick: 0.034, sound: 'shotgun', zoom: 0 },
  smg: { id: 'smg', name: 'Raptor-9 SMG', slot: 'primary', price: 1400, damage: 22, headMult: 2.6, rpm: 750, mag: 32, reserve: 96, reload: 1.9, spreadStill: 0.011, spreadMove: 0.034, falloffFrom: 14, falloffTo: 40, pellets: 1, auto: true, kick: 0.008, sound: 'smg', zoom: 0 },
  carbine: { id: 'carbine', name: 'VK-7 Carbine', slot: 'primary', price: 2700, damage: 33, headMult: 3.4, rpm: 620, mag: 30, reserve: 90, reload: 2.1, spreadStill: 0.0035, spreadMove: 0.026, falloffFrom: 26, falloffTo: 70, pellets: 1, auto: true, kick: 0.013, sound: 'rifle', zoom: 0 },
  longbow: { id: 'longbow', name: 'Longbow DMR', slot: 'primary', price: 4200, damage: 88, headMult: 2.2, rpm: 46, mag: 5, reserve: 20, reload: 2.8, spreadStill: 0.0006, spreadMove: 0.05, falloffFrom: 40, falloffTo: 110, pellets: 1, auto: false, kick: 0.045, sound: 'sniper', zoom: 26 },
};
//
// WEAPON TABLE, derived from the rows above (DPS = damage x pellets x rpm / 60 at
// point-blank, before falloff; TTK vs 100 HP, first shot at t = 0; "vs vest"
// applies the armor body multiplier 0.55 from combat.js):
//   weapon          price   dmg    head   rpm   mag+res   falloff    DPS     body STK/TTK      vs vest STK/TTK
//   P9 Sidearm      $0      26     x3.2   360   12+48     18-46 m    156.0   4 / 0.50 s        7 / 1.00 s
//   Mule Scattergun $1,100  9 x8   x2.0   66    6+24      6-20 m     79.2*   2 shells / 0.91 s 3 shells / 1.82 s
//   Raptor-9 SMG    $1,400  22     x2.6   750   32+96     14-40 m    275.0   5 / 0.32 s        9 / 0.64 s
//   VK-7 Carbine    $2,700  33     x3.4   620   30+90     26-70 m    341.0   4 / 0.29 s        6 / 0.48 s
//   Longbow DMR     $4,200  88     x2.2   46    5+20      40-110 m   67.5    2 / 1.30 s        3 / 2.61 s
//   * scattergun DPS counts all 8 pellets landing: 72 per shell to the body,
//   144 to the head. Point-blank headshots: sidearm 83.2, SMG 57.2, carbine
//   112.2 and Longbow 193.6 (both one-shot kills); a helmet halves them
//   (carbine 56.1, Longbow 96.8 — the Longbow still nearly kills). Reloads run
//   1.3 s (sidearm) to 2.8 s (Longbow); a dry weapon is re-issued with its base
//   reserve at round start (newRound below), partial reserves never refill free.
// GRENADE SPECS (effects.js / rounds.js own the numbers): Shard $300, carry 2
//   (frag, 1.7 s fuse, 6.5 m blast, x0.45 through cover); Flare $200, carry 2
//   (1.15 s fuse, blinds bots 2.2-3.8 s); Veil $300, carry 1 (0.9 s fuse,
//   2.6 m smoke sphere, 13 s). Carry cap: 4. Armor: vest $650 = tier 1
//   (body x0.55), vest + helmet $1,000 = tier 2 (+ head x0.5).
export const GRENADES = {
  shard: { id: 'shard', name: 'Shard Grenade', price: 300, cap: 2, blurb: 'Frag: bursts for heavy damage' },
  flare: { id: 'flare', name: 'Flare Grenade', price: 200, cap: 2, blurb: 'Blinds whoever faces the pop' },
  veil: { id: 'veil', name: 'Veil Grenade', price: 300, cap: 1, blurb: 'Smoke wall that breaks sightlines' },
};
export const GEAR = {
  vest: { id: 'vest', name: 'Kevlar Vest', price: 650 },
  vesthelm: { id: 'vesthelm', name: 'Vest + Helmet', price: 1000 },
  // the Spike itself is carried by the player from spawn; no purchase needed
};
export const SHOP_ORDER = ['scatter', 'smg', 'carbine', 'longbow', 'vest', 'vesthelm', 'shard', 'flare', 'veil'];

// A muzzle-flash star: bright core with four tapering spikes, drawn once on a canvas
// and mapped onto the viewmodel's flash plane so a shot reads as a starburst, not a blob.
function flashTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  const core = g.createRadialGradient(64, 64, 2, 64, 64, 30);
  core.addColorStop(0, 'rgba(255,246,220,1)');
  core.addColorStop(0.5, 'rgba(255,180,90,0.75)');
  core.addColorStop(1, 'rgba(255,122,38,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'lighter';
  for (const [w, h] of [[9, 126], [126, 9], [6, 84], [84, 6]]) {
    const spike = g.createRadialGradient(64, 64, 2, 64, 64, 62);
    spike.addColorStop(0, 'rgba(255,220,160,0.9)');
    spike.addColorStop(1, 'rgba(255,140,50,0)');
    g.fillStyle = spike;
    g.fillRect(64 - w / 2, 64 - h / 2, w, h);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildViewModel(def, mats) {
  const group = new THREE.Group();
  const add = (w, h, d, x, y, z, mat = mats.body, rx = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    group.add(mesh);
    return mesh;
  };
  if (def.id === 'sidearm') {
    add(0.055, 0.09, 0.24, 0, 0, -0.08);
    add(0.057, 0.015, 0.1, 0, 0.052, -0.1, mats.accent);
    add(0.05, 0.11, 0.07, 0, -0.09, 0.03, mats.grip, 0.25);
  } else if (def.id === 'scatter') {
    add(0.07, 0.09, 0.62, 0, 0, -0.2);
    add(0.072, 0.015, 0.2, 0, 0.052, -0.25, mats.accent);
    add(0.055, 0.055, 0.34, 0, 0.01, -0.62, mats.dark);
    add(0.075, 0.08, 0.2, 0, -0.045, -0.28, mats.wood);
    add(0.06, 0.1, 0.18, 0, -0.03, 0.22, mats.wood);
  } else if (def.id === 'smg') {
    add(0.065, 0.1, 0.4, 0, 0, -0.12);
    add(0.067, 0.015, 0.16, 0, 0.057, -0.15, mats.accent);
    add(0.04, 0.04, 0.2, 0, 0.015, -0.42, mats.dark);
    add(0.045, 0.17, 0.06, 0, -0.13, -0.05, mats.grip, 0.12);
    add(0.05, 0.09, 0.06, 0, -0.08, 0.12, mats.grip, 0.3);
  } else if (def.id === 'longbow') {
    add(0.06, 0.09, 0.66, 0, 0, -0.24);
    add(0.062, 0.015, 0.24, 0, 0.052, -0.3, mats.accent);
    add(0.035, 0.035, 0.44, 0, 0.02, -0.76, mats.dark);
    add(0.05, 0.15, 0.06, 0, -0.11, -0.08, mats.grip, 0.1);
    add(0.055, 0.07, 0.2, 0, 0.1, -0.18, mats.dark);          // scope tube
    add(0.07, 0.1, 0.24, 0, -0.02, 0.3, mats.wood);           // stock
  } else {
    add(0.07, 0.1, 0.5, 0, 0, -0.18);
    add(0.072, 0.015, 0.2, 0, 0.057, -0.22, mats.accent);
    add(0.04, 0.04, 0.3, 0, 0.02, -0.56, mats.dark);
    add(0.045, 0.16, 0.06, 0, -0.12, -0.02, mats.grip, 0.15);
    add(0.05, 0.09, 0.07, 0, -0.07, 0.16, mats.grip, 0.3);
    add(0.02, 0.05, 0.02, 0, 0.085, -0.62, mats.dark);         // front post
  }
  group.position.set(0.26, -0.24, -0.5);
  return group;
}

export function createLoadout(camera, audio) {
  const mats = {
    body: new THREE.MeshStandardMaterial({ color: 0x4b555f, roughness: 0.42, metalness: 0.5 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.5, metalness: 0.5 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x59462e, roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x6e4f2a, roughness: 0.85 }),
    // a lit ember stripe along each receiver, so the viewmodel never reads as
    // a black silhouette
    accent: new THREE.MeshStandardMaterial({ color: 0x3a2410, emissive: PALETTE.breaker, emissiveIntensity: 1.5, roughness: 0.5 }),
  };
  const models = {};
  for (const def of Object.values(WEAPONS)) {
    models[def.id] = buildViewModel(def, mats);
    models[def.id].visible = false;
    models[def.id].scale.setScalar(0.85);
    camera.add(models[def.id]);
  }
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.34),
    new THREE.MeshBasicMaterial({ map: flashTexture(), color: 0xffd9a8, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(PALETTE.lava, 0, 6);
  camera.add(flashLight);

  const ammo = {};
  for (const def of Object.values(WEAPONS)) ammo[def.id] = { mag: def.mag, reserve: def.reserve };
  const loadout = {
    owned: new Set(['sidearm']),
    primary: null,
    current: 'sidearm',
    grenades: { shard: 0, flare: 0, veil: 0 },
    armor: 0,          // 0 none, 1 vest, 2 vest+helmet
    cooldown: 0,
    reloadLeft: 0,
    bloom: 0,
    flashLeft: 0,
    kick: 0,
    bobPhase: 0,
    def() { return WEAPONS[this.current]; },
    ammoState() { return ammo[this.current]; },
    grenadeCount() { return this.grenades.shard + this.grenades.flare + this.grenades.veil; },
  };

  function showCurrent() {
    for (const id of Object.keys(models)) models[id].visible = id === loadout.current;
    const def = loadout.def();
    flash.position.set(0.26, -0.21, def.id === 'longbow' ? -1.28 : def.id === 'sidearm' ? -0.42 : -0.95);
    flashLight.position.copy(flash.position);
  }
  showCurrent();

  loadout.switchTo = (id) => {
    if (!loadout.owned.has(id) || loadout.current === id) return;
    loadout.current = id;
    loadout.reloadLeft = 0;
    loadout.cooldown = Math.max(loadout.cooldown, 0.28);
    showCurrent();
  };
  loadout.cycle = () => {
    if (loadout.primary && loadout.current === 'sidearm') loadout.switchTo(loadout.primary);
    else if (loadout.primary) loadout.switchTo('sidearm');
  };
  loadout.ready = () => loadout.cooldown <= 0 && loadout.reloadLeft <= 0 && loadout.ammoState().mag > 0;
  loadout.tryFire = () => {
    const state = loadout.ammoState();
    if (loadout.reloadLeft > 0 || loadout.cooldown > 0) return false;
    if (state.mag <= 0) { audio.dryFire(); loadout.cooldown = 0.3; return false; }
    state.mag -= 1;
    const def = loadout.def();
    loadout.cooldown = 60 / def.rpm;
    loadout.bloom = Math.min(0.03, loadout.bloom + 0.006);
    loadout.flashLeft = 0.055;
    flash.scale.setScalar(0.8 + Math.random() * 0.55);
    loadout.kick = Math.min(0.09, loadout.kick + def.kick * 1.6);
    return true;
  };
  loadout.startReload = () => {
    const state = loadout.ammoState();
    const def = loadout.def();
    if (loadout.reloadLeft > 0 || state.mag >= def.mag || state.reserve <= 0) return false;
    loadout.reloadLeft = def.reload;
    audio.reload();
    return true;
  };
  // THE ACCURACY MODEL — why stopping pays. Effective spread in radians:
  //   spreadStill + min(1, groundSpeed / 5.2) x spreadMove + bloom,
  //   then x 0.65 while crouched, + 0.03 while airborne.
  // spreadStill is the standing-still floor (carbine 0.0035, Longbow 0.0006);
  // spreadMove is the full-speed penalty (carbine 0.026 — over 7x its floor;
  // the Longbow's 0.05 makes a moving shot nearly hopeless, by design). Bloom
  // grows 0.006 per shot to a 0.03 cap and decays at 0.028/s, so even a standing
  // spray wanders; short bursts from a stop are the accurate play. The HUD
  // crosshair gap is this number made visible, and bots pay the same tax:
  // botFire's sigma grows with the shooter's own speed (combat.js).
  loadout.spread = (speed, crouching, airborne) => {
    const def = loadout.def();
    let spread = def.spreadStill + Math.min(1, speed / 5.2) * def.spreadMove + loadout.bloom;
    if (crouching) spread *= 0.65;
    if (airborne) spread += 0.03;
    return spread;
  };
  loadout.buy = (state, id) => {
    if (WEAPONS[id]) {
      const def = WEAPONS[id];
      if (loadout.owned.has(id) || state.playerMoney < def.price) return false;
      state.playerMoney -= def.price;
      loadout.owned.add(id);
      if (def.slot === 'primary') loadout.primary = id;
      ammo[id] = { mag: def.mag, reserve: def.reserve };
      loadout.switchTo(id);
      return true;
    }
    if (GRENADES[id]) {
      const def = GRENADES[id];
      if (loadout.grenades[id] >= def.cap || loadout.grenadeCount() >= 4 || state.playerMoney < def.price) return false;
      state.playerMoney -= def.price;
      loadout.grenades[id] += 1;
      return true;
    }
    if (GEAR[id]) {
      const level = id === 'vest' ? 1 : 2;
      if (loadout.armor >= level || state.playerMoney < GEAR[id].price) return false;
      state.playerMoney -= GEAR[id].price;
      loadout.armor = level;
      return true;
    }
    return false;
  };
  loadout.newRound = () => {
    // weapons and armor persist across rounds; magazines top up from reserve only by reload
    loadout.reloadLeft = 0;
    loadout.cooldown = 0;
    loadout.bloom = 0;
    // a weapon fired completely dry is re-issued with its base reserve at round
    // start, so a long match can never strand the player with no working gun;
    // spent reserves are never topped up free
    for (const id of loadout.owned) {
      const a = ammo[id];
      if (a.mag <= 0 && a.reserve <= 0) a.reserve = WEAPONS[id].reserve;
    }
    if (loadout.primary) loadout.current = loadout.primary;
    showCurrent();
  };
  loadout.step = (dt, speed, firing) => {
    loadout.cooldown = Math.max(0, loadout.cooldown - dt);
    loadout.bloom = Math.max(0, loadout.bloom - dt * 0.028);
    loadout.flashLeft = Math.max(0, loadout.flashLeft - dt);
    loadout.kick += (0 - loadout.kick) * Math.min(1, dt * 13);
    if (loadout.reloadLeft > 0) {
      loadout.reloadLeft = Math.max(0, loadout.reloadLeft - dt);
      if (loadout.reloadLeft === 0) {
        const state = loadout.ammoState();
        const def = loadout.def();
        const take = Math.min(def.mag - state.mag, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
    loadout.bobPhase += dt * (2 + speed * 1.6) * (speed > 0.3 ? 1 : 0);
    const model = models[loadout.current];
    const bobY = Math.sin(loadout.bobPhase * 2) * 0.008 * Math.min(1, speed / 3);
    const bobX = Math.cos(loadout.bobPhase) * 0.006 * Math.min(1, speed / 3);
    const reloadDip = loadout.reloadLeft > 0 ? -0.16 * Math.sin(Math.min(1, (loadout.def().reload - loadout.reloadLeft) / loadout.def().reload) * Math.PI) : 0;
    model.position.set(0.26 + bobX, -0.24 + bobY + reloadDip, -0.5 + loadout.kick);
    model.rotation.x = loadout.kick * 2.4 + (loadout.reloadLeft > 0 ? 0.5 : 0);
    model.rotation.z = loadout.reloadLeft > 0 ? 0.3 : 0;
    flash.visible = loadout.flashLeft > 0;
    if (flash.visible) flash.rotation.z = Math.random() * Math.PI;
    flashLight.intensity = loadout.flashLeft > 0 ? 14 : 0;
  };
  loadout.muzzle = (out) => flash.getWorldPosition(out);
  return loadout;
}
