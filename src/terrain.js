// Real Peak District terrain: a far 14.4 km mesh plus a detailed 900 m mesh around
// Hollins Cross, both textured from baked OpenStreetMap land cover.
import * as THREE from 'three';
import { makeHeightSampler, rng, pointInPolygon } from './geo.js';

export async function loadTerrainData(base = '/data/') {
  const [meta, far, near] = await Promise.all([
    fetch(base + 'meta.json').then((r) => { if (!r.ok) throw new Error('meta ' + r.status); return r.json(); }),
    fetch(base + 'height.bin').then((r) => r.arrayBuffer()),
    fetch(base + 'near.bin').then((r) => r.arrayBuffer()),
  ]);
  const farGrid = new Uint16Array(far);
  const nearGrid = new Uint16Array(near);
  const farH = makeHeightSampler(farGrid, meta.n, meta.half);
  const nearH = makeHeightSampler(nearGrid, meta.nearN, meta.nearHalf);
  const blend = meta.nearHalf * 0.8;
  // Detailed heights near the slingshot, fading into the far grid at the edges.
  const heightAt = (x, z) => {
    const r = Math.max(Math.abs(x), Math.abs(z));
    if (r >= meta.nearHalf) return farH(x, z);
    const n = nearH(x, z);
    if (r <= blend) return n;
    const t = (r - blend) / (meta.nearHalf - blend);
    return n * (1 - t) + farH(x, z) * t;
  };
  return { meta, heightAt, farH, nearH };
}

function gridMesh(size, segs, heightFn, texture, yOffset, maxAniso) {
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightFn(pos.getX(i), pos.getZ(i)) + yOffset);
  }
  geo.computeVertexNormals();
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAniso;
  const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.97, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

export async function buildTerrain(scene, data, renderer, base = '/data/') {
  const loader = new THREE.TextureLoader();
  const [farTex, nearTex] = await Promise.all([
    loader.loadAsync(base + 'far.jpg'),
    loader.loadAsync(base + 'near.jpg'),
  ]);
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const { meta } = data;

  // Far mesh sits slightly lower so the near mesh always wins where they overlap.
  const far = gridMesh(meta.half * 2, 320, data.farH, farTex, -1.5, aniso);
  far.name = 'terrain-far';
  scene.add(far);

  const near = gridMesh(meta.nearHalf * 2, 256, data.heightAt, nearTex, 0, aniso);
  near.name = 'terrain-near';
  scene.add(near);

  addWalls(scene, data);
  addTrees(scene, data);
  addBuildings(scene, data);
  return { far, near };
}

// Drystone walls from OpenStreetMap, as instanced gritstone segments.
function addWalls(scene, data) {
  const segs = [];
  for (const line of data.meta.walls) {
    for (let i = 0; i < line.length - 1; i++) {
      const [x1, z1] = line[i], [x2, z2] = line[i + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const steps = Math.max(1, Math.ceil(len / 4));
      for (let s = 0; s < steps; s++) {
        const a = s / steps, b = (s + 1) / steps;
        segs.push([x1 + (x2 - x1) * a, z1 + (z2 - z1) * a, x1 + (x2 - x1) * b, z1 + (z2 - z1) * b]);
      }
    }
  }
  if (!segs.length) return;
  const geo = new THREE.BoxGeometry(1, 1.2, 0.7);
  const mat = new THREE.MeshStandardMaterial({ color: 0x6f6a5e, roughness: 1 });
  const inst = new THREE.InstancedMesh(geo, mat, segs.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  segs.forEach(([x1, z1, x2, z2], i) => {
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    const len = Math.hypot(x2 - x1, z2 - z1) + 0.15;
    q.setFromAxisAngle(up, -Math.atan2(z2 - z1, x2 - x1));
    p.set(cx, data.heightAt(cx, cz) + 0.45, cz);
    s.set(len, 1, 1);
    inst.setMatrixAt(i, m.compose(p, q, s));
  });
  inst.castShadow = true; inst.receiveShadow = true;
  inst.name = 'walls';
  scene.add(inst);
}

// Trees: every OSM-mapped individual tree, plus seeded fill inside mapped woods near the ridge.
function addTrees(scene, data) {
  const pts = [];
  const lim = 6800;
  for (const [x, z] of data.meta.trees) if (Math.abs(x) < lim && Math.abs(z) < lim) pts.push([x, z, 1]);
  const r = rng(1234);
  for (const poly of data.meta.woods) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of poly) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const d = Math.hypot((minX + maxX) / 2, (minZ + maxZ) / 2);
    if (d > 4500) continue;
    const spacing = d < 900 ? 9 : d < 2000 ? 16 : 26;
    const area = (maxX - minX) * (maxZ - minZ);
    const count = Math.min(900, Math.floor(area / (spacing * spacing)));
    for (let i = 0; i < count; i++) {
      const x = minX + r() * (maxX - minX), z = minZ + r() * (maxZ - minZ);
      if (pointInPolygon(x, z, poly)) pts.push([x, z, d < 900 ? 1 : 1.3]);
    }
  }
  const maxTrees = 14000;
  const use = pts.length > maxTrees ? pts.filter((_, i) => i % Math.ceil(pts.length / maxTrees) === 0) : pts;

  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.4, 3, 5);
  trunkGeo.translate(0, 1.5, 0);
  const crownGeo = new THREE.IcosahedronGeometry(2.6, 0);
  crownGeo.translate(0, 4.6, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 }), use.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), use.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  const rr = rng(99);
  use.forEach(([x, z, k], i) => {
    const sc = (0.8 + rr() * 0.7) * k;
    q.setFromAxisAngle(up, rr() * Math.PI * 2);
    p.set(x, data.heightAt(x, z) - 0.2, z);
    s.set(sc, sc * (0.9 + rr() * 0.4), sc);
    m.compose(p, q, s);
    trunks.setMatrixAt(i, m); crowns.setMatrixAt(i, m);
    c.setHSL(0.22 + rr() * 0.07, 0.35 + rr() * 0.2, 0.2 + rr() * 0.1);
    crowns.setColorAt(i, c);
  });
  for (const t of [trunks, crowns]) { t.castShadow = true; t.receiveShadow = true; scene.add(t); }
  trunks.name = 'tree-trunks'; crowns.name = 'tree-crowns';
}

// Buildings near the ridge: OSM footprints extruded with a pitched stone-slate look.
function addBuildings(scene, data) {
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x8c8373, roughness: 1 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a4540, roughness: 0.95 });
  for (const b of data.meta.buildings) {
    const shape = new THREE.Shape(b.p.map(([x, z]) => new THREE.Vector2(x, -z)));
    const h = 2.8 * b.lv;
    let minY = Infinity;
    for (const [x, z] of b.p) minY = Math.min(minY, data.heightAt(x, z));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h + 2, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, [roofMat, wallMat]);
    mesh.position.y = minY - 2;
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
  }
}
