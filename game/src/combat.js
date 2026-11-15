// Shot resolution for everyone, specified step by step below: a ray against the
// world boxes and each combatant's head sphere + body capsule (the capsule's
// winning sample height prices a third zone — legs), distance falloff, armour
// cuts, and one shared path for the player and the bots, whose aim error is
// priced from skill, range and both sides' movement. Every hit spawns pooled
// impact sparks plus a glow flash — bloodless, readable at a glance.
//
// DAMAGE MODEL (resolveHit / applyDamage below), applied in this order:
//   1. hit volume: the head sphere (r 0.21 m at the head bone) is tested before
//      the body capsule (r 0.37 m, sampled at 5 heights); the nearer hit wins,
//      and a world box nearer than both stops the shot entirely. The winning
//      body sample's height is kept: below 0.72 m the hit is a LEG hit.
//   2. falloff: full damage out to the weapon's falloffFrom, then linear down
//      to a 0.45 floor at falloffTo (carbine 26-70 m, Longbow 40-110 m).
//   3. zone: a head hit multiplies by the weapon's headMult (2.0-3.4); a leg
//      hit multiplies by 0.75 (LEG_MULT) — centre mass is the reliable play.
//   4. armor: tier 1 (vest) multiplies BODY damage by 0.55 and does nothing
//      for the head or the legs — a vest covers the torso; tier 2 (vest +
//      helmet) also multiplies HEAD damage by 0.5. So a vest never saves you
//      from a headshot, and a helmet turns the carbine's 112.2 headshot into
//      56.1 — survivable, barely.
//   Blast damage (explode) skips steps 1-3: maxDamage at the centre, linear to
//   an 8% floor at radius + 0.4, x0.45 if a collider blocks the line to the
//   victim. Bot aim error (botFire): sigma = 0.030 / skill + target speed x
//   0.0035 + range past 24 m x 0.0006 + the shooter's own speed x 0.0022,
//   applied as a triangular jitter — a fast target at range is hard to hit, a
//   standing one at 10 m is not, and a bot that stops to shoot shoots straighter.
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

// Hit zones priced off the two volumes: 0 body, 1 head, 2 legs. A body sample
// below LEG_HEIGHT is a leg hit, paid at LEG_MULT with no armour reduction.
const LEG_HEIGHT = 0.72;
const LEG_MULT = 0.75;
let bodyHitH = 0;   // height above the base of rayVsBody's winning sample

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
    if (dSq < bestDistSq) { bestDistSq = dSq; bestT = t; bodyHitH = segPoint.y - base.y; }
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

  function applyDamage(victim, amount, attacker, zone) {
    if (!victim.alive) return false;
    let dmg = amount;
    if (zone === 0 && victim.armor >= 1) dmg *= 0.55;
    if (zone === 1 && victim.armor >= 2) dmg *= 0.5;
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
      onKill(victim, attacker, zone === 1);
      return true;
    }
    return false;
  }

  // One hitscan shot. Returns { victim, head, killed, point, dist }.
  function fire(shooter, origin, dir, def) {
    const worldT = rayHitWorld(origin, dir, colliders, 120);
    let victim = null;
    let zone = 0;
    let bestT = worldT;
    for (const foe of combatants) {
      if (!foe.alive || foe === shooter || foe.team === shooter.team) continue;
      foe.headPos(headCenter);
      const headT = rayVsHead(origin, dir, headCenter, 0.21);
      if (headT > 0 && headT < bestT) { bestT = headT; victim = foe; zone = 1; }
      const bodyT = rayVsBody(origin, dir, foe.position, 1.5, 0.37);
      if (bodyT > 0 && bodyT < bestT) { bestT = bodyT; victim = foe; zone = bodyHitH < LEG_HEIGHT ? 2 : 0; }
    }
    hitPoint.copy(origin).addScaledVector(dir, bestT === Infinity ? 60 : bestT);
    let killed = false;
    if (victim) {
      const zoneMult = zone === 1 ? def.headMult : zone === 2 ? LEG_MULT : 1;
      const dmg = def.damage * zoneMult * falloff(def, bestT);
      killed = applyDamage(victim, dmg, shooter, zone);
      // bloodless hit feedback: a bright spark flash and a puff of pale impact dust
      effects.flashAt(hitPoint, zone === 1 ? 0xffcf7a : 0xffe9c9, zone === 1 ? 0.85 : 0.55, 0.08);
      effects.burst(hitPoint, zone === 1 ? 0xffb45e : 0xd8cfc0, zone === 1 ? 14 : 9, 1.9, 0.32, 6);
    } else if (bestT !== Infinity) {
      effects.flashAt(hitPoint, 0xd8e2ec, 0.4, 0.06);
      effects.burst(hitPoint, 0x9aa3ad, 7, 1.5, 0.3, 6);
    }
    return { victim, head: zone === 1, killed, point: hitPoint, dist: bestT };
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
      const sigma = (0.030 / bot.skill) + targetSpeed * 0.0035 + Math.max(0, dist - 24) * 0.0006 +
        Math.hypot(bot.velocity.x, bot.velocity.z) * 0.0022;
      aimTmp.x += (Math.random() + Math.random() - 1) * sigma * dist * 0.7;
      aimTmp.y += (Math.random() + Math.random() - 1) * sigma * dist * 0.5;
      aimTmp.z += (Math.random() + Math.random() - 1) * sigma * dist * 0.7;
      dirTmp.subVectors(aimTmp, muzzle).normalize();
      const result = fire(bot, muzzle, dirTmp, def);
      effects.muzzle(muzzle, bot.team === 'wardens' ? 0xbfd9ff : PALETTE.lava);
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
        applyDamage(foe, dmg, attacker, 0);
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
