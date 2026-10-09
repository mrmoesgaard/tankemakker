// Draws the app icon (same design as public/icon.svg) into PNG files without extra dependencies.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BLUE = [47, 91, 211];
const WHITE = [255, 255, 255];
const YELLOW = [255, 209, 102];

// Returns the colour at a point in the 512x512 design space, or null for transparent.
function shade(x, y) {
  const inRoundRect = (() => {
    const r = 112;
    const cx = Math.min(Math.max(x, r), 512 - r);
    const cy = Math.min(Math.max(y, r), 512 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  })();
  if (!inRoundRect) return null;

  if ((x - 392) ** 2 + (y - 128) ** 2 <= 34 ** 2) return YELLOW;
  if ((x - 120) ** 2 + (y - 150) ** 2 <= 22 ** 2) return YELLOW;

  // Mic capsule: x 200..312, y 106..330 with radius 56 ends.
  const capY = Math.min(Math.max(y, 162), 274);
  if ((x - 256) ** 2 + (y - capY) ** 2 <= 56 ** 2) return WHITE;

  // Holder arc: ring between radius 94 and 132 around (256, 274), lower half only.
  const d = Math.hypot(x - 256, y - 274);
  if (y >= 274 && d >= 94 && d <= 132) return WHITE;

  // Stem.
  if (x >= 237 && x <= 275 && y >= 400 && y <= 444) return WHITE;

  return BLUE;
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const SS = 4; // supersampling for smooth edges
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const col = shade(((px + (sx + 0.5) / SS) * 512) / size, ((py + (sy + 0.5) / SS) * 512) / size);
          if (col) { r += col[0]; g += col[1]; b += col[2]; a++; }
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = a ? r / a : 0;
      raw[o + 1] = a ? g / a : 0;
      raw[o + 2] = a ? b / a : 0;
      raw[o + 3] = (a * 255) / (SS * SS);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) writeFileSync(`public/icon-${size}.png`, png(size));

// Android launcher icons, if the Android project exists.
const res = "android/app/src/main/res";
if (existsSync(res)) {
  const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [density, size] of Object.entries(densities)) {
    mkdirSync(`${res}/mipmap-${density}`, { recursive: true });
    for (const name of ["ic_launcher", "ic_launcher_round"]) writeFileSync(`${res}/mipmap-${density}/${name}.png`, png(size));
    rmSync(`${res}/mipmap-${density}/ic_launcher_foreground.png`, { force: true });
  }
  // Use the plain PNG icons instead of Capacitor's default adaptive icon.
  rmSync(`${res}/mipmap-anydpi-v26`, { recursive: true, force: true });
}
console.log("Ikoner lavet");
