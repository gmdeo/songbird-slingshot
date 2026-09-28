// Game controller: swivel camera, slingshot, flight, powers, damage, scoring.
import * as THREE from 'three';
import { CANNON, createWorld } from './physics.js';
import { BIRDS, BIRD_MASS, LEVELS, PHYS, SCORE } from './data.js';
import { bearingTo, bearingVector, angleDiff, windVector, impactEnergy, starsFor } from './geo.js';
import { makeBird, makeSlingshot } from './models.js';
import { buildCamp, disposeCamp } from './camps.js';
import * as sfx from './audio.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

export class Game {
  constructor({ scene, camera, renderer, env, data, ui }) {
    Object.assign(this, { scene, camera, renderer, env, data, ui });
    const { world } = createWorld(data);
    this.world = world;
    this.wind = { x: 0, z: 0, speed: 0, from: 0 };

    // Slingshot stands on the Hollins Cross saddle.
    this.slingPos = new THREE.Vector3(0, data.heightAt(0, 0), 0);
    this.elevY = 0.45; // ~33 degrees

    this.sling = makeSlingshot();
    this.sling.position.copy(this.slingPos);
    scene.add(this.sling);
    const bandMat = new THREE.LineBasicMaterial({ color: 0x3a2618 });
    this.bands = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]), bandMat);
    this.bands.frustumCulled = false;
    scene.add(this.bands);
    this.pouch = new THREE.Vector3();

    // Aim line: dotted predicted arc
    const dotGeo = new THREE.SphereGeometry(0.12, 6, 4);
    this.dots = new THREE.InstancedMesh(dotGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }), 60);
    this.dots.frustumCulled = false; this.dots.visible = false;
    scene.add(this.dots);

    // Camera rig: yaw = compass heading the slingshot faces; pitch = tilt of the view.
    this.yaw = 250; this.pitch = 8; this.targetYaw = 250;
    this.camMode = 'aim'; // aim | follow | scout
    this.followT = 0;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();

    this.level = null; this.camps = []; this.birdsQueue = []; this.flying = []; this.score = 0;
    this.state = 'idle'; // idle | ready | pulling | flying | settling | won | lost
    this.pull = null; // {x, y} normalised drag vector
    this.effects = [];
    this.powerUsed = false;
    this.settleTimer = 0;
    this.accum = 0;

    world.addEventListener('postStep', () => this._pendingBreaks && this._flushBreaks());
    this._pendingBreaks = [];
  }

  setWeather(w) {
    const v = windVector(w.speed, w.from);
    this.wind = { x: v.x, z: v.z, speed: w.speed, from: w.from };
    sfx.setWindLevel(w.speed);
  }

  // ------------------------------------------------------------------ levels
  loadLevel(idx) {
    this.clearLevel();
    const L = LEVELS[idx];
    this.levelIdx = idx; this.level = L;
    this.camps = L.camps.map((c) => buildCamp(this.scene, this.world, this.data, c));
    for (const c of this.camps) for (const o of [...c.blocks, ...c.squirrels]) this._watch(o);
    this.birdsQueue = [...L.birds];
    this.birdsTotal = L.birds.length;
    this.score = 0;
    // Face the first camp's direction... but start slightly off so the player learns to swivel.
    this.targetYaw = this.yaw = (L.camps[0].bearing + (idx === 1 ? 180 : 0)) % 360;
    this.pitch = 6;
    this.camMode = 'aim';
    this.state = 'ready';
    this.snapCam = true;
    this._loadNextBird();
    this.ui.onLevelStart(L, this.camps);
  }

  clearLevel() {
    for (const c of this.camps) disposeCamp(this.scene, this.world, c);
    this.camps = [];
    for (const b of this.flying) this._removeBird(b);
    this.flying = [];
    this.activeBird = null;
    if (this.readyBird) { this.scene.remove(this.readyBird.mesh); this.readyBird = null; }
    for (const e of this.effects) {
      if (e.kind === 'ring') this.scene.remove(e.mesh); else this.scene.remove(e.inst);
    }
    this.effects = [];
    this._pendingBreaks = [];
    this.dots.visible = false;
    this.anyActivity = false;
    this.settleTimer = 0;
  }

  _watch(o) {
    o.body.addEventListener('collide', (ev) => {
      if (!o.alive) return;
      const other = ev.body;
      const speed = Math.abs(ev.contact.getImpactVelocityAlongNormal());
      if (speed < 1.2) return;
      const m1 = o.body.mass, m2 = other.type === CANNON.Body.STATIC ? 0 : other.mass;
      let e = impactEnergy(m1, m2, speed);
      const ou = other.userData;
      if (ou?.kind === 'bird') e *= ou.hitBoost || 1.6; // birds hit harder than their mass suggests
      this._damage(o, e, speed);
    });
  }

  _damage(o, energy, speed) {
    // Nothing breaks from settling before the first shot.
    if (!o.alive || !this.anyActivity) return;
    o.health -= energy;
    if (o.kind === 'block') {
      if (speed > 3) sfx.thud(Math.min(1, speed / 20), o.mat);
      if (!o.cracked && o.health < o.maxHealth * 0.5) {
        o.cracked = true;
        o.mesh.material = o.mesh.material.clone();
        o.mesh.material.color.multiplyScalar(0.72);
      }
    }
    if (o.health <= 0) this._pendingBreaks.push(o);
  }

  _flushBreaks() {
    if (!this._pendingBreaks.length) return;
    const list = this._pendingBreaks; this._pendingBreaks = [];
    for (const o of list) {
      if (!o.alive) continue;
      o.alive = false;
      const p = new THREE.Vector3().copy(o.body.position);
      this.world.removeBody(o.body);
      this.scene.remove(o.mesh);
      if (o.kind === 'squirrel') {
        this.score += SCORE.squirrel;
        sfx.squeak();
        this._spawn(p, 0x9a9a95, 26, 1.4, 1.6);
        this.ui.popScore(p, SCORE.squirrel);
      } else {
        this.score += o.score;
        sfx.crack(o.mat);
        this._spawn(p, o.mesh.material.color.getHex(), o.mat === 'twig' ? 10 : 16, 1.2, 1.4);
        this.ui.popScore(p, o.score);
      }
      this.ui.setScore(this.score);
    }
  }

  // ------------------------------------------------------------------ birds
  _loadNextBird() {
    if (!this.birdsQueue.length) { this.readyBird = null; this.ui.setQueue([]); return; }
    const key = this.birdsQueue.shift();
    const mesh = makeBird(key);
    const { rest } = this._basis();
    mesh.position.copy(rest).y -= 0.2;
    this.scene.add(mesh);
    this.readyBird = { key, mesh };
    this.powerUsed = false;
    this.ui.setQueue([key, ...this.birdsQueue]);
    this.ui.setBird(key);
  }

  /** Pouch rest position and launch basis for the current heading. */
  _basis() {
    const f = bearingVector(this.yaw);
    const fwd = new THREE.Vector3(f.x, 0, f.z);
    const right = new THREE.Vector3(-f.z, 0, f.x);
    // The slingshot model turns with the view; tips are its fork ends.
    this.sling.rotation.y = Math.atan2(f.x, f.z);
    this.sling.updateMatrixWorld(true);
    const tips = this.sling.userData.tips.map((t) => t.getWorldPosition(new THREE.Vector3()));
    const rest = tips[0].clone().add(tips[1]).multiplyScalar(0.5);
    return { fwd, right, tips, rest };
  }

  /** Launch velocity from a normalised pull {x: -1..1 across, y: -1..1 down, len 0..1}. */
  launchVelocity(pull) {
    const { fwd } = this._basis();
    const len = Math.min(1, pull.len);
    // Pulling down throws higher (up to 62 deg), pulling up throws flatter (down to -8 deg).
    const elev = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(10 + pull.y * 52, -8, 62));
    const dir = fwd.clone().applyAxisAngle(UP, -pull.x * 0.35);
    const v = dir.multiplyScalar(Math.cos(elev)).add(new THREE.Vector3(0, Math.sin(elev), 0));
    return v.multiplyScalar(PHYS.maxSpeed * (0.25 + 0.75 * len));
  }

  // ------------------------------------------------------------------ input
  /** Swivel the view. dYaw in degrees (positive = clockwise), dPitch in degrees. */
  swivel(dYaw, dPitch = 0) {
    if (this.camMode === 'scout') this.camMode = 'aim';
    this.targetYaw = (this.targetYaw + dYaw + 360) % 360;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dPitch, -12, 35);
  }
  faceBearing(b) { this.targetYaw = ((b % 360) + 360) % 360; if (this.camMode === 'scout') this.camMode = 'aim'; }

  canPull() { return this.state === 'ready' && !!this.readyBird; }

  startPull() {
    if (!this.canPull()) return false;
    this.targetYaw = this.yaw; // freeze heading while aiming
    this.state = 'pulling'; this.pull = { x: 0, y: this.elevY, len: 0 }; this.camMode = 'aim';
    return true;
  }

  /**
   * dx, dy in screen pixels from the pull start; scale is pixels for a full pull.
   * Drag down = power, drag sideways = fine heading. Elevation is set separately
   * (mouse wheel, W/S keys or the on-screen arc buttons) and shown by the aiming dots.
   */
  updatePull(dx, dy, scale) {
    if (this.state !== 'pulling') return;
    const len = Math.min(1, Math.max(0, dy) / scale);
    const x = THREE.MathUtils.clamp(-dx / scale, -1, 1);
    const prevLen = this.pull.len;
    this.pull = { x, y: this.elevY, len };
    if (Math.floor(len * 8) !== Math.floor(prevLen * 8)) sfx.stretch(len);
  }

  /** Change launch elevation; y in -0.35..1 maps to -8..62 degrees. */
  adjustElevation(d) {
    this.elevY = THREE.MathUtils.clamp(this.elevY + d, -0.35, 1);
    if (this.pull) this.pull.y = this.elevY;
  }

  cancelPull() { if (this.state === 'pulling') { this.state = 'ready'; this.pull = null; this.dots.visible = false; } }

  release() {
    if (this.state !== 'pulling') return false;
    if (this.pull.len < 0.12) { this.cancelPull(); return false; }
    this.lastPower = this.pull.len;
    const v = this.launchVelocity(this.pull);
    this.pull = null; this.dots.visible = false;
    const rb = this.readyBird; this.readyBird = null;
    this._fire(rb, v, true);
    return true;
  }

  _fire(rb, v, primary) {
    const sp = BIRDS[rb.key];
    const body = new CANNON.Body({ mass: BIRD_MASS[rb.key], shape: new CANNON.Sphere(sp.radius), linearDamping: 0, angularDamping: 0.4 });
    body.position.set(rb.mesh.position.x, rb.mesh.position.y, rb.mesh.position.z);
    body.velocity.set(v.x, v.y, v.z);
    body.allowSleep = false;
    const bird = { kind: 'bird', key: rb.key, mesh: rb.mesh, body, age: 0, landed: false, hitBoost: 1.6, trail: [], power: null };
    body.userData = bird;
    body.addEventListener('collide', (ev) => {
      if (ev.body.userData?.kind === 'bird') return;
      bird.firstHit = true;
    });
    this.world.addBody(body);
    this.flying.push(bird);
    if (primary) {
      this.activeBird = bird;
      this.state = 'flying';
      this.anyActivity = true;
      this.camMode = 'follow'; this.followT = 0;
      this.camLook.copy(rb.mesh.position);
      sfx.twang(); sfx.birdSong(rb.key);
      this.ui.onLaunch(rb.key);
      this._wakeAll();
    }
    return bird;
  }

  /** Tap during flight triggers the species power once. Returns true if used. */
  usePower() {
    const b = this.activeBird;
    if (!b || this.state !== 'flying' || this.powerUsed || b.firstHit) return false;
    const key = BIRDS[b.key].powerKey;
    if (!key) return false;
    this.powerUsed = true;
    b.power = key;
    const v = b.body.velocity;
    const p = new THREE.Vector3(b.body.position.x, b.body.position.y, b.body.position.z);
    if (key === 'dash') {
      const sp = Math.hypot(v.x, v.y, v.z) || 1;
      const k = Math.min(2.2, (sp + 55) / sp);
      v.set(v.x * k, v.y * k + 4, v.z * k);
      b.hitBoost = 2.6;
      sfx.whoosh(); this._ring(p, 0x9cd6ff, 3);
    } else if (key === 'split') {
      const base = new THREE.Vector3(v.x, v.y, v.z);
      for (const ang of [-0.1, 0.1]) {
        const nv = base.clone().applyAxisAngle(UP, ang);
        const mesh = makeBird(b.key);
        mesh.position.copy(p);
        this.scene.add(mesh);
        const child = this._fire({ key: b.key, mesh }, nv, false);
        child.power = 'split'; child.age = b.age;
      }
      sfx.birdSong('goldfinch'); this._ring(p, 0xf2c200, 2.5);
    } else if (key === 'anvil') {
      v.set(v.x * 0.12, -95, v.z * 0.12);
      b.hitBoost = 5;
      sfx.whoosh(); this._ring(p, 0xf1e4c8, 3);
    } else if (key === 'song') {
      this._shockwave(p, 14, 5200);
      v.set(v.x * 0.4, v.y * 0.4, v.z * 0.4);
    }
    this.ui.onPower(b.key);
    return true;
  }

  _shockwave(p, radius, energy) {
    sfx.birdSong('wren');
    this._ring(p, 0xffe28a, radius, 0.7);
    for (const c of this.camps) for (const o of [...c.blocks, ...c.squirrels]) {
      if (!o.alive) continue;
      tmpV.set(o.body.position.x - p.x, o.body.position.y - p.y, o.body.position.z - p.z);
      const d = tmpV.length();
      if (d > radius) continue;
      const k = 1 - d / radius;
      o.body.wakeUp();
      tmpV.normalize().multiplyScalar(k * 26 * Math.sqrt(o.body.mass));
      tmpV.y += k * 8 * Math.sqrt(o.body.mass);
      o.body.applyImpulse(new CANNON.Vec3(tmpV.x, tmpV.y, tmpV.z));
      this._damage(o, energy * k * (o.kind === 'squirrel' ? 0.6 : 1), 10);
    }
  }

  _wakeAll() { for (const c of this.camps) for (const o of [...c.blocks, ...c.squirrels]) if (o.alive) o.body.wakeUp(); }

  _removeBird(b) {
    this.scene.remove(b.mesh);
    if (b.line) { this.scene.remove(b.line); b.line.geometry.dispose(); }
    if (b.body.world) this.world.removeBody(b.body);
  }

  // ------------------------------------------------------------------ update
  update(dt, nowSec) {
    // camera heading eases towards the target
    this.yaw = (this.yaw + angleDiff(this.targetYaw, this.yaw) * Math.min(1, dt * 7) + 360) % 360;

    // physics at a fixed step; wind and drag act on birds in flight
    this.accum += Math.min(dt, 0.05);
    const h = PHYS.step;
    let steps = 0;
    while (this.accum >= h && steps < 12) {
      for (const b of this.flying) {
        const bv = b.body.velocity;
        b.body.applyForce(new CANNON.Vec3(
          (this.wind.x * PHYS.windScale - bv.x * PHYS.drag) * b.body.mass, 0,
          (this.wind.z * PHYS.windScale - bv.z * PHYS.drag) * b.body.mass));
        b.age += h;
      }
      this.world.step(h);
      this.accum -= h; steps++;
    }
    if (steps >= 12) this.accum = 0;

    this.followT += dt;
    this._updateFlight(dt);
    this._updateVisuals(dt, nowSec);
    this._updateCamera(dt);
  }

  _updateFlight(dt) {
    if (this.state !== 'flying') return;
    for (const b of this.flying) {
      const p = b.body.position, v = b.body.velocity;
      b.mesh.position.set(p.x, p.y, p.z);
      const sp = Math.hypot(v.x, v.y, v.z);
      if (sp > 3) {
        tmpV2.set(p.x + v.x, p.y + v.y, p.z + v.z);
        b.mesh.lookAt(tmpV2); // Object3D.lookAt points +z at the target, matching the model
      }
      if (sp < 2.5 && b.age > 0.8) b.restTime = (b.restTime || 0) + dt; else b.restTime = 0;
      if (b.restTime > 0.6) b.landed = true;
      if (Math.abs(p.x) > 6000 || Math.abs(p.z) > 6000 || p.y < -50 || b.age > 14) b.landed = true;
      if (b.age < 6) { b.trail.push(b.mesh.position.clone()); if (b.trail.length > 40) b.trail.shift(); this._drawTrail(b); }
    }
    if (this.flying.every((b) => b.landed)) {
      this.settleTimer += dt;
      // wait for the camp to stop moving so late collapses still count
      const moving = this.camps.some((c) => [...c.blocks, ...c.squirrels].some((o) => o.alive && o.body.velocity.length() > 1.5));
      if (this.settleTimer > 1.2 && (!moving || this.settleTimer > 5)) {
        this.settleTimer = 0;
        for (const b of this.flying) this._removeBird(b);
        this.flying = [];
        this.activeBird = null;
        this._afterShot();
      }
    } else this.settleTimer = 0;
  }

  _afterShot() {
    // squirrels knocked off the camp into the grass are out of the fight
    for (const c of this.camps) for (const s of c.squirrels) {
      if (!s.alive) continue;
      const drop = c.centre.y - s.body.position.y;
      const far = Math.hypot(s.body.position.x - c.centre.x, s.body.position.z - c.centre.z);
      if (drop > 2.5 || far > 14) { this._pendingBreaks.push(s); }
    }
    this._flushBreaks();
    if (this._won()) {
      const left = this.birdsQueue.length;
      this.score += left * SCORE.birdLeft;
      this.ui.setScore(this.score);
      this.state = 'won'; sfx.fanfare();
      this.ui.onResult(true, this.score, left, this.birdsTotal, this.level);
      return;
    }
    if (!this.birdsQueue.length) { this.state = 'lost'; this.ui.onResult(false, this.score, 0, this.birdsTotal, this.level); return; }
    this.state = 'ready';
    this.camMode = 'aim';
    this._loadNextBird();
  }

  _won() { return this.camps.every((c) => c.squirrels.every((s) => !s.alive)); }

  squirrelsLeft() { return this.camps.reduce((n, c) => n + c.squirrels.filter((s) => s.alive).length, 0); }

  // ------------------------------------------------------------------ effects
  _ring(p, color, radius, life = 0.5) {
    const geo = new THREE.RingGeometry(0.4, 0.7, 24);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    m.position.copy(p); m.lookAt(this.camera.position);
    this.scene.add(m);
    this.effects.push({ mesh: m, t: 0, life, radius, kind: 'ring' });
  }

  _spawn(p, color, count, spread, life) {
    const geo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 1 });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.frustumCulled = false;
    const r = () => Math.random() * 2 - 1;
    const parts = [];
    for (let i = 0; i < count; i++) parts.push({ p: p.clone(), v: new THREE.Vector3(r(), 0.4 + Math.random(), r()).multiplyScalar(spread * (2 + Math.random() * 3)) });
    this.scene.add(inst);
    this.effects.push({ kind: 'bits', inst, parts, t: 0, life });
  }

  _updateVisuals(dt, nowSec) {
    const m4 = new THREE.Matrix4(), sc = new THREE.Vector3(), q0 = new THREE.Quaternion();
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]; e.t += dt;
      const k = e.t / e.life;
      if (k >= 1) {
        if (e.kind === 'ring') { this.scene.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh.material.dispose(); }
        else { this.scene.remove(e.inst); e.inst.geometry.dispose(); e.inst.material.dispose(); }
        this.effects.splice(i, 1); continue;
      }
      if (e.kind === 'ring') { e.mesh.scale.setScalar(1 + k * e.radius * 2); e.mesh.material.opacity = 1 - k; continue; }
      e.parts.forEach((pt, idx) => {
        pt.v.y += PHYS.gravity * dt;
        pt.p.addScaledVector(pt.v, dt);
        const g = this.data.heightAt(pt.p.x, pt.p.z);
        if (pt.p.y < g) { pt.p.y = g; pt.v.multiplyScalar(0.3); }
        sc.setScalar(Math.max(0.01, 1 - k * k));
        e.inst.setMatrixAt(idx, m4.compose(pt.p, q0, sc));
      });
      e.inst.instanceMatrix.needsUpdate = true;
    }
    // wings flap in flight
    for (const b of this.flying) {
      const sp = b.body.velocity.length();
      const f = Math.sin(b.age * 24) * (sp > 6 ? 0.9 : 0.2);
      for (const w of b.mesh.userData.wings) w.rotation.z = f * w.userData.side;
    }
    // the waiting bird sits in the pouch and faces the heading
    if (this.readyBird && this.state !== 'pulling') {
      const { rest, fwd } = this._basis();
      const m = this.readyBird.mesh;
      m.position.lerp(tmpV.copy(rest).add(new THREE.Vector3(0, -0.15, 0)), Math.min(1, dt * 8));
      m.lookAt(tmpV2.copy(m.position).add(fwd));
      for (const w of m.userData.wings) w.rotation.z = Math.sin(nowSec * 3) * 0.08 * w.userData.side;
    }
    // squirrels bob and chatter until knocked out
    for (const c of this.camps) for (const s of c.squirrels) {
      if (!s.alive) continue;
      const bp = s.body.position;
      s.mesh.position.set(bp.x, bp.y - s.r + Math.abs(Math.sin(nowSec * 3 + bp.x)) * 0.08, bp.z);
      if (s.body.sleepState !== CANNON.Body.SLEEPING && this.anyActivity) s.mesh.quaternion.set(s.body.quaternion.x, s.body.quaternion.y, s.body.quaternion.z, s.body.quaternion.w).multiply(s.baseQ);
    }
    for (const c of this.camps) for (const o of c.blocks) {
      if (!o.alive) continue;
      o.mesh.position.set(o.body.position.x, o.body.position.y, o.body.position.z);
      o.mesh.quaternion.set(o.body.quaternion.x, o.body.quaternion.y, o.body.quaternion.z, o.body.quaternion.w);
    }
    this._updateBands();
    if (this.state === 'pulling' && this.readyBird) this.readyBird.mesh.position.copy(this.pouch);
    // show the arc while waiting too, at the last power, so the angle controls give feedback
    if (this.state === 'ready' && this.readyBird) {
      this.pull = { x: 0, y: this.elevY, len: this.lastPower ?? 0.7 };
      this._drawDots(0.35);
      this.pull = null;
    }
    const ang = document.getElementById('hud-angle');
    if (ang) ang.textContent = `${Math.round(THREE.MathUtils.clamp(10 + this.elevY * 52, -8, 62))}°`;
  }

  _drawTrail(b) {
    if (!b.line) {
      b.line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
      b.line.frustumCulled = false;
      this.scene.add(b.line);
    }
    b.line.geometry.setFromPoints(b.trail);
  }

  _updateBands() {
    const { tips } = this._basis();
    let pouch;
    if (this.state === 'pulling' && this.pull) {
      const { rest } = this._basis();
      const v = this.launchVelocity(this.pull).normalize().multiplyScalar(-1.4 * this.pull.len);
      pouch = rest.clone().add(v);
    } else if (this.readyBird) {
      pouch = this.readyBird.mesh.position.clone();
    } else {
      pouch = tips[0].clone().add(tips[1]).multiplyScalar(0.5);
    }
    this.pouch.copy(pouch);
    this.bands.geometry.setFromPoints([tips[0], pouch, tips[1]]);
    if (this.state === 'pulling' && this.pull) this._drawDots();
  }

  /** Predicted arc, sampled with the same gravity/wind/drag as the flight. */
  _drawDots(opacity = 0.9) {
    this.dots.material.opacity = opacity; this.dots.material.transparent = true;
    const v = this.launchVelocity(this.pull);
    let p = this.pouch.clone(), vel = v.clone();
    const dt = 0.1, m = new THREE.Matrix4(), s = new THREE.Vector3(1, 1, 1), q = new THREE.Quaternion();
    let n = 0;
    for (let i = 0; i < 60; i++) {
      vel.y += PHYS.gravity * dt;
      vel.x += (this.wind.x * PHYS.windScale / 40 - vel.x * PHYS.drag) * dt;
      vel.z += (this.wind.z * PHYS.windScale / 40 - vel.z * PHYS.drag) * dt;
      p.addScaledVector(vel, dt);
      const g = this.data.heightAt(p.x, p.z);
      if (p.y < g) break;
      if (i % 3 === 0) {
        s.setScalar(0.7 + 0.5 * (1 - i / 60));
        this.dots.setMatrixAt(n++, m.compose(p, q, s));
      }
    }
    for (let i = n; i < 60; i++) this.dots.setMatrixAt(i, m.makeScale(0, 0, 0));
    this.dots.count = 60;
    this.dots.instanceMatrix.needsUpdate = true;
    this.dots.visible = true;
  }

  // ------------------------------------------------------------------ camera
  _updateCamera(dt) {
    const head = this.slingPos.clone().add(new THREE.Vector3(0, 6.1, 0));
    if (this.camMode === 'scout') {
      const target = this.scoutTarget || head;
      this.camera.position.lerp(tmpV.copy(target).add(new THREE.Vector3(0, 60, 0)), Math.min(1, dt * 2));
      this._keepAboveGround();
      this.camera.lookAt(target);
      this.env.follow(target);
      return;
    }
    if (this.camMode === 'follow' && this.activeBird) {
      const b = this.activeBird.mesh.position;
      const dir = tmpV.copy(b).sub(head).normalize();
      const back = this.followT < 0.35 ? 2.5 : 9;
      this.camPos.copy(head).addScaledVector(dir, back * 0.5).add(new THREE.Vector3(0, 2.2 - dir.y * 1.5, 0));
      const side = tmpV2.copy(dir).cross(UP).normalize();
      this.camPos.addScaledVector(side, 3.2);
      this.camera.position.lerp(this.camPos, Math.min(1, dt * (this.followT < 0.35 ? 14 : 3.5)));
      this._keepAboveGround();
      const lead = b.clone().addScaledVector(tmpV.copy(b).sub(head).normalize(), 22);
      this.camLook.lerp(lead, Math.min(1, dt * 5));
      this.camera.lookAt(this.camLook);
      this.env.follow(this.camLook);
      return;
    }
    // aiming view: just behind the slingshot, looking along the heading
    const f = bearingVector(this.yaw);
    // far enough back to see the fork, the bird and the landscape beyond
    const back = new THREE.Vector3(-f.x, 0, -f.z).multiplyScalar(9.5);
    const p = head.clone().add(back);
    p.y = this.slingPos.y + 9.2 + Math.sin(THREE.MathUtils.degToRad(this.pitch)) * 9;
    const fwd = new THREE.Vector3(f.x, 0, f.z);
    const aim = head.clone().addScaledVector(fwd, 85);
    aim.y = head.y - 12 + Math.tan(THREE.MathUtils.degToRad(this.pitch)) * 85;
    if (this.snapCam) { this.camera.position.copy(p); this.camLook.copy(aim); this.snapCam = false; }
    this.camera.position.lerp(p, Math.min(1, dt * 6));
    this.camLook.lerp(aim, Math.min(1, dt * 6));
    this._keepAboveGround();
    this.camera.lookAt(this.camLook);
    this.env.follow(this.slingPos);
  }

  /** The camera never dips below the real terrain. */
  _keepAboveGround() {
    const c = this.camera.position;
    const g = this.data.heightAt(c.x, c.z) + 1.5;
    if (c.y < g) c.y = g;
  }

  scoutFrom(camp) {
    this.scoutTarget = camp ? camp.centre.clone() : null;
    this.camMode = 'scout';
  }
}
