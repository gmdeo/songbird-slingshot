// Pure geography helpers. No three.js here so they can be unit-tested in Node.
// World axes (three.js): x = east metres, z = south metres, y = up.

const RAD = Math.PI / 180;

/** Compass bearing (0 = north, clockwise) from origin to a local (x, z) point. */
export function bearingTo(x, z) {
  return ((Math.atan2(x, -z) / RAD) + 360) % 360;
}

/** Unit vector on the ground plane pointing along a compass bearing. */
export function bearingVector(deg) {
  return { x: Math.sin(deg * RAD), z: -Math.cos(deg * RAD) };
}

const POINTS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compassName(deg) {
  return POINTS16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/** Smallest signed angle a - b in degrees, range (-180, 180]. */
export function angleDiff(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * Meteorological wind (direction it blows FROM) to a ground vector in m/s
 * pointing where the air is going.
 */
export function windVector(speed, fromDeg) {
  const v = bearingVector(fromDeg + 180);
  return { x: v.x * speed, z: v.z * speed };
}

/**
 * Approximate solar position (good to ~0.5 degrees, enough for lighting).
 * Returns altitude above horizon and azimuth from north, clockwise, in degrees.
 */
export function sunPosition(date, lat, lon) {
  const d = date.getTime() / 86400000 - 10957.5; // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmstH = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const ha = (gmstH * 15 + lon) * RAD - ra;
  const phi = lat * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return { altitude: alt / RAD, azimuth: ((az / RAD) + 360) % 360 };
}

/**
 * Bilinear height sampler over a square grid.
 * grid: Uint16Array of decimetres, N x N, row j runs north->south (z), column i west->east (x).
 * Returns height in metres, clamped at the edges.
 */
export function makeHeightSampler(grid, n, half) {
  const scale = (n - 1) / (2 * half);
  const at = (i, j) => grid[j * n + i] / 10;
  return function heightAt(x, z) {
    let fi = (x + half) * scale;
    let fj = (z + half) * scale;
    fi = Math.min(Math.max(fi, 0), n - 1.000001);
    fj = Math.min(Math.max(fj, 0), n - 1.000001);
    const i = Math.floor(fi), j = Math.floor(fj);
    const a = fi - i, b = fj - j;
    return at(i, j) * (1 - a) * (1 - b) + at(i + 1, j) * a * (1 - b)
      + at(i, j + 1) * (1 - a) * b + at(i + 1, j + 1) * a * b;
  };
}

/** Ray-casting point-in-polygon test. poly: array of [x, z]. */
export function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Deterministic PRNG (mulberry32) so tree placement is identical every load. */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Kinetic energy exchanged in a collision, using reduced mass. Infinite mass = static. */
export function impactEnergy(m1, m2, speed) {
  const a = m1 > 0 ? m1 : Infinity, b = m2 > 0 ? m2 : Infinity;
  const mu = a === Infinity ? b : b === Infinity ? a : (a * b) / (a + b);
  return 0.5 * mu * speed * speed;
}

/** 1-3 stars from birds left unused. */
export function starsFor(birdsLeft, birdsTotal) {
  if (birdsLeft >= Math.ceil(birdsTotal / 2)) return 3;
  if (birdsLeft >= 1) return 2;
  return 1;
}
