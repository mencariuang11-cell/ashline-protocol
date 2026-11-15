// The player's body: acceleration and friction movement with crouch and jump, resolved
// as a box against the map colliders one axis at a time, plus health. Tactical movement
// rules live here — you are fastest with the sidearm out, slower crouched, and your
// accuracy (in weapons.js) is priced from the speed this module reports.
import * as THREE from 'three';
import { bodyOverlaps } from './collision.js';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.3;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 40;
const AIR_ACCEL = 8;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.1;

export function createPlayer(colliders) {
  const body = {
    position: new THREE.Vector3(0, 0, 27),
    velocity: new THREE.Vector3(),
    yaw: 0,                 // face north (-z), towards the site
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
    hp: 100,
    alive: true,
    stepDistance: 0,        // accumulates for footstep sounds
    landed: false,          // set on the frame a fall lands
  };
  const wish = new THREE.Vector3();

  function look(dx, dy, sensitivity = 0.0021) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
  }
  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }
  function groundSpeed() {
    return Math.hypot(body.velocity.x, body.velocity.z);
  }

  function step(dt, keys, speedScale = 1) {
    const wantCrouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (wantCrouch && !body.crouching) {
      body.crouching = true;
      body.height = CROUCH_HEIGHT;
    } else if (!wantCrouch && body.crouching &&
        !bodyOverlaps(colliders, body.position.x, body.position.y, body.position.z, RADIUS, STAND_HEIGHT, 0.02)) {
      body.crouching = false;
      body.height = STAND_HEIGHT;
    }
    const eyeTarget = body.crouching ? CROUCH_EYE : STAND_EYE;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }
    const speed = (body.crouching ? CROUCH_SPEED : WALK_SPEED) * speedScale;
    const blend = Math.min(1, (body.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / Math.max(1, speed));
    body.velocity.x += (wish.x * speed - body.velocity.x) * blend;
    body.velocity.z += (wish.z * speed - body.velocity.z) * blend;
    if (body.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }
    if (keys.has('Space') && body.onGround && !body.crouching) {
      body.velocity.y = JUMP_SPEED;
      body.onGround = false;
    }
    body.velocity.y -= GRAVITY * dt;

    const nextX = body.position.x + body.velocity.x * dt;
    if (!bodyOverlaps(colliders, nextX, body.position.y, body.position.z, RADIUS, body.height, 0.04)) body.position.x = nextX;
    else body.velocity.x = 0;
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!bodyOverlaps(colliders, body.position.x, body.position.y, nextZ, RADIUS, body.height, 0.04)) body.position.z = nextZ;
    else body.velocity.z = 0;

    const fallSpeed = body.velocity.y;
    body.position.y += body.velocity.y * dt;
    body.landed = false;
    body.onGround = false;
    const hit = bodyOverlaps(colliders, body.position.x, body.position.y, body.position.z, RADIUS, body.height, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      body.onGround = true;
      if (fallSpeed < -7) body.landed = true;
    } else if (hit) {
      body.position.y = hit.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
      if (fallSpeed < -7) body.landed = true;
    }
    body.velocity.y = Math.max(-30, body.velocity.y);
    if (body.onGround) body.stepDistance += groundSpeed() * dt;
  }

  return {
    body,
    step,
    look,
    recoil,
    groundSpeed,
    reset(spawn, yaw) {
      body.position.copy(spawn);
      body.velocity.set(0, 0, 0);
      body.yaw = yaw;
      body.pitch = 0;
      body.hp = 100;
      body.alive = true;
      body.crouching = false;
      body.height = STAND_HEIGHT;
      body.eye = STAND_EYE;
    },
  };
}
