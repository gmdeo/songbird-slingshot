// Squirrel camps: physics blocks + squirrels placed on the real terrain.
import * as THREE from 'three';
import { CANNON } from './physics.js';
import { MATERIALS, SQUIRREL_MASS, SQUIRREL_HEALTH } from './data.js';
import { bearingVector } from './geo.js';
import { makeSquirrel } from './models.js';

// Templates are lists of blocks in camp-local metres: [x, y(base), z, w, h, d, kind]
// kind: 'post' | 'plank' | 'block' | 'squirrel'. x runs across the line of fire, z away from the player.
const T = 3.5;
function frame(x, base, w, h, depth = 6.0) {
  const o = w / 2 - T / 2;
  return [
    [x - o, base, -depth / 2 + T / 2, T, h, T, 'post'], [x + o, base, -depth / 2 + T / 2, T, h, T, 'post'],
    [x - o, base, depth / 2 - T / 2, T, h, T, 'post'], [x + o, base, depth / 2 - T / 2, T, h, T, 'post'],
    [x, base + h, 0, w + 0.3, T, depth + 0.3, 'plank'],
  ];
}
function tower(x, floors, w, h, squirrelOn) {
  const out = []; let base = 0;
  for (let f = 0; f < floors; f++) {
    if (squirrelOn.includes(f)) out.push([x, base, 0, 0, 0, 0, 'squirrel']);
    out.push(...frame(x, base, w, h));
    base += h + T;
  }
  if (squirrelOn.includes(floors)) out.push([x, base, 0, 0, 0, 0, 'squirrel']);
  return out;
}
export const TEMPLATES = {
  hut: (x) => tower(x, 1, 32, 24, [0, 1]),
  tower1: (x) => tower(x, 1, 24, 30, [1]),
  tower2: (x) => tower(x, 2, 26, 24, [0, 2]),
  tower3: (x) => tower(x, 3, 26, 22, [1, 3]),
  wall: (x) => [
    [x - 16, 0, 0, 14, 11, 10, 'block'], [x, 0, 0, 14, 11, 10, 'block'], [x + 16, 0, 0, 14, 11, 10, 'block'],
    [x - 8, 11, 0, 14, 10, 10, 'block'], [x + 8, 11, 0, 14, 10, 10, 'block'],
    [x, 21, 0, 0, 0, 0, 'squirrel'],
  ],
  barn: (x) => [
    ...frame(x, 0, 60, 30, 40),
    [x - 15, 30 + T, 0, 0, 0, 0, 'squirrel'], [x + 15, 30 + T, 0, 0, 0, 0, 'squirrel'],
    [x, 0, 0, 0, 0, 0, 'squirrel'],
    [x, 30 + T, -12, 56, 4.5, 8, 'roof'], [x, 30 + T, 12, 56, 4.5, 8, 'roof'],
  ],
};

const geoCache = new Map();
function boxGeo(w, h, d) {
  const k = `${w}|${h}|${d}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(k);
}
const matCache = new Map();
function matFor(mKey) {
  if (!matCache.has(mKey)) {
    const m = MATERIALS[mKey];
    matCache.set(mKey, new THREE.MeshStandardMaterial({ color: m.color, roughness: m.rough, flatShading: mKey === 'stone' }));
  }
  return matCache.get(mKey);
}

/**
 * Build one camp. Returns { centre, bearing, blocks, squirrels }.
 * Every block/squirrel has { mesh, body, health, maxHealth, score, kind, alive }.
 */
export function buildCamp(scene, world, data, camp) {
  const dir = bearingVector(camp.bearing);
  const cx = dir.x * camp.dist, cz = dir.z * camp.dist;
  // Camp frame: 'forward' points away from the slingshot, 'right' across.
  const fwd = new THREE.Vector3(dir.x, 0, dir.z);
  const right = new THREE.Vector3(-dir.z, 0, dir.x);
  const yaw = Math.atan2(-dir.x, -dir.z) + Math.PI;
  const q = new CANNON.Quaternion().setFromEuler(0, yaw, 0);
  const tq = new THREE.Quaternion(q.x, q.y, q.z, q.w);

  // Flatten a pad: use the highest ground under the footprint so nothing is buried.
  let padY = -Infinity;
  for (let a = -9; a <= 9; a += 3) for (let b = -3; b <= 3; b += 3) {
    padY = Math.max(padY, data.heightAt(cx + right.x * a + fwd.x * b, cz + right.z * a + fwd.z * b));
  }
  const ground = data.heightAt(cx, cz);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(13, 14, Math.max(0.6, padY - ground + 1.2), 20),
    new THREE.MeshStandardMaterial({ color: 0x6d7a45, roughness: 1 }));
  pad.position.set(cx, (padY + ground) / 2 - 0.5, cz);
  pad.receiveShadow = true; scene.add(pad);
  const padBody = new CANNON.Body({ mass: 0, shape: new CANNON.Cylinder(13, 14, Math.max(0.6, padY - ground + 1.2), 12) });
  padBody.position.set(cx, pad.position.y, cz);
  padBody.userData = { kind: 'ground' };
  world.addBody(padBody);
  const topY = pad.position.y + pad.geometry.parameters.height / 2;

  const blocks = [], squirrels = [];
  const toWorld = (lx, ly, lz) => new THREE.Vector3(cx + right.x * lx + fwd.x * lz, topY + ly, cz + right.z * lx + fwd.z * lz);

  for (const [tpl, off, mKey] of camp.build) {
    for (const [x, y, z, w, h, d, kind] of TEMPLATES[tpl](off)) {
      if (kind === 'squirrel') {
        const r = 0.9;
        const p = toWorld(x, y + r + 0.02, z);
        const body = new CANNON.Body({ mass: SQUIRREL_MASS, shape: new CANNON.Sphere(r), linearDamping: 0.1, angularDamping: 0.6 });
        body.position.set(p.x, p.y, p.z);
        body.allowSleep = true; body.sleepSpeedLimit = 0.25; body.sleep();
        const mesh = makeSquirrel();
        mesh.position.copy(p);
        mesh.quaternion.copy(tq).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
        scene.add(mesh); world.addBody(body);
        const s = { kind: 'squirrel', mesh, body, health: SQUIRREL_HEALTH, maxHealth: SQUIRREL_HEALTH, alive: true, r, camp: camp.name, baseQ: mesh.quaternion.clone() };
        body.userData = s; squirrels.push(s);
        continue;
      }
      const matKey = kind === 'roof' ? 'stone' : mKey === 'stone' && kind !== 'block' ? 'wood' : mKey;
      const m = MATERIALS[matKey];
      const vol = w * h * d;
      const p = toWorld(x, y + h / 2 + 0.01, z);
      const body = new CANNON.Body({ mass: m.density * vol, shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)) });
      body.position.set(p.x, p.y, p.z); body.quaternion.copy(q);
      body.allowSleep = true; body.sleepSpeedLimit = 0.2; body.sleep();
      const mesh = new THREE.Mesh(boxGeo(w, h, d), matFor(matKey));
      mesh.position.copy(p); mesh.quaternion.copy(tq);
      mesh.castShadow = true; mesh.receiveShadow = true;
      scene.add(mesh); world.addBody(body);
      const hp = m.health * Math.max(0.25, vol);
      const blk = { kind: 'block', mat: matKey, mesh, body, health: hp, maxHealth: hp, alive: true, score: m.score, camp: camp.name };
      body.userData = blk; blocks.push(blk);
    }
  }
  return { name: camp.name, bearing: camp.bearing, dist: camp.dist, centre: new THREE.Vector3(cx, topY, cz), blocks, squirrels, pad, padBody };
}

export function disposeCamp(scene, world, camp) {
  for (const o of [...camp.blocks, ...camp.squirrels]) {
    if (o.mesh.parent) scene.remove(o.mesh);
    if (o.body.world) world.removeBody(o.body);
  }
  scene.remove(camp.pad); world.removeBody(camp.padBody);
  camp.pad.geometry.dispose();
}
