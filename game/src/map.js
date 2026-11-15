// FOUNDRY NINE — the game's one map, an original dusk smelting plant. Three approaches
// (the Canal west, the Press Hall mid, the Foundry east) converge on the Crucible, a
// reactor pad in the north yard where the Spike is planted. Every solid is an AABB in
// `colliders` (bullets and bodies test the same list) with a mesh built beside it, and
// the waypoint graph the bots walk is laid over the lanes by hand. The furnace splits
// mid, the slab stack and pipe runs are the Canal's cover, the lava channels are
// glowing reference lines for callouts, and the Crucible ring (radius 6.5) is the
// plant zone. Beyond the walls, dead foundry blocks and chimneys stand in the haze.
//
// LAYOUT NOTES (metres; x east, z south — the Breakers spawn at the south edge,
// z 27-29, and attack north; the Wardens spawn at z -25..-27 and defend):
//   The Canal (west, x -20): a sunken channel running the map's full length —
//     nodes 15 (-20,16), 16 (-20,2), 17 (-20,-14), 18 (-16,-21). The longest
//     sightline on the map and the quiet flank; it surfaces at the site's west
//     door (node 10) or cuts mid through node 19 (-11.8,-12).
//   The Press Hall (mid, x 0): nodes 3 (0,13), 8 (0,-7), 9 (0,-11.5) — the
//     shortest route, pinched by the furnace block (x -3..3, z -14..-8) and
//     the mid gates (nodes 6 and 7 at x ±4.9, z 0), so mid is a sequence of
//     doorways and a fight, never an open corridor.
//   The Foundry (east, x 12..20): nodes 20 (20,20), 21 (11.8,6), 22 (14.7,-1),
//     23 (20,-14), 24 (14,-20) — crate cover and the reactor flank, entering
//     the site at its east door (node 11).
//   The Crucible (site, centre 0,-19, r 6.5): nodes 10 (-7,-19) west door,
//     11 (7,-19) east door, 12/13 (-4/4,-24.5) back corners, 14 (0,-24.8) the
//     Wardens' own door. Three entrances, no safe corner: planting is exposed
//     to at least two doors from every spot on the ring.
// WAYPOINT GRAPH: 27 nodes, 35 edges (NODES / EDGES below), BFS shortest paths
// (nextHop). HOLD_POINTS: Wardens hold nodes 10, 11, 8, 19, 24, 12 (both site
// doors, mid, the canal link, the east flank, the site's back corner);
// Breakers rally on 9, 6, 7, 3 (the furnace's north apron, both mid gates at
// x ±4.9, and mid-south).
// LIGHTING RIG: a warm directional sun (0xffc98a, 3.5) with 2048 px shadows, a
// cool fill (0x7d94b8, 0.7) against it, hemisphere sky/ground (1.28), and three
// accent points — the furnace's lava light (flickering), the reactor's teal
// ring light, a warm lamp over mid — so each lane has its own colour temperature.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const MAP_BOUND = 31;
export const SITE = { x: 0, z: -19, radius: 6.5 };

const NODES = [
  [0, 27], [-7, 20], [7, 20], [0, 13], [-6, 6], [6, 6], [-4.9, 0], [4.9, 0], [0, -7],
  [0, -11.5], [-7, -19], [7, -19], [-4, -24.5], [4, -24.5], [0, -24.8],
  [-20, 16], [-20, 2], [-20, -14], [-16, -21], [-11.8, -12],
  [20, 20], [11.8, 6], [14.7, -1], [20, -14], [14, -20], [-11.8, 17], [14, 20],
];
const EDGES = [
  [0, 1], [0, 2], [1, 3], [2, 3], [1, 25], [2, 26], [3, 4], [3, 5], [4, 6], [5, 7],
  [6, 8], [7, 8], [8, 9], [9, 10], [9, 11], [10, 12], [11, 13], [12, 14], [13, 14],
  [10, 19], [11, 24], [19, 17], [17, 16], [16, 15], [15, 25], [19, 8], [10, 18],
  [18, 17], [21, 22], [22, 24], [23, 24], [20, 21], [20, 26], [21, 26], [21, 5],
];
export const HOLD_POINTS = { wardens: [10, 11, 8, 19, 24, 12], breakers: [9, 6, 7, 3] };
export const SPAWNS = {
  breakers: [[-4, 27], [-2, 28], [2, 28], [4, 27], [0, 29]],
  wardens: [[-5, -25], [-2.5, -26], [2.5, -26], [5, -25], [0, -27]],
};

function groundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const g = canvas.getContext('2d');
  const toPx = (v) => ((v + 32) / 64) * 1024;
  g.fillStyle = '#3a4149';
  g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 9000; i += 1) {
    g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
    g.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2);
  }
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 2;
  for (let i = 0; i <= 8; i += 1) {
    g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, 1024); g.stroke();
    g.beginPath(); g.moveTo(0, i * 128); g.lineTo(1024, i * 128); g.stroke();
  }
  // the Canal: a dark water strip down the west side
  g.fillStyle = '#1d2b33';
  g.fillRect(toPx(-24), toPx(-24), toPx(-16) - toPx(-24), toPx(18) - toPx(-24));
  g.fillStyle = 'rgba(159,216,255,0.08)';
  for (let i = 0; i < 40; i += 1) g.fillRect(toPx(-24) + Math.random() * 128, Math.random() * 672, 18, 2);
  // the Crucible: painted plant ring and hazard ticks
  g.strokeStyle = '#ffb45e';
  g.lineWidth = 6;
  g.beginPath(); g.arc(toPx(SITE.x), toPx(SITE.z), (SITE.radius / 64) * 1024, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#ffb45e';
  g.font = 'bold 44px system-ui';
  g.textAlign = 'center';
  g.fillText('CRUCIBLE', toPx(0), toPx(-9.6));
  // lane guide lines
  g.strokeStyle = 'rgba(242,237,227,0.20)';
  g.lineWidth = 4;
  g.setLineDash([26, 20]);
  g.beginPath(); g.moveTo(toPx(0), toPx(30)); g.lineTo(toPx(0), toPx(-10)); g.stroke();
  g.beginPath(); g.moveTo(toPx(-20), toPx(20)); g.lineTo(toPx(-20), toPx(-18)); g.stroke();
  g.beginPath(); g.moveTo(toPx(20), toPx(24)); g.lineTo(toPx(20), toPx(-16)); g.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function buildMap(scene) {
  const colliders = [];
  const box = (x0, z0, x1, z1, height) => new THREE.Box3(
    new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, height, z1));

  const matWall = new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.85, metalness: 0.15 });
  const matWallDark = new THREE.MeshStandardMaterial({ color: PALETTE.wallDark, roughness: 0.9, metalness: 0.1 });
  const matTrim = new THREE.MeshStandardMaterial({ color: PALETTE.trim, roughness: 0.6, metalness: 0.4 });
  const matRust = new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 0.75, metalness: 0.3 });
  const matCrate = new THREE.MeshStandardMaterial({ color: PALETTE.crate, roughness: 0.95 });
  const matCrateDark = new THREE.MeshStandardMaterial({ color: PALETTE.crateDark, roughness: 0.95 });
  const matBarrel = new THREE.MeshStandardMaterial({ color: PALETTE.barrel, roughness: 0.55, metalness: 0.5 });

  function solid(x0, z0, x1, z1, height, material, trim = true) {
    colliders.push(box(x0, z0, x1, z1, height));
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(x1 - x0, height, z1 - z0),
      material);
    mesh.position.set((x0 + x1) / 2, height / 2, (z0 + z1) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (trim && height > 1.5) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.12, 0.14, z1 - z0 + 0.12), matTrim);
      cap.position.set((x0 + x1) / 2, height + 0.07, (z0 + z1) / 2);
      scene.add(cap);
    }
    return mesh;
  }
  function crate(x, z, size = 1.15, stack = 1) {
    for (let i = 0; i < stack; i += 1) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), i % 2 ? matCrateDark : matCrate);
      mesh.position.set(x, size / 2 + i * size, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
    colliders.push(box(x - size / 2, z - size / 2, x + size / 2, z + size / 2, size * stack));
  }
  function barrels(x, z, count = 3) {
    for (let i = 0; i < count; i += 1) {
      const bx = x + (i % 2) * 0.85;
      const bz = z + Math.floor(i / 2) * 0.85;
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.05, 14), matBarrel);
      mesh.position.set(bx, 0.53, bz);
      mesh.castShadow = true;
      scene.add(mesh);
    }
    colliders.push(box(x - 0.45, z - 0.45, x + 1.3, z + 1.3, 1.05));
  }

  // ground and apron
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(64, 64),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.94 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: PALETTE.groundDark, roughness: 1 }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.05;
  scene.add(apron);

  // perimeter
  solid(-32, -32, 32, -31, 4.4, matWallDark, false);
  solid(-32, 31, 32, 32, 4.4, matWallDark, false);
  solid(-32, -32, -31, 32, 4.4, matWallDark, false);
  solid(31, -32, 32, 32, 4.4, matWallDark, false);
  // west partitions and canal rail
  solid(-12.4, -26, -11.2, -21, 3.4, matWall);
  solid(-12.4, -8, -11.2, 14, 3.4, matWall);
  solid(-15.3, -18, -14.7, 12, 1.05, matRust, false);
  // east partitions
  solid(11.2, -14, 12.4, 2, 3.4, matWall);
  solid(11.2, 10, 12.4, 24, 3.4, matWall);
  // foundry block (east) and press machines (mid)
  solid(17, -6, 25, 4, 4.2, matWallDark);
  solid(-9.6, -1.6, -6.6, 1.6, 3.0, matRust);
  solid(6.6, -1.6, 9.6, 1.6, 3.0, matRust);
  // site back wall and mid-north low cover
  solid(-10, -28.5, 10, -27.5, 3.4, matWall);
  solid(-5.6, -7.0, -4.0, -6.0, 1.05, matRust, false);
  solid(4.0, -7.0, 5.6, -6.0, 1.05, matRust, false);
  // spawn cover
  solid(-3, 21.5, 3, 22.1, 1.05, matRust, false);
  solid(-3, -23.4, 3, -22.8, 1.05, matRust, false);
  // mid-south crate wall
  solid(-1.2, 6.8, 1.2, 8.0, 1.15, matCrate, false);

  // the furnace: a glowing core block at mid
  const furnace = new THREE.Mesh(
    new THREE.BoxGeometry(6.4, 4.4, 4.8),
    new THREE.MeshStandardMaterial({ color: PALETTE.furnace, roughness: 0.6, metalness: 0.5 }));
  furnace.position.set(0, 2.2, 0);
  furnace.castShadow = true;
  scene.add(furnace);
  colliders.push(box(-3.2, -2.4, 3.2, 2.4, 4.4));
  const lavaMat = new THREE.MeshStandardMaterial({
    color: PALETTE.lava, emissive: PALETTE.lava, emissiveIntensity: 2.3, roughness: 0.4 });
  for (const side of [-1, 1]) {
    const slit = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.34, 0.1), lavaMat);
    slit.position.set(0, 1.0, side * 2.46);
    scene.add(slit);
  }
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 5.5, 12), matWallDark);
  chimney.position.set(-1.8, 7.1, 0);
  scene.add(chimney);

  // the reactor on the Crucible pad
  const reactor = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 2.9, 4.6, 20),
    new THREE.MeshStandardMaterial({ color: PALETTE.furnace, roughness: 0.45, metalness: 0.6 }));
  reactor.position.set(SITE.x, 2.3, SITE.z);
  reactor.castShadow = true;
  scene.add(reactor);
  colliders.push(box(SITE.x - 2.6, SITE.z - 2.6, SITE.x + 2.6, SITE.z + 2.6, 4.6));
  const ringMat = new THREE.MeshStandardMaterial({
    color: PALETTE.warden, emissive: PALETTE.warden, emissiveIntensity: 1.6, roughness: 0.3 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.65, 0.09, 8, 40), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(SITE.x, 3.6, SITE.z);
  scene.add(ring);

  // cover dressing
  crate(5.6, -13.5); crate(-5.6, -13.5); crate(-7.5, -22.5, 1.15, 2); crate(7.5, -22.5);
  crate(-20, 6); crate(20, -12); crate(-6, 16.5); crate(24, 14, 1.15, 2); crate(-24, -8);
  barrels(-6, 10.5); barrels(6, 10.5); barrels(20, 12); barrels(-18, -19); barrels(8, -6);

  // the plant beyond the walls: dead foundry blocks and chimneys standing in the haze,
  // pure silhouette (no colliders) so stills get depth past the perimeter
  const matSkyline = new THREE.MeshStandardMaterial({ color: 0x252d37, roughness: 1 });
  for (const [x, z, w, h] of [[-58, -28, 15, 20], [-38, -58, 19, 30], [2, -64, 24, 25], [42, -56, 17, 33],
      [61, -14, 15, 19], [63, 26, 19, 27], [38, 59, 21, 23], [-6, 66, 25, 29], [-46, 56, 17, 21], [-63, 8, 15, 25]]) {
    const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.7), matSkyline);
    block.position.set(x, h / 2, z);
    scene.add(block);
  }
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0xff2a1a, emissive: 0xff2a1a, emissiveIntensity: 2.4 });
  for (const [x, z, h] of [[-52, -42, 34], [56, -47, 38]]) {
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.9, h, 10), matSkyline);
    stack.position.set(x, h / 2, z);
    scene.add(stack);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 8), beaconMat);
    beacon.position.set(x, h + 0.5, z);
    scene.add(beacon);
  }

  // lamp posts on the lanes
  const lampMat = new THREE.MeshStandardMaterial({
    color: PALETTE.lampWarm, emissive: PALETTE.lampWarm, emissiveIntensity: 2.6 });
  for (const [x, z] of [[-11, 18], [11, 16], [-20, -6], [20, 6], [0, -11]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 5.4, 8), matWallDark);
    pole.position.set(x, 2.7, z);
    scene.add(pole);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), lampMat);
    head.position.set(x, 5.5, z);
    scene.add(head);
  }

  // lights: low warm sun, a cool bounce fill off the east sky, sky fill, three practicals
  const sun = new THREE.DirectionalLight(0xffc98a, 3.5);
  sun.position.set(-38, 30, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -36; sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 36; sun.shadow.camera.bottom = -36;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x7d94b8, 0.7);
  fill.position.set(30, 22, -26);
  scene.add(fill);
  scene.add(new THREE.HemisphereLight(0x8fb4d8, 0x3a2f26, 1.28));
  const furnaceLight = new THREE.PointLight(PALETTE.lava, 60, 22, 1.8);
  furnaceLight.position.set(0, 2.4, 4.2);
  scene.add(furnaceLight);
  const reactorLight = new THREE.PointLight(PALETTE.warden, 40, 20, 1.8);
  reactorLight.position.set(SITE.x, 4.4, SITE.z);
  scene.add(reactorLight);
  const midLight = new THREE.PointLight(PALETTE.lampWarm, 26, 20, 1.8);
  midLight.position.set(0, 5.6, 12);
  scene.add(midLight);

  // waypoint adjacency
  const nodes = NODES.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const adjacency = nodes.map(() => []);
  for (const [a, b] of EDGES) { adjacency[a].push(b); adjacency[b].push(a); }

  let flicker = 0;
  return {
    colliders,
    nodes,
    adjacency,
    update(dt) {
      flicker += dt * 9;
      furnaceLight.intensity = 56 + Math.sin(flicker) * 7 + Math.sin(flicker * 2.7) * 4;
      ring.rotation.z += dt * 0.4;
    },
  };
}

// Next waypoint hop from `from` towards `goal` (BFS over the lane graph).
export function nextHop(map, from, goal) {
  if (from === goal) return goal;
  const prev = new Array(map.nodes.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const node = queue.shift();
    if (node === goal) break;
    for (const next of map.adjacency[node]) {
      if (prev[next] === -1) { prev[next] = node; queue.push(next); }
    }
  }
  if (prev[goal] === -1) return from;
  let node = goal;
  while (prev[node] !== from) node = prev[node];
  return node;
}

export function nearestNode(map, position) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < map.nodes.length; i += 1) {
    const d = map.nodes[i].distanceToSquared(position);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}
