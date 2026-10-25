import { WorldMap, TERRAIN } from './map.js';
import { Renderer } from './renderer.js';

const canvas = document.getElementById('map');
const info = document.getElementById('tile-info');
const map = new WorldMap(80, 50);          // 4,000 tiles
const view = new Renderer(canvas, map);

document.getElementById('stats').textContent =
  `${map.cols} × ${map.rows} = ${map.size.toLocaleString()} tiles, wraps east–west`;

// ---- hover ----
function setHover(px, py) {
  const t = view.pickTile(px, py);
  const same = t && view.hover && t.c === view.hover.c && t.row === view.hover.row;
  if (!same) { view.hover = t; view.dirty = true; }
  info.textContent = t
    ? `Tile ${t.col}, ${t.row} · ${TERRAIN[map.terrain[map.index(t.col, t.row)]].name}`
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
