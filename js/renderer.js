// Canvas renderer + camera for a pointy-top hex map that wraps east-west.
// World units: hex radius = HEX_SIZE. Tile (0,0) is centred at world (0,0).

const HEX_SIZE = 32;
const SQRT3 = Math.sqrt(3);
const MAX_ZOOM = 3;

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

    for (let row = r0; row <= r1; row++) {
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
        if (map.feature[idx] === 1) this.drawVolcano(cx, cy);
      }
    }

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
