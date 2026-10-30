// Genera le icone PNG dell'app senza dipendenze (SDF + supersampling + encoder PNG)
// Uso: node tools/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../icons/', import.meta.url);

// ---- encoder PNG ----
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- primitive SDF (coordinate in unità 0..512) ----
const segDist = (px, py, ax, ay, bx, by) => {
  const vx = bx - ax, vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - ax - vx * t, py - ay - vy * t);
};
const roundRect = (px, py, x, y, w, h, r) => {
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const C1 = [0xff, 0xdf, 0x5e], C2 = [0xfa, 0xc8, 0x1e], C3 = [0xf0, 0xae, 0x00];
const INK = [0x26, 0x26, 0x26, 1]; // grigio grafite
const grad = (t) => {
  t = Math.max(0, Math.min(1, t));
  const [a, b, u] = t < 0.5 ? [C1, C2, t * 2] : [C2, C3, (t - 0.5) * 2];
  return a.map((v, i) => v + (b[i] - v) * u);
};

// scene(x,y) -> [r,g,b,a]  (a in 0..1)
function render(size, scene, ss = 4) {
  const buf = Buffer.alloc(size * size * 4);
  const k = 512 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const [cr, cg, cb, ca] = scene((x + (sx + 0.5) / ss) * k, (y + (sy + 0.5) / ss) * k);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const i = (y * size + x) * 4;
      const n = ss * ss;
      buf[i] = a ? Math.round(r / a) : 0;
      buf[i + 1] = a ? Math.round(g / a) : 0;
      buf[i + 2] = a ? Math.round(b / a) : 0;
      buf[i + 3] = Math.round((a / n) * 255);
    }
  }
  return png(size, size, buf);
}

// Disegno del logo: spunta grafite centrata con un leggero alone; s = scala
function logo(px, py, bgAlpha, s = 1) {
  const X = (px - 256) / s + 256, Y = (py - 256) / s + 256;
  const bg = grad((px + py) / 1024);
  // spunta (stroke 64, cap round): 150,262 → 222,334 → 362,186
  const d = Math.min(segDist(X, Y, 150, 262, 222, 334), segDist(X, Y, 222, 334, 362, 186)) - 32;
  if (d <= 0) return INK;
  // ombra morbida sotto la spunta
  const sh = Math.min(segDist(X, Y - 14, 150, 262, 222, 334), segDist(X, Y - 14, 222, 334, 362, 186)) - 32;
  const k = sh < 30 ? 0.10 * (1 - Math.max(0, sh) / 30) : 0;
  return [...bg.map((v) => v * (1 - k)), bgAlpha];
}

const rounded = (px, py) => {
  const d = roundRect(px, py, 0, 0, 512, 512, 120);
  if (d > 0) return [0, 0, 0, 0];
  return logo(px, py, 1);
};
const full = (s) => (px, py) => logo(px, py, 1, s);

writeFileSync(new URL('icon-192.png', OUT), render(192, rounded));
writeFileSync(new URL('icon-512.png', OUT), render(512, rounded, 3));
writeFileSync(new URL('maskable-512.png', OUT), render(512, full(0.72), 3));
writeFileSync(new URL('apple-touch-icon.png', OUT), render(180, full(0.85)));

// Icone scorciatoie (cerchio sfumato con simbolo bianco)
function shortcut(draw) {
  return (px, py) => {
    const d = Math.hypot(px - 256, py - 256) - 256;
    if (d > 0) return [0, 0, 0, 0];
    if (draw(px, py) <= 0) return INK;
    return [...grad((px + py) / 1024), 1];
  };
}
const mic = (x, y) => Math.min(
  roundRect(x, y, 206, 110, 100, 190, 50),
  // arco a U sotto la capsula
  y > 230 ? Math.abs(Math.hypot(x - 256, y - 240) - 100) - 16 : 1e9,
  segDist(x, y, 256, 340, 256, 400) - 16,
  segDist(x, y, 206, 402, 306, 402) - 16,
);
const plus = (x, y) => Math.min(segDist(x, y, 256, 150, 256, 362), segDist(x, y, 150, 256, 362, 256)) - 26;
writeFileSync(new URL('shortcut-mic.png', OUT), render(96, shortcut(mic)));
writeFileSync(new URL('shortcut-add.png', OUT), render(96, shortcut(plus)));

console.log('Icone generate in', OUT.pathname);
