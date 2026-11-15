// Axis-aligned box collision and ray tests shared by the player, the bots and combat.
// Colliders are THREE.Box3 in a flat array; movement resolves one axis at a time so a
// body slides along walls instead of sticking, and shots test the same boxes the bodies
// collide with, so what you see is exactly what blocks a bullet.
import * as THREE from 'three';

const probe = new THREE.Box3();

// Does a body of `radius` and `height` standing at (x, y, z) overlap any collider?
// `lift` shrinks the vertical span so standing on a floor box is not a wall hit.
export function bodyOverlaps(colliders, x, y, z, radius, height, lift) {
  probe.min.set(x - radius, y + lift, z - radius);
  probe.max.set(x + radius, y + height - lift, z + radius);
  for (const box of colliders) if (probe.intersectsBox(box)) return box;
  return null;
}

// Move a body by (dx, dz) horizontally with per-axis sliding; returns via the body object
// { position, velocity } whose x/z are updated in place.
export function slideMove(colliders, body, radius, height, dt) {
  const nextX = body.position.x + body.velocity.x * dt;
  if (!bodyOverlaps(colliders, nextX, body.position.y, body.position.z, radius, height, 0.04)) {
    body.position.x = nextX;
  } else body.velocity.x = 0;
  const nextZ = body.position.z + body.velocity.z * dt;
  if (!bodyOverlaps(colliders, body.position.x, body.position.y, nextZ, radius, height, 0.04)) {
    body.position.z = nextZ;
  } else body.velocity.z = 0;
}

// Nearest ray-vs-AABB distance along origin+dir*t (dir normalised), or Infinity.
// Slab method; used for bullet-vs-world and bot line-of-sight.
export function rayHitBox(origin, dir, box, maxDist) {
  let tmin = 0;
  let tmax = maxDist;
  const axes = ['x', 'y', 'z'];
  for (const axis of axes) {
    const o = origin[axis];
    const d = dir[axis];
    if (Math.abs(d) < 1e-8) {
      if (o < box.min[axis] || o > box.max[axis]) return Infinity;
    } else {
      let t1 = (box.min[axis] - o) / d;
      let t2 = (box.max[axis] - o) / d;
      if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

export function rayHitWorld(origin, dir, colliders, maxDist) {
  let best = Infinity;
  for (const box of colliders) {
    const t = rayHitBox(origin, dir, box, maxDist);
    if (t < best) best = t;
  }
  return best;
}

// Is the straight segment a->b free of colliders? (Bot vision and grenade arcs.)
const segDir = new THREE.Vector3();
export function segmentBlocked(a, b, colliders) {
  segDir.subVectors(b, a);
  const dist = segDir.length();
  if (dist < 0.001) return false;
  segDir.divideScalar(dist);
  return rayHitWorld(a, segDir, colliders, dist) < dist - 0.05;
}

// Keep a point inside the map bounds with a margin.
export function clampToBounds(point, bound, margin) {
  point.x = Math.max(-bound + margin, Math.min(bound - margin, point.x));
  point.z = Math.max(-bound + margin, Math.min(bound - margin, point.z));
}
