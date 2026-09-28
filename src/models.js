// Stylised low-poly models built from primitives, coloured from real plumage.
import * as THREE from 'three';
import { BIRDS } from './data.js';

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });

function eye(r) {
  const g = new THREE.Group();
  const white = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), std(0xffffff, { roughness: 0.3 }));
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(r * 0.55, 8, 6), std(0x111111, { roughness: 0.2 }));
  pupil.position.z = r * 0.62;
  g.add(white, pupil);
  return g;
}

/**
 * Bird facing +z. Body radius ~1 unit before scaling; scaled to species radius.
 * Returns a Group with userData.wings for flapping.
 */
export function makeBird(key) {
  const sp = BIRDS[key];
  const c = sp.colors;
  const g = new THREE.Group();

  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), std(c.body));
  body.scale.set(1, 0.95, 1.12);
  g.add(body);

  // belly / breast patch
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.86, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), std(c.belly));
  belly.rotation.x = Math.PI / 2 + 0.35;
  belly.position.set(0, -0.12, 0.28);
  g.add(belly);

  // face mask (robin's red face, goldfinch's red face, blue tit's white cheeks)
  if (c.face !== c.belly) {
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), std(c.face));
    face.rotation.x = Math.PI / 2;
    face.position.set(0, 0.28, 0.72);
    g.add(face);
  }
  if (key === 'robin') {
    const breast = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), std(c.belly));
    breast.rotation.x = Math.PI / 2 - 0.2;
    breast.position.set(0, 0.08, 0.52);
    g.add(breast);
  }
  if (key === 'bluetit') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.4), std(c.cap));
    cap.position.set(0, 0.5, 0.28);
    cap.rotation.x = 0.25;
    g.add(cap);
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 6, 20, Math.PI * 0.8), std(0x1a2a50));
    stripe.position.set(0, 0.36, 0.62); stripe.rotation.set(0.1, 0, Math.PI * 0.1);
    g.add(stripe);
  }
  if (key === 'goldfinch') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.6, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.35), std(0x1b1b1b));
    cap.position.set(0, 0.52, 0.12);
    g.add(cap);
  }
  if (key === 'thrush') {
    // speckled breast: dark arrowhead spots
    const spotGeo = new THREE.SphereGeometry(0.07, 6, 4);
    const spotMat = std(c.spots);
    for (let i = 0; i < 26; i++) {
      const th = -0.9 + (i % 7) * 0.3, ph = 0.15 + Math.floor(i / 7) * 0.22;
      const s = new THREE.Mesh(spotGeo, spotMat);
      s.position.set(Math.sin(th) * 0.88 * Math.cos(ph), -ph * 1.1 + 0.2, Math.cos(th) * 0.88 * Math.cos(ph) + 0.1);
      s.scale.set(1, 0.7, 0.5);
      g.add(s);
    }
  }

  // wings
  const wingGeo = new THREE.SphereGeometry(0.7, 12, 8);
  const wingMat = std(c.wing);
  const wings = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.82, 0.12, -0.05);
    const w = new THREE.Mesh(wingGeo, wingMat);
    w.scale.set(0.28, 0.62, 1.05);
    w.position.set(side * 0.08, 0, -0.1);
    w.rotation.z = side * 0.25;
    pivot.add(w);
    if (key === 'goldfinch') {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.95), std(c.bar));
      bar.position.set(side * 0.2, -0.05, -0.05);
      pivot.add(bar);
    }
    pivot.userData.side = side;
    g.add(pivot); wings.push(pivot);
  }

  // tail (the wren's cocked tail is its signature)
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.8), std(c.wing));
  if (key === 'wren') { tail.position.set(0, 0.55, -1.0); tail.rotation.x = -1.0; }
  else { tail.position.set(0, -0.05, -1.15); tail.rotation.x = 0.25; }
  g.add(tail);

  // beak
  const beakLen = key === 'goldfinch' ? 0.5 : key === 'wren' ? 0.42 : key === 'thrush' ? 0.38 : 0.3;
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.13, beakLen, 8), std(c.beak, { roughness: 0.4 }));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.22, 1.08 + beakLen / 2 - 0.08);
  g.add(beak);

  // eyes, and an angry brow
  for (const side of [-1, 1]) {
    const e = eye(0.17);
    e.position.set(side * 0.38, 0.4, 0.82);
    e.rotation.y = side * 0.35;
    g.add(e);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.07), std(0x1a1410));
    brow.position.set(side * 0.37, 0.62, 0.9);
    brow.rotation.z = side * -0.45;
    g.add(brow);
  }

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  g.scale.setScalar(sp.radius);
  g.userData.wings = wings;
  g.userData.key = key;
  return g;
}

/** Grey squirrel facing +z, radius ~0.9. */
export function makeSquirrel() {
  const g = new THREE.Group();
  const grey = std(0x8d8d88), pale = std(0xd9d4c8), brown = std(0x8a6a50);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), grey);
  body.scale.set(0.9, 1.1, 0.9);
  g.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), pale);
  belly.position.set(0, -0.1, 0.3); belly.scale.set(0.8, 1, 0.6);
  g.add(belly);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 10), grey);
  head.position.set(0, 0.78, 0.22);
  g.add(head);
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), brown);
  snout.position.set(0, 0.7, 0.6);
  g.add(snout);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), std(0x222222));
  nose.position.set(0, 0.74, 0.8);
  g.add(nose);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 6), grey);
    ear.position.set(s * 0.22, 1.18, 0.15);
    g.add(ear);
    const e = eye(0.09);
    e.position.set(s * 0.2, 0.86, 0.55);
    g.add(e);
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), brown);
    paw.position.set(s * 0.2, 0.2, 0.6);
    g.add(paw);
  }
  // the bushy tail, curled up behind
  const tail = new THREE.Group();
  const tg = new THREE.SphereGeometry(0.38, 10, 8);
  for (let i = 0; i < 6; i++) {
    const t = new THREE.Mesh(tg, grey);
    const a = i / 5;
    t.position.set(0, -0.3 + a * 1.6, -0.6 - Math.sin(a * Math.PI) * 0.5);
    t.scale.setScalar(0.85 + Math.sin(a * Math.PI) * 0.35);
    tail.add(t);
  }
  g.add(tail);
  // a stolen peanut
  const nut = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.18, 4, 8), std(0xc8a070));
  nut.position.set(0, 0.35, 0.72); nut.rotation.z = Math.PI / 2;
  g.add(nut);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/** A forked hazel slingshot with two rubber bands, anchored at local origin. */
export function makeSlingshot() {
  const g = new THREE.Group();
  const wood = std(0x6b4a2e, { roughness: 0.9 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 3.2, 10), wood);
  stem.position.y = 1.6;
  g.add(stem);
  const tips = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 2.4, 8), wood);
    arm.position.set(s * 0.62, 4.1, 0);
    arm.rotation.z = -s * 0.5;
    g.add(arm);
    const tip = new THREE.Object3D();
    tip.position.set(s * 1.2, 5.1, 0);
    g.add(tip);
    tips.push(tip);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.tips = tips;
  return g;
}
