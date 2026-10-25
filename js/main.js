import { WorldMap, TERRAIN, FEATURES } from './map.js';
import { Renderer } from './renderer.js';
import { generateWorld } from './worldgen.js';

const canvas = document.getElementById('map');
const info = document.getElementById('tile-info');
const map = new WorldMap(80, 50);          // 4,000 tiles
const view = new Renderer(canvas, map);

document.getElementById('stats').textContent =
  `${map.cols} × ${map.rows} = ${map.size.toLocaleString()} tiles, wraps east–west`;

// ---- hover ----
const rainText = (i) => TERRAIN[map.terrain[i]].land ? ` · ${Math.round(map.precipitation[i])} mm` : '';
function setHover(px, py) {
  const t = view.pickTile(px, py);
  const same = t && view.hover && t.c === view.hover.c && t.row === view.hover.row;
  if (!same) { view.hover = t; view.dirty = true; }
  info.textContent = t
    ? `Tile ${t.col}, ${t.row} · ${TERRAIN[map.terrain[map.index(t.col, t.row)]].name} · ${map.temperature[map.index(t.col, t.row)].toFixed(0)}°C${rainText(map.index(t.col, t.row))} · ${map.plates[map.plate[map.index(t.col, t.row)]]?.name ?? ''}${map.feature[map.index(t.col, t.row)] ? ' · ' + FEATURES[map.feature[map.index(t.col, t.row)]].name : ''}`
    : 'Hover over a tile';
}

// ---- pointer: drag to scroll, two fingers to pinch ----
const pointers = new Map();
let pinchDist = 0;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  canvas.classList.add('dragging');
  if (pointers.size === 2) pinchDist = currentPinch();
  setHover(e.offsetX, e.offsetY);
});

canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) { setHover(e.offsetX, e.offsetY); return; }
  if (pointers.size === 1) {
    view.pan(e.offsetX - p.x, e.offsetY - p.y);
  }
  p.x = e.offsetX; p.y = e.offsetY;
  if (pointers.size === 2) {
    const d = currentPinch(), [a, b] = [...pointers.values()];
    if (pinchDist) view.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchDist);
    pinchDist = d;
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  pinchDist = 0;
  if (!pointers.size) canvas.classList.remove('dragging');
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { if (!pointers.size) { view.hover = null; view.dirty = true; info.textContent = 'Hover over a tile'; } });

function currentPinch() {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ---- wheel: zoom toward cursor (trackpad pinch also arrives here) ----
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  view.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
}, { passive: false });

// ---- keyboard: arrows/WASD scroll, +/- zoom, 0 reset ----
const keys = new Set();
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
    keys.add(k); e.preventDefault();
  } else if (k === '+' || k === '=') view.zoomAt(view.viewW / 2, view.viewH / 2, 1.2);
  else if (k === '-' || k === '_') view.zoomAt(view.viewW / 2, view.viewH / 2, 1 / 1.2);
  else if (k === '0') view.reset();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

// ---- buttons ----
const center = () => [view.viewW / 2, view.viewH / 2];
document.getElementById('zoom-in').onclick = () => view.zoomAt(...center(), 1.3);
document.getElementById('zoom-out').onclick = () => view.zoomAt(...center(), 1 / 1.3);
document.getElementById('reset').onclick = () => view.reset();

window.addEventListener('resize', () => view.resize());

// ---- world generation UI ----
const seedInput = document.getElementById('seed');
const report = document.getElementById('report');
let meta = null, mode = 'land';

// Colour ramps for the data views: [value, colour] stops
const TEMP_STOPS = [[-30, '#4b3a9c'], [-15, '#3f78d4'], [0, '#8fd3ee'], [10, '#a9d98c'], [20, '#f2e07a'], [27, '#e8643c'], [30, '#d9442f']];
const RAIN_STOPS = [[0, '#c9a66b'], [250, '#e6d08a'], [500, '#cfe08a'], [1000, '#7cc47a'], [1500, '#3fa58a'], [2000, '#2a7fa6'], [2500, '#2a4f9c']];
const LEGENDS = {
  temp: { stops: TEMP_STOPS, min: -30, max: 30, labels: ['−30°C', '30°C'] },
  rain: { stops: RAIN_STOPS, min: 0, max: 2500, labels: ['0 mm', '2500+ mm'] },
};
const hex = (h) => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
function rampColor(stops, v) {
  if (v <= stops[0][0]) return stops[0][1];
  for (let k = 1; k < stops.length; k++) {
    const [v1, c1] = stops[k];
    if (v <= v1) {
      const [v0, c0] = stops[k - 1], f = (v - v0) / (v1 - v0), a = hex(c0), b = hex(c1);
      return `rgb(${a.map((x, j) => Math.round(x + (b[j] - x) * f)).join(',')})`;
    }
  }
  return stops[stops.length - 1][1];
}
function showLegend() {
  const L = LEGENDS[mode], el = document.getElementById('legend');
  el.hidden = !L;
  if (!L) return;
  el.querySelector('.ramp').style.background = 'linear-gradient(to right,' +
    L.stops.map(([v, c]) => `${c} ${((v - L.min) / (L.max - L.min) * 100).toFixed(1)}%`).join(',') + ')';
  el.children[0].textContent = L.labels[0];
  el.children[2].textContent = L.labels[1];
}

const hue = (id) => (id * 137.5) % 360;           // golden-angle hues: neighbours differ

function paint() {
  const cols = view.colors;
  for (let i = 0; i < map.size; i++) {
    if (mode === 'land') { cols[i] = TERRAIN[map.terrain[i]].color; continue; }
    if (mode === 'temp') { cols[i] = rampColor(TEMP_STOPS, map.temperature[i]); continue; }
    if (mode === 'rain') {
      cols[i] = TERRAIN[map.terrain[i]].land ? rampColor(RAIN_STOPS, map.precipitation[i]) : '#1d3140';
      continue;
    }
    const p = map.plates[map.plate[i]], land = TERRAIN[map.terrain[i]].land;
    cols[i] = p.type === 'continental'
      ? `hsl(${hue(p.id)} 60% ${land ? 58 : 34}%)`
      : `hsl(${hue(p.id)} 22% ${land ? 50 : 24}%)`;
  }
  showLegend();
  view.dirty = true;
}

function renderReport() {
  const conts = map.plates.filter(p => p.type === 'continental');
  const rows = conts.map(p => {
    const sw = `<i style="background:hsl(${hue(p.id)} 60% 58%)"></i>`;
    return `<li>${sw}${p.name}, ${p.orientation}, ${meta.landByPlate[p.id]} land tiles</li>`;
  }).join('');
  const legend = [4, 3, 2, 1, 0].map(id =>
    `<li><i style="background:${TERRAIN[id].color}"></i>${TERRAIN[id].name}, ${meta.elevation[id]} tiles${
      id === 4 ? ' (impassable)' : id === 0 ? ' (not navigable yet)' : ''}</li>`).join('');
  const tempLine = `<p>Temperature ranges from ${meta.temperature.min.toFixed(0)}°C (polar mountains) to ${meta.temperature.max.toFixed(0)}°C (equator).</p>`;
  const pr = meta.precipitation;
  const rainLine = `<p>Land rainfall: ${Math.round(pr.min)} to ${Math.round(pr.max)} mm a year, average ${Math.round(pr.mean)} mm.</p>`;
  const v = meta.volcanoes;
  const nb = v.filter(x => x.kind === 'boundary').length, nh = v.length - nb, ni = v.filter(x => x.island).length;
  const volcanoLine = `<p>${v.length} volcanoes: ${nb} along plate borders, ${nh} mid-plate hotspot${nh === 1 ? '' : 's'}` +
    (ni ? `; ${ni} born at sea as ${ni === 1 ? 'an island' : 'islands'}` : '') + '.</p>';
  const big = meta.landmasses.filter(n => n >= 30).length;
  const small = meta.landmasses.length - big;
  const fused = meta.fused.map(g => g.map(id => map.plates[id].name.slice(-1)).join(' + '));
  report.innerHTML =
    `<p>Land ${meta.landPct.toFixed(1)}%, ocean ${(100 - meta.landPct).toFixed(1)}%.
     ${big} main landmasses${small ? `, ${small} small islands` : ''}.</p>
     <ul>${legend}</ul>
     ${volcanoLine}
     ${tempLine}
     ${rainLine}
     <ul>${rows}</ul>` +
    (fused.length ? `<p>Collided and fused: ${fused.join('; ')}.</p>` : '');
}

function generate(seed) {
  seed = String(seed).trim() || 'earth';
  seedInput.value = seed;
  meta = generateWorld(map, seed);
  history.replaceState(null, '', '#' + encodeURIComponent(seed));
  paint(); renderReport();
}

document.getElementById('seed-form').addEventListener('submit', (e) => { e.preventDefault(); generate(seedInput.value); });
document.getElementById('dice').onclick = () => generate(Math.random().toString(36).slice(2, 8));
for (const b of document.querySelectorAll('[data-mode]')) {
  b.onclick = () => {
    mode = b.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', x === b));
    paint();
  };
}
generate(decodeURIComponent(location.hash.slice(1)) || 'earth');

// ---- main loop: redraw only when something changed ----
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (keys.size) {
    const speed = 700 * dt;                                    // screen px per frame
    let dx = 0, dy = 0;
    if (keys.has('arrowleft') || keys.has('a')) dx += speed;
    if (keys.has('arrowright') || keys.has('d')) dx -= speed;
    if (keys.has('arrowup') || keys.has('w')) dy += speed;
    if (keys.has('arrowdown') || keys.has('s')) dy -= speed;
    view.pan(dx, dy);
  }
  if (view.dirty) view.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
