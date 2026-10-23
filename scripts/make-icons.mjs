// Generates every icon / installer image from assets/icon.svg.
// Usage: npm run icons
import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconSvg = fs.readFileSync(path.join(root, 'assets/icon.svg'), 'utf8');
const out = (...p) => {
  const file = path.join(root, ...p);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
};

function render(svg, width) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' },
  }).render();
  return { png: r.asPng(), pixels: r.pixels, width: r.width, height: r.height };
}

// ICO container holding PNG-compressed images (supported since Windows Vista).
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}

// 24-bit BMP (what NSIS wants for installer artwork).
function buildBmp({ pixels, width, height }) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const data = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 4;
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 4;
      const a = pixels[s + 3] / 255;
      const d = y * rowSize + x * 3;
      data[d] = Math.round(pixels[s + 2] * a + 255 * (1 - a));
      data[d + 1] = Math.round(pixels[s + 1] * a + 255 * (1 - a));
      data[d + 2] = Math.round(pixels[s] * a + 255 * (1 - a));
    }
  }
  const header = Buffer.alloc(54);
  header.write('BM', 0);
  header.writeUInt32LE(54 + data.length, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(data.length, 34);
  header.writeInt32LE(2835, 38);
  header.writeInt32LE(2835, 42);
  return Buffer.concat([header, data]);
}

const markOnly = iconSvg.replace('<svg ', '<svg x="0" y="0" ');
const embed = (x, y, size) =>
  `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 512 512">${markOnly
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')}</svg>`;

// --- app icons ---------------------------------------------------------------
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
fs.writeFileSync(out('build/icon.ico'), buildIco(icoSizes.map((size) => ({ size, png: render(iconSvg, size).png }))));
fs.writeFileSync(out('build/icon.png'), render(iconSvg, 1024).png);
for (const size of [16, 32, 48, 64, 128, 256, 512]) {
  fs.writeFileSync(out(`build/icons/${size}x${size}.png`), render(iconSvg, size).png);
}
fs.writeFileSync(out('src/ui/assets/icon.png'), render(iconSvg, 256).png);
fs.copyFileSync(path.join(root, 'assets/icon.svg'), out('src/ui/assets/icon.svg'));

// --- website assets ----------------------------------------------------------
fs.copyFileSync(path.join(root, 'assets/icon.svg'), out('site/assets/icon.svg'));
fs.writeFileSync(out('site/assets/icon-192.png'), render(iconSvg, 192).png);
fs.writeFileSync(out('site/assets/icon-512.png'), render(iconSvg, 512).png);
fs.writeFileSync(out('site/favicon.ico'), buildIco([16, 32, 48].map((size) => ({ size, png: render(iconSvg, size).png }))));

// --- NSIS installer artwork --------------------------------------------------
const sidebarSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="164" y2="314" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#140A26"/><stop offset="1" stop-color="#2A0F3A"/>
    </linearGradient>
    <radialGradient id="h" cx="82" cy="96" r="120" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#E0337E" stop-opacity="0.5"/><stop offset="1" stop-color="#7C3AED" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="164" height="314" fill="url(#g)"/>
  <rect width="164" height="314" fill="url(#h)"/>
  ${embed(42, 56, 80)}
  <text x="82" y="176" text-anchor="middle" font-family="Segoe UI" font-weight="700" font-size="26" fill="#FFFFFF">Imp</text>
  <text x="82" y="200" text-anchor="middle" font-family="Segoe UI" font-size="11" fill="#FFC2DD">Fast. Private. Light.</text>
  <rect x="52" y="270" width="60" height="3" rx="1.5" fill="#FF9A1F" opacity="0.85"/>
</svg>`;
fs.writeFileSync(out('build/installerSidebar.bmp'), buildBmp(render(sidebarSvg, 164)));
fs.writeFileSync(out('build/uninstallerSidebar.bmp'), buildBmp(render(sidebarSvg, 164)));

const headerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
  <rect width="150" height="57" fill="#FFFFFF"/>
  ${embed(96, 8, 41)}
</svg>`;
fs.writeFileSync(out('build/installerHeader.bmp'), buildBmp(render(headerSvg, 150)));

console.log('Icons generated.');
