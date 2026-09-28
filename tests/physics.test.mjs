// Verifies the cannon-es heightfield lines up with the real terrain sampler, and that
// bodies dropped on it come to rest at the real ground height.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as CANNON from 'cannon-es';
import { makeHeightSampler } from '../src/geo.js';
import { createWorld } from '../src/physics.js';

const dir = new URL('../public/data/', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('meta.json', dir)));
const near = new Uint16Array(readFileSync(new URL('near.bin', dir)).buffer.slice(0));
const heightAt = makeHeightSampler(near, meta.nearN, meta.nearHalf);

test('real terrain: Hollins Cross saddle is about 380 m', () => {
  const h = heightAt(0, 0);
  assert.ok(h > 360 && h < 400, `got ${h}`);
});

test('spheres dropped across the arena rest on the real ground (collider matches terrain)', () => {
  const { world } = createWorld({ heightAt });
  const pts = [[0, 0], [150, -80], [-160, 60], [60, 180], [-200, -150], [300, 300], [-300, -300]];
  for (const [x, z] of pts) {
    const b = new CANNON.Body({ mass: 5, shape: new CANNON.Sphere(0.5) });
    b.position.set(x, heightAt(x, z) + 3, z);
    world.addBody(b);
    for (let i = 0; i < 240; i++) world.step(1 / 120);
    const rest = b.position.y - heightAt(b.position.x, b.position.z);
    assert.ok(Math.abs(rest - 0.5) < 0.25, `at ${x},${z} sphere centre ${rest.toFixed(2)} m above ground`);
    world.removeBody(b);
  }
});

test('a dropped box settles on the real ground', () => {
  const { world } = createWorld({ heightAt });
  const x = 120, z = -90;
  const box = new CANNON.Body({ mass: 10, shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)) });
  box.position.set(x, heightAt(x, z) + 10, z);
  world.addBody(box);
  for (let i = 0; i < 600; i++) world.step(1 / 120);
  const rest = box.position.y - heightAt(box.position.x, box.position.z);
  assert.ok(rest > 0.2 && rest < 1.4, `box rests ${rest.toFixed(2)} m above ground`);
});
