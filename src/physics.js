// Physics: cannon-es world with the real near-terrain as a heightfield collider.
import * as CANNON from 'cannon-es';
import { PHYS } from './data.js';

export function createWorld(data) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, PHYS.gravity, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.solver.iterations = 12;
  world.defaultContactMaterial.friction = 0.6;
  world.defaultContactMaterial.restitution = 0.12;

  // Heightfield over +-HF_HALF metres around the slingshot at 2 m spacing.
  const HF_HALF = 420, STEP = 2;
  const n = Math.round((HF_HALF * 2) / STEP) + 1;
  const matrix = [];
  // cannon Heightfield: matrix[i][j], i along local x, j along local y. We rotate the
  // body -90deg about X so local y maps to world -z.
  for (let i = 0; i < n; i++) {
    const row = [];
    const x = -HF_HALF + i * STEP;
    for (let j = 0; j < n; j++) {
      const z = HF_HALF - j * STEP;
      row.push(data.heightAt(x, z));
    }
    matrix.push(row);
  }
  const hf = new CANNON.Heightfield(matrix, { elementSize: STEP });
  const ground = new CANNON.Body({ mass: 0, material: new CANNON.Material('ground') });
  ground.addShape(hf);
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  ground.position.set(-HF_HALF, 0, HF_HALF);
  ground.userData = { kind: 'ground' };
  world.addBody(ground);

  return { world, ground, HF_HALF };
}

export { CANNON };
