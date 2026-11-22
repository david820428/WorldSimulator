// Canvas renderer + camera for a pointy-top hex map that wraps east-west.
// World units: hex radius = HEX_SIZE. Tile (0,0) is centred at world (0,0).

import { MapArt } from './graphics.js';

const HEX_SIZE = 32;
const SQRT3 = Math.sqrt(3);
const MAX_ZOOM = 3;
const CIV_COLORS = ['#c0392b', '#2e86c1', '#d4a017', '#7d3c98', '#1e8449', '#ca6f1e', '#17a2b8', '#b03a6f', '#5d6d7e', '#8e5b3a'];

export class Renderer {
  constructor(canvas, map) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = map;

    this.hexW = SQRT3 * HEX_SIZE;                       // tile width
    this.worldW = map.cols * this.hexW;                 // wrap period
    this.top = -HEX_SIZE;                               // map top edge
    this.worldH = (map.rows - 1) * 1.5 * HEX_SIZE + 2 * HEX_SIZE;

    this.corners = [];                                  // hex outline offsets
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i - 30);
      this.corners.push([HEX_SIZE * Math.cos(a), HEX_SIZE * Math.sin(a)]);
    }

    this.cam = { x: this.worldW / 2, y: this.top + this.worldH / 2, zoom: 1 };
    this.colors = new Array(map.size).fill('#2d6f8e');   // one CSS colour per tile
    this.art = new MapArt(map, HEX_SIZE);                // illustrated look (graphics.js)
    this.artStyle = 'none';                              // 'none' = flat colours, 'hard' or 'organic' = illustrated
    this.civs = [];                                      // starting tiles of the civilizations (set by main.js)
    this.hover = null;
    this.dirty = true;
    this.resize();
    this.cam.zoom = this.minZoom * 1.6;
    this.clamp();
  }

  resize() {
    this.dpr = window.devicePixelRatio || 1;
    this.viewW = this.canvas.clientWidth;
    this.viewH = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.viewW * this.dpr);
    this.canvas.height = Math.round(this.viewH * this.dpr);
    this.minZoom = this.viewH / this.worldH;            // whole map height fits
    this.clamp();
  }

  clamp() {
    const c = this.cam;
    c.zoom = Math.min(MAX_ZOOM, Math.max(this.minZoom, c.zoom));
    c.x = ((c.x % this.worldW) + this.worldW) % this.worldW;   // wrap east-west
    const half = this.viewH / c.zoom / 2;                      // no wrap north-south
    const lo = this.top + half, hi = this.top + this.worldH - half;
    c.y = lo >= hi ? this.top + this.worldH / 2 : Math.min(hi, Math.max(lo, c.y));
    this.dirty = true;
  }

  pan(dxPx, dyPx) {
    this.cam.x -= dxPx / this.cam.zoom;
    this.cam.y -= dyPx / this.cam.zoom;
    this.clamp();
  }

  // Zoom while keeping the world point under (px, py) fixed on screen.
  zoomAt(px, py, factor) {
    const before = this.screenToWorld(px, py);
    this.cam.zoom *= factor;
    this.cam.zoom = Math.min(MAX_ZOOM, Math.max(this.minZoom, this.cam.zoom));
    this.cam.x = before.x - (px - this.viewW / 2) / this.cam.zoom;
    this.cam.y = before.y - (py - this.viewH / 2) / this.cam.zoom;
    this.clamp();
  }

  reset() {
    this.cam.x = this.worldW / 2;
    this.cam.y = this.top + this.worldH / 2;
    this.cam.zoom = this.minZoom * 1.6;
    this.clamp();
  }

  screenToWorld(px, py) {
    const c = this.cam;
    return { x: c.x + (px - this.viewW / 2) / c.zoom, y: c.y + (py - this.viewH / 2) / c.zoom };
  }

  // Screen point -> tile. `c` is the unwrapped column, `col` the wrapped one.
  pickTile(px, py) {
    const w = this.screenToWorld(px, py);
    const q = (SQRT3 / 3 * w.x - w.y / 3) / HEX_SIZE;
    const r = (2 / 3 * w.y) / HEX_SIZE;
    // cube rounding
    let x = q, z = r, y = -x - z;
    let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
    const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
    const row = rz;
    const c = rx + (rz - (rz & 1)) / 2;                 // axial -> odd-r offset
    if (!this.map.inBounds(row)) return null;
    return { c, row, col: this.map.wrapCol(c) };
  }

  hexPath(cx, cy) {
    const ctx = this.ctx, k = this.corners;
    ctx.beginPath();
    ctx.moveTo(cx + k[0][0], cy + k[0][1]);
    for (let i = 1; i < 6; i++) ctx.lineTo(cx + k[i][0], cy + k[i][1]);
    ctx.closePath();
  }

  // Round badge: crop (golden grain ear), livestock (paw print), deposit (pickaxe), at an offset
  // from the tile centre (dx, dy in hex radii) and scaled by k.
  drawBadge(kind, cx, cy, dx, dy, k) {
    const ctx = this.ctx, s = HEX_SIZE;
    ctx.save();
    ctx.translate(cx + dx * s, cy + dy * s);
    ctx.scale(k, k);
    ctx.beginPath(); ctx.arc(0, 0, 0.46 * s, 0, Math.PI * 2);
    ctx.fillStyle = kind === 'crop' ? 'rgba(255, 248, 224, 0.9)'
      : kind === 'livestock' ? 'rgba(236, 243, 255, 0.92)' : 'rgba(232, 235, 240, 0.93)';
    ctx.fill();
    ctx.lineWidth = 0.04 * s; ctx.strokeStyle = 'rgba(110, 80, 20, 0.75)'; ctx.stroke();
    ctx.lineCap = 'round';
    if (kind === 'crop') {
      ctx.beginPath(); ctx.moveTo(0, 0.34 * s); ctx.lineTo(0, -0.28 * s);          // stem
      ctx.lineWidth = 0.06 * s; ctx.strokeStyle = '#8a6a1f'; ctx.stroke();
      ctx.fillStyle = '#e9b824'; ctx.lineWidth = 0.025 * s;                        // grains
      for (const y of [-0.16, 0.02, 0.20]) {
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(side * 0.11 * s, (y - 0.02) * s, 0.06 * s, 0.12 * s, side * 0.55, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
        }
      }
      ctx.beginPath(); ctx.ellipse(0, -0.33 * s, 0.06 * s, 0.11 * s, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    } else if (kind === 'geo') {
      ctx.beginPath(); ctx.moveTo(-0.24 * s, 0.32 * s); ctx.lineTo(0.19 * s, -0.27 * s);   // pickaxe handle
      ctx.lineWidth = 0.07 * s; ctx.strokeStyle = '#7a5230'; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-0.14 * s, -0.30 * s);                                   // pickaxe head
      ctx.quadraticCurveTo(0.26 * s, -0.42 * s, 0.36 * s, 0.04 * s);
      ctx.lineWidth = 0.1 * s; ctx.strokeStyle = '#59616b'; ctx.stroke();
    } else {
      ctx.fillStyle = '#6b4a2f';                                                   // paw print
      ctx.beginPath(); ctx.ellipse(0, 0.13 * s, 0.2 * s, 0.16 * s, 0, 0, Math.PI * 2); ctx.fill();
      for (const [x, y, rot] of [[-0.25, -0.08, -0.45], [-0.09, -0.25, -0.15], [0.09, -0.25, 0.15], [0.25, -0.08, 0.45]]) {
        ctx.beginPath(); ctx.ellipse(x * s, y * s, 0.075 * s, 0.1 * s, rot, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  // A blue S-shaped stream with a pale edge so it reads on any terrain colour.
  drawRiver(cx, cy) {
    const ctx = this.ctx, s = HEX_SIZE;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 0.16 * s, cy - 0.52 * s);
    ctx.bezierCurveTo(cx + 0.58 * s, cy - 0.26 * s, cx - 0.58 * s, cy + 0.26 * s, cx + 0.16 * s, cy + 0.52 * s);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'; ctx.lineWidth = 0.27 * s; ctx.stroke();
    ctx.strokeStyle = '#2a7fc4'; ctx.lineWidth = 0.15 * s; ctx.stroke();
    ctx.restore();
  }

  // A dark cone with a glowing crater.
  drawVolcano(cx, cy) {
    const ctx = this.ctx, s = HEX_SIZE;
    ctx.beginPath();
    ctx.moveTo(cx - 0.50 * s, cy + 0.34 * s); ctx.lineTo(cx - 0.12 * s, cy - 0.38 * s);
    ctx.lineTo(cx + 0.12 * s, cy - 0.38 * s); ctx.lineTo(cx + 0.50 * s, cy + 0.34 * s);
    ctx.closePath();
    ctx.fillStyle = '#4a3a35'; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 0.12 * s, cy - 0.38 * s); ctx.lineTo(cx + 0.12 * s, cy - 0.38 * s);
    ctx.lineTo(cx + 0.21 * s, cy - 0.17 * s); ctx.lineTo(cx - 0.21 * s, cy - 0.17 * s);
    ctx.closePath();
    ctx.fillStyle = '#f0662a'; ctx.fill();
  }

  // A coloured flag on each civilization's starting tile (drawn again for every wrapped copy in view).
  drawCivs(ctx, r0, r1, c0, c1) {
    const s = HEX_SIZE, rowH = 1.5 * s, cols = this.map.cols;
    this.civs.forEach((idx, k) => {
      const col = idx % cols, row = (idx / cols) | 0;
      if (row < r0 || row > r1) return;
      for (let c = col + Math.ceil((c0 - col) / cols) * cols; c <= c1; c += cols) {
        ctx.save();
        ctx.translate(this.hexW * (c + 0.5 * (row & 1)), rowH * row);
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';                     // pale disc so the flag stands out on any terrain
        ctx.beginPath(); ctx.arc(0, 0, 0.62 * s, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#3a3128'; ctx.lineWidth = 0.07 * s;           // pole
        ctx.beginPath(); ctx.moveTo(-0.1 * s, 0.4 * s); ctx.lineTo(-0.1 * s, -0.46 * s); ctx.stroke();
        ctx.fillStyle = CIV_COLORS[k % CIV_COLORS.length]; ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 0.045 * s;   // pennant
        ctx.beginPath(); ctx.moveTo(-0.1 * s, -0.46 * s); ctx.lineTo(0.46 * s, -0.28 * s); ctx.lineTo(-0.1 * s, -0.08 * s);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    });
  }

  draw() {
    const { ctx, cam, map, hexW } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0e2230';
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    ctx.translate(this.viewW / 2 - cam.x * cam.zoom, this.viewH / 2 - cam.y * cam.zoom);
    ctx.scale(cam.zoom, cam.zoom);

    const halfW = this.viewW / cam.zoom / 2, halfH = this.viewH / cam.zoom / 2;
    const rowH = 1.5 * HEX_SIZE;
    const r0 = Math.max(0, Math.floor((cam.y - halfH) / rowH) - 1);
    const r1 = Math.min(map.rows - 1, Math.ceil((cam.y + halfH) / rowH) + 1);
    const c0 = Math.floor((cam.x - halfW) / hexW) - 1;
    const c1 = Math.ceil((cam.x + halfW) / hexW) + 1;

    ctx.lineWidth = 1 / cam.zoom;
    const outline = cam.zoom > 0.35;
    const gridColor = 'rgba(15, 35, 45, 0.28)';

    if (this.artStyle !== 'none') this.art.draw(ctx, this, r0, r1, c0, c1, this.artStyle);
    else for (let row = r0; row <= r1; row++) {
      const offset = (row & 1) * 0.5;
      for (let c = c0; c <= c1; c++) {
        const idx = map.index(c, row);
        const color = this.colors[idx];
        const cx = hexW * (c + offset), cy = rowH * row;
        ctx.fillStyle = color;
        ctx.strokeStyle = outline ? gridColor : color;   // far out, hide hairline gaps
        this.hexPath(cx, cy);
        ctx.fill();
        ctx.stroke();
        // River and volcano take the tile centre. Crop, livestock and deposit icons become
        // round badges: corners around a river/volcano, or shared out across a bare tile.
        const hasBase = map.river[idx] !== 0 || map.feature[idx] === 1;
        const badges = [];
        if (map.crop[idx]) badges.push('crop');
        if (map.livestock[idx]) badges.push('livestock');
        if (map.geo[idx]) badges.push('geo');
        if (map.river[idx]) this.drawRiver(cx, cy);
        if (map.feature[idx] === 1) this.drawVolcano(cx, cy);
        if (badges.length) {
          const slots = hasBase ? [[0.40, 0.40, 0.58], [-0.40, 0.40, 0.58], [0.38, -0.38, 0.58]]
            : badges.length === 1 ? [[0, 0, 1]]
            : badges.length === 2 ? [[-0.34, 0, 0.72], [0.34, 0, 0.72]]
            : [[0, -0.30, 0.62], [-0.36, 0.28, 0.62], [0.36, 0.28, 0.62]];
          badges.forEach((kind, k) => this.drawBadge(kind, cx, cy, ...slots[k]));
        }
      }
    }

    if (this.civs.length) this.drawCivs(ctx, r0, r1, c0, c1);

    if (this.hover) {
      const h = this.hover;
      this.hexPath(hexW * (h.c + (h.row & 1) * 0.5), rowH * h.row);
      ctx.lineWidth = 2.5 / cam.zoom;
      ctx.strokeStyle = '#e3c16f';
      ctx.stroke();
    }
    this.dirty = false;
  }
}
