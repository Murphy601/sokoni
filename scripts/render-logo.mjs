import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const img = (p) => resolve(root, "website/assets/images", p);

const jobs = [
  ["logo-avatar.svg", "sokoni-whatsapp-profile.png", 640, 640],
  ["logo-avatar.svg", "logo-apple-touch.png", 180, 180],
  ["favicon.svg", "favicon-32.png", 32, 32],
  ["favicon.svg", "favicon-180.png", 180, 180],
  ["logo.svg", "logo-512.png", 512, 512],
  ["logo-icon-dark.svg", "logo-icon-dark.png", 512, 512],
  ["logo-icon-light.svg", "logo-icon-light.png", 512, 512],
  ["logo-lockup-light.svg", "logo-lockup-light.png", 960, 192],
  ["logo-lockup-dark.svg", "logo-lockup-dark.png", 960, 192],
  ["logo-og.svg", "logo-og.png", 1200, 630],
];

for (const [src, out, w, h] of jobs) {
  await sharp(readFileSync(img(src)), { density: 384 })
    .resize(w, h, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(img(out));
  console.log("wrote", out, `${w}x${h}`);
}

// Small-scale favicon legibility test (render at 32px and save enlarged for review)
await sharp(readFileSync(img("favicon.svg")), { density: 384 })
  .resize(32, 32)
  .png()
  .toFile(img("favicon-32-test.png"));
console.log("wrote favicon-32-test.png (32px actual size)");

await sharp(readFileSync(img("favicon-32-test.png")))
  .resize(256, 256, { kernel: sharp.kernel.nearest })
  .png()
  .toFile(img("favicon-32-test-enlarged.png"));
console.log("wrote favicon-32-test-enlarged.png (256px nearest-neighbor preview)");
console.log("Done.");
