// DOM UI: HUD, compass with real landmark bearings, screens, score pops.
import { BIRDS, LEVELS, PLACE_NOTES, MATERIALS } from './data.js';
import { bearingTo, angleDiff } from './geo.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(game) {
    this.game = game;
    this.el = {
      score: $('hud-score'), level: $('hud-level'), birds: $('hud-birds'), tip: $('tip'),
      weather: $('hud-weather'), compass: $('compass-strip'), compassTape: $('compass-tape'),
      birdName: $('hud-birdname'), power: $('hud-power'), pops: $('pops'),
      dmg: $('hud-damage'),
    };
    this.stars = JSON.parse(localStorage.getItem('sb:stars') || '{}');
    this.buildCompassTape();
    this.buildLevelGrid();
    this.buildGuide();
  }

  // ------------------------------------------------ compass with real bearings
  buildCompassTape() {
    const lm = this.game.data.meta.landmarks;
    this.marks = lm.map((l) => ({ ...l, bearing: bearingTo(l.x, l.z), note: PLACE_NOTES[l.n] || '' }))
      .filter((m) => m.bearing !== null)
      .sort((a, b) => a.bearing - b.bearing);
    const cardinals = [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']];
    this.tape = cardinals.map(([b, n]) => ({ b, label: n, kind: 'card' }))
      .concat(this.marks.map((m) => ({ b: m.bearing, label: m.n, kind: m.k, note: m.note, dist: Math.hypot(m.x, m.z) })))
      .sort((a, b) => a.b - b.b);
  }

  /** Renders the compass strip for the current yaw. */
  updateCompass(yaw) {
    const tape = this.el.compassTape;
    const pxPerDeg = 4.2;
    const width = this.el.compass.clientWidth || 720;
    const halfDeg = width / 2 / pxPerDeg;
    const html = [];
    for (const t of this.tape) {
      const d = angleDiff(t.b, yaw);
      if (Math.abs(d) > halfDeg + 8) continue;
      const x = width / 2 + d * pxPerDeg;
      const cls = t.kind === 'card' ? 'tick card' : `tick ${t.kind}`;
      html.push(`<span class="${cls}" style="left:${x}px">${t.label}</span>`);
    }
    // red markers for the camps still standing
    for (const c of this.game.camps) {
      const alive = c.squirrels.some((s) => s.alive);
      if (!alive) continue;
      const d = angleDiff(c.bearing, yaw);
      if (Math.abs(d) > halfDeg + 8) continue;
      const x = width / 2 + d * pxPerDeg;
      html.push(`<span class="tick target" style="left:${x}px">▼</span>`);
    }
    tape.innerHTML = html.join('');
    this.el.compass.classList.toggle('near', this.game.camps.some((c) => Math.abs(angleDiff(c.bearing, yaw)) < 5));
  }

  // ------------------------------------------------ HUD
  setScore(s) { this.el.score.textContent = `Score ${s.toLocaleString('en-GB')}`; }
  setLevel(L) { this.el.level.textContent = L.title; }
  setQueue(keys) {
    this.el.birds.innerHTML = keys.map((k) => `<span class="bird-chip">${BIRDS[k].name}</span>`).join('');
  }
  setBird(key) {
    const b = BIRDS[key];
    this.el.birdName.textContent = b.name;
    this.el.power.textContent = b.power;
  }
  setWeather(w) {
    const arrow = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][Math.round(((w.from % 360) / 45)) % 8];
    const src = w.live ? 'live' : 'offline';
    const now = w.temp != null ? `${Math.round(w.temp)}°C ` : '';
    this.el.weather.textContent = `${now}${arrow} ${Math.round(w.speed)} m/s`;
    this.el.weather.title = `Wind ${Math.round(w.speed)} m/s from ${Math.round(w.from)}°. Cloud ${w.cloud}%. Source: Open-Meteo (${src}).`;
  }
  setTip(text) {
    this.el.tip.innerHTML = text;
    this.el.tip.classList.add('show');
    clearTimeout(this._tipT);
    this._tipT = setTimeout(() => this.el.tip.classList.remove('show'), 6500);
  }
  onLaunch() { }
  onPower() { }
  popScore(worldPos, amount) {
    const p = worldPos.clone().project(this.game.camera);
    const x = (p.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-p.y * 0.5 + 0.5) * window.innerHeight;
    const d = document.createElement('div');
    d.className = 'pop';
    d.textContent = `+${amount.toLocaleString('en-GB')}`;
    d.style.left = `${x}px`; d.style.top = `${y}px`;
    this.el.pops.appendChild(d);
    setTimeout(() => d.remove(), 1200);
  }
  setDamage(frac) {
    this.el.dmg.style.opacity = String(Math.max(0, Math.min(1, frac)) * 0.55);
  }

  onLevelStart(L, camps) {
    this.setLevel(L);
    this.setScore(this.game.score);
    this.setTip(L.blurb + ' <b>' + L.tip + '</b>');
  }

  onResult(won, score, birdsLeft, birdsTotal, L) {
    const stars = won ? (birdsLeft >= Math.ceil(birdsTotal / 2) ? 3 : birdsLeft >= 1 ? 2 : 1) : 0;
    if (won) {
      this.stars[L.id] = Math.max(this.stars[L.id] || 0, stars);
      localStorage.setItem('sb:stars', JSON.stringify(this.stars));
      this.buildLevelGrid();
    }
    showScreen('result', {
      title: won ? 'Level cleared' : 'Out of birds',
      stars, score, level: L, birdsLeft, birdsTotal,
    });
  }

  // ------------------------------------------------ level picker
  buildLevelGrid() {
    const grid = $('level-grid');
    let unlocked = 1;
    for (const L of LEVELS) if (this.stars[L.id]) unlocked = Math.max(unlocked, Math.min(L.id + 1, LEVELS.length));
    this.unlocked = unlocked;
    grid.innerHTML = LEVELS.map((L) => {
      const s = this.stars[L.id] || 0;
      const locked = L.id > unlocked;
      return `<button type="button" class="lvl" data-id="${L.id}" ${locked ? 'disabled' : ''}>
        <strong>${L.id}</strong><span class="lvl-name">${locked ? 'Locked' : L.title}</span>
        <span class="lvl-stars">${locked ? '' : '★'.repeat(s) + '☆'.repeat(3 - s)}</span></button>`;
    }).join('');
    grid.querySelectorAll('button.lvl:not([disabled])').forEach((b) => {
      b.addEventListener('click', () => { hideScreens(); this.game.loadLevel(Number(b.dataset.id) - 1); });
    });
  }

  // ------------------------------------------------ field guide
  buildGuide() {
    const list = $('guide-list');
    const statusClass = (s) => s.toLowerCase().includes('inv') ? 'invasive' : s.toLowerCase().includes('amber') ? 'amber' : 'green';
    const birdHtml = Object.entries(BIRDS).map(([k, b]) => `
      <div class="guide-item" data-bird="${k}">
        <canvas class="guide-canvas" width="128" height="128" data-bird="${k}" aria-hidden="true"></canvas>
        <div>
          <h3>${b.name}<span class="status ${statusClass(b.status)}">${b.status}</span></h3>
          <div class="latin">${b.latin}</div>
          <div class="power">${b.power}</div>
          <p>${b.fact}</p>
        </div>
      </div>`).join('');
    const sq = this.game.squirrelInfo;
    list.innerHTML = birdHtml + `
      <div class="guide-item">
        <canvas class="guide-canvas" width="128" height="128" data-squirrel="1" aria-hidden="true"></canvas>
        <div>
          <h3>${sq.name}<span class="status invasive">${sq.status}</span></h3>
          <div class="latin">${sq.latin}</div>
          <div class="power">The target. Knocks camps apart and caches what it steals.</div>
          <p>${sq.fact}</p>
        </div>
      </div>`;
    list.insertAdjacentHTML('beforeend', `
      <div class="guide-item">
        <div></div>
        <div>
          <h3>Materials</h3>
          <p>${Object.entries(MATERIALS).map(([k, m]) =>
            `<b>${k === 'twig' ? 'Twig bundles' : k === 'wood' ? 'Wooden planks' : 'Gritstone blocks'}</b> (${m.health} impact units) — ${k === 'twig' ? 'snap easily, good for a light bird' : k === 'wood' ? 'a solid all-round target' : 'need a heavy bird or a Song Thrush strike'}`).join('<br>')}</p>
        </div>
      </div>
      <div class="guide-item">
        <div></div>
        <div>
          <h3>Where you are standing</h3>
          <p>Hollins Cross, on the Great Ridge between Edale and the Hope Valley, Derbyshire.
          The ground, walls, woods, streams and buildings in this game come from real survey data:
          heights from the Environment Agency and Copernicus (EU-DEM); landscape detail from OpenStreetMap.
          Weather is live from Open-Meteo. Bird facts from the RSPB; the squirrel from The Wildlife Trusts.</p>
        </div>
      </div>`);
  }
}

// ---------------------------------------------------------------- screens
const SCREENS = ['title', 'levels', 'guide', 'result'];
export function showScreen(name, data) {
  hideScreens();
  const el = document.getElementById(`screen-${name}`);
  if (!el) return;
  el.classList.remove('hidden');
  if (name === 'result') {
    document.getElementById('r-title').textContent = data.title;
    document.getElementById('r-stars').innerHTML = data.stars
      ? '★'.repeat(data.stars).split('').join('') + '☆'.repeat(3 - data.stars)
      : '<span class="off">☆☆☆</span>';
    document.getElementById('r-score').textContent =
      `${data.score.toLocaleString('en-GB')} points · ${data.birdsLeft} of ${data.birdsTotal} birds left`;
    const facts = data.level ? data.level.camps.map((c) => c.name) : [];
    document.getElementById('r-fact').innerHTML = data.level
      ? `<strong>${data.level.title}</strong>: ${facts.join(', ')}. ${data.level.tip}`
      : '';
    document.getElementById('btn-r-next').style.display = data.stars ? '' : 'none';
  }
}
export function hideScreens() { for (const s of SCREENS) document.getElementById(`screen-${s}`)?.classList.add('hidden'); }
