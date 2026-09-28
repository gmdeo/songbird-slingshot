// Scene, sky, sun and live weather for Hollins Cross.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { sunPosition, bearingVector } from './geo.js';

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.55;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

/**
 * Sky, fog, hemisphere + sun with shadow camera that follows the action.
 * Sun position is computed for the real time of day at Hollins Cross,
 * clamped so the scene is always playable (night becomes a low golden dusk).
 */
export function createEnvironment(scene, origin) {
  const sky = new Sky();
  sky.scale.setScalar(40000);
  scene.add(sky);
  const u = sky.material.uniforms;
  u.turbidity.value = 6; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;

  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a5a30, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 900;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);

  scene.fog = new THREE.FogExp2(0xbfd2e0, 0.00011);

  const env = { sky, sun, hemi, sunDir: new THREE.Vector3(), real: null, weather: null };

  env.setTime = (date) => {
    const real = sunPosition(date, origin.lat, origin.lon);
    env.real = real;
    // Keep it playable: never below 6 degrees; at night show a warm dusk from the west.
    const alt = real.altitude < 6 ? 6 : real.altitude;
    const az = real.altitude < 6 ? 250 : real.azimuth;
    const phi = THREE.MathUtils.degToRad(90 - alt);
    const b = bearingVector(az);
    env.sunDir.set(b.x * Math.sin(phi), Math.cos(phi), b.z * Math.sin(phi)).normalize();
    u.sunPosition.value.copy(env.sunDir);
    const warm = THREE.MathUtils.clamp((25 - alt) / 20, 0, 1);
    sun.color.setRGB(1, 0.95 - warm * 0.25, 0.88 - warm * 0.45);
    sun.intensity = 1.6 + (1 - warm) * 1.4;
    hemi.intensity = 0.55 + (1 - warm) * 0.45;
  };

  env.applyWeather = (w) => {
    env.weather = w;
    const cloud = (w?.cloud ?? 30) / 100;
    u.turbidity.value = 4 + cloud * 10;
    u.rayleigh.value = 1.8 - cloud * 1.2;
    scene.fog.density = 0.00008 + cloud * 0.00012 + (w?.rain ? 0.0001 : 0);
    sun.intensity *= 1 - cloud * 0.45;
  };

  // Follow a focus point so shadows stay crisp wherever the action is.
  env.follow = (p) => {
    sun.position.copy(p).addScaledVector(env.sunDir, 400);
    sun.target.position.copy(p);
    sun.target.updateMatrixWorld();
  };

  env.setTime(new Date());
  return env;
}

// Live weather at Hollins Cross from Open-Meteo (no key needed). Falls back quietly.
export async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,temperature_2m&wind_speed_unit=ms';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const c = j.current;
    return {
      live: true, speed: c.wind_speed_10m, from: c.wind_direction_10m, cloud: c.cloud_cover,
      rain: c.precipitation > 0.1, temp: c.temperature_2m, time: c.time,
    };
  } catch {
    return { live: false, speed: 4, from: 240, cloud: 40, rain: false, temp: null, time: null };
  }
}
