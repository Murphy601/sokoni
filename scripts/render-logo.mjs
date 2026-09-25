import sharp from "sharp";
import { writeFileSync, copyFileSync } from "node:fs";

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Everything below is derived from the supplied artwork. Do not redraw it.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(root, "website/assets/images");
const SRC = resolve(OUT, "brand/logo-source.png");
const BG = { r: 0x14, g: 0x14, b: 0x14 };

// Supplied artwork sits inside a grey screenshot frame. Measured crops:
const FULL = { left: 71, top: 84, width: 301, height: 270 }; // mark + SOKONI
const MONO = { left: 125, top: 84, width: 191, height: 188 }; // mark alone

// Lift the artwork off its flat ground: estimate coverage from the strongest
// channel, then undo the blend so edges keep their real colour.
async function knockout(region) {
  const { data, info } = await sharp(SRC).extract(region).ensureAlpha()
    .raw().toBuffer({ resolveWithObject: true });
  const px = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0, j = 0; i < data.length; i += info.channels, j += 4) {
    const c = [data[i], data[i + 1], data[i + 2]];
    const g = [BG.r, BG.g, BG.b];
    const a = Math.min(1, Math.max(0, Math.max(...c.map((v, k) => v - g[k])) / 200));
    for (let k = 0; k < 3; k++) {
      px[j + k] = a < 0.004 ? 0 : Math.round(Math.min(255, Math.max(0, (c[k] - (1 - a) * g[k]) / a)));
    }
    px[j + 3] = Math.round(a * 255);
  }
  return sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } });
}
const buf = (s) => s.png({ compressionLevel: 9 }).toBuffer();
const w = (n, b) => { writeFileSync(resolve(OUT, n), b); console.log("wrote", n, `${(b.length / 1024).toFixed(1)}kb`); };

// tile: artwork centred on the dark ground, optionally rounded
async function tile(region, size, frac, radius) {
  const art = await knockout(region);
  const m = await art.metadata();
  const tw = Math.round(size * frac);
  const th = Math.round((m.height / m.width) * tw);
  const inner = await art.resize(tw, th, { kernel: sharp.kernel.lanczos3 }).png().toBuffer();
  const ground = radius
    ? Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#141414"/></svg>`)
    : null;
  let base = sharp({ create: { width: size, height: size, channels: 4, background: radius ? { r: 0, g: 0, b: 0, alpha: 0 } : { ...BG, alpha: 1 } } });
  const layers = [];
  if (ground) layers.push({ input: ground, left: 0, top: 0 });
  layers.push({ input: inner, left: Math.round((size - tw) / 2), top: Math.round((size - th) / 2) });
  return buf(base.composite(layers));
}

// ---- profile pictures + app icons (full lockup, square, dark ground)
w("sokoni-profile-1024.png", await tile(FULL, 1024, 0.74, 0));
w("sokoni-whatsapp-profile.png", await tile(FULL, 640, 0.74, 0));
w("logo-apple-touch.png", await tile(MONO, 180, 0.76, 0));
w("favicon-32.png", await tile(MONO, 32, 0.8, 7));
w("favicon-180.png", await tile(MONO, 180, 0.8, 40));
w("logo-512.png", await tile(MONO, 512, 0.78, 0));

// ---- transparent mark, for the site header
const markPng = await buf((await knockout(MONO)).resize(null, 112, { kernel: sharp.kernel.lanczos3 }));
w("logo-mark.png", markPng);

// Keep the .svg filenames alive (favicon.svg alone is referenced by 33 pages)
// by wrapping the bitmap instead of touching every <link>.
const wrap = (vb, png, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${vb}" role="img" aria-label="${label}">\n  <title>${label}</title>\n  <image width="${vb.split(" ")[2]}" height="${vb.split(" ")[3]}" xlink:href="data:image/png;base64,${png.toString("base64")}"/>\n</svg>\n`;

const favPng = await tile(MONO, 128, 0.8, 28);
w("favicon.svg", Buffer.from(wrap("0 0 128 128", favPng, "Sokoni")));
const m = await sharp(markPng).metadata();
w("logo-mark.svg", Buffer.from(wrap(`0 0 ${m.width} ${m.height}`, markPng, "Sokoni")));

// ---- lockups: artwork as supplied; on light surfaces it rides its own dark card
const lockDark = await buf((await knockout(FULL)).resize(null, 192, { kernel: sharp.kernel.lanczos3 }));
w("logo-lockup-dark.png", lockDark);
{
  const lm = await sharp(lockDark).metadata();
  const padX = 48, padY = 36;
  w("logo-lockup-light.png", await buf(
    sharp({ create: { width: lm.width + padX * 2, height: lm.height + padY * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([
        { input: Buffer.from(`<svg width="${lm.width + padX * 2}" height="${lm.height + padY * 2}"><rect width="${lm.width + padX * 2}" height="${lm.height + padY * 2}" rx="34" fill="#141414"/></svg>`), left: 0, top: 0 },
        { input: lockDark, left: padX, top: padY },
      ])));
}

// ---- social card: artwork centred, taglines pre-rendered (no font at build time)
{
  const W = 1200, H = 630;
  const art = await buf((await knockout(FULL)).resize(null, 300, { kernel: sharp.kernel.lanczos3 }));
  const am = await sharp(art).metadata();
  w("logo-og.png", await buf(
    sharp({ create: { width: W, height: H, channels: 4, background: { ...BG, alpha: 1 } } })
      .composite([
        { input: art, left: Math.round((W - am.width) / 2), top: 108 },
        { input: resolve(OUT, "brand/og-taglines.png"), left: 0, top: 452 },
      ])));
}
copyFileSync(resolve(OUT, "logo-lockup-dark.png"), resolve(OUT, "logo-lockup.png"));
console.log("done");
