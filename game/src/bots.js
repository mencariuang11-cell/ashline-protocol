// Bot combatants: low-poly soldiers with team colours, a walk cycle and a gun, driven by
// a small tactical brain. Bots walk the map's waypoint graph, hold angles when defending,
// push lanes when attacking, react to what they can see (vision cone + line of sight +
// smoke) and hear (gunfire noise events), stop to fire in bursts like the accuracy model
// rewards, and the carrier plants the Spike while a Warden defuses it.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { slideMove, segmentBlocked } from './collision.js';
import { nextHop, nearestNode, SITE, HOLD_POINTS } from './map.js';
import { WEAPONS } from './weapons.js';
import { TEAM } from './state.js';

const BOT_NAMES = {
  breakers: ['Vex', 'Onyx', 'Rook', 'Sable'],
  wardens: ['Hale', 'Ivers', 'Moss', 'Quill', 'Tarn'],
};
const BOT_WEAPONS = { breakers: ['carbine', 'smg', 'carbine', 'scatter'], wardens: ['carbine', 'longbow', 'smg', 'carbine', 'smg'] };
const RADIUS = 0.34;
const HEIGHT = 1.72;

const matCache = {};
function teamMats(team) {
  if (matCache[team]) return matCache[team];
  const main = team === TEAM.BREAKERS ? PALETTE.breaker : PALETTE.warden;
  const dark = team === TEAM.BREAKERS ? PALETTE.breakerDark : PALETTE.wardenDark;
  matCache[team] = {
    suit: new THREE.MeshStandardMaterial({ color: dark, roughness: 0.85 }),
    vest: new THREE.MeshStandardMaterial({ color: main, roughness: 0.7 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xc9a186, roughness: 0.8 }),
    gun: new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.5, metalness: 0.5 }),
  };
  return matCache[team];
}

export function createBotMesh(team) {
  const mats = teamMats(team);
  const group = new THREE.Group();
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.85, 0.2), mats.suit);
  legL.position.set(-0.13, 0.43, 0);
  const legR = legL.clone();
  legR.position.x = 0.13;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.66, 0.3), mats.vest);
  torso.position.y = 1.18;
  torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), mats.skin);
  head.position.y = 1.68;
  head.castShadow = true;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.3), mats.suit);
  cap.position.y = 1.8;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.62), mats.gun);
  gun.position.set(0.18, 1.32, -0.3);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.42, 0.11), mats.suit);
  arm.position.set(0.18, 1.28, -0.05);
  arm.rotation.x = -0.7;
  group.add(legL, legR, torso, head, cap, gun, arm);
  return { group, legL, legR, torso, head };
}

export function createBot(team, index, scene) {
  const mesh = createBotMesh(team);
  scene.add(mesh.group);
  const weaponId = BOT_WEAPONS[team][index % BOT_WEAPONS[team].length];
  const bot = {
    isPlayer: false,
    id: `${team}-${index}`,
    team,
    name: BOT_NAMES[team][index % BOT_NAMES[team].length],
    mesh: mesh.group,
    parts: mesh,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    yaw: 0,
    hp: 100,
    alive: true,
    armor: team === TEAM.WARDENS ? 1 : 0,
    weapon: WEAPONS[weaponId],
    mag: WEAPONS[weaponId].mag,
    cooldown: 0,
    reloadLeft: 0,
    role: 'rush',
    state: 'advance',
    node: 0,
    goalNode: 0,
    holdNode: -1,
    target: null,
    lastKnown: new THREE.Vector3(),
    seenAt: -99,
    thinkAt: Math.random() * 0.15,
    burstLeft: 0,
    burstWait: 0.4 + Math.random() * 0.5,
    strafeDir: 1,
    strafeAt: 0,
    walkPhase: Math.random() * 6,
    channel: 0,             // plant/defuse progress in seconds
    skill: 0.8 + Math.random() * 0.45,   // aim quality multiplier
    eyeHeight() { return 1.58; },
    headPos(out) { return out.set(this.position.x, this.position.y + 1.68, this.position.z); },
    chestPos(out) { return out.set(this.position.x, this.position.y + 1.18, this.position.z); },
  };
  return bot;
}

const eyeA = new THREE.Vector3();
const eyeB = new THREE.Vector3();
const moveDir = new THREE.Vector3();

export function createSquad(scene, map) {
  const bots = [];
  for (let i = 0; i < 4; i += 1) bots.push(createBot(TEAM.BREAKERS, i, scene));
  for (let i = 0; i < 5; i += 1) bots.push(createBot(TEAM.WARDENS, i, scene));
  return {
    bots,
    alive(team) { return bots.filter((b) => b.alive && (team === undefined || b.team === team)); },
    reset(spawns, spikeCarrierId) {
      let breakerIndex = 0;
      let wardenIndex = 0;
      for (const bot of bots) {
        const list = bot.team === TEAM.BREAKERS ? spawns.breakers : spawns.wardens;
        const index = bot.team === TEAM.BREAKERS ? breakerIndex++ : wardenIndex++;
        const [x, z] = list[index % list.length];
        bot.position.set(x, 0, z);
        bot.velocity.set(0, 0, 0);
        bot.hp = 100;
        bot.alive = true;
        bot.mag = bot.weapon.mag;
        bot.cooldown = 0;
        bot.reloadLeft = 0;
        bot.target = null;
        bot.seenAt = -99;
        bot.channel = 0;
        bot.directPos = null;
        bot.blindUntil = 0;
        bot.state = 'advance';
        bot.node = nearestNode(map, bot.position);
        bot.mesh.visible = true;
        bot.mesh.rotation.set(0, 0, 0);
        if (bot.team === TEAM.BREAKERS) {
          bot.yaw = 0;
          bot.role = spikeCarrierId === bot.id ? 'carrier' : index % 2 ? 'rush' : 'cover';
          bot.goalNode = [9, 19, 24][index % 3];
          bot.holdNode = HOLD_POINTS.breakers[index % HOLD_POINTS.breakers.length];
        } else {
          bot.yaw = Math.PI;
          bot.role = 'hold';
          bot.holdNode = HOLD_POINTS.wardens[index % HOLD_POINTS.wardens.length];
          bot.goalNode = bot.holdNode;
        }
        bot.mesh.position.copy(bot.position);
      }
    },
  };
}

// One bot's brain + body for a fixed step. ctx carries the shared world:
// { time, phase, combatants, colliders, effects, noises, fireBot, plantRequest, defuseRequest, spike }
export function stepBot(bot, dt, ctx) {
  if (!bot.alive) return;
  const { time, map } = ctx;
  bot.cooldown = Math.max(0, bot.cooldown - dt);
  if (bot.reloadLeft > 0) {
    bot.reloadLeft = Math.max(0, bot.reloadLeft - dt);
    if (bot.reloadLeft === 0) bot.mag = bot.weapon.mag;
  }

  // perception on a staggered 8 Hz tick
  bot.thinkAt -= dt;
  if (bot.thinkAt <= 0) {
    bot.thinkAt = 0.12;
    perceive(bot, ctx);
  }

  const blinded = time < (bot.blindUntil || 0);
  const engaged = !blinded && bot.target && time - bot.seenAt < 2.2;
  let wantSpeed = 0;
  moveDir.set(0, 0, 0);

  if (bot.state === 'planting' || bot.state === 'defusing') {
    // stand still and work: the director advances the channel while this state holds
  } else if (engaged && bot.target) {
    // combat movement: close to comfort range, then hold and strafe between bursts
    bot.chestPos(eyeA);
    const dist = eyeA.distanceTo(bot.target.chestPos(eyeB));
    const comfort = bot.weapon.id === 'scatter' ? 11 : bot.weapon.id === 'longbow' ? 46 : 26;
    if (dist > comfort + 6) {
      moveDir.subVectors(bot.target.position, bot.position).setY(0).normalize();
      wantSpeed = 4.4;
    } else if (dist < comfort - 8) {
      moveDir.subVectors(bot.position, bot.target.position).setY(0).normalize();
      wantSpeed = 2.4;
    } else {
      if (time > bot.strafeAt) {
        bot.strafeAt = time + 0.7 + Math.random() * 0.9;
        bot.strafeDir = Math.random() > 0.5 ? 1 : -1;
        if (Math.random() < 0.3) bot.strafeDir = 0;
      }
      moveDir.set(Math.cos(bot.yaw) * bot.strafeDir, 0, -Math.sin(bot.yaw) * bot.strafeDir);
      wantSpeed = bot.strafeDir === 0 ? 0 : 2.0;
    }
    faceTowards(bot, bot.target.position, dt, 10);
    fireControl(bot, dt, ctx, dist);
  } else if (bot.directPos) {
    // direct steering to a point the director named (the plant spot, a dropped Spike)
    moveDir.subVectors(bot.directPos, bot.position).setY(0);
    if (moveDir.length() < 0.9) {
      bot.directPos = null;
      if (bot.role === 'carrier') ctx.plantRequest(bot);
    } else {
      moveDir.normalize();
      wantSpeed = 4.6;
      faceTowards(bot, bot.directPos, dt, 8);
    }
  } else if (bot.team === TEAM.WARDENS && ctx.spike.planted && ctx.spike.position &&
      bot.position.distanceTo(ctx.spike.position) > 1.4) {
    // a defender hurries straight to the planted Spike to defuse it
    moveDir.subVectors(ctx.spike.position, bot.position).setY(0).normalize();
    wantSpeed = 4.8;
    faceTowards(bot, ctx.spike.position, dt, 8);
  } else if (bot.team === TEAM.WARDENS && ctx.spike.planted && ctx.spike.position) {
    ctx.defuseRequest(bot);
  } else {
    // travel: follow the waypoint graph towards the goal node
    const goal = map.nodes[bot.goalNode];
    const near = nearestNode(map, bot.position);
    bot.node = near;
    if (bot.position.distanceTo(goal) < 1.6) {
      if (bot.team === TEAM.WARDENS || bot.role === 'hold') {
        bot.state = 'hold';
        scanAround(bot, dt, time);
      } else if (bot.goalNode === 19) {
        bot.goalNode = 10;   // canal gate reached: push on to the site's west side
      } else if (bot.goalNode === 24) {
        bot.goalNode = 11;   // foundry top reached: push on to the site's east side
      } else if (bot.role === 'carrier' && ctx.plantRequest(bot)) {
        bot.state = 'planting';
      } else {
        bot.state = 'hold';
        scanAround(bot, dt, time);
      }
    } else {
      const hop = nextHop(map, near, bot.goalNode);
      const target = map.nodes[hop];
      moveDir.subVectors(target, bot.position).setY(0);
      if (moveDir.lengthSq() > 0.01) {
        moveDir.normalize();
        wantSpeed = bot.role === 'hold' ? 4.2 : 4.6;
        faceTowards(bot, target, dt, 8);
      }
    }
  }

  // separation so bots do not stack on one tile
  for (const other of ctx.combatants) {
    if (other === bot || !other.alive) continue;
    const dx = bot.position.x - other.position.x;
    const dz = bot.position.z - other.position.z;
    const dSq = dx * dx + dz * dz;
    if (dSq > 0.001 && dSq < 1.1) {
      moveDir.x += (dx / Math.sqrt(dSq)) * 0.6;
      moveDir.z += (dz / Math.sqrt(dSq)) * 0.6;
    }
  }

  const speedNow = Math.hypot(bot.velocity.x, bot.velocity.z);
  const accel = speedNow < wantSpeed ? 26 : 30;
  if (moveDir.lengthSq() > 0.001) {
    moveDir.normalize();
    bot.velocity.x += moveDir.x * accel * dt;
    bot.velocity.z += moveDir.z * accel * dt;
  } else {
    bot.velocity.x *= Math.max(0, 1 - 10 * dt);
    bot.velocity.z *= Math.max(0, 1 - 10 * dt);
  }
  const cap = Math.max(wantSpeed, 0.001);
  const speed = Math.hypot(bot.velocity.x, bot.velocity.z);
  if (speed > Math.max(cap, speedNow)) {
    const scale = Math.max(cap, speedNow) / speed;
    bot.velocity.x *= scale;
    bot.velocity.z *= scale;
  }
  slideMove(ctx.colliders, bot, RADIUS, HEIGHT, dt);
  bot.position.y = 0;

  // walk cycle + facing
  const finalSpeed = Math.hypot(bot.velocity.x, bot.velocity.z);
  bot.walkPhase += dt * finalSpeed * 2.4;
  const swing = Math.sin(bot.walkPhase) * Math.min(0.55, finalSpeed * 0.14);
  bot.parts.legL.rotation.x = swing;
  bot.parts.legR.rotation.x = -swing;
  bot.mesh.position.copy(bot.position);
  bot.mesh.rotation.y = bot.yaw;
}

function faceTowards(bot, point, dt, rate) {
  const targetYaw = Math.atan2(-(point.x - bot.position.x), -(point.z - bot.position.z));
  let diff = targetYaw - bot.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  bot.yaw += diff * Math.min(1, dt * rate);
}

function scanAround(bot, dt, time) {
  const base = bot.team === TEAM.WARDENS ? Math.PI : 0;
  const targetYaw = base + Math.sin(time * 0.35 + bot.position.x) * 0.7;
  let diff = targetYaw - bot.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  bot.yaw += diff * Math.min(1, dt * 2);
}

function perceive(bot, ctx) {
  const { time } = ctx;
  if (time < (bot.blindUntil || 0)) return;   // a Flare pop takes vision away entirely
  eyeA.set(bot.position.x, bot.position.y + bot.eyeHeight(), bot.position.z);
  let best = null;
  let bestDist = Infinity;
  for (const foe of ctx.combatants) {
    if (!foe.alive || foe.team === bot.team) continue;
    foe.chestPos(eyeB);
    const dist = eyeA.distanceTo(eyeB);
    if (dist > 58 || dist >= bestDist) continue;
    // vision cone: 130 degrees, unless the foe just hurt us
    const dx = eyeB.x - eyeA.x;
    const dz = eyeB.z - eyeA.z;
    const facing = Math.atan2(-dx, -dz);
    let diff = Math.abs(facing - bot.yaw);
    while (diff > Math.PI) diff = Math.PI * 2 - diff;
    const recentlyHurt = bot.lastHurtBy === foe && time - (bot.lastHurtAt || -99) < 2;
    if (diff > 1.15 && !recentlyHurt && dist > 4) continue;
    if (segmentBlocked(eyeA, eyeB, ctx.colliders)) continue;
    if (ctx.effects.smokeBlocks(eyeA, eyeB)) continue;
    best = foe;
    bestDist = dist;
  }
  if (best) {
    if (bot.target !== best) bot.reaction = 0.24 + Math.random() * 0.3 / bot.skill;
    bot.target = best;
    bot.seenAt = time;
    bot.lastKnown.copy(best.position);
    return;
  }
  // hearing: fresh enemy gunfire pulls a bot to investigate
  for (const noise of ctx.noises) {
    if (time - noise.at > 2.5 || noise.team === bot.team) continue;
    if (bot.position.distanceTo(noise.pos) < noise.radius) {
      bot.lastKnown.copy(noise.pos);
      if (!bot.target || time - bot.seenAt > 3) {
        bot.goalNode = nearestNode(ctx.map, noise.pos);
        if (bot.state === 'hold') bot.state = 'advance';
      }
    }
  }
  if (time - bot.seenAt > 4) bot.target = null;
}

function fireControl(bot, dt, ctx, dist) {
  if (bot.reloadLeft > 0) return;
  if (bot.mag <= 0) {
    bot.reloadLeft = bot.weapon.reload;
    return;
  }
  bot.reaction = Math.max(0, (bot.reaction || 0) - dt);
  if (bot.reaction > 0) return;
  if (bot.burstLeft <= 0) {
    bot.burstWait -= dt;
    if (bot.burstWait > 0) return;
    bot.burstLeft = bot.weapon.id === 'smg' ? 5 : bot.weapon.id === 'scatter' || bot.weapon.id === 'longbow' ? 1 : 3;
  }
  if (bot.cooldown > 0) return;
  bot.cooldown = 60 / bot.weapon.rpm;
  bot.mag -= 1;
  bot.burstLeft -= 1;
  if (bot.burstLeft === 0) bot.burstWait = 0.45 + Math.random() * 0.7 / bot.skill;
  ctx.fireBot(bot, bot.target, dist);
}
