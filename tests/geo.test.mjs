import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bearingTo, bearingVector, compassName, angleDiff, windVector, sunPosition, pointInPolygon, impactEnergy, starsFor, makeHeightSampler } from '../src/geo.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('bearings: north is -z, east is +x', () => {
  close(bearingTo(0, -10), 0);
  close(bearingTo(10, 0), 90);
  close(bearingTo(0, 10), 180);
  close(bearingTo(-10, 0), 270);
  const v = bearingVector(90); close(v.x, 1); close(v.z, 0);
  for (const b of [0, 37, 145, 250, 359]) { const u = bearingVector(b); close(bearingTo(u.x, u.z), b, 1e-9); }
});

test('compass names and angle wrap', () => {
  assert.equal(compassName(0), 'N');
  assert.equal(compassName(359), 'N');
  assert.equal(compassName(225), 'SW');
  close(angleDiff(10, 350), 20);
  close(angleDiff(350, 10), -20);
});

test('wind from the west blows towards the east', () => {
  const w = windVector(5, 270);
  close(w.x, 5); close(w.z, 0);
});

test('sun: midsummer noon in Derbyshire is high in the south', () => {
  // 21 June 2026 12:07 UTC, roughly solar noon at 1.8 W
  const s = sunPosition(new Date(Date.UTC(2026, 5, 21, 12, 7)), 53.357, -1.797);
  assert.ok(s.altitude > 58 && s.altitude < 62, `alt ${s.altitude}`);
  assert.ok(Math.abs(angleDiff(s.azimuth, 180)) < 5, `az ${s.azimuth}`);
  const night = sunPosition(new Date(Date.UTC(2026, 11, 21, 0, 0)), 53.357, -1.797);
  assert.ok(night.altitude < -50, `midnight alt ${night.altitude}`);
});

test('point in polygon, impact energy, stars', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(pointInPolygon(5, 5, sq), true);
  assert.equal(pointInPolygon(15, 5, sq), false);
  close(impactEnergy(2, 0, 10), 100); // static partner: full 1/2 m v^2
  close(impactEnergy(2, 2, 10), 50);  // equal masses: reduced mass halves it
  assert.equal(starsFor(2, 3), 3);
  assert.equal(starsFor(1, 3), 2);
  assert.equal(starsFor(0, 3), 1);
});

test('height sampler interpolates and clamps', () => {
  const g = new Uint16Array([0, 100, 200, 300]); // 2x2 grid, decimetres
  const h = makeHeightSampler(g, 2, 10);
  close(h(-10, -10), 0); close(h(10, -10), 10, 1e-3); close(h(0, 0), 15); close(h(99, 99), 30, 1e-3);
});
