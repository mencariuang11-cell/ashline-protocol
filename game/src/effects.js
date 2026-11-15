// Transient visuals and the throwable world: pooled tracers and impact bursts (nothing
// is allocated per shot), grenades with real arcs and bounces, Veil smoke that genuinely
// blocks sightlines, explosion flashes, and the Spike prop with its blinking armed light.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_COUNT = 28;
const PARTICLE_COUNT = 420;

export function createEffects(scene, colliders) {
  // tracers: one Line per shot, recycled
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({
      color: PALETTE.tracer, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, left: 0 });
  }
  let tracerCursor = 0;

  // particles: one Points cloud with per-particle velocity and life kept in JS arrays
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PARTICLE_COUNT * 3);
  const pColor = new Float32Array(PARTICLE_COUNT * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pColor, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({
    size: 0.09, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
  points.frustumCulled = false;
  scene.add(points);
  const particles = [];
  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    particles.push({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, gravity: 0 });
    pPos[i * 3 + 1] = -50;
  }
  let particleCursor = 0;
  const colorTmp = new THREE.Color();

  // explosions: one reusable flash light and shock ring
  const boomLight = new THREE.PointLight(PALETTE.lava, 0, 18, 1.6);
  scene.add(boomLight);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.06, 8, 40),
    new THREE.MeshBasicMaterial({ color: PALETTE.lava, transparent: true, opacity: 0, depthWrite: false }));
  ring.rotation.x = Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  let boomLeft = 0;

  // smoke clouds: spheres that block vision while alive
  const smokes = [];
  const smokeMat = new THREE.MeshStandardMaterial({
    color: PALETTE.smoke, transparent: true, opacity: 0.5, roughness: 1, depthWrite: false });

  // grenades in flight or resting
  const grenades = [];
  const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMats = {
    shard: new THREE.MeshStandardMaterial({ color: 0x707a4a, roughness: 0.6, metalness: 0.3 }),
    flare: new THREE.MeshStandardMaterial({ color: 0xd8d3c3, roughness: 0.5 }),
    veil: new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.7 }),
  };

  // the Spike: a breaching charge with an armed light
  const spike = new THREE.Group();
  const spikeBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.5, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.4, metalness: 0.6 }));
  spikeBody.position.y = 0.25;
  spike.add(spikeBody);
  const spikeLightMat = new THREE.MeshStandardMaterial({
    color: PALETTE.breaker, emissive: PALETTE.breaker, emissiveIntensity: 0.4 });
  const spikeLamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), spikeLightMat);
  spikeLamp.position.set(0, 0.55, 0);
  spike.add(spikeLamp);
  const spikeGlow = new THREE.PointLight(PALETTE.breaker, 0, 7, 1.8);
  spikeGlow.position.y = 0.6;
  spike.add(spikeGlow);
  spike.visible = false;
  scene.add(spike);

  let shakeAmount = 0;
  const effects = {
    grenades,
    smokes,
    spike,
    onGrenadeSettle: null,   // (grenade) => void, set by the round director
    tracer(from, to, color = PALETTE.tracer) {
      const slot = tracers[tracerCursor];
      tracerCursor = (tracerCursor + 1) % TRACER_COUNT;
      const attr = slot.line.geometry.getAttribute('position');
      attr.setXYZ(0, from.x, from.y, from.z);
      attr.setXYZ(1, to.x, to.y, to.z);
      attr.needsUpdate = true;
      slot.line.material.color.setHex(color);
      slot.line.visible = true;
      slot.left = 0.07;
    },
    burst(position, colorHex, count = 8, speed = 2.4, life = 0.45, gravity = 5) {
      colorTmp.setHex(colorHex);
      for (let n = 0; n < count; n += 1) {
        const p = particles[particleCursor];
        const i = particleCursor;
        particleCursor = (particleCursor + 1) % PARTICLE_COUNT;
        p.life = life * (0.5 + Math.random() * 0.8);
        p.max = p.life;
        p.vx = (Math.random() * 2 - 1) * speed;
        p.vy = Math.random() * speed * 0.9 + 0.4;
        p.vz = (Math.random() * 2 - 1) * speed;
        p.gravity = gravity;
        pPos[i * 3] = position.x; pPos[i * 3 + 1] = position.y; pPos[i * 3 + 2] = position.z;
        pColor[i * 3] = colorTmp.r; pColor[i * 3 + 1] = colorTmp.g; pColor[i * 3 + 2] = colorTmp.b;
      }
      pGeo.getAttribute('color').needsUpdate = true;
    },
    explosion(position) {
      boomLight.position.copy(position).y += 1;
      boomLeft = 0.28;
      ring.position.copy(position).y = 0.4;
      ring.visible = true;
      effects.burst(position, PALETTE.lava, 42, 7, 0.7, 7);
      effects.burst(position, 0x55483a, 22, 3.5, 1.1, 3);
      shakeAmount = Math.min(0.5, shakeAmount + 0.3);
    },
    shake(amount) { shakeAmount = Math.min(0.5, shakeAmount + amount); },
    shakeOffset(out, time) {
      if (shakeAmount < 0.002) { out.set(0, 0, 0); return out; }
      out.set(
        Math.sin(time * 91) * shakeAmount * 0.05,
        Math.cos(time * 113) * shakeAmount * 0.05, 0);
      return out;
    },
    throwGrenade(type, from, dir, actor) {
      const mesh = new THREE.Mesh(grenadeGeo, grenadeMats[type]);
      mesh.position.copy(from);
      scene.add(mesh);
      const grenade = {
        type, actor, mesh,
        vel: dir.clone().multiplyScalar(16).add(new THREE.Vector3(0, 4.5, 0)),
        fuse: type === 'shard' ? 1.7 : type === 'flare' ? 1.15 : 0.9,
        settled: false, dead: false,
      };
      grenades.push(grenade);
      return grenade;
    },
    addSmoke(position) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(2.6, 14, 10), smokeMat.clone());
      mesh.position.copy(position).y += 1.2;
      mesh.scale.setScalar(0.2);
      scene.add(mesh);
      smokes.push({ mesh, left: 13, grow: 0 });
    },
    smokeBlocks(a, b) {
      // distance from segment a-b to each smoke centre, in the horizontal plane + height
      for (const smoke of smokes) {
        const c = smoke.mesh.position;
        if (c.y < Math.min(a.y, b.y) - 1 || c.y > Math.max(a.y, b.y) + 2.4) continue;
        const abx = b.x - a.x; const abz = b.z - a.z;
        const lenSq = abx * abx + abz * abz || 1;
        let t = ((c.x - a.x) * abx + (c.z - a.z) * abz) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const dx = a.x + abx * t - c.x;
        const dz = a.z + abz * t - c.z;
        if (dx * dx + dz * dz < 6.2) return true;
      }
      return false;
    },
    setSpikeMode(mode, position) {
      spike.visible = mode !== 'carried';
      if (position) spike.position.copy(position);
      spikeLightMat.emissiveIntensity = mode === 'planted' ? 2.6 : 0.4;
      spikeGlow.intensity = mode === 'planted' ? 6 : 0;
    },
    update(dt) {
      shakeAmount = Math.max(0, shakeAmount - dt * 1.4);
      for (const slot of tracers) {
        if (!slot.line.visible) continue;
        slot.left -= dt;
        slot.line.material.opacity = Math.max(0, slot.left / 0.07) * 0.85;
        if (slot.left <= 0) slot.line.visible = false;
      }
      for (let i = 0; i < PARTICLE_COUNT; i += 1) {
        const p = particles[i];
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) { pPos[i * 3 + 1] = -50; continue; }
        p.vy -= p.gravity * dt;
        pPos[i * 3] += p.vx * dt;
        pPos[i * 3 + 1] = Math.max(0.03, pPos[i * 3 + 1] + p.vy * dt);
        pPos[i * 3 + 2] += p.vz * dt;
      }
      pGeo.getAttribute('position').needsUpdate = true;
      if (boomLeft > 0) {
        boomLeft -= dt;
        boomLight.intensity = Math.max(0, boomLeft / 0.28) * 90;
        const s = 1 + (0.28 - boomLeft) * 16;
        ring.scale.setScalar(s);
        ring.material.opacity = Math.max(0, boomLeft / 0.28) * 0.8;
        if (boomLeft <= 0) ring.visible = false;
      }
      for (let i = grenades.length - 1; i >= 0; i -= 1) {
        const grenade = grenades[i];
        if (grenade.dead) continue;
        grenade.fuse -= dt;
        if (!grenade.settled) {
          grenade.vel.y -= 18 * dt;
          const next = grenade.mesh.position.clone().addScaledVector(grenade.vel, dt);
          if (next.y < 0.09) {
            next.y = 0.09;
            grenade.vel.y = Math.abs(grenade.vel.y) > 1.6 ? -grenade.vel.y * 0.38 : 0;
            grenade.vel.x *= 0.7; grenade.vel.z *= 0.7;
            if (Math.abs(grenade.vel.y) === 0 && grenade.vel.lengthSq() < 0.4) grenade.settled = true;
          }
          // bounce off walls: a point test against the collider boxes
          for (const box of colliders) {
            if (next.x > box.min.x - 0.08 && next.x < box.max.x + 0.08 &&
                next.z > box.min.z - 0.08 && next.z < box.max.z + 0.08 && next.y < box.max.y) {
              const fromX = grenade.mesh.position.x < box.min.x || grenade.mesh.position.x > box.max.x;
              if (fromX) grenade.vel.x *= -0.4; else grenade.vel.z *= -0.4;
              next.copy(grenade.mesh.position);
              break;
            }
          }
          grenade.mesh.position.copy(next);
        }
        if (grenade.fuse <= 0) {
          grenade.dead = true;
          scene.remove(grenade.mesh);
          if (effects.onGrenadeSettle) effects.onGrenadeSettle(grenade);
        }
      }
      for (let i = smokes.length - 1; i >= 0; i -= 1) {
        const smoke = smokes[i];
        smoke.left -= dt;
        if (smoke.grow < 1) {
          smoke.grow = Math.min(1, smoke.grow + dt * 1.6);
          smoke.mesh.scale.setScalar(0.2 + smoke.grow * 0.8);
        }
        smoke.mesh.material.opacity = smoke.left < 2 ? 0.5 * (smoke.left / 2) : 0.5;
        if (smoke.left <= 0) {
          scene.remove(smoke.mesh);
          smokes.splice(i, 1);
        }
      }
      spikeLamp.material.emissiveIntensity = spike.visible ? 1.6 + Math.sin(performance.now() * 0.012) * 1.2 : 0.4;
    },
  };
  return effects;
}
