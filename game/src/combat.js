// Shot resolution for everyone. A shot is a ray tested against the world boxes and
// against each combatant's two hit volumes — a head sphere (big damage multiplier) and
// a body capsule — and the nearest hit wins, so cover always protects. Damage falls
// off with distance and is reduced by armor. Bots fire through the same path with an
// aim error priced from their skill, the range and the target's speed.
import * as THREE from 'three';
import { rayHitWorld } from './collision.js';
import { PALETTE } from './palette.js';

const headCenter = new THREE.Vector3();
const segA = new THREE.Vector3();
const segB = new THREE.Vector3();
const rayPoint = new THREE.Vector3();
const segPoint = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const hitPoint = new THREE.Vector3();

// Distance from a ray to a vertical body segment; returns ray parameter t or -1.
function rayVsBody(origin, dir, base, height, radius) {
  segA.copy(base).y += 0.25;
  segB.copy(base).y += height;
  // closest points between the ray (t>=0) and the segment (s in [0,1])
  const segLen = segB.y - segA.y;
  let bestT = -1;
  let bestDistSq = radius * radius;
  for (let i = 0; i <= 4; i += 1) {
    segPoint.copy(segA).y += (segLen * i) / 4;
    // project segPoint onto the ray
    const t = (segPoint.x - origin.x) * dir.x + (segPoint.y - origin.y) * dir.y + (segPoint.z - origin.z) * dir.z;
    if (t < 0) continue;
    rayPoint.copy(origin).addScaledVector(dir, t);
    const dSq = rayPoint.distanceToSquared(segPoint);
    if (dSq < bestDistSq) { bestDistSq = dSq; bestT = t; }
  }
  return bestT;
}

function rayVsHead(origin, dir, center, radius) {
  const ox = center.x - origin.x;
  const oy = center.y - origin.y;
  const oz = center.z - origin.z;
  const t = ox * dir.x + oy * dir.y + oz * dir.z;
  if (t < 0) return -1;
  rayPoint.copy(origin).addScaledVector(dir, t);
  return rayPoint.distanceToSquared(center) <= radius * radius ? t : -1;
}

export function createCombat({ colliders, effects, audio, state, onKill, onPlayerHit, onNoise }) {
  let combatants = [];
  const dirTmp = new THREE.Vector3();
  const aimTmp = new THREE.Vector3();

  function falloff(def, dist) {
    if (dist <= def.falloffFrom) return 1;
    if (dist >= def.falloffTo) return 0.45;
    return 1 - 0.55 * ((dist - def.falloffFrom) / (def.falloffTo - def.falloffFrom));
  }

  function applyDamage(victim, amount, attacker, head) {
    if (!victim.alive) return false;
    let dmg = amount;
    if (victim.armor >= 1 && !head) dmg *= 0.55;
    if (victim.armor >= 2 && head) dmg *= 0.5;
    victim.hp -= dmg;
    victim.lastHurtBy = attacker;
    victim.lastHurtAt = state.time;
    if (victim.isPlayer) onPlayerHit(dmg, attacker);
    if (victim.hp <= 0) {
      victim.hp = 0;
      victim.alive = false;
      if (victim.mesh) {
        victim.mesh.rotation.x = -Math.PI / 2;
        victim.mesh.position.y = 0.25;
      }
      onKill(victim, attacker, head);
      return true;
    }
    return false;
  }

  // One hitscan shot. Returns { victim, head, killed, point, dist }.
  function fire(shooter, origin, dir, def) {
    const worldT = rayHitWorld(origin, dir, colliders, 120);
    let victim = null;
    let head = false;
    let bestT = worldT;
    for (const foe of combatants) {
      if (!foe.alive || foe === shooter || foe.team === shooter.team) continue;
      foe.headPos(headCenter);
      const headT = rayVsHead(origin, dir, headCenter, 0.21);
      if (headT > 0 && headT < bestT) { bestT = headT; victim = foe; head = true; }
      const bodyT = rayVsBody(origin, dir, foe.position, 1.5, 0.37);
      if (bodyT > 0 && bodyT < bestT) { bestT = bodyT; victim = foe; head = false; }
    }
    hitPoint.copy(origin).addScaledVector(dir, bestT === Infinity ? 60 : bestT);
    let killed = false;
    if (victim) {
      const dmg = def.damage * (head ? def.headMult : 1) * falloff(def, bestT);
      killed = applyDamage(victim, dmg, shooter, head);
      effects.burst(hitPoint, head ? 0xffb45e : 0xd8cfc0, head ? 10 : 6, 1.8, 0.3, 6);
    } else if (bestT !== Infinity) {
      effects.burst(hitPoint, 0x9aa3ad, 4, 1.4, 0.3, 6);
    }
    return { victim, head, killed, point: hitPoint, dist: bestT };
  }

  return {
    setCombatants(list) { combatants = list; },
    applyDamage,
    // The player fires: spread is applied per pellet around the camera direction.
    playerFire(shooter, origin, baseDir, def, spread, random) {
      let best = null;
      for (let pellet = 0; pellet < def.pellets; pellet += 1) {
        dirTmp.copy(baseDir);
        dirTmp.x += (random() * 2 - 1) * spread;
        dirTmp.y += (random() * 2 - 1) * spread;
        dirTmp.z += (random() * 2 - 1) * spread;
        dirTmp.normalize();
        const result = fire(shooter, origin, dirTmp, def);
        if (result.victim && (!best || result.dist < best.dist)) best = result;
        effects.tracer(origin, result.point);
      }
      onNoise(origin, shooter.team, 27);
      return best;
    },
    // A bot fires one round at its target with priced aim error.
    botFire(bot, target, dist) {
      const def = bot.weapon;
      muzzle.set(bot.position.x, bot.position.y + 1.34, bot.position.z)
        .addScaledVector(aimTmp.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw)), 0.45);
      const targetSpeed = target.isPlayer ? 3 : Math.hypot(target.velocity.x, target.velocity.z);
      (Math.random() < 0.3 ? target.headPos(aimTmp) : target.chestPos(aimTmp));
      const sigma = (0.030 / bot.skill) + targetSpeed * 0.0035 + Math.max(0, dist - 24) * 0.0006;
      aimTmp.x += (Math.random() + Math.random() - 1) * sigma * dist * 0.7;
      aimTmp.y += (Math.random() + Math.random() - 1) * sigma * dist * 0.5;
      aimTmp.z += (Math.random() + Math.random() - 1) * sigma * dist * 0.7;
      dirTmp.subVectors(aimTmp, muzzle).normalize();
      const result = fire(bot, muzzle, dirTmp, def);
      effects.tracer(muzzle, result.point, bot.team === 'wardens' ? 0x9fd8ff : PALETTE.tracer);
      if (dist < 34) audio.enemyShot();
      onNoise(muzzle, bot.team, 24);
      return result;
    },
    // Grenade blast: radial damage, halved through cover.
    explode(position, radius, maxDamage, attacker) {
      for (const foe of combatants) {
        if (!foe.alive || foe === attacker) continue;
        foe.chestPos(aimTmp);
        const dist = aimTmp.distanceTo(position);
        if (dist > radius + 0.4) continue;
        let dmg = maxDamage * Math.max(0.08, 1 - dist / (radius + 0.4));
        segA.copy(position).y += 0.4;
        if (rayHitWorld(segA, dirTmp.subVectors(aimTmp, segA).normalize(), colliders, dist) < dist - 0.3) dmg *= 0.45;
        applyDamage(foe, dmg, attacker, false);
      }
    },
    // Flare pop: blinds by facing and line of sight. Returns player blind strength 0..1.
    flare(position, playerBody, playerDir) {
      let playerBlind = 0;
      for (const foe of combatants) {
        if (!foe.alive) continue;
        foe.chestPos(aimTmp);
        const dist = aimTmp.distanceTo(position);
        if (dist > 24) continue;
        segA.copy(position);
        if (rayHitWorld(segA, dirTmp.subVectors(aimTmp, segA).normalize(), colliders, dist) < dist - 0.3) continue;
        if (foe.isPlayer) {
          dirTmp.subVectors(position, aimTmp).normalize();
          const facing = dirTmp.dot(playerDir);
          if (facing > 0.15) playerBlind = Math.max(playerBlind, Math.min(1, (facing - 0.15) * 1.6) * (1 - dist / 30));
        } else {
          foe.blindUntil = state.time + 2.2 + Math.random() * 1.6;
        }
      }
      return playerBlind;
    },
  };
}
