// Entry point: wiring, input (drag to swivel, drag to pull, tap for power), main loop.
import * as THREE from 'three';
import { loadTerrainData, buildTerrain } from './terrain.js';
import { createRenderer, createEnvironment, fetchWeather } from './world.js';
import { Game } from './game.js';
import { UI, showScreen, hideScreens } from './ui.js';
import { BIRDS, LEVELS, SQUIRREL } from './data.js';
import { initAudio, setEnabled, isEnabled } from './audio.js';
import { bearingVector } from './geo.js';

const canvas = document.getElementById('game');
const loading = document.getElementById('loading');
const setLoad = (t) => { loading.textContent = t; };

async function main() {
  setLoad('Reading real terrain (Environment Agency / Copernicus)…');
  const data = await loadTerrainData('/data/');

  const renderer = createRenderer(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 30000);
  const env = createEnvironment(scene, data.meta.origin);

  setLoad('Building the Great Ridge…');
  await buildTerrain(scene, data, renderer, '/data/');

  setLoad('Placing the camps…');
  const ui = new UI({ data, camps: [], score: 0, squirrelInfo: SQUIRREL });
  const game = new Game({ scene, camera, renderer, env, data, ui: null });
  // UI needs the game for compass + pops; wire after construction.
  ui.game = game;
  game.ui = ui;
  ui.buildCompassTape();
  game.squirrelInfo = SQUIRREL;

  // ---------------- live weather and real time of day
  const meta = data.meta;
  const w = await fetchWeather(meta.origin.lat, meta.origin.lon);
  game.setWeather(w);
  ui.setWeather(w);
  env.setTime(w.time ? new Date(w.time + 'Z') : new Date());
  env.applyWeather(w);
  game.timeLabel = w.time || null;

  // ---------------- input
  const clock = new THREE.Clock();
  let pointer = null; // { id, x0, y0, x, y, mode }
  const PULL_SCALE = Math.min(window.innerWidth, window.innerHeight) * 0.34;

  function localPointer(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (pointer) return;
    initAudio();
    const p = localPointer(e);
    pointer = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, mode: null, moved: 0, t0: performance.now() };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointer || e.pointerId !== pointer.id) return;
    const p = localPointer(e);
    const dx = p.x - pointer.x0, dy = p.y - pointer.y0;
    pointer.moved = Math.max(pointer.moved, Math.hypot(dx, dy));
    if (!pointer.mode) {
      if (pointer.moved < 10) return;
      const cam = game.camMode;
      // Starting a drag on the bird pulls; anywhere else swivels the view.
      pointer.mode = (cam === 'aim' && game.canPull() && inSlingshotZone(pointer.x0, pointer.y0)) ? 'pull' : 'swivel';
      if (pointer.mode === 'pull') game.startPull();
      if (pointer.mode === 'swivel') canvas.style.cursor = 'grabbing';
    }
    if (pointer.mode === 'pull') game.updatePull(p.x - pointer.x0, p.y - pointer.y0, PULL_SCALE);
    else if (pointer.mode === 'swivel') {
      game.swivel(-(p.x - pointer.x) * 0.28, (p.y - pointer.y) * 0.12);
      pointer.x = p.x; pointer.y = p.y;
    } else { pointer.x = p.x; pointer.y = p.y; }
  });

  function endPointer(e) {
    if (!pointer || e.pointerId !== pointer.id) return;
    const dt = performance.now() - pointer.t0;
    if (pointer.mode === 'pull') game.release();
    else if (!pointer.mode && dt < 320 && game.state === 'flying') {
      // a quick tap during flight triggers the power
      game.usePower();
    }
    if (game.state === 'ready' && pointer.mode === 'swivel') { /* keep heading */ }
    canvas.style.cursor = 'grab';
    pointer = null;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', (e) => { game.cancelPull(); pointer = null; });

  function inSlingshotZone(px, py) {
    const v = game.pouch.clone().project(camera);
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const r = Math.min(window.innerWidth, window.innerHeight) * 0.22;
    return Math.hypot(px - sx, py - sy) < r;
  }

  // keyboard: arrows swivel, space pulls the last-used strength, 1-5 pick a bird, F fires
  const held = new Set();
  window.addEventListener('keydown', (e) => {
    held.add(e.key);
    initAudio();
    if (e.key === ' ') e.preventDefault();
    if (e.key === 'f' || e.key === 'F') {
      if (game.state === 'ready') {
        game.state = 'pulling';
        game.pull = { x: 0, y: 0.62, len: 0.78 };
        game.release();
      }
    }
    if (e.key === 'Escape') { hideScreens(); }
    if (e.key === 'g' || e.key === 'G') showScreen('guide');
  });
  window.addEventListener('keyup', (e) => held.delete(e.key));

  function keys(dt) {
    const s = 55 * dt;
    if (held.has('ArrowLeft') || held.has('a')) game.swivel(-s);
    if (held.has('ArrowRight') || held.has('d')) game.swivel(s);
    if (held.has('ArrowUp') || held.has('w')) game.swivel(0, s * 0.35);
    if (held.has('ArrowDown') || held.has('s')) game.swivel(0, -s * 0.35);
  }

  // ---------------- buttons
  const on = (id, fn) => document.getElementById(id).addEventListener('click', (e) => { initAudio(); fn(e); });
  on('btn-play', () => { hideScreens(); game.loadLevel(pickStartLevel(ui)); });
  on('btn-guide', () => showScreen('guide'));
  on('btn-guide-back', () => showScreen('title'));
  on('btn-levels', () => { ui.buildLevelGrid(); showScreen('levels'); });
  on('btn-levels-back', () => showScreen('title'));
  on('btn-menu', () => { ui.buildLevelGrid(); showScreen('levels'); });
  on('btn-restart', () => game.loadLevel(game.levelIdx || 0));
  on('btn-sound', (e) => {
    setEnabled(!isEnabled());
    e.currentTarget.textContent = isEnabled() ? '♪' : '🔇';
    e.currentTarget.setAttribute('aria-pressed', String(isEnabled()));
  });
  on('btn-r-retry', () => { hideScreens(); game.loadLevel(game.levelIdx || 0); });
  on('btn-r-levels', () => { ui.buildLevelGrid(); showScreen('levels'); });
  on('btn-r-next', () => {
    hideScreens();
    const next = Math.min(LEVELS.length - 1, (game.levelIdx || 0) + 1);
    game.loadLevel(next);
  });

  function pickStartLevel(ui2) {
    let idx = 0;
    for (const L of LEVELS) if (ui2.stars[L.id]) idx = Math.min(L.id, LEVELS.length - 1);
    return idx;
  }

  // guide thumbnails: render each bird and the squirrel to a small canvas
  drawGuideThumbs();

  // ---------------- resize
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------------- main loop
  showScreen('title');
  document.getElementById('hud').style.display = 'none';
  setTimeout(() => { document.getElementById('hud').style.display = ''; }, 10);

  // preview the world behind the title screen
  game.loadLevel(pickStartLevel(ui));
  ui.setTip('Explore: drag the sky to swivel around. Your camps are marked in red on the compass.');

  let prev = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
    keys(dt);
    game.update(dt, now / 1000);
    ui.updateCompass(game.yaw);
    const t = game.flying[0] || game.activeBird;
    ui.setDamage(t ? 0 : 0);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  loading.style.display = 'none';

  // expose for debugging and for the automated checks
  window.SB = { game, scene, camera, renderer, env, ui, data };

  function drawGuideThumbs() {
    const w = 128, h = 128;
    const r2 = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r2.setSize(w, h);
    const sc = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(28, 1, 1, 400);
    sc.add(new THREE.HemisphereLight(0xffffff, 0x334422, 1.5));
    const d = new THREE.DirectionalLight(0xffffff, 2.0); d.position.set(4, 8, 6); sc.add(d);
    const items = [];
    Promise.all([import('./models.js')]).then(([m]) => {
      for (const k of Object.keys(BIRDS)) items.push([`[data-bird="${k}"]`, m.makeBird(k), 9]);
      items.push(['[data-squirrel]', m.makeSquirrel(), 9]);
      for (const [sel, obj, dist] of items) {
        const cv = document.querySelector(sel);
        if (!cv) continue;
        sc.clear();
        sc.add(obj);
        obj.rotation.y = Math.PI * 1.15;
        cam.position.set(0, 0, dist); cam.lookAt(0, 0, 0);
        r2.render(sc, cam);
        cv.getContext('2d').drawImage(r2.domElement, 0, 0, cv.width, cv.height);
        sc.remove(obj);
      }
      r2.dispose();
    });
  }
}

main().catch((e) => {
  console.error(e);
  loading.textContent = 'Could not start: ' + e.message;
  loading.style.color = '#fff';
});
