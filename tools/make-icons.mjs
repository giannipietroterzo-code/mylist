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
const INK = [0x26, 0x26, 0x26, 1]; // grigio grafite
// tinta unita (niente sfumature)
const grad = () => [0xf5, 0xb8, 0x00];

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

// Logo: onda vocale + spunta, grafite su giallo (detti la nota → diventa una cosa fatta)
const W = 17; // metà spessore del tratto
function logoShape(X, Y) {
  X += 8; // centratura ottica
  const wave = Math.min(segDist(X, Y, 130, 224, 130, 288), segDist(X, Y, 180, 176, 180, 336), segDist(X, Y, 230, 208, 230, 304));
  const check = Math.min(segDist(X, Y, 276, 262, 320, 306), segDist(X, Y, 320, 306, 398, 204));
  return Math.min(wave, check) - W;
}

// Microfono (icona della scorciatoia "Detta")
function micShape(X, Y) {
  const capsule = Math.abs(roundRect(X, Y, 191, 112, 130, 200, 65)) - W;
  const grille = Math.min(
    segDist(X, Y, 191, 194, 233, 194), segDist(X, Y, 191, 240, 233, 240),
    segDist(X, Y, 279, 194, 321, 194), segDist(X, Y, 279, 240, 321, 240),
  ) - 12;
  const holder = Y >= 232
    ? Math.abs(Math.hypot(X - 256, Y - 232) - 118) - W
    : Math.min(Math.hypot(X - 138, Y - 232), Math.hypot(X - 374, Y - 232)) - W;
  const stand = Math.min(segDist(X, Y, 256, 350, 256, 398), segDist(X, Y, 206, 398, 306, 398)) - W;
  return Math.min(capsule, grille, holder, stand);
}

// s = scala del disegno (per le icone "maskable" serve margine)
function logo(px, py, bgAlpha, s = 1) {
  const X = (px - 256) / s + 256, Y = (py - 256) / s + 256;
  if (logoShape(X, Y) <= 0) return INK;
  return [...grad(), bgAlpha];
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

// Icone scorciatoie (cerchio giallo con simbolo grafite)
function shortcut(draw) {
  return (px, py) => {
    const d = Math.hypot(px - 256, py - 256) - 256;
    if (d > 0) return [0, 0, 0, 0];
    if (draw(px, py) <= 0) return INK;
    return [...grad(), 1];
  };
}
const mic = (x, y) => micShape((x - 256) / 0.8 + 256, (y - 256) / 0.8 + 256);
const plus = (x, y) => Math.min(segDist(x, y, 256, 150, 256, 362), segDist(x, y, 150, 256, 362, 256)) - 26;
writeFileSync(new URL('shortcut-mic.png', OUT), render(96, shortcut(mic)));
writeFileSync(new URL('shortcut-add.png', OUT), render(96, shortcut(plus)));

console.log('Icone generate in', OUT.pathname);
